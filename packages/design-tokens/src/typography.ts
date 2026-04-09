// 웨딩한방 타이포그래피 토큰

export const fontFamily = {
  // 한글 제목
  serifKr: ['"Noto Serif KR"', "serif"],
  // 한글 본문
  sansKr: ['"Noto Sans KR"', "sans-serif"],
  // 영문/숫자 (브랜드 디스플레이)
  display: ['"Cormorant Garamond"', "serif"],
} as const;

export const fontSize = {
  xs: 12,
  sm: 14,
  base: 16,
  lg: 18,
  xl: 20,
  "2xl": 24,
  "3xl": 30,
  "4xl": 36,
  "5xl": 48,
  "6xl": 60,
} as const;

export const fontWeight = {
  light: "300",
  regular: "400",
  medium: "500",
  semibold: "600",
  bold: "700",
} as const;

export const lineHeight = {
  tight: 1.2,
  snug: 1.4,
  normal: 1.6,
  relaxed: 1.75,
} as const;

export const letterSpacing = {
  tight: -0.02,
  normal: -0.01,
  wide: 0.02,
} as const;
