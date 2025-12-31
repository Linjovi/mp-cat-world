import { IAppOption } from "../../app";

const app = getApp<IAppOption>();

type Source = "weibo" | "douyin" | "xiaohongshu" | "maoyan";

interface HotSearchItem {
  rank: number | string | null;
  title: string;
  link: string | null;
  hot: string | number | null;
  iconType: string | null;
  platform?: string; // Maoyan specific
  releaseInfo?: string; // Maoyan specific
}

interface SourceData {
  list: HotSearchItem[];
  summary?: string;
}

Page({
  data: {
    currentSource: "douyin" as Source,
    sources: [
      { key: "douyin", name: "抖音", icon: "🎵", color: "text-black" },
      { key: "xiaohongshu", name: "小红书", icon: "📕", color: "text-red-500" },
      { key: "weibo", name: "微博", icon: "🔴", color: "text-pink-600" },
      { key: "maoyan", name: "网剧", icon: "🎬", color: "text-cyan-600" }
    ],
    weiboData: null as SourceData | null,
    douyinData: null as SourceData | null,
    xhsData: null as SourceData | null,
    maoyanData: null as SourceData | null,
    loading: {
      weibo: false,
      douyin: false,
      xiaohongshu: false,
      maoyan: false
    },
    error: {
      weibo: null,
      douyin: null,
      xiaohongshu: null,
      maoyan: null
    },
    swiperIndex: 0
  },

  onLoad() {
    this.loadDataIfNeeded("douyin");
    this.loadDataIfNeeded("xiaohongshu");
    this.loadDataIfNeeded("weibo");
    this.loadDataIfNeeded("maoyan");
  },

  onPullDownRefresh() {
    this.fetchSourceData(this.data.currentSource).then(() => {
      wx.stopPullDownRefresh();
    });
  },

  switchTab(e: WechatMiniprogram.TouchEvent) {
    const source = e.currentTarget.dataset.source as Source;
    const index = this.data.sources.findIndex(s => s.key === source);
    this.setData({
      currentSource: source,
      swiperIndex: index
    });
  },

  onSwiperChange(e: WechatMiniprogram.SwiperChange) {
    const index = e.detail.current;
    const source = this.data.sources[index].key as Source;
    this.setData({
      currentSource: source,
      swiperIndex: index
    });
  },

  loadDataIfNeeded(source: Source) {
    // Check if we have data in memory (this.data)
    const dataKey = `${source === 'xiaohongshu' ? 'xhs' : source}Data` as keyof typeof this.data;
    if (this.data[dataKey]) return;

    // TODO: caching logic similar to React version can be added here using wx.getStorageSync

    this.fetchSourceData(source);
  },

  async fetchSourceData(source: Source) {
    const loadingKey = `loading.${source}`;
    const errorKey = `error.${source}`;
    
    this.setData({
      [loadingKey]: true,
      [errorKey]: null
    });

    try {
      // Stub API implementation - In real world, use wx.request
      // const res = await wx.request({ url: `/api/${source}-hot-search` ... });
      
      // Mock Data for demonstration
      await new Promise(resolve => setTimeout(resolve, 1000));
      const mockList = Array.from({ length: 20 }).map((_, i) => ({
        rank: i + 1,
        title: `Mock ${source} Hot Search Result ${i + 1}`,
        link: "",
        hot: (1000000 - i * 10000).toString(),
        iconType: i < 3 ? "hot" : i === 5 ? "new" : null,
        platform: source === 'maoyan' ? '腾讯视频' : undefined,
        releaseInfo: source === 'maoyan' ? '更新至10集' : undefined
      }));

      const dataKey = `${source === 'xiaohongshu' ? 'xhs' : source}Data` as keyof typeof this.data;
      
      this.setData({
        [dataKey]: { list: mockList }
      });

    } catch (err) {
      this.setData({
        [errorKey]: "获取失败，请重试"
      });
    } finally {
      this.setData({
        [loadingKey]: false
      });
    }
  },

  handleItemTap(e: WechatMiniprogram.TouchEvent) {
    // Since we handle navigation internally in Mini Program mostly, 
    // but these are external links.
    // Official Mini Program cannot open arbitrary external links directly in webview unless configured.
    // For now, we might just copy link or show current logic limitation.
    // Or if it's a page navigation, use wx.navigateTo.
    // In huluhulu, it opens external links. we can use wx.setClipboardData or show a modal.
    // User instruction: "Transfer pages... Routing part use mini program's way". 
    // But these are external content links.
    
    // For now let's just log it or maybe copy to clipboard.
    // wx.setClipboardData({ data: link });
    // Or do nothing as user said "Interface/Routing...".
  }
});
