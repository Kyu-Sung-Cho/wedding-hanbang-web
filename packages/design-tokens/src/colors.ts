// 웨딩한방 브랜드 팔레트 — 웹/앱 단일 소스
// 웹: tailwind theme / 앱: NativeWind theme 양쪽에서 import

export const colors = {
  // Primary — Noir
  noir: {
    900: "#0D0D0F",
    800: "#1A1A1F",
    soft: "#2D2D33",
    charcoal: "#4A4A52",
  },

  // Accent — Rose Champagne
  rose: {
    500: "#C4967E",
    600: "#9A6B62",
    light: "#D4AFA0",
    pale: "#E8D5CD",
    glow: "rgba(196, 150, 126, 0.15)",
  },

  // Background — Warm Ivory
  ivory: {
    50: "#FDFCFA",
    100: "#FAF8F5",
    200: "#F5F2ED",
    warm: "#FAF7F2",
    deep: "#F5F0E8",
  },

  // Taupe (중간톤)
  taupe: {
    400: "#B5ADA3",
    500: "#928980",
  },

  // Gold
  gold: {
    DEFAULT: "#C9A96E",
    light: "#DCC9A0",
  },

  // Platinum
  platinum: "#E8E4E0",

  // Semantic
  bg: "#FAFAF8",
  surface: "#FFFFFF",
  border: "#F0EFED",
  textPrimary: "#1A1A1F",
  textSecondary: "#878680",
  textTertiary: "#B5ADA3",

  // Status
  success: "#22C55E",
  warning: "#C9A96E",
  danger: "#EF4444",
  info: "#1A1A1F",

  // Ad disclosure badges
  adGeneral: "#22C55E",
  adSponsored: "#EAB308",
  adAd: "#EF4444",
} as const;

export type BrandColor = typeof colors;
