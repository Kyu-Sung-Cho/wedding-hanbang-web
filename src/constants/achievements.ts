// 커뮤니티 게이미피케이션 - 업적 및 레벨 정의

export interface Achievement {
  key: string;
  label: string;
  description: string;
  icon: string; // emoji
  category: "writing" | "engagement" | "streak" | "special";
  xpReward: number;
  isSecret?: boolean;
}

export const ACHIEVEMENTS: Achievement[] = [
  // 글쓰기
  { key: "first_post", label: "첫 발걸음", description: "첫 글을 작성했습니다", icon: "\u270D\uFE0F", category: "writing", xpReward: 100 },
  { key: "posts_5", label: "이야기꾼", description: "글 5개를 작성했습니다", icon: "\uD83D\uDCDD", category: "writing", xpReward: 200 },
  { key: "posts_20", label: "작가님", description: "글 20개를 작성했습니다", icon: "\uD83D\uDCDA", category: "writing", xpReward: 500 },
  { key: "posts_50", label: "다작왕", description: "글 50개를 작성했습니다", icon: "\uD83C\uDFC6", category: "writing", xpReward: 1000 },

  // 참여
  { key: "first_comment", label: "수다쟁이", description: "첫 댓글을 남겼습니다", icon: "\uD83D\uDCAC", category: "engagement", xpReward: 50 },
  { key: "comments_50", label: "댓글 요정", description: "댓글 50개를 작성했습니다", icon: "\uD83E\uDDDA", category: "engagement", xpReward: 300 },
  { key: "upvotes_10", label: "인정받다", description: "추천 10개를 받았습니다", icon: "\uD83D\uDC4D", category: "engagement", xpReward: 150 },
  { key: "upvotes_50", label: "인기인", description: "추천 50개를 받았습니다", icon: "\u2B50", category: "engagement", xpReward: 500 },
  { key: "upvotes_200", label: "영향력자", description: "추천 200개를 받았습니다", icon: "\uD83D\uDC51", category: "engagement", xpReward: 1000 },

  // 스트릭
  { key: "streak_7", label: "일주일 연속", description: "7일 연속 출석했습니다", icon: "\uD83D\uDD25", category: "streak", xpReward: 200 },
  { key: "streak_30", label: "한 달 불꽃", description: "30일 연속 출석했습니다", icon: "\uD83D\uDC8E", category: "streak", xpReward: 500 },
  { key: "streak_100", label: "레전드 출석", description: "100일 연속 출석했습니다", icon: "\uD83C\uDF1F", category: "streak", xpReward: 2000 },

  // 스페셜
  { key: "weekly_best", label: "주간 베스트", description: "주간 베스트 글에 선정되었습니다", icon: "\uD83C\uDFC5", category: "special", xpReward: 500 },
  { key: "cost_expert", label: "비용 전문가", description: "비용 공유 글 5개를 작성했습니다", icon: "\uD83D\uDCB0", category: "special", xpReward: 300 },
  { key: "night_owl", label: "불면의 예신", description: "새벽 3시에 글을 작성했습니다", icon: "\uD83E\uDD89", category: "special", xpReward: 100, isSecret: true },
];

export const ACHIEVEMENT_MAP = Object.fromEntries(
  ACHIEVEMENTS.map((a) => [a.key, a])
);

// 레벨 정의
export interface LevelConfig {
  level: number;
  title: string;
  minXP: number;
  color: string;
  bg: string;
}

export const LEVEL_CONFIG: LevelConfig[] = [
  { level: 1, title: "웨딩 새싹", minXP: 0, color: "text-green-600", bg: "bg-green-50" },
  { level: 2, title: "예비 신부/신랑", minXP: 100, color: "text-blue-600", bg: "bg-blue-50" },
  { level: 3, title: "웨딩 탐험가", minXP: 400, color: "text-violet-600", bg: "bg-violet-50" },
  { level: 4, title: "웨딩 고수", minXP: 900, color: "text-amber-600", bg: "bg-amber-50" },
  { level: 5, title: "웨딩 마스터", minXP: 1600, color: "text-orange-600", bg: "bg-orange-50" },
  { level: 6, title: "웨딩 레전드", minXP: 2500, color: "text-red-600", bg: "bg-red-50" },
];

export function getLevelInfo(xp: number) {
  let current = LEVEL_CONFIG[0];
  let next: LevelConfig | null = LEVEL_CONFIG[1];

  for (let i = LEVEL_CONFIG.length - 1; i >= 0; i--) {
    if (xp >= LEVEL_CONFIG[i].minXP) {
      current = LEVEL_CONFIG[i];
      next = LEVEL_CONFIG[i + 1] || null;
      break;
    }
  }

  const progress = next
    ? ((xp - current.minXP) / (next.minXP - current.minXP)) * 100
    : 100;

  return { current, next, progress: Math.min(progress, 100) };
}
