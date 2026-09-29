// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PriceCatalog, PriceVendor } from "@/lib/price/catalog";

import { PriceExplorer } from "./PriceExplorer";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/lib/analytics/track", () => ({ track: vi.fn() }));
const authEvents = vi.hoisted(() => ({ listeners: [] as Array<(event: string, session: { user: { id: string } } | null) => void> }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: {
  onAuthStateChange: (listener: (event: string, session: { user: { id: string } } | null) => void) => {
    authEvents.listeners.push(listener);
    return { data: { subscription: { unsubscribe: () => { authEvents.listeners = authEvents.listeners.filter((item) => item !== listener); } } } };
  },
} }) }));
const OWNER_ID = "40000000-0000-4000-8000-000000000001";

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

// 병합된 업체는 대행사 지역이 여럿이라 지역 코드도 여럿이다.
const mergedVendor: PriceVendor = {
  ...studio("vendor-merged", "여러 지역 스튜디오"),
  regionCode: "seoul_gangnam3",
  regionCodes: ["seoul_gangnam3", "gangwon"],
};
const gangwonVendor: PriceVendor = {
  ...studio("vendor-gangwon", "강원 스튜디오"),
  regionCode: "gangwon",
  regionCodes: ["gangwon"],
};
const regionCatalog: PriceCatalog = {
  periodLabel: "2026Q3",
  categories: { studio: [mergedVendor, gangwonVendor], dress: [], makeup: [], hall: [] },
  counts: { studio: 2, dress: 0, makeup: 0, hall: 0 },
  agencies: [{ id: "agency-a", name: "대행사 A" }],
};

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
  const payload = body && typeof body === "object" && ("vendorIds" in body || "combos" in body)
    ? { ownerUserId: OWNER_ID, ...body } : body;
  return new Response(JSON.stringify(payload), {
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
    window.localStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await act(async () => root.unmount());
    document.body.replaceChildren();
  });

  it("keeps the public catalog visible and shows update guidance before an older native bridge reads private state", async () => {
    const postMessage = vi.fn();
    const fetchMock = vi.fn();
    vi.stubGlobal("ReactNativeWebView", { postMessage });
    vi.stubGlobal("__HANBANG_MOBILE_API_NONCE__", OWNER_ID);
    vi.stubGlobal("fetch", fetchMock);
    window.localStorage.setItem("hanbang:price:region", "");
    await act(async () => {
      root.render(<PriceExplorer catalog={catalog} category="studio" />);
      await flushAsyncWork();
    });
    expect(container.textContent).toContain("앱을 최신 버전으로 업데이트");
    expect(container.textContent).toContain("웹브라우저에서 hanbang.ai");
    expect(container.textContent).toContain(firstVendor.name);
    expect(postMessage).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
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

    expect(container.textContent).toContain("검수 전 미리보기 — 일반 사용자에게는 보이지 않음");
    expect(container.textContent).toContain("업체·가격·연결 정보의 정확성이 보장되지 않습니다.");
    const previewBadge = container.querySelector('[role="status"][aria-label="관리자 미리보기 상태"]');
    expect(previewBadge?.className).toContain("border-[#B89785]/35");
    expect(previewBadge?.className).toContain("bg-[var(--hb-surface-hover)]");
    expect(previewBadge?.className).toContain("text-[var(--hb-text-strong)]");
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
              name: "지난주 사진·드레스·메이크업 조합",
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
      .toContain("지난주 사진·드레스·메이크업 조합");
    expect(container.querySelector('aside[aria-label="사진·드레스·메이크업 조합"]')).toBeNull();
    expect(restoreButton).toBeDefined();

    await act(async () => {
      restoreButton?.click();
      await Promise.resolve();
    });

    expect(container.querySelector('aside[aria-label="사진·드레스·메이크업 조합"]')?.textContent)
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
    expect(container.querySelector('aside[aria-label="사진·드레스·메이크업 조합"]')?.textContent)
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

  it("restores saved add-ons from the public slim catalog through the options read", async () => {
    const slimVendor: PriceVendor = {
      ...firstVendor,
      offers: [{ ...firstVendor.offers[0], id: "slim-restore-offer", options: [], optionCount: 1 }],
    };
    const slimCatalog = { ...catalog, categories: { ...catalog.categories, studio: [slimVendor] } };
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes("vendor-options")) return jsonResponse({ options: [{
        id: "restore-addon", officialPriceId: "slim-restore-offer", name: "원본 파일",
        minimumKrw: 100_000, maximumKrw: 100_000, unit: null, condition: null,
        rawText: "원본 파일 10만원", isEffectivelyMandatory: false,
      }] });
      if (String(input).includes("/api/favorites")) return jsonResponse({ vendorIds: [] });
      return jsonResponse({ combos: [{
        id: "combo-options", name: "추가금 포함 조합", created_at: "2026-07-20T05:00:00.000Z",
        selections: {
          studio: { vendor_id: firstVendor.id, agency_id: "agency-a", base_krw: 1_000_000,
            selected_options: [{ name: "원본 파일", krw: 100_000 }], custom_krw: null },
          dress: null, makeup: null,
        },
      }] });
    });
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => {
      root.render(<PriceExplorer catalog={slimCatalog} category="studio" />);
      await flushAsyncWork();
    });
    const restoreButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("최근 저장 조합 불러오기"));
    await act(async () => { restoreButton?.click(); await flushAsyncWork(); });
    expect(container.querySelector('aside[aria-label="사진·드레스·메이크업 조합"]')?.textContent)
      .toContain(firstVendor.name);
    expect(container.querySelector('[role="status"]')?.textContent)
      .toContain("현재 공시 정보로 확인해 불러왔어요");
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("vendor-options"))).toBe(true);
    await act(async () => {
      container.querySelector<HTMLButtonElement>(`button[aria-label="${firstVendor.name} 빼기"]`)?.click();
    });
  });

  it.each(["lookup-failure", "edited-while-loading", "account-changed"])("preserves current choices on %s during restore", async (scenario) => {
    const offerId = `restore-${scenario}`;
    const slimVendor: PriceVendor = {
      ...firstVendor, offers: [{ ...firstVendor.offers[0], id: offerId, options: [], optionCount: 1 }],
    };
    const slimCatalog = { ...catalog, categories: { ...catalog.categories, studio: [slimVendor] } };
    window.sessionStorage.setItem("hanbang-price-combo-v1", JSON.stringify({ ownerId: null, selections: {
      studio: { vendorId: firstVendor.id, vendorSlug: firstVendor.slug, vendorName: firstVendor.name,
        agencyId: "agency-a", agencyName: "대행사 A", baseKrw: 1_000_000, selectedOptions: [], customKrw: null },
      dress: null, makeup: null,
    } }));
    let resolveOptions!: (response: Response) => void;
    const optionsPromise = new Promise<Response>((resolve) => { resolveOptions = resolve; });
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes("vendor-options")) return optionsPromise;
      if (String(input).includes("/api/favorites")) return jsonResponse({ vendorIds: [] });
      return jsonResponse({ combos: [{
        id: "combo-options", name: "추가금 포함 조합", created_at: "2026-07-20T05:00:00.000Z",
        selections: {
          studio: { vendor_id: firstVendor.id, agency_id: "agency-a", base_krw: 1_000_000,
            selected_options: [{ name: "원본 파일", krw: 100_000 }], custom_krw: null },
          dress: null, makeup: null,
        },
      }] });
    });
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => {
      root.render(<PriceExplorer catalog={slimCatalog} category="studio" />);
      await flushAsyncWork();
    });
    const restoreButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("최근 저장 조합 불러오기"));
    await act(async () => { restoreButton?.click(); });
    const replaceButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "바꾸기");
    await act(async () => { replaceButton?.click(); await Promise.resolve(); });
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("vendor-options"))).toHaveLength(1);
    if (scenario === "edited-while-loading") {
      await act(async () => {
        container.querySelector<HTMLButtonElement>(`button[aria-label="${firstVendor.name} 빼기"]`)?.click();
      });
    }
    if (scenario === "account-changed") {
      await act(async () => {
        for (const listener of authEvents.listeners) listener("SIGNED_IN", { user: { id: "40000000-0000-4000-8000-000000000002" } });
      });
    }
    await act(async () => {
      resolveOptions(scenario === "lookup-failure" ? jsonResponse({ error: "unavailable" }, 503) : jsonResponse({ options: [{
        id: "restore-addon", officialPriceId: offerId, name: "원본 파일", minimumKrw: 100_000,
        maximumKrw: 100_000, unit: null, condition: null, rawText: "원본 파일 10만원", isEffectivelyMandatory: false,
      }] }));
      await flushAsyncWork();
    });
    if (scenario === "edited-while-loading" || scenario === "account-changed") {
      expect(container.querySelector('aside[aria-label="사진·드레스·메이크업 조합"]')).toBeNull();
    } else {
      expect(container.querySelector('aside[aria-label="사진·드레스·메이크업 조합"]')?.textContent).toContain(firstVendor.name);
      expect(container.querySelector('[role="status"]')?.textContent).toContain("네트워크를 확인한 뒤");
      await act(async () => {
        container.querySelector<HTMLButtonElement>(`button[aria-label="${firstVendor.name} 빼기"]`)?.click();
      });
    }
  });

  it("discards the previous owner's saved combo immediately on account change", async () => {
    let switched = false;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      if (switched) return new Promise<Response>(() => {});
      return String(input).includes("favorites") ? jsonResponse({ vendorIds: [firstVendor.id] }) : jsonResponse({ combos: [{
        id: "owner-a-combo", name: "A계정의 비공개 조합", created_at: "2026-07-20T05:00:00.000Z",
        selections: { studio: { vendor_id: firstVendor.id, agency_id: "agency-a", base_krw: 1_000_000,
          selected_options: [], custom_krw: null }, dress: null, makeup: null },
      }] });
    }));
    await act(async () => {
      root.render(<PriceExplorer catalog={catalog} category="studio" />);
      await flushAsyncWork();
    });
    expect(container.textContent).toContain("A계정의 비공개 조합");
    switched = true;
    await act(async () => {
      for (const listener of authEvents.listeners) listener("SIGNED_IN", { user: { id: "40000000-0000-4000-8000-000000000002" } });
    });
    expect(container.textContent).not.toContain("A계정의 비공개 조합");
    expect(container.querySelector(`button[aria-label="${firstVendor.name} 찜 해제"]`)).toBeNull();
  });

  it.each([true, false])("keeps locally added choices scoped when private reads fail (session known: %s)", async (knownSession) => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "unavailable" }, 503)));
    await act(async () => {
      root.render(<PriceExplorer catalog={catalog} category="studio" />);
      await flushAsyncWork();
    });
    if (knownSession) {
      await act(async () => {
        for (const listener of authEvents.listeners) listener("INITIAL_SESSION", { user: { id: OWNER_ID } });
      });
    }
    await act(async () => {
      Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent?.includes("+ 조합에 담기"))?.click();
    });
    await act(async () => {
      Array.from(container.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'))
        .find((button) => button.textContent?.includes("담기"))?.click();
    });
    expect(container.querySelector('aside[aria-label="사진·드레스·메이크업 조합"]')).not.toBeNull();
    const raw = window.sessionStorage.getItem("hanbang-price-combo-v1");
    if (knownSession) expect(JSON.parse(raw ?? "{}").ownerId).toBe(OWNER_ID);
    else expect(raw).toBeNull();
    await act(async () => {
      for (const listener of authEvents.listeners) listener("SIGNED_IN", { user: { id: "40000000-0000-4000-8000-000000000002" } });
    });
    expect(container.querySelector('aside[aria-label="사진·드레스·메이크업 조합"]')).toBeNull();
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
    expect(new Headers(favoriteMutations[0][1]?.headers).get("X-Price-Expected-Owner")).toBe(OWNER_ID);
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

  it("keeps wrapped filter controls at least 44px tall on mobile", async () => {
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

    // 2026-07-23 회귀: 대행사 칩은 가로 스크롤(칸 밖으로 잘림) 대신 줄바꿈으로 담는다.
    expect(agencyControl?.className).toContain("min-h-11");
    expect(agencyControl?.parentElement?.className).toContain("flex-wrap");
    expect(agencyControl?.parentElement?.className).not.toContain("overflow-x-auto");
    expect(wishlistOnly?.className).toContain("min-h-11");

    // 2026-07-25 회귀: 같은 함정이 카테고리 탭에서 재발했다 — 375px에서 네 번째
    // 탭(웨딩홀)이 화면 밖에 놓여 스크롤 힌트 없이 사라졌다. 탭도 줄바꿈으로 담는다.
    const categoryNav = container.querySelector<HTMLElement>('nav[aria-label="가격 카테고리"]');
    expect(categoryNav?.className).toContain("flex-wrap");
    expect(categoryNav?.className).not.toContain("overflow-x-auto");
    expect(categoryNav?.querySelectorAll("a").length).toBe(4);
  });

  it("does not stretch a collapsed card when the neighboring card is expanded", async () => {
    vi.stubGlobal("fetch", vi.fn((input: string | URL | Request) => Promise.resolve(
      String(input).includes("/api/favorites")
        ? jsonResponse({ vendorIds: [] })
        : jsonResponse({ combos: [] }),
    )));

    await act(async () => {
      root.render(<PriceExplorer catalog={catalog} category="studio" />);
      await flushAsyncWork();
    });

    const grid = container.querySelector("article")?.parentElement;
    expect(grid?.className).toContain("items-start");
    expect(container.querySelector("article")?.className).not.toContain("h-full");
  });

  // 병합 이후 목록은 여러 지역이 섞인다 — 어느 지역 가격인지 모른 채 보게 두지
  // 않으려고 지역을 먼저 묻는다. 단, 막아 세우진 않고 목록은 그대로 렌더한다.
  it("asks for a region first, then remembers the choice", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse({ combos: [] }, 401))));

    await act(async () => {
      root.render(<PriceExplorer catalog={regionCatalog} category="studio" />);
      await flushAsyncWork();
    });

    expect(container.querySelector("#region-first-heading")).not.toBeNull();
    // 고르기 전에도 업체는 보인다 — 검색 노출과 "그냥 둘러보기"를 잃지 않는다.
    expect(container.textContent).toContain("여러 지역 스튜디오");

    const chips = Array.from(container.querySelectorAll<HTMLButtonElement>("button"));
    const gangwon = chips.find((button) => button.textContent?.startsWith("강원"));
    // 여러 지역에 걸친 업체는 각 지역에서 모두 세어야 한다(강원 = 병합 1 + 전용 1).
    expect(gangwon?.textContent).toContain("2");

    await act(async () => {
      gangwon?.click();
      await flushAsyncWork();
    });

    expect(container.querySelector("#region-first-heading")).toBeNull();
    expect(container.textContent).toContain("지역 바꾸기");
    expect(window.localStorage.getItem("hanbang.price.region")).toBe("gangwon");
    expect(
      container.querySelector('a[href^="/price/vendor/vendor-merged"]')
        ?.getAttribute("href"),
    ).toBe("/price/vendor/vendor-merged?region=gangwon");
  });

  // 공시 업체가 얇은 지역을 고르면 한두 곳만 덩그러니 보인다. 왜 적은지 말하지
  // 않으면 "이 서비스 별거 없네"로 읽힌다.
  it("explains thin coverage and offers a way out", async () => {
    window.localStorage.setItem("hanbang.price.region", "gangwon");
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse({ combos: [] }, 401))));

    await act(async () => {
      root.render(<PriceExplorer catalog={regionCatalog} category="studio" />);
      await flushAsyncWork();
    });

    expect(container.textContent).toContain("가격을 공시한 업체가");
    expect(container.textContent).toContain("실제 업체 수와는 다릅니다");
    const escape = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "전체 지역에서 찾아보기");
    expect(escape).not.toBeUndefined();

    await act(async () => {
      escape?.click();
      await flushAsyncWork();
    });
    // 전체 지역으로 빠져나가면 안내는 사라진다.
    expect(container.textContent).not.toContain("가격을 공시한 업체가");
  });

  it("skips the region step when a choice is already stored", async () => {
    window.localStorage.setItem("hanbang.price.region", "");
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse({ combos: [] }, 401))));

    await act(async () => {
      root.render(<PriceExplorer catalog={regionCatalog} category="studio" />);
      await flushAsyncWork();
    });

    // 빈 문자열은 "전체 지역을 골랐다"는 뜻이다 — 다시 묻지 않는다.
    expect(container.querySelector("#region-first-heading")).toBeNull();
    expect(container.textContent).toContain("전체 지역");
  });
});
