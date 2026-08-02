import type { Metadata } from "next";

import WeddingCodeV06Client from "./WeddingCodeV06Client";

/**
 * 웨딩코드 v0.6.
 *
 * ## 왜 다시 열었나
 *
 * 이 화면은 「정식 검증을 준비하고 있어요」 안내로 닫혀 있었다. 닫은 이유는 **문항과 결과가
 * 성격을 단정하기 때문**이었다 — 사람 대상 타당도 근거 없이 「당신은 X형이에요」라고 말하면
 * 검증 없이 주장을 파는 것이 된다.
 *
 * v0.6는 그 주장을 **설계에서 제거**했다. 점수·유형·궁합·등급을 계산하지도 보여주지도 않고,
 * 두 사람이 실제로 고른 문장을 그대로 인용한 뒤 그 차이가 결혼 준비 일정에서 언제 또
 * 나오는지만 말한다. 「너는 "삼백이면 신혼여행 한 번인데", 나는 "여기 아니면 두고두고
 * 아쉬울 것 같았다"」는 심리 측정 결과가 아니라 두 사람이 방금 남긴 사실이다.
 * 검증할 주장이 없으므로 검증 게이트의 대상이 아니다.
 *
 * ## 색인
 *
 * 현재 공유 응답은 서버·로그·리퍼러에 실리지 않도록 URL fragment에만 둔다. 과거
 * 쿼리 링크는 프록시에서 값을 폐기하며 이 라우트는 계속 통째로 색인하지 않는다.
 */
export const metadata: Metadata = {
  title: "웨딩코드 — 결혼 준비 열여섯 장면 | 웨딩한방",
  description:
    "결혼 준비 열여섯 장면에 각자 답하고, 두 사람이 어디서 갈렸는지 나란히 봅니다."
    + " 점수·유형·궁합은 없고 로그인도 필요 없습니다.",
  robots: { index: false, follow: false },
};

function shareOrigin(): string {
  const site = process.env.NEXT_PUBLIC_SITE_URL;
  if (site) return site.replace(/\/$/, "");
  return "https://hanbang.ai";
}

export default function WeddingCodePage() {
  return (
    <WeddingCodeV06Client shareOrigin={shareOrigin()} />
  );
}
