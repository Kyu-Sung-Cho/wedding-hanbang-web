import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AdminPricePage from "./page";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("lucide-react", () => {
  const Icon = () => <span aria-hidden="true" />;
  return {
    AlertTriangle: Icon,
    Check: Icon,
    CopyCheck: Icon,
    Plus: Icon,
    Save: Icon,
    Trash2: Icon,
    X: Icon,
  };
});

vi.mock("@/components/admin/DisclosureSourcePreview", () => ({
  DisclosureSourcePreview: () => <div>source preview</div>,
}));

vi.mock("@/components/admin/VendorWorkspaceHeader", () => ({
  AdminErrorState: ({ message }: { message: string }) => <p>{message}</p>,
  AdminLoadingState: ({ label }: { label: string }) => <p>{label}</p>,
  SignedSourceLink: () => <a href="#source">source</a>,
  VendorWorkspaceHeader: () => <header>admin header</header>,
}));

const PRICE_ID = "00000000-0000-4000-8000-000000000001";
const CONFLICT_MESSAGE = "다른 관리자가 먼저 수정했습니다. 최신 내용을 다시 불러와 주세요.";

function priceItem(reviewVersion: number, itemName: string) {
  return {
    id: PRICE_ID,
    category: "studio",
    item_name: itemName,
    base_spec: null,
    price_min_krw: 1_000_000,
    price_max_krw: 1_200_000,
    vat_note: null,
    price_note: null,
    review_status: "pending",
    needs_review: false,
    validation_issue_codes: [],
    source_quote: "기본 촬영 100만원",
    confidence: 0.8,
    review_version: reviewVersion,
    edited_by_admin: false,
    updated_at: "2026-07-18T00:00:00.000Z",
    source_available: false,
    source_count: 0,
    source_file_label: null,
    source_file_labels: [],
    snapshot: null,
    vendor: null,
    agency: null,
    alias_proposals: [],
    options: [],
  };
}

