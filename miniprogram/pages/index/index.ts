
Component({
  options: {
    styleIsolation: 'shared'
  },
  methods: {
    onSelectJudge() {
      wx.navigateTo({ url: '/pages/judge/index' })
    },
    onSelectGossip() {
      wx.navigateTo({ url: '/pages/eat-melon/index' })
    }
  }
})
