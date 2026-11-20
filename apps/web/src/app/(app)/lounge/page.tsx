import LiveLounge from "@/components/invitation/live/LiveLounge";

/**
 * 웨딩 라운지. 2026-11-17 파운더 디자인 아티팩트(원문: "이 디자인 완전 같아야해")의 청첩장 홈이다 —
 * 좁은 화면은 청첩장 홈, 넓은 화면은 대화 옆 두 사람의 준비 공간, 조건이 비어 있으면 첫 대화.
 * 제목은 `layout.tsx` 가 낸다.
 */
export default function LoungePage() {
  return <LiveLounge />;
}
