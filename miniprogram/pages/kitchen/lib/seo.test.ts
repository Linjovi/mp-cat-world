import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildKitchenPath,
  kitchenNavTitle,
  parseKitchenQuery,
  recipeHref,
  tipHref,
} from './seo.ts'

test('厨房查询缺省时落到菜谱第一页', () => {
  assert.deepEqual(parseKitchenQuery({}), {
    tab: 'recipes',
    category: 'all',
    page: 1,
    group: 'all',
    q: '',
  })
})

test('厨房查询读取 tab、分类、页码和技巧分组', () => {
  assert.deepEqual(
    parseKitchenQuery({
      tab: 'tips',
      category: 'meat_dish',
      page: '3',
      group: 'basic',
      q: '牛肉',
    }),
    {
      tab: 'tips',
      category: 'meat_dish',
      page: 3,
      group: 'basic',
      q: '牛肉',
    }
  )
})

test('非法 tab、分组和页码会被纠正', () => {
  assert.deepEqual(parseKitchenQuery({ tab: 'hack', group: 'xx', page: '0' }), {
    tab: 'recipes',
    category: 'all',
    page: 1,
    group: 'all',
    q: '',
  })
})

test('厨房路径只带有意义的扁平参数', () => {
  assert.equal(buildKitchenPath({}), '/pages/kitchen/index')
  assert.equal(buildKitchenPath({ tab: 'recipes', category: 'all', page: 1 }), '/pages/kitchen/index')
  assert.equal(
    buildKitchenPath({ tab: 'recipes', category: 'meat_dish', page: 2 }),
    '/pages/kitchen/index?category=meat_dish&page=2'
  )
  assert.equal(buildKitchenPath({ tab: 'tips', group: 'basic' }), '/pages/kitchen/index?tab=tips&group=basic')
})

test('菜谱和技巧链接会编码带斜杠的 id', () => {
  const id = 'soup/昂刺鱼豆腐汤/昂刺鱼豆腐汤'
  assert.equal(recipeHref(id), `/pages/kitchen/recipe/index?id=${encodeURIComponent(id)}`)
  assert.equal(tipHref('tips/去腥'), `/pages/kitchen/tip/index?id=${encodeURIComponent('tips/去腥')}`)
})

test('厨房导航标题随 tab 变化', () => {
  assert.equal(kitchenNavTitle('recipes'), '呼噜呼噜的掌上厨房')
  assert.equal(kitchenNavTitle('tips'), '烹饪技巧')
  assert.equal(kitchenNavTitle('recommend'), '智能配菜')
})
