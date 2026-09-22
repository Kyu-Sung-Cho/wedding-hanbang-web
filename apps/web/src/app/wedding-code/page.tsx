import type { Metadata } from "next";

import { WEDDING_CODE_V20_VERSION } from "@/constants/weddingCodeV20";
import { WEDDING_CODE_V30_VERSION } from "@/constants/weddingCodeV30";
import {
  isWeddingCodeResearchContributionOpen,
  isWeddingCodeResearchStorageActive,
} from "@/lib/weddingCode/contribution/server";

import WeddingCodeEntryClient from "./WeddingCodeEntryClient";
import { parseWeddingCodeEntryQuery, type WeddingCodeEntrySearchParams } from "./entry";

type WeddingCodePageProps = { searchParams: Promise<WeddingCodeEntrySearchParams> };

/** 응답이 없는 입구만 색인한다. 새 응답은 클라이언트의 fragment에서만 복원한다. */
export async function generateMetadata({ searchParams }: WeddingCodePageProps): Promise<Metadata> {
  const search = await searchParams;
  const carriesAnswers = search.a !== undefined || search.b !== undefined;
  const isV30 = search.v === WEDDING_CODE_V30_VERSION || (search.v === undefined && !carriesAnswers);
  const isV20 = search.v === WEDDING_CODE_V20_VERSION;
  return {
    title: isV30 ? "내가 원하는 결혼식과 준비 방식 | 웨딩코드 · 웨딩한방"
      : isV20 ? "내 웨딩 준비 방식 알아보기 | 웨딩코드 · 웨딩한방"
      : "결혼 준비 장면, 나라면? | 웨딩코드 · 웨딩한방",
    description: isV30
      ? "결혼식 취향과 준비 방식, 꼭 지키고 싶은 것과 돈을 더 쓰고 싶은 곳을 함께 살펴봐요. 혼자 내 결과를 보고, 상대도 답하면 함께 원하는 것과 먼저 의논할 부분을 나란히 볼 수 있어요."
      : isV20
        ? "결혼 준비 16개 문장에 답하며 무엇을 먼저 보고, 어떻게 나누고, 가족과 어디까지 상의하고, 어떤 도움을 원하는지 알아봐요. 성격검사나 궁합 결과가 아니라 둘이 이야기할 시작점을 보여줘요."
        : "결혼 준비 장면에 답하면 내 웨딩코드 네 글자가 나와요. 점수를 매기거나 궁합을 보지 않고, 둘이 어디서 다르게 골랐는지 나란히 보여줘요. 로그인 없이 바로 할 수 있어요.",
    robots: carriesAnswers
      ? { index: false, follow: false }
      : { index: true, follow: true },
    referrer: "no-referrer",
    alternates: { canonical: "/wedding-code" },
  };
}

function shareOrigin(): string {
  const site = process.env.NEXT_PUBLIC_SITE_URL;
  if (site) return site.replace(/\/$/, "");
  return "https://hanbang.ai";
}

export default async function WeddingCodePage({ searchParams }: WeddingCodePageProps) {
  const initialEntry = parseWeddingCodeEntryQuery(await searchParams);
  return (
    <WeddingCodeEntryClient
      shareOrigin={shareOrigin()}
      initialEntry={initialEntry}
      researchContributionOpen={isWeddingCodeResearchContributionOpen()}
      researchStorageActive={isWeddingCodeResearchStorageActive()}
    />
  );
}
