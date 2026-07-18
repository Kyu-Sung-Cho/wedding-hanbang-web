import { describe, expect, it } from "vitest";

import { parseVendorRecommendationRequest } from "../recommendationRequest";

describe("parseVendorRecommendationRequest", () => {
  it("normalizes duplicate filters and applies a bounded default limit", () => {
    const result = parseVendorRecommendationRequest({
      category: "studio",
      region_codes: ["seoul_gangnam3", "seoul_gangnam3"],
      preferred_tags: [" 자연광 ", "자연광", "필름감성"],
      required_attrs: { original_files_policy: "included" },
      wedding_month: "2026-11",
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toMatchObject({
      region_codes: ["seoul_gangnam3"],
      preferred_tags: ["자연광", "필름감성"],
      limit: 5,
    });
  });

  it("rejects unknown categories, invalid months, and unsafe filter sizes", () => {
    for (const input of [
      { category: "venue" },
      { category: "studio", wedding_month: "2026-13" },
      { category: "studio", budget_max_krw: -1 },
      { category: "studio", limit: 21 },
      { category: "studio", region_codes: ["../seoul"] },
      { category: "studio", region_codes: ["seoul_unknown"] },
    ]) {
      expect(parseVendorRecommendationRequest(input).success, JSON.stringify(input)).toBe(false);
    }
  });

  it("validates required attributes against the category schema and blocks internal fields", () => {
    expect(parseVendorRecommendationRequest({
      category: "studio",
      required_attrs: { original_files_policy: "included" },
    }).success).toBe(true);

    for (const required_attrs of [
      { original_files_policy: "invented" },
      { hall_type: "hotel" },
      { notes_internal: "private" },
      { price_band: "premium" },
    ]) {
      expect(parseVendorRecommendationRequest({
        category: "studio",
        required_attrs,
      }).success, JSON.stringify(required_attrs)).toBe(false);
    }
  });

  it("rejects non-object bodies", () => {
    for (const input of [null, [], "studio", 1]) {
      expect(parseVendorRecommendationRequest(input).success).toBe(false);
    }
  });
});
