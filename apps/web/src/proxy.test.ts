import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const middlewareMock = vi.hoisted(() => ({
  updateSession: vi.fn(async () => NextResponse.next()),
}));

vi.mock("@/lib/supabase/middleware", () => middlewareMock);

import { proxy } from "./proxy";

describe("proxy WeddingCode capability-token containment", () => {
  beforeEach(() => {
    middlewareMock.updateSession.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(["/wedding-code", "/wedding-code/result"])(
    "removes ct before rendering or redirecting %s",
    async (pathname) => {
      const response = await proxy(
        new NextRequest(
          `https://hanbang.ai${pathname}?ct=sensitive-capability-token&utm_source=legacy-invite`
        )
      );

      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(
        "https://hanbang.ai/wedding-code?utm_source=legacy-invite"
      );
      expect(response.headers.get("location")).not.toContain("ct=");
      expect(response.headers.get("location")).not.toContain(
        "sensitive-capability-token"
      );
      expect(middlewareMock.updateSession).not.toHaveBeenCalled();
    }
  );

  it("redirects the retired result route before its React tree can stream", async () => {
    const response = await proxy(
      new NextRequest(
        "https://hanbang.ai/wedding-code/result?utm_source=saved-result"
      )
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://hanbang.ai/wedding-code?utm_source=saved-result"
    );
    expect(middlewareMock.updateSession).not.toHaveBeenCalled();
  });

  it("keeps ordinary WeddingCode campaign parameters and continues session handling", async () => {
    const request = new NextRequest(
      "https://hanbang.ai/wedding-code?utm_source=validation-notice"
    );

    await proxy(request);

    expect(middlewareMock.updateSession).toHaveBeenCalledOnce();
    expect(middlewareMock.updateSession).toHaveBeenCalledWith(request);
  });
});

describe("proxy preview stub write fence", () => {
  beforeEach(() => {
    middlewareMock.updateSession.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("fails every API request closed with a non-cacheable 503", async () => {
    vi.stubEnv("NEXT_PUBLIC_PREVIEW_STUB_MODE", "true");

    const response = await proxy(
      new NextRequest("https://preview.example.test/api/community/posts")
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      error: "preview_stub_api_disabled",
    });
    expect(middlewareMock.updateSession).not.toHaveBeenCalled();
  });

  it("keeps the API fence when Supabase config is accidentally injected", async () => {
    vi.stubEnv("NEXT_PUBLIC_PREVIEW_STUB_MODE", "true");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://production.example.test");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "accidental-production-key");

    const response = await proxy(
      new NextRequest("https://preview.example.test/api/journey", {
        method: "PATCH",
      })
    );

    expect(response.status).toBe(503);
    expect(middlewareMock.updateSession).not.toHaveBeenCalled();
  });

  it("still renders public pages while the preview API fence is active", async () => {
    vi.stubEnv("NEXT_PUBLIC_PREVIEW_STUB_MODE", "true");
    const request = new NextRequest("https://preview.example.test/wedding");

    await proxy(request);

    expect(middlewareMock.updateSession).toHaveBeenCalledOnce();
    expect(middlewareMock.updateSession).toHaveBeenCalledWith(request);
  });
});
