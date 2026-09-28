import test from 'node:test'
import assert from 'node:assert/strict'

import { buildSkyPath, parseSkyTab, resolveLocationFromQuery, skyNavTitle } from './seo.ts'

const xihu = {
  id: 'hz_xihu',
  name: '杭州 · 西湖 (断桥/苏堤/三潭印月)',
  latitude: 30.24,
  longitude: 120.14,
  elevation: 10,
}

test('出游 tab 只接受已知现象，非法值回落到徒步天气', () => {
  assert.equal(parseSkyTab('cloud_sea'), 'cloud_sea')
  assert.equal(parseSkyTab('nope'), 'travel_weather')
  assert.equal(parseSkyTab(undefined), 'travel_weather')
})

test('预设地点用 loc 拼路径，默认 tab 省略', () => {
  assert.equal(buildSkyPath(xihu), '/pages/sky/index?loc=hz_xihu')
  assert.equal(buildSkyPath(xihu, 'cloud_sea'), '/pages/sky/index?loc=hz_xihu&tab=cloud_sea')
})

test('自定义地点用扁平的经纬度和名称，不塞 JSON', () => {
  assert.equal(
    buildSkyPath(
      { id: 'custom_1', name: '龙井村', latitude: 30.22, longitude: 120.11, elevation: 80 },
      'sunrise'
    ),
    '/pages/sky/index?lat=30.22&lon=120.11&name=%E9%BE%99%E4%BA%95%E6%9D%91&elev=80&tab=sunrise'
  )
})

test('query 能按 loc 找回目录中的地点', () => {
  const found = resolveLocationFromQuery({ loc: 'hz_xihu' }, [xihu])
  assert.equal(found?.id, 'hz_xihu')
  assert.equal(found?.latitude, 30.24)
})

test('query 也能用 lat/lon/name 打开自定义点', () => {
  const found = resolveLocationFromQuery(
    { lat: '30.22', lon: '120.11', name: encodeURIComponent('龙井村'), elev: '80' },
    []
  )
  assert.equal(found?.name, '龙井村')
  assert.equal(found?.latitude, 30.22)
  assert.equal(found?.longitude, 120.11)
  assert.equal(found?.elevation, 80)
})

test('没有有效地点参数时返回 null，交给页面走默认地点', () => {
  assert.equal(resolveLocationFromQuery({}, [xihu]), null)
  assert.equal(resolveLocationFromQuery({ lat: '999', lon: '1' }, []), null)
})

test('出游标题带地点关键词，过长名称会去掉括号说明', () => {
  assert.equal(skyNavTitle(), '呼噜呼噜的出游助手')
  assert.equal(skyNavTitle(xihu.name, 'cloud_sea'), '杭州 · 西湖 · 云海预报')
})
