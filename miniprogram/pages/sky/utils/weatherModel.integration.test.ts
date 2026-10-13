import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

import type { AirQualityApiResponse, WeatherApiResponse } from '../types.ts';

const loaderSource = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '../types' && context.parentURL.endsWith('/astronomy.ts')) {
    return {
      url: 'data:text/javascript,export const MoonInfo = {}',
      shortCircuit: true
    };
  }
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (
      error && error.code === 'ERR_MODULE_NOT_FOUND' &&
      (specifier.startsWith('./') || specifier.startsWith('../')) &&
      !specifier.endsWith('.ts')
    ) {
      return nextResolve(specifier + '.ts', context);
    }
    throw error;
  }
}`;
register(`data:text/javascript,${encodeURIComponent(loaderSource)}`, import.meta.url);

const { alignAirQualityToWeatherHours, cloudSeaCoverageCeiling, evaluateForecast, usableHeightMeters } =
  await import('./weatherModel.ts');

interface WeatherOverrides {
  elevation?: number;
  windGusts?: number;
  hourCount?: number;
  temperature2m?: number;
  temperature925hPa?: number;
  temperature850hPa?: number;
  temperature700hPa?: number;
  include700hPa?: boolean;
  convectiveCloudBase?: number | number[];
  cloudCoverLow?: number;
}

function makeWeather(overrides: WeatherOverrides = {}): WeatherApiResponse {
  const date = '2024-01-25';
  const hourCount = overrides.hourCount ?? 24;
  const time = Array.from({ length: hourCount }, (_, hour) => `${date}T${String(hour).padStart(2, '0')}:00`);
  const fill = (value: number): number[] => time.map(() => value);
  const cloudBase = Array.isArray(overrides.convectiveCloudBase)
    ? overrides.convectiveCloudBase
    : fill(overrides.convectiveCloudBase ?? 700);
  const weather: WeatherApiResponse = {
    latitude: 30.25,
    longitude: 120.17,
    elevation: 'elevation' in overrides ? (overrides.elevation as number) : 1200,
    timezone: 'Asia/Shanghai',
    utc_offset_seconds: 28800,
    hourly: {
      time,
      temperature_2m: fill(overrides.temperature2m ?? 18),
      relative_humidity_2m: fill(72),
      dew_point_2m: fill(14),
      apparent_temperature: fill(17),
      precipitation_probability: fill(5),
      precipitation: fill(0),
      weather_code: fill(1),
      cloud_cover: fill(15),
      cloud_cover_low: fill(overrides.cloudCoverLow ?? 60),
      cloud_cover_mid: fill(45),
      cloud_cover_high: fill(40),
      visibility: fill(20000),
      wind_speed_10m: fill(8),
      wind_gusts_10m: fill(overrides.windGusts ?? 12),
      pressure_msl: fill(1018),
      temperature_925hPa: fill(overrides.temperature925hPa ?? 20),
      temperature_850hPa: fill(overrides.temperature850hPa ?? 12),
      relative_humidity_925hPa: fill(85),
      relative_humidity_850hPa: fill(55),
      cloud_cover_925hPa: fill(75),
      cloud_cover_850hPa: fill(20),
      convective_cloud_base: cloudBase,
    },
    daily: {
      time: [date],
      weather_code: [1],
      temperature_2m_max: [23],
      temperature_2m_min: [13],
      sunrise: [`${date}T06:50`],
      sunset: [`${date}T17:30`],
      uv_index_max: [4],
    },
  };
  if (overrides.include700hPa) {
    weather.hourly.temperature_700hPa = fill(overrides.temperature700hPa ?? 4);
    weather.hourly.relative_humidity_700hPa = fill(60);
    weather.hourly.cloud_cover_700hPa = fill(40);
  }
  return weather;
}

test('AQ 仅按完全相同的 ISO 小时时间映射，缺失保持 undefined', () => {
  const weatherTimes = ['2024-01-25T17:00', '2024-01-25T18:00', '2024-01-25T19:00'];
  const airQuality: AirQualityApiResponse = {
    latitude: 30.25,
    longitude: 120.17,
    hourly: {
      time: ['2024-01-25T18:00', '2024-01-25T19:30'],
      pm2_5: [42, 99],
      aerosol_optical_depth: [0.28, 0.9],
    },
  };

  assert.deepEqual(alignAirQualityToWeatherHours(weatherTimes, airQuality), [
    { pm2_5: undefined, aod: undefined },
    { pm2_5: 42, aod: 0.28 },
    { pm2_5: undefined, aod: undefined },
  ]);
});

test('评分入口接入垂直层、气溶胶、体感阵风与逐时月光，并允许 AQ 为 null', () => {
  const weather = makeWeather();
  const airQuality: AirQualityApiResponse = {
    latitude: weather.latitude,
    longitude: weather.longitude,
    utc_offset_seconds: 28800,
    hourly: {
      time: ['2024-01-25T17:00', '2024-01-25T18:00'],
      pm2_5: [25, 30],
      aerosol_optical_depth: [0.2, 0.25],
    },
  };

  const withAir = evaluateForecast(weather, airQuality)[0];
  const withoutAir = evaluateForecast(weather, null)[0];

  assert.ok(
    withAir.predictions.cloud_sea.hourlyScores.some((hour) =>
      hour.factors.some((factor) => factor.name.includes('垂直层结'))
    )
  );
  assert.ok(
    withAir.predictions.travel_weather.hourlyScores.some((hour) =>
      hour.factors.some((factor) => factor.name.includes('阵风'))
    )
  );
  assert.ok(withAir.predictions.starry_sky.factors.some((factor) => factor.name.includes('月相')));
  const starryNight = withAir.predictions.starry_sky.hourlyScores.find(
    (hour) => hour.displayHour === '22:00'
  );
  assert.ok(
    starryNight?.factors.some(
      (factor) => factor.name.includes('月光') && factor.hint.includes('逐时')
    )
  );
  const sunsetHour = withAir.predictions.sunset_glow.hourlyScores.find(
    (hour) => hour.displayHour === '17:00'
  );
  assert.ok(
    sunsetHour?.factors.some(
      (factor) => factor.name.includes('气溶胶') && !factor.value.includes('暂缺')
    )
  );

  const missingSunsetHour = withoutAir.predictions.sunset_glow.hourlyScores.find(
    (hour) => hour.displayHour === '17:00'
  );
  const missingAirFactor = missingSunsetHour?.factors.find((factor) => factor.name.includes('气溶胶'));
  assert.equal(missingAirFactor?.value, '数据暂缺');
  assert.equal(missingAirFactor?.status, 'moderate');
});

function makeAirQuality(
  weather: WeatherApiResponse,
  aod: number,
  pm2_5: number
): AirQualityApiResponse {
  return {
    latitude: weather.latitude,
    longitude: weather.longitude,
    utc_offset_seconds: 28800,
    hourly: {
      time: [...weather.hourly.time],
      pm2_5: weather.hourly.time.map(() => pm2_5),
      aerosol_optical_depth: weather.hourly.time.map(() => aod),
    },
  };
}

test('适度气溶胶实际抬高晚霞评分，重度灰霾实际压低晚霞评分', () => {
  const weather = makeWeather();

  const withoutAir = evaluateForecast(weather, null)[0].predictions.sunset_glow.score;
  const moderateAir = evaluateForecast(weather, makeAirQuality(weather, 0.2, 25))[0]
    .predictions.sunset_glow.score;
  const hazyAir = evaluateForecast(weather, makeAirQuality(weather, 1.2, 160))[0]
    .predictions.sunset_glow.score;

  assert.ok(
    moderateAir > withoutAir,
    `适度气溶胶应提高晚霞分: ${moderateAir} vs ${withoutAir}`
  );
  assert.ok(hazyAir < withoutAir, `重度灰霾应降低晚霞分: ${hazyAir} vs ${withoutAir}`);
});

test('阵风与垂直层结数据实际改变云海评分', () => {
  const calm = evaluateForecast(makeWeather({ windGusts: 5 }))[0].predictions.cloud_sea.score;
  const gusty = evaluateForecast(makeWeather({ windGusts: 70 }))[0].predictions.cloud_sea.score;

  assert.ok(gusty < calm, `强阵风应压低云海分: ${gusty} vs ${calm}`);
});

test('星空逐时说明只保留时段评价，数据不挤进走势文案', () => {
  const nightHours = evaluateForecast(makeWeather())[0].predictions.starry_sky.hourlyScores.filter(
    (hour) => {
      const hourNum = Number(hour.displayHour.slice(0, 2));
      return hourNum >= 21 || hourNum <= 4;
    }
  );

  assert.ok(nightHours.length > 0);
  for (const hour of nightHours) {
    assert.equal(hour.detail.includes('%'), false, `走势评价不应夹带百分比: ${hour.detail}`);
    assert.ok(
      hour.detail.includes('天文') || hour.detail.includes('暮光') || hour.detail.includes('航海'),
      `缺少时段评价: ${hour.detail}`
    );
  }
  assert.ok(new Set(nightHours.map((hour) => hour.detail)).size > 1);
});

test('各景象小时走势评价是一句描述，不含逐时裸数据', () => {
  const day = evaluateForecast(makeWeather())[0];
  for (const prediction of Object.values(day.predictions)) {
    for (const hour of prediction.hourlyScores) {
      assert.equal(
        /%|km\/h|℃体感/.test(hour.detail),
        false,
        `${prediction.id} ${hour.displayHour}: ${hour.detail}`
      );
    }
  }
});

test('海拔为 0 显示 0 米，海拔缺失才显示未标定且不做层结加分', () => {
  const seaLevel = evaluateForecast(makeWeather({ elevation: 0 }))[0].predictions.cloud_sea;
  const unknown = evaluateForecast(
    makeWeather({ elevation: undefined as unknown as number })
  )[0].predictions.cloud_sea;

  const terrainOf = (prediction: typeof seaLevel): string | undefined =>
    prediction.factors.find((factor) => factor.name.includes('海拔'))?.value;

  assert.equal(terrainOf(seaLevel), '0 米');
  assert.equal(terrainOf(unknown), '未标定');

  const verticalOf = (prediction: typeof seaLevel) =>
    prediction.hourlyScores
      .flatMap((hour) => hour.factors)
      .find((factor) => factor.name.includes('垂直层结'));
  assert.equal(verticalOf(unknown)?.value, '未修正');
  assert.ok(verticalOf(unknown)?.hint.includes('海拔'));
});

test('省略空气质量参数与显式传 null 结果一致', () => {
  const weather = makeWeather();
  assert.deepEqual(evaluateForecast(weather), evaluateForecast(weather, null));
});

test('小时数据为空时不抛错，逐日评分安全降级', () => {
  const evaluations = evaluateForecast(makeWeather({ hourCount: 0 }));

  assert.equal(evaluations.length, 1);
  for (const prediction of Object.values(evaluations[0].predictions)) {
    assert.ok(prediction.score >= 0 && prediction.score <= 100, `${prediction.id}=${prediction.score}`);
    assert.deepEqual(prediction.hourlyScores, []);
  }
});

test('高海拔 1600m：700hPa 真逆温使云海评分高于无 700 字段', () => {
  const alpine = {
    elevation: 1600,
    temperature2m: 0,
    temperature925hPa: 18,
    temperature850hPa: 14,
    windGusts: 8,
    cloudCoverLow: 85,
  };
  const without700 = evaluateForecast(makeWeather(alpine))[0].predictions.cloud_sea;
  const with700 = evaluateForecast(
    makeWeather({ ...alpine, include700hPa: true, temperature700hPa: 4 })
  )[0].predictions.cloud_sea;

  assert.ok(
    with700.score > without700.score,
    `700hPa 逆温应抬高云海分: ${with700.score} vs ${without700.score}`
  );
  const with700Hint = with700.hourlyScores
    .flatMap((hour) => hour.factors)
    .find((factor) => factor.name.includes('垂直层结'))?.hint;
  assert.ok(with700Hint?.includes('700hPa'), with700Hint);
});

test('对流云底哨兵 -500 不得污染平均或产生云底加分文案', () => {
  assert.equal(usableHeightMeters(-500), undefined);
  assert.equal(usableHeightMeters(0), undefined);
  assert.equal(usableHeightMeters(800), 800);

  const allSentinel = evaluateForecast(
    makeWeather({ elevation: 1500, convectiveCloudBase: -500 })
  )[0].predictions.cloud_sea;
  const verticalHints = allSentinel.hourlyScores
    .flatMap((hour) => hour.factors)
    .filter((factor) => factor.name.includes('垂直层结'))
    .map((factor) => factor.hint)
    .join('\n');
  assert.equal(/可俯瞰云海|云底约/.test(verticalHints), false, verticalHints);

  // 清晨 05-08 中三小时哨兵、一小时真实高云底：污染平均会变成假低云底并加分
  const mixedBases = Array.from({ length: 24 }, () => 2000);
  mixedBases[5] = -500;
  mixedBases[6] = -500;
  mixedBases[7] = -500;
  mixedBases[8] = 2000;
  const mixed = evaluateForecast(
    makeWeather({ elevation: 1500, convectiveCloudBase: mixedBases })
  )[0].predictions.cloud_sea;
  const mixedHints = mixed.hourlyScores
    .flatMap((hour) => hour.factors)
    .filter((factor) => factor.name.includes('垂直层结'))
    .map((factor) => factor.hint)
    .join('\n');
  assert.equal(/可俯瞰云海/.test(mixedHints), false, mixedHints);
});

test('除晚霞外当天评分等于分时最高分，逐时成因随小时变化', () => {
  const weather = makeWeather();
  weather.hourly.cloud_cover_low[6] = 90;
  weather.hourly.cloud_cover_low[15] = 5;
  const day = evaluateForecast(weather, makeAirQuality(weather, 0.2, 25))[0];

  for (const prediction of Object.values(day.predictions)) {
    if (prediction.id !== 'sunset_glow') {
      const peak = prediction.hourlyScores.reduce((max, hour) => Math.max(max, hour.score), 0);
      assert.equal(prediction.score, peak, `${prediction.id} 总分应等于分时最高分`);
    }
    for (const hour of prediction.hourlyScores) {
      assert.ok(hour.factors.length > 0, `${prediction.id} ${hour.displayHour} 缺少分时成因`);
    }
  }

  assert.deepEqual(day.predictions.sunrise.factors, []);
  assert.ok(day.predictions.cloud_sea.factors.some((factor) => factor.name.includes('海拔')));
  assert.equal(
    day.predictions.cloud_sea.factors.some((factor) => factor.name.includes('低层云')),
    false
  );

  const scoreAt = (hour: number) =>
    day.predictions.cloud_sea.hourlyScores.find(
      (item) => item.displayHour === `${String(hour).padStart(2, '0')}:00`
    )?.score ?? 0;
  assert.ok(scoreAt(6) > scoreAt(15), `低云 90% 应高于 5%: ${scoreAt(6)} vs ${scoreAt(15)}`);
});

test('低云 50% 即使其余条件很好也不能打到满分', () => {
  const weather = makeWeather({
    elevation: 1558,
    cloudCoverLow: 50,
    windGusts: 6,
  });
  weather.hourly.relative_humidity_2m = weather.hourly.time.map(() => 92);
  weather.hourly.dew_point_2m = weather.hourly.time.map(() => 16);
  weather.hourly.cloud_cover_mid = weather.hourly.time.map(() => 8);
  weather.hourly.cloud_cover_high = weather.hourly.time.map(() => 6);

  const seven = evaluateForecast(weather)[0].predictions.cloud_sea.hourlyScores.find(
    (hour) => hour.displayHour === '07:00'
  );

  assert.ok(seven);
  assert.ok(seven.score <= 60, `50% 低云 7 点不应满分: ${seven.score}`);
  assert.equal(cloudSeaCoverageCeiling(50), 60);
  assert.ok(seven.score <= cloudSeaCoverageCeiling(50));
});
