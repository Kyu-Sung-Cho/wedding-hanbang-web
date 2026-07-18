import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyAdmin: vi.fn(),
  getServiceClient: vi.fn(),
}));

vi.mock("@/lib/utils/adminAuth", () => ({
  verifyAdmin: mocks.verifyAdmin,
  getServiceClient: mocks.getServiceClient,
}));

import { GET } from "./route";

describe("GET /api/admin/price/:id/source", () => {
  beforeEach(() => vi.clearAllMocks());

  it("never reads private evidence for a non-admin request", async () => {
    mocks.verifyAdmin.mockResolvedValue({ authorized: false });
    const getServiceClient = mocks.getServiceClient;

    const response = await GET(
      new Request("https://hanbang.ai/api/admin/price/00000000-0000-4000-8000-000000000001/source"),
      { params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000001" }) },
    );

    expect(response.status).toBe(401);
    expect(getServiceClient).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("refuses a local path without asking Storage to sign it", async () => {
    mocks.verifyAdmin.mockResolvedValue({ authorized: true });
    const single = vi.fn().mockResolvedValue({
      data: { source_file: "C:\\private\\raw\\샘플 공시.xlsx" },
      error: null,
    });
    const createSignedUrls = vi.fn();
    mocks.getServiceClient.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn(() => ({ eq: vi.fn(() => ({ single })) })),
      })),
      storage: { from: vi.fn(() => ({ createSignedUrls })) },
    });

    const response = await GET(
      new Request("https://hanbang.ai/api/admin/price/00000000-0000-4000-8000-000000000001/source"),
      { params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000001" }) },
    );

    expect(response.status).toBe(404);
    expect(createSignedUrls).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({ error: "원본 파일을 찾을 수 없습니다." });
  });

  it("returns a short-lived signed URL from the disclosure-raw bucket", async () => {
    mocks.verifyAdmin.mockResolvedValue({ authorized: true });
    const single = vi.fn().mockResolvedValue({
      data: {
        source_file: '["서울/샘플 공시.pdf","서울/샘플 가격표.xlsx"]',
        source_object_keys: ["a".repeat(64) + ".pdf", "b".repeat(64) + ".xlsx"],
      },
      error: null,
    });
    const createSignedUrls = vi.fn().mockResolvedValue({
      data: [
        { signedUrl: "https://storage.example/signed-one" },
        { signedUrl: "https://storage.example/signed-two" },
      ],
      error: null,
    });
    const storageFrom = vi.fn(() => ({ createSignedUrls }));
    mocks.getServiceClient.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn(() => ({ eq: vi.fn(() => ({ single })) })),
      })),
      storage: { from: storageFrom },
    });

    const response = await GET(
      new Request("https://hanbang.ai/api/admin/price/00000000-0000-4000-8000-000000000001/source"),
      { params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000001" }) },
    );

    expect(response.status).toBe(200);
    expect(storageFrom).toHaveBeenCalledWith("disclosure-raw");
    expect(createSignedUrls).toHaveBeenCalledWith([
      "a".repeat(64) + ".pdf",
      "b".repeat(64) + ".xlsx",
    ], 300);
    expect(await response.json()).toEqual({
      files: [
        { label: "샘플 공시.pdf", signed_url: "https://storage.example/signed-one" },
        { label: "샘플 가격표.xlsx", signed_url: "https://storage.example/signed-two" },
      ],
      expires_in: 300,
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(JSON.stringify(await (await GET(
      new Request("https://hanbang.ai/api/admin/price/00000000-0000-4000-8000-000000000001/source"),
      { params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000001" }) },
    )).json())).not.toContain("a".repeat(64) + ".pdf");
  });

  it("signs an agency package source only when the explicit package kind is provided", async () => {
    mocks.verifyAdmin.mockResolvedValue({ authorized: true });
    const key = "d".repeat(64) + ".pdf";
    const single = vi.fn().mockResolvedValue({
      data: {
        source_file: "서울/샘플 대행사 패키지.pdf",
        source_object_keys: [key],
      },
      error: null,
    });
    const createSignedUrls = vi.fn().mockResolvedValue({
      data: [{ signedUrl: "https://storage.example/signed-package" }],
      error: null,
    });
    const from = vi.fn(() => ({
      select: vi.fn(() => ({ eq: vi.fn(() => ({ single })) })),
    }));
    mocks.getServiceClient.mockReturnValue({
      from,
      storage: { from: vi.fn(() => ({ createSignedUrls })) },
    });

    const response = await GET(
      new Request(
        "https://hanbang.ai/api/admin/price/00000000-0000-4000-8000-000000000101/source?kind=agency_package",
      ),
      { params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000101" }) },
    );

    expect(response.status).toBe(200);
    expect(from).toHaveBeenCalledWith("official_agency_packages");
    expect(createSignedUrls).toHaveBeenCalledWith([key], 300);
    expect(await response.json()).toMatchObject({
      files: [{ label: "샘플 대행사 패키지.pdf" }],
    });
  });

  it("returns a bounded private XLSX text preview without exposing storage keys or local paths", async () => {
    mocks.verifyAdmin.mockResolvedValue({ authorized: true });
    const rawKey = `${"e".repeat(64)}.xlsx`;
    const previewKey = `${"f".repeat(64)}.txt`;
    const single = vi.fn().mockResolvedValue({
      data: {
        source_file: "C:\\private\\raw\\샘플 가격표.xlsx",
        source_object_keys: [rawKey],
        source_preview_keys: [previewKey],
      },
      error: null,
    });
    const createSignedUrls = vi.fn().mockResolvedValue({
      data: [{ signedUrl: "https://storage.example/signed-xlsx" }],
      error: null,
    });
    const download = vi.fn().mockResolvedValue({
      data: new Blob(["## 시트: 견적\n견적!B7: 기본 패키지 290만원"], { type: "text/plain" }),
      error: null,
    });
    const storageFrom = vi.fn((bucket: string) => bucket === "disclosure-preview"
      ? { download }
      : { createSignedUrls });
    mocks.getServiceClient.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn(() => ({ eq: vi.fn(() => ({ single })) })),
      })),
      storage: { from: storageFrom },
    });

    const response = await GET(
      new Request("https://hanbang.ai/api/admin/price/00000000-0000-4000-8000-000000000001/source"),
      { params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000001" }) },
    );

    expect(response.status).toBe(200);
    expect(download).toHaveBeenCalledWith(previewKey);
    const body = await response.json();
    expect(body.files).toEqual([{
      label: "샘플 가격표.xlsx",
      signed_url: "https://storage.example/signed-xlsx",
      preview_text: "## 시트: 견적\n견적!B7: 기본 패키지 290만원",
    }]);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(previewKey);
    expect(serialized).not.toContain("C:\\private");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("renders the immutable admin JSON evidence as bounded serialized text", async () => {
    mocks.verifyAdmin.mockResolvedValue({ authorized: true });
    const rawKey = `${"9".repeat(64)}.json`;
    const rawJson = '{"period_label":"2026Q3","source":"kca_tprice"}';
    const single = vi.fn().mockResolvedValue({
      data: {
        source_file: "관리자 수동 업로드 JSON (kca_tprice 2026Q3).json",
        source_object_keys: [rawKey],
        source_preview_keys: [],
      },
      error: null,
    });
    const createSignedUrls = vi.fn().mockResolvedValue({
      data: [{ signedUrl: "https://storage.example/signed-json" }],
      error: null,
    });
    const download = vi.fn().mockResolvedValue({
      data: new Blob([rawJson], { type: "application/json" }),
      error: null,
    });
    mocks.getServiceClient.mockReturnValue({
      from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ single })) })) })),
      storage: {
        from: vi.fn((bucket: string) => bucket === "disclosure-raw"
          ? { createSignedUrls, download }
          : { download: vi.fn() }),
      },
    });

    const response = await GET(
      new Request("https://hanbang.ai/api/admin/price/00000000-0000-4000-8000-000000000001/source"),
      { params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000001" }) },
    );

    expect(response.status).toBe(200);
    expect(download).toHaveBeenCalledWith(rawKey);
    const body = await response.json();
    expect(body.files).toEqual([{
      label: "관리자 수동 업로드 JSON (kca_tprice 2026Q3).json",
      signed_url: "https://storage.example/signed-json",
      preview_text: rawJson,
    }]);
    expect(JSON.stringify(body)).not.toContain(rawKey);
  });

  it("rejects a local path masquerading as a preview key before Storage is read", async () => {
    mocks.verifyAdmin.mockResolvedValue({ authorized: true });
    const rawKey = `${"1".repeat(64)}.docx`;
    const single = vi.fn().mockResolvedValue({
      data: {
        source_file: "서울/샘플 패키지.docx",
        source_object_keys: [rawKey],
        source_preview_keys: ["C:\\private\\derived.txt"],
      },
      error: null,
    });
    const createSignedUrls = vi.fn().mockResolvedValue({
      data: [{ signedUrl: "https://storage.example/signed-docx" }],
      error: null,
    });
    const previewDownload = vi.fn();
    mocks.getServiceClient.mockReturnValue({
      from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ single })) })) })),
      storage: {
        from: vi.fn((bucket: string) => bucket === "disclosure-preview"
          ? { download: previewDownload }
          : { createSignedUrls }),
      },
    });

    const response = await GET(
      new Request("https://hanbang.ai/api/admin/price/00000000-0000-4000-8000-000000000001/source"),
      { params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000001" }) },
    );

    expect(response.status).toBe(404);
    expect(previewDownload).not.toHaveBeenCalled();
    expect(JSON.stringify(await response.json())).not.toContain("C:\\private");
  });

  it("fails closed when a preview object exceeds the browser payload limit", async () => {
    mocks.verifyAdmin.mockResolvedValue({ authorized: true });
    const rawKey = `${"2".repeat(64)}.xlsx`;
    const previewKey = `${"3".repeat(64)}.txt`;
    const single = vi.fn().mockResolvedValue({
      data: {
        source_file: "서울/대용량.xlsx",
        source_object_keys: [rawKey],
        source_preview_keys: [previewKey],
      },
      error: null,
    });
    const createSignedUrls = vi.fn().mockResolvedValue({
      data: [{ signedUrl: "https://storage.example/signed-large" }],
      error: null,
    });
    const download = vi.fn().mockResolvedValue({
      data: new Blob([new Uint8Array(2 * 1024 * 1024 + 1)]),
      error: null,
    });
    mocks.getServiceClient.mockReturnValue({
      from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ single })) })) })),
      storage: {
        from: vi.fn((bucket: string) => bucket === "disclosure-preview"
          ? { download }
          : { createSignedUrls }),
      },
    });

    const response = await GET(
      new Request("https://hanbang.ai/api/admin/price/00000000-0000-4000-8000-000000000001/source"),
      { params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000001" }) },
    );

    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain(previewKey);
  });

  it("keeps multi-source preview text attached to the matching sanitized filename", async () => {
    mocks.verifyAdmin.mockResolvedValue({ authorized: true });
    const rawKeys = [
      `${"4".repeat(64)}.xlsx`,
      `${"5".repeat(64)}.png`,
      `${"6".repeat(64)}.docx`,
    ];
    const previewKeys = [`${"7".repeat(64)}.txt`, `${"8".repeat(64)}.txt`];
    const single = vi.fn().mockResolvedValue({
      data: {
        source_file: JSON.stringify([
          "서울/가격표.xlsx",
          "서울/스캔.png",
          "서울/약관.docx",
        ]),
        source_object_keys: rawKeys,
        source_preview_keys: previewKeys,
      },
      error: null,
    });
    const createSignedUrls = vi.fn().mockResolvedValue({
      data: rawKeys.map((_, index) => ({ signedUrl: `https://storage.example/raw-${index}` })),
      error: null,
    });
    const download = vi.fn(async (key: string) => ({
      data: new Blob([key === previewKeys[0] ? "가격표!A1: 120만원" : "약관 제1조"], { type: "text/plain" }),
      error: null,
    }));
    mocks.getServiceClient.mockReturnValue({
      from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ single })) })) })),
      storage: {
        from: vi.fn((bucket: string) => bucket === "disclosure-preview"
          ? { download }
          : { createSignedUrls }),
      },
    });

    const response = await GET(
      new Request("https://hanbang.ai/api/admin/price/00000000-0000-4000-8000-000000000001/source"),
      { params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000001" }) },
    );

    expect(response.status).toBe(200);
    expect((await response.json()).files).toEqual([
      { label: "가격표.xlsx", signed_url: "https://storage.example/raw-0", preview_text: "가격표!A1: 120만원" },
      { label: "스캔.png", signed_url: "https://storage.example/raw-1" },
      { label: "약관.docx", signed_url: "https://storage.example/raw-2", preview_text: "약관 제1조" },
    ]);
  });
});
