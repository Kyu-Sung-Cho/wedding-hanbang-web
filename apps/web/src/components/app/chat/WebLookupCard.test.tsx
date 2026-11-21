import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ToolExecutionResult } from "@/types/database.types";
import VendorToolCard from "./VendorToolCard";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

/**
 * 찾아보기 카드(웹). 같은 기준 표, 출처와 확인 시각, 네이버 순서 그대로, 순위·별점·후기 없음,
 * 가격이 없으면 "업체 확인 필요"(D-85, D-14 조건). 문장은 `@hanbang/shared/web-lookup-presentation`.
 */

const SEARCH: ToolExecutionResult = {
  toolName: "search_web",
  toolInput: { query: "강남 웨딩홀" },
  toolOutput: {
    query: "강남 웨딩홀",
    checkedAt: "2026-11-20T07:30:00.000Z",
    hits: [
      { ref: "a1", source: "naver_local", name: "하늘정원 웨딩홀", category: "연애,결혼>예식장", address: "서울특별시 강남구 테헤란로 1", telephone: "02-000-0001", url: "https://www.sky-garden-hall.co.kr/", readable: true, description: null },
      { ref: "a2", source: "naver_local", name: "가람채 웨딩", category: "연애,결혼>예식장", address: "서울특별시 서초구 강남대로 2", telephone: null, url: "https://www.instagram.com/garamchae", readable: false, description: null },
    ],
    resultCount: 2,
  },
  success: true,
  displayMessage: "",
};

const PAGE: ToolExecutionResult = {
  toolName: "read_page",
  toolInput: { ref: "a1" },
  toolOutput: {
    url: "https://www.sky-garden-hall.co.kr/price",
    domain: "sky-garden-hall.co.kr",
    checkedAt: "2026-11-20T07:31:00.000Z",
    title: "하늘정원 예식 안내",
    prices: [{ label: "1인 식대", amount: "65,000원", quote: "1인 식대 65,000원 (부가세 별도)" }],
    priceStatus: "found",
    textless: false,
  },
  success: true,
  displayMessage: "",
};

describe("찾아보기 카드", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(result: ToolExecutionResult) {
    act(() => root.render(<VendorToolCard result={result} />));
    return container.textContent ?? "";
  }

  it("검색 결과를 네이버 순서 그대로 같은 칸의 표로 보이고, 출처와 확인 시각을 붙인다", () => {
    const text = render(SEARCH);
    expect(text).toContain("네이버 검색에서 2곳을 찾았어요");
    expect(text).toContain("2026.11.20 16:30에 확인했어요.");
    expect(text).toContain("네이버 검색 순서 그대로예요.");
    const names = [...container.querySelectorAll("tbody tr td:first-child p:first-child")].map((cell) => cell.textContent);
    expect(names).toEqual(["하늘정원 웨딩홀", "가람채 웨딩"]);
    const headers = [...container.querySelectorAll("thead th")].map((cell) => cell.textContent);
    expect(headers).toEqual(["업체", "지역", "공식 페이지"]);
    expect(text).toContain("강남구");
    expect(text).toContain("서초구");
    expect(text).toContain("출처: 네이버 검색");
    expect(text).toContain("링크만 열 수 있어요");
    const naverLink = [...container.querySelectorAll("a")].find((anchor) => anchor.textContent === "네이버에서 보기");
    expect(naverLink?.getAttribute("href")).toBe("https://search.naver.com/search.naver?query=%EA%B0%95%EB%82%A8%20%EC%9B%A8%EB%94%A9%ED%99%80");
  });

  it("순위 번호·별점·후기·추천 표시를 붙이지 않는다", () => {
    const text = render(SEARCH);
    for (const word of ["1위", "추천", "별점", "리뷰", "후기", "평점"]) expect(text).not.toContain(word);
  });

  it("페이지 카드는 항목과 금액을 공식 페이지 기준으로 보인다", () => {
    const text = render(PAGE);
    expect(text).toContain("sky-garden-hall.co.kr 공식 페이지에서 확인했어요");
    expect(text).toContain("1인 식대");
    expect(text).toContain("65,000원");
    expect(text).toContain("공식 페이지에 적힌 그대로예요.");
    expect(container.querySelector("a")?.getAttribute("href")).toBe("https://www.sky-garden-hall.co.kr/price");
  });

  it("가격이 없으면 '업체 확인 필요' 다", () => {
    const text = render({ ...PAGE, toolOutput: { ...PAGE.toolOutput, prices: [], priceStatus: "needs_vendor_check" } });
    expect(text).toContain("업체 확인 필요");
    expect(text).toContain("이 페이지에는 가격이 적혀 있지 않아요.");
  });

  it("다시 열면 자리표시만 보인다(네이버 글은 저장하지 않았다)", () => {
    const text = render({
      ...SEARCH,
      toolInput: {},
      toolOutput: { query: "강남 웨딩홀", resultCount: 2, checkedAt: "2026-11-20T07:30:00.000Z", displayOnlyPlaceholder: true },
    });
    expect(text).toContain("'강남 웨딩홀'로 2곳을 찾았어요");
    expect(text).toContain("다시 찾아볼까요?");
  });

  it("사용자에게 보일 까닭이 없는 실패(지어낸 주소·턴 한도)는 그리지 않는다", () => {
    expect(render({ ...PAGE, success: false, toolOutput: { error: "url_not_from_search" } })).toBe("");
    expect(render({ ...SEARCH, success: false, toolOutput: { error: "turn_search_limit" } })).toBe("");
  });

  it("약관이 막는 곳은 왜 못 읽었는지 말하고 직접 열어 보게 한다", () => {
    const text = render({ ...PAGE, success: false, toolOutput: { error: "blocked_by_terms", url: "https://www.instagram.com/x" } });
    expect(text).toContain("약관상 자동으로 읽지 않아요");
  });
});
