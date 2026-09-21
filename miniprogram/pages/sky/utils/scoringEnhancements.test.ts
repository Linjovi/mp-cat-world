import test from 'node:test';
import assert from 'node:assert/strict';

import {
  approximatePressureLevelAltitude,
  evaluateCloudSeaVerticalAdjustment,
  evaluateSunsetAerosolAdjustment,
  evaluateMoonlightImpact,
  evaluateHikingComfortAdjustment,
  CLOUD_SEA_ADJUSTMENT_RANGE,
  AEROSOL_ADJUSTMENT_RANGE,
  HIKING_ADJUSTMENT_RANGE,
} from './scoringEnhancements.ts';

test('approximatePressureLevelAltitude 近似标准大气层高', () => {
  assert.ok(Math.abs(approximatePressureLevelAltitude(925) - 762) < 15);
  assert.ok(Math.abs(approximatePressureLevelAltitude(850) - 1457) < 20);
  // 高压天气下同一气压层被抬高
  assert.ok(approximatePressureLevelAltitude(925, 1030) > approximatePressureLevelAltitude(925, 1013.25));
});

test('云海修正：正常温度递减不算逆温', () => {
  const result = evaluateCloudSeaVerticalAdjustment({
    surfaceTemperature: 20,
    temperature925hPa: 15,
    temperature850hPa: 10.5,
    observerElevation: 0,
  });
  assert.equal(result.inversionDetected, false);
  assert.equal(result.delta, 0);
  assert.ok(result.notes.length > 0);
});

test('云海修正：真实逆温加分', () => {
  const result = evaluateCloudSeaVerticalAdjustment({
    surfaceTemperature: 5,
    temperature925hPa: 12,
    temperature850hPa: 10,
    observerElevation: 0,
  });
  assert.equal(result.inversionDetected, true);
  assert.ok(result.delta > 0);
  assert.ok(result.inversionStrength > 0);
});

test('云海修正：观测点高于气压层时不得误判为逆温', () => {
  // 观测点海拔 2000m，高于 925/850 hPa 近似高度，下方空气更暖属于正常现象
  const result = evaluateCloudSeaVerticalAdjustment({
    surfaceTemperature: 2,
    temperature925hPa: 14,
    temperature850hPa: 10,
    observerElevation: 2000,
  });
  assert.equal(result.inversionDetected, false);
  assert.equal(result.delta, 0);
});

test('云海修正：缺观测点海拔时不得依据气压层加分', () => {
  // 没有观测点海拔就无法判断哪些气压层位于观测点上方，必须降级而不是给出层结加分
  const inversionLike = evaluateCloudSeaVerticalAdjustment({
    temperature925hPa: 5,
    temperature850hPa: 12,
  });
  assert.equal(inversionLike.delta, 0);
  assert.equal(inversionLike.inversionDetected, false);
  assert.equal(inversionLike.inversionStrength, 0);

  const stableLike = evaluateCloudSeaVerticalAdjustment({
    temperature925hPa: 12,
    temperature850hPa: 10,
  });
  assert.equal(stableLike.delta, 0);
  assert.equal(stableLike.inversionDetected, false);

  const withSurface = evaluateCloudSeaVerticalAdjustment({
    surfaceTemperature: 5,
    temperature925hPa: 12,
    temperature850hPa: 10,
  });
  assert.equal(withSurface.delta, 0);
  assert.equal(withSurface.inversionDetected, false);
  assert.ok(withSurface.notes.some((n) => n.includes('海拔')));
});

test('云海修正：缺观测点海拔时阵风扣分仍然生效', () => {
  const result = evaluateCloudSeaVerticalAdjustment({
    temperature925hPa: 5,
    temperature850hPa: 12,
    windGusts: 60,
  });
  assert.ok(result.delta < 0);
  assert.equal(result.inversionDetected, false);
});

test('云海修正：云底修正需声明高度基准假设', () => {
  const result = evaluateCloudSeaVerticalAdjustment({
    observerElevation: 1500,
    convectiveCloudBase: 800,
  });
  assert.equal(result.cloudBaseBelowObserver, true);
  assert.ok(result.notes.some((n) => n.includes('AMSL')), result.notes.join(' | '));
});

