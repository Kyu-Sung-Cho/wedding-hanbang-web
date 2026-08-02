import { describe, expect, it } from "vitest";

import { getTurnstileRequestHostname } from "../turnstileRequestHostname";

describe("Turnstile request hostname boundary", () => {
  it.each([
    ["web", "https://www.hanbang.ai/api/auth/signup", "www.hanbang.ai"],
    ["mobile", "https://hanbang.ai/api/auth/signup", "hanbang.ai"],
    ["local", "http://localhost:3000/api/auth/signup", "localhost"],
  ])("uses the canonical Next request URL for %s", (_client, url, expected) => {
    expect(getTurnstileRequestHostname(new Request(url))).toBe(expected);
  });

  it("does not trust spoofed forwarding or Host headers over request.url", () => {
    const request = new Request("https://hanbang.ai/api/auth/signup", {
      headers: {
        host: "attacker.example",
        "x-forwarded-host": "attacker.example",
      },
    });

    expect(getTurnstileRequestHostname(request)).toBe("hanbang.ai");
  });
});
