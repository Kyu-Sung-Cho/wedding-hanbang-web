import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const middlewareMock = vi.hoisted(() => ({
  updateSession: vi.fn(async () => NextResponse.next()),
}));

vi.mock("@/lib/supabase/middleware", () => middlewareMock);

import { config, proxy } from "./proxy";

describe("proxy sensitive navigation query containment", () => {
  beforeEach(() => {
    middlewareMock.updateSession.mockClear();
  });

  it.each([
    [
      "/wedding/chat?prefill=quote%20amount%203000&utm_source=legacy",
      "https://hanbang.ai/wedding/chat?utm_source=legacy",
    ],
    [
      "/wedding/community/post/write?category=is_normal&prefill=quote_check&title=private&body=secret",
      "https://hanbang.ai/wedding/community/post/write?category=is_normal",
    ],
  ])("redirects %s before rendering", async (path, expectedLocation) => {
    const response = await proxy(new NextRequest(`https://hanbang.ai${path}`));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(expectedLocation);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(middlewareMock.updateSession).not.toHaveBeenCalled();
  });
});

describe("proxy WeddingCode answer containment", () => {
  beforeEach(() => {
    middlewareMock.updateSession.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(["/wedding-code", "/wedding-code/result"])(
    "removes legacy answers and capability tokens before rendering or redirecting %s",
    async (pathname) => {
      const response = await proxy(
        new NextRequest(
          `https://hanbang.ai${pathname}?a=0123012301230123&b=3210321032103210&ct=sensitive-capability-token&utm_source=legacy-invite`
        )
      );

      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(
        "https://hanbang.ai/wedding-code?utm_source=legacy-invite"
      );
      expect(response.headers.get("location")).not.toContain("ct=");
      expect(response.headers.get("location")).not.toContain("a=");
      expect(response.headers.get("location")).not.toContain("b=");
      expect(response.headers.get("location")).not.toContain(
        "sensitive-capability-token"
      );
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
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
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
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
    "/api/community/cohort",
    "/api/couple/code",
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
    "/api/vendors/12345678-1234-4234-8234-123456789abc",
    "/api/auth/me",
    "/api/community/profile",
    "/api/messages",
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
        headers: {
          Origin: "https://hanbang.ai",
          "Sec-Fetch-Site": "same-origin",
        },
      });

      const response = await proxy(request);

      expect(response.status).toBe(200);
      expect(middlewareMock.updateSession).toHaveBeenCalledOnce();
      expect(middlewareMock.updateSession).toHaveBeenCalledWith(request);
    }
  );
});

