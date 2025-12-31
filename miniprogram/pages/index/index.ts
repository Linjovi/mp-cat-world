
Component({
  options: {
    styleIsolation: 'shared'
  },
  data: {
    paddingTop: 0,
    appList: [
      {
        id: 'meme',
        className: 'card-meme',
        url: '/pages/meme/index',
        icon: 'https://pic1.imgdb.cn/item/693921056166b8110136209c.png',
        illustration: 'https://pic1.imgdb.cn/item/693921056166b8110136209d.png',
        name: '表情包制作喵',
        desc: '斗图必备！一键生成专属表情包',
        tags: [
          { text: '趣味斗图 🤪', color: 'green' }
        ]
      },
      {
        id: 'photography',
        className: 'card-photo',
        url: '/pages/photography/index',
        icon: 'https://pic1.imgdb.cn/item/6943c1dd2ee916d1a3af9521.png',
        illustration: 'https://pic1.imgdb.cn/item/6943c1dd2ee916d1a3af9520.png',
        name: '摄影喵',
        desc: '摄影必备！一键生成专属摄影作品',
        tags: [
          { text: '摄影必备 📸', color: 'green' }
        ]
      },
      {
        id: 'mbti',
        className: 'card-mbti',
        url: '/pages/mbti/index',
        icon: 'https://pic1.imgdb.cn/item/69315edc1f1698c4ff0bedaf.png',
        illustration: 'https://pic1.imgdb.cn/item/69315edc1f1698c4ff0bedb0.png',
        name: '喵BTI 读心术',
        desc: '读懂TA的潜台词，高情商回复神器！',
        tags: [
          { text: 'MBTI解析 🧠', color: 'indigo' },
          { text: '情感军师', color: 'purple' }
        ]
      },
      {
        id: 'judge',
        className: 'card-judge',
        url: '/pages/judge/index',
        icon: 'https://pic1.imgdb.cn/item/6938116c00233646958db30e.png',
        illustration: 'https://pic1.imgdb.cn/item/693811a000233646958db453.png',
        name: '猫猫法官',
        desc: '吵架了？让本法官来评评理！',
        tags: [
          { text: '热门 🔥', color: 'orange' },
          { text: '情感调解', color: 'blue' }
        ]
      },
      {
        id: 'hot-search',
        className: 'card-gossip',
        url: '/pages/hot-search/index',
        icon: 'https://pic1.imgdb.cn/item/6938117f00233646958db3b6.png',
        illustration: 'https://pic1.imgdb.cn/item/693811ab00233646958db46d.png',
        name: '吃瓜喵',
        desc: '全网热瓜，一网打尽！',
        tags: [
          { text: '实时热搜 🍉', color: 'pink' }
        ]
      },
      {
        id: 'tarot',
        className: 'card-tarot',
        url: '/pages/tarot/index',
        icon: 'https://pic1.imgdb.cn/item/6938119300233646958db43a.png',
        illustration: 'https://pic1.imgdb.cn/item/693811d900233646958db503.png',
        name: '神秘の塔罗喵',
        desc: '猫猫占卜师，为你解答人生疑惑！',
        tags: [
          { text: '玄学占卜 ✨', color: 'purple' }
        ]
      },
      {
        id: 'answer',
        className: 'card-answer',
        url: '/pages/answer/index',
        icon: 'https://pic1.imgdb.cn/item/69315edc1f1698c4ff0bedaf.png',
        illustration: 'https://pic1.imgdb.cn/item/69315edc1f1698c4ff0bedb0.png',
        name: '答案之书喵',
        desc: '有什么困惑，让答案之书给你解答！',
        tags: [
          { text: '玄学占卜', color: 'purple' }
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
    onAppSelect(e: WechatMiniprogram.TouchEvent) {
      const url = e.currentTarget.dataset.url;
      if (url) {
        wx.navigateTo({ url });
      }
    }
  }
})
