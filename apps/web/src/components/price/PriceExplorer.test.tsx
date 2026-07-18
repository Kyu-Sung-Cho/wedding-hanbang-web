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
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await act(async () => root.unmount());
    document.body.replaceChildren();
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
        : Promise.resolve(jsonResponse({ selections: {} }));
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
      .mockResolvedValueOnce(jsonResponse({ selections: {} }))
      .mockResolvedValueOnce(jsonResponse({ error: "unavailable" }, 503))
      .mockResolvedValueOnce(jsonResponse({ selections: {} }))
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
        : jsonResponse({ selections: {} }));
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
        : jsonResponse({ selections: {} }),
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
        : jsonResponse({ selections: {} }),
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
