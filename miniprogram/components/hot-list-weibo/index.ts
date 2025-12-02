
interface WeiboItem {
  rank: number | string;
  title: string;
  link: string;
  hot: string | null;
  iconType: string | null;
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
        if (
          newVal &&
          !this.data.list.length &&
          !this.data.loading &&
          !this.data.error
        ) {
          this.loadData();
        }
      },
    },
  },

  data: {
    list: [] as HotSearchItem[],
    loading: false,
    error: "",
  },

  methods: {
    async loadData() {
      // 1. Check Storage
      const cachedData = wx.getStorageSync(`hotSearchData_weibo`);
      const cachedTime = wx.getStorageSync(`hotSearchTime_weibo`);
      const now = Date.now();

      if (cachedData && cachedTime && now - parseInt(cachedTime) < 3600000) {
        this.setData({
          list: cachedData.list,
          error: "",
        });
        return;
      }

      // 2. Fetch from API
      await this.fetchData();
    },

    async fetchData() {
      this.setData({ loading: true, error: "" });

      try {
        // @ts-ignore
        const res = await wx.cloud.callContainer({
          config: { env: "service-60s-8g69apg2ef1b45c8" },
          path: "/v2/weibo/v2",
          header: {
            "X-WX-SERVICE": "service-60s",
          },
          method: "GET",
        });

        if (res.statusCode !== 200 || res.data.code !== 200) {
          throw new Error(res.data?.message || "API Error");
        }

        const rawList: WeiboItem[] = res.data.data.list || [];
        
        const list: HotSearchItem[] = rawList.map(item => ({
          title: item.title,
          link: item.link,
          rank: item.rank,
          hot: item.hot || undefined,
          iconType: item.iconType || undefined
        }));

        const dataToStore = {
          list,
          summary: res.data.data.summary,
        };

        this.setData({
          list: dataToStore.list,
          loading: false,
        });

        wx.setStorageSync(`hotSearchData_weibo`, dataToStore);
        wx.setStorageSync(`hotSearchTime_weibo`, Date.now().toString());
      } catch (err: any) {
        console.error(err);
        this.setData({
          loading: false,
          error: "获取热搜失败，请稍后重试喵~",
        });
      }
    },

    refresh() {
      wx.removeStorageSync(`hotSearchData_weibo`);
      wx.removeStorageSync(`hotSearchTime_weibo`);
      return this.fetchData();
    },

    onItemClick(e: any) {
      const url = e.currentTarget.dataset.url;
      if (!url) return;

      wx.setClipboardData({
        data: url,
        success: () => {
          wx.showToast({ title: "链接已复制", icon: "success" });
        },
      });
    },
  },
});
