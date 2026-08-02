import { describe, expect, it } from "vitest";

import {
  normalizeVendorEventBatch,
  sanitizeVendorEventContext,
} from "../vendorEvents";
import {
  CLIENT_VENDOR_EVENT_TYPES,
  EVENT_WEIGHTS,
} from "../eventWeights";

const ANON_ID = "10000000-0000-4000-8000-000000000001";
const VENDOR_ID = "20000000-0000-4000-8000-000000000001";
const SESSION_ID = "30000000-0000-4000-8000-000000000001";

describe("vendor event contract", () => {
  it("owns the complete weight map on the server", () => {
    expect(EVENT_WEIGHTS).toEqual({
      page_view: 0,
      vendor_impression: 0,
      vendor_card_click: 1,
      vendor_detail_view: 2,
      addon_expand: 3,
      search: 1,
      filter_use: 1,
      wishlist_add: 5,
      combo_add: 8,
      combo_save: 10,
      combo_share: 6,
      budget_search: 4,
      alert_subscribe: 8,
      quote_request: 30,
    });
  });

  it("keeps every browser-ingestible event at low-trust weight one or below", () => {
    expect(CLIENT_VENDOR_EVENT_TYPES).toEqual([
      "page_view",
      "vendor_impression",
      "vendor_card_click",
      "search",
      "filter_use",
    ]);
    for (const eventType of CLIENT_VENDOR_EVENT_TYPES) {
      expect(EVENT_WEIGHTS[eventType]).toBeLessThanOrEqual(1);
    }
  });

  it("drops client weights and non-whitelisted context, including PII-shaped keys", () => {
    const parsed = normalizeVendorEventBatch({
      events: [{
        anon_id: ANON_ID,
        session_id: SESSION_ID,
        event_type: "vendor_card_click",
        vendor_id: VENDOR_ID,
        surface: "price_list",
        weight: 999,
        context: {
          category: "studio",
          zero_result: false,
          email: "person@example.test",
          name: "테스트 사용자",
          query: "원문 검색어",
        },
      }],
    });

    expect(parsed).toEqual([{
      anon_id: ANON_ID,
      session_id: SESSION_ID,
      event_type: "vendor_card_click",
      vendor_id: VENDOR_ID,
      agency_id: null,
      surface: "price_list",
      context: { category: "studio", zero_result: false },
      weight: 1,
    }]);
    expect(JSON.stringify(parsed)).not.toContain("person@example.test");
    expect(JSON.stringify(parsed)).not.toContain("원문 검색어");
  });

  it("accepts a direct array for sendBeacon and rejects oversized or invalid batches", () => {
    const event = {
      anon_id: ANON_ID,
      session_id: SESSION_ID,
      event_type: "page_view",
      surface: "price_detail",
      context: {},
    };
    expect(normalizeVendorEventBatch([event])).toHaveLength(1);
    expect(() => normalizeVendorEventBatch([])).toThrow("EVENT_BATCH_INVALID");
    expect(() => normalizeVendorEventBatch(Array.from({ length: 51 }, () => event)))
      .toThrow("EVENT_BATCH_INVALID");
    expect(() => normalizeVendorEventBatch([{ ...event, event_type: "forged" }]))
      .toThrow("EVENT_BATCH_INVALID");
    expect(() => normalizeVendorEventBatch([{
      ...event,
      session_id: "person@example.test",
    }])).toThrow("EVENT_BATCH_INVALID");
  });

  it.each(
    Object.keys(EVENT_WEIGHTS).filter(
      (eventType) => !CLIENT_VENDOR_EVENT_TYPES.includes(
        eventType as (typeof CLIENT_VENDOR_EVENT_TYPES)[number],
      ),
    ),
  )("rejects server-owned event %s from the browser envelope", (eventType) => {
    expect(() => normalizeVendorEventBatch([{
      anon_id: ANON_ID,
      session_id: SESSION_ID,
      event_type: eventType,
      vendor_id: VENDOR_ID,
      surface: "price_list",
      context: {},
    }])).toThrow("EVENT_BATCH_INVALID");
  });

  it("validates every retained context value and never throws while sanitizing", () => {
    expect(sanitizeVendorEventContext({
      region: "seoul_gangnam3",
      category: "studio",
      surface: "price_list",
      wedding_month: "2027-05",
      budget_band: "200_300",
      referrer_host: "example.test",
      zero_result: true,
    })).toEqual({
      region: "seoul_gangnam3",
      category: "studio",
      surface: "price_list",
      wedding_month: "2027-05",
      budget_band: "200_300",
      referrer_host: "example.test",
      zero_result: true,
    });
    expect(sanitizeVendorEventContext({
      wedding_month: "2027-13",
      budget_band: "unlimited",
      referrer_host: "https://example.test/path",
      zero_result: "yes",
    })).toEqual({});
    expect(sanitizeVendorEventContext(null)).toEqual({});
  });
});
