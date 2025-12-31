import { MBTIType, MBTI_LIST, getMBTIAvatar, getMBTIColor, getRelationshipLabel } from './constants';

interface MessageAnalysis {
    mbtiLogic: string;
}

interface ScoreChange {
    from: number;
    to: number;
    diff: number;
}

interface ReplySuggestion {
    originalReply: string;
    reactionToOriginal: string;
    optimizedReply: string;
    reactionToOptimized: string;
    briefAnalysis: string;
    scoreChange: ScoreChange;
}

Page({
    data: {
        targetMBTI: 'INFJ' as MBTIType,
        relationshipIndex: 50,
        showSettings: false,
        receivedMessage: '我感觉最近压力有点大...',
        analysis: null as MessageAnalysis | null,
        isAnalyzing: false,
        myIntent: '表示关心，问问具体怎么了。',
        suggestions: [] as ReplySuggestion[],
        isGeneratingSuggestions: false,
        toastMessage: '',
        showToast: false,
        mbtiColor: '#33a474', // Default for INFJ
        mbtiList: MBTI_LIST,
        mbtiAvatar: '',
        relationshipLabel: '',
    },

    onLoad() {
        this.updateMBTIInfo();
    },

    updateMBTIInfo() {
        const { targetMBTI, relationshipIndex } = this.data;
        this.setData({
            mbtiColor: getMBTIColor(targetMBTI),
            mbtiAvatar: getMBTIAvatar(targetMBTI),
            relationshipLabel: getRelationshipLabel(relationshipIndex)
        });
    },

    handleBack() {
        wx.navigateBack();
    },

    handleReset() {
        this.setData({
            analysis: null,
            suggestions: [],
            receivedMessage: '',
            myIntent: '',
        });
        this.showToastMsg("画布已清空喵");
    },

    handleInputReceived(e: WechatMiniprogram.Input) {
        this.setData({ receivedMessage: e.detail.value });
    },

    handleInputIntent(e: WechatMiniprogram.Input) {
        this.setData({ myIntent: e.detail.value });
    },

    async handleParse() {
        if (!this.data.receivedMessage.trim()) return;
        this.setData({ isAnalyzing: true });

        try {
            // Mock API
            await new Promise(resolve => setTimeout(resolve, 1500));
            this.setData({
                analysis: {
                    mbtiLogic: `作为 ${this.data.targetMBTI}，Ta 这句话背后其实是在寻求深层的情感共鸣，而不仅仅是表面的安慰。Ta 可能已经自己思考了很多，现在需要一个懂 Ta 的人来确认 Ta 的感受是合理的。`
                }
            });
        } catch (err) {
            this.showToastMsg("解析异常喵");
        } finally {
            this.setData({ isAnalyzing: false });
        }
    },

    async handleGenerateReply() {
        if (!this.data.myIntent.trim() || !this.data.receivedMessage.trim()) {
            this.showToastMsg("信息不全喵");
            return;
        }
        this.setData({ isGeneratingSuggestions: true });

        try {
            // Mock API
            await new Promise(resolve => setTimeout(resolve, 2000));
            const suggestions: ReplySuggestion[] = [
                {
                    originalReply: "怎么了？发生什么事了？",
                    reactionToOriginal: "有点敷衍...",
                    optimizedReply: "抱抱你。是不是最近为了那个项目把自己逼得太紧了？我知道你总是想把事情做到完美，但偶尔放松一下也没关系的，我会一直陪着你。",
                    reactionToOptimized: "暖心！被理解了！",
                    briefAnalysis: `${this.data.targetMBTI} 需要的是具体的情感支持和对其内在动机（追求完美）的看见。`,
                    scoreChange: { from: this.data.relationshipIndex, to: this.data.relationshipIndex + 5, diff: 5 }
                },
                {
                    originalReply: "别想太多，好好休息。",
                    reactionToOriginal: "不想理我...",
                    optimizedReply: "听起来你现在真的很累。如果愿意的话，我们可以一起去散散步，或者只是安静地待一会儿，我都在。",
                    reactionToOptimized: "很有安全感。",
                    briefAnalysis: "提供了非侵入式的陪伴，尊重了 Ta 的个人空间需求。",
                    scoreChange: { from: this.data.relationshipIndex, to: this.data.relationshipIndex + 3, diff: 3 }
                }
            ];

            this.setData({ suggestions });

            // Creating a smooth scroll effect
            wx.pageScrollTo({
                selector: '.suggestions-container',
                duration: 300
            });

        } catch (err) {
            this.showToastMsg("生成失败喵");
        } finally {
            this.setData({ isGeneratingSuggestions: false });
        }
    },

    showToastMsg(msg: string) {
        this.setData({ toastMessage: msg, showToast: true });
        setTimeout(() => {
            this.setData({ showToast: false });
        }, 2000);
    },

    toggleSettings() {
        this.setData({ showSettings: !this.data.showSettings });
    },

    selectMBTI(e: WechatMiniprogram.TouchEvent) {
        const mbti = e.currentTarget.dataset.mbti as MBTIType;
        this.setData({ targetMBTI: mbti }, () => {
            this.updateMBTIInfo();
        });
    },

    onRelationshipChange(e: WechatMiniprogram.SliderChange) {
        this.setData({ relationshipIndex: e.detail.value }, () => {
            this.updateMBTIInfo();
        });
    },

    closeSettings() {
        this.setData({ showSettings: false });
        this.showToastMsg("配置已生效");
    },

    copyContent(e: WechatMiniprogram.TouchEvent) {
        const content = e.currentTarget.dataset.content;
        wx.setClipboardData({
            data: content,
            success: () => {
                this.showToastMsg("已复制");
            }
        });
    }
});
