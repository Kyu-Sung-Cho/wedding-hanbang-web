import { describe, expect, it } from "vitest";

import { normalizeExternalHttpsUrl } from "./externalUrls";

describe("normalizeExternalHttpsUrl", () => {
  it("accepts HTTPS on an exact domain or subdomain", () => {
    expect(normalizeExternalHttpsUrl("https://map.naver.com/p/search/test", ["naver.com"]))
      .toBe("https://map.naver.com/p/search/test");
    expect(normalizeExternalHttpsUrl("https://naver.com/", ["naver.com"]))
      .toBe("https://naver.com/");
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,boom",
    "http://map.naver.com/test",
    "https://naver.com.evil.test/test",
    "https://evil.test/?next=https://naver.com",
    "https://user:pass@naver.com/test",
    "https://naver.com/%250d%250aSet-Cookie:test",
  ])("rejects executable, insecure, or deceptive URLs: %s", (value) => {
    expect(normalizeExternalHttpsUrl(value, ["naver.com"])).toBeNull();
  });
});
