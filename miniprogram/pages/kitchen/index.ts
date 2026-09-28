import { fetchCategories, fetchRecipes, fetchRecommend, fetchTips, fetchRecipeDetail } from './lib/api'
import {
  getNavMetrics,
  groupShopping,
  shoppingText,
  tipBadge,
  toRecipeCard,
  toRecommendCard,
  toSummary,
} from './lib/format'
import { buildKitchenPath, kitchenNavTitle, parseKitchenQuery, tipHref, type KitchenTab, type TipGroup } from './lib/seo'
import {
  addIngredientsToShoppingList,
  clearCompletedShopping,
  clearShoppingList,
  favoriteIdSet,
  getFavorites,
  getRecentViews,
  getShoppingList,
  removeShoppingItem,
  subscribe,
  toggleFavorite,
  toggleShoppingItem,
} from './lib/store'
import type { Category, RecommendResponse, TipSummary } from './lib/types'

const PAGE_SIZE = 20
const PEOPLE_PRESETS = [1, 2, 4, 6, 8, 10]
const TIP_GROUPS = [
  { id: 'all' as const, label: '全部技巧', href: buildKitchenPath({ tab: 'tips', group: 'all' }) },
  { id: 'basic' as const, label: '厨房常识', href: buildKitchenPath({ tab: 'tips', group: 'basic' }) },
  { id: 'learn' as const, label: '基础技法', href: buildKitchenPath({ tab: 'tips', group: 'learn' }) },
  { id: 'advanced' as const, label: '进阶秘诀', href: buildKitchenPath({ tab: 'tips', group: 'advanced' }) },
]

