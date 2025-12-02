
interface XhsItem {
  rank: number;
  title: string;
  score: string;
  word_type: string; // "热" | "新" | "无" | "梗"
  work_type_icon: string;
  link: string;
}

interface HotSearchItem {
  title: string;
  link: string;
  rank: number | string;
  hot?: string;
  iconType?: string;
  isRead?: boolean;
}

Component({
  properties: {
    active: {
      type: Boolean,
      value: false,
      observer(newVal) {
        if (newVal && !this.data.list.length && !this.data.loading && !this.data.error) {
          this.loadData()
        }
      }
    }
  },

  data: {
    list: [] as HotSearchItem[],
    loading: false,
    error: ''
  },

  methods: {
    async loadData() {
      const cachedData = wx.getStorageSync(`hotSearchData_xiaohongshu`)
      const cachedTime = wx.getStorageSync(`hotSearchTime_xiaohongshu`)
      const now = Date.now()

      if (cachedData && cachedTime && (now - parseInt(cachedTime) < 3600000)) {
        this.setData({
          list: cachedData.list,
          error: ''
        })
        return
      }

      await this.fetchData()
    },

    async fetchData() {
      this.setData({ loading: true, error: '' })
      
      try {
        // @ts-ignore
        const res = await wx.cloud.callContainer({
          config: { env: 'service-60s-8g69apg2ef1b45c8' },
          path: '/v2/rednote',
          header: {
            'X-WX-SERVICE': 'service-60s'
          },
          method: 'GET'
        })

        if (res.statusCode !== 200 || res.data.code !== 200) {
          throw new Error(res.data?.message || 'API Error')
        }

        const rawList: XhsItem[] = res.data.data || []
        
        // Map to common UI model
        const list: HotSearchItem[] = rawList.map(item => {
          let iconType = undefined
          if (item.word_type === '热') iconType = 'hot'
          else if (item.word_type === '新') iconType = 'new'
          else if (item.word_type === '梗') iconType = 'rumor' // Reuse 'rumor' style for '梗' or similar

          return {
            title: item.title,
            link: item.link,
            rank: item.rank,
            hot: item.score,
            iconType
          }
        })

        const dataToStore = {
          list,
          summary: ''
        }

        this.setData({
          list: dataToStore.list,
          loading: false
        })

        wx.setStorageSync(`hotSearchData_xiaohongshu`, dataToStore)
        wx.setStorageSync(`hotSearchTime_xiaohongshu`, Date.now().toString())

      } catch (err: any) {
        console.error(err)
        this.setData({
          loading: false,
          error: '获取热搜失败，请稍后重试喵~'
        })
      }
    },

    refresh() {
      wx.removeStorageSync(`hotSearchData_xiaohongshu`)
      wx.removeStorageSync(`hotSearchTime_xiaohongshu`)
      return this.fetchData()
    },

    onItemClick(e: any) {
      const url = e.currentTarget.dataset.url
      if (!url) return
      
      wx.setClipboardData({
        data: url,
        success: () => {
          wx.showToast({ title: '链接已复制', icon: 'success' })
        }
      })
    }
  }
})
