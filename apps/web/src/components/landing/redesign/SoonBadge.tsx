import { landingContent } from "./landingContent";

/**
 * "곧 열려요" 꼬리표.
 *
 * 2026-11-18 리드 결정: 공개 화면은 오늘 되는 것만 약속한다. 웨딩홀 비교와 문의 글 준비는 운영에
 * 아직 열리지 않아(홀 자료 0곳, 보내기 스위치 꺼짐) 이 꼬리표와 함께만 나온다. 꼬리표를 단 카드는
 * `data-landing-soon` 을 갖고, `landingComingSoonClaims.test.ts` 가 그 짝을 렌더 결과에서 확인한다.
 * 꼬리표가 있어도 아모라가 업체에 대신 보낸다고 말하지 않는다(파운더 결정 D-83).
 *
 * 누르는 것이 아니라 글자다. 색은 아티팩트의 "함께" 꼬리표(분홍 바탕, 먹색 글자)를 따른다.
 */
export default function SoonBadge() {
  return (
    <span className="inline-flex h-7 items-center rounded-full bg-inv-blush px-3 text-[12px] font-medium text-inv-ink">
      {landingContent.soon.label}
    </span>
  );
}
