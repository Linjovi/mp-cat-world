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
        }
    }
})
