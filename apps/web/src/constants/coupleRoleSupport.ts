export const BETA_COUPLE_ROLE_SUPPORT_COPY = {
  current: "현재 베타 커플 연결은 신부 1명·신랑 1명 구성부터 지원해요.",
  planned:
    "다양한 커플 형태도 개인정보와 대화 기록을 안전하게 지킬 수 있는 구조로 준비하고 있어요.",
} as const;

export const BETA_COUPLE_ROLE_SUPPORT_NOTICES = [
  BETA_COUPLE_ROLE_SUPPORT_COPY.current,
  BETA_COUPLE_ROLE_SUPPORT_COPY.planned,
] as const;
