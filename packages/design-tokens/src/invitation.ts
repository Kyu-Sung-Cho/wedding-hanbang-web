/**
 * 청첩장 디자인(2026-11-17) — 파운더가 만든 디자인 아티팩트
 * "아모라 AI 웨딩비서 · 서비스 화면 예시"의 값을 그대로 옮긴 것이다.
 * 파운더 원문: "이 디자인 완전 같아야해".
 *
 * 콘셉트(아티팩트 메모): 아모라가 두 분의 청첩장을 채워 가는 앱. 홈은 빈칸이 있는
 * 청첩장이고, 일이 진행될수록 날짜와 장소가 채워진다. 아모라는 빛나는 오브이고 일할 때
 * 더 빠르게 돈다. 글꼴은 고운바탕 + Cormorant 숫자 + Noto Sans KR.
 *
 * 웹과 네이티브가 이 파일 하나에서 같은 값을 읽는다. 값을 바꾸면 두 곳이 함께 바뀐다.
 */

export const invitationPalette = {
  /** 글자와 주 버튼 채움. 아티팩트 전체의 기준 잉크. */
  ink: "#1E1C22",
  /** 보조 설명 글자, 링크를 올렸을 때. */
  muted: "#6B6570",
  /** 본문 보조(긴 설명, 꺼진 칩 글자). */
  body: "#4E4852",
  /** 청첩장의 빈칸 안내처럼 한 단계 더 흐린 글자. */
  faint: "#8A8188",
  /** 편지 본문 글자. */
  letter: "#3A353D",
  /** 시작 화면 바탕, "함께" 꼬리표, 첫 사람 머리글자. */
  blush: "#F3E4E1",
  /** 사람 말풍선, 보조 버튼, 이름 꼬리표. */
  stone: "#F4F2F0",
  /** 달 고르기 카드, 편지 종이. */
  paper: "#FBFAF8",
  /** "무엇을 했나요" 목록, 물어볼 것 상자, 입력칸. */
  paperSoft: "#FAF8F6",
  /** 웹 오른쪽 준비 공간 바탕. */
  paperPanel: "#FCFBFA",
  white: "#FFFFFF",
  /** 카드 테두리(그림자 대신 1px 고리). */
  ring: "#EEEAE6",
  /** 칩·보조 버튼 테두리. */
  chipLine: "#E6E1DC",
  /** 구역 나눔선. */
  divider: "#F1EEEB",
  /** 목록 줄 나눔선. */
  rowLine: "#F3F0EE",
  /** 편지 서명 위 선. */
  letterRule: "#ECE6DF",
  /** 청첩장 안쪽 금빛 테두리. */
  goldLine: "#E3D3B8",
  /** 청첩장 가운데 짧은 금빛 선. */
  goldRule: "#B8975F",
  /** 금빛 글자("우리 결혼합니다", 단계 번호, 완료 표시). */
  goldInk: "#8C6F45",
  /** 홈 청첩장의 빈칸. */
  blank: "#CFC5BC",
  /** 첫 대화 청첩장 초안의 빈칸. */
  blankSoft: "#C2B7AE",
  /** 준비 순서의 지금 단계 면. */
  stepNow: "#F7EDEA",
  /** 웨딩홀 담기(하트)를 켰을 때. */
  heart: "#E8909F",
  /** 확인이 필요한 값(보증 인원이 많을 때). */
  warn: "#9A3F1C",
  /** 꺼진 스위치. */
  switchOff: "#E1DCD7",
  /** 넣기 버튼의 점선. */
  dashed: "#D8CFC6",
  /** 끝난 단계의 번호. */
  doneNumber: "#B8AFA7",
  /** 뺀 단계의 글자. */
  offText: "#A79FA4",
  /** 편지 확인 시트 뒤의 어두운 바탕. */
  sheetBackdrop: "#2A2422",
} as const;

/** 그림자는 CSS 문자열 그대로다(웹). 네이티브는 같은 값을 자기 그림자 속성으로 옮긴다. */
export const invitationShadow = {
  /** 보케 위에 뜬 청첩장 카드. */
  invitationCard: "0 18px 40px rgba(80,40,40,0.18)",
  /** 상담 확정 카드(초록 사진 위). */
  statusCard: "0 18px 40px rgba(30,50,30,0.22)",
  /** 첫 대화의 청첩장 초안 카드. */
  draftCard: "0 1px 2px rgba(30,28,34,0.06), 0 8px 24px rgba(30,28,34,0.07)",
  /** 보내기 전 편지. */
  letter: "0 1px 2px rgba(30,28,34,0.06), 0 10px 28px rgba(30,28,34,0.08)",
  /** 떠 있는 하단 메뉴. */
  tabBar: "0 6px 24px rgba(30,28,34,0.10), inset 0 0 0 1px rgba(30,28,34,0.05)",
  /** 카드 테두리 고리. */
  ring: "0 0 0 1px #EEEAE6",
  /** 안쪽 고리(달 고르기 카드, 입력칸). */
  insetRing: "inset 0 0 0 1px #EEEAE6",
  /** 스위치 손잡이. */
  knob: "0 1px 3px rgba(0,0,0,0.18)",
  /** 두 번째 머리글자 둘레. */
  avatarHalo: "0 0 0 2px rgba(255,255,255,0.5)",
  avatarHaloOnWhite: "0 0 0 2px #FFFFFF",
} as const;

