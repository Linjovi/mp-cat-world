export type MBTIType =
    | "INTJ" | "INTP" | "ENTJ" | "ENTP"
    | "INFJ" | "INFP" | "ENFJ" | "ENFP"
    | "ISTJ" | "ISFJ" | "ESTJ" | "ESFJ"
    | "ISTP" | "ISFP" | "ESTP" | "ESFP";

export const MBTI_LIST: MBTIType[] = [
    'INTJ', 'INTP', 'ENTJ', 'ENTP', 'INFJ', 'INFP', 'ENFJ', 'ENFP',
    'ISTJ', 'ISFJ', 'ESTJ', 'ESFJ', 'ISTP', 'ISFP', 'ESTP', 'ESFP'
];

export const getMBTIAvatar = (mbti: MBTIType) => {
    const seeds: Record<MBTIType, string> = {
        'INFJ': 'George',
        'INFP': 'Sasha',
        'ENFP': 'Leo',
        'ENFJ': 'Willow',
        'INTJ': 'Felix',
        'INTP': 'Max',
        'ENTJ': 'Milo',
        'ENTP': 'Oliver',
        'ISTJ': 'Jack',
        'ISFJ': 'Jasper',
        'ESTJ': 'Toby',
        'ESFJ': 'Zoe',
        'ISTP': 'Finn',
        'ISFP': 'Luna',
        'ESTP': 'Bibi',
        'ESFP': 'Cookie',
    };

    const group = mbti.substring(1, 3);
    const groupColors: Record<string, string> = {
        'NT': 'a331c3',
        'NF': '33a474',
        'SJ': '4298b4',
        'SP': 'e4ae3a',
    };

    const bgColor = groupColors[group] || 'fce4ec';
    return `https://api.dicebear.com/7.x/adventurer/svg?seed=${seeds[mbti]}&backgroundColor=${bgColor}&backgroundType=solid`;
};

export const getMBTIColor = (mbti: MBTIType) => {
    const group = mbti.substring(1, 3);
    const colors: Record<string, string> = {
        'NT': '#a331c3',
        'NF': '#33a474',
        'SJ': '#4298b4',
        'SP': '#e4ae3a',
    };
    return colors[group] || '#F687B3';
};

export const getRelationshipLabel = (index: number) => {
    if (index < 30) return '初识喵';
    if (index < 60) return '好友喵';
    return '亲密喵';
};
