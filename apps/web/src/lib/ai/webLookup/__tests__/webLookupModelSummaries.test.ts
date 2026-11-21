// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { AmoraReadPageSuccess, AmoraWebSearchSuccess } from "@/lib/ai/webLookup/amoraWebLookup";
import type { WebLookupHit } from "@/lib/ai/webLookup/naverWebLookup";
import {
  pageReadSummaryForModel,
  webLookupHistoryEntry,
  webLookupModelOutput,
  webLookupPersistableResult,
  webSearchSummaryForModel,
} from "@/lib/ai/webLookup/webLookupModelView";
import type { ToolExecutionResult } from "@/types/database.types";

/**
 * 네이버 검색 데이터는 모델에 한 글자도 가지 않는다(2026-11-20 부모 세션 요청).
 *
 * NAVER API HUB 서비스 이용약관(시행 2026.10.07) 검색 API 특약 1.3 이 검색 데이터와 그 가공물·파생물을
 * AI 에 넣는 것을 막는다. 갈래 4(맡은 일)가 모델 걸음에 넣는 요약 둘(`webSearchSummaryForModel`,
 * `pageReadSummaryForModel`)과 대화 도구의 모델 칸·다음 턴 이력에 네이버가 준 칸(이름·분류·주소·전화·
 * 링크·요약)이 실리지 않는 것을 표지 문자열로 고정한다. 표지가 하나라도 보이면 빨갛다.
 * 우리 값(개수·번호표·검색어·확인 시각·업체 페이지의 제목과 금액)은 남아야 하므로 함께 본다. 빈 요약이
 * 통과하지 않게 하려는 것이다.
 */

const CANARY = {
  name: "카나리업체이름",
  category: "카나리분류>예식장",
  address: "서울특별시 카나리구 카나리로 7",
  telephone: "02-7777-0777",
  url: "https://canary-naver-link.example/hall",
  description: "카나리요약문장",
};
/** 네이버가 준 칸에서만 나올 수 있는 조각. 모델 쪽 출력 어디에도 없어야 한다. */
const NAVER_FRAGMENTS = ["카나리업체이름", "카나리분류", "카나리구", "카나리로", "7777-0777", "canary-naver-link", "카나리요약"];

function naverHit(ref: string, source: WebLookupHit["source"], readable: boolean): WebLookupHit {
  return {
    ref,
    source,
    name: `${CANARY.name}${ref}`,
    category: source === "naver_local" ? CANARY.category : null,
    address: source === "naver_local" ? CANARY.address : null,
    telephone: source === "naver_local" ? CANARY.telephone : null,
    url: CANARY.url,
    readable,
    description: source === "naver_web" ? CANARY.description : null,
  };
}

const SEARCH: AmoraWebSearchSuccess = {
  ok: true,
  query: "강남 웨딩홀",
  removedFromQuery: [],
  checkedAt: "2026-11-20T07:30:00.000Z",
  hits: [naverHit("w1", "naver_local", true), naverHit("w2", "naver_local", false), naverHit("w3", "naver_web", true)],
  productsUnavailable: [],
  remainingToday: 28,
};

/** 맡은 일이 searchWeb 결과의 주소(네이버 link)로 읽은 페이지. 주소·도메인은 네이버에서 왔다. */
const PAGE: AmoraReadPageSuccess = {
  ok: true,
  url: CANARY.url,
  domain: "canary-naver-link.example",
  checkedAt: "2026-11-20T07:31:00.000Z",
  title: "업체 예식 안내",
  prices: [{ label: "1인 식대", amount: "65,000원", quote: "카나리원문 1인 식대 65,000원" }],
  textless: false,
  truncated: false,
  remainingToday: 27,
};

function expectNoNaverText(value: unknown) {
  const text = JSON.stringify(value);
  for (const fragment of NAVER_FRAGMENTS) expect(text, fragment).not.toContain(fragment);
}

