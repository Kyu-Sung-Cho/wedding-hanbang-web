import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyAdmin: vi.fn(),
  getServiceClient: vi.fn(),
}));

vi.mock("@/lib/utils/adminAuth", () => ({
  verifyAdmin: mocks.verifyAdmin,
  getServiceClient: mocks.getServiceClient,
}));

import { PATCH } from "./route";

const PRICE_ID = "00000000-0000-4000-8000-000000000001";

describe("PATCH /api/admin/price/:id", () => {
  beforeEach(() => vi.clearAllMocks());

  it("marks an admin-edited row and clears review only after evidence-backed approval", async () => {
    const actorId = "00000000-0000-4000-8000-000000000002";
    mocks.verifyAdmin.mockResolvedValue({ authorized: true, userId: actorId });
    const current = {
      id: PRICE_ID,
      category: "studio",
      item_name: "샘플 촬영",
      base_spec: null,
      price_min_krw: 1_000_000,
      price_max_krw: 1_200_000,
      vat_note: null,
      price_note: null,
      source_file: "2026Q3/seoul/sample.xlsx",
      source_object_keys: ["a".repeat(64) + ".xlsx"],
      source_quote: "샘플 촬영 100만원",
      confidence: 0.8,
      edited_by_admin: false,
      snapshot: { published: false },
    };
    const readSingle = vi.fn().mockResolvedValue({ data: current, error: null });
    const savedSingle = vi.fn().mockResolvedValue({
      data: { ...current, item_name: "샘플 기본 촬영", review_status: "approved", needs_review: false, edited_by_admin: true, review_version: 8 },
      error: null,
    });
    const from = vi.fn()
      .mockReturnValueOnce({
        select: vi.fn(() => ({ eq: vi.fn(() => ({ single: readSingle })) })),
      })
      .mockReturnValueOnce({
        select: vi.fn(() => ({ eq: vi.fn(() => ({ single: savedSingle })) })),
      });
    const rpc = vi.fn().mockResolvedValue({ error: null });
    mocks.getServiceClient.mockReturnValue({ from, rpc });

    const response = await PATCH(new Request(`https://hanbang.ai/api/admin/price/${PRICE_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "approve",
        expected_review_version: 7,
        selected_alias_proposal_ids: ["00000000-0000-4000-8000-000000000003"],
        category: "studio",
        item_name: "샘플 기본 촬영",
        base_spec: null,
        price_min_krw: 1_000_000,
        price_max_krw: 1_200_000,
        vat_note: null,
        price_note: null,
        source_quote: "샘플 촬영 100만원",
        confidence: 0.8,
        options: [],
      }),
    }), { params: Promise.resolve({ id: PRICE_ID }) });

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("review_official_price_with_alias_proposals", {
      p_price_id: PRICE_ID,
      p_actor_id: actorId,
      p_action: "approve",
      p_values: {
        category: "studio",
        item_name: "샘플 기본 촬영",
        base_spec: null,
        price_min_krw: 1_000_000,
        price_max_krw: 1_200_000,
        vat_note: null,
        price_note: null,
        source_quote: "샘플 촬영 100만원",
        confidence: 0.8,
      },
      p_options: [],
      p_selected_proposal_ids: ["00000000-0000-4000-8000-000000000003"],
      p_expected_review_version: 7,
    });
    const body = await response.json();
    expect(body.price.review_version).toBe(8);
    expect(JSON.stringify(body)).not.toContain("2026Q3/seoul/sample.xlsx");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("atomically approves an evidence-backed agency package through the package RPC", async () => {
    const actorId = "00000000-0000-4000-8000-000000000002";
    const packageId = "00000000-0000-4000-8000-000000000101";
    mocks.verifyAdmin.mockResolvedValue({ authorized: true, userId: actorId });
    const current = {
      id: packageId,
      source_file: "2026Q3/seoul/sample-package.pdf",
      source_object_keys: ["c".repeat(64) + ".pdf"],
      snapshot: { published: false },
    };
    const saved = {
      ...current,
      package_name: "샘플 스드메 패키지",
      category_scope: ["studio", "dress", "makeup"],
      price_min_krw: 3_000_000,
      price_max_krw: 4_000_000,
      vat_note: null,
      price_note: null,
      options: [],
      source_quote: "샘플 스드메 패키지 300만원부터",
      confidence: 0.8,
      review_status: "approved",
      edited_by_admin: true,
      review_version: 4,
    };
    const readSingle = vi.fn().mockResolvedValue({ data: current, error: null });
    const savedSingle = vi.fn().mockResolvedValue({ data: saved, error: null });
    const from = vi.fn()
      .mockReturnValueOnce({
        select: vi.fn(() => ({ eq: vi.fn(() => ({ single: readSingle })) })),
      })
      .mockReturnValueOnce({
        select: vi.fn(() => ({ eq: vi.fn(() => ({ single: savedSingle })) })),
      });
    const rpc = vi.fn().mockResolvedValue({ error: null });
    mocks.getServiceClient.mockReturnValue({ from, rpc });

    const response = await PATCH(new Request(
      `https://hanbang.ai/api/admin/price/${packageId}?kind=agency_package`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "approve",
          expected_review_version: 3,
          package_name: "샘플 스드메 패키지",
          category_scope: ["studio", "dress", "makeup"],
          price_min_krw: 3_000_000,
          price_max_krw: 4_000_000,
          vat_note: null,
          price_note: null,
          source_quote: "샘플 스드메 패키지 300만원부터",
          confidence: 0.8,
          options: [],
        }),
      },
    ), { params: Promise.resolve({ id: packageId }) });

    expect(response.status).toBe(200);
    expect(from).toHaveBeenNthCalledWith(1, "official_agency_packages");
    expect(rpc).toHaveBeenCalledWith("review_official_agency_package", {
      p_package_id: packageId,
      p_actor_id: actorId,
      p_action: "approve",
      p_values: {
        package_name: "샘플 스드메 패키지",
        category_scope: ["studio", "dress", "makeup"],
        price_min_krw: 3_000_000,
        price_max_krw: 4_000_000,
        vat_note: null,
        price_note: null,
        source_quote: "샘플 스드메 패키지 300만원부터",
        confidence: 0.8,
      },
      p_options: [],
      p_expected_review_version: 3,
    });
    const body = await response.json();
    expect(body.package.review_version).toBe(4);
    expect(JSON.stringify(body)).not.toContain("2026Q3/seoul/sample-package.pdf");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("rejects a missing expected review version before calling the database RPC", async () => {
    mocks.verifyAdmin.mockResolvedValue({
      authorized: true,
      userId: "00000000-0000-4000-8000-000000000002",
    });
    const rpc = vi.fn();
    mocks.getServiceClient.mockReturnValue({ rpc });

    const response = await PATCH(new Request(`https://hanbang.ai/api/admin/price/${PRICE_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "save",
        category: "studio",
        item_name: "sample",
        options: [],
      }),
    }), { params: Promise.resolve({ id: PRICE_ID }) });

    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("maps an optimistic concurrency failure to the stable 409 contract", async () => {
    const actorId = "00000000-0000-4000-8000-000000000002";
    mocks.verifyAdmin.mockResolvedValue({ authorized: true, userId: actorId });
    const readSingle = vi.fn().mockResolvedValue({
      data: {
        id: PRICE_ID,
        source_file: "2026Q3/seoul/sample.xlsx",
        source_object_keys: ["a".repeat(64) + ".xlsx"],
        snapshot: { published: false },
      },
      error: null,
    });
    const from = vi.fn().mockReturnValue({
      select: vi.fn(() => ({ eq: vi.fn(() => ({ single: readSingle })) })),
    });
    const rpc = vi.fn().mockResolvedValue({
      error: { code: "40001", message: "PRICE_REVIEW_VERSION_CONFLICT" },
    });
    mocks.getServiceClient.mockReturnValue({ from, rpc });

    const response = await PATCH(new Request(`https://hanbang.ai/api/admin/price/${PRICE_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "save",
        expected_review_version: 7,
        category: "studio",
        item_name: "sample",
        options: [],
      }),
    }), { params: Promise.resolve({ id: PRICE_ID }) });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "다른 관리자가 먼저 수정했습니다. 최신 내용을 다시 불러와 주세요.",
      code: "REVIEW_VERSION_CONFLICT",
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("maps the database privacy fence to a stable 422 without echoing PII", async () => {
    const actorId = "00000000-0000-4000-8000-000000000002";
    mocks.verifyAdmin.mockResolvedValue({ authorized: true, userId: actorId });
    const readSingle = vi.fn().mockResolvedValue({
      data: {
        id: PRICE_ID,
        source_file: "2026Q3/seoul/sample.xlsx",
        source_object_keys: ["a".repeat(64) + ".xlsx"],
        snapshot: { published: false },
      },
      error: null,
    });
    const from = vi.fn().mockReturnValue({
      select: vi.fn(() => ({ eq: vi.fn(() => ({ single: readSingle })) })),
    });
    const rpc = vi.fn().mockResolvedValue({
      error: {
        code: "22023",
        message: "DISCLOSURE_PUBLIC_TEXT_PII_BLOCKED:price_note",
      },
    });
    mocks.getServiceClient.mockReturnValue({ from, rpc });

    const privateEmail = "private@example.test";
    const response = await PATCH(new Request(`https://hanbang.ai/api/admin/price/${PRICE_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "save",
        expected_review_version: 7,
        category: "studio",
        item_name: "샘플 기본 촬영",
        base_spec: null,
        price_min_krw: 1_000_000,
        price_max_krw: 1_200_000,
        vat_note: null,
        price_note: `문의 ${privateEmail}`,
        source_quote: "샘플 촬영 100만원",
        confidence: 0.8,
        selected_alias_proposal_ids: [],
        options: [],
      }),
    }), { params: Promise.resolve({ id: PRICE_ID }) });

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body).toEqual({
      error: "공개될 수 있는 항목에 연락처·이메일·링크가 포함되어 있어 저장하지 않았습니다. 해당 정보를 제거한 뒤 다시 시도해 주세요.",
      code: "PUBLIC_TEXT_PII_BLOCKED",
    });
    expect(JSON.stringify(body)).not.toContain(privateEmail);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("maps the database public-text length fence to a stable 422", async () => {
    const actorId = "00000000-0000-4000-8000-000000000002";
    mocks.verifyAdmin.mockResolvedValue({ authorized: true, userId: actorId });
    const readSingle = vi.fn().mockResolvedValue({
      data: {
        id: PRICE_ID,
        source_file: "2026Q3/seoul/sample.xlsx",
        source_object_keys: ["a".repeat(64) + ".xlsx"],
        snapshot: { published: false },
      },
      error: null,
    });
    const from = vi.fn().mockReturnValue({
      select: vi.fn(() => ({ eq: vi.fn(() => ({ single: readSingle })) })),
    });
    const rpc = vi.fn().mockResolvedValue({
      error: {
        code: "22023",
        message: "DISCLOSURE_PUBLIC_TEXT_LENGTH_BLOCKED:option_raw_text",
      },
    });
    mocks.getServiceClient.mockReturnValue({ from, rpc });

    const response = await PATCH(new Request(`https://hanbang.ai/api/admin/price/${PRICE_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "save",
        expected_review_version: 7,
        category: "studio",
        item_name: "샘플 기본 촬영",
        base_spec: null,
        price_min_krw: 1_000_000,
        price_max_krw: 1_200_000,
        vat_note: null,
        price_note: null,
        source_quote: "샘플 촬영 100만원",
        confidence: 0.8,
        selected_alias_proposal_ids: [],
        options: [],
      }),
    }), { params: Promise.resolve({ id: PRICE_ID }) });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: "공개될 수 있는 항목이 허용 길이를 초과해 저장하지 않았습니다. 내용을 줄인 뒤 다시 시도해 주세요.",
      code: "PUBLIC_TEXT_LENGTH_BLOCKED",
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("rejects every in-place edit of an already published snapshot", async () => {
    mocks.verifyAdmin.mockResolvedValue({
      authorized: true,
      userId: "00000000-0000-4000-8000-000000000002",
    });
    const readSingle = vi.fn().mockResolvedValue({
      data: {
        id: PRICE_ID,
        source_file: "2026Q3/seoul/sample.xlsx",
        source_object_keys: ["a".repeat(64) + ".xlsx"],
        snapshot: { published: true },
      },
      error: null,
    });
    const from = vi.fn().mockReturnValue({
      select: vi.fn(() => ({ eq: vi.fn(() => ({ single: readSingle })) })),
    });
    const rpc = vi.fn();
    mocks.getServiceClient.mockReturnValue({ from, rpc });

    const response = await PATCH(new Request(`https://hanbang.ai/api/admin/price/${PRICE_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "save",
        expected_review_version: 7,
        category: "studio",
        item_name: "변경 시도",
        options: [],
      }),
    }), { params: Promise.resolve({ id: PRICE_ID }) });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "PUBLISHED_SNAPSHOT_IMMUTABLE",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects JSON-backed approval when the immutable evidence object is missing", async () => {
    mocks.verifyAdmin.mockResolvedValue({
      authorized: true,
      userId: "00000000-0000-4000-8000-000000000002",
    });
    const readSingle = vi.fn().mockResolvedValue({
      data: {
        id: PRICE_ID,
        source_file: "관리자 수동 업로드 JSON (kca_tprice 2026Q3).json",
        source_object_keys: ["b".repeat(64) + ".json"],
        snapshot: { published: false },
      },
      error: null,
    });
    const from = vi.fn().mockReturnValue({
      select: vi.fn(() => ({ eq: vi.fn(() => ({ single: readSingle })) })),
    });
    const rpc = vi.fn();
    const download = vi.fn().mockResolvedValue({ data: null, error: { message: "missing" } });
    mocks.getServiceClient.mockReturnValue({
      from,
      rpc,
      storage: { from: vi.fn(() => ({ download })) },
    });

    const response = await PATCH(new Request(`https://hanbang.ai/api/admin/price/${PRICE_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "approve",
        expected_review_version: 0,
        category: "studio",
        item_name: "샘플 기본 구성",
        base_spec: "샘플 기본 구성",
        price_min_krw: 1_000_000,
        price_max_krw: 1_000_000,
        vat_note: null,
        price_note: null,
        source_quote: "JSON /entries/0/prices/0/base_spec: 샘플 기본 구성",
        confidence: 1,
        options: [],
      }),
    }), { params: Promise.resolve({ id: PRICE_ID }) });

    expect(response.status).toBe(422);
    expect(download).toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});