function kitchenTabHrefs() {
  return {
    recipes: buildKitchenPath({ tab: 'recipes' }),
    recommend: buildKitchenPath({ tab: 'recommend' }),
    tips: buildKitchenPath({ tab: 'tips' }),
    kitchen: buildKitchenPath({ tab: 'kitchen' }),
  }
}

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    tab: 'recipes' as KitchenTab,
    categories: [] as Category[],
    totalCount: 0,
    selectedCategory: 'all',
    difficultyFilter: 0,
    sortField: 'name' as 'name' | 'difficulty' | 'calories',
    sortOrder: 'asc' as 'asc' | 'desc',
    searchQuery: '',
    showFilter: false,
    page: 1,
    total: 0,
    totalPages: 1,
    recipes: [] as ReturnType<typeof toRecipeCard>[],
    loading: true,
    error: '',
    people: 4,
    peoplePresets: PEOPLE_PRESETS,
    difficultyMax: 3,
    recommend: null as null | {
      count: number
      vegetableCount: number
      meatCount: number
      warnings: string
      totalCalories: number
      avgCalories: number
      items: ReturnType<typeof toRecommendCard>[]
    },
    recommendLoading: false,
    recommendError: '',
    batchLoading: false,
    tipGroups: TIP_GROUPS,
    tipGroup: 'all' as TipGroup,
    tipQuery: '',
    tips: [] as Array<TipSummary & { badge: string; theme: string; href: string }>,
    tipsLoading: false,
    tipsError: '',
    kitchenTab: 'favorites' as 'favorites' | 'shopping' | 'history',
    favoriteRecipes: [] as ReturnType<typeof toRecipeCard>[],
    favoriteCount: 0,
    shoppingGroups: [] as ReturnType<typeof groupShopping>,
    shoppingCount: 0,
    completedCount: 0,
    recentRecipes: [] as ReturnType<typeof toRecipeCard>[],
    recentCount: 0,
    stars: [1, 2, 3, 4, 5],
    allCategoryHref: buildKitchenPath({ tab: 'recipes' }),
    prevPageHref: buildKitchenPath({ tab: 'recipes' }),
    nextPageHref: buildKitchenPath({ tab: 'recipes', page: 2 }),
    tabHrefs: kitchenTabHrefs(),
  },

  searchTimer: 0 as unknown as number,
  requestSerial: 0,
  recommendSeed: Math.floor(Math.random() * 2147483647),
  unsubscribe: null as null | (() => void),

  onLoad(query: Record<string, string | undefined>) {
    const parsed = parseKitchenQuery(query)
    this.setData({
      ...getNavMetrics(),
      tab: parsed.tab,
      selectedCategory: parsed.category,
      page: parsed.page,
      tipGroup: parsed.group,
      searchQuery: parsed.q,
    })
    this.refreshListHrefs()
    wx.setNavigationBarTitle({ title: kitchenNavTitle(parsed.tab) })
    this.unsubscribe = subscribe(() => this.syncKitchen())
    this.syncKitchen()
    this.loadCategories()
    this.loadRecipes()
    if (parsed.tab === 'recommend') this.loadRecommend()
    if (parsed.tab === 'tips') this.loadTips()
  },

  onShow() {
    if (this.data.recipes.length > 0 || this.data.favoriteCount > 0 || this.data.recentCount > 0) {
      this.syncKitchen()
    }
  },

  onUnload() {
    if (this.unsubscribe) this.unsubscribe()
    clearTimeout(this.searchTimer)
  },

  currentKitchenPath() {
    return buildKitchenPath({
      tab: this.data.tab,
      category: this.data.selectedCategory,
      page: this.data.page,
      group: this.data.tipGroup,
      q: this.data.searchQuery,
    })
  },

  refreshListHrefs() {
    const { selectedCategory, page } = this.data
    this.setData({
      allCategoryHref: buildKitchenPath({ tab: 'recipes' }),
      prevPageHref: buildKitchenPath({ tab: 'recipes', category: selectedCategory, page: Math.max(1, page - 1) }),
      nextPageHref: buildKitchenPath({ tab: 'recipes', category: selectedCategory, page: page + 1 }),
    })
  },

  onShareAppMessage() {
    return {
      title: '呼噜呼噜的掌上厨房：菜谱、智能配菜和烹饪技巧',
      path: this.currentKitchenPath(),
    }
  },

  onShareTimeline() {
    const path = this.currentKitchenPath()
    const query = path.includes('?') ? path.slice(path.indexOf('?') + 1) : ''
    return {
      title: '呼噜呼噜的掌上厨房：菜谱、智能配菜和烹饪技巧',
      query,
    }
  },

  loadCategories() {
    fetchCategories()
      .then((categories) => {
        const totalCount = categories.reduce((sum, item) => sum + item.count, 0)
        this.setData({
          categories: categories.map((item) => ({
            ...item,
            href: buildKitchenPath({ tab: 'recipes', category: item.id }),
          })),
          totalCount,
        })
      })
      .catch((error) => {
        console.warn('fetchCategories failed', error)
      })
  },

  loadRecipes() {
    const serial = ++this.requestSerial
    const { selectedCategory, difficultyFilter, sortField, sortOrder, searchQuery, page } = this.data
    this.setData({ loading: true, error: '' })
    fetchRecipes({
      category: selectedCategory === 'all' ? undefined : selectedCategory,
      difficulty: difficultyFilter > 0 ? difficultyFilter : undefined,
      q: searchQuery.trim() || undefined,
      sort: sortField,
      order: sortOrder,
      page,
      pageSize: PAGE_SIZE,
    })
      .then((data) => {
        if (serial !== this.requestSerial) return
        const favorites = favoriteIdSet()
        this.setData({
          recipes: data.items.map((item) => toRecipeCard(item, favorites)),
          total: data.total,
          totalPages: Math.max(1, Math.ceil(data.total / PAGE_SIZE)),
          loading: false,
        })
        this.refreshListHrefs()
      })
      .catch((error: Error) => {
        if (serial !== this.requestSerial) return
        this.setData({ loading: false, error: error.message || '加载菜谱失败' })
      })
  },

  syncKitchen() {
    const favorites = favoriteIdSet()
    const shopping = getShoppingList()
    const recipes = this.data.recipes.map((item) => ({ ...item, favorite: favorites.has(item.id) }))
    this.setData({
      recipes,
      favoriteRecipes: getFavorites().map((item) => toRecipeCard(item, favorites)),
      favoriteCount: getFavorites().length,
      shoppingGroups: groupShopping(shopping),
      shoppingCount: shopping.length,
      completedCount: shopping.filter((item) => item.completed).length,
      recentRecipes: getRecentViews().map((item) => toRecipeCard(item, favorites)),
      recentCount: getRecentViews().length,
    })
  },

  onSearchInput(event: WechatMiniprogram.Input) {
    const searchQuery = event.detail.value
    this.setData({ searchQuery })
    clearTimeout(this.searchTimer)
    this.searchTimer = setTimeout(() => {
      this.setData({ page: 1 })
      this.loadRecipes()
    }, 300) as unknown as number
  },

  onClearSearch() {
    this.setData({ searchQuery: '', page: 1 })
    this.loadRecipes()
  },

  onToggleFilter() {
    this.setData({ showFilter: !this.data.showFilter })
  },

  onDifficulty(event: WechatMiniprogram.TouchEvent) {
    const difficultyFilter = Number(event.currentTarget.dataset.value)
    this.setData({ difficultyFilter, page: 1 })
    this.loadRecipes()
  },

  onSortField(event: WechatMiniprogram.TouchEvent) {
    const sortField = event.currentTarget.dataset.field as 'name' | 'difficulty' | 'calories'
    this.setData({ sortField, page: 1 })
    this.loadRecipes()
  },

  onToggleOrder() {
    this.setData({ sortOrder: this.data.sortOrder === 'asc' ? 'desc' : 'asc', page: 1 })
    this.loadRecipes()
  },

  onResetFilters() {
    this.setData({
      searchQuery: '',
      selectedCategory: 'all',
      difficultyFilter: 0,
      sortField: 'name',
      sortOrder: 'asc',
      page: 1,
    })
    this.loadRecipes()
  },

  onToggleFavorite(event: WechatMiniprogram.TouchEvent) {
    const id = event.currentTarget.dataset.id as string
    const recipe = this.data.recipes.find((item) => item.id === id)
      || this.data.favoriteRecipes.find((item) => item.id === id)
      || this.data.recentRecipes.find((item) => item.id === id)
    if (!recipe) return
    toggleFavorite(toSummary(recipe))
  },

  loadRecommend() {
    this.setData({ recommendLoading: true, recommendError: '' })
    fetchRecommend({
      people: this.data.people,
      difficultyMax: this.data.difficultyMax,
      seed: this.recommendSeed,
    })
      .then((data) => this.applyRecommend(data))
      .catch((error: Error) => {
        this.setData({ recommendLoading: false, recommendError: error.message || '获取配菜建议失败' })
      })
  },

  applyRecommend(data: RecommendResponse) {
    const totalCalories = data.items.reduce((sum, item) => sum + (item.calories || 0), 0)
    this.setData({
      recommendLoading: false,
      recommend: {
        count: data.items.length,
        vegetableCount: data.vegetableCount,
        meatCount: data.meatCount,
        warnings: (data.warnings || []).join('；'),
        totalCalories,
        avgCalories: this.data.people > 0 ? Math.round(totalCalories / this.data.people) : 0,
        items: data.items.map(toRecommendCard),
      },
    })
  },

  onPeoplePreset(event: WechatMiniprogram.TouchEvent) {
    this.setData({ people: Number(event.currentTarget.dataset.value) })
    this.loadRecommend()
  },

  onPeopleChanging(event: WechatMiniprogram.SliderChange) {
    this.setData({ people: event.detail.value })
  },

  onPeopleChange(event: WechatMiniprogram.SliderChange) {
    this.setData({ people: event.detail.value })
    this.loadRecommend()
  },

  onDifficultyMax(event: WechatMiniprogram.TouchEvent) {
    this.setData({ difficultyMax: Number(event.currentTarget.dataset.value) })
    this.loadRecommend()
  },

  onReroll() {
    this.recommendSeed = Math.floor(Math.random() * 2147483647)
    this.loadRecommend()
  },

  async onAddTableShopping() {
    const items = this.data.recommend ? this.data.recommend.items : []
    if (items.length === 0 || this.data.batchLoading) return
    this.setData({ batchLoading: true })
    let added = 0
    for (const item of items) {
      try {
        const detail = await fetchRecipeDetail(item.id)
        added += addIngredientsToShoppingList(detail.name, detail.ingredients)
      } catch (error) {
        console.warn('add table ingredient failed', error)
      }
    }
    this.setData({ batchLoading: false })
    wx.showToast({
      title: added > 0 ? `已添加 ${added} 种食材` : '整桌食材已在采购单中',
      icon: 'none',
    })
  },

  loadTips() {
    this.setData({ tipsLoading: true, tipsError: '' })
    fetchTips({
      group: this.data.tipGroup === 'all' ? undefined : this.data.tipGroup,
      q: this.data.tipQuery.trim() || undefined,
    })
      .then((items) => {
        this.setData({
          tipsLoading: false,
          tips: items.map((item) => {
            const badge = tipBadge(item.group)
            return { ...item, badge: badge.label, theme: badge.theme, href: tipHref(item.id) }
          }),
        })
      })
      .catch((error: Error) => {
        this.setData({ tipsLoading: false, tipsError: error.message || '加载技巧列表失败' })
      })
  },

  onTipInput(event: WechatMiniprogram.Input) {
    this.setData({ tipQuery: event.detail.value })
  },

  onTipSearch() {
    this.loadTips()
  },

  onResetTips() {
    this.setData({ tipQuery: '', tipGroup: 'all' })
    this.loadTips()
  },

  onKitchenTab(event: WechatMiniprogram.TouchEvent) {
    this.setData({ kitchenTab: event.currentTarget.dataset.tab })
  },

  onToggleShopping(event: WechatMiniprogram.TouchEvent) {
    toggleShoppingItem(event.currentTarget.dataset.id)
  },

  onRemoveShopping(event: WechatMiniprogram.TouchEvent) {
    removeShoppingItem(event.currentTarget.dataset.id)
  },

  onCopyShopping() {
    if (this.data.shoppingCount === 0) return
    wx.setClipboardData({
      data: shoppingText(getShoppingList()),
    })
  },

  onClearCompleted() {
    clearCompletedShopping()
  },

  onClearShopping() {
    wx.showModal({
      title: '清空采购单',
      content: '确定清空全部备料吗？',
      success: (res) => {
        if (res.confirm) clearShoppingList()
      },
    })
  },
})
