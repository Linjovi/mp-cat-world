import test from 'node:test'
import assert from 'node:assert/strict'

import {
  fetchCategories,
  getCachedCategories,
  fetchRecipes,
  preloadKitchenHome,
  _clearKitchenApiCache,
} from './api.ts'

// Mock wx
const storage = new Map<string, unknown>()
let requestCount = 0
const requestCalls: Array<{ url: string; data?: Record<string, unknown> }> = []

const mockWx = {
  request(options: {
    url: string
    method?: string
    data?: Record<string, unknown>
    success?: (res: { statusCode: number; data: unknown }) => void
    fail?: (err: { errMsg: string }) => void
  }) {
    requestCount++
    requestCalls.push({ url: options.url, data: options.data })

    setTimeout(() => {
      if (options.url.endsWith('/categories')) {
        options.success?.({
          statusCode: 200,
          data: {
            code: 0,
            message: 'ok',
            data: {
              categories: [
                { id: 'meat', name: '肉类', count: 12 },
                { id: 'veg', name: '蔬菜', count: 8 },
              ],
            },
          },
        })
      } else if (options.url.endsWith('/recipes')) {
        options.success?.({
          statusCode: 200,
          data: {
            code: 0,
            message: 'ok',
            data: {
              total: 20,
              items: [
                { id: '1', name: '红烧肉', category: 'meat', summary: '好吃' },
              ],
            },
          },
        })
      } else {
        options.fail?.({ errMsg: 'Not found' })
      }
    }, 10)
  },
  getStorageSync(key: string) {
    return storage.get(key)
  },
  setStorageSync(key: string, val: unknown) {
    storage.set(key, val)
  },
}

// @ts-expect-error Mock wx
globalThis.wx = mockWx

function resetEnv() {
  _clearKitchenApiCache()
  storage.clear()
  requestCount = 0
  requestCalls.length = 0
}

test('fetchCategories 首次发请求并存入缓存，二次调用直接命中缓存', async () => {
  resetEnv()

  assert.equal(getCachedCategories(), null)

  const cats1 = await fetchCategories()
  assert.equal(cats1.length, 2)
  assert.equal(requestCount, 1)
  assert.equal(storage.has('howtocook_categories_cache'), true)

  // 内存缓存可用
  assert.deepEqual(getCachedCategories(), cats1)

  // 二次调用 fetchCategories 不会再触发网络请求
  const cats2 = await fetchCategories()
  assert.deepEqual(cats2, cats1)
  assert.equal(requestCount, 1, '二次调用不应发送多余网络请求')
})

test('fetchCategories 并发调用时复用同一个 Promise', async () => {
  resetEnv()

  const [res1, res2] = await Promise.all([fetchCategories(), fetchCategories()])
  assert.deepEqual(res1, res2)
  assert.equal(requestCount, 1, '并发调用应该只发送一次网络请求')
})

test('getCachedCategories 可从 storage 中同步恢复', async () => {
  resetEnv()
  storage.set('howtocook_categories_cache', [
    { id: 'soup', name: '汤羹', count: 5 },
  ])

  const cached = getCachedCategories()
  assert.ok(cached)
  assert.equal(cached.length, 1)
  assert.equal(cached[0].id, 'soup')

  // 此时调用 fetchCategories 直接返回 storage 缓存
  const cats = await fetchCategories()
  assert.deepEqual(cats, cached)
  assert.equal(requestCount, 0, '命中 storage 缓存时不应发送网络请求')
})

test('preloadKitchenHome 预请求分类与默认菜谱', async () => {
  resetEnv()

  preloadKitchenHome()
  assert.equal(requestCount, 2, '应该同时发起 categories 与 recipes 的预请求')

  // 等待预请求完成
  const cats = await fetchCategories()
  assert.equal(cats.length, 2)
  assert.equal(requestCount, 2, 'categories 应该命中预请求')

  // 默认参数的 recipes 请求应该命中预请求
  const recipes = await fetchRecipes({ page: 1, pageSize: 20, sort: 'name', order: 'asc' })
  assert.equal(recipes.total, 20)
  assert.equal(requestCount, 2, '默认 recipes 应该命中预请求而不重复发网络请求')

  // 非默认参数（例如指定 category）应该发起新的网络请求
  await fetchRecipes({ category: 'meat', page: 1, pageSize: 20 })
  assert.equal(requestCount, 3, '非默认参数应发送新的网络请求')
})
