import { fetchTipDetail } from '../lib/api'
import { flattenSections, getNavMetrics, groupLabel, readQueryId } from '../lib/format'
import type { FlatSection } from '../lib/format'

Page({
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

  handleBack() {
    wx.navigateBack({
      fail() {
        wx.reLaunch({ url: '/pages/kitchen/index' })
      },
    })
  },
})
