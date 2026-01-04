Component({
    options: {
        styleIsolation: 'apply-shared'
    },
    properties: {
        image: {
            type: String,
            value: ''
        },
        style: {
            type: String,
            value: 'realistic'
        },
        description: {
            type: String,
            value: ''
        },
        generatedImage: {
            type: String,
            value: ''
        }
    },

    methods: {
        handleImageUpload() {
            wx.chooseMedia({
                count: 1,
                mediaType: ['image'],
                sourceType: ['album', 'camera'],
                success: (res) => {
                    const tempFilePath = res.tempFiles[0].tempFilePath;
                    this.triggerEvent('updateImage', { image: tempFilePath });
                }
            });
        },

        setStyle(e: WechatMiniprogram.TouchEvent) {
            const style = e.currentTarget.dataset.style;
            this.triggerEvent('updateStyle', { style });
        },

        handleInputDesc(e: WechatMiniprogram.Input) {
            const value = e.detail.value;
            this.triggerEvent('updateDescription', { description: value });
        },

        reset() {
            this.triggerEvent('reset');
        },

        saveImage() {
            if (this.properties.generatedImage) {
                wx.saveImageToPhotosAlbum({
                    filePath: this.properties.generatedImage,
                    success: () => wx.showToast({ title: '已保存', icon: 'success' }),
                    fail: () => wx.showToast({ title: '保存失败', icon: 'none' })
                });
            }
        }
    }
})
