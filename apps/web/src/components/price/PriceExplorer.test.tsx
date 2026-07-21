// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PriceCatalog, PriceVendor } from "@/lib/price/catalog";

import { PriceExplorer } from "./PriceExplorer";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/lib/analytics/track", () => ({ track: vi.fn() }));

function offer(id: string, agencyId: string, agencyName: string, price: number) {
  return {
    id,
    agencyId,
    agencyName,
    minimumKrw: price,
    maximumKrw: price,
    priceNote: null,
    baseSpec: null,
    options: [],
  };
}

function studio(id: string, name: string): PriceVendor {
  return {
    id,
    slug: id,
    name,
    aliases: [],
    category: "studio",
    regionCode: null,
    offers: [offer(`${id}-offer`, "agency-a", "대행사 A", 1_000_000)],
  };
}

const firstVendor = studio("vendor-first", "첫 번째 스튜디오");
const secondVendor = studio("vendor-second", "두 번째 스튜디오");

const catalog: PriceCatalog = {
  periodLabel: "2026Q3",
  categories: {
    studio: [firstVendor, secondVendor],
    dress: [],
    makeup: [],
    hall: [],
  },
  counts: { studio: 2, dress: 0, makeup: 0, hall: 0 },
  agencies: [{ id: "agency-a", name: "대행사 A" }],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function flushAsyncWork() {
  await new Promise((resolve) => window.setTimeout(resolve, 0));
  await Promise.resolve();
}

describe("PriceExplorer", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    window.sessionStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await act(async () => root.unmount());
    document.body.replaceChildren();
  });

  it("preserves the signed-in vendor hub while reusing the official catalog", async () => {
    vi.stubGlobal("fetch", vi.fn((input: string | URL | Request) => Promise.resolve(
      String(input).includes("/api/favorites")
        ? jsonResponse({ vendorIds: [firstVendor.id] })
        : jsonResponse({ combos: [] }),
    )));

    await act(async () => {
      root.render(<PriceExplorer catalog={catalog} category="studio" surface="app" />);
      await flushAsyncWork();
    });

    expect(container.textContent).toContain("업체 탐색");
    expect(container.textContent).toContain("공식 가격 업체");
    expect(container.textContent).toContain("찜한 업체");
    expect(container.querySelector('a[href="/wedding/vendors?category=dress"]')).not.toBeNull();
    expect(container.querySelector("main main")).toBeNull();
  });

  it("marks admin preview content and preserves preview on category and detail links", async () => {
    const fetchMock = vi.fn((input: string | URL | Request) => Promise.resolve(
      String(input).includes("/api/favorites")
        ? jsonResponse({ vendorIds: [] })
        : jsonResponse({ combos: [] }),
    ));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(
        <PriceExplorer
          catalog={catalog}
          category="studio"
          surface="app"
          preview
        />,
      );
      await flushAsyncWork();
    });

    expect(container.textContent).toContain("관리자 전용 미리보기 — 자동 추출·검수 전·정확성 미보장");
    expect(container.textContent).toContain("업체·가격·연결 정보의 정확성이 보장되지 않습니다.");
    const previewBadge = container.querySelector('[role="status"][aria-label="관리자 미리보기 상태"]');
    expect(previewBadge?.className).toContain("border-[#B89785]/35");
    expect(previewBadge?.className).toContain("bg-[#F7F1E8]");
    expect(previewBadge?.className).toContain("text-[#36534E]");
    const hrefs = Array.from(container.querySelectorAll<HTMLAnchorElement>("a"))
      .map((anchor) => anchor.getAttribute("href"));
    expect(hrefs).toContain("/wedding/vendors?category=dress&preview=1");
    const firstVendorLinks = hrefs.filter((href) => href?.includes(firstVendor.id));
    expect(firstVendorLinks).toHaveLength(2);
    expect(firstVendorLinks.every((href) => (
      href === `/wedding/vendors/${firstVendor.id}?preview=1`
    ))).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.querySelector('a[href="/price/wishlist"]')).toBeNull();
    expect(container.querySelector(`button[aria-label="${firstVendor.name} 찜하기"]`)).toBeNull();
    expect(container.textContent).toContain("읽기 전용");
    expect(container.textContent).not.toContain("내 예산으로 조합 찾기");
    expect(container.textContent).not.toContain("+ 조합에 담기");
    expect(container.textContent).not.toContain("아모라");
    expect(container.querySelector('a[href="/wedding/chat"]')).toBeNull();
  });

  it("shows only each vendor agency until an agency filter is explicitly selected", async () => {
    const agencyBVendor: PriceVendor = {
      ...studio("vendor-agency-b", "대행사 B 전용 스튜디오"),
      offers: [offer("offer-b", "agency-b", "대행사 B", 2_000_000)],
    };
    const multiAgencyCatalog: PriceCatalog = {
      ...catalog,
      categories: {
        ...catalog.categories,
        studio: [firstVendor, agencyBVendor],
      },
      agencies: [
        { id: "agency-a", name: "대행사 A" },
        { id: "agency-b", name: "대행사 B" },
      ],
    };
    vi.stubGlobal("fetch", vi.fn((input: string | URL | Request) => Promise.resolve(
      String(input).includes("/api/favorites")
        ? jsonResponse({ vendorIds: [] })
        : jsonResponse({ combos: [] }),
    )));

    await act(async () => {
      root.render(<PriceExplorer catalog={multiAgencyCatalog} category="studio" />);
      await flushAsyncWork();
    });

    const firstVendorComparison = container.querySelector(
      `[aria-label="${firstVendor.name} 대행사별 공시가"]`,
    );
    expect(firstVendorComparison?.textContent).toContain("대행사 A");
    expect(firstVendorComparison?.textContent).not.toContain("대행사 B");
    expect(firstVendorComparison?.textContent).not.toContain("—");
  });

  it("counts unique official vendors in the app summary across categories", async () => {
    const duplicateCatalog: PriceCatalog = {
      ...catalog,
      categories: {
        ...catalog.categories,
        dress: [{ ...firstVendor, category: "dress" }],
      },
      counts: { ...catalog.counts, dress: 1 },
    };
    vi.stubGlobal("fetch", vi.fn((input: string | URL | Request) => Promise.resolve(
      String(input).includes("/api/favorites")
        ? jsonResponse({ vendorIds: [] })
        : jsonResponse({ combos: [] }),
    )));

    await act(async () => {
      root.render(<PriceExplorer catalog={duplicateCatalog} category="studio" surface="app" />);
      await flushAsyncWork();
    });

    const label = Array.from(container.querySelectorAll("p"))
      .find((paragraph) => paragraph.textContent === "공식 가격 업체");
    expect(label?.parentElement?.textContent?.replace(/\s+/g, ""))
      .toBe("공식가격업체2");
  });

  it("offers an explicit, current-catalog-validated restore for the latest saved combo", async () => {
    const fetchMock = vi.fn((input: string | URL | Request) => Promise.resolve(
      String(input).includes("/api/favorites")
        ? jsonResponse({ vendorIds: [] })
        : jsonResponse({
            combos: [{
              id: "combo-latest",
              name: "지난주 스드메 조합",
              created_at: "2026-07-20T05:00:00.000Z",
              selections: {
                studio: {
                  vendor_id: firstVendor.id,
                  agency_id: "agency-a",
                  base_krw: 1_000_000,
                  selected_options: [],
                  custom_krw: null,
                },
                dress: null,
                makeup: null,
              },
            }],
          }),
    ));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<PriceExplorer catalog={catalog} category="studio" />);
      await flushAsyncWork();
    });

    const restoreButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("최근 저장 조합 불러오기"));
    expect(container.querySelector('[aria-label="최근 저장 조합"]')?.textContent)
      .toContain("지난주 스드메 조합");
    expect(container.querySelector('aside[aria-label="스드메 조합"]')).toBeNull();
    expect(restoreButton).toBeDefined();

    await act(async () => {
      restoreButton?.click();
      await Promise.resolve();
    });

    expect(container.querySelector('aside[aria-label="스드메 조합"]')?.textContent)
      .toContain(firstVendor.name);
    expect(container.querySelector('[role="status"]')?.textContent)
      .toContain("현재 공시 정보로 확인해 불러왔어요");

    const restoreAgainButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("최근 저장 조합 불러오기"));
    await act(async () => {
      restoreAgainButton?.click();
      await Promise.resolve();
    });
    expect(container.querySelector('[role="group"][aria-label="현재 조합 교체 확인"]')?.textContent)
      .toContain("현재 담은 조합을 바꿀까요?");
    expect(container.querySelector('aside[aria-label="스드메 조합"]')?.textContent)
      .toContain(firstVendor.name);

    const cancelButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "취소");
    await act(async () => {
      cancelButton?.click();
      await Promise.resolve();
    });

    const clearButton = container.querySelector<HTMLButtonElement>(
      `button[aria-label="${firstVendor.name} 빼기"]`,
    );
    await act(async () => {
      clearButton?.click();
      await Promise.resolve();
    });
  });

  it("keeps wishlist actions disabled until the initial owner state is hydrated", async () => {
    let resolveFavorites!: (response: Response) => void;
    const favoritesResponse = new Promise<Response>((resolve) => {
      resolveFavorites = resolve;
    });
    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST" || init?.method === "DELETE") {
        return Promise.resolve(jsonResponse({ isFavorite: true }));
      }
      return String(input).includes("/api/favorites")
        ? favoritesResponse
        : Promise.resolve(jsonResponse({ combos: [] }));
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<PriceExplorer catalog={catalog} category="studio" />);
      await Promise.resolve();
    });

    const firstButton = container.querySelector<HTMLButtonElement>(
      `button[aria-label="${firstVendor.name} 찜하기"]`,
    );
    expect(firstButton?.disabled).toBe(true);
    expect(firstButton?.getAttribute("aria-busy")).toBe("true");

    await act(async () => {
      firstButton?.click();
      await Promise.resolve();
    });
    expect(fetchMock.mock.calls.some(([, init]) => (
      (init as RequestInit | undefined)?.method === "POST"
    ))).toBe(false);

    await act(async () => {
      resolveFavorites(jsonResponse({ vendorIds: [] }));
      await flushAsyncWork();
    });
    expect(firstButton?.disabled).toBe(false);
    expect(firstButton?.getAttribute("aria-busy")).toBe("false");
  });

  it("keeps wishlist actions fail-closed after hydration fails and recovers on retry", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ combos: [] }))
      .mockResolvedValueOnce(jsonResponse({ error: "unavailable" }, 503))
      .mockResolvedValueOnce(jsonResponse({ combos: [] }))
      .mockResolvedValueOnce(jsonResponse({ vendorIds: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<PriceExplorer catalog={catalog} category="studio" />);
      await flushAsyncWork();
    });

    const favoriteButton = container.querySelector<HTMLButtonElement>(
      `button[aria-label="${firstVendor.name} 찜하기"]`,
    );
    const wishlistOnlyButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("찜한 업체만"));
    const retryButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("다시 불러오기"));

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("기존 찜은 변경하지 않았어요");
    expect(favoriteButton?.disabled).toBe(true);
    expect(wishlistOnlyButton?.disabled).toBe(true);
    expect(retryButton).toBeDefined();

    await act(async () => {
      retryButton?.click();
      await flushAsyncWork();
    });

    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(favoriteButton?.disabled).toBe(false);
    expect(wishlistOnlyButton?.disabled).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("disables only the vendor wishlist button whose request is in flight", async () => {
    let resolveFirstFavorite!: (response: Response) => void;
    const firstFavoriteResponse = new Promise<Response>((resolve) => {
      resolveFirstFavorite = resolve;
    });
    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST") {
        const payload = JSON.parse(String(init.body)) as { vendorId: string };
        return payload.vendorId === firstVendor.id
          ? firstFavoriteResponse
          : Promise.resolve(jsonResponse({ isFavorite: true }));
      }
      return Promise.resolve(String(input).includes("/api/favorites")
        ? jsonResponse({ vendorIds: [] })
        : jsonResponse({ combos: [] }));
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<PriceExplorer catalog={catalog} category="studio" />);
      await flushAsyncWork();
    });

    const firstButton = container.querySelector<HTMLButtonElement>(
      `button[aria-label="${firstVendor.name} 찜하기"]`,
    );
    const secondButton = container.querySelector<HTMLButtonElement>(
      `button[aria-label="${secondVendor.name} 찜하기"]`,
    );
    expect(firstButton).not.toBeNull();
    expect(secondButton).not.toBeNull();

    await act(async () => {
      firstButton?.click();
      await Promise.resolve();
    });

    expect(firstButton?.disabled).toBe(true);
    expect(firstButton?.getAttribute("aria-busy")).toBe("true");
    expect(secondButton?.disabled).toBe(false);
    expect(secondButton?.getAttribute("aria-busy")).toBe("false");

    await act(async () => {
      firstButton?.click();
      secondButton?.click();
      await flushAsyncWork();
    });
    const favoriteMutations = fetchMock.mock.calls.filter(([, init]) => (
      (init as RequestInit | undefined)?.method === "POST"
    ));
    expect(favoriteMutations).toHaveLength(2);
    expect(container.querySelector(
      `button[aria-label="${secondVendor.name} 찜 해제"]`,
    )).not.toBeNull();

    await act(async () => {
      resolveFirstFavorite(jsonResponse({ isFavorite: true }));
      await flushAsyncWork();
    });

    const settledFirstButton = container.querySelector<HTMLButtonElement>(
      `button[aria-label="${firstVendor.name} 찜 해제"]`,
    );
    expect(settledFirstButton?.disabled).toBe(false);
    expect(settledFirstButton?.getAttribute("aria-busy")).toBe("false");
  });

  it("keeps card columns in the order that agencies were selected", async () => {
    const orderedVendor: PriceVendor = {
      ...studio("vendor-ordered", "순서 스튜디오"),
      offers: [
        offer("offer-a", "agency-a", "대행사 A", 1_000_000),
        offer("offer-b", "agency-b", "대행사 B", 2_000_000),
      ],
    };
    const orderedCatalog: PriceCatalog = {
      ...catalog,
      categories: { ...catalog.categories, studio: [orderedVendor] },
      counts: { ...catalog.counts, studio: 1 },
      agencies: [
        { id: "agency-a", name: "대행사 A" },
        { id: "agency-b", name: "대행사 B" },
      ],
    };
    vi.stubGlobal("fetch", vi.fn((input: string | URL | Request) => Promise.resolve(
      String(input).includes("/api/favorites")
        ? jsonResponse({ vendorIds: [] })
        : jsonResponse({ combos: [] }),
    )));

    await act(async () => {
      root.render(<PriceExplorer catalog={orderedCatalog} category="studio" />);
      await flushAsyncWork();
    });

    const agencyLabels = Array.from(container.querySelectorAll<HTMLLabelElement>("fieldset label"));
    const agencyA = agencyLabels.find((label) => label.textContent?.includes("대행사 A"));
    const agencyB = agencyLabels.find((label) => label.textContent?.includes("대행사 B"));
    expect(agencyA).toBeDefined();
    expect(agencyB).toBeDefined();

    await act(async () => {
      agencyB?.click();
      agencyA?.click();
      await Promise.resolve();
    });

    const comparison = container.querySelector('[aria-label="순서 스튜디오 대행사별 공시가"]');
    expect(comparison?.textContent?.replace(/\s+/g, "")).toContain(
      "대행사B200만원대행사A100만원",
    );
  });

  it("keeps horizontally scrolling filter controls at least 44px tall on mobile", async () => {
    vi.stubGlobal("fetch", vi.fn((input: string | URL | Request) => Promise.resolve(
      String(input).includes("/api/favorites")
        ? jsonResponse({ vendorIds: [] })
        : jsonResponse({ combos: [] }),
    )));

    await act(async () => {
      root.render(<PriceExplorer catalog={catalog} category="studio" />);
      await flushAsyncWork();
    });

    const agencyControl = Array.from(container.querySelectorAll<HTMLLabelElement>("fieldset label"))
      .find((label) => label.textContent?.includes("대행사 A"));
    const wishlistOnly = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("찜한 업체만"));

    expect(agencyControl?.className).toContain("min-h-11");
    expect(agencyControl?.parentElement?.className).toContain("overflow-x-auto");
    expect(wishlistOnly?.className).toContain("min-h-11");
  });
});
