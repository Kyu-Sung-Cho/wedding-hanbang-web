import { beforeEach, describe, expect, it } from "vitest";
import {
  sanitizeCampaignAttribution,
  sanitizeUtmFields,
} from "@/utils/campaignAttribution";
import { persistFirstTouchUtm, readStoredUtm } from "@/utils/utm";

const STORAGE_KEY = "hanbang_first_utm";

describe("campaign attribution privacy boundary", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  it("accepts bounded human-readable campaign tokens", () => {
    expect(sanitizeCampaignAttribution("naver_kin", 80)).toBe("naver_kin");
    expect(sanitizeCampaignAttribution("여름-웨딩_2026", 80)).toBe("여름-웨딩_2026");
    expect(sanitizeUtmFields({ source: "Google", medium: "paid-search" })).toMatchObject({
      source: "Google",
      medium: "paid-search",
    });
  });

  it.each([
    "person@example.com",
    "https://example.com/private?token=secret",
    "01012345678",
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature123",
    "sk_live_1234567890",
    "campaign value with spaces",
    "abcdefghijklmnopqrstuvwxyz1234567890",
  ])("rejects PII, URL, credential, and opaque-token-shaped values: %s", (value) => {
    expect(sanitizeCampaignAttribution(value, 120)).toBeNull();
  });

  it("rejects rather than truncating an overlong value", () => {
    expect(sanitizeCampaignAttribution(`spring-${"x".repeat(100)}`, 80)).toBeNull();
  });

  it("does not persist a sensitive source from the URL", () => {
    window.history.replaceState({}, "", "/?utm_source=person%40example.com&utm_medium=social");

    persistFirstTouchUtm();

    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("revalidates and scrubs legacy session storage before returning it", () => {
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ source: "naver", medium: "person@example.com", campaign: "safe-campaign" }),
    );

    expect(readStoredUtm()).toEqual({ source: "naver", campaign: "safe-campaign" });
    expect(JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? "null")).toEqual({
      source: "naver",
      campaign: "safe-campaign",
    });
  });

  it("purges malformed or unsafe legacy storage", () => {
    window.sessionStorage.setItem(STORAGE_KEY, "{not-json");
    expect(readStoredUtm()).toBeNull();
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();

    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ source: "01012345678" }));
    expect(readStoredUtm()).toBeNull();
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
