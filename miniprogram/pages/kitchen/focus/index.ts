import { fetchRecipeDetail } from '../lib/api'
import { findMinutes, getNavMetrics, readQueryId } from '../lib/format'
import { startTimer } from '../lib/store'

interface FlatStep {
  sectionTitle: string
  text: string
  minutes: number
}

Page({
  recipeId: '',

  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    loading: true,
    error: '',
    name: '',
    steps: [] as FlatStep[],
    index: 0,
    total: 0,
    progress: 0,
    sectionTitle: '',
    stepNo: '01',
    text: '',
    minutes: 0,
    completed: false,
    isLast: false,
  },

  completedMap: {} as Record<number, boolean>,

  onLoad(query: Record<string, string | undefined>) {
    this.setData(getNavMetrics())
    const id = readQueryId(query.id)
    this.recipeId = id
    if (!id) {
      this.setData({ loading: false, error: '缺少菜谱编号' })
      return
    }
    fetchRecipeDetail(id)
      .then((detail) => {
        const steps: FlatStep[] = []
        ;(detail.steps || []).forEach((section) => {
          section.items.forEach((text) => {
            steps.push({
              sectionTitle: section.title || '烹饪步骤',
              text,
              minutes: findMinutes(text) || 0,
            })
          })
        })
        if (steps.length === 0) {
          steps.push({
            sectionTitle: '准备就绪',
            text: '按照配方准备好食材即可出锅。',
            minutes: 0,
          })
        }
        const first = steps[0]
        this.setData({
          loading: false,
          name: detail.name,
          steps,
          total: steps.length,
          index: 0,
          progress: Math.round(100 / steps.length),
          sectionTitle: first.sectionTitle,
          stepNo: '01',
          text: first.text,
          minutes: first.minutes,
          completed: false,
          isLast: steps.length === 1,
        })
      })
      .catch((error: Error) => {
        this.setData({ loading: false, error: error.message || '加载步骤失败' })
      })
  },

  renderStep(index: number) {
    const step = this.data.steps[index]
    if (!step) return
    const total = this.data.steps.length
    this.setData({
      index,
      total,
      progress: total > 0 ? Math.round(((index + 1) / total) * 100) : 100,
      sectionTitle: step.sectionTitle,
      stepNo: String(index + 1).padStart(2, '0'),
      text: step.text,
      minutes: step.minutes,
      completed: Boolean(this.completedMap[index]),
      isLast: index === total - 1,
    })
  },

  handleBack() {
    wx.navigateBack()
  },

  onShareAppMessage() {
    const name = this.data.name
    return {
      title: name ? `${name}：一步步跟做这道菜` : '跟做模式：一步步完成这道菜',
      path: this.recipeId
        ? `/pages/kitchen/focus/index?id=${encodeURIComponent(this.recipeId)}`
        : '/pages/kitchen/index',
    }
  },

  onToggleComplete() {
    const index = this.data.index
    this.completedMap[index] = !this.completedMap[index]
    if (this.completedMap[index]) wx.vibrateShort({ type: 'light' })
    this.setData({ completed: this.completedMap[index] })
  },

  onPrev() {
    if (this.data.index <= 0) return
    this.renderStep(this.data.index - 1)
  },

  onNext() {
    if (this.data.isLast) {
      this.completedMap[this.data.index] = true
      wx.navigateBack()
      return
    }
    this.renderStep(this.data.index + 1)
  },

  onStartTimer() {
    if (!this.data.minutes) return
    startTimer(`${this.data.name} (第${this.data.index + 1}步)`, this.data.minutes * 60)
    wx.showToast({ title: `已开始 ${this.data.minutes} 分钟计时`, icon: 'none' })
  },
})
