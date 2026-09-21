
Component({
  options: {
    styleIsolation: 'shared'
  },
  data: {
    paddingTop: 0,
    appList: [
      {
        id: 'travel',
        className: 'card-sky',
        url: '/pages/sky/index',
        icon: 'https://pic1.imgdb.cn/item/6943c1dd2ee916d1a3af9521.png',
        illustration: 'https://pic1.imgdb.cn/item/6943c1dd2ee916d1a3af9520.png',
        name: '出游助手',
        desc: '徒步·云海·日出·晚霞指数与出行指南',
        tags: [
          { text: '徒步指数 🏔️', color: 'green' },
          { text: '云海日出 🌅', color: 'blue' }
        ]
      }
    ]
  },
  lifetimes: {
    attached() {
      const { statusBarHeight } = wx.getSystemInfoSync();
      this.setData({
        paddingTop: statusBarHeight
      });
    }
  },
  methods: {
    onShareAppMessage() {
      return {
        title: '出游助手：徒步 · 云海 · 日出晚霞预报',
        path: '/pages/index/index'
      };
    },

    onShareTimeline() {
      return {
        title: '出游助手：徒步 · 云海 · 日出晚霞预报'
      };
    },

    onAppSelect(e: WechatMiniprogram.TouchEvent) {
      const url = e.currentTarget.dataset.url;
      if (url) {
        wx.navigateTo({ url });
      }
    }
  }
})
