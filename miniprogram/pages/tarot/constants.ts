export const CARD_BACK_URL = "https://pic1.imgdb.cn/item/6930fd73d5fdcd03ca9efb12.png";

export const SPREAD_CONFIGS = [
  {
    id: "single",
    name: "单牌指引",
    description: "抽取一张牌，获得当下的核心洞察与建议。",
    cards: 1,
    positions: [
      { id: "core", name: "核心指引", description: "当下最核心的能量与建议" },
    ]
  },
  {
    id: "time-triangle",
    name: "圣三角",
    description: "经典的过去、现在、未来牌阵。",
    cards: 3,
    positions: [
      { id: "past", name: "过去溯源", description: "导致现状的过去原因" },
      { id: "present", name: "当下能量", description: "目前的状况与挑战" },
      { id: "future", name: "未来启示", description: "未来的发展趋势" },
    ]
  }
];

export const CARD_DATA = [
  { id: "major-00", name: "愚人", imageUrl: "https://pic1.imgdb.cn/item/6930fd64d5fdcd03ca9efabd.png", suit: "Major" },
  { id: "major-01", name: "魔术师", imageUrl: "https://pic1.imgdb.cn/item/6930fd64d5fdcd03ca9efabc.png", suit: "Major" },
  { id: "major-02", name: "女祭司", imageUrl: "https://pic1.imgdb.cn/item/6930fd64d5fdcd03ca9efabe.png", suit: "Major" },
  { id: "major-03", name: "皇后", imageUrl: "https://pic1.imgdb.cn/item/6930fd64d5fdcd03ca9efaba.png", suit: "Major" },
  { id: "major-04", name: "皇帝", imageUrl: "https://pic1.imgdb.cn/item/6930fd64d5fdcd03ca9efabb.png", suit: "Major" },
  { id: "major-05", name: "教皇", imageUrl: "https://pic1.imgdb.cn/item/6930fd64d5fdcd03ca9efabf.png", suit: "Major" },
  { id: "major-06", name: "恋人", imageUrl: "https://pic1.imgdb.cn/item/6930fd6cd5fdcd03ca9efae6.png", suit: "Major" },
  { id: "major-10", name: "命运之轮", imageUrl: "https://pic1.imgdb.cn/item/6930fd6cd5fdcd03ca9efae9.png", suit: "Major" },
  { id: "major-13", name: "死神", imageUrl: "https://pic1.imgdb.cn/item/6930fd70d5fdcd03ca9efafa.png", suit: "Major" },
  { id: "major-19", name: "太阳", imageUrl: "https://pic1.imgdb.cn/item/6930fd73d5fdcd03ca9efb14.png", suit: "Major" },
  // ... can add more later if needed, but this is enough for UI testing
];

export const getDeck = () => {
  // Duplicate cards to ensure we have enough for 78 cards if we wanted, 
  // but for UI 10 is enough to shuffle.
  // Actually let's make it bigger
  const deck = [];
  for (let i = 0; i < 5; i++) {
      deck.push(...CARD_DATA);
  }
  return deck.map((card, index) => ({
    ...card,
    uniqueId: `${card.id}-${index}`,
    isReversed: Math.random() < 0.2, 
  }));
};

