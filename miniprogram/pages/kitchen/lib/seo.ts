export type KitchenTab = 'recipes' | 'recommend' | 'tips' | 'kitchen'
export type TipGroup = 'all' | 'basic' | 'learn' | 'advanced'

const TABS: KitchenTab[] = ['recipes', 'recommend', 'tips', 'kitchen']
const TIP_GROUPS: TipGroup[] = ['all', 'basic', 'learn', 'advanced']

export interface KitchenQuery {
  tab: KitchenTab
  category: string
  page: number
  group: TipGroup
  q: string
}

function asTab(raw?: string): KitchenTab {
  return raw && TABS.includes(raw as KitchenTab) ? (raw as KitchenTab) : 'recipes'
}

function asTipGroup(raw?: string): TipGroup {
  return raw && TIP_GROUPS.includes(raw as TipGroup) ? (raw as TipGroup) : 'all'
}

export function parseKitchenQuery(query: Record<string, string | undefined> = {}): KitchenQuery {
  const page = Number.parseInt(query.page || '1', 10)
  return {
    tab: asTab(query.tab),
    category: query.category && query.category.trim() ? query.category.trim() : 'all',
    page: Number.isFinite(page) && page > 0 ? page : 1,
    group: asTipGroup(query.group),
    q: (query.q || '').trim(),
  }
}

export function buildKitchenPath(params: Partial<KitchenQuery> = {}): string {
  const tab = params.tab || 'recipes'
  const parts: string[] = []
  if (tab !== 'recipes') parts.push(`tab=${tab}`)
  if (tab === 'recipes' && params.category && params.category !== 'all') {
    parts.push(`category=${encodeURIComponent(params.category)}`)
  }
  if (tab === 'recipes' && params.page && params.page > 1) {
    parts.push(`page=${params.page}`)
  }
  if (tab === 'tips' && params.group && params.group !== 'all') {
    parts.push(`group=${params.group}`)
  }
  if (params.q) parts.push(`q=${encodeURIComponent(params.q)}`)
  return parts.length ? `/pages/kitchen/index?${parts.join('&')}` : '/pages/kitchen/index'
}

export function recipeHref(id: string): string {
  return `/pages/kitchen/recipe/index?id=${encodeURIComponent(id)}`
}

export function tipHref(id: string): string {
  return `/pages/kitchen/tip/index?id=${encodeURIComponent(id)}`
}

export function kitchenNavTitle(tab: KitchenTab): string {
  if (tab === 'tips') return '烹饪技巧'
  if (tab === 'recommend') return '智能配菜'
  if (tab === 'kitchen') return '我的厨房'
  return '呼噜呼噜的掌上厨房'
}
