// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PriceCatalog, PriceCategory, PriceVendor } from "@/lib/price/catalog";

import { PriceWishlist } from "./PriceWishlist";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/lib/analytics/track", () => ({ track: vi.fn() }));

function vendor(id: string, category: PriceCategory, name: string): PriceVendor {
  return {
    id,
    slug: `${category}-${id}`,
    name,
    aliases: [],
    category,
    regionCode: null,
    offers: [],
  };
}

const officialStudio = vendor(
  "11111111-1111-4111-8111-111111111111",
  "studio",
  "공식 스튜디오",
);

const catalog: PriceCatalog = {
  periodLabel: "2026Q3",
  categories: {
    studio: [officialStudio],
    dress: [vendor("22222222-2222-4222-8222-222222222222", "dress", "공식 드레스")],
    makeup: [vendor("33333333-3333-4333-8333-333333333333", "makeup", "공식 메이크업")],
    hall: [vendor("44444444-4444-4444-8444-444444444444", "hall", "공식 웨딩홀")],
  },
  counts: { studio: 1, dress: 1, makeup: 1, hall: 1 },
  agencies: [],
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

describe("PriceWishlist", () => {
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

  async function renderWishlist() {
    await act(async () => {
      root.render(<PriceWishlist catalog={catalog} />);
      await flushAsyncWork();
    });
  }

  it("shows all four categories and an explicit sign-in path for guests", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: "unauthorized" }, 401)));

    await renderWishlist();

    expect(container.textContent).toContain("스튜디오");
    expect(container.textContent).toContain("드레스");
    expect(container.textContent).toContain("메이크업");
    expect(container.textContent).toContain("웨딩홀");
    expect(container.textContent).toContain("로그인하면 찜한 업체를 이어서 볼 수 있어요");
    expect(container.querySelector('a[href="/login?redirect=%2Fprice%2Fwishlist"]')).not.toBeNull();
  });

  it("shows an honest empty state when no published-catalog favorites remain", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      vendorIds: ["legacy-private-vendor"],
    })));

    await renderWishlist();

    expect(container.textContent).toContain("공식 가격 업체를 아직 찜하지 않았어요");
    expect(container.querySelector('a[href="/price/studio"]')).not.toBeNull();
    expect(container.textContent).not.toContain("legacy-private-vendor");
  });

  it("offers a retry when the private favorites API is unavailable", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: "unavailable" }, 503))
      .mockResolvedValueOnce(jsonResponse({ vendorIds: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await renderWishlist();
    expect(container.textContent).toContain("찜한 업체를 불러오지 못했어요");

    const retry = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("다시 불러오기"));
    await act(async () => {
      retry?.click();
      await flushAsyncWork();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("공식 가격 업체를 아직 찜하지 않았어요");
  });

  it("renders only official matches and removes a favorite after server confirmation", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        vendorIds: ["legacy-private-vendor", officialStudio.id],
      }))
      .mockResolvedValueOnce(jsonResponse({ isFavorite: false }));
    vi.stubGlobal("fetch", fetchMock);

    await renderWishlist();

    expect(container.textContent).toContain("공식 스튜디오");
    expect(container.textContent).not.toContain("legacy-private-vendor");
    expect(container.querySelectorAll('section[aria-labelledby^="wishlist-"]')).toHaveLength(4);

    const remove = container.querySelector<HTMLButtonElement>('button[aria-label="공식 스튜디오 찜 해제"]');
    await act(async () => {
      remove?.click();
      remove?.click();
      await flushAsyncWork();
    });

    const mutationCalls = fetchMock.mock.calls.filter(([, init]) => (
      (init as RequestInit | undefined)?.method === "DELETE"
    ));
    expect(mutationCalls).toHaveLength(1);
    expect(fetchMock).toHaveBeenLastCalledWith("/api/favorites", expect.objectContaining({
      method: "DELETE",
      credentials: "same-origin",
    }));
    expect(container.textContent).toContain("공식 가격 업체를 아직 찜하지 않았어요");
  });
});