function packageItem(reviewVersion: number, packageName: string) {
  return {
    id: "00000000-0000-4000-8000-000000000101",
    package_name: packageName,
    category_scope: ["studio"],
    price_min_krw: 3_000_000,
    price_max_krw: 3_500_000,
    vat_note: null,
    price_note: null,
    options: [],
    review_status: "pending",
    needs_review: false,
    validation_issue_codes: [],
    source_quote: "샘플 패키지 300만원",
    confidence: 0.8,
    review_version: reviewVersion,
    edited_by_admin: false,
    updated_at: "2026-07-18T00:00:00.000Z",
    source_available: false,
    source_count: 0,
    source_file_label: null,
    source_file_labels: [],
    snapshot: null,
    agency: null,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("admin price optimistic concurrency UX", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await act(async () => root.unmount());
    document.body.replaceChildren();
  });

  async function flush() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await Promise.resolve();
    });
  }

  it("sends the rendered version and reloads instead of overwriting after a 409", async () => {
    let reads = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/admin/price/snapshots") return Promise.resolve(jsonResponse({ snapshots: [] }));
      if (init?.method === "PATCH") {
        return Promise.resolve(jsonResponse({
          error: CONFLICT_MESSAGE,
          code: "REVIEW_VERSION_CONFLICT",
        }, 409));
      }
      if (url.startsWith("/api/admin/price?")) {
        reads += 1;
        return Promise.resolve(jsonResponse({
          prices: [priceItem(reads === 1 ? 3 : 4, reads === 1 ? "화면에 있던 항목" : "다른 관리자의 최신 항목")],
          has_more: false,
          next_cursor: null,
        }));
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(<AdminPricePage />));
    await flush();

    const initialInput = container.querySelector<HTMLInputElement>('input[name="item_name"]');
    expect(initialInput?.value).toBe("화면에 있던 항목");

    const saveButton = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("수정 저장"));
    await act(async () => saveButton?.click());
    await flush();

    const patchRequest = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(patchRequest?.[0]).toBe(`/api/admin/price/${PRICE_ID}`);
    const patchInit = patchRequest?.[1] as RequestInit;
    expect(JSON.parse(String(patchInit.body))).toMatchObject({
      action: "save",
      expected_review_version: 3,
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(CONFLICT_MESSAGE);
    expect(reads).toBe(2);
    expect(container.querySelector<HTMLInputElement>('input[name="item_name"]')?.value)
      .toBe("다른 관리자의 최신 항목");
  });

  it("sends the package version and reloads the latest package after a 409", async () => {
    let packageReads = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/admin/price/snapshots") return Promise.resolve(jsonResponse({ snapshots: [] }));
      if (url.includes("kind=agency_package") && init?.method === "PATCH") {
        return Promise.resolve(jsonResponse({
          error: CONFLICT_MESSAGE,
          code: "REVIEW_VERSION_CONFLICT",
        }, 409));
      }
      if (url.includes("kind=agency_package")) {
        packageReads += 1;
        return Promise.resolve(jsonResponse({
          packages: [packageItem(packageReads === 1 ? 5 : 6, packageReads === 1 ? "화면 패키지" : "최신 패키지")],
          has_more: false,
          next_cursor: null,
        }));
      }
      if (url.startsWith("/api/admin/price?")) return Promise.resolve(jsonResponse({ prices: [] }));
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(<AdminPricePage />));
    await flush();
    const packageTab = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "대행사 패키지");
    await act(async () => packageTab?.click());
    await flush();

    expect(container.querySelector<HTMLInputElement>('input[name="package_name"]')?.value)
      .toBe("화면 패키지");
    const saveButton = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("수정 저장"));
    await act(async () => saveButton?.click());
    await flush();

    const patchRequest = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(String(patchRequest?.[0])).toContain("kind=agency_package");
    expect(JSON.parse(String((patchRequest?.[1] as RequestInit).body))).toMatchObject({
      action: "save",
      expected_review_version: 5,
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(CONFLICT_MESSAGE);
    expect(packageReads).toBe(2);
    expect(container.querySelector<HTMLInputElement>('input[name="package_name"]')?.value)
      .toBe("최신 패키지");
  });

  it("sends only approved and checked pending alias proposals on price approval", async () => {
    const approvedId = "00000000-0000-4000-8000-000000000041";
    const pendingId = "00000000-0000-4000-8000-000000000042";
    const rejectedId = "00000000-0000-4000-8000-000000000043";
    const item = {
      ...priceItem(2, "별칭 검토 가격"),
      source_available: true,
      source_count: 1,
      source_file_labels: ["source.xlsx"],
      alias_proposals: [
        { id: approvedId, alias: "승인된 옛 상호", status: "approved", reviewed_at: "2026-07-18" },
        { id: pendingId, alias: "검토할 옛 상호", status: "pending", reviewed_at: null },
        { id: rejectedId, alias: "반려된 이름", status: "rejected", reviewed_at: "2026-07-18" },
      ],
    };
    let patchedBody: Record<string, unknown> | null = null;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/admin/price/snapshots") return Promise.resolve(jsonResponse({ snapshots: [] }));
      if (url === `/api/admin/price/${PRICE_ID}/source`) return Promise.resolve(jsonResponse({ files: [] }));
      if (init?.method === "PATCH") {
        patchedBody = JSON.parse(String(init.body));
        return Promise.resolve(jsonResponse({ price: { ...item, review_version: 3 } }));
      }
      if (url.startsWith("/api/admin/price?")) {
        return Promise.resolve(jsonResponse({ prices: [item], has_more: false, next_cursor: null }));
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(<AdminPricePage />));
    await flush();
    const pendingCheckbox = container.querySelector<HTMLInputElement>(`input[aria-label="검토할 옛 상호 별칭 제안"]`);
    expect(pendingCheckbox?.checked).toBe(false);
    await act(async () => pendingCheckbox?.click());
    const approveButton = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("근거 확인 후 승인"));
    await act(async () => approveButton?.click());
    await flush();

    expect(patchedBody).toMatchObject({
      action: "approve",
      selected_alias_proposal_ids: [approvedId, pendingId],
    });
  });

  it("appends a cursor page without duplicating an already loaded price", async () => {
    const secondId = "00000000-0000-4000-8000-000000000002";
    let priceReads = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/admin/price/snapshots") return Promise.resolve(jsonResponse({ snapshots: [] }));
      if (url.startsWith("/api/admin/price?")) {
        priceReads += 1;
        return Promise.resolve(priceReads === 1
          ? jsonResponse({ prices: [priceItem(1, "첫 항목")], has_more: true, next_cursor: "v1:1" })
          : jsonResponse({ prices: [priceItem(1, "중복 항목"), { ...priceItem(1, "둘째 항목"), id: secondId }], has_more: false, next_cursor: null }));
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(<AdminPricePage />));
    await flush();
    const moreButton = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("검수 항목 더 불러오기"));
    await act(async () => moreButton?.click());
    await flush();

    expect(container.textContent).toContain("첫 항목");
    expect(container.textContent).toContain("둘째 항목");
    expect(container.textContent?.match(/중복 항목/g)).toBeNull();
    expect(priceReads).toBe(2);
  });

  it("requires staged confirmation before promoting or rolling back a ready snapshot", async () => {
    const currentId = "10000000-0000-4000-8000-000000000001";
    const targetId = "10000000-0000-4000-8000-000000000002";
    const counts = {
      total: 1,
      review_status: { pending: 0, approved: 1, rejected: 0, unknown: 0 },
      needs_review: { yes: 0, no: 1 },
      provenance: { complete: 1, incomplete: 0 },
      publishable_count: 1,
    };
    const snapshots = [
      { id: currentId, period_label: "2026-Q3", source: "official", is_current: true, published_at: "2026-07-18", price_counts: counts, package_counts: { ...counts, total: 0, publishable_count: 0, review_status: { ...counts.review_status, approved: 0 } }, publishable_count: 1, readiness: true, blocking_reasons: [] },
      { id: targetId, period_label: "2026-Q2", source: "official", is_current: false, published_at: "2026-04-01", price_counts: counts, package_counts: { ...counts, total: 0, publishable_count: 0, review_status: { ...counts.review_status, approved: 0 } }, publishable_count: 1, readiness: true, blocking_reasons: [] },
    ];
    let promotedBody: unknown = null;
    let snapshotReads = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/admin/price/snapshots" && init?.method === "POST") {
        promotedBody = JSON.parse(String(init.body));
        return Promise.resolve(jsonResponse({ promoted: true, snapshot_id: targetId }));
      }
      if (url === "/api/admin/price/snapshots") {
        snapshotReads += 1;
        return Promise.resolve(jsonResponse({ snapshots }));
      }
      if (url.startsWith("/api/admin/price?")) return Promise.resolve(jsonResponse({ prices: [] }));
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", vi.fn(() => true));

    await act(async () => root.render(<AdminPricePage />));
    await flush();
    const reviewButton = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("승격·롤백 검토"));
    await act(async () => reviewButton?.click());
    expect(promotedBody).toBeNull();
    expect(container.textContent).toContain("최종 확인 · 2026-Q2");
    const finalButton = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("최종 승격 실행"));
    await act(async () => finalButton?.click());
    await flush();

    expect(promotedBody).toEqual({ snapshot_id: targetId, action: "promote" });
    expect(snapshotReads).toBe(2);
  });

  it("confirms the preserved vendor by name and prevents duplicate merge requests", async () => {
    const candidateId = "20000000-0000-4000-8000-000000000001";
    let resolvePatch: ((response: Response) => void) | null = null;
    let patchCalls = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/admin/price/snapshots") return Promise.resolve(jsonResponse({ snapshots: [] }));
      if (url.startsWith("/api/admin/price?")) return Promise.resolve(jsonResponse({ prices: [] }));
      if (url.startsWith("/api/admin/price/dedupe?") && !init?.method) {
        return Promise.resolve(jsonResponse({
          candidates: [{
            id: candidateId,
            entity_kind: "vendor",
            reason: "이름 유사",
            similarity: 0.95,
            status: "pending",
            left_vendor: {
              id: "30000000-0000-4000-8000-000000000001",
              name: "유지할 스튜디오",
              category: "studio",
              region_code: "seoul_etc",
              enrichment_status: "done",
            },
            right_vendor: {
              id: "30000000-0000-4000-8000-000000000002",
              name: "병합될 스튜디오",
              category: "studio",
              region_code: "seoul_etc",
              enrichment_status: "pending",
            },
          }],
        }));
      }
      if (init?.method === "PATCH" && url.includes(candidateId)) {
        patchCalls += 1;
        return new Promise<Response>((resolve) => { resolvePatch = resolve; });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    const confirmMock = vi.fn((message: string) => message.length > 0);
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", confirmMock);

    await act(async () => root.render(<AdminPricePage />));
    await flush();
    const dedupeTab = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "중복 판단");
    await act(async () => dedupeTab?.click());
    await flush();
    const mergeButton = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("유지할 스튜디오 유지"));

    await act(async () => {
      mergeButton?.click();
      mergeButton?.click();
      await Promise.resolve();
    });

    expect(patchCalls).toBe(1);
    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(confirmMock.mock.calls[0]?.[0]).toContain("유지: 유지할 스튜디오");
    expect(confirmMock.mock.calls[0]?.[0]).toContain("병합 후 제외: 병합될 스튜디오");
    const decisionButtons = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .filter((button) => button.textContent?.includes("업체"));
    expect(decisionButtons.filter((button) => !button.disabled)).toHaveLength(0);

    await act(async () => {
      resolvePatch?.(jsonResponse({ decided: true }));
      await Promise.resolve();
    });
    await flush();
    expect(container.textContent).toContain("판단할 중복 후보가 없습니다.");
  });

  it("mounts the independent JSON upload and export panel without changing the default review tab", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/admin/price/snapshots") return Promise.resolve(jsonResponse({ snapshots: [] }));
      if (url.startsWith("/api/admin/price?")) return Promise.resolve(jsonResponse({ prices: [] }));
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(<AdminPricePage />));
    await flush();

    expect(container.textContent).toContain("공시 JSON 적재");
    expect(container.querySelector('a[href="/api/admin/price/export"]')).not.toBeNull();
    const activePriceTab = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "개별 가격");
    expect(activePriceTab?.className).toContain("bg-[#36534E]");
  });
});