test('云海修正：云底哨兵值 -500 与 0 视为无对流云', () => {
  for (const sentinel of [-500, 0]) {
    const result = evaluateCloudSeaVerticalAdjustment({
      observerElevation: 1500,
      convectiveCloudBase: sentinel,
    });
    assert.equal(result.cloudBaseBelowObserver, null, `sentinel=${sentinel}`);
    assert.equal(result.delta, 0, `sentinel=${sentinel}`);
    assert.ok(
      !result.notes.some((n) => n.includes('俯瞰')),
      `sentinel=${sentinel} 不应出现俯瞰云海文案: ${result.notes.join(' | ')}`
    );
  }
});

test('云海修正：云底哨兵值不影响其他修正', () => {
  const result = evaluateCloudSeaVerticalAdjustment({
    observerElevation: 1500,
    convectiveCloudBase: -500,
    windGusts: 60,
  });
  assert.equal(result.cloudBaseBelowObserver, null);
  assert.ok(result.delta < 0);
});

test('云海修正：高海拔观测点使用 700hPa 识别逆温', () => {
  // 观测点 1600m 高于 925/850 近似高度，这两层位于地表以下，必须被过滤
  const result = evaluateCloudSeaVerticalAdjustment({
    surfaceTemperature: 0,
    temperature925hPa: 18,
    temperature850hPa: 14,
    temperature700hPa: 4,
    observerElevation: 1600,
  });
  assert.equal(result.inversionDetected, true);
  assert.ok(result.delta > 0);
  assert.ok(
    result.notes.some((n) => n.includes('700hPa')),
    result.notes.join(' | ')
  );
  assert.ok(
    !result.notes.some((n) => n.includes('925hPa') || n.includes('850hPa')),
    `地表以下的气压层不得参与层结判断: ${result.notes.join(' | ')}`
  );
});

test('云海修正：高海拔观测点 700hPa 正常递减不误判', () => {
  const result = evaluateCloudSeaVerticalAdjustment({
    surfaceTemperature: 10,
    temperature925hPa: 18,
    temperature850hPa: 14,
    // 1600m -> 约 3013m 按 6.5°C/km 正常递减
    temperature700hPa: 10 - 6.5 * 1.413,
    observerElevation: 1600,
  });
  assert.equal(result.inversionDetected, false);
  assert.equal(result.delta, 0);
});

test('云海修正：700hPa 近似高度合理且缺观测点海拔时仍不加分', () => {
  assert.ok(Math.abs(approximatePressureLevelAltitude(700) - 3013) < 30);
  const noElevation = evaluateCloudSeaVerticalAdjustment({
    surfaceTemperature: 0,
    temperature700hPa: 4,
  });
  assert.equal(noElevation.delta, 0);
  assert.equal(noElevation.inversionDetected, false);
});

test('云海修正：低海拔时 700hPa 不掩盖近地层结', () => {
  // 近地 925 逆温应被优先识别，而不是被更高层的正常递减稀释
  const result = evaluateCloudSeaVerticalAdjustment({
    surfaceTemperature: 5,
    temperature925hPa: 12,
    temperature850hPa: 10,
    temperature700hPa: 0,
    observerElevation: 0,
  });
  assert.equal(result.inversionDetected, true);
  assert.ok(result.delta > 0);
});

test('云海修正：云底低于观测点比云底高于观测点得分更高', () => {
  const base = {
    surfaceTemperature: 5,
    temperature925hPa: 12,
    temperature850hPa: 10,
    observerElevation: 1500,
  };
  const below = evaluateCloudSeaVerticalAdjustment({ ...base, convectiveCloudBase: 800 });
  const above = evaluateCloudSeaVerticalAdjustment({ ...base, convectiveCloudBase: 2600 });
  assert.ok(below.delta > above.delta);
  assert.equal(below.cloudBaseBelowObserver, true);
  assert.equal(above.cloudBaseBelowObserver, false);
});

test('云海修正：强阵风扣分', () => {
  const calm = evaluateCloudSeaVerticalAdjustment({
    surfaceTemperature: 5,
    temperature925hPa: 12,
    temperature850hPa: 10,
    observerElevation: 0,
    windGusts: 5,
  });
  const gusty = evaluateCloudSeaVerticalAdjustment({
    surfaceTemperature: 5,
    temperature925hPa: 12,
    temperature850hPa: 10,
    observerElevation: 0,
    windGusts: 60,
  });
  assert.ok(gusty.delta < calm.delta);
});

