
Page({
  data: {
    source: "douyin", // weibo | douyin | xiaohongshu
  },

  onLoad() {
    // Components will handle their own data loading via 'active' property
  },

  onPullDownRefresh() {
    // Find current active component and call refresh
    const componentId = `#${this.data.source}`;
    const component = this.selectComponent(componentId);
    
    if (component) {
      component.refresh().then(() => {
        wx.stopPullDownRefresh();
      });
    } else {
      wx.stopPullDownRefresh();
    }
  },

  changeSource(e: any) {
    const source = e.currentTarget.dataset.source;
    if (source === this.data.source) return;

    this.setData({ source });

    if (wx.pageScrollTo) {
      wx.pageScrollTo({ scrollTop: 0 });
    }
  }
});
