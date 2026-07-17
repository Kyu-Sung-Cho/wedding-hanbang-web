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

describe("proxy production write fence", () => {
  beforeEach(() => {
    middlewareMock.updateSession.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"])(
    "fails %s API requests closed with a non-cacheable maintenance response",
    async (method) => {
      vi.stubEnv("PRODUCTION_WRITE_FENCE_ENABLED", "true");
      vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "a".repeat(40));

      const response = await proxy(
        new NextRequest("https://hanbang.ai/api/community/posts", { method })
      );

      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("retry-after")).toBe("60");
      expect(response.headers.get("x-hanbang-deployment-commit")).toBe(
        "a".repeat(40)
      );
      await expect(response.json()).resolves.toEqual({
        error: "production_write_fence_enabled",
      });
      expect(middlewareMock.updateSession).not.toHaveBeenCalled();
    }
  );

  it.each(["GET", "HEAD", "OPTIONS"])(
    "keeps %s API requests available for read-only and protocol traffic",
    async (method) => {
      vi.stubEnv("PRODUCTION_WRITE_FENCE_ENABLED", "true");
      const request = new NextRequest("https://hanbang.ai/api/vendors", { method });

      const response = await proxy(request);

      expect(response.status).toBe(200);
      expect(middlewareMock.updateSession).toHaveBeenCalledOnce();
      expect(middlewareMock.updateSession).toHaveBeenCalledWith(request);
    }
  );

  it.each([
    "/api/cron/amora-memory",
    "/api/auth/callback",
    "/api/auth/me",
    "/api/community/cohort",
    "/api/community/profile",
    "/api/couple/code",
    "/api/messages",
    "/api/vendors/12345678-1234-4234-8234-123456789abc",
  ])("blocks a GET route with known write side effects: %s", async (pathname) => {
    vi.stubEnv("PRODUCTION_WRITE_FENCE_ENABLED", "true");
    const response = await proxy(
      new NextRequest(`https://hanbang.ai${pathname}`, { method: "GET" })
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "production_write_fence_enabled",
    });
    expect(middlewareMock.updateSession).not.toHaveBeenCalled();
  });

  it("also blocks HEAD because Next.js may synthesize it from a mutating GET handler", async () => {
    vi.stubEnv("PRODUCTION_WRITE_FENCE_ENABLED", "true");
    const response = await proxy(
      new NextRequest("https://hanbang.ai/api/cron/care-moments", { method: "HEAD" })
    );

    expect(response.status).toBe(503);
    expect(middlewareMock.updateSession).not.toHaveBeenCalled();
  });

  it.each([
    "/api/vendors",
    "/api/messages/threads",
    "/api/community/cohort/123/timeline",
  ])("keeps an explicitly read-only neighboring GET available: %s", async (pathname) => {
    vi.stubEnv("PRODUCTION_WRITE_FENCE_ENABLED", "true");
    const request = new NextRequest(`https://hanbang.ai${pathname}`);

    const response = await proxy(request);

    expect(response.status).toBe(200);
    expect(middlewareMock.updateSession).toHaveBeenCalledWith(request);
  });

  it.each([undefined, "false", "TRUE", "1"])(
    "does not activate for the non-exact value %s",
    async (value) => {
      if (value === undefined) vi.stubEnv("PRODUCTION_WRITE_FENCE_ENABLED", undefined);
      else vi.stubEnv("PRODUCTION_WRITE_FENCE_ENABLED", value);
      const request = new NextRequest("https://hanbang.ai/api/community/posts", {
        method: "POST",
      });

      const response = await proxy(request);

      expect(response.status).toBe(200);
      expect(middlewareMock.updateSession).toHaveBeenCalledOnce();
      expect(middlewareMock.updateSession).toHaveBeenCalledWith(request);
    }
  );
});
