import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildWeatherForecastUrl,
  buildAirQualityForecastUrl,
  isUsableAirQualityResponse,
  normalizeElevation,
} from './api.ts';

const HANGZHOU = { latitude: 30.2741, longitude: 120.1551 };

function parse(url: string): URL {
  return new URL(url);
}

test('天气 URL：基础地址与经纬度精度', () => {
  const url = parse(buildWeatherForecastUrl(HANGZHOU.latitude, HANGZHOU.longitude));
  assert.equal(url.origin + url.pathname, 'https://api.open-meteo.com/v1/forecast');
  assert.equal(url.searchParams.get('latitude'), '30.2741');
  assert.equal(url.searchParams.get('longitude'), '120.1551');
  assert.equal(url.searchParams.get('timezone'), 'auto');
  assert.equal(url.searchParams.get('forecast_days'), '7');
});

test('天气 URL：包含评分所需的新增小时字段', () => {
  const url = parse(buildWeatherForecastUrl(HANGZHOU.latitude, HANGZHOU.longitude));
  const hourly = (url.searchParams.get('hourly') || '').split(',');

  const required = [
    'wind_gusts_10m',
    'pressure_msl',
    'convective_cloud_base',
    'temperature_925hPa',
    'temperature_850hPa',
    'temperature_700hPa',
    'relative_humidity_925hPa',
    'relative_humidity_850hPa',
    'relative_humidity_700hPa',
    'cloud_cover_925hPa',
    'cloud_cover_850hPa',
    'cloud_cover_700hPa',
  ];
  for (const field of required) {
    assert.ok(hourly.includes(field), `缺少小时字段 ${field}: ${hourly.join(',')}`);
  }
});

test('天气 URL：保留原有小时与逐日字段', () => {
  const url = parse(buildWeatherForecastUrl(HANGZHOU.latitude, HANGZHOU.longitude));
  const hourly = (url.searchParams.get('hourly') || '').split(',');
  const daily = (url.searchParams.get('daily') || '').split(',');

  for (const field of [
    'temperature_2m',
    'relative_humidity_2m',
    'dew_point_2m',
    'apparent_temperature',
    'precipitation_probability',
    'precipitation',
    'weather_code',
    'surface_pressure',
    'cloud_cover',
    'cloud_cover_low',
    'cloud_cover_mid',
    'cloud_cover_high',
    'visibility',
    'wind_speed_10m',
    'wind_direction_10m',
  ]) {
    assert.ok(hourly.includes(field), `缺少原有小时字段 ${field}`);
  }

  for (const field of [
    'weather_code',
    'temperature_2m_max',
    'temperature_2m_min',
    'sunrise',
    'sunset',
    'daylight_duration',
    'sunshine_duration',
    'uv_index_max',
  ]) {
    assert.ok(daily.includes(field), `缺少逐日字段 ${field}`);
  }
});

test('天气 URL：小时字段不重复', () => {
  const hourly = (parse(buildWeatherForecastUrl(HANGZHOU.latitude, HANGZHOU.longitude))
    .searchParams.get('hourly') || '')
    .split(',');
  assert.equal(new Set(hourly).size, hourly.length, `存在重复字段: ${hourly.join(',')}`);
});

test('天气 URL：传入有效海拔时带 elevation', () => {
  const url = parse(buildWeatherForecastUrl(HANGZHOU.latitude, HANGZHOU.longitude, 1518));
  assert.equal(url.searchParams.get('elevation'), '1518');
});

test('天气 URL：海拔为 0 或负值仍视为有效', () => {
  const sea = parse(buildWeatherForecastUrl(HANGZHOU.latitude, HANGZHOU.longitude, 0));
  assert.equal(sea.searchParams.get('elevation'), '0');

  const depression = parse(buildWeatherForecastUrl(HANGZHOU.latitude, HANGZHOU.longitude, -154));
  assert.equal(depression.searchParams.get('elevation'), '-154');
});

test('天气 URL：无效海拔不得写入 elevation', () => {
  for (const bad of [undefined, NaN, Infinity, -Infinity, 99999, -2000]) {
    const url = parse(
      buildWeatherForecastUrl(HANGZHOU.latitude, HANGZHOU.longitude, bad as number | undefined)
    );
    assert.equal(url.searchParams.get('elevation'), null, `海拔 ${String(bad)} 不应写入 URL`);
  }
});

test('空气质量 URL：地址与参数符合弱依赖约定', () => {
  const url = parse(buildAirQualityForecastUrl(HANGZHOU.latitude, HANGZHOU.longitude));
  assert.equal(url.origin + url.pathname, 'https://air-quality-api.open-meteo.com/v1/air-quality');
  assert.equal(url.searchParams.get('latitude'), '30.2741');
  assert.equal(url.searchParams.get('longitude'), '120.1551');
  assert.equal(url.searchParams.get('hourly'), 'pm2_5,aerosol_optical_depth');
  assert.equal(url.searchParams.get('timezone'), 'auto');
  assert.equal(url.searchParams.get('forecast_days'), '7');
});

test('空气质量响应校验：含 hourly.time 数组视为可用', () => {
  assert.equal(
    isUsableAirQualityResponse({
      latitude: 30.2741,
      longitude: 120.1551,
      hourly: { time: ['2024-01-25T18:00'], pm2_5: [30], aerosol_optical_depth: [0.2] },
    }),
    true
  );
  // 空数组仍是结构合法的响应，只是没有可用小时
  assert.equal(isUsableAirQualityResponse({ hourly: { time: [] } }), true);
});

test('空气质量响应校验：结构缺失一律视为不可用', () => {
  for (const bad of [
    undefined,
    null,
    'ok',
    42,
    {},
    { hourly: null },
    { hourly: {} },
    { hourly: { time: null } },
    { hourly: { time: '2024-01-25T18:00' } },
    { hourly: { time: { 0: '2024-01-25T18:00' } } },
  ]) {
    assert.equal(isUsableAirQualityResponse(bad), false, `${JSON.stringify(bad)} 应视为不可用`);
  }
});

test('地理编码海拔规范化：0 保留', () => {
  assert.equal(normalizeElevation(0), 0);
});

test('地理编码海拔规范化：负值保留', () => {
  assert.equal(normalizeElevation(-154), -154);
});

test('地理编码海拔规范化：无效值返回 undefined', () => {
  for (const bad of [undefined, NaN, Infinity, -Infinity, 99999, -2000]) {
    assert.equal(
      normalizeElevation(bad as number | undefined),
      undefined,
      `海拔 ${String(bad)} 应规范化为 undefined`
    );
  }
});

test('地理编码海拔规范化：有效值取整', () => {
  assert.equal(normalizeElevation(1518.4), 1518);
  assert.equal(normalizeElevation(-153.6), -154);
});

test('URL 构造为纯函数：同输入同输出', () => {
  assert.equal(
    buildWeatherForecastUrl(HANGZHOU.latitude, HANGZHOU.longitude, 1518),
    buildWeatherForecastUrl(HANGZHOU.latitude, HANGZHOU.longitude, 1518)
  );
  assert.equal(
    buildAirQualityForecastUrl(HANGZHOU.latitude, HANGZHOU.longitude),
    buildAirQualityForecastUrl(HANGZHOU.latitude, HANGZHOU.longitude)
  );
});
