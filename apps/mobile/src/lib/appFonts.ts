import type { TextStyle } from "react-native";

export const appFonts = {
  Pretendard_100Thin: require("../../assets/fonts/pretendard/Pretendard-Thin.ttf"),
  Pretendard_200ExtraLight: require("../../assets/fonts/pretendard/Pretendard-ExtraLight.ttf"),
  Pretendard_300Light: require("../../assets/fonts/pretendard/Pretendard-Light.ttf"),
  Pretendard_400Regular: require("../../assets/fonts/pretendard/Pretendard-Regular.ttf"),
  Pretendard_500Medium: require("../../assets/fonts/pretendard/Pretendard-Medium.ttf"),
  Pretendard_600SemiBold: require("../../assets/fonts/pretendard/Pretendard-SemiBold.ttf"),
  Pretendard_700Bold: require("../../assets/fonts/pretendard/Pretendard-Bold.ttf"),
  Pretendard_800ExtraBold: require("../../assets/fonts/pretendard/Pretendard-ExtraBold.ttf"),
  Pretendard_900Black: require("../../assets/fonts/pretendard/Pretendard-Black.ttf"),
};

const fontFaces = {
  100: "Pretendard_100Thin", 200: "Pretendard_200ExtraLight", 300: "Pretendard_300Light",
  400: "Pretendard_400Regular", 500: "Pretendard_500Medium", 600: "Pretendard_600SemiBold",
  700: "Pretendard_700Bold", 800: "Pretendard_800ExtraBold", 900: "Pretendard_900Black",
} as const;
type FontWeight = keyof typeof fontFaces;
export type AppFontSelection = { family?: string; weight: FontWeight };

const legacyWeights: Record<string, FontWeight> = {
  NotoSerifKR_300Light: 300, NotoSerifKR_400Regular: 400, NotoSerifKR_500Medium: 500,
  NotoSansKR_300Light: 300, NotoSansKR_400Regular: 400, NotoSansKR_500Medium: 500,
  NotoSansKR_600SemiBold: 600, NotoSansKR_700Bold: 700,
  CormorantGaramond_300Light: 300, CormorantGaramond_400Regular: 400, CormorantGaramond_600SemiBold: 600,
};

function faceWeight(family: string | undefined): FontWeight | undefined {
  if (!family || family === "Pretendard") return undefined;
  if (Object.hasOwn(legacyWeights, family)) return legacyWeights[family];
  return Object.values(fontFaces).includes(family as typeof fontFaces[FontWeight])
    ? Number(family.split("_")[1].slice(0, 3)) as FontWeight : undefined;
}

function explicitWeight(weight: TextStyle["fontWeight"]): FontWeight | undefined {
  if (weight === "normal") return 400;
  if (weight === "bold") return 700;
  const numeric = Number(weight);
  return numeric in fontFaces ? numeric as FontWeight : undefined;
}

/** 기존 화면 alias는 정적 굵기로 해석하고 외부 아이콘·고정폭 글꼴은 보존한다. */
export function resolveAppFont(
  style: TextStyle | undefined,
  loaded: boolean,
  systemFamily: string,
  inherited: AppFontSelection = { weight: 400 },
): { selection: AppFontSelection; style: TextStyle } {
  const family = style?.fontFamily ?? inherited.family;
  const knownWeight = faceWeight(family);
  const weight = explicitWeight(style?.fontWeight) ?? knownWeight ?? inherited.weight;
  const isAppFont = !family || family === "Pretendard" || knownWeight !== undefined;
  if (!isAppFont) return { selection: { family, weight }, style: { fontFamily: family } };
  return {
    selection: { family: fontFaces[weight], weight },
    // 정적 face에 굵기를 다시 합성하지 않는다. 로딩 실패 때만 시스템 굵기를 쓴다.
    style: { fontFamily: loaded ? fontFaces[weight] : systemFamily, fontWeight: loaded ? "normal" : weight },
  };
}
