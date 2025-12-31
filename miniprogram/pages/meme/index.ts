type MemeType = 1 | 2 | 3;
type StyleType = "cartoon" | "realistic";
type UploadTarget = "main" | "ref";

Page({
    data: {
        statusBarHeight: 0,
        navBarHeight: 44, // Standard nav bar height
        activeTab: 1 as MemeType,
        image: '',
        refImage: '',
        style: 'realistic' as StyleType,
        description: '',
        gifPrompt: '',
        loading: false,
        progress: 0,
        generatedImage: '',
        fps: 8,
        error: '',

        // UI selections
        tabs: [
            { id: 1, name: "九宫格" },
            { id: 2, name: "表情模仿" },
            { id: 3, name: "GIF动图" }
        ]
    },

    onLoad() {
        const { statusBarHeight } = wx.getSystemInfoSync();
        this.setData({ statusBarHeight });
    },

    switchTab(e: WechatMiniprogram.TouchEvent) {
        const tab = e.currentTarget.dataset.id as MemeType;
        this.setData({ activeTab: tab });
    },

    onUpdateImage(e: WechatMiniprogram.CustomEvent) {
        const { image, target } = e.detail;
        if (target === 'ref') {
            this.setData({ refImage: image });
        } else {
            this.setData({ image });
        }
    },

    onUpdateStyle(e: WechatMiniprogram.CustomEvent) {
        this.setData({ style: e.detail.style });
    },

    onUpdateDesc(e: WechatMiniprogram.CustomEvent) {
        this.setData({ description: e.detail.description });
    },

    onUpdateGifPrompt(e: WechatMiniprogram.CustomEvent) {
        this.setData({ gifPrompt: e.detail.gifPrompt });
    },

    onFpsChange(e: WechatMiniprogram.SliderChange) {
        this.setData({ fps: e.detail.value });
        // In real app, we would regenerate GIF here
    },

    reset() {
        this.setData({
            image: '',
            refImage: '',
            description: '',
            generatedImage: '',
            error: '',
            progress: 0,
        });
    },

    saveImage() {
        if (!this.data.generatedImage) return;

        if (this.data.generatedImage.startsWith('http')) {
            wx.downloadFile({
                url: this.data.generatedImage,
                success: (res) => {
                    wx.saveImageToPhotosAlbum({
                        filePath: res.tempFilePath,
                        success: () => wx.showToast({ title: '已保存', icon: 'success' }),
                        fail: () => wx.showToast({ title: '保存失败', icon: 'none' })
                    });
                }
            });
        } else {
            wx.saveImageToPhotosAlbum({
                filePath: this.data.generatedImage,
                success: () => wx.showToast({ title: '已保存', icon: 'success' }),
                fail: () => wx.showToast({ title: '保存失败', icon: 'none' })
            });
        }
    },

    // Validation
    isReadyToGenerate() {
        const { activeTab, image, refImage, gifPrompt } = this.data;
        if (activeTab === 1) return !!image;
        if (activeTab === 2) return !!image && !!refImage;
        if (activeTab === 3) return !!image && !!gifPrompt.trim();
        return false;
    },

    async handleGenerate() {
        if (!this.isReadyToGenerate()) {
            wx.showToast({ title: '请完善信息喵', icon: 'none' });
            return;
        }

        this.setData({ loading: true, progress: 0, error: '' });

        // Mock Generation
        try {
            // Mock progress
            for (let i = 0; i <= 100; i += 20) {
                this.setData({ progress: i });
                await new Promise(r => setTimeout(r, 400));
            }

            // Mock Result
            this.setData({
                generatedImage: 'https://api.dicebear.com/7.x/adventurer/svg?seed=MemeResult&backgroundColor=b6e3f4', // Placeholder
                loading: false
            });
        } catch (e) {
            this.setData({ loading: false, error: '生成失败了喵~' });
        }
    }
});
