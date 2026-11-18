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
  // 청첩장 디자인(2026-11-17 파운더 디자인 아티팩트) 글꼴. 새 청첩장 화면만 쓴다.
  // 기존 화면의 `NotoSansKR_*`·`CormorantGaramond_*` 이름은 아래에서 Pretendard 로 바뀌므로
  // 겹치지 않게 `Inv` 로 시작하는 이름을 쓴다. 파일은 서브셋이다(scripts/subset-invitation-fonts.py).
  InvGowunBatang_400Regular: require("../../assets/fonts/gowun-batang/GowunBatang-Regular.ttf"),
  InvGowunBatang_700Bold: require("../../assets/fonts/gowun-batang/GowunBatang-Bold.ttf"),
  InvCormorantGaramond_400Regular: require("../../assets/fonts/cormorant-garamond/CormorantGaramond-Regular.ttf"),
  InvCormorantGaramond_500Medium: require("../../assets/fonts/cormorant-garamond/CormorantGaramond-Medium.ttf"),
  InvCormorantGaramond_400Regular_Italic: require("../../assets/fonts/cormorant-garamond/CormorantGaramond-Italic.ttf"),
  InvCormorantGaramond_500Medium_Italic: require("../../assets/fonts/cormorant-garamond/CormorantGaramond-MediumItalic.ttf"),
  InvNotoSansKR_400Regular: require("../../assets/fonts/noto-sans-kr/NotoSansKR-Regular.ttf"),
  InvNotoSansKR_500Medium: require("../../assets/fonts/noto-sans-kr/NotoSansKR-Medium.ttf"),
  InvNotoSansKR_700Bold: require("../../assets/fonts/noto-sans-kr/NotoSansKR-Bold.ttf"),
};

const fontFaces = {
  100: "Pretendard_100Thin", 200: "Pretendard_200ExtraLight", 300: "Pretendard_300Light",
  400: "Pretendard_400Regular", 500: "Pretendard_500Medium", 600: "Pretendard_600SemiBold",
  700: "Pretendard_700Bold", 800: "Pretendard_800ExtraBold", 900: "Pretendard_900Black",
} as const;
type FontWeight = keyof typeof fontFaces;
export type AppFontSelection = { family?: string; weight: FontWeight };

/**
 * 청첩장 화면이 `fontFamily` 에 넣는 이름. 굵기는 `fontWeight` 로 고를 수 있다
 * (예: `invitationFonts.sans` + `fontWeight: "700"` 은 Noto Sans KR Bold 가 된다).
 */
export const invitationFonts = {
  /** 고운바탕 — 한글 제목·이름·편지. */
  serif: "InvGowunBatang_400Regular",
  serifBold: "InvGowunBatang_700Bold",
  /** Cormorant Garamond — 숫자·날짜·로고. */
  numeral: "InvCormorantGaramond_400Regular",
  numeralMedium: "InvCormorantGaramond_500Medium",
  numeralItalic: "InvCormorantGaramond_400Regular_Italic",
  numeralMediumItalic: "InvCormorantGaramond_500Medium_Italic",
  /** Noto Sans KR — 본문. */
  sans: "InvNotoSansKR_400Regular",
  sansMedium: "InvNotoSansKR_500Medium",
  sansBold: "InvNotoSansKR_700Bold",
} as const;

type InvitationFace = { name: string; family: string; weight: FontWeight; italic: boolean };

const invitationFaces: readonly InvitationFace[] = Object.values(invitationFonts).map((name) => {
  const [family, weight] = name.split("_");
  return { name, family, weight: Number(weight.slice(0, 3)) as FontWeight, italic: name.endsWith("_Italic") };
});

function invitationFace(family: string | undefined): InvitationFace | undefined {
  if (!family) return undefined;
  return invitationFaces.find((face) => face.name === family)
    ?? invitationFaces.find((face) => face.family === family && face.weight === 400 && !face.italic);
}

/** 같은 글꼴 안에서 가장 가까운 굵기. 기울임 면이 없으면 바로 선 면을 쓴다. */
function nearestInvitationFace(family: string, weight: FontWeight, italic: boolean): InvitationFace {
  const sameFamily = invitationFaces.filter((face) => face.family === family);
  const sameSlant = sameFamily.filter((face) => face.italic === italic);
  const candidates = sameSlant.length > 0 ? sameSlant : sameFamily;
  return candidates.reduce((best, face) => {
    const distance = Math.abs(face.weight - weight);
    const bestDistance = Math.abs(best.weight - weight);
    if (distance !== bestDistance) return distance < bestDistance ? face : best;
    return (weight >= 500) === (face.weight > best.weight) ? face : best;
  });
}

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
  const invitation = invitationFace(family);
  if (invitation) {
    const italic = style?.fontStyle ? style.fontStyle === "italic" : invitation.italic;
    const face = nearestInvitationFace(invitation.family, explicitWeight(style?.fontWeight) ?? invitation.weight, italic);
    return {
      selection: { family: face.name, weight: face.weight },
      // 면마다 따로 등록한 정적 글꼴이다. 안드로이드는 굵기·기울임을 다시 주면 등록한 면 대신
      // 시스템 글꼴을 고른다. 그래서 둘 다 normal 로 두고, 로딩 실패 때만 시스템 굵기·기울임을 쓴다.
      style: loaded
        ? { fontFamily: face.name, fontWeight: "normal", fontStyle: "normal" }
        : { fontFamily: systemFamily, fontWeight: face.weight, fontStyle: face.italic ? "italic" : "normal" },
    };
  }
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