export const invitationRadius = {
  sheet: 36,
  approveSheet: 34,
  tabBar: 32,
  webHero: 32,
  button56: 28,
  button54: 27,
  webCard: 26,
  card: 24,
  button46: 23,
  chip44: 22,
  button42: 21,
  bubble: 20,
  button38: 19,
  stepNow: 18,
  button34: 17,
  draftInner: 17,
  month: 14,
  invitation: 6,
  pill: 999,
} as const;

/** 글꼴 이름. 웹은 next/font 변수로, 네이티브는 expo-font 로 같은 글꼴을 싣는다. */
export const invitationFontFamily = {
  /** 한글 제목·이름·편지(고운바탕). */
  serifKr: "Gowun Batang",
  /** 숫자·날짜·로고(Cormorant Garamond). */
  numeral: "Cormorant Garamond",
  /** 본문(Noto Sans KR). */
  sans: "Noto Sans KR",
} as const;

/**
 * 아모라 오브. 아티팩트 `Amora.dc.html` 의 SVG 를 그대로 데이터로 옮겼다.
 * 200×200 좌표계, 반지름 78 의 원 안에서 세 무리가 서로 다른 빠르기로 돈다.
 * 일할 때(`working`)는 더 빨리 돌고, 움직임 줄이기 설정이면 멈춘다.
 */
export const amoraOrb = {
  viewBox: "0 0 200 200",
  center: 100,
  clipRadius: 78,
  gradients: {
    base: { cx: "50%", cy: "42%", r: "62%", stops: [[0, "#FFF4EF", 1], [1, "#F7C9CF", 1]] },
    pink: { cx: "50%", cy: "50%", r: "50%", stops: [[0, "#EE7F9B", 0.95], [0.55, "#EE7F9B", 0.45], [1, "#EE7F9B", 0]] },
    lilac: { cx: "50%", cy: "50%", r: "50%", stops: [[0, "#B49CF0", 0.9], [0.55, "#B49CF0", 0.4], [1, "#B49CF0", 0]] },
    gold: { cx: "50%", cy: "50%", r: "50%", stops: [[0, "#F7C67E", 0.95], [0.55, "#F7C67E", 0.4], [1, "#F7C67E", 0]] },
    white: { cx: "50%", cy: "50%", r: "50%", stops: [[0, "#FFFFFF", 0.95], [0.5, "#FFFFFF", 0.45], [1, "#FFFFFF", 0]] },
    rim: { cx: "50%", cy: "50%", r: "50%", stops: [[0.7, "#FFFFFF", 0], [0.94, "#FFFFFF", 0.35], [1, "#FFFFFF", 0.8]] },
    glow: { cx: "50%", cy: "50%", r: "50%", stops: [[0.62, "#F29AB0", 0.4], [1, "#F29AB0", 0]] },
  },
  /** 오브 바깥으로 숨 쉬는 빛. */
  halo: { r: 99, gradient: "glow" },
  /** 서로 다른 빠르기로 도는 세 무리. `direction` -1 은 거꾸로 돈다. */
  layers: [
    {
      id: "a",
      direction: 1,
      ellipses: [
        { cx: 70, cy: 138, rx: 86, ry: 70, gradient: "pink" },
        { cx: 150, cy: 58, rx: 66, ry: 60, gradient: "lilac" },
      ],
    },
    {
      id: "b",
      direction: -1,
      ellipses: [
        { cx: 150, cy: 150, rx: 62, ry: 54, gradient: "gold" },
        { cx: 40, cy: 70, rx: 50, ry: 46, gradient: "gold", opacity: 0.55 },
      ],
    },
    {
      id: "c",
      direction: 1,
      ellipses: [
        { cx: 100, cy: 100, rx: 84, ry: 20, gradient: "white", rotate: -24 },
        { cx: 80, cy: 62, rx: 40, ry: 24, gradient: "white", opacity: 0.8 },
      ],
    },
  ],
  /** 테두리 빛과 가는 흰 선. */
  rim: { r: 78, gradient: "rim" },
  outline: { r: 77.5, color: "#FFFFFF", opacity: 0.75, width: 1 },
  /** 한 바퀴 도는 데 걸리는 초. 일할 때 값은 `busySeconds`. */
  calmSeconds: { a: 14, b: 19, c: 26, halo: 5 },
  busySeconds: { a: 3.6, b: 5, c: 6.5, halo: 1.5 },
  /** 숨 쉬는 빛의 크기와 투명도 범위. */
  breathe: { scaleFrom: 0.94, scaleTo: 1.04, opacityFrom: 0.75, opacityTo: 1 },
  labels: { calm: "아모라", working: "아모라, 일하는 중" },
} as const;

export type AmoraOrbMood = "calm" | "happy" | "working";
export type AmoraOrbGradientId = keyof typeof amoraOrb.gradients;
