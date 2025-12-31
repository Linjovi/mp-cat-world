type ActiveTab = "hot" | "function";

interface HotStyle {
    title: string;
    source: string[];
    prompt?: string;
}

Page({
    data: {
        image: '',
        resultImageUrl: '', // If present, show result view
        showOriginal: false,

        activeTab: 'hot' as ActiveTab,
        hotStyles: [] as HotStyle[],
        loadingHotStyles: false,

        selectedPreset: null as string | null,
        prompt: '',
        backgroundImage: '', // For background replacement

        loading: false,
        progress: 0,
        statusMessage: '',
        errorMsg: '',

        defaultPresets: [
            { title: "一键美化" },
            { title: "清除路人" },
            { title: "更换背景" },
            { title: "动漫风格" },
            { title: "更换天气" },
        ]
    },

    onLoad() {
        this.fetchHotStyles();
    },

    async fetchHotStyles() {
        this.setData({ loadingHotStyles: true });
        // Mock fetch
        setTimeout(() => {
            this.setData({
                hotStyles: [
                    { title: "日系小清新", source: ["胶片", "在海边"] },
                    { title: "赛博朋克", source: ["霓虹灯", "雨夜"] },
                    { title: "复古港风", source: ["暖色调", "模糊"] },
                    { title: "宫崎骏画风", source: ["治愈", "蓝天白云"] }
                ],
                loadingHotStyles: false
            });
        }, 1000);
    },

    handleUpload() {
        wx.chooseMedia({
            count: 1,
            mediaType: ['image'],
            sourceType: ['album', 'camera'],
            success: (res) => {
                // Reset state when new image uploaded
                this.setData({
                    image: res.tempFiles[0].tempFilePath,
                    resultImageUrl: '',
                    selectedPreset: null,
                    prompt: '',
                    backgroundImage: ''
                });
            }
        });
    },

    clearImage() {
        this.setData({
            image: '',
            resultImageUrl: ''
        });
    },

    handleBgUpload() {
        wx.chooseMedia({
            count: 1,
            mediaType: ['image'],
            sourceType: ['album'],
            success: (res) => {
                this.setData({
                    backgroundImage: res.tempFiles[0].tempFilePath
                });
            }
        });
    },

    clearBgImage() {
        this.setData({ backgroundImage: '' });
    },

    switchTab(e: WechatMiniprogram.TouchEvent) {
        const tab = e.currentTarget.dataset.tab as ActiveTab;
        this.setData({ activeTab: tab });
    },

    selectPreset(e: WechatMiniprogram.TouchEvent) {
        const preset = e.currentTarget.dataset.preset;
        this.setData({
            selectedPreset: this.data.selectedPreset === preset ? null : preset
        });
    },

    handleInputPrompt(e: WechatMiniprogram.Input) {
        this.setData({ prompt: e.detail.value });
    },

    toggleCompare(e: WechatMiniprogram.TouchEvent) {
        const show = e.type === 'touchstart' || e.type === 'mousedown';
        this.setData({ showOriginal: show });
    },

    handleTouchEnd() {
        this.setData({ showOriginal: false });
    },

    async handleGenerate() {
        if (!this.data.image) return;
        if (!this.data.prompt && !this.data.selectedPreset) {
            return;
        }

        this.setData({
            loading: true,
            statusMessage: '正在分析画面...',
            progress: 0,
            errorMsg: ''
        });

        try {
            // Mock Process
            const steps = ['正在分析画面...', '正在施展魔法...', '正在最后润色...', '即将完成...'];
            for (let i = 0; i < 100; i += 10) {
                this.setData({
                    progress: i,
                    statusMessage: steps[Math.floor(i / 25)]
                });
                await new Promise(r => setTimeout(r, 300));
            }

            this.setData({
                loading: false,
                progress: 0,
                resultImageUrl: 'https://api.dicebear.com/7.x/adventurer/svg?seed=PhotoResult&backgroundColor=b6e3f4' // Placeholder
            });
        } catch (err) {
            this.setData({
                loading: false,
                errorMsg: '生成失败了喵~'
            });
        }
    },

    handleDownload() {
        if (!this.data.resultImageUrl) return;

        // Handle remote verification if needed, or save directly
        // Standard boilerplate for saving
        wx.downloadFile({
            url: this.data.resultImageUrl,
            success: (res) => {
                wx.saveImageToPhotosAlbum({
                    filePath: res.tempFilePath,
                    success: () => wx.showToast({ title: '已保存', icon: 'success' }),
                    fail: (err) => {
                        console.error(err);
                        wx.showToast({ title: '保存失败', icon: 'none' });
                    }
                });
            },
            fail: () => wx.showToast({ title: '下载失败', icon: 'none' })
        });
    },

    handleReset() {
        // Keep original image, clear result
        this.setData({
            resultImageUrl: ''
        });
    }
});
