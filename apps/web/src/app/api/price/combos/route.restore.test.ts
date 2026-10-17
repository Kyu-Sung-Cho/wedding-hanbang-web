import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ ownerClient: vi.fn(), publicClient: vi.fn(), profile: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: mocks.ownerClient }));
vi.mock("@/lib/supabase/public", () => ({ createPublicClient: mocks.publicClient }));
vi.mock("@/lib/vendors/publicVendorPriceData", () => ({ loadPublicVendorPriceProfile: mocks.profile }));
import { GET } from "./route";

const COMBO = "50000000-0000-4000-8000-000000000001";
const VENDOR = "10000000-0000-4000-8000-000000000001";
const AGENCY = "20000000-0000-4000-8000-000000000001";
const ownerFilters: Array<[string, string]> = [];
let saved: Record<string, unknown> | null;
let owner: string | null;
let publicRows: Array<{ id: string; slug: string }>;

function profile() {
  return {
    vendor: { id: VENDOR, slug: "qa-studio", displayName: "QA 스튜디오", aliases: [], region_code: null, category: "studio" },
    identity: { canonicalSlug: "qa-studio", canonicalVendorId: VENDOR },
    prices: [{ id: "qa-offer", category: "studio", item_name: "기본 촬영", base_spec: null,
      price_min_krw: 1_850_000, price_max_krw: null, price_note: null, vat_note: null, is_current: true,
      agency: { id: AGENCY, name: "QA 대행사" },
      options: [{ id: "qa-option", name: "앨범", price_min_krw: 33_000, price_max_krw: null,
        unit: null, condition: null, raw_text: "QA 합성 옵션", is_effectively_mandatory: false }],
    }],
  };
}

beforeEach(() => {
  vi.clearAllMocks(); ownerFilters.length = 0; owner = "actor-a";
  publicRows = [{ id: VENDOR, slug: "qa-studio" }];
  saved = { id: COMBO, name: "QA 조합", created_at: "2026-10-17T00:00:00Z", selections: {
    studio: { vendor_id: VENDOR, agency_id: AGENCY, base_krw: 1_850_000, selected_options: [], custom_krw: null },
    dress: null, makeup: null,
  } };
  const query = {
    select: vi.fn().mockReturnThis(), eq: vi.fn((column: string, value: string) => { ownerFilters.push([column, value]); return query; }),
    maybeSingle: vi.fn(async () => ({ data: saved, error: null })),
    order: vi.fn().mockReturnThis(), limit: vi.fn(async () => ({ data: saved ? [saved] : [], error: null })),
  };
  mocks.ownerClient.mockResolvedValue({ auth: { getUser: vi.fn(async () => ({ data: { user: owner ? { id: owner } : null } })) }, from: vi.fn(() => query) });
  mocks.publicClient.mockReturnValue({ from: vi.fn(() => ({ select: vi.fn(() => ({ in: vi.fn(async () => ({ data: publicRows, error: null })) })) })) });
  mocks.profile.mockImplementation(async () => profile());
});

function request() { return new Request(`https://hanbang.ai/api/price/combos?restore=${COMBO}`); }

describe("owner saved combo restore", () => {
  it.each([[null, false, 1_850_000], [null, true, 1_883_000], [1_000_000, false, 1_000_000], [1_000_000, true, 1_033_000]])(
    "validates full public offers/options for custom=%s options=%s", async (custom, withOptions, expected) => {
      const selections = saved!.selections as { studio: { custom_krw: number | null; selected_options: Array<{ name: string; krw: number }> } };
      selections.studio.custom_krw = custom as number | null;
      selections.studio.selected_options = withOptions ? [{ name: "앨범", krw: 33_000 }] : [];
      const response = await GET(request());
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.restore?.restoredCategories).toEqual(["studio"]);
      const selection = body.restore.selections.studio;
      expect((selection.customKrw ?? selection.baseKrw) + selection.selectedOptions.reduce((sum: number, option: { krw: number }) => sum + option.krw, 0)).toBe(expected);
      expect(ownerFilters).toContainEqual(["user_id", "actor-a"]);
      expect(ownerFilters).toContainEqual(["id", COMBO]);
      expect(mocks.profile).toHaveBeenCalledWith(expect.anything(), "qa-studio", { strictIdentity: true, currentOnly: true });
      expect(response.headers.get("cache-control")).toContain("no-store");
    },
  );
  it("distinguishes a failed public lookup from a changed/closed offer", async () => {
    mocks.profile.mockRejectedValueOnce(new Error("synthetic options unavailable"));
    expect((await GET(request())).status).toBe(503);
    mocks.profile.mockResolvedValueOnce({ ...profile(), prices: [] });
    const changed = await (await GET(request())).json();
    expect(changed.restore.restoredCategories).toEqual([]);
    expect(changed.restore.skippedCategories).toEqual(["studio"]);
  });
  it("does not load public data for an unauthenticated or inaccessible saved row", async () => {
    owner = null;
    expect((await GET(request())).status).toBe(401);
    owner = "actor-b"; saved = null;
    expect((await GET(request())).status).toBe(404);
    expect(mocks.publicClient).not.toHaveBeenCalled();
  });
  it("returns a private bounded 503 if the saved-owner lookup itself throws", async () => {
    const client = await mocks.ownerClient();
    client.from("combos").maybeSingle.mockRejectedValueOnce(new Error("synthetic owner lookup unavailable"));
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-hanbang-response-bytes")).toMatch(/^\d+$/);
    expect(mocks.publicClient).not.toHaveBeenCalled();
  });
  it("restores all three saved categories independent of the active browser category and a cheapest-only shortlist", async () => {
    const DRESS = "10000000-0000-4000-8000-000000000002";
    const MAKEUP = "10000000-0000-4000-8000-000000000003";
    const selections = saved!.selections as Record<string, unknown>;
    selections.dress = { vendor_id: DRESS, agency_id: AGENCY, base_krw: 2_300_000, selected_options: [{ name: "앨범", krw: 33_000 }], custom_krw: null };
    selections.makeup = { vendor_id: MAKEUP, agency_id: AGENCY, base_krw: 1_850_000, selected_options: [], custom_krw: 500_000 };
    publicRows.push({ id: DRESS, slug: "qa-dress" }, { id: MAKEUP, slug: "qa-makeup" });
    mocks.profile.mockImplementation(async (_client, slug: string) => {
      const result = profile();
      const category = slug === "qa-dress" ? "dress" : slug === "qa-makeup" ? "makeup" : "studio";
      result.vendor.category = category;
      result.prices[0].category = category;
      if (category === "dress") {
        result.prices.push({ ...result.prices[0], id: "non-cheapest", price_min_krw: 2_300_000 });
      }
      return result;
    });
    const body = await (await GET(request())).json();
    expect(body.restore.restoredCategories).toEqual(["studio", "dress", "makeup"]);
    expect(body.restore.selections.dress.baseKrw).toBe(2_300_000);
    expect(body.restore.selections.dress.selectedOptions).toHaveLength(1);
    expect(mocks.profile).toHaveBeenCalledTimes(3);
  });
  it.each([`&restore=${COMBO}`, "&extra=1"])("rejects an ambiguous restore query %s", async (suffix) => {
    const response = await GET(new Request(request().url + suffix));
    expect(response.status).toBe(400);
    expect(mocks.publicClient).not.toHaveBeenCalled();
  });
});
