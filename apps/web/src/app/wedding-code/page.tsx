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

import WeddingCodeEntryClient from "./WeddingCodeEntryClient";
import {
  WEDDING_CODE_DEFAULT_VERSION,
  isKnownWeddingCodeVersion,
  normalizeWeddingCodeVersion,
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

/**
 * 응답이 없는 입구만 색인한다. 새 응답은 클라이언트의 fragment에서만 복원한다.
 *
 * 공유 카드(openGraph·twitter)는 이 화면의 제목·설명을 그대로 쓴다. 여기서 정하지 않으면
 * 루트 layout 의 카드(아모라 문구, `og:url=/landing`)를 통째로 물려받는다. 카드 이미지는
 * 같은 폴더의 `opengraph-image.tsx` 가 붙인다(여기서 `images` 를 적으면 그 파일이 밀려난다).
 * 그 파일은 쿼리를 읽을 수 없어 판을 가리지 못하므로, v4 입구만 일부러 `images` 를 적어 v3.1 문장이 든 기본 카드를 밀어내고
 * v4 카드(`v40-card/opengraph-image.tsx`)를 붙인다. 다른 판은 `images` 키를 아예 적지 않아 지금과 같다.
 * 판이 `#` 뒤에만 실린 옛 v4 링크(`/wedding-code#v=v4.0-tendency&a=…`)는 서버가 판을 몰라 기본 카드가 나간다. 지금 만드는 답 링크는 쿼리에도 판 이름을 실어
 * (`/wedding-code?v=v4.0-tendency#v=v4.0-tendency&a=…`) 이 v4 카드가 나간다(2026-10-04 감사 A68, A15).
 * 답은 `#` 뒤에 있어 서버가 못 읽으므로 카드에 답이 들어갈 길은 없다.
 *
 * `og:url` 은 일부러 적지 않는다. 비교 초대 링크(`/wedding-code#v=…&a=…`)도 서버에는 같은
 * `/wedding-code` 로 보여서, `og:url` 을 적으면 카드를 누를 때 그 주소를 따라가는 앱에서 `#` 뒤
 * 답이 빠진 채 열릴 수 있다. 없으면 붙여 넣은 주소를 그대로 쓴다. 검색용 대표 주소는
 * `alternates.canonical` 이 따로 맡는다.
 *
 * 판 이름은 입구(entry.ts)와 같은 읽기로 읽는다: 끝에 점이나 괄호 같은 글자가 붙은 `?v=v4.0-tendency.` 도 입구가 v4 로 여는 주소이므로 제목과 카드도 v4 것이다.
 * 알 수 없는 판 이름(오타, 대소문자, 폐기된 값)은 입구가 열 수 없는 링크 안내를 보이는 주소다. 그 주소의 제목과 카드는 현재 기본 판의 것을 쓰고
 * (폐기된 장면 판 제목이 나가지 않게), 색인하지 않는다.
 *
 * v4.0-tendency(`?v=v4.0-tendency`)는 새로 만든 질문이라 색인하지 않는다. 기본 진입이 v4 로 바뀐 뒤에도
 * 재검사 통과 전까지 이 경로 전체가 색인 밖이다(계약 문서 13절).
 */
export async function generateMetadata({ searchParams }: WeddingCodePageProps): Promise<Metadata> {
  const search = await searchParams;
  // 쿼리에 실린 서로 짐작하기(ga, gb)도 답이 든 링크라 색인하지 않는다.
  const carriesAnswers = search.a !== undefined || search.b !== undefined || search.ga !== undefined || search.gb !== undefined;
  const defaultsToV40 = weddingCodeDefaultsToV40(WEDDING_CODE_DEFAULT_VERSION);
  const version = typeof search.v === "string" ? normalizeWeddingCodeVersion(search.v) : search.v;
  const unknownVersion = version !== undefined && !(typeof version === "string" && isKnownWeddingCodeVersion(version));
  // 알 수 없는 판 이름은 맨 주소처럼 현재 기본 판의 제목을 쓴다.
  const bare = (search.v === undefined && !carriesAnswers) || unknownVersion;
  const isV40 = version === WEDDING_CODE_V40_VERSION || (bare && defaultsToV40);
  const isPreferences = !isV40 && (version === WEDDING_CODE_V31_VERSION || version === WEDDING_CODE_V30_VERSION || (bare && !defaultsToV40));
  const isV20 = version === WEDDING_CODE_V20_VERSION;
  const title = isV40 ? `${V40_COPY.intro.title} | 웨딩코드 · 웨딩한방`
    : isPreferences ? "내가 원하는 결혼식과 준비 방식 | 웨딩코드 · 웨딩한방"
    : isV20 ? "내 웨딩 준비 방식 알아보기 | 웨딩코드 · 웨딩한방"
    : "결혼 준비 장면, 나라면? | 웨딩코드 · 웨딩한방";
  const description = isV40 ? V40_COPY.intro.lede
    : isPreferences
    ? "결혼식 취향과 준비 방식, 꼭 지키고 싶은 것과 돈을 더 쓰고 싶은 곳을 혼자서도 정리해 볼 수 있어요."
    : isV20
      ? "결혼 준비 16개 문장에 답하며 무엇을 먼저 보고, 어떻게 나누고, 가족과 어디까지 상의하고, 어떤 도움을 원하는지 알아봐요. 성격검사나 궁합 결과가 아니라 둘이 이야기할 시작점을 보여줘요."
      : "결혼 준비 장면에 답하면 내 웨딩코드 네 글자가 나와요. 점수를 매기거나 궁합을 보지 않고, 둘이 어디서 다르게 골랐는지 나란히 보여줘요. 로그인 없이 바로 할 수 있어요.";
  return {
    title,
    description,
    robots: carriesAnswers || isV40 || defaultsToV40 || unknownVersion
      ? { index: false, follow: false }
      : { index: true, follow: true },
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
  const initialEntry = parseWeddingCodeEntryQuery(await searchParams, { defaultVersion: WEDDING_CODE_DEFAULT_VERSION });
  return (
    <WeddingCodeEntryClient
      shareOrigin={shareOrigin()}
      initialEntry={initialEntry}
      researchContributionOpen={isWeddingCodeResearchContributionOpen()}
      researchStorageActive={isWeddingCodeResearchStorageActive()}
    />
  );
}
