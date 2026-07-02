// Tailwind config for NativeWind v4
// 웹과 동일한 브랜드 팔레트를 @hanbang/design-tokens 에서 import

const { colors } = require("@hanbang/design-tokens");

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,jsx,ts,tsx}",
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        // Eucalyptus Ink (primary)
        noir: {
          900: colors.noir[900],
          800: colors.noir[800],
          soft: colors.noir.soft,
          charcoal: colors.noir.charcoal,
        },
        // Dusty Mauve (accent)
        rose: {
          500: colors.rose[500],
          600: colors.rose[600],
          light: colors.rose.light,
          pale: colors.rose.pale,
        },
        // Pearl Ivory (bg)
        ivory: {
          50: colors.ivory[50],
          100: colors.ivory[100],
          200: colors.ivory[200],
          warm: colors.ivory.warm,
          deep: colors.ivory.deep,
        },
        // Taupe
        taupe: {
          400: colors.taupe[400],
          500: colors.taupe[500],
        },
        // Sage
        sage: {
          500: colors.sage[500],
          pale: colors.sage.pale,
        },
        // Champagne Taupe
        gold: {
          DEFAULT: colors.gold.DEFAULT,
          light: colors.gold.light,
        },
        platinum: colors.platinum,
        surfaceLow: colors.surfaceLow,
        stone: {
          900: colors.stone[900],
        },

        // Semantic
        bg: colors.bg,
        surface: colors.surface,
        border: colors.border,
        textPrimary: colors.textPrimary,
        textSecondary: colors.textSecondary,
        textTertiary: colors.textTertiary,
      },
      fontFamily: {
        serif: ["NotoSerifKR_500Medium", "serif"],
        "serif-light": ["NotoSerifKR_300Light", "serif"],
        sans: ["NotoSansKR_400Regular", "sans-serif"],
        "sans-medium": ["NotoSansKR_500Medium", "sans-serif"],
        "sans-semibold": ["NotoSansKR_600SemiBold", "sans-serif"],
        display: ["CormorantGaramond_400Regular", "serif"],
      },
      borderRadius: {
        "2xl": "20px",
        "3xl": "28px",
      },
    },
  },
  plugins: [],
};
