import { fetchRecipeDetail } from '../lib/api'
import { getNavMetrics, peopleText, readQueryId, starFlags, toSummary, categoryTheme } from '../lib/format'
import { recipeHref } from '../lib/seo'
import { addIngredientsToShoppingList, addRecentView, isFavorite, toggleFavorite } from '../lib/store'
import type { Ingredient, RecipeDetail } from '../lib/types'

const SERVINGS = [1, 2, 3, 4, 6]

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    loading: true,
    error: '',
    favorite: false,
    name: '',
    categoryName: '',
    theme: 'theme-staple',
    summary: '',
    peopleText: '',
    basePeople: '',
    stars: [] as boolean[],
    caloriesText: '',
    calculationText: '',
    servings: SERVINGS,
    servingDiners: 2,
    ingredients: [] as Array<Ingredient & { checked: boolean }>,
    checkedCount: 0,
    tools: [] as string[],
    steps: [] as RecipeDetail['steps'],
    extras: [] as string[],
    related: [] as Array<RecipeDetail['related'][number] & { href: string }>,
  },

  recipeId: '',
  detail: null as RecipeDetail | null,

  onLoad(query: Record<string, string | undefined>) {
    this.setData(getNavMetrics())
    this.recipeId = readQueryId(query.id)
    this.load(this.recipeId)
  },

  onShow() {
    if (this.detail) this.setData({ favorite: isFavorite(this.detail.id) })
  },

  onShareAppMessage() {
    const name = this.data.name
    return {
      title: name ? `${name}：食材用量和做法` : '菜谱详情：看食材用量和做法',
      path: `/pages/kitchen/recipe/index?id=${encodeURIComponent(this.recipeId)}`,
    }
  },

  load(id: string) {
    if (!id) {
      this.setData({ loading: false, error: '缺少菜谱编号' })
      return
    }
    this.recipeId = id
    this.setData({ loading: true, error: '' })
    fetchRecipeDetail(id)
      .then((detail) => {
        this.detail = detail
        const summary = toSummary(detail)
        addRecentView(summary)
        this.setData({
          loading: false,
          favorite: isFavorite(detail.id),
          name: detail.name,
          categoryName: detail.categoryName,
          theme: categoryTheme(detail.category),
          summary: detail.summary,
          peopleText: peopleText(detail.people, 'range'),
          basePeople: detail.people ? `${detail.people.min}~${detail.people.max}人` : '',
          stars: starFlags(detail.difficulty),
          caloriesText: detail.calories > 0 ? `${detail.calories} kcal` : '清爽少油',
          calculationText: detail.calculationText || '',
          servingDiners: detail.people ? detail.people.min : 2,
          ingredients: (detail.ingredients || []).map((item) => ({ ...item, checked: false })),
          checkedCount: 0,
          tools: detail.tools || [],
          steps: detail.steps || [],
          extras: detail.extras || [],
          related: (detail.related || []).map((item) => ({ ...item, href: recipeHref(item.id) })),
        })
        wx.setNavigationBarTitle({ title: detail.name })
      })
      .catch((error: Error) => {
        this.setData({ loading: false, error: error.message || '加载菜谱详情失败' })
      })
  },

  handleBack() {
    wx.navigateBack({
      fail() {
        wx.reLaunch({ url: '/pages/kitchen/index' })
      },
    })
  },

  onToggleFavorite() {
    if (!this.detail) return
    const favorite = toggleFavorite(toSummary(this.detail))
    this.setData({ favorite })
  },

  onCopyShare() {
    if (!this.detail) return
      const stars = `${this.detail.difficulty} 星`
    wx.setClipboardData({
      data: `【${this.detail.name}】${this.detail.summary} 烹饪难度: ${stars}`,
    })
  },

  onServing(event: WechatMiniprogram.TouchEvent) {
    this.setData({ servingDiners: Number(event.currentTarget.dataset.value) })
  },

  onToggleIngredient(event: WechatMiniprogram.TouchEvent) {
    const index = Number(event.currentTarget.dataset.index)
    const ingredients = this.data.ingredients.map((item, idx) => (idx === index ? { ...item, checked: !item.checked } : item))
    this.setData({
      ingredients,
      checkedCount: ingredients.filter((item) => item.checked).length,
    })
  },

  onAddShopping() {
    if (!this.detail) return
    const count = addIngredientsToShoppingList(this.detail.name, this.detail.ingredients)
    wx.showToast({
      title: count > 0 ? `已添加 ${count} 项原料` : '已在采购清单中',
      icon: 'none',
    })
  },

  onFocus() {
    if (!this.recipeId) return
    wx.navigateTo({
      url: `/pages/kitchen/focus/index?id=${encodeURIComponent(this.recipeId)}`,
    })
  },
})
