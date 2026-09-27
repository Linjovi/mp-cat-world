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

export function fetchCategories(): Promise<Category[]> {
  return request<{ categories: Category[] }>('/categories').then((data) => data.categories)
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

export function fetchRecipes(params: RecipeQuery = {}): Promise<RecipeListResponse> {
  const query: Record<string, string | number> = {}
  if (params.category) query.category = params.category
  if (params.difficulty !== undefined) query.difficulty = params.difficulty
  if (params.q && params.q.trim()) query.q = params.q.trim()
  if (params.sort) query.sort = params.sort
  if (params.order) query.order = params.order
  if (params.page !== undefined) query.page = params.page
  if (params.pageSize !== undefined) query.pageSize = params.pageSize
  return request<RecipeListResponse>('/recipes', query)
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
