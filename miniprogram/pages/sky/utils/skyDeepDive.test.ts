import test from 'node:test';
import assert from 'node:assert/strict';
import { decorateSkyHour, getSkyInsightMeta } from './skyDeepDive.ts';
import type { SkyHourSource } from './skyDeepDive.ts';

const hour: SkyHourSource = {
  timeStr: '06:00',
  fullTime: '2026-09-21T06:00',
  hourNum: 6,
  temp: 18,
  humidity: 88,
  windSpeed: 8,
  visibilityKm: 16,
  cloudLow: 72,
  cloudMid: 20,
  cloudHigh: 10,
  cloudTotal: 40,
  precipProb: 12,
  apparentTemp: 17,
  gusts: 14,
};

test('不同景象使用不同剖析标题', () => {
  assert.match(getSkyInsightMeta('travel_weather').title, /体感/);
  assert.match(getSkyInsightMeta('cloud_sea').title, /分层云量/);
  assert.match(getSkyInsightMeta('sunrise').title, /日出/);
  assert.match(getSkyInsightMeta('sunset_glow').title, /晚霞/);
});

test('徒步标签不含已在柱状图里的降水和湿度', () => {
  const dive = decorateSkyHour('travel_weather', hour);
  assert.ok(dive.metrics.some((m) => m.name === '体感' && m.value === '17°C'));
  assert.equal(dive.metrics.some((m) => /降水|湿度/.test(m.name)), false);
  assert.ok(dive.layers.some((layer) => layer.kind === 'precip' && layer.pct === 12));
  assert.ok(dive.layers.every((layer) => layer.kind !== 'low-cloud'));
  assert.equal('readout' in dive, false);
});

test('云海用三层云量柱，标签不再重复低云中高云', () => {
  const dive = decorateSkyHour('cloud_sea', hour);
  assert.equal(dive.layers.length, 3);
  assert.equal(dive.layers[2].pct, 72);
  assert.equal(dive.metrics.some((m) => /低云|中高云|高空云/.test(m.name)), false);
  assert.equal(dive.metrics.some((m) => m.name.includes('湿度')), true);
  assert.equal(dive.metrics.some((m) => m.name.includes('垂直层结')), false);
});

test('日出低云和总云量只出现在柱状图', () => {
  const dive = decorateSkyHour('sunrise', hour);
  assert.equal(dive.metrics.some((m) => m.name.includes('低云') || m.name.includes('总云量')), false);
  assert.ok(dive.layers.some((layer) => layer.title.includes('东向低云')));
  assert.ok(dive.layers.some((layer) => layer.title.includes('总云量')));
});

test('晚霞高云、中云、低云只出现在柱状图', () => {
  const dive = decorateSkyHour('sunset_glow', hour);
  assert.equal(dive.metrics.some((m) => /低云|中云|高云/.test(m.name)), false);
  assert.equal(dive.layers.find((layer) => layer.title.includes('高云'))?.pct, 10);
  assert.equal(dive.layers.find((layer) => layer.title.includes('中云'))?.pct, 20);
  assert.equal(dive.layers.find((layer) => layer.title.includes('低云'))?.pct, 72);
});
