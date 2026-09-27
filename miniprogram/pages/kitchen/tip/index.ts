import { fetchTipDetail } from '../lib/api'
import { flattenSections, getNavMetrics, groupLabel, readQueryId } from '../lib/format'
import type { FlatSection } from '../lib/format'

Page({
  tipId: '',

  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    loading: true,
    error: '',
    name: '',
    groupText: '烹饪技巧',
    sections: [] as FlatSection[],
  },

  onLoad(query: Record<string, string | undefined>) {
    this.setData(getNavMetrics())
    const id = readQueryId(query.id)
    this.tipId = id
    if (!id) {
      this.setData({ loading: false, error: '缺少技巧编号' })
      return
    }
    fetchTipDetail(id)
      .then((detail) => {
        this.setData({
          loading: false,
          name: detail.name,
          groupText: groupLabel(detail.group),
          sections: flattenSections(detail.sections || []),
        })
      })
      .catch((error: Error) => {
        this.setData({ loading: false, error: error.message || '加载技巧详情失败' })
      })
  },

  onShareAppMessage() {
    const name = this.data.name
    return {
      title: name ? `${name}：一篇实用烹饪技巧` : '烹饪技巧：去腥、焯水、油温这些事',
      path: this.tipId
        ? `/pages/kitchen/tip/index?id=${encodeURIComponent(this.tipId)}`
        : '/pages/kitchen/index',
    }
  },

  handleBack() {
    wx.navigateBack({
      fail() {
        wx.reLaunch({ url: '/pages/kitchen/index' })
      },
    })
  },
})
