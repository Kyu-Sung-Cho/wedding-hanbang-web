import type { Metadata } from "next";

import { WEDDING_CODE_V20_VERSION } from "@/constants/weddingCodeV20";
import { decodeWeddingCodeV20 } from "@/lib/weddingCode/v20";
import { decodeWeddingCodeV06 } from "@/lib/weddingCode/v06/code";
import {
  CURRENT_WEDDING_CODE_SCENE_CONFIG,
  resolveWeddingCodeSceneConfig,
  weddingCodeSceneCountLabel,
} from "@/lib/weddingCode/scene/config";

const SCENE_COUNT = weddingCodeSceneCountLabel(
  CURRENT_WEDDING_CODE_SCENE_CONFIG.questions.length,
);
import WeddingCodeEntryClient from "./WeddingCodeEntryClient";
import { parseWeddingCodeEntryQuery } from "./entry";
import {
  isWeddingCodeResearchContributionOpen,
  isWeddingCodeResearchStorageActive,
} from "@/lib/weddingCode/contribution/server";

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
 * 두 사람이 실제로 고른 문장을 그대로 인용한 뒤 다음 대화 절차만 제안한다. 심리 측정
 * 결과가 아니므로 심리검사 타당도를 주장하지 않지만, 문항 이해도와 대화 유용성은 별도의
 * 사람 검증이 필요하다.
 *
 * ## 색인
 *
 * 새 링크는 답을 `#` 뒤에 넣는다. fragment는 서버 요청에도 referrer에도 검색엔진에도
 * 가지 않으므로, **답이 없는 맨 주소는 색인해도 남의 답이 노출되지 않는다.** 반대로 과거
 * `?a=`·`?b=` 링크에는 누군가의 실제 응답이 query에 들어 있어서 색인하면 안 된다.
 * 그래서 색인 여부를 라우트 전체가 아니라 **주소에 답이 실려 있는지**로 가른다.
 *
 * 이걸 라우트째 막아두면 「여러 예비부부가 쓰는 도구」가 될 길이 없다 — 검색으로 찾을 수
 * 없고 공유 링크에도 색인이 안 붙는다. 보호해야 할 것은 응답이지 입구가 아니다.
 */
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ v?: string; a?: string; b?: string }>;
}): Promise<Metadata> {
  const { v, a, b } = await searchParams;
  const isV20 = v === WEDDING_CODE_V20_VERSION || (!a && !b);
  const carriesAnswers = Boolean(a || b);
  return {
    title: isV20 ? "내 웨딩 준비 방식 알아보기 | 웨딩코드 · 웨딩한방" : `결혼 준비 ${SCENE_COUNT} 장면, 나라면? | 웨딩코드 · 웨딩한방`,
    description: isV20
      ? "결혼 준비 16개 문장에 답하며 무엇을 먼저 보고, 어떻게 나누고, 가족과 어디까지 상의하고, 어떤 도움을 원하는지 알아봐요. 성격검사나 궁합 결과가 아니라 둘이 이야기할 시작점을 보여줘요."
      : `결혼 준비 ${SCENE_COUNT} 장면에 답하면 내 웨딩코드 네 글자가 나와요. 점수를 매기거나 궁합을 보지 않고, 둘이 어디서 다르게 골랐는지 나란히 보여줘요. 로그인 없이 바로 할 수 있어요.`,
    robots: carriesAnswers
      ? { index: false, follow: false }
      : { index: true, follow: true },
    // 답이 실린 주소로 들어온 경우에도 다음 이동에 그 주소가 새지 않게 한다.
    referrer: "no-referrer",
    alternates: { canonical: "/wedding-code" },
  };
}

function shareOrigin(): string {
  const site = process.env.NEXT_PUBLIC_SITE_URL;
  if (site) return site.replace(/\/$/, "");
  return "https://hanbang.ai";
}

export default async function WeddingCodePage({
  searchParams,
}: {
  searchParams: Promise<{ v?: string; a?: string; b?: string }>;
}) {
  const { v, a, b } = await searchParams;
  const initialEntry = parseWeddingCodeEntryQuery({ v, a, b });
  const resolvedConfig = resolveWeddingCodeSceneConfig(v, Boolean(a || b));
  const config = resolvedConfig ?? CURRENT_WEDDING_CODE_SCENE_CONFIG;
  const first = resolvedConfig ? decodeWeddingCodeV06(a, config.questions) : null;
  const second = resolvedConfig ? decodeWeddingCodeV06(b, config.questions) : null;
  const v20First = v === WEDDING_CODE_V20_VERSION ? decodeWeddingCodeV20(a) : null;
  const v20Second = v === WEDDING_CODE_V20_VERSION ? decodeWeddingCodeV20(b) : null;

  // 코드가 둘 다 성립할 때만 곧바로 차이 지도를 연다. 하나라도 망가졌으면
  // 조용히 기본값을 채우지 않고 처음부터 답하게 한다 — 고르지도 않은 답을
  // 「상대는 이렇게 답했어요」로 보여주는 것이 이 제품에서 제일 나쁜 버그다.
  const both = first && second ? { first, second } : null;

  return (
    <WeddingCodeEntryClient
      shareOrigin={shareOrigin()}
      initialEntry={initialEntry}
      v20Initial={{
        partnerAnswers: v20Second ? null : v20First,
        partnerCode: v20First ? (a ?? "").trim() : null,
        bothAnswers: v20First && v20Second ? { first: v20First, second: v20Second, firstCode: (a ?? "").trim() } : null,
      }}
      // 새 입구에는 문항판 버전이 없어도 v20을 연다. 구판 판은 실제로 답이 실린
      // 예전 query 링크에서만 복원한다. 그렇지 않으면 clean `/wedding-code`가
      // 서버의 현재 레거시 config를 물려받아 새 질문판에 도달하지 못한다.
      legacyInitial={(a || b) && v !== WEDDING_CODE_V20_VERSION ? {
        version: config.version,
        partnerAnswers: both ? null : first,
        partnerCode: first ? (a ?? "").trim().toUpperCase() : null,
        bothCodes: both,
      } : null}
      researchContributionOpen={isWeddingCodeResearchContributionOpen()}
      researchStorageActive={isWeddingCodeResearchStorageActive()}
    />
  );
}
