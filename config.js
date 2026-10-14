const CONFIG = {
  width: 1448,
  height: 1086,
  topRatio: 0.22,
  level: 1,
  target: 10,
  time: 54,
  hook: {
    minLength: 78,
    maxLength: 890,
    swingLimit: 1.08,
    swingSpeed: 1.35,
    shootSpeed: 790,
    grabDelay: 0.08,
    clawWidth: 124,
    clawTipOffset: 24,
    grabOffset: 34,
  },
  objects: {
    GoldSmall: { sprite: "GoldSmall", reward: 1, radius: 36, scale: [0.86, 1.12], speed: 560, weight: 1, chance: 0.42 },
    GoldLarge: { sprite: "GoldLarge", reward: 3, radius: 82, scale: [0.92, 1.1], speed: 175, weight: 4, chance: 0.14 },
    Rock: { sprite: "Rock", reward: 0, radius: 58, scale: [0.82, 1.12], speed: 125, weight: 4.8, chance: 0.2 },
    Bomb: { sprite: "Bomb", reward: 0, radius: 44, scale: [0.9, 1.06], speed: 680, weight: 1, chance: 0.11 },
    MysteryBag: { sprite: "MysteryBag", reward: 2, radius: 50, scale: [0.88, 1.08], speed: 360, weight: 2, chance: 0.13 },
  },
  placement: {
    safeMarginX: 170,
    safeTopDepth: 150,
    rockTopDepth: 265,
    bottomMargin: 135,
  },
};
const SOUND_EFFECTS = {
  gold: "music/抓到黄金.wav",
  rock: "music/抓到石头.wav",
  bomb: "music/抓到炸弹.wav",
  mystery: "music/抓到问号.wav",
  rope: "music/放绳子.wav",
  quizCorrect: "music/答对了.wav",
  quizWrong: "music/答错了.wav",
};


