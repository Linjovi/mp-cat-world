const GIFEncoder = require('../../../libs/gif-encoder/GIFEncoder.js');

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
        },
        generatedImage: {
            type: String,
            value: ''
        },
        fps: {
            type: Number,
            value: 8
        }
    },

    /**
     * Component initial data
     */
    data: {
        frames: [] as string[] // Array of local temp paths for frames
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
        },

        onFpsChange(e: WechatMiniprogram.SliderChange) {
            const fps = e.detail.value;
            this.triggerEvent('fpsChange', { value: fps });

            // If we have frames, regenerate GIF locally
            if (this.data.frames.length > 0) {
                this.createGif(this.data.frames, fps);
            }
        },

        reset() {
            this.setData({ frames: [] });
            this.triggerEvent('reset');
        },

        saveImage() {
            if (!this.properties.generatedImage) return;

            // GIF is already local helper file
            wx.saveImageToPhotosAlbum({
                filePath: this.properties.generatedImage,
                success: () => wx.showToast({ title: '已保存', icon: 'success' }),
                fail: (err) => {
                    console.error('Save failed', err);
                    wx.showToast({ title: '保存失败', icon: 'none' })
                }
            });
        },

        // Exposed method to be called by parent when API returns sprite sheet URL
        async processSpriteSheet(spriteUrl: string) {
            wx.showLoading({ title: '生成动图中...', mask: true });
            try {
                const frames = await this.sliceSpriteSheet(spriteUrl);
                console.log('frames', frames);
                this.setData({ frames });
                await this.createGif(frames, this.properties.fps);
            } catch (err: any) {
                console.error('Process Sprite Sheet Error:', err);
                wx.showToast({ title: '动图生成失败', icon: 'none' });
            } finally {
                wx.hideLoading();
            }
        },

        async sliceSpriteSheet(imgUrl: string): Promise<string[]> {
            return new Promise((resolve, reject) => {
                // Need a canvas context to draw and slice
                // We create an offscreen canvas mostly, but for Wechat < 2.29 we might need real canvas.
                // Best practice now is wx.createOffscreenCanvas (type 2d)

                try {
                    const canvas = (wx as any).createOffscreenCanvas({ type: '2d' });
                    const ctx = canvas.getContext('2d');

                    const img = canvas.createImage();
                    img.onload = async () => {
                        const rows = 4;
                        const cols = 4;
                        
                        // Use full image dimensions for canvas
                        canvas.width = img.width;
                        canvas.height = img.height;
                        
                        // Draw the full sprite sheet once
                        ctx.drawImage(img, 0, 0, img.width, img.height);
                        
                        // Hack: Wait for render to stabilize
                        await new Promise(r => setTimeout(r, 200));

                        const frameWidth = Math.floor(img.width / cols);
                        const frameHeight = Math.floor(img.height / rows);

                        (this as any)._framesImageData = [];

                        for (let r = 0; r < rows; r++) {
                            for (let c = 0; c < cols; c++) {
                                // Extract frame data from the large canvas
                                const imageData = ctx.getImageData(
                                    c * frameWidth,
                                    r * frameHeight,
                                    frameWidth,
                                    frameHeight
                                );
                                (this as any)._framesImageData.push(imageData);
                            }
                        }
                        resolve(['Done']); 
                    };
                    img.onerror = (e: any) => reject(e);
                    img.src = imgUrl; // Canvas image src can be http
                } catch (e) {
                    reject(e);
                }
            });
        },

        async createGif(_frames: string[], fps: number) {
            const frames = (this as any)._framesImageData;
            if (!frames || frames.length === 0) return;

            return new Promise<void>((resolve, reject) => {
                try {
                    const encoder = new GIFEncoder();
                    encoder.setRepeat(0); // loop forever
                    encoder.setDelay(1000 / fps);

                    encoder.start();

                    for (const frame of frames) {
                        encoder.addFrame(frame);
                    }

                    encoder.finish();

                    const stream = encoder.getStream(); // ByteArray
                    const data = new Uint8Array(stream.getData());

                    // Write to temp file
                    const fs = wx.getFileSystemManager();
                    const tempFilePath = `${wx.env.USER_DATA_PATH}/generated_${Date.now()}.gif`;

                    fs.writeFile({
                        filePath: tempFilePath,
                        data: data.buffer,
                        encoding: 'binary',
                        success: () => {
                            console.log('GIF generated at', tempFilePath);
                            this.setData({ generatedImage: tempFilePath });
                            this.triggerEvent('updateGeneratedImage', { image: tempFilePath });
                            resolve();
                        },
                        fail: (err) => {
                            reject(err);
                        }
                    });

                } catch (e) {
                    reject(e);
                }
            });
        }
    }
})