test('云海修正：缺失数据返回 0 且有解释', () => {
  const result = evaluateCloudSeaVerticalAdjustment({});
  assert.equal(result.delta, 0);
  assert.equal(result.inversionDetected, false);
  assert.equal(result.cloudBaseBelowObserver, null);
  assert.ok(result.notes.length > 0);
});

test('云海修正：极端输入仍落在限定区间', () => {
  const extreme = evaluateCloudSeaVerticalAdjustment({
    surfaceTemperature: -40,
    temperature925hPa: 40,
    temperature850hPa: 60,
    observerElevation: 0,
    convectiveCloudBase: 0,
    windGusts: 0,
  });
  assert.ok(extreme.delta <= CLOUD_SEA_ADJUSTMENT_RANGE.max);
  assert.ok(extreme.delta >= CLOUD_SEA_ADJUSTMENT_RANGE.min);

  const worst = evaluateCloudSeaVerticalAdjustment({
    surfaceTemperature: 40,
    temperature925hPa: -20,
    temperature850hPa: -60,
    observerElevation: 0,
    convectiveCloudBase: 9000,
    windGusts: 200,
  });
  assert.ok(worst.delta >= CLOUD_SEA_ADJUSTMENT_RANGE.min);
  assert.ok(worst.delta <= CLOUD_SEA_ADJUSTMENT_RANGE.max);
});

test('晚霞气溶胶修正：缺失数据返回 0', () => {
  const result = evaluateSunsetAerosolAdjustment({});
  assert.equal(result.delta, 0);
  assert.ok(result.notes.length > 0);
});

test('晚霞气溶胶修正：适度气溶胶小幅加分', () => {
  const result = evaluateSunsetAerosolAdjustment({ aerosolOpticalDepth: 0.2, pm2_5: 20 });
  assert.ok(result.delta > 0);
  assert.ok(result.delta <= AEROSOL_ADJUSTMENT_RANGE.max);
});

test('晚霞气溶胶修正：极干净空气不加不减', () => {
  const result = evaluateSunsetAerosolAdjustment({ aerosolOpticalDepth: 0.02, pm2_5: 5 });
  assert.equal(result.delta, 0);
});

test('晚霞气溶胶修正：灰霾扣分', () => {
  const highAod = evaluateSunsetAerosolAdjustment({ aerosolOpticalDepth: 1.2 });
  assert.ok(highAod.delta < 0);

  const highPm = evaluateSunsetAerosolAdjustment({ pm2_5: 150 });
  assert.ok(highPm.delta < 0);

  const both = evaluateSunsetAerosolAdjustment({ aerosolOpticalDepth: 1.5, pm2_5: 300 });
  assert.ok(both.delta >= AEROSOL_ADJUSTMENT_RANGE.min);
  assert.ok(both.delta < highPm.delta);
});

test('月亮照度影响：满月当地午夜高悬且惩罚显著', () => {
  const result = evaluateMoonlightImpact({
    isoTime: '2024-01-25T00:00',
    latitude: 30.25,
    longitude: 120.17,
    illuminationPct: 100,
    utcOffsetHours: 8,
  });
  assert.equal(result.isAboveHorizon, true);
  assert.ok(result.altitudeDeg > 40, `altitude=${result.altitudeDeg}`);
  assert.ok(result.penalty > 15);
});

test('月亮照度影响：满月当地正午在地平线下且惩罚为 0', () => {
  const result = evaluateMoonlightImpact({
    isoTime: '2024-01-25T12:00',
    latitude: 30.25,
    longitude: 120.17,
    illuminationPct: 100,
    utcOffsetHours: 8,
  });
  assert.equal(result.isAboveHorizon, false);
  assert.ok(result.altitudeDeg < 0, `altitude=${result.altitudeDeg}`);
  assert.equal(result.penalty, 0);
});

test('月亮照度影响：新月当地午夜在地平线下', () => {
  const result = evaluateMoonlightImpact({
    isoTime: '2024-01-11T00:00',
    latitude: 30.25,
    longitude: 120.17,
    illuminationPct: 1,
    utcOffsetHours: 8,
  });
  assert.equal(result.isAboveHorizon, false);
  assert.equal(result.penalty, 0);
});

