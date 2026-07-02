// 웨딩한방 브랜드 팔레트 — 웹/앱 단일 소스
// 웹: tailwind theme / 앱: NativeWind theme 양쪽에서 import

export const colors = {
  // Primary — Eucalyptus Ink
  // 기존 코드 호환을 위해 noir 키 이름은 유지한다.
  noir: {
    900: "#243832",
    800: "#36534E",
    soft: "#4E6A62",
    charcoal: "#5E665F",
  },

  // Accent — Dusty Mauve
  // 기존 코드 호환을 위해 rose 키 이름은 유지한다.
  rose: {
    500: "#A77B74",
    600: "#8F6662",
    light: "#D2B4AA",
    pale: "#EADDD8",
    glow: "rgba(167, 123, 116, 0.16)",
  },

  // Background — Pearl Ivory
  ivory: {
    50: "#FBF8F2",
    100: "#F7F1E8",
    200: "#EFE4D7",
    warm: "#F6EFE5",
    deep: "#E8DCCB",
  },

  // Taupe (중간톤)
  taupe: {
    400: "#B7AA9A",
    500: "#635B51",
  },

  // Sage
  sage: {
    500: "#6D806E",
    pale: "#C7D1C2",
  },

  // Champagne Taupe
  gold: {
    DEFAULT: "#B89785",
    light: "#E2D3C8",
  },

  // Platinum
  platinum: "#E6DDD2",
  surfaceLow: "#F1E8DA",
  stone: {
    900: "#263832",
  },

  // Semantic
  bg: "#FBF8F2",
  surface: "#FFFFFF",
  border: "#E5D8CA",
  textPrimary: "#263832",
  textSecondary: "#5F5B52",
  textTertiary: "#7D7166",

  // Status
  success: "#6D806E",
  warning: "#B89785",
  danger: "#D95F5F",
  info: "#36534E",

  // Ad disclosure badges
  adGeneral: "#22C55E",
  adSponsored: "#EAB308",
  adAd: "#EF4444",
} as const;

export type BrandColor = typeof colors;
