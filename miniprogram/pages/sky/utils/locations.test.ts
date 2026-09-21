import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PRESET_LOCATIONS,
  searchOfflineLocations,
  searchPresetLocations,
  upsertMapHistory,
} from './locations.ts';

const MAP_SPOT = {
  id: 'map_old',
  name: '用户自选 · 龙井村观景台',
  admin1: '杭州市西湖区龙井路',
  latitude: 30.22,
  longitude: 120.11,
  isCustom: true,
  category: 'custom' as const,
};

test('空查询不返回地点', () => {
  assert.deepEqual(searchPresetLocations('   '), []);
});

test('可按景点名称和行政区搜索', () => {
  assert.ok(searchPresetLocations('宝石山').some((item) => item.id === 'hz_baoshishan'));
  assert.ok(searchPresetLocations('临安').some((item) => item.id === 'la_taizijian'));
});

test('可按主峰和常用别名搜索', () => {
  assert.ok(searchPresetLocations('光明顶').some((item) => item.id === 'huangshan'));
  assert.ok(searchPresetLocations('西岳').some((item) => item.id === 'huashan'));
});

test('收录西湖等经典湖景与城市观景点', () => {
  assert.ok(searchPresetLocations('西湖').some((item) => item.id === 'hz_xihu'));
  assert.ok(searchPresetLocations('三潭印月').some((item) => item.id === 'hz_xihu'));
  assert.ok(searchPresetLocations('西溪').some((item) => item.id === 'hz_xixi'));
  assert.ok(searchPresetLocations('外滩').some((item) => item.id === 'sh_waitan'));
  assert.ok(searchPresetLocations('八达岭').some((item) => item.id === 'bj_badaling'));
  assert.ok(searchPresetLocations('漓江').some((item) => item.id === 'gx_lijiang'));
});

test('不存在的地点返回空数组', () => {
  assert.deepEqual(searchPresetLocations('绝对不存在的观景地'), []);
});

test('离线搜索包含地图选点历史', () => {
  const hits = searchOfflineLocations('龙井村', [MAP_SPOT]);
  assert.ok(hits.some((item) => item.id === 'map_old'));
  assert.equal(searchOfflineLocations('龙井村', []).length, 0);
});

test('地图历史：同坐标复用原 ID 并置顶，超出上限丢最旧项', () => {
  const first = upsertMapHistory([], MAP_SPOT, 2);
  assert.equal(first[0].id, 'map_old');

  const revisited = upsertMapHistory(first, {
    ...MAP_SPOT,
    id: 'map_new',
    name: '龙井村观景台',
  }, 2);
  assert.equal(revisited.length, 1);
  assert.equal(revisited[0].id, 'map_old');
  assert.equal(revisited[0].name, '龙井村观景台');

  const other = {
    id: 'map_2',
    name: '自定义 · 宝石山顶',
    latitude: 30.26,
    longitude: 120.14,
    isCustom: true,
    category: 'custom' as const,
  };
  const third = {
    id: 'map_3',
    name: '自定义 · 钱塘江边',
    latitude: 30.20,
    longitude: 120.21,
    isCustom: true,
    category: 'custom' as const,
  };
  const capped = upsertMapHistory(upsertMapHistory(revisited, other, 2), third, 2);
  assert.equal(capped.length, 2);
  assert.equal(capped[0].id, 'map_3');
  assert.ok(capped.some((item) => item.id === 'map_old') === false);
});

test('离线地点数据满足基本完整性约束', () => {
  assert.ok(PRESET_LOCATIONS.length >= 130, `地点数量不足：${PRESET_LOCATIONS.length}`);

  const ids = new Set<string>();
  for (const item of PRESET_LOCATIONS) {
    assert.ok(!ids.has(item.id), `地点 ID 重复：${item.id}`);
    ids.add(item.id);
    assert.ok(item.latitude >= -90 && item.latitude <= 90, `纬度异常：${item.id}`);
    assert.ok(item.longitude >= -180 && item.longitude <= 180, `经度异常：${item.id}`);
    assert.ok(item.category, `缺少分类：${item.id}`);
  }
});
