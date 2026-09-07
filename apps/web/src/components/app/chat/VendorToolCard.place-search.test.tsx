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

  it("shows requested/visible counts and unverified suitability without inventing missing venues", async () => {
    await act(async () => root.render(<VendorToolCard result={placeResult({
      toolOutput: {
        query: "대전이나 청주 한정식", requestedCount: 3, resultCount: 99,
        orderBasis: "region_kind", searchedAt: "2026-09-03T11:20:00Z",
        places: [{ id: "one", name: "대전 한상", address: "대전", category: "한정식" },
          { id: "two", name: "청주 한상", address: "청주", category: "한정식" }],
      },
    })} />));
    expect(container.textContent).toContain("요청 3곳 중 2곳 표시");
    expect(container.textContent).toContain("이번 검색에서 표시할 수 있는 결과가 요청보다 적어요");
    expect(container.textContent).toContain("수용인원·예약 가능일·가격은 확인되지 않았어요");
    expect(container.textContent).toContain("2026.09.03 20:20");
    expect(container.textContent).toContain("지역별 결과를 번갈아 배치");
    expect(container.textContent).not.toContain("정렬은 네이버 기준");
    expect(container.textContent).not.toContain("99곳");
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
                  mapsUrl,
                  blogSearchUrl,
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
      'a[aria-label="한방정식 네이버에서 리뷰·별점 보기"]',
    );
    expect(placeLink?.getAttribute("href")).toBe(searchUrl);
    expect(placeLink?.getAttribute("target")).toBe("_blank");
    expect(placeLink?.getAttribute("rel")).toContain("noopener");
    // 우리가 못 가져오는 것(리뷰 수·별점)은 카드가 **어디서 볼 수 있는지**를
    // 말한다. 그냥 "네이버에서 보기" 면 눌러야 할 이유가 없다.
    expect(placeLink?.textContent).toContain("리뷰·별점 보기");
    expect(placeLink?.querySelector("a")).toBeNull();

    // 블로그에서 주워 온 가격·룸 추정은 더 이상 카드에 없다.
    expect(container.textContent).not.toContain("블로그 가격 언급");
    expect(container.textContent).not.toContain("룸 언급 있음");
    expect(container.textContent).not.toMatch(/블로그 (?:검색|후기) ?[\d,]+/u);

    expect(container.textContent).toContain("네이버 지역검색 일반 결과예요(광고·제휴 아님)");
    expect(container.textContent).toContain("리뷰 수·별점과 가격은 카드를 눌러 네이버에서 확인해 주세요");

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
                  mapsUrl: "https://map.naver.com/p/search/%ED%95%9C%EB%B0%A9%EC%A0%95%EC%8B%9D",
                  blogSearchUrl: "https://search.naver.com/search.naver?where=blog&query=%ED%95%9C%EB%B0%A9%EC%A0%95%EC%8B%9D",
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
    expect(container.textContent).toContain("리뷰 수·별점과 가격은 카드를 눌러 네이버에서 확인해 주세요");

    await act(async () => {
      image?.dispatchEvent(new Event("error", { bubbles: true }));
    });

    expect(container.querySelector('img[alt="한방정식 검색 사진"]')).toBeNull();
    expect(container.querySelector('[aria-label="한방정식 사진을 불러오지 못했어요"]')).not.toBeNull();
  });

  // 2026-09-03 — "이거 광고야?" 에 화면이 답하지 못했다. 우리는 네이버 일반 지역검색만
  // 부르므로 광고·제휴가 아니라는 것은 우리가 단언할 수 있는 사실이고, 조회 시각은
  // 실행기가 넣은 우리 값이다.
  function placeWith(overrides: Record<string, unknown> = {}) {
    return {
      id: "naver-0",
      name: "한방정식",
      address: "대전 서구 둔산로 1",
      category: "한정식",
      categoryFull: "음식점>한식>한정식",
      cuisineType: "한식",
      description: "상견례 장소",
      telephone: null,
      mapsUrl: "https://map.naver.com/p/search/x",
      blogSearchUrl: "https://search.naver.com/search.naver?where=blog&query=x",
      link: null,
      imageUrl: null,
      imageSourceUrl: null,
      searchUrl: "https://search.naver.com/search.naver?query=x",
      ...overrides,
    };
  }

  it("광고·제휴가 아니라는 것과 조회 시각(KST)을 카드가 말한다", async () => {
    await act(async () => {
      root.render(
        <VendorToolCard
          result={placeResult({
            toolOutput: {
              query: "대전 한정식",
              // 2026-09-03 20:20 KST
              searchedAt: "2026-09-03T11:20:00.000Z",
              places: [placeWith()],
            },
          })}
        />,
      );
    });

    expect(container.textContent).toContain(
      "조회 시각은 2026.09.03 20:20 (한국 시간)입니다.",
    );
  });

  it("조회 시각이 없으면 시각 문장만 빼고 광고 아님은 그대로 말한다", async () => {
    await act(async () => {
      root.render(
        <VendorToolCard
          result={placeResult({
            toolOutput: { query: "대전 한정식", places: [placeWith()] },
          })}
        />,
      );
    });

    expect(container.textContent).toContain(
      "네이버 지역검색 일반 결과예요(광고·제휴 아님).",
    );
    expect(container.textContent).not.toContain("조회 시각은");
  });

  it("두 지역을 함께 찾았으면 카드마다 어느 지역인지 보여준다", async () => {
    await act(async () => {
      root.render(
        <VendorToolCard
          result={placeResult({
            toolOutput: {
              query: "대전이나 청주 한정식",
              searchedAt: "2026-09-03T11:20:00.000Z",
              places: [
                placeWith({ id: "naver-r0-0", regionLabel: "대전" }),
                placeWith({
                  id: "naver-r1-0",
                  name: "청주한상",
                  address: "청주 흥덕구 대농로 1",
                  regionLabel: "청주",
                }),
              ],
            },
          })}
        />,
      );
    });

    expect(container.textContent).toContain("대전");
    expect(container.textContent).toContain("청주한상");
    const regionChips = Array.from(container.querySelectorAll("span"))
      .filter((node) => node.textContent === "청주");
    expect(regionChips.length).toBe(1);
  });
});
