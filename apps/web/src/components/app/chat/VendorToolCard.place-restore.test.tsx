import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ToolExecutionResult } from "@/types/database.types";
import { getPersistableToolResults } from "@/lib/ai/placeSearchResultPolicy";
import VendorToolCard from "./VendorToolCard";

/**
 * 새로고침하면 장소 카드가 통째로 사라지던 문제. (2026-09-03 감사)
 *
 * 네이버 항목은 저장하지 않는 계약 그대로다. 대신 우리 값만(질의·조회 시각·개수)
 * 남겨 카드 자리에 자리표시 카드를 그린다. **같은 결과 하나를 신선한 상태와 저장을
 * 거친 상태로 각각 그려 대조한다** — 저장 경로를 실제로 태우지 않으면 "저장하면
 * 무엇이 남는가" 를 시험하는 것이 아니라 내가 손으로 적은 값을 시험하게 된다.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const freshPlaceResult: ToolExecutionResult = {
  toolName: "search_nearby_places",
  toolInput: { query: "대전 식당 예식" },
  toolOutput: {
    query: "대전 식당 예식",
    effectiveQuery: "대전 식당 예식, 대전 식당",
    // 2026-09-03T01:20:00Z = KST 10:20
    searchedAt: "2026-09-03T01:20:00.000Z",
    resultCount: 2,
    provider: "api_hub",
    providerUnavailable: false,
    partial: false,
    warnings: [],
    places: [
      {
        id: "naver-0",
        name: "라마다 에이치가든",
        address: "대전 서구 가든로 2",
        category: "뷔페",
        categoryFull: "음식점>뷔페",
        cuisineType: "뷔페",
        description: "연회 가능",
        telephone: "042-000-0000",
        searchUrl: "https://search.naver.com/search.naver?query=%EB%9D%BC%EB%A7%88%EB%8B%A4",
        mapsUrl: "https://map.naver.com/p/search/%EB%9D%BC%EB%A7%88%EB%8B%A4",
        blogSearchUrl: "https://search.naver.com/search.naver?where=blog&query=%EB%9D%BC%EB%A7%88%EB%8B%A4",
        imageUrl: null,
        imageSourceUrl: null,
        imageTitle: null,
        link: null,
        mapx: "1273000000",
        mapy: "363000000",
        regionLabel: null,
      },
      {
        id: "naver-1",
        name: "크리스탈컨벤션뷔페",
        address: "대전 유성구 뷔페로 3",
        category: "뷔페",
        categoryFull: "음식점>뷔페",
        cuisineType: "뷔페",
        description: null,
        telephone: null,
        searchUrl: "https://search.naver.com/search.naver?query=%ED%81%AC%EB%A6%AC%EC%8A%A4%ED%83%88",
        mapsUrl: "https://map.naver.com/p/search/%ED%81%AC%EB%A6%AC%EC%8A%A4%ED%83%88",
        blogSearchUrl: "https://search.naver.com/search.naver?where=blog&query=%ED%81%AC%EB%A6%AC%EC%8A%A4%ED%83%88",
        imageUrl: null,
        imageSourceUrl: null,
        imageTitle: null,
        link: null,
        mapx: "1273500000",
        mapy: "363500000",
        regionLabel: null,
      },
    ],
  },
  success: true,
  displayMessage: "'대전 식당 예식' 검색 결과 2곳을 찾았습니다.",
};

describe("장소 카드 — 신선한 결과와 다시 적재한 결과", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
  });

  async function render(result: ToolExecutionResult) {
    await act(async () => {
      root.render(<VendorToolCard result={result} />);
    });
  }

  it("신선한 결과는 예전 그대로 업체 카드를 그린다", async () => {
    await render(freshPlaceResult);

    expect(container.textContent).toContain("라마다 에이치가든");
    expect(container.textContent).toContain("크리스탈컨벤션뷔페");
    expect(container.textContent).toContain("대전 서구 가든로 2");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("저장을 거친 결과는 제공자 텍스트 없이 자리표시 카드를 그린다", async () => {
    const [restored] = getPersistableToolResults([freshPlaceResult]);
    expect(restored).toBeDefined();

    await render(restored);

    const note = container.querySelector('[role="note"]');
    expect(note?.textContent).toContain("10:20에");
    expect(note?.textContent).toContain("'대전 식당 예식'으로 2곳을 찾았어요");
    expect(note?.textContent).toContain("다시 검색할까요?");

    // 저장 경로를 태운 결과에는 네이버 텍스트가 한 글자도 없어야 한다.
    expect(container.textContent).not.toContain("라마다 에이치가든");
    expect(container.textContent).not.toContain("크리스탈컨벤션뷔페");
    expect(container.textContent).not.toContain("대전 서구 가든로 2");
    expect(container.querySelector("a")).toBeNull();

    // 0곳이었던 것처럼 보이면 안 된다.
    expect(container.textContent).not.toContain("결과를 못 찾았어요");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("받침에 따라 조사가 갈린다 — '카페'로 / '식당 예식'으로", async () => {
    const [restored] = getPersistableToolResults([{
      ...freshPlaceResult,
      toolOutput: { ...freshPlaceResult.toolOutput, query: "대전 카페", resultCount: 5 },
    }]);

    await render(restored);

    expect(container.textContent).toContain("'대전 카페'로 5곳을 찾았어요");
  });
});

describe("웨딩 업체 질의 안내 카드", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
  });

  it("차단은 실패가 아니라 안내다 — 빨간 경고로 그리지 않는다", async () => {
    await act(async () => {
      root.render(
        <VendorToolCard
          result={{
            toolName: "search_nearby_places",
            toolInput: { query: "대전 웨딩홀" },
            toolOutput: {
              places: [],
              query: "대전 웨딩홀",
              reason: "wedding_vendor_query_blocked",
              resultCount: 0,
              searchedAt: "2026-09-03T01:20:00.000Z",
            },
            success: false,
            displayMessage: "예식장·웨딩홀은 여기서 검색하지 않고 업체 탐색에서 볼 수 있어요.",
          }}
        />,
      );
    });

    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).not.toContain("장소 검색을 완료하지 못했어요");

    const note = container.querySelector('[role="note"]');
    expect(note?.textContent).toContain("예식장·웨딩홀은 업체 탐색에서 볼 수 있어요");
    expect(note?.textContent).toContain(
      "예식장·웨딩홀은 여기서 검색하지 않고 업체 탐색에서 볼 수 있어요.",
    );
  });

  it("차단이 아닌 진짜 실패는 그대로 경고로 남는다", async () => {
    await act(async () => {
      root.render(
        <VendorToolCard
          result={{
            toolName: "search_nearby_places",
            toolInput: { query: "대전 식당" },
            toolOutput: { places: [], query: "대전 식당" },
            success: false,
            displayMessage: "네이버 장소 검색을 완료하지 못했습니다. 잠시 후 다시 시도해주세요.",
          }}
        />,
      );
    });

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("장소 검색을 완료하지 못했어요");
  });
});
