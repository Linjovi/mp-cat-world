import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import type { EvaluationContext, HourSlice } from './context.ts';

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

const { evaluateSunsetAerosolAdjustment, evaluateSunsetGlow } = await import('./sunsetGlow.ts');

function hour(hourNum: number, patch: Partial<HourSlice> = {}): HourSlice {
  return {
    time: `2024-01-25T${String(hourNum).padStart(2, '0')}:00`,
    hourIndex: hourNum,
    hourNum,
    temp: 16,
    humidity: 50,
    dewPoint: 6,
    precipProb: 0,
    precip: 0,
    code: 1,
    cloudTotal: 40,
    cloudLow: 0,
    cloudMid: 0,
    cloudHigh: 0,
    visibilityKm: 30,
    windSpeed: 3,
    ...patch,
  };
}

function day(patch: Partial<HourSlice> = {}, sunset = '17:30'): EvaluationContext {
  return {
    dateStr: '2024-01-25',
    sunriseTime: '06:50',
    sunsetTime: sunset,
    latitude: 30.25,
    longitude: 120.17,
    hourly: Array.from({ length: 24 }, (_, hourNum) => hour(hourNum, patch)),
  };
}

function scoreOf(patch: Partial<HourSlice>): number {
  return evaluateSunsetGlow(day(patch)).score;
}

test('理想云况到极佳，只有高云仍是高分，晴空停在普通日落', () => {
  const ideal = evaluateSunsetGlow(day({ cloudHigh: 42, cloudMid: 35, cloudLow: 0 }));
  const highOnly = evaluateSunsetGlow(day({ cloudHigh: 39, cloudMid: 0, cloudLow: 5 }));
  const clear = evaluateSunsetGlow(day({ cloudHigh: 0, cloudMid: 0, cloudLow: 0 }));

  assert.ok(ideal.score >= 90, `理想云况应接近满分，实际 ${ideal.score}`);
  assert.equal(ideal.level, 'excellent');
  assert.ok(highOnly.score >= 70, `只有高云不应再被砍到六十出头，实际 ${highOnly.score}`);
  assert.ok(highOnly.score > clear.score + 15, `只有高云应明显高于晴空: ${highOnly.score} vs ${clear.score}`);
  assert.ok(clear.score >= 35 && clear.score <= 55, `晴空应是普通日落，实际 ${clear.score}`);
  assert.equal(clear.level, 'moderate');
});

test('低云或中云接近满云时连续压低，晴空仍高于阴天', () => {
  const blocked = evaluateSunsetGlow(day({ cloudLow: 90, cloudMid: 80, cloudHigh: 42 }));
  const thickMid = evaluateSunsetGlow(day({ cloudLow: 20, cloudMid: 90, cloudHigh: 42 }));
  const openMid = evaluateSunsetGlow(day({ cloudLow: 20, cloudMid: 35, cloudHigh: 42 }));
  const clear = evaluateSunsetGlow(day({ cloudHigh: 0, cloudMid: 0, cloudLow: 0 }));

  assert.ok(blocked.score < 25, `低云中云都很厚应接近看不成，实际 ${blocked.score}`);
  assert.equal(blocked.level, 'poor');
  assert.ok(thickMid.score < openMid.score - 15, `中云过厚应明显低于适量中云: ${thickMid.score} vs ${openMid.score}`);
  assert.ok(clear.score > blocked.score + 15, `普通晴空应高于阴天: ${clear.score} vs ${blocked.score}`);
});

