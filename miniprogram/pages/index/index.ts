
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
          { text: '徒步指数', color: 'green' },
          { text: '云海日出', color: 'blue' }
        ]
      },
      {
        id: 'kitchen',
        className: 'card-kitchen',
        url: '/pages/kitchen/index',
        icon: 'https://pic.imgdd.cc/i/034W1sQkI8dEIGHuVeHa6z.png',
        illustration: 'https://pic.imgdd.cc/i/034W1rWd227BVPvmbTiM9v.png',
        name: '掌上厨房',
        desc: '菜谱 · 智能配菜 · 烹饪技巧',
        tags: [
          { text: '家常菜谱', color: 'orange' },
          { text: '智能配菜', color: 'amber' }
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
        title: '呼噜呼噜的小世界：出游助手与掌上厨房',
        path: '/pages/index/index'
      };
    },

    onShareTimeline() {
      return {
        title: '呼噜呼噜的小世界：出游助手与掌上厨房'
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
