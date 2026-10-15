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

const { evaluateCloudSea, evaluateCloudSeaPressureHumidity, cloudSeaObservationWindow } = await import('./cloudSea.ts');

test('1558m：山腰湿、头顶干，高于三层都湿', () => {
  const layered = evaluateCloudSeaPressureHumidity({
    elevation: 1558,
    pressureMsl: 1018,
    rh925: 96,
    rh850: 55,
    rh700: 30,
  });
  const saturated = evaluateCloudSeaPressureHumidity({
    elevation: 1558,
    pressureMsl: 1018,
    rh925: 99,
    rh850: 99,
    rh700: 99,
  });
  assert.ok(layered.delta > saturated.delta, `${layered.delta} vs ${saturated.delta}`);
  assert.match(layered.note, /925hPa 96%/);
  assert.match(layered.note, /850hPa 55%/);
  assert.match(layered.note, /700hPa 30%/);
  assert.ok(saturated.delta > 0, String(saturated.delta));
  assert.ok(saturated.delta <= 2, String(saturated.delta));
});

test('三层都干时减分；缺 925 仍使用 850 和 700', () => {
  const dry = evaluateCloudSeaPressureHumidity({
    elevation: 1558,
    pressureMsl: 1018,
    rh925: 30,
    rh850: 32,
    rh700: 20,
  });
  assert.ok(dry.delta < 0, String(dry.delta));
  assert.match(dry.note, /925hPa 30%/);
  assert.match(dry.note, /700hPa 20%/);

  const partial = evaluateCloudSeaPressureHumidity({
    elevation: 1558,
    pressureMsl: 1018,
    rh850: 92,
    rh700: 40,
  });
  assert.match(partial.note, /850hPa 92%/);
  assert.match(partial.note, /700hPa 40%/);
  assert.equal(partial.note.includes('925hPa'), false, partial.note);
  assert.ok(partial.delta > 0, partial.note);
});

test('三层湿度都缺时不修正', () => {
  const none = evaluateCloudSeaPressureHumidity({ elevation: 1558, pressureMsl: 1018 });
  assert.equal(none.delta, 0);
  assert.match(none.note, /缺失/);
});

test('没有海拔时仍列出三层，不退回只看 925', () => {
  const profile = evaluateCloudSeaPressureHumidity({
    rh925: 96,
    rh850: 40,
    rh700: 30,
  });
  assert.match(profile.note, /925hPa 96%/);
  assert.match(profile.note, /850hPa 40%/);
  assert.match(profile.note, /700hPa 30%/);
});

function hour(hourNum: number, patch: Partial<HourSlice> = {}): HourSlice {
  return {
    time: `2024-01-25T${String(hourNum).padStart(2, '0')}:00`,
    hourIndex: hourNum,
    hourNum,
    temp: 12,
    humidity: 88,
    dewPoint: 10,
    precipProb: 0,
    precip: 0,
    code: 45,
    cloudTotal: 80,
    cloudLow: 85,
    cloudMid: 10,
    cloudHigh: 10,
    visibilityKm: 16,
    windSpeed: 6,
    gusts: 10,
    pressureMsl: 1018,
    relativeHumidity925: 96,
    relativeHumidity850: 55,
    relativeHumidity700: 30,
    ...patch,
  };
}

test('能见度只加减分，不把云海分数封到上下限', () => {
  const scoreOf = (patch: Partial<HourSlice>) =>
    evaluateCloudSea({
      dateStr: '2024-01-25',
      sunriseTime: '06:20',
      sunsetTime: '17:30',
      elevation: 1558,
      latitude: 30.12,
      longitude: 118.91,
      hourly: [hour(12, patch)],
    }).hourlyScores[0].score;

  const calm = { cloudLow: 40, humidity: 60, code: 1, dewPoint: 4 };
  const clear = scoreOf({ ...calm, visibilityKm: 20 });
  const fog = scoreOf({ ...calm, visibilityKm: 0 });
  const poorClear = scoreOf({ ...calm, cloudLow: 5, humidity: 40, visibilityKm: 20 });
  const poorFog = scoreOf({ ...calm, cloudLow: 5, humidity: 40, visibilityKm: 0 });

  assert.ok(clear > fog);
  assert.equal(clear - fog, poorClear - poorFog);
  assert.ok(fog > 0);
  assert.ok(poorFog > 0);
  assert.ok(poorClear < 100);
  assert.ok(clear < 100);
});

test('最佳窗口覆盖分时最高的 4 点和 5 点', () => {
  const span = cloudSeaObservationWindow([
    { hourNum: 4, score: 70 },
    { hourNum: 5, score: 72 },
    { hourNum: 6, score: 40 },
    { hourNum: 7, score: 36 },
    { hourNum: 8, score: 30 },
  ]);
  assert.equal(span.start, '04:00');
  assert.equal(span.end, '06:00');
  assert.equal(span.minutes, 120);

  const prediction = evaluateCloudSea({
    dateStr: '2026-10-16',
    sunriseTime: '06:07',
    sunsetTime: '17:32',
    elevation: 1558,
    latitude: 30.12,
    longitude: 118.91,
    hourly: Array.from({ length: 24 }, (_, hourNum) =>
      hour(
        hourNum,
        hourNum === 4 || hourNum === 5
          ? { cloudLow: 90, humidity: 95, dewPoint: 11, code: 1 }
          : { cloudLow: 5, humidity: 40, dewPoint: 2, code: 1 }
      )
    ),
  });
  assert.equal(prediction.bestTimeShort, '04:00 - 06:00');
  assert.equal(prediction.bestTimeWindow.includes('05:27'), false);
  assert.equal(prediction.bestTimeWindow.includes('09:07'), false);
});
