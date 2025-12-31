Component({
    options: {
        styleIsolation: 'apply-shared'
    },
    properties: {
        image: {
            type: String,
            value: ''
        },
        gifPrompt: {
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

        handleInputGif(e: WechatMiniprogram.Input) {
            const value = e.detail.value;
            this.triggerEvent('updateGifPrompt', { gifPrompt: value });
        }
    }
})
