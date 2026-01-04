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
        // In real app, we would regenerate GIF here - handled by component
    },

    onUpdateGeneratedImage(e: WechatMiniprogram.CustomEvent) {
        this.setData({ generatedImage: e.detail.image });
        this.setData({
            loading: false,
            progress: 100
        });
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

    async fileToBase64(filePath: string): Promise<string> {
        return new Promise((resolve, reject) => {
            wx.getFileSystemManager().readFile({
                filePath: filePath,
                encoding: 'base64',
                success: (res) => {
                    const format = filePath.split('.').pop() || 'jpeg';
                    resolve(`data:image/${format};base64,${res.data}`);
                },
                fail: (err) => reject(err)
            });
        });
    },

    async handleGenerate() {
        if (!this.isReadyToGenerate()) {
            wx.showToast({ title: '请完善信息喵', icon: 'none' });
            return;
        }

        this.setData({ loading: true, progress: 0, error: '' });

        try {
            const { activeTab, image, refImage, style, description, gifPrompt } = this.data;

            // Prepare payload
            const payload: any = {
                type: activeTab,
                stream: true
            };

            if (image) payload.image = await this.fileToBase64(image);
            if (activeTab === 2 && refImage) payload.refImage = await this.fileToBase64(refImage);
            if (activeTab === 1) {
                payload.style = style;
                if (description) payload.description = description;
            }
            if (activeTab === 3 && gifPrompt) payload.gifPrompt = gifPrompt;

            const requestTask = wx.request({
                url: 'https://huluhulu.top/api/image/meme-generate',
                method: 'POST',
                data: payload,
                header: {
                    'Content-Type': 'application/json'
                },
                enableChunked: true,
                success: (res: any) => {
                    // This is called when the connection closes or finishes
                    if (res.statusCode !== 200) {
                        this.setData({ loading: false, error: '生成失败了喵~' });
                    }
                },
                fail: (err: any) => {
                    console.error(err);
                    this.setData({ loading: false, error: '网络错误喵~' });
                }
            } as any) as any;

            // Handle chunked response
            requestTask.onChunkReceived((res: any) => {
                // Decode ArrayBuffer to String
                // Note: TextDecoder is not strictly standard in all Mini Program environments, 
                // but we can use a simpler fallback or assume modern env. 
                // Using a simple polyfill-like approach for UTF8 if needed, but strict ASCII/UTF8 mix usually fine.
                const uint8Array = new Uint8Array(res.data);
                let chunk = "";
                for (let i = 0; i < uint8Array.length; i++) {
                    chunk += String.fromCharCode(uint8Array[i]);
                }

                // Need to handle potential incomplete chunks/multibyte chars in real robust implementations,
                // but for this specific JSON stream format (mostly ASCII except data content), this often suffices for control logic.
                // However, standard text decoding is better if available. 
                // Let's rely on simple split for "data: " lines.

                const lines = chunk.split('\n');

                for (const line of lines) {
                    if (line.startsWith("data: ")) {
                        const jsonStr = line.slice(6).trim();
                        if (jsonStr === "[DONE]") {
                            this.setData({ loading: false });
                            return;
                        }
                        if (!jsonStr) continue;

                        try {
                            const data = JSON.parse(jsonStr);

                            if (data.status === 'running') {
                                if (data.progress) {
                                    this.setData({ progress: Math.round(data.progress) });
                                }
                            } else if (data.status === 'succeeded') {
                                if (data.results && data.results.length > 0 && data.results[0].url) {
                                    const imageUrl = data.results[0].url;

                                    if (activeTab === 3) {
                                        // For GIF, imageUrl is sprite sheet. Delegate to component.
                                        const gifMaker = this.selectComponent('#gifMaker');
                                        if (gifMaker) {
                                            gifMaker.processSpriteSheet(imageUrl);
                                            // Do NOT set loading=false here, wait for component
                                        } else {
                                            this.setData({ loading: false, error: '组件加载失败喵' });
                                        }
                                    } else {
                                        this.setData({
                                            generatedImage: imageUrl,
                                            progress: 100,
                                            loading: false
                                        });
                                    }
                                }
                            } else if (data.status === 'failed') {
                                this.setData({
                                    loading: false,
                                    error: data.failure_reason || '生成失败了喵~'
                                });
                            }
                        } catch (e) {
                            console.error("Parse error", e);
                        }
                    }
                }
            });

        } catch (e) {
            console.error(e);
            this.setData({ loading: false, error: '准备数据失败了喵~' });
        }
    },

    onReset() {
        this.setData({
            image: '',
            refImage: '',
            description: '',
            generatedImage: '',
            error: '',
            progress: 0,
        });
    },
});
