import type {
  Category,
  RecipeDetail,
  RecipeListResponse,
  RecommendResponse,
  TipDetail,
  TipSummary,
} from './types'

const BASE = 'https://huluhulu.top/api/howtocook'

interface ApiBody<T> {
  code: number
  message: string
  data: T
}

function request<T>(path: string, query?: Record<string, string | number>): Promise<T> {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${BASE}${path}`,
      method: 'GET',
      data: query,
      timeout: 15000,
      success(res) {
        const body = res.data as ApiBody<T> | undefined
        if (res.statusCode >= 200 && res.statusCode < 300 && body && body.code === 0) {
          resolve(body.data)
          return
        }
        const message = body && body.message ? body.message : `请求失败 (${res.statusCode})`
        reject(new Error(message))
      },
      fail(err) {
        reject(new Error(err.errMsg || '网络请求失败'))
      },
    })
  })
}

function resourcePath(kind: 'recipes' | 'tips', id: string): string {
  const encoded = id.split('/').map((part) => encodeURIComponent(part)).join('/')
  return `/${kind}/${encoded}`
}

const CATEGORIES_STORAGE_KEY = 'howtocook_categories_cache'
let memoryCategories: Category[] | null = null
let categoriesPromise: Promise<Category[]> | null = null

export function getCachedCategories(): Category[] | null {
  if (memoryCategories && memoryCategories.length > 0) {
    return memoryCategories
  }
  try {
    if (typeof wx !== 'undefined' && wx.getStorageSync) {
      const raw = wx.getStorageSync(CATEGORIES_STORAGE_KEY)
      if (raw) {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
        if (Array.isArray(parsed) && parsed.length > 0) {
          memoryCategories = parsed
          return parsed
        }
      }
    }
  } catch (e) {
    console.warn('read cached categories failed', e)
  }
  return null
}

export function fetchCategories(forceRefresh = false): Promise<Category[]> {
  if (!forceRefresh) {
    const cached = getCachedCategories()
    if (cached) {
      return Promise.resolve(cached)
    }
  }
  if (categoriesPromise) {
    return categoriesPromise
  }
  categoriesPromise = request<{ categories: Category[] }>('/categories')
    .then((data) => {
      memoryCategories = data.categories
      try {
        if (typeof wx !== 'undefined' && wx.setStorageSync) {
          wx.setStorageSync(CATEGORIES_STORAGE_KEY, data.categories)
        }
      } catch (e) {
        console.warn('save categories cache failed', e)
      }
      return data.categories
    })
    .finally(() => {
      categoriesPromise = null
    })
  return categoriesPromise
}

export interface RecipeQuery {
  category?: string
  difficulty?: number
  q?: string
  sort?: 'name' | 'difficulty' | 'calories'
  order?: 'asc' | 'desc'
  page?: number
  pageSize?: number
}

function isDefaultRecipeQuery(params: RecipeQuery = {}): boolean {
  const isDefaultCategory = !params.category || params.category === 'all'
  const isDefaultDifficulty = params.difficulty === undefined || params.difficulty === 0
  const isDefaultQ = !params.q || !params.q.trim()
  const isDefaultSort = !params.sort || params.sort === 'name'
  const isDefaultOrder = !params.order || params.order === 'asc'
  const isDefaultPage = !params.page || params.page === 1
  const isDefaultPageSize = !params.pageSize || params.pageSize === 20
  return (
    isDefaultCategory &&
    isDefaultDifficulty &&
    isDefaultQ &&
    isDefaultSort &&
    isDefaultOrder &&
    isDefaultPage &&
    isDefaultPageSize
  )
}

let defaultRecipesPromise: Promise<RecipeListResponse> | null = null
let cachedDefaultRecipes: { data: RecipeListResponse; timestamp: number } | null = null
const DEFAULT_RECIPES_TTL = 5 * 60 * 1000 // 5 分钟有效

export function getCachedDefaultRecipes(): RecipeListResponse | null {
  if (cachedDefaultRecipes && Date.now() - cachedDefaultRecipes.timestamp < DEFAULT_RECIPES_TTL) {
    return cachedDefaultRecipes.data
  }
  return null
}

export function fetchRecipes(params: RecipeQuery = {}, forceRefresh = false): Promise<RecipeListResponse> {
  const isDefault = isDefaultRecipeQuery(params)
  if (isDefault && !forceRefresh) {
    const cached = getCachedDefaultRecipes()
    if (cached) {
      return Promise.resolve(cached)
    }
    if (defaultRecipesPromise) {
      return defaultRecipesPromise
    }
  }

  const query: Record<string, string | number> = {}
  if (params.category && params.category !== 'all') query.category = params.category
  if (params.difficulty !== undefined && params.difficulty > 0) query.difficulty = params.difficulty
  if (params.q && params.q.trim()) query.q = params.q.trim()
  if (params.sort) query.sort = params.sort
  if (params.order) query.order = params.order
  if (params.page !== undefined) query.page = params.page
  if (params.pageSize !== undefined) query.pageSize = params.pageSize

  const req = request<RecipeListResponse>('/recipes', query)

  if (isDefault) {
    defaultRecipesPromise = req
      .then((data) => {
        cachedDefaultRecipes = { data, timestamp: Date.now() }
        return data
      })
      .finally(() => {
        defaultRecipesPromise = null
      })
    return defaultRecipesPromise
  }

  return req
}

export function preloadKitchenHome(): void {
  fetchCategories().catch((err) => {
    console.warn('[Preload] fetchCategories failed:', err)
  })
  fetchRecipes({ page: 1, pageSize: 20, sort: 'name', order: 'asc' }).catch((err) => {
    console.warn('[Preload] fetchRecipes failed:', err)
  })
}

export function _clearKitchenApiCache(): void {
  memoryCategories = null
  categoriesPromise = null
  defaultRecipesPromise = null
  cachedDefaultRecipes = null
}

export function fetchRecipeDetail(id: string): Promise<RecipeDetail> {
  return request<RecipeDetail>(resourcePath('recipes', id))
}

export function fetchRecommend(params: {
  people: number
  difficultyMax?: number
  seed?: number
}): Promise<RecommendResponse> {
  const query: Record<string, string | number> = { people: params.people }
  if (params.difficultyMax !== undefined) query.difficultyMax = params.difficultyMax
  if (params.seed !== undefined) query.seed = params.seed
  return request<RecommendResponse>('/recommend', query)
}

export function fetchTips(params: { group?: string; q?: string } = {}): Promise<TipSummary[]> {
  const query: Record<string, string | number> = {}
  if (params.group) query.group = params.group
  if (params.q && params.q.trim()) query.q = params.q.trim()
  return request<{ items: TipSummary[] }>('/tips', query).then((data) => data.items)
}

export function fetchTipDetail(id: string): Promise<TipDetail> {
  return request<TipDetail>(resourcePath('tips', id))
}