describe("갈래 4 가 모델에 넣는 요약", () => {
  it("검색 요약에는 네이버 칸이 없고 개수·번호표·검색어·확인 시각만 있다", () => {
    const summary = webSearchSummaryForModel(SEARCH);
    expectNoNaverText(summary);
    expect(summary).toMatchObject({
      success: true,
      resultCount: 3,
      businessCount: 2,
      webDocumentCount: 1,
      readableRefs: ["w1", "w3"],
      effectiveQuery: "강남 웨딩홀",
      checkedAt: "2026-11-20 16:30 (KST, UTC+09:00)",
    });
  });

  it("페이지 요약에는 주소·도메인(네이버 link 에서 옴)과 원문 한 줄이 없고 제목·금액만 있다", () => {
    const summary = pageReadSummaryForModel(PAGE);
    expectNoNaverText(summary);
    expect(JSON.stringify(summary)).not.toContain("카나리원문");
    expect(summary).toMatchObject({
      success: true,
      pageTitle: "업체 예식 안내",
      prices: [{ label: "1인 식대", amount: "65,000원" }],
      priceStatus: "공식 페이지에 적힌 금액",
    });
  });

  it("실패한 요약도 네이버 칸을 싣지 않는다", () => {
    expectNoNaverText(webSearchSummaryForModel({ ok: false, reason: "search_unavailable", removedFromQuery: [], remainingToday: 3 }));
    expectNoNaverText(pageReadSummaryForModel({ ok: false, reason: "blocked_by_robots", remainingToday: 3 }));
  });
});

describe("대화 도구의 모델 칸과 다음 턴 이력", () => {
  const searchTool: ToolExecutionResult = {
    toolName: "search_web",
    toolInput: { query: "강남 웨딩홀" },
    toolOutput: { query: SEARCH.query, removedFromQuery: [], checkedAt: SEARCH.checkedAt, hits: SEARCH.hits, remainingToday: 28 },
    success: true,
    displayMessage: "",
  };
  const readByRef: ToolExecutionResult = {
    toolName: "read_page",
    toolInput: { ref: "w1" },
    toolOutput: { ref: "w1", url: PAGE.url, domain: PAGE.domain, checkedAt: PAGE.checkedAt, title: PAGE.title, prices: PAGE.prices, textless: false, remainingToday: 27 },
    success: true,
    displayMessage: "",
  };

  it("검색과 번호표 읽기의 모델 칸에 네이버 칸이 없다", () => {
    expectNoNaverText(webLookupModelOutput(searchTool));
    expectNoNaverText(webLookupModelOutput(readByRef));
    expect(webLookupModelOutput(readByRef)).toMatchObject({ ref: "w1", prices: [{ label: "1인 식대", amount: "65,000원" }] });
  });

  it("저장본에서 만든 다음 턴 이력에 네이버 칸이 없다", () => {
    for (const result of [searchTool, readByRef]) {
      const persisted = webLookupPersistableResult(result);
      expect(persisted).toBeTruthy();
      const entry = webLookupHistoryEntry(persisted as unknown as Record<string, unknown>);
      expect(entry).toBeTruthy();
      expectNoNaverText(entry);
    }
  });

  it("검색 저장본은 우리 값만 남긴다(약관 특약 1.3 저장 금지)", () => {
    const persisted = webLookupPersistableResult(searchTool);
    expectNoNaverText(persisted);
    expect(persisted?.toolOutput).toEqual({ query: "강남 웨딩홀", resultCount: 3, checkedAt: SEARCH.checkedAt, displayOnlyPlaceholder: true });
  });

  it("페이지 읽기 저장본은 업체 주소·도메인 없이 제목·금액 줄·확인 시각만 남긴다(2026-11-22 파운더 결정 4)", () => {
    const persisted = webLookupPersistableResult(readByRef);
    expectNoNaverText(persisted);
    expect(persisted?.toolOutput).toEqual({
      checkedAt: PAGE.checkedAt,
      title: PAGE.title,
      prices: PAGE.prices,
      priceStatus: "found",
      textless: false,
      storedCopy: true,
    });
    // 다시 열 때 한 번 더 거쳐도 같은 모양이다(웹 `dbRowToMessage`).
    expect(webLookupPersistableResult(persisted as ToolExecutionResult)).toEqual(persisted);
  });
});
