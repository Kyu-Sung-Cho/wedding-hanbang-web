import { describe, expect, it } from "vitest";

import {
  parseComboSaveBody,
  repriceComboSelections,
} from "./serverValidation";

const STUDIO_ID = "10000000-0000-4000-8000-000000000001";
const DRESS_ID = "10000000-0000-4000-8000-000000000002";
const AGENCY_ID = "20000000-0000-4000-8000-000000000001";
const PRICE_ID = "30000000-0000-4000-8000-000000000001";
const DIRECT_PRICE_ID = "30000000-0000-4000-8000-000000000002";
const OTHER_AGENCY_PRICE_ID = "30000000-0000-4000-8000-000000000003";

describe("price combo server validation", () => {
  it("accepts only the documented selections shape", () => {
    expect(parseComboSaveBody({
      name: "우리 조합",
      selections: {
        studio: {
          vendor_id: STUDIO_ID,
          agency_id: AGENCY_ID,
          base_krw: 1_240_000,
          selected_options: [{ name: "담당자 지정", krw: 200_000 }],
          custom_krw: null,
        },
        dress: null,
        makeup: null,
      },
    })).toEqual(expect.objectContaining({ name: "우리 조합" }));

    expect(parseComboSaveBody({
      selections: { studio: null, dress: null, makeup: null, venue: null },
    })).toBeNull();
    expect(parseComboSaveBody({
      selections: { studio: null, dress: null, makeup: null },
    })).toBeNull();
  });

  it("replaces client prices with current public catalog values", () => {
    const parsed = parseComboSaveBody({
      selections: {
        studio: {
          vendor_id: STUDIO_ID,
          agency_id: AGENCY_ID,
          base_krw: 1_240_000,
          selected_options: [{ name: "담당자 지정", krw: 1 }],
          custom_krw: null,
        },
        dress: null,
        makeup: null,
      },
    });
    expect(parsed).not.toBeNull();

    const result = repriceComboSelections(parsed!.selections, {
      prices: [{
        official_price_id: PRICE_ID,
        vendor_id: STUDIO_ID,
        category: "studio",
        agency_id: AGENCY_ID,
        price_min_krw: 1_240_000,
      }],
      options: [{
        official_price_id: PRICE_ID,
        name: "담당자 지정",
        price_min_krw: 200_000,
      }],
    });

    expect(result).toEqual({
      selections: {
        studio: {
          vendor_id: STUDIO_ID,
          agency_id: AGENCY_ID,
          base_krw: 1_240_000,
          selected_options: [{ name: "담당자 지정", krw: 200_000 }],
          custom_krw: null,
        },
        dress: null,
        makeup: null,
      },
      totalKrw: 1_440_000,
    });
  });

  it("rejects stale vendors, category swaps, and unlisted options", () => {
    const selection = {
      studio: {
        vendor_id: DRESS_ID,
        agency_id: AGENCY_ID,
        base_krw: 900_000,
        selected_options: [{ name: "가짜 옵션", krw: 1 }],
        custom_krw: null,
      },
      dress: null,
      makeup: null,
    } as const;

    expect(() => repriceComboSelections(selection, {
      prices: [{
        official_price_id: PRICE_ID,
        vendor_id: DRESS_ID,
        category: "dress",
        agency_id: AGENCY_ID,
        price_min_krw: 900_000,
      }],
      options: [],
    })).toThrow("COMBO_PUBLIC_PRICE_NOT_FOUND");
  });

  it("permits a bounded direct quote but still requires a public vendor", () => {
    const selection = {
      studio: {
        vendor_id: STUDIO_ID,
        agency_id: null,
        base_krw: 1_240_000,
        selected_options: [],
        custom_krw: 1_100_000,
      },
      dress: null,
      makeup: null,
    } as const;

    expect(repriceComboSelections(selection, {
      prices: [{
        official_price_id: PRICE_ID,
        vendor_id: STUDIO_ID,
        category: "studio",
        agency_id: null,
        price_min_krw: 1_240_000,
      }],
      options: [],
    }).totalKrw).toBe(1_100_000);

    expect(() => repriceComboSelections(selection, {
      prices: [],
      options: [],
    })).toThrow("COMBO_PUBLIC_PRICE_NOT_FOUND");
  });

  it("keeps a null agency and its options on one exact official price", () => {
    const parsed = parseComboSaveBody({
      selections: {
        studio: {
          vendor_id: STUDIO_ID,
          agency_id: null,
          base_krw: 1_000_000,
          selected_options: [{ name: "Original files", krw: 1 }],
          custom_krw: null,
        },
        dress: null,
        makeup: null,
      },
    });
    expect(parsed).not.toBeNull();

    const result = repriceComboSelections(parsed!.selections, {
      prices: [
        {
          official_price_id: OTHER_AGENCY_PRICE_ID,
          vendor_id: STUDIO_ID,
          category: "studio",
          agency_id: AGENCY_ID,
          price_min_krw: 1_000_000,
        },
        {
          official_price_id: DIRECT_PRICE_ID,
          vendor_id: STUDIO_ID,
          category: "studio",
          agency_id: null,
          price_min_krw: 1_000_000,
        },
      ],
      options: [
        {
          official_price_id: OTHER_AGENCY_PRICE_ID,
          name: "Original files",
          price_min_krw: 10_000,
        },
        {
          official_price_id: DIRECT_PRICE_ID,
          name: "Original files",
          price_min_krw: 20_000,
        },
      ],
    });

    expect(result.totalKrw).toBe(1_020_000);
    expect(result.selections.studio?.selected_options).toEqual([
      { name: "Original files", krw: 20_000 },
    ]);
  });
});
