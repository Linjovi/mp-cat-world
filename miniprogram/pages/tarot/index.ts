import { SPREAD_CONFIGS, getDeck, CARD_BACK_URL } from './constants';

Page({
  data: {
    stage: 'intro', // intro, input, spread, shuffle, cut, draw, reading, result
    question: '',
    selectedSpread: null,
    spreadConfigs: SPREAD_CONFIGS,
    deck: [],
    drawnCards: [],
    loading: false,
    cardBackUrl: CARD_BACK_URL,
    readingResult: null
  },

  onLoad() {
    this.setData({
      deck: getDeck()
    });
  },

  startIntro() {
    this.setData({ stage: 'input' });
  },

  onInputQuestion(e: any) {
    this.setData({ question: e.detail.value });
  },

  confirmQuestion() {
    if (!this.data.question.trim()) return;
    this.setData({ stage: 'spread' });
  },

  selectSpread(e: any) {
    const spreadId = e.currentTarget.dataset.id;
    const spread = this.data.spreadConfigs.find(s => s.id === spreadId);
    this.setData({ selectedSpread: spread, stage: 'shuffle' });

    // Simulate shuffle
    setTimeout(() => {
      this.setData({ stage: 'cut' });
    }, 2000);
  },

  cutDeck() {
    // Simulate cut animation
    setTimeout(() => {
      this.setData({ stage: 'draw' });
    }, 1000);
  },

  drawCard(e: any) {
    // In a real app we'd pick a card based on index or random from deck
    // Simple logic: Draw random card from deck not already drawn
    if (this.data.drawnCards.length >= this.data.selectedSpread.cards) return;

    const remainingDeck = this.data.deck.filter(c => !this.data.drawnCards.find(d => d.uniqueId === c.uniqueId));
    const randomCard = remainingDeck[Math.floor(Math.random() * remainingDeck.length)];
    
    // Assign position
    const positionIndex = this.data.drawnCards.length;
    const position = this.data.selectedSpread.positions[positionIndex];
    
    const newDrawnCard = {
      ...randomCard,
      position: position.name,
      isRevealed: false
    };

    const newDrawnCards = [...this.data.drawnCards, newDrawnCard];
    this.setData({ drawnCards: newDrawnCards });

    if (newDrawnCards.length === this.data.selectedSpread.cards) {
      setTimeout(() => {
        this.setData({ stage: 'reading' });
      }, 1000);
    }
  },

  revealCard(e: any) {
    const index = e.currentTarget.dataset.index;
    const cards = this.data.drawnCards;
    if (cards[index].isRevealed) return;

    cards[index].isRevealed = true;
    this.setData({ drawnCards: cards });

    // If all revealed, generate result (mock)
    if (cards.every(c => c.isRevealed)) {
      this.generateResult();
    }
  },

  generateResult() {
    this.setData({ loading: true });
    setTimeout(() => {
      this.setData({
        loading: false,
        stage: 'result',
        readingResult: {
          analysis: "这是根据你的牌面生成的解读。未来充满了无限可能，请保持积极的心态。",
          advice: "相信直觉，大胆行动。"
        }
      });
    }, 2000);
  },

  reset() {
    this.setData({
      stage: 'intro',
      question: '',
      selectedSpread: null,
      drawnCards: [],
      readingResult: null,
      deck: getDeck()
    });
  },

  onBack() {
    // Handle back logic based on stage
    const stage = this.data.stage;
    if (stage === 'intro') {
      wx.navigateBack();
    } else if (stage === 'input') {
      this.setData({ stage: 'intro' });
    } else if (stage === 'spread') {
      this.setData({ stage: 'input' });
    } else {
      // For simplicity, other stages go back to start or previous reasonable stage
      this.setData({ stage: 'intro', drawnCards: [] });
    }
  }
})