test('高云在甜点、中云很厚、低云很少时不应塌成差天', () => {
  const thickMidHighCanvas = evaluateSunsetGlow(
    day({ cloudHigh: 52, cloudMid: 94, cloudLow: 0, aod: 0.12, visibilityKm: 10 }),
  );
  const clear = evaluateSunsetGlow(day({ cloudHigh: 0, cloudMid: 0, cloudLow: 0, visibilityKm: 10 }));

  assert.ok(
    thickMidHighCanvas.score >= 55,
    `厚中云不该把高云甜点核打穿，实际 ${thickMidHighCanvas.score}`,
  );
  assert.ok(
    thickMidHighCanvas.level === 'good' || thickMidHighCanvas.level === 'excellent',
    `档位应至少是良好，实际 ${thickMidHighCanvas.level} ${thickMidHighCanvas.score}`,
  );
  assert.ok(
    thickMidHighCanvas.score > clear.score,
    `这种天应高于晴空普通日落: ${thickMidHighCanvas.score} vs ${clear.score}`,
  );
});

test('日评分取日落时刻插值，不取旁边整点的最高分', () => {
  const hourly = Array.from({ length: 24 }, (_, hourNum) => {
    if (hourNum === 17) return hour(17, { cloudHigh: 42, cloudMid: 35, cloudLow: 0 });
    if (hourNum === 18) return hour(18, { cloudHigh: 0, cloudMid: 100, cloudLow: 100 });
    return hour(hourNum, { cloudHigh: 0, cloudMid: 0, cloudLow: 100 });
  });
  const result = evaluateSunsetGlow({
    dateStr: '2024-01-25',
    sunriseTime: '06:50',
    sunsetTime: '17:30',
    latitude: 30,
    longitude: 120,
    hourly,
  });
  const at17 = result.hourlyScores.find((item) => item.displayHour === '17:00');

  assert.ok(at17 && at17.score > 85, `17 点整点应仍是高分，实际 ${at17?.score}`);
  assert.ok(result.score < 55, `日落时刻应落在两个整点之间，实际 ${result.score}`);
  assert.notEqual(result.score, at17?.score);
});

test('降水概率本身不压分，实况降水打折，雷暴压得更低', () => {
  const chance = scoreOf({ cloudHigh: 42, cloudMid: 35, cloudLow: 0, precipProb: 60 });
  const raining = scoreOf({ cloudHigh: 42, cloudMid: 35, cloudLow: 0, precip: 1.2, precipProb: 80 });
  const storm = scoreOf({ cloudHigh: 42, cloudMid: 35, cloudLow: 0, code: 95 });
  const dry = scoreOf({ cloudHigh: 42, cloudMid: 35, cloudLow: 0 });

  assert.equal(chance, dry);
  assert.ok(raining < chance - 8, `实况降水应打折，不应只靠概率: ${raining} vs ${chance}`);
  assert.ok(raining > 45, `小雨不应再硬封到 40 分，实际 ${raining}`);
  assert.ok(storm < raining, `雷暴应低于普通降水: ${storm} vs ${raining}`);
  assert.ok(storm < 40, `雷暴应明显压低，实际 ${storm}`);
});

test('有 AOD 时不再叠加 PM2.5', () => {
  const moderate = evaluateSunsetAerosolAdjustment({ aerosolOpticalDepth: 0.2, pm2_5: 180 });
  const moderateOnly = evaluateSunsetAerosolAdjustment({ aerosolOpticalDepth: 0.2 });
  const hazy = evaluateSunsetAerosolAdjustment({ aerosolOpticalDepth: 1.2, pm2_5: 10 });
  const pmOnly = evaluateSunsetAerosolAdjustment({ pm2_5: 180 });
  const missing = evaluateSunsetAerosolAdjustment({});

  assert.equal(moderate.delta, moderateOnly.delta);
  assert.ok(moderate.delta > 6 && moderate.delta <= 7, `AOD 0.2 应接近峰值，实际 ${moderate.delta}`);
  assert.equal(hazy.delta, -12);
  assert.ok(pmOnly.delta < 0);
  assert.equal(missing.delta, 0);

  const withBoth = scoreOf({ cloudHigh: 42, cloudMid: 35, cloudLow: 0, aod: 0.2, pm2_5: 180 });
  const withAod = scoreOf({ cloudHigh: 42, cloudMid: 35, cloudLow: 0, aod: 0.2, pm2_5: 10 });
  assert.equal(withBoth, withAod);
});

