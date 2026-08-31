export const BETA_COUPLE_ROLE_SUPPORT_COPY = {
  current: "지금 커플 연결은 신부 1명·신랑 1명 구성부터 지원해요.",
  planned:
    "다양한 커플 형태도 개인정보와 대화 기록을 안전하게 지킬 수 있는 구조로 준비하고 있어요.",
} as const;

/**
 * 랜딩·베타 신청처럼 로그인 전 표면에서 쓴다.
 *
 * 위 BETA_COUPLE_ROLE_SUPPORT_COPY 는 역할 선택 화면 전용이다 — 거기서는 사용자가
 * 실제로 신부/신랑 버튼 두 개를 보고 있으므로 그렇게 말하는 게 정확하다. 하지만
 * 중립 준비 공간이 켜지면 온보딩이 역할을 묻지 않으므로, 공개 표면에서 같은 말을
 * 하면 거짓 고지가 된다.
 *
 * 두 모드에서 변하지 않는 사실은 "한 공간에 두 사람"이다. 그래서 인원으로 말한다.
 */
export const PUBLIC_COUPLE_SUPPORT_COPY = {
  current: "지금은 한 공간에서 두 사람이 함께 준비하는 구성부터 지원해요.",
  planned: BETA_COUPLE_ROLE_SUPPORT_COPY.planned,
} as const;

export const PUBLIC_COUPLE_SUPPORT_NOTICES = [
  PUBLIC_COUPLE_SUPPORT_COPY.current,
  PUBLIC_COUPLE_SUPPORT_COPY.planned,
] as const;

export const BETA_COUPLE_ROLE_SUPPORT_NOTICES = [
  BETA_COUPLE_ROLE_SUPPORT_COPY.current,
  BETA_COUPLE_ROLE_SUPPORT_COPY.planned,
] as const;
