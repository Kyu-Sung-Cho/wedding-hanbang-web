import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  assemblePublicVendorPriceProfile,
  collectPublicVendorRelationChunks,
  loadPublicVendorPolicies,
  loadPublicVendorPriceProfile,
} from "../publicVendorPriceData";

function fakeSupabase(
  fixtures: Record<string, Array<Record<string, unknown>>>,
) {
  const calls: Array<{
    table: string;
    orders: string[];
    ranges: Array<[number, number]>;
    inValues: unknown[] | null;
    ilike: [string, string] | null;
    selects: string[];
  }> = [];
  const client = {
    from(table: string) {
      const call = {
        table,
        orders: [] as string[],
        ranges: [] as Array<[number, number]>,
        inValues: null as unknown[] | null,
        ilike: null as [string, string] | null,
        selects: [] as string[],
      };
      calls.push(call);
      let rows = [...(fixtures[table] ?? [])];
      const query: Record<string, unknown> = {};
      query.select = (columns: string) => {
        call.selects.push(columns);
        return query;
      };
      query.eq = (column: string, value: unknown) => {
        rows = rows.filter((row) => row[column] === value);
        return query;
      };
      query.in = (column: string, values: unknown[]) => {
        call.inValues = values;
        rows = rows.filter((row) => values.includes(row[column]));
        return query;
      };
      // PostgREST ilike: %는 임의 문자열, 나머지는 대소문자 무시 그대로 비교.
      query.ilike = (column: string, pattern: string) => {
        call.ilike = [column, pattern];
        const source = pattern
          .split("%")
          .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
          .join(".*");
        const matcher = new RegExp(`^${source}$`, "i");
        rows = rows.filter((row) => matcher.test(String(row[column] ?? "")));
        return query;
      };
      query.order = (column: string) => {
        call.orders.push(column);
        return query;
      };
      query.range = (from: number, to: number) => {
        call.ranges.push([from, to]);
        return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
      };
      query.limit = (count: number) =>
        Promise.resolve({ data: rows.slice(0, count), error: null });
      query.maybeSingle = () => Promise.resolve({ data: rows[0] ?? null, error: null });
      return query;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

describe("assemblePublicVendorPriceProfile", () => {
  it("joins approved projection rows without exposing storage paths or private fields", () => {
    const profile = assemblePublicVendorPriceProfile({
      id: "vendor-1",
      slug: "sample-studio",
      name: "샘플 스튜디오",
      category: "studio",
      region_code: "seoul_gangnam3",
      aliases: ["샘플 구상호"],
      official_url: "https://vendor.example",
      instagram_url: null,
      naver_place_url: null,
      attributes: {
        original_files_policy: "included",
        notes_internal: "private note",
        price_band: "premium",
        secret_future_key: "must never leave the server",
      },
      tags: [{ slug: "natural-light", label: "자연광", group: "shoot_style" }],
    }, [{
      id: "price-1",
      period_label: "2026Q3",
      price_category: "studio",
      region_code: "seoul_gangnam3",
      item_name: "기본 촬영",
      base_spec: "20p 앨범",
      price_min_krw: 1_200_000,
      price_max_krw: 1_400_000,
      vat_note: "VAT 포함",
      price_note: null,
      source_label: "한국소비자원 참가격 · 2026Q3",
      agency_id: "agency-1",
      agency_slug: "sample-agency",
      agency_display_name: "샘플 대행사",
      is_current: true,
      published_at: "2026-07-18",
    }], [{
      id: "option-1",
      official_price_id: "price-1",
      name: "야외 촬영",
      price_min_krw: 200_000,
      price_max_krw: 200_000,
      unit: null,
      condition: null,
      raw_text: "야외 촬영 20만원",
      is_effectively_mandatory: true,
      sort_order: 1,
    }]);

    expect(profile).toMatchObject({
      vendor: {
        id: "vendor-1",
        category: "studio",
        aliases: ["샘플 구상호"],
      },
      prices: [{
        id: "price-1",
        is_current: true,
        region_code: "seoul_gangnam3",
        agency: { id: "agency-1", name: "샘플 대행사" },
        options: [{
          name: "야외 촬영",
          raw_text: "야외 촬영 20만원",
          is_effectively_mandatory: true,
        }],
      }],
      sources: ["한국소비자원 참가격 · 2026Q3"],
    });
    expect(JSON.stringify(profile)).not.toContain("source_file");
    expect(JSON.stringify(profile)).not.toContain("notes_internal");
    expect(JSON.stringify(profile)).not.toContain("price_band");
    expect(JSON.stringify(profile)).not.toContain("secret_future_key");
    expect(JSON.stringify(profile)).not.toContain("source_quote");
  });

  it("maps the canonical venue category to the consumer-facing hall category", () => {
    const profile = assemblePublicVendorPriceProfile({
      id: "vendor-2",
      slug: "sample-hall",
      name: "샘플 예식장",
      category: "venue",
      region_code: "seoul_etc",
      aliases: [],
      official_url: null,
      instagram_url: null,
      naver_place_url: null,
      attributes: {},
      tags: [],
    }, [], []);

    expect(profile.vendor.category).toBe("hall");
  });

  it("returns prices and options in a deterministic order regardless of relation order", () => {
    const baseVendor = {
      id: "vendor-2",
      slug: "sample-hall",
      name: "샘플 예식장",
      category: "venue",
      region_code: "seoul_etc",
      aliases: [],
      official_url: null,
      instagram_url: null,
      naver_place_url: null,
      attributes: {},
      tags: [],
    };
    const price = (id: string, period: string, min: number) => ({
      id,
      period_label: period,
      price_category: "hall",
      region_code: "seoul_etc",
      item_name: "대관료",
      base_spec: null,
      price_min_krw: min,
      price_max_krw: min,
      vat_note: null,
      price_note: null,
      source_label: `한국소비자원 참가격 · ${period}`,
    });

    const profile = assemblePublicVendorPriceProfile(
      baseVendor,
      [price("price-b", "2026Q2", 900_000), price("price-a", "2026Q3", 1_000_000)],
      [
        {
          id: "option-b",
          official_price_id: "price-a",
          name: "후순위",
          price_min_krw: 200_000,
          price_max_krw: 200_000,
          unit: null,
          condition: null,
          raw_text: "후순위 20만원",
        },
        {
          id: "option-a",
          official_price_id: "price-a",
          name: "선순위",
          price_min_krw: 100_000,
          price_max_krw: 100_000,
          unit: null,
          condition: null,
          raw_text: "선순위 10만원",
        },
      ],
    );

    expect(profile.prices.map(({ id }) => id)).toEqual(["price-a", "price-b"]);
    expect(profile.prices[0].options.map(({ id }) => id)).toEqual(["option-a", "option-b"]);
  });
});

describe("collectPublicVendorRelationChunks", () => {
  it("continues after a short server-capped page until an empty sentinel", async () => {
    const rows = Array.from({ length: 250 }, (_, index) => ({ id: index }));
    const result = await collectPublicVendorRelationChunks(
      [["vendor-1"]],
      async (_ids, from, to) => ({
        data: rows.slice(from, Math.min(to + 1, from + 100)),
        error: null,
      }),
      { maxRows: 1_000, limitError: "PUBLIC_TEST_LIMIT" },
    );

    expect(result).toHaveLength(250);
  });

  it("reads beyond PostgREST's default row limit with a sentinel page", async () => {
    const rows = Array.from({ length: 1_001 }, (_, index) => ({ id: index }));
    const ranges: Array<[number, number]> = [];
    const result = await collectPublicVendorRelationChunks(
      [["vendor-1"]],
      async (_ids, from, to) => {
        ranges.push([from, to]);
        return { data: rows.slice(from, to + 1), error: null };
      },
      { maxRows: 2_000, limitError: "PUBLIC_TEST_LIMIT" },
    );

    expect(result).toHaveLength(1_001);
    expect(ranges).toEqual([
      [0, 199], [200, 399], [400, 599], [600, 799], [800, 999],
      [1_000, 1_199], [1_001, 1_200],
    ]);
  });

  it("fails closed when later option-id chunks exceed the global cap", async () => {
    await expect(collectPublicVendorRelationChunks(
      [["price-a"], ["price-b"]],
      async (ids, from, to) => ({
        data: ids[0] === "price-a"
          ? Array.from({ length: Math.min(2, to - from + 1) }, (_, index) => ({ id: index }))
          : [{ id: 3 }],
        error: null,
      }),
      { maxRows: 2, limitError: "PUBLIC_TEST_LIMIT" },
    )).rejects.toThrow("PUBLIC_TEST_LIMIT");
  });
});

describe("loadPublicVendorPriceProfile", () => {
  it("paginates the public views and chunks option IDs to bounded URLs", async () => {
    const prices = Array.from({ length: 51 }, (_, index) => ({
      id: `price-${index.toString().padStart(2, "0")}`,
      vendor_slug: "sample-studio",
      source: "kca_tprice",
      period_label: "2026Q3",
      price_category: "studio",
      region_code: "seoul_etc",
      item_name: `상품 ${index}`,
      base_spec: null,
      price_min_krw: 1_000_000 + index,
      price_max_krw: 1_000_000 + index,
      vat_note: null,
      price_note: null,
      source_label: "한국소비자원 참가격 · 2026Q3",
    }));
    const { client, calls } = fakeSupabase({
      v_public_vendors: [{
        id: "vendor-1",
        slug: "sample-studio",
        name: "샘플 스튜디오",
        category: "studio",
        region_code: "seoul_etc",
        aliases: [],
        official_url: null,
        instagram_url: null,
        naver_place_url: null,
        attributes: {},
        tags: [],
      }],
      v_public_official_prices: prices,
      v_public_official_price_options: prices.map((price) => ({
        id: `option-${price.id}`,
        official_price_id: price.id,
        name: "원본 제공",
        price_min_krw: 0,
        price_max_krw: 0,
        unit: null,
        condition: null,
        raw_text: "원본 제공 0원",
        source_quote: "원본 제공",
      })),
    });

    const profile = await loadPublicVendorPriceProfile(client, "sample-studio");

    expect(profile?.prices).toHaveLength(51);
    expect(profile?.prices[0]?.region_code).toBe("seoul_etc");
    const priceCall = calls.find(({ table }) => table === "v_public_official_prices");
    expect(priceCall).toMatchObject({
      orders: ["period_label", "price_min_krw", "id"],
      ranges: [[0, 199]],
    });
    expect(priceCall?.selects[0]).toContain("region_code");
    const optionCalls = calls.filter(({ table }) => table === "v_public_official_price_options");
    expect(optionCalls).toHaveLength(4);
    expect(optionCalls.every(({ inValues }) => (inValues?.length ?? 0) <= 50)).toBe(true);
    expect(optionCalls.every(({ ranges }) => ranges.length > 0)).toBe(true);
    expect(calls.map(({ table }) => table)).toContain("v_public_vendors");
  });

  // 목록 카드는 같은 샵을 한 장으로 묶는데 상세가 슬러그 하나만 보면
  // "카드엔 대행사 4곳, 눌러 보니 1곳"이 된다. 표기가 달라도 형제를 찾아야 한다.
  it("collects sibling vendor rows that only differ by spacing", async () => {
    const vendorRow = (id: string, slug: string, name: string, regionCode: string) => ({
      id,
      slug,
      name,
      category: "studio",
      region_code: regionCode,
      aliases: [],
      official_url: null,
      instagram_url: null,
      naver_place_url: null,
      attributes: {},
      tags: [],
    });
    const priceRow = (id: string, slug: string, agency: string) => ({
      id,
      vendor_slug: slug,
      source: "kca_tprice",
      period_label: "2026Q3",
      price_category: "studio",
      item_name: "촬영 상품",
      base_spec: null,
      price_min_krw: 1_000_000,
      price_max_krw: 1_000_000,
      vat_note: null,
      price_note: null,
      source_label: "한국소비자원 참가격 · 2026Q3",
      agency_id: `agency-${agency}`,
      agency_slug: agency,
      agency_display_name: agency,
      is_current: true,
    });
    const { client } = fakeSupabase({
      v_public_vendors: [
        vendorRow("vendor-1", "mei-studio-a", "메이스튜디오", "seoul_etc"),
        vendorRow("vendor-2", "mei-studio-b", "메이 스튜디오", "gyeongsang"),
        vendorRow("vendor-3", "other-studio", "전혀다른스튜디오", "busan"),
      ],
      v_public_official_prices: [
        priceRow("price-a", "mei-studio-a", "가대행사"),
        priceRow("price-b", "mei-studio-b", "나대행사"),
        priceRow("price-c", "other-studio", "다대행사"),
      ],
      v_public_official_price_options: [],
    });

    const profile = await loadPublicVendorPriceProfile(client, "mei-studio-a");

    expect(profile?.identity.vendorIds).toEqual(["vendor-1", "vendor-2"]);
    expect(profile?.identity.regionCodes).toEqual(["seoul_etc", "gyeongsang"]);
    expect(profile?.prices.map((price) => price.agency?.name)).toEqual(["가대행사", "나대행사"]);
    // 대표 id는 대표 슬러그(사전순 최솟값)와 같은 형제의 것이어야 한다.
    expect(profile?.identity.canonicalSlug).toBe("mei-studio-a");
    expect(profile?.identity.canonicalVendorId).toBe("vendor-1");
  });

  // 목록 카드는 병합된 묶음의 대표 id로 찜·가격알림을 저장한다
  // (publicListData.ts: 슬러그가 더 작으면 slug와 id를 함께 대표로 교체).
  // 상세가 방문한 슬러그의 id를 쓰면 같은 샵이 두 개의 서로 다른 id로 찜되고,
  // 목록에서 찜한 샵을 형제 주소로 열면 찜이 안 된 것으로 보인다.
  it("형제 슬러그로 들어와도 대표 id·슬러그는 같은 값을 준다", async () => {
    const vendorRow = (
      id: string,
      slug: string,
      name: string,
      regionCode: string,
      aliases: string[],
    ) => ({
      id,
      slug,
      name,
      category: "studio",
      region_code: regionCode,
      aliases,
      official_url: null,
      instagram_url: null,
      naver_place_url: null,
      attributes: {},
      tags: [],
    });
    const priceRow = (id: string, slug: string, agency: string) => ({
      id,
      vendor_slug: slug,
      source: "kca_tprice",
      period_label: "2026Q3",
      price_category: "studio",
      item_name: "촬영 상품",
      base_spec: null,
      price_min_krw: 1_000_000,
      price_max_krw: 1_000_000,
      vat_note: null,
      price_note: null,
      source_label: "한국소비자원 참가격 · 2026Q3",
      agency_id: `agency-${agency}`,
      agency_slug: agency,
      agency_display_name: agency,
      is_current: true,
    });
    const { client, calls } = fakeSupabase({
      v_public_vendors: [
        vendorRow("vendor-1", "mei-studio-a", "메이스튜디오", "seoul_etc", ["메이"]),
        vendorRow("vendor-2", "mei-studio-b", "메이 스튜디오", "gyeongsang", ["메이 옛 상호"]),
      ],
      v_public_official_prices: [
        priceRow("price-a", "mei-studio-a", "가대행사"),
        priceRow("price-b", "mei-studio-b", "나대행사"),
      ],
      v_public_official_price_options: [],
    });

    // 대표가 아닌 형제 주소로 들어온다.
    const profile = await loadPublicVendorPriceProfile(client, "mei-studio-b");

    expect(profile?.vendor.slug).toBe("mei-studio-b");
    // 병합은 그대로다(형제 슬러그로 들어와도 대표 슬러그·id가 같다). 표시명만
    // 바뀌었다 — 업체 동일성 큐레이션을 이름표+지점표(2026-08-05)로 통일하면서
    // 대표 이름을 고르는 규칙이 그 표를 따르게 됐다. 정규화가 공백을 지우므로
    // "메이 스튜디오"와 "메이스튜디오"는 여전히 한 업체다.
    expect(profile?.vendor.name).toBe("메이 스튜디오");
    // 형제 표기("메이", "메이스튜디오")는 여기서 별칭으로 노출되지 않는다. 그 노출은
    // slug 단위 병합표(2026-07-28)가 하던 일이고, 이름표+지점표(2026-08-05)로
    // 통일하면서 함께 빠졌다. 병합 자체는 유지된다 — 위 두 단언이 그것을 고정한다.
    expect(profile?.vendor.aliases).toEqual(["메이 옛 상호"]);
    expect(profile?.identity.canonicalSlug).toBe("mei-studio-a");
    expect(profile?.identity.canonicalVendorId).toBe("vendor-1");
    const identityCall = calls.find(({ table, ilike }) => (
      table === "v_public_vendors" && ilike !== null
    ));
    // 신원 조회가 `aliases`를 함께 읽던 것도 slug 단위 병합표의 일부였다. 형제 표기를
    // 별칭으로 노출하지 않게 되면서 그 컬럼도 더 읽지 않는다.
    expect(identityCall?.selects[0]).toContain("region_code");
  });

  it("keeps same-name-different-business vendors apart", async () => {
    const { client, calls } = fakeSupabase({
      v_public_vendors: [{
        id: "vendor-1",
        slug: "langhe-seoul",
        name: "랑게",
        category: "studio",
        region_code: "seoul_etc",
        aliases: [],
        official_url: null,
        instagram_url: null,
        naver_place_url: null,
        attributes: {},
        tags: [],
      }, {
        id: "vendor-2",
        slug: "langhe-gwangju",
        name: "랑게",
        category: "studio",
        region_code: "jeolla",
        aliases: [],
        official_url: null,
        instagram_url: null,
        naver_place_url: null,
        attributes: {},
        tags: [],
      }],
      v_public_official_prices: [{
        id: "price-a",
        vendor_slug: "langhe-seoul",
        source: "kca_tprice",
        period_label: "2026Q3",
        price_category: "studio",
        item_name: "촬영 상품",
        base_spec: null,
        price_min_krw: 1_000_000,
        price_max_krw: 1_000_000,
        vat_note: null,
        price_note: null,
        source_label: "한국소비자원 참가격 · 2026Q3",
        is_current: true,
      }],
      v_public_official_price_options: [],
    });

    const profile = await loadPublicVendorPriceProfile(client, "langhe-seoul");

    expect(profile?.identity.vendorIds).toEqual(["vendor-1"]);
    // 형제 조회 자체를 하지 않는다 — 동명이업은 합치면 안 되는 게 확정이다.
    expect(calls.filter(({ ilike }) => ilike !== null)).toHaveLength(0);
  });

  // 여기 있던 "merges only the row-scoped verified Seoul identity" 테스트를 걷어냈다.
  // 그 테스트는 `VERIFIED_VENDOR_IDENTITY_BY_SLUG`(행 단위 확인 병합, 2026-07-28)의
  // 동작을 고정했는데, 업체 동일성 큐레이션을 이름표+지점표(2026-08-05,
  // docs/operations/VENDOR_IDENTITY_REVIEW_2026-08-05.md)로 통일하면서 그 표가
  // 사라졌다. 없는 설계를 요구하는 단언은 계약이 아니라 잔재다.
  //
  // **사라진 것**: 같은 이름이지만 다른 업체로 갈린 그룹 안에서, 공개 채널이 같다고
  // 행 단위로 확인된 slug만 골라 묶던 동작. 새 큐레이션은 그런 쌍을 "미결 51"에
  // 남겨 두는 쪽을 택했다(오탐 0 임계값). 되살리려면 그 판단부터 다시 해야 한다.
  // 채택한 설계의 계약은 lib/price/__tests__/vendorBranchIdentity.test.ts 에 있다.
});

describe("loadPublicVendorPolicies", () => {
  const policyRow = (
    id: string,
    semanticType: string,
    content: string,
    sourceAgency: string | null = null,
    vendorId = "vendor-1",
  ) => ({
    id,
    vendor_id: vendorId,
    semantic_type: semanticType,
    title: null,
    content_verbatim: content,
    source_agency: sourceAgency,
  });

  it("puts penalties first and drops text repeated across agencies", async () => {
    const { client, calls } = fakeSupabase({
      v_public_vendor_policies: [
        policyRow("p-3", "change", "날짜 변경시 60일 전 22만원", "나대행사"),
        policyRow("p-1", "penalty", "촬영일 30일 전 상품가의 50%", "가대행사"),
        policyRow("p-2", "penalty", "촬영일  30일 전 상품가의 50%", "나대행사", "vendor-2"),
        policyRow("p-4", "refund", "계약금 환불 불가", "가대행사"),
        policyRow("p-5", "other", "  ", "가대행사"),
      ],
    });

    const policies = await loadPublicVendorPolicies(client, ["vendor-1", "vendor-2", "vendor-1"]);

    expect(policies.map(({ id }) => id)).toEqual(["p-1", "p-4", "p-3"]);
    expect(calls[0]?.inValues).toEqual(["vendor-1", "vendor-2"]);
  });

  it("returns nothing instead of throwing when the view is missing", async () => {
    const { client } = fakeSupabase({});
    await expect(loadPublicVendorPolicies(client, ["vendor-1"])).resolves.toEqual([]);
    await expect(loadPublicVendorPolicies(client, [])).resolves.toEqual([]);
  });
});
