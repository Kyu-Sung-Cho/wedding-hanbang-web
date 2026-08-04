// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DecisionOutcomeReviewQueue } from "./DecisionOutcomeReviewQueue";

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
    ArrowLeft: Icon,
    CheckCircle2: Icon,
    FileCheck2: Icon,
    Loader2: Icon,
    RefreshCcw: Icon,
    ShieldAlert: Icon,
    ShieldCheck: Icon,
    XCircle: Icon,
  };
});

const OUTCOME_ID = "22222222-2222-4222-8222-222222222222";
const THREAD_ID = "33333333-3333-4333-8333-333333333333";
const OPERATION_KEY = "44444444-4444-4444-8444-444444444444";

function queueItem(overrides: Record<string, unknown> = {}) {
  return {
    outcomeId: OUTCOME_ID,
    threadId: THREAD_ID,
    revision: 2,
    publicationState: "pending_review",
    sourceAvailable: true,
    authorNickname: "준비하는두분",
    title: "계약 범위 밖 추가 비용을 어떻게 확인했나요?",
    sourceContent: "계약서와 견적서를 비교한 실제 경험을 묻습니다.",
    desiredAnswer: "업체에 확인할 문구와 순서",
    actionTaken: "계약서 포함 범위를 서면으로 다시 확인했습니다.",
    resultSummary: "추가 결제 없이 원래 범위로 진행했습니다.",
    applicableConditions: "같은 항목이 계약서에 포함된 경우입니다.",
    commercialRelationship: "discount",
    sponsorshipDetail: "계약 당시 공개 할인 적용",
    selectedEvidence: [{
      content: "계약 조항 번호와 견적 항목을 함께 보내 확인했습니다.",
      contentOrigin: "member",
      applicability: "taken_as_next_action",
      commercialRelationship: "none",
      sponsorshipDetail: null,
    }],
    createdAt: "2026-08-04T03:00:00.000Z",
    reviewedAt: null,
    reviewReason: null,
    reviewPolicyVersion: null,
    publishedAt: null,
    withdrawnAt: null,
    withdrawnReason: null,
    ...overrides,
  };
}

function queueResponse(items: unknown[], overrides: Record<string, unknown> = {}) {
  return jsonResponse({
    items,
    nextCursor: null,
    hasMore: false,
    state: "pending_review",
    ...overrides,
  });
}

