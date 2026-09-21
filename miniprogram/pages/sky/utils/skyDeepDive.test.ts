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

test('徒步剖析突出体感与降水，不展示分层云量条', () => {
  const dive = decorateSkyHour('travel_weather', hour);
  assert.ok(dive.metrics.some((m) => m.name === '体感' && m.value === '17°C'));
  assert.ok(dive.layers.every((layer) => layer.kind !== 'low-cloud'));
  assert.match(dive.readout, /降水概率 12%/);
});

test('云海剖析保留高中低三层云量', () => {
  const dive = decorateSkyHour('cloud_sea', hour);
  assert.equal(dive.layers.length, 3);
  assert.equal(dive.layers[2].pct, 72);
  assert.match(dive.readout, /低云 72%/);
});

test('日出剖析强调东向低云与总云量', () => {
  const dive = decorateSkyHour('sunrise', hour);
  assert.ok(dive.metrics.some((m) => m.name === '东向低云'));
  assert.ok(dive.layers.some((layer) => layer.title.includes('东向低云')));
});

test('晚霞剖析强调西向低云与中高云画布', () => {
  const dive = decorateSkyHour('sunset_glow', hour);
  assert.ok(dive.metrics.some((m) => m.name === '西向低云'));
  assert.equal(
    dive.layers.find((layer) => layer.title.includes('中高云'))?.pct,
    15
  );
});
