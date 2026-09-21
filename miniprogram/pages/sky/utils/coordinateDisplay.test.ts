import test from 'node:test';
import assert from 'node:assert/strict';
import { formatCoordinateDisplay, withCoordinateDisplay } from './coordinateDisplay.ts';

test('经纬度展示精确到小数点后两位', () => {
  assert.equal(formatCoordinateDisplay(30.274154), '30.27');
  assert.equal(formatCoordinateDisplay(120.1551), '120.16');
  assert.equal(formatCoordinateDisplay(30.2), '30.20');
});

test('地点对象附带两位小数的展示字段，原始经纬度不变', () => {
  const loc = withCoordinateDisplay({ latitude: 30.274154, longitude: 120.1551 });
  assert.equal(loc.latitude, 30.274154);
  assert.equal(loc.longitude, 120.1551);
  assert.equal(loc.latitudeDisplay, '30.27');
  assert.equal(loc.longitudeDisplay, '120.16');
});
