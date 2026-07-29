import type { Metadata } from "next";

import { decodeWeddingCodeV06 } from "@/lib/weddingCode/v06/code";
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
 * `?a=`·`?b=`가 붙은 주소에는 **누군가의 실제 응답**이 들어 있다. 색인되면 남의 답이
 * 검색 결과에 남으므로 이 라우트는 통째로 색인하지 않는다.
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

export default async function WeddingCodePage({
  searchParams,
}: {
  searchParams: Promise<{ a?: string; b?: string }>;
}) {
  const { a, b } = await searchParams;
  const first = decodeWeddingCodeV06(a);
  const second = decodeWeddingCodeV06(b);

  // 코드가 둘 다 성립할 때만 곧바로 차이 지도를 연다. 하나라도 망가졌으면
  // 조용히 기본값을 채우지 않고 처음부터 답하게 한다 — 고르지도 않은 답을
  // 「상대는 이렇게 답했어요」로 보여주는 것이 이 제품에서 제일 나쁜 버그다.
  const both = first && second ? { mine: second, theirs: first } : null;

  return (
    <WeddingCodeV06Client
      shareOrigin={shareOrigin()}
      partnerAnswers={both ? null : first}
      partnerCode={first ? (a ?? "").trim().toUpperCase() : null}
      bothCodes={both}
    />
  );
}
