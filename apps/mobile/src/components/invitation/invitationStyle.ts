import type { ImageStyle, TextStyle } from "react-native";
import { invitationPalette, invitationShadow } from "@hanbang/design-tokens";
import { invitationFonts } from "@/lib/appFonts";

/**
 * 청첩장 디자인(2026-11-17) 네이티브 공용 값. 파운더 디자인 아티팩트(원문: "이 디자인 완전 같아야해")의
 * 인라인 스타일을 그대로 옮긴다. 색은 `invitationPalette`, 그림자는 `invitationShadow` 를 쓴다.
 *
 * 그림자는 React Native 의 `boxShadow`(새 아키텍처, 코어 기능)로 CSS 문자열을 그대로 쓴다.
 * 그래서 두 겹 그림자, 안쪽 고리, 퍼짐 값이 아티팩트와 같다. 새 네이티브 모듈이 필요 없다.
 */
export const palette = invitationPalette;
export const shadow = invitationShadow;
export const fonts = invitationFonts;

/** 팔레트에 없는 반투명 흰색. 아티팩트는 이 위에 `backdrop-filter: blur` 를 얹지만 네이티브는 흐림 없이 같은 색만 쓴다. */
export const glass = {
  /** 시작 화면 아래 카드. */
  startCard: "rgba(255,255,255,0.86)",
  /** 떠 있는 하단 메뉴, 웨딩홀 사진 위 꼬리표. */
  bar: "rgba(255,255,255,0.88)",
  /** 첫 머리글자, 하트 단추, 상담 화면 사진 위 단추. */
  chip: "rgba(255,255,255,0.9)",
  /** 상담 화면 뒤로 단추. */
  back: "rgba(255,255,255,0.85)",
  /** 시작 화면 부제. */
  tagline: "rgba(255,255,255,0.9)",
  /** 홈 청첩장 칸 막대 중 빈 칸. */
  barEmpty: "rgba(255,255,255,0.4)",
} as const;

/** CSS 의 em 글자 간격을 px 로. */
export function em(fontSize: number, value: number): number {
  return Math.round(fontSize * value * 100) / 100;
}

/** CSS 의 단위 없는 줄 높이를 px 로. */
export function lineHeight(fontSize: number, ratio: number): number {
  return Math.round(fontSize * ratio * 100) / 100;
}

/** 안드로이드의 글꼴 위아래 여백을 빼 CSS 와 같은 줄 상자를 만든다. */
const box: TextStyle = { includeFontPadding: false };

export const typo = {
  sans: { ...box, fontFamily: fonts.sans, color: palette.ink } satisfies TextStyle,
  sansMedium: { ...box, fontFamily: fonts.sans, fontWeight: "500", color: palette.ink } satisfies TextStyle,
  sansBold: { ...box, fontFamily: fonts.sans, fontWeight: "700", color: palette.ink } satisfies TextStyle,
  serif: { ...box, fontFamily: fonts.serif, color: palette.ink } satisfies TextStyle,
  serifBold: { ...box, fontFamily: fonts.serif, fontWeight: "700", color: palette.ink } satisfies TextStyle,
  numeral: { ...box, fontFamily: fonts.numeral, color: palette.ink } satisfies TextStyle,
  numeralMedium: { ...box, fontFamily: fonts.numeral, fontWeight: "500", color: palette.ink } satisfies TextStyle,
  numeralItalic: { ...box, fontFamily: fonts.numeralItalic, color: palette.ink } satisfies TextStyle,
  numeralMediumItalic: { ...box, fontFamily: fonts.numeralMediumItalic, color: palette.ink } satisfies TextStyle,
} as const;

/** 아티팩트 본문 문단(17px, 줄 높이 1.65). 홈·첫 대화·비교·상담이 같이 쓴다. */
export const paragraph17: TextStyle = { ...typo.sans, fontSize: 17, lineHeight: lineHeight(17, 1.65) };

/**
 * 사진을 상자 가득 채운다. 아티팩트의 `inset: 0; width: 100%; height: 100%; object-fit: cover` 와 같다
 * (`resizeMode="cover"` 와 함께 쓴다). React Native 의 Image 는 require 한 사진의 원래 크기(900×640,
 * 900×1400)를 기본 너비·높이로 쓰므로 absoluteFill 만 주면 사진이 원래 크기로 왼쪽 위에 붙어 확대된 것처럼
 * 잘리고, 웹에서는 화면보다 넓은 문서가 된다. 너비·높이를 100% 로 덮어써야 한다.
 */
export const photoFill: ImageStyle = { position: "absolute", top: 0, left: 0, width: "100%", height: "100%" };

/**
 * 흰 화면의 스크롤 영역 바탕. 뒤의 화면도 흰색이라 보이는 차이는 없다. 웹(Chrome)은 바탕이 투명한 스크롤 영역의
 * 글자를 회색조로만 다듬어서, 아티팩트와 같은 선명한(서브픽셀) 글자가 되도록 바탕을 칠해 둔다.
 */
export const opaqueScroll = { backgroundColor: invitationPalette.white } as const;

/**
 * 아티팩트가 글자색을 적지 않은 단추 글자(상담 화면의 "캘린더에 있어요"·"준호 님과 공유"·"다른 시간 묻기").
 * 파운더가 본 Chrome 은 단추 기본 글자색(buttontext, #000000)으로 그렸다. 그 색을 그대로 쓴다.
 */
export const BROWSER_BUTTON_TEXT = "#000000";

/** 44pt 보다 낮게 그린 알약이 누를 자리를 44pt 로 넓힌다. */
export function hitSlopFor(height: number, width?: number) {
  const vertical = Math.max(0, Math.ceil((44 - height) / 2));
  const horizontal = width === undefined ? 0 : Math.max(0, Math.ceil((44 - width) / 2));
  return { top: vertical, bottom: vertical, left: horizontal, right: horizontal };
}
