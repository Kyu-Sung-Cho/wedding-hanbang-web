import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ToolExecutionResult } from "@/types/database.types";
import VendorToolCard from "./VendorToolCard";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

function placeResult(overrides: Partial<ToolExecutionResult> = {}): ToolExecutionResult {
  return {
    toolName: "search_nearby_places",
    toolInput: { query: "강남 상견례 식당" },
    toolOutput: {},
    success: true,
    displayMessage: "'강남 상견례 식당' 검색 결과가 없습니다.",
    ...overrides,
  };
}

describe("VendorToolCard place search results", () => {
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

  it("shows the provider error instead of describing it as an empty search", async () => {
    await act(async () => {
      root.render(
        <VendorToolCard
          result={placeResult({
            success: false,
            displayMessage: "네이버 장소 검색을 잠시 사용할 수 없어요.",
          })}
        />,
      );
    });

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("네이버 장소 검색을 잠시 사용할 수 없어요.");
    expect(container.textContent).not.toContain("근처 장소 검색 결과가 없어요");
  });

  it("offers a safe Naver handoff when API HUB is temporarily unavailable", async () => {
    const searchUrl = "https://search.naver.com/search.naver?query=%EA%B0%95%EB%82%A8";
    const mapsUrl = "https://map.naver.com/p/search/%EA%B0%95%EB%82%A8";

    await act(async () => {
      root.render(
        <VendorToolCard
          result={placeResult({
            success: false,
            toolOutput: {
              query: "강남 상견례 식당",
              places: [],
              providerUnavailable: true,
              handoff: { searchUrl, mapsUrl },
            },
            displayMessage: "네이버 검색으로 바로 이어드릴게요.",
          })}
        />,
      );
    });

    const searchLink = container.querySelector<HTMLAnchorElement>(
      'a[aria-label="강남 상견례 식당 네이버 검색에서 보기"]',
    );
    expect(searchLink?.getAttribute("href")).toBe(searchUrl);
    expect(searchLink?.textContent).toContain("네이버 검색 열기");
    expect(container.textContent).toContain("네이버 지도에서 보기");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("opens the place body in Naver search without nesting the map and blog links", async () => {
    const searchUrl = "https://search.naver.com/search.naver?query=%ED%95%9C%EB%B0%A9%EC%A0%95%EC%8B%9D";
    const mapsUrl = "https://map.naver.com/p/search/%ED%95%9C%EB%B0%A9%EC%A0%95%EC%8B%9D";
    const blogSearchUrl = "https://search.naver.com/search.naver?where=blog&query=%ED%95%9C%EB%B0%A9%EC%A0%95%EC%8B%9D";

    await act(async () => {
      root.render(
        <VendorToolCard
          result={placeResult({
            toolOutput: {
              query: "강남 상견례 식당",
              places: [
                {
                  id: "naver-0",
                  name: "한방정식",
                  address: "서울 강남구 테헤란로",
                  category: "한정식",
                  categoryFull: "음식점>한식>한정식",
                  cuisineType: "한식",
                  description: "상견례 장소",
                  telephone: null,
                  priceRange: "인당 약 5만원",
                  hasPrivateRoom: true,
                  mapsUrl,
                  blogSearchUrl,
                  blogReviewCount: 12,
                  blogSnippet: null,
                  link: null,
                  imageUrl: null,
                  imageSourceUrl: null,
                  searchUrl,
                },
              ],
            },
          })}
        />,
      );
    });

    const placeLink = container.querySelector<HTMLAnchorElement>(
      'a[aria-label="한방정식 네이버 검색에서 보기"]',
    );
    expect(placeLink?.getAttribute("href")).toBe(searchUrl);
    expect(placeLink?.getAttribute("target")).toBe("_blank");
    expect(placeLink?.getAttribute("rel")).toContain("noopener");
    expect(placeLink?.textContent).toContain("네이버에서 보기");
    expect(placeLink?.textContent).toContain("블로그 가격 언급");
    expect(placeLink?.textContent).toContain("룸 언급 있음");
    expect(placeLink?.textContent).not.toContain("🚪 룸 있음");
    expect(placeLink?.querySelector("a")).toBeNull();

    expect(container.textContent).toContain("장소 정보는 네이버 지역 검색 결과예요");
    expect(container.textContent).toContain("최신 정보는 네이버 또는 매장에 확인해 주세요");

    const actionLinks = Array.from(container.querySelectorAll<HTMLAnchorElement>("a"));
    const mapLink = actionLinks.find((link) => link.textContent?.includes("네이버 지도")) ?? null;
    const blogLink = actionLinks.find((link) => link.textContent?.includes("블로그 후기")) ?? null;
    expect(mapLink).not.toBeNull();
    expect(blogLink).not.toBeNull();
    expect(mapLink?.getAttribute("href")).toBe(mapsUrl);
    expect(blogLink?.getAttribute("href")).toBe(blogSearchUrl);
    expect(placeLink?.contains(mapLink)).toBe(false);
    expect(placeLink?.contains(blogLink)).toBe(false);
  });

  it("shows the Naver search image, its source, and a usable fallback when loading fails", async () => {
    const imageUrl = "https://search.pstatic.net/common/?src=https%3A%2F%2Fexample.com%2Fplace.jpg";
    const imageSourceUrl = "https://example.com/place-photo";

    await act(async () => {
      root.render(
        <VendorToolCard
          result={placeResult({
            toolOutput: {
              query: "강남 상견례 식당",
              places: [
                {
                  id: "naver-0",
                  name: "한방정식",
                  address: "서울 강남구 테헤란로",
                  category: "한정식",
                  categoryFull: "음식점>한식>한정식",
                  cuisineType: "한식",
                  description: "상견례 장소",
                  telephone: null,
                  priceRange: null,
                  hasPrivateRoom: false,
                  mapsUrl: "https://map.naver.com/p/search/%ED%95%9C%EB%B0%A9%EC%A0%95%EC%8B%9D",
                  blogSearchUrl: "https://search.naver.com/search.naver?where=blog&query=%ED%95%9C%EB%B0%A9%EC%A0%95%EC%8B%9D",
                  blogReviewCount: 0,
                  blogSnippet: null,
                  link: null,
                  imageUrl,
                  imageSourceUrl,
                  searchUrl: "https://search.naver.com/search.naver?query=%ED%95%9C%EB%B0%A9%EC%A0%95%EC%8B%9D",
                },
              ],
            },
          })}
        />,
      );
    });

    const image = container.querySelector<HTMLImageElement>('img[alt="한방정식 검색 사진"]');
    expect(image?.getAttribute("src")).toBe(imageUrl);
    expect(image?.getAttribute("loading")).toBe("lazy");
    expect(image?.getAttribute("referrerpolicy")).toBe("no-referrer");

    const sourceLink = container.querySelector<HTMLAnchorElement>(
      'a[aria-label="한방정식 사진 출처 보기"]',
    );
    expect(sourceLink).toBeNull();
    expect(container.textContent).toContain("사진 출처: 네이버 이미지 검색");
    expect(container.textContent).toContain("최신 정보는 네이버 또는 매장에 확인해 주세요");

    await act(async () => {
      image?.dispatchEvent(new Event("error", { bubbles: true }));
    });

    expect(container.querySelector('img[alt="한방정식 검색 사진"]')).toBeNull();
    expect(container.querySelector('[aria-label="한방정식 사진을 불러오지 못했어요"]')).not.toBeNull();
  });
});
