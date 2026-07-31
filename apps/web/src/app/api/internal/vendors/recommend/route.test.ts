// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RecommendationCandidate } from "@/lib/vendors/recommendation";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createPublicClient: vi.fn(),
  loadRecommendationCandidates: vi.fn(),
  logRecommendationImpressions: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

// 후보 조회는 공개 뷰다 — service_role은 vendor_enrichment_url_is_allowed()
// EXECUTE가 없어 42501로 거부되므로 공개 클라이언트로만 읽어야 한다.
vi.mock("@/lib/supabase/public", () => ({
  createPublicClient: mocks.createPublicClient,
}));

vi.mock("@/lib/vendors/recommendationData", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/vendors/recommendationData")>();
  return {
    ...actual,
    loadRecommendationCandidates: mocks.loadRecommendationCandidates,
    logRecommendationImpressions: mocks.logRecommendationImpressions,
  };
});

import { POST } from "./route";

const secret = "r".repeat(32);

function request(body: unknown, token = secret) {
  return new Request("https://example.test/api/internal/vendors/recommend", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Token": token,
    },
    body: JSON.stringify(body),
  });
}

function sampleCandidate(): RecommendationCandidate {
  return {
    id: "vendor-1",
    slug: "sample-studio",
    name: "샘플 스튜디오",
    category: "studio",
    regionCode: "seoul_gangnam3",
    status: "approved",
    attributes: { original_files_policy: "included" },
    tags: [{ slug: "natural-light", label: "자연광" }],
    urls: { official: "https://vendor.example", instagram: null, naverPlace: null },
    price: {
      minKrw: 1_200_000,
      maxKrw: 1_200_000,
      periodLabel: "2026Q3",
      hasMarketData: false,
      isLatestSnapshot: true,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("VENDOR_INTERNAL_TOKEN", secret);
  mocks.createAdminClient.mockReturnValue({ from: vi.fn() });
  mocks.createPublicClient.mockReturnValue({ from: vi.fn() });
  mocks.loadRecommendationCandidates.mockResolvedValue([sampleCandidate()]);
  mocks.logRecommendationImpressions.mockResolvedValue(true);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/internal/vendors/recommend", () => {
  it("rejects a missing or incorrect internal token before touching the database", async () => {
    const response = await POST(request({ category: "studio" }, "wrong"));

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("rejects malformed category attributes before constructing a service client", async () => {
    const response = await POST(request({
      category: "studio",
      required_attrs: { hall_type: "hotel" },
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid recommendation request",
    });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("returns ranked evidence and logs one impression per result", async () => {
    const body = {
      category: "studio",
      region_codes: ["seoul_gangnam3"],
      budget_max_krw: 1_500_000,
      preferred_tags: ["자연광"],
      required_attrs: { original_files_policy: "included" },
      wedding_month: "2026-11",
      limit: 5,
    };
    // 후보 조회는 공개 클라이언트, 노출 기록은 admin — 두 역할이 섞이면
    // service_role 권한 부재로 조회 전체가 42501로 죽는다.
    const publicClient = { from: vi.fn() };
    const adminClient = { from: vi.fn() };
    mocks.createPublicClient.mockReturnValue(publicClient);
    mocks.createAdminClient.mockReturnValue(adminClient);

    const response = await POST(request(body));
    const responseBody = await response.json();

    expect(response.status).toBe(200);
    expect(responseBody.results).toHaveLength(1);
    expect(responseBody.results[0]).toMatchObject({
      vendor: { id: "vendor-1", category: "studio" },
      match_reasons: expect.arrayContaining([
        "촬영한 전체 사진 파일 받기 조건 충족",
      ]),
    });
    expect(mocks.loadRecommendationCandidates).toHaveBeenCalledWith(publicClient, "studio");
    expect(mocks.logRecommendationImpressions).toHaveBeenCalledWith(
      adminClient,
      expect.objectContaining(body),
      expect.objectContaining({ results: expect.any(Array) }),
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("keeps a valid recommendation available when non-critical impression logging fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.logRecommendationImpressions.mockResolvedValue(false);

    const response = await POST(request({ category: "studio" }));

    expect(response.status).toBe(200);
    expect(warn).toHaveBeenCalledWith("Vendor recommendation impression logging failed");
  });

  it("contains database failures without exposing internal details", async () => {
    mocks.loadRecommendationCandidates.mockRejectedValue(
      new Error("SUPABASE_SERVICE_ROLE_KEY=private relation=official_prices"),
    );

    const response = await POST(request({ category: "studio" }));
    const raw = JSON.stringify(await response.json());

    expect(response.status).toBe(500);
    expect(raw).toBe('{"error":"Vendor recommendation unavailable"}');
    expect(raw).not.toContain("private");
    expect(raw).not.toContain("official_prices");
  });

  it("rejects oversized bodies", async () => {
    const response = await POST(request({
      category: "studio",
      padding: "x".repeat(20_000),
    }));

    expect(response.status).toBe(413);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("rejects a declared oversized body before reading its stream", async () => {
    const pull = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ pull });
    const oversized = new Request(
      "https://example.test/api/internal/vendors/recommend",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": "20000",
          "X-Internal-Token": secret,
        },
        body: stream,
        duplex: "half",
      } as RequestInit & { duplex: "half" },
    );

    const response = await POST(oversized);

    expect(response.status).toBe(413);
    // WHATWG streams may prefill once on construction; the request itself must
    // remain unread when Content-Length already proves it is oversized.
    expect(oversized.bodyUsed).toBe(false);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("stops a chunked request as soon as its byte budget is exceeded", async () => {
    const chunks = [
      new TextEncoder().encode("x".repeat(10_000)),
      new TextEncoder().encode("x".repeat(10_000)),
    ];
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks.shift();
        if (chunk) controller.enqueue(chunk);
        else controller.close();
      },
      cancel,
    });
    const chunked = new Request(
      "https://example.test/api/internal/vendors/recommend",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Token": secret,
        },
        body: stream,
        duplex: "half",
      } as RequestInit & { duplex: "half" },
    );

    const response = await POST(chunked);

    expect(response.status).toBe(413);
    expect(cancel).toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });
});