test('气溶胶、能见度、湿度、降水、中云差 1 个单位时分数连续', () => {
  const aod30 = evaluateSunsetAerosolAdjustment({ aerosolOpticalDepth: 0.3 }).delta;
  const aod31 = evaluateSunsetAerosolAdjustment({ aerosolOpticalDepth: 0.31 }).delta;
  assert.ok(Math.abs(aod30 - aod31) < 1, `AOD 0.30/0.31 跳了 ${aod30} → ${aod31}`);

  const pm75 = evaluateSunsetAerosolAdjustment({ pm2_5: 75 }).delta;
  const pm76 = evaluateSunsetAerosolAdjustment({ pm2_5: 76 }).delta;
  assert.ok(Math.abs(pm75 - pm76) < 1, `PM2.5 75/76 跳了 ${pm75} → ${pm76}`);

  const vis19 = scoreOf({ cloudHigh: 42, cloudMid: 35, cloudLow: 0, visibilityKm: 19 });
  const vis20 = scoreOf({ cloudHigh: 42, cloudMid: 35, cloudLow: 0, visibilityKm: 20 });
  assert.ok(Math.abs(vis19 - vis20) <= 3, `能见度 19/20km 跳了 ${vis19} → ${vis20}`);

  const rh39 = scoreOf({ cloudHigh: 42, cloudMid: 35, cloudLow: 0, humidity: 39 });
  const rh40 = scoreOf({ cloudHigh: 42, cloudMid: 35, cloudLow: 0, humidity: 40 });
  assert.ok(Math.abs(rh39 - rh40) <= 2, `湿度 39/40 跳了 ${rh39} → ${rh40}`);

  const rain05 = scoreOf({ cloudHigh: 42, cloudMid: 35, cloudLow: 0, precip: 0.5 });
  const rain06 = scoreOf({ cloudHigh: 42, cloudMid: 35, cloudLow: 0, precip: 0.6 });
  assert.ok(Math.abs(rain05 - rain06) <= 3, `降水 0.5/0.6mm 跳了 ${rain05} → ${rain06}`);

  const mid79 = scoreOf({ cloudHigh: 42, cloudMid: 79, cloudLow: 10 });
  const mid81 = scoreOf({ cloudHigh: 42, cloudMid: 81, cloudLow: 10 });
  assert.ok(Math.abs(mid79 - mid81) <= 6, `中云 79/81 跳了 ${mid79} → ${mid81}`);
});

test('日综合因子包含观赏窗口、云幕结构与通透散射，且提示文案准确', () => {
  const result = evaluateSunsetGlow(
    day({ cloudHigh: 42, cloudMid: 70, cloudLow: 5, aod: 0.18, visibilityKm: 25 })
  );

  assert.equal(result.factors.length, 3);
  assert.ok(result.factors.some((f) => f.name === '受光观赏窗口时长'));
  assert.ok(result.factors.some((f) => f.name === '落日云幕结构'));
  assert.ok(result.factors.some((f) => f.name === '大气通透与霞色散射'));

  const cloudStructure = result.factors.find((f) => f.name === '落日云幕结构');
  assert.equal(cloudStructure?.value, '高42% · 中70% · 低5%');

  // 验证逐时因子中文案分支准确性
  const sunsetHour = result.hourlyScores[17];
  const midFactor = sunsetHour.factors.find((f) => f.name === '中云纹理');
  assert.ok(midFactor?.hint.includes('偏多') || midFactor?.hint.includes('遮挡'), `70% 中云不应判定为偏少: ${midFactor?.hint}`);

  const thinHighResult = evaluateSunsetGlow(day({ cloudHigh: 15, cloudMid: 20, cloudLow: 0 }));
  const thinHighFactor = thinHighResult.hourlyScores[17].factors.find((f) => f.name === '高云幕布');
  assert.ok(!thinHighFactor?.hint.includes('偏厚'), `15% 高云不应判定为偏厚: ${thinHighFactor?.hint}`);
});

