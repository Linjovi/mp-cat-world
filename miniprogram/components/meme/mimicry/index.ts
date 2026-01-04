Component({
    options: {
        styleIsolation: 'apply-shared'
    },
    properties: {
        image: {
            type: String,
            value: ''
        },
        refImage: {
            type: String,
            value: ''
        },
        generatedImage: {
            type: String,
            value: ''
        }
    },
    methods: {
        handleImageUpload(e: WechatMiniprogram.TouchEvent) {
            const target = e.currentTarget.dataset.target; // 'main' or 'ref'

            wx.chooseMedia({
                count: 1,
                mediaType: ['image'],
                sourceType: ['album', 'camera'],
                success: (res) => {
                    const tempFilePath = res.tempFiles[0].tempFilePath;
                    this.triggerEvent('updateImage', {
                        image: tempFilePath,
                        target: target
                    });
                }
            });
        },

        reset() {
            this.triggerEvent('reset');
        },

        saveImage() {
            if (!this.properties.generatedImage) return;

            wx.saveImageToPhotosAlbum({
                filePath: this.properties.generatedImage,
                success: () => wx.showToast({ title: '已保存', icon: 'success' }),
                fail: () => wx.showToast({ title: '保存失败', icon: 'none' })
            });
        }
    }
})
