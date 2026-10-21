import type { Metadata } from "next";

import { WEDDING_CODE_V20_VERSION } from "@/constants/weddingCodeV20";
import { WEDDING_CODE_V30_VERSION } from "@/constants/weddingCodeV30";
import { WEDDING_CODE_V31_VERSION } from "@/constants/weddingCodeV31";
import { WEDDING_CODE_V40_VERSION } from "@/constants/weddingCodeV40";
import {
  isWeddingCodeResearchContributionOpen,
  isWeddingCodeResearchStorageActive,
} from "@/lib/weddingCode/contribution/server";
import { V40_COPY } from "@/lib/weddingCode/v40/copy";
import { MEASUREMENT_VERSION } from "@/lib/weddingCode/likert/types";
import { CHARACTER_PROFILES_19 } from "@/lib/weddingCode19/data";
import { decodePartnerPayload19, scoreWeddingCode19 } from "@/lib/weddingCode19/engine";

import WeddingCodeReleaseClient from "./WeddingCodeReleaseClient";
import { isLegacyWeddingCodeQuery } from "./releaseEntry";
import {
  WEDDING_CODE_DEFAULT_VERSION,
  parseWeddingCodeEntryQuery,
  weddingCodeDefaultsToV40,
  type WeddingCodeEntrySearchParams,
} from "./entry";

type WeddingCodePageProps = { searchParams: Promise<WeddingCodeEntrySearchParams> };

/**
 * v4.0-tendency 입구의 공유 카드 이미지. 폴더에 화면이 없고 카드 그림만 있다(`v40-card/opengraph-image.tsx`).
 * 크기와 alt 는 그 파일의 `size`, `alt` 와 같은 값이어야 한다(`opengraph-image.test.tsx` 가 견준다).
 */
const V40_CARD_IMAGE = {
  url: "/wedding-code/v40-card/opengraph-image",
  type: "image/png",
  width: 1200,
  height: 630,
  alt: `웨딩코드, ${V40_COPY.intro.title}`,
};

/** 30문항 기본 입구의 카드. 값은 likert-card/opengraph-image.tsx의 계약과 같다. */
const LIKERT_CARD_IMAGE = {
  url: "/wedding-code/likert-card/opengraph-image",
  type: "image/png",
  width: 1200,
  height: 630,
  alt: "웨딩코드, 결혼을 준비하는 나의 언어를 찾아요",
};

/**
 * 기본 입구는 36문항이다. 명시한 30문항 판과 그 fragment는 별도로 유지한다. 명시 구판과 이전 답 쿼리는 원래 판의 설명을 유지한다.
 * 모든 입구는 색인하지 않는다. 기존 fragment 응답은 클라이언트에서만 복원한다. 36문항은 별도 저장 동의 후 서버에 보관한다.
 *
 * 공유 카드(openGraph·twitter)는 이 화면의 제목·설명을 쓴다. 36문항 입구는 r6-card, 명시한 30문항 판은 likert-card,
 * 명시 v4 입구는 v40-card를 images에 지정한다. 나머지 구판은 images 키를 적지 않아
 * 기존 opengraph-image.tsx 카드를 유지한다. 파일 규약 이미지는 쿼리를 읽을 수 없어
 * 이 구분을 metadata가 맡는다. 서버는 fragment를 볼 수 없으므로 fragment만 있는 구판 링크도
 * 새 일반 카드가 나온다. 카드에는 어느 판의 원답이나 개인 결과도 담지 않는다.
 *
 * `og:url` 은 일부러 적지 않는다. 비교 초대 링크(`/wedding-code#v=…&a=…`)도 서버에는 같은
 * `/wedding-code` 로 보여서, `og:url` 을 적으면 카드를 누를 때 그 주소를 따라가는 앱에서 `#` 뒤
 * 답이 빠진 채 열릴 수 있다. 없으면 붙여 넣은 주소를 그대로 쓴다. 검색용 대표 주소는
 * `alternates.canonical` 이 따로 맡는다.
 *
 */
