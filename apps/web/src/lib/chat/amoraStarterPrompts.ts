/**
 * 첫 화면의 시작 칩.
 *
 * 2026-09-04: 모바일(`apps/mobile/app/(tabs)/chat.tsx` 의 AMORA_STARTER_PROMPTS)에는
 * 있었고 웹에는 데모 화면에만 있었다. "무엇을 물어야 하지" 가 가장 큰 사람에게
 * 빈 화면을 주던 자리다. 문구는 모바일과 같다 — 두 자리가 갈리면 여기부터 맞춘다.
 */
export const AMORA_STARTER_PROMPTS = [
  "웨딩 사진 촬영 예산을 정리해줘",
  "지금 먼저 할 일 세 가지를 알려줘",
  "결혼식장 계약 전에 무엇을 확인해야 해?",
] as const;
