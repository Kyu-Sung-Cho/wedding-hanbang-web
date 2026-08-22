import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const middlewareMock = vi.hoisted(() => ({
  updateSession: vi.fn(async () => NextResponse.next()),
}));

vi.mock("@/lib/supabase/middleware", () => middlewareMock);

import { config, proxy } from "./proxy";

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

  it("allows only the non-persistent demo-cookie starter through the preview fence", async () => {
    vi.stubEnv("NEXT_PUBLIC_PREVIEW_STUB_MODE", "true");
    const request = new NextRequest("https://preview.example.test/api/demo/start", {
      method: "POST",
      headers: {
        origin: "https://preview.example.test",
        "sec-fetch-site": "same-origin",
      },
    });

    const response = await proxy(request);

    expect(response.status).toBe(200);
    expect(middlewareMock.updateSession).toHaveBeenCalledOnce();
    expect(middlewareMock.updateSession).toHaveBeenCalledWith(request);
  });

  it("does not exempt other methods on the demo path", async () => {
    vi.stubEnv("NEXT_PUBLIC_PREVIEW_STUB_MODE", "true");

    const response = await proxy(
      new NextRequest("https://preview.example.test/api/demo/start"),
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

describe("proxy API mutation trust boundary", () => {
  beforeEach(() => {
    middlewareMock.updateSession.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("blocks a cross-site cookie mutation before session middleware", async () => {
    const response = await proxy(new NextRequest(
      "https://hanbang.ai/api/community/posts",
      {
        method: "POST",
        headers: {
          origin: "https://evil.example",
          "sec-fetch-site": "cross-site",
          cookie: "sb-session=ambient",
        },
      },
    ));

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toEqual({
      error: "untrusted_mutation_origin",
    });
    expect(middlewareMock.updateSession).not.toHaveBeenCalled();
  });

  it("allows a same-origin browser mutation to continue", async () => {
    const request = new NextRequest("https://hanbang.ai/api/community/posts", {
      method: "POST",
      headers: {
        origin: "https://hanbang.ai",
        "sec-fetch-site": "same-origin",
      },
    });

    await proxy(request);

    expect(middlewareMock.updateSession).toHaveBeenCalledWith(request);
  });

  it("allows a native Bearer mutation without browser fetch metadata", async () => {
    const request = new NextRequest("https://hanbang.ai/api/community/posts", {
      method: "POST",
      headers: { authorization: "Bearer native-session-token" },
    });

    await proxy(request);

    expect(middlewareMock.updateSession).toHaveBeenCalledWith(request);
  });

  it("does not fall back to cookies when Authorization is malformed", async () => {
    const response = await proxy(new NextRequest(
      "https://hanbang.ai/api/community/posts",
      {
        method: "POST",
        headers: {
          authorization: "Bearer malformed token",
          origin: "https://hanbang.ai",
          "sec-fetch-site": "same-origin",
        },
      },
    ));

    expect(response.status).toBe(403);
    expect(middlewareMock.updateSession).not.toHaveBeenCalled();
  });

  it.each(["/api/auth/signup", "/api/auth/forgot-password"])(
    "preserves the non-ambient Turnstile flow for %s",
    async (pathname) => {
      const request = new NextRequest(`https://hanbang.ai${pathname}`, {
        method: "POST",
      });

      await proxy(request);

      expect(middlewareMock.updateSession).toHaveBeenCalledWith(request);
    },
  );

  it("leaves internal-token routes to their constant-time route verifier", async () => {
    const request = new NextRequest(
      "https://hanbang.ai/api/internal/vendors/recommend",
      {
        method: "POST",
        headers: { "x-internal-token": "route-verifies-this-secret" },
      },
    );

    await proxy(request);

    expect(middlewareMock.updateSession).toHaveBeenCalledWith(request);
  });
});

describe("proxy WeddingCode research zero-I/O fence", () => {
  beforeEach(() => {
    middlewareMock.updateSession.mockClear();
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("WEDDING_CODE_RESEARCH_PREVIEW", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("allows only a loopback read of the dedicated research document", async () => {
    const response = await proxy(new NextRequest(
      "http://127.0.0.1:3106/internal/wedding-code-research?form=A",
      { method: "GET" },
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
    expect(middlewareMock.updateSession).not.toHaveBeenCalled();
  });

  it("keeps the image optimizer inside the deployed middleware matcher", () => {
    expect(config.matcher).toContain("/_next/image");
  });

  it("keeps every API path inside the matcher even when it ends like an image", () => {
    expect(config.matcher).toContain("/api/:path*");
  });

  it.each([
    ["GET", "/api/wedding-code/answers"],
    ["GET", "/api/community/vendor-tags/foo.png"],
    ["POST", "/api/auth/me"],
    ["POST", "/internal/wedding-code-research"],
    ["POST", "/ingest/collect"],
    ["GET", "/wedding/lounge"],
    ["GET", "/_next/data/build-id/wedding-code.json"],
    ["GET", "/_next/image?w=64&q=75"],
    ["GET", "/_next/image?url=https%3A%2F%2Fleak.supabase.co%2Fprivate.png&w=64&q=75"],
    ["GET", "/_next/image?url=%2F%2Fleak.supabase.co%2Fprivate.png&w=64&q=75"],
  ])("blocks %s %s before any application handler", async (method, pathname) => {
    const response = await proxy(new NextRequest(`http://127.0.0.1:3106${pathname}`, {
      method,
    }));

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toEqual({
      error: "wedding_code_research_preview_io_disabled",
    });
    expect(middlewareMock.updateSession).not.toHaveBeenCalled();
  });

  it("allows only an approved same-origin optimized image source", async () => {
    const response = await proxy(new NextRequest(
      "http://127.0.0.1:3106/_next/image?url=%2Fimages%2Ffavicon.png&w=64&q=75",
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(middlewareMock.updateSession).not.toHaveBeenCalled();
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
    // 메일 인증 링크. GET 이지만 세션을 세우고 가입을 확정한다.
    "/api/auth/confirm",
    "/api/auth/me",
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
    "/api/community/cohort",
    "/api/community/profile",
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
        headers: {
          origin: "https://hanbang.ai",
          "sec-fetch-site": "same-origin",
        },
      });

      const response = await proxy(request);

      expect(response.status).toBe(200);
      expect(middlewareMock.updateSession).toHaveBeenCalledOnce();
      expect(middlewareMock.updateSession).toHaveBeenCalledWith(request);
    }
  );
});

describe("proxy community runtime kill switch", () => {
  beforeEach(() => {
    middlewareMock.updateSession.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("turns community mutations read-only without taking reads down", async () => {
    vi.stubEnv("COMMUNITY_RUNTIME_MODE", "read_only");

    const blocked = await proxy(new NextRequest(
      "https://hanbang.ai/api/community/posts",
      {
        method: "POST",
        headers: {
          origin: "https://hanbang.ai",
          "sec-fetch-site": "same-origin",
        },
      },
    ));
    expect(blocked.status).toBe(503);
    expect(blocked.headers.get("cache-control")).toBe("no-store");
    await expect(blocked.json()).resolves.toEqual({ error: "community_read_only" });

    const read = new NextRequest("https://hanbang.ai/api/community/posts");
    await expect(proxy(read)).resolves.toHaveProperty("status", 200);
    expect(middlewareMock.updateSession).toHaveBeenCalledWith(read);
  });

  it("keeps user safety reports available while writes are frozen", async () => {
    vi.stubEnv("COMMUNITY_RUNTIME_MODE", "read_only");
    const request = new NextRequest(
      "https://hanbang.ai/api/community/posts/12345678-1234-4234-8234-123456789abc/report",
      {
        method: "POST",
        headers: { authorization: "Bearer native-session-token" },
      },
    );

    await expect(proxy(request)).resolves.toHaveProperty("status", 200);
    expect(middlewareMock.updateSession).toHaveBeenCalledWith(request);
  });

  it("can disable community reads and writes without disabling safety intake", async () => {
    vi.stubEnv("COMMUNITY_RUNTIME_MODE", "disabled");

    const blocked = await proxy(
      new NextRequest("https://hanbang.ai/api/community/posts"),
    );
    expect(blocked.status).toBe(503);
    await expect(blocked.json()).resolves.toEqual({ error: "community_disabled" });
    expect(middlewareMock.updateSession).not.toHaveBeenCalled();
  });

  it.each(["read_only", "disabled"])(
    "keeps only responder decline and revoke exits open in %s mode",
    async (mode) => {
      vi.stubEnv("COMMUNITY_RUNTIME_MODE", mode);
      const allowedPaths = [
        "/api/community/responder-requests/12345678-1234-4234-8234-123456789abc/decline",
        "/api/community/responder-capacity/12345678-1234-4234-8234-123456789abc/revoke",
      ];
      for (const pathname of allowedPaths) {
        const request = new NextRequest(`https://hanbang.ai${pathname}`, {
          method: "POST",
          headers: { authorization: "Bearer native-session-token" },
        });
        await expect(proxy(request)).resolves.toHaveProperty("status", 200);
        expect(middlewareMock.updateSession).toHaveBeenCalledWith(request);
      }

      const blockedPaths = [
        "/api/community/responder-capacity",
        "/api/community/responder-requests/12345678-1234-4234-8234-123456789abc/accept",
        "/api/community/responder-requests/12345678-1234-4234-8234-123456789abc/decline/extra",
      ];
      for (const pathname of blockedPaths) {
        const response = await proxy(new NextRequest(`https://hanbang.ai${pathname}`, {
          method: "POST",
          headers: { authorization: "Bearer native-session-token" },
        }));
        expect(response.status).toBe(503);
      }

      const wrongMethod = await proxy(new NextRequest(
        "https://hanbang.ai/api/community/responder-capacity/12345678-1234-4234-8234-123456789abc/revoke",
        { method: "GET" },
      ));
      expect(wrongMethod.status).toBe(503);
    },
  );

  it.each([undefined, "normal", "READ_ONLY", "true"])(
    "does not activate for an unsupported mode %s",
    async (mode) => {
      vi.stubEnv("COMMUNITY_RUNTIME_MODE", mode);
      const request = new NextRequest("https://hanbang.ai/api/community/posts");
      await proxy(request);
      expect(middlewareMock.updateSession).toHaveBeenCalledWith(request);
    },
  );
});