function receipt(decision: "published" | "rejected") {
  return jsonResponse({
    receiptVersion: 1,
    operationKey: OPERATION_KEY,
    outcomeId: OUTCOME_ID,
    threadId: THREAD_ID,
    revision: 2,
    publicationState: decision,
    reviewedAt: "2026-08-04T04:00:00.000Z",
    replayed: false,
  });
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function findButton(container: HTMLElement, text: string) {
  return [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.includes(text));
}

function changeTextarea(textarea: HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set?.call(textarea, value);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("DecisionOutcomeReviewQueue", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => OPERATION_KEY) });
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

  it("shows the source, requested answer, selected evidence, outcome, and commercial relationship", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => queueResponse([queueItem()])));

    await act(async () => root.render(<DecisionOutcomeReviewQueue />));
    await flush();

    expect(container.textContent).toContain("계약서와 견적서를 비교한 실제 경험을 묻습니다.");
    expect(container.textContent).toContain("업체에 확인할 문구와 순서");
    expect(container.textContent).toContain("계약 조항 번호와 견적 항목을 함께 보내 확인했습니다.");
    expect(container.textContent).toContain("추가 결제 없이 원래 범위로 진행했습니다.");
    expect(container.textContent).toContain("할인 제공 · 계약 당시 공개 할인 적용");
    expect(container.textContent).toContain("출처 공개 가능");
    expect(container.textContent).toContain("자동 승인이나 정확성 보장을 주장하지 않습니다");
  });

  it("blocks publishing when the source is unavailable while keeping rejection available", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => queueResponse([
      queueItem({ sourceAvailable: false }),
    ])));

    await act(async () => root.render(<DecisionOutcomeReviewQueue />));
    await flush();

    expect(findButton(container, "공개 승인 검토")?.disabled).toBe(true);
    expect(findButton(container, "반려 검토")?.disabled).toBe(false);
    expect(container.textContent).toContain("공개 승인은 막혀 있으며 반려만 기록할 수 있습니다");
  });

  it("records a rejection with a new UUID and the same human-review policy", async () => {
    let getCalls = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "PATCH") return Promise.resolve(receipt("rejected"));
      if (url.startsWith("/api/admin/community/decision-outcomes?")) {
        getCalls += 1;
        return Promise.resolve(queueResponse(
          getCalls === 1 ? [queueItem({ sourceAvailable: false })] : [],
        ));
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(<DecisionOutcomeReviewQueue />));
    await flush();
    const textarea = container.querySelector<HTMLTextAreaElement>("textarea");
    await act(async () => {
      if (textarea) changeTextarea(textarea, "원문 공개 상태를 확인할 수 없어 반려합니다.");
    });
    await act(async () => findButton(container, "반려 검토")?.click());
    await act(async () => findButton(container, "반려 확정")?.click());
    await flush();

    const patchRequest = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(JSON.parse(String((patchRequest?.[1] as RequestInit).body))).toEqual({
      decision: "reject",
      reason: "원문 공개 상태를 확인할 수 없어 반려합니다.",
      policyVersion: "p0-human-v1",
    });
    expect((patchRequest?.[1] as RequestInit).headers).toMatchObject({
      "Idempotency-Key": OPERATION_KEY,
    });
    expect(globalThis.crypto.randomUUID).toHaveBeenCalledTimes(1);
    expect(getCalls).toBe(2);
  });

  it("requires a human-written reason before staging either decision", async () => {
    const fetchMock = vi.fn(async () => queueResponse([queueItem()]));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(<DecisionOutcomeReviewQueue />));
    await flush();
    const textarea = container.querySelector<HTMLTextAreaElement>("textarea");
    expect(textarea).not.toBeNull();

    await act(async () => {
      if (textarea) changeTextarea(textarea, "짧");
    });
    await act(async () => findButton(container, "공개 승인 검토")?.click());

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("3자 이상");
    expect(findButton(container, "공개 승인 확정")).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses a fresh UUID, requires final confirmation, prevents duplicate clicks, and refreshes after publishing", async () => {
    let finishPatch: ((response: Response) => void) | null = null;
    let getCalls = 0;
    let patchCalls = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "PATCH") {
        patchCalls += 1;
        return new Promise<Response>((resolve) => {
          finishPatch = resolve;
        });
      }
      if (url.startsWith("/api/admin/community/decision-outcomes?")) {
        getCalls += 1;
        return Promise.resolve(queueResponse(getCalls === 1 ? [queueItem()] : []));
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(<DecisionOutcomeReviewQueue />));
    await flush();
    const textarea = container.querySelector<HTMLTextAreaElement>("textarea");
    await act(async () => {
      if (textarea) {
        changeTextarea(textarea, "원문과 선택 근거, 상업관계를 사람이 직접 확인했습니다.");
      }
    });

    await act(async () => findButton(container, "공개 승인 검토")?.click());
    expect(patchCalls).toBe(0);
    expect(container.textContent).toContain("공개 승인 최종 확인");

    const confirmButton = findButton(container, "공개 승인 확정");
    await act(async () => {
      confirmButton?.click();
      confirmButton?.click();
      await Promise.resolve();
    });
    expect(patchCalls).toBe(1);
    expect(confirmButton?.getAttribute("aria-busy")).toBe("true");

    const patchRequest = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(patchRequest?.[0]).toBe(
      `/api/admin/community/decision-outcomes/${OUTCOME_ID}/review`,
    );
    expect((patchRequest?.[1] as RequestInit).headers).toEqual({
      "Content-Type": "application/json",
      "Idempotency-Key": OPERATION_KEY,
    });
    expect(JSON.parse(String((patchRequest?.[1] as RequestInit).body))).toEqual({
      decision: "publish",
      reason: "원문과 선택 근거, 상업관계를 사람이 직접 확인했습니다.",
      policyVersion: "p0-human-v1",
    });

    await act(async () => {
      finishPatch?.(receipt("published"));
      await Promise.resolve();
    });
    await flush();

    expect(getCalls).toBe(2);
    expect(container.querySelector('[role="status"]')?.textContent)
      .toContain("대기열을 갱신했습니다");
    expect(container.textContent).toContain("현재 공개 검수 대기 결과가 없습니다.");
  });

  it("fails closed on an unexpected queue shape", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      items: [{ ...queueItem(), authorId: THREAD_ID }],
      nextCursor: null,
      hasMore: false,
      state: "pending_review",
    })));

    await act(async () => root.render(<DecisionOutcomeReviewQueue />));
    await flush();

    expect(container.textContent).toContain("대기열을 확인하지 못했습니다.");
    expect(container.querySelector('[role="alert"]')?.textContent)
      .toContain("안전하게 확인하지 못했습니다");
    expect(container.textContent).not.toContain("공개 승인 검토");
  });
});