test('月亮照度影响：照度越高惩罚越大', () => {
  const input = {
    isoTime: '2024-01-25T00:00',
    latitude: 30.25,
    longitude: 120.17,
    utcOffsetHours: 8,
  };
  const crescent = evaluateMoonlightImpact({ ...input, illuminationPct: 20 });
  const full = evaluateMoonlightImpact({ ...input, illuminationPct: 100 });
  assert.ok(full.penalty > crescent.penalty);

  const dark = evaluateMoonlightImpact({ ...input, illuminationPct: 0 });
  assert.equal(dark.penalty, 0);
});

test('月亮照度影响：缺省时区按经度近似且高度有效', () => {
  const result = evaluateMoonlightImpact({
    isoTime: '2024-01-25T00:00',
    latitude: 30.25,
    longitude: 120.17,
    illuminationPct: 100,
  });
  assert.ok(result.altitudeDeg >= -90 && result.altitudeDeg <= 90);
  assert.equal(result.isAboveHorizon, result.altitudeDeg > 0);
});

test('月亮照度影响：非法时间返回安全默认值', () => {
  const result = evaluateMoonlightImpact({
    isoTime: 'not-a-time',
    latitude: 30.25,
    longitude: 120.17,
    illuminationPct: 100,
  });
  assert.equal(result.penalty, 0);
  assert.equal(result.isAboveHorizon, false);
  assert.equal(result.altitudeDeg, 0);
});

test('徒步体感修正：缺失数据返回 0', () => {
  const result = evaluateHikingComfortAdjustment({});
  assert.equal(result.delta, 0);
  assert.ok(result.notes.length > 0);
});

test('徒步体感修正：舒适体感加分，酷热严寒扣分', () => {
  assert.ok(evaluateHikingComfortAdjustment({ apparentTemperature: 18 }).delta > 0);
  assert.ok(evaluateHikingComfortAdjustment({ apparentTemperature: 36 }).delta < 0);
  assert.ok(evaluateHikingComfortAdjustment({ apparentTemperature: -15 }).delta < 0);
});

test('徒步体感修正：大阵风扣分且落在限定区间', () => {
  const calm = evaluateHikingComfortAdjustment({ apparentTemperature: 18, windGusts: 5 });
  const gusty = evaluateHikingComfortAdjustment({ apparentTemperature: 18, windGusts: 70 });
  assert.ok(gusty.delta < calm.delta);
  assert.ok(gusty.delta >= HIKING_ADJUSTMENT_RANGE.min);

  const worst = evaluateHikingComfortAdjustment({ apparentTemperature: 45, windGusts: 200 });
  assert.ok(worst.delta >= HIKING_ADJUSTMENT_RANGE.min);
  const best = evaluateHikingComfortAdjustment({ apparentTemperature: 18, windGusts: 0 });
  assert.ok(best.delta <= HIKING_ADJUSTMENT_RANGE.max);
});

test('徒步体感修正：缺体感温时回退到实际气温', () => {
  const fallback = evaluateHikingComfortAdjustment({ temperature: 18 });
  assert.ok(fallback.delta > 0);
});

test('所有修正函数均为纯函数（同输入同输出）', () => {
  const cloudInput = {
    surfaceTemperature: 5,
    temperature925hPa: 12,
    temperature850hPa: 10,
    observerElevation: 1000,
    convectiveCloudBase: 700,
    windGusts: 12,
  };
  assert.deepEqual(
    evaluateCloudSeaVerticalAdjustment(cloudInput),
    evaluateCloudSeaVerticalAdjustment(cloudInput)
  );
  assert.deepEqual(
    evaluateSunsetAerosolAdjustment({ aerosolOpticalDepth: 0.3, pm2_5: 40 }),
    evaluateSunsetAerosolAdjustment({ aerosolOpticalDepth: 0.3, pm2_5: 40 })
  );
  assert.deepEqual(
    evaluateHikingComfortAdjustment({ apparentTemperature: 22, windGusts: 20 }),
    evaluateHikingComfortAdjustment({ apparentTemperature: 22, windGusts: 20 })
  );
});
