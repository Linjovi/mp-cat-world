
interface DouyinItem {
  title: string;
  hot_value: number;
  cover: string;
  link: string;
  event_time: string;
  event_time_at: number;
  active_time: string;
  active_time_at: number;
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
      const cachedData = wx.getStorageSync(`hotSearchData_douyin`)
      const cachedTime = wx.getStorageSync(`hotSearchTime_douyin`)
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
          path: '/v2/douyin',
          header: {
            'X-WX-SERVICE': 'service-60s'
          },
          method: 'GET'
        })

        if (res.statusCode !== 200 || res.data.code !== 200) {
          throw new Error(res.data?.message || 'API Error')
        }

        // Map API response to UI model
        const rawList: DouyinItem[] = res.data.data || []
        const list: HotSearchItem[] = rawList.map((item, index) => ({
          title: item.title,
          link: item.link,
          rank: index + 1,
          hot: (item.hot_value / 10000).toFixed(1) + 'w',
          // Add logic for 'iconType' if needed based on hot_value or rank
          iconType: index < 3 ? 'hot' : undefined 
        }))

        const dataToStore = {
          list,
          summary: '' // API doesn't seem to return summary
        }

        this.setData({
          list: dataToStore.list,
          loading: false
        })

        wx.setStorageSync(`hotSearchData_douyin`, dataToStore)
        wx.setStorageSync(`hotSearchTime_douyin`, Date.now().toString())

      } catch (err: any) {
        console.error(err)
        this.setData({
          loading: false,
          error: '获取热搜失败，请稍后重试喵~'
        })
      }
    },

    refresh() {
      wx.removeStorageSync(`hotSearchData_douyin`)
      wx.removeStorageSync(`hotSearchTime_douyin`)
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