export async function generateMetadata({ searchParams }: WeddingCodePageProps): Promise<Metadata> {
  const search = await searchParams;
  if (!isLegacyWeddingCodeQuery(search)) {
    const rawPartner = typeof search.partner === "string" ? search.partner : undefined;
    const partnerDecoded = rawPartner ? decodePartnerPayload19(rawPartner) : null;
    if (partnerDecoded) {
      const partnerScored = scoreWeddingCode19(partnerDecoded.answers);
      const partnerProfile = CHARACTER_PROFILES_19[partnerScored.code];
      const title = `💌 파트너(${partnerProfile.emoji} ${partnerProfile.characterName})가 보낸 웨딩코드 도착! | 웨딩코드 · 웨딩한방`;
      const description = `파트너의 웨딩코드는 [${partnerProfile.characterName} (${partnerScored.code} · ${partnerProfile.codeTag})]입니다. 나도 19문항(약 3분) 테스트를 완료하면 두 사람의 커플 케미 & 1:1 맞춤 조율 리포트가 바로 열립니다.`;
      const card = { ...LIKERT_CARD_IMAGE, url: "/wedding-code/r6-card/opengraph-image", alt: "웨딩코드, 우리의 결혼 준비 방식" };
      return {
        title,
        description,
        robots: { index: false, follow: false, nocache: true },
        referrer: "no-referrer",
        alternates: { canonical: "/wedding-code" },
        openGraph: { title, description, siteName: "웨딩한방", locale: "ko_KR", type: "website", images: [card] },
        twitter: { card: "summary_large_image", title, description, images: [card] },
      };
    }

    const oldLikert = search.v === MEASUREMENT_VERSION;
    const title = oldLikert ? "나의 결혼 준비 언어 | 웨딩코드 · 웨딩한방" : "우리의 결혼 준비 방식 | 웨딩코드 · 웨딩한방";
    const description = oldLikert
      ? "30개의 문장으로 지출·준비·가족·도움의 기준을 살펴봐요. 각 글자의 뜻과 실제 답의 비율을 확인해요. 혼자서도 결과를 볼 수 있고, 둘 다 답하고 두 사람 결과 링크를 서로 전달하면 각자의 답을 나란히 읽을 수 있어요. 로그인 없이 시작해요."
      : "36개의 결혼 준비 장면에 답하고 내 준비 기준을 살펴봐요. 이름과 함께 답을 풀어 보고, 파트너와 서로 공유한 내용으로 이야기할 장면을 찾아요. 지금의 답을 정리하는 참고용 테스트예요.";
    const card = oldLikert ? LIKERT_CARD_IMAGE : { ...LIKERT_CARD_IMAGE, url: "/wedding-code/r6-card/opengraph-image", alt: "웨딩코드, 우리의 결혼 준비 방식" };
    return { title, description, robots: { index: false, follow: false, nocache: true }, referrer: "no-referrer",
      alternates: { canonical: "/wedding-code" },
      openGraph: { title, description, siteName: "웨딩한방", locale: "ko_KR", type: "website", images: [card] },
      twitter: { card: "summary_large_image", title, description, images: [card] } };
  }
  // 쿼리에 실린 서로 짐작하기(ga, gb)도 답이 든 링크라 색인하지 않는다.
  const carriesAnswers = search.a !== undefined || search.b !== undefined || search.ga !== undefined || search.gb !== undefined;
  const defaultsToV40 = weddingCodeDefaultsToV40(WEDDING_CODE_DEFAULT_VERSION);
  const bare = search.v === undefined && !carriesAnswers;
  const isV40 = search.v === WEDDING_CODE_V40_VERSION || (bare && defaultsToV40);
  const isPreferences = !isV40 && (search.v === WEDDING_CODE_V31_VERSION || search.v === WEDDING_CODE_V30_VERSION || (bare && !defaultsToV40));
  const isV20 = search.v === WEDDING_CODE_V20_VERSION;
  const title = isV40 ? `${V40_COPY.intro.title} | 웨딩코드 · 웨딩한방`
    : isPreferences ? "내가 원하는 결혼식과 준비 방식 | 웨딩코드 · 웨딩한방"
    : isV20 ? "내 웨딩 준비 방식 알아보기 | 웨딩코드 · 웨딩한방"
    : "결혼 준비 장면, 나라면? | 웨딩코드 · 웨딩한방";
  const description = isV40 ? V40_COPY.intro.lede
    : isPreferences
    ? "결혼식 취향과 준비 방식, 꼭 지키고 싶은 것과 돈을 더 쓰고 싶은 곳을 함께 살펴봐요. 혼자서도 결과를 볼 수 있고, 둘 다 답하고 서로 공유하면 함께 원하는 것과 먼저 의논할 부분을 나란히 볼 수 있어요."
    : isV20
      ? "결혼 준비 16개 문장에 답하며 무엇을 먼저 보고, 어떻게 나누고, 가족과 어디까지 상의하고, 어떤 도움을 원하는지 알아봐요. 성격검사나 궁합 결과가 아니라 둘이 이야기할 시작점을 보여줘요."
      : "결혼 준비 장면에 답하면 내 웨딩코드 네 글자가 나와요. 점수를 매기거나 궁합을 보지 않고, 둘이 어디서 다르게 골랐는지 나란히 보여줘요. 로그인 없이 바로 할 수 있어요.";
  return {
    title,
    description,
    robots: { index: false, follow: false },
    referrer: "no-referrer",
    alternates: { canonical: "/wedding-code" },
    openGraph: {
      title,
      description,
      siteName: "웨딩한방",
      locale: "ko_KR",
      type: "website",
      ...(isV40 ? { images: [V40_CARD_IMAGE] } : {}),
    },
    twitter: { card: "summary_large_image", title, description, ...(isV40 ? { images: [V40_CARD_IMAGE] } : {}) },
  };
}

function shareOrigin(): string {
  const site = process.env.NEXT_PUBLIC_SITE_URL;
  if (site) return site.replace(/\/$/, "");
  return "https://hanbang.ai";
}

export default async function WeddingCodePage({ searchParams }: WeddingCodePageProps) {
  const search = await searchParams;
  const initialEntry = parseWeddingCodeEntryQuery(search, { defaultVersion: WEDDING_CODE_DEFAULT_VERSION });
  return (
    <WeddingCodeReleaseClient
      queryIsLegacy={isLegacyWeddingCodeQuery(search)}
      explicitLikert={search.v === MEASUREMENT_VERSION}
      shareOrigin={shareOrigin()}
      initialEntry={initialEntry}
      researchContributionOpen={isWeddingCodeResearchContributionOpen()}
      researchStorageActive={isWeddingCodeResearchStorageActive()}
    />
  );
}