describe("proxy API mutation origin fence", () => {
  beforeEach(() => {
    middlewareMock.updateSession.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"])(
    "blocks %s without same-origin or Bearer proof",
    async (method) => {
      const response = await proxy(new NextRequest(
        "https://hanbang.ai/api/profile",
        { method },
      ));

      expect(response.status).toBe(403);
      expect(response.headers.get("cache-control")).toContain("no-store");
      await expect(response.json()).resolves.toEqual({
        error: "api_mutation_origin_not_allowed",
      });
      expect(middlewareMock.updateSession).not.toHaveBeenCalled();
    },
  );

  it("blocks cross-site browser metadata", async () => {
    const response = await proxy(new NextRequest(
      "https://hanbang.ai/api/bookings",
      {
        method: "POST",
        headers: {
          Origin: "https://attacker.example",
          "Sec-Fetch-Site": "cross-site",
        },
      },
    ));

    expect(response.status).toBe(403);
    expect(middlewareMock.updateSession).not.toHaveBeenCalled();
  });

  it("allows a same-origin browser mutation to continue to the route", async () => {
    const request = new NextRequest("https://hanbang.ai/api/profile", {
      method: "PATCH",
      headers: {
        Origin: "https://hanbang.ai",
        "Sec-Fetch-Site": "same-origin",
      },
    });

    await proxy(request);

    expect(middlewareMock.updateSession).toHaveBeenCalledWith(request);
  });

  it("allows a native Bearer mutation to continue to the route", async () => {
    const request = new NextRequest("https://hanbang.ai/api/profile", {
      method: "PATCH",
      headers: { Authorization: "Bearer signed-session-token" },
    });

    await proxy(request);

    expect(middlewareMock.updateSession).toHaveBeenCalledWith(request);
  });

  it.each(["GET", "HEAD"])(
    "blocks the lazy invite-code %s without same-origin or Bearer proof",
    async (method) => {
      const response = await proxy(new NextRequest(
        "https://hanbang.ai/api/couple/code",
        { method },
      ));

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({
        error: "api_mutation_origin_not_allowed",
      });
      expect(middlewareMock.updateSession).not.toHaveBeenCalled();
    },
  );

  it.each<{ label: string; headers: Record<string, string> }>([
    {
      label: "same-origin browser",
      headers: {
        Origin: "https://hanbang.ai",
        "Sec-Fetch-Site": "same-origin",
      },
    },
    {
      label: "native Bearer",
      headers: { Authorization: "Bearer signed-session-token" },
    },
  ])("allows the lazy invite-code GET for a $label request", async ({ headers }) => {
    const request = new NextRequest("https://hanbang.ai/api/couple/code", {
      method: "GET",
      headers,
    });

    await proxy(request);

    expect(middlewareMock.updateSession).toHaveBeenCalledWith(request);
  });

  it.each([
    "/api/auth/signup",
    "/api/auth/forgot-password",
    "/api/release/write-fence-probe",
    "/api/internal/vendors/recommend",
  ])("leaves the explicitly non-browser-authenticated boundary to its route: %s", async (pathname) => {
    const request = new NextRequest(`https://hanbang.ai${pathname}`, { method: "POST" });

    await proxy(request);

    expect(middlewareMock.updateSession).toHaveBeenCalledWith(request);
  });

  it("fails closed for future internal mutation routes that were not allowlisted", async () => {
    const response = await proxy(new NextRequest(
      "https://hanbang.ai/api/internal/future-write",
      { method: "POST" },
    ));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "api_mutation_origin_not_allowed",
    });
    expect(middlewareMock.updateSession).not.toHaveBeenCalled();
  });
});

describe("proxy authenticated API cache fence", () => {
  beforeEach(() => {
    middlewareMock.updateSession.mockClear();
  });

  it.each<{ label: string; headers: Record<string, string> }>([
    { label: "Bearer", headers: { Authorization: "Bearer signed-session-token" } },
    { label: "cookie", headers: { Cookie: "sb-session=signed-session-cookie" } },
  ])("marks $label API responses private and non-cacheable", async ({ headers }) => {
    const request = new NextRequest("https://hanbang.ai/api/profile", { headers });

    const response = await proxy(request);

    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0, must-revalidate",
    );
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("vary")).toBe("Authorization, Cookie");
    expect(middlewareMock.updateSession).toHaveBeenCalledWith(request);
  });

  it("does not disable caching for an anonymous public API at the global boundary", async () => {
    const request = new NextRequest("https://hanbang.ai/api/vendors");

    const response = await proxy(request);

    expect(response.headers.has("cache-control")).toBe(false);
    expect(response.headers.has("pragma")).toBe(false);
    expect(response.headers.has("vary")).toBe(false);
    expect(middlewareMock.updateSession).toHaveBeenCalledWith(request);
  });

  it("preserves existing response variance while adding identity headers", async () => {
    middlewareMock.updateSession.mockResolvedValueOnce(
      new NextResponse(null, { headers: { Vary: "Accept-Encoding, Origin" } }),
    );
    const request = new NextRequest("https://hanbang.ai/api/profile", {
      headers: { Cookie: "sb-session=signed-session-cookie" },
    });

    const response = await proxy(request);

    expect(response.headers.get("vary")).toBe(
      "Accept-Encoding, Origin, Authorization, Cookie",
    );
  });

  it("does not attach API cache headers to an authenticated page response", async () => {
    const request = new NextRequest("https://hanbang.ai/wedding/lounge", {
      headers: { Cookie: "sb-session=signed-session-cookie" },
    });

    const response = await proxy(request);

    expect(response.headers.has("cache-control")).toBe(false);
    expect(response.headers.has("pragma")).toBe(false);
    expect(response.headers.has("vary")).toBe(false);
    expect(middlewareMock.updateSession).toHaveBeenCalledWith(request);
  });
});
