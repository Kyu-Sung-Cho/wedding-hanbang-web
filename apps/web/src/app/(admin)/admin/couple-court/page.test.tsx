import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, href, className }: {
    children: React.ReactNode;
    href: string;
    className?: string;
  }) => <a href={href} className={className}>{children}</a>,
}));

vi.mock("@/lib/coupleCourt/catalog", () => ({
  COURT_CATEGORY_CATALOG: [],
}));

import CoupleCourtModerationPage from "./page";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const VERDICT_ID = "00000000-0000-4000-8000-000000000009";
const LIVE_VERDICT_ID = "00000000-0000-4000-8000-000000000005";
const REQUEST_KEY = "d".repeat(64);
const LIVE_REQUEST_KEY = "e".repeat(64);

function queuePayload() {
  return {
    posts: [],
    comments: [],
    reports: [],
    reportedComments: [],
    providerReconciliations: [{
      verdictId: LIVE_VERDICT_ID,
      requestKey: LIVE_REQUEST_KEY,
      providerState: "failed_unknown",
      startedAt: "2026-07-13T02:59:00.000Z",
      failedAt: "2026-07-13T03:00:00.000Z",
      errorCode: "provider_request_aborted",
      createdAt: "2026-07-13T02:58:00.000Z",
      updatedAt: "2026-07-13T03:00:00.000Z",
    }],
    providerAuditRecoveries: [],
    providerDeletionHandoffs: [{
      verdictId: VERDICT_ID,
      requestKey: REQUEST_KEY,
      createdAt: "2026-07-13T03:05:00.000Z",
      expiresAt: "2026-10-11T03:05:00.000Z",
      subject: "private deleted subject",
      case: "private deleted case",
      statement: "private deleted statement",
      verdictPayload: "private deleted verdict",
    }],
    truncated: {
      posts: false,
      comments: false,
      reports: false,
      providerReconciliations: false,
      providerAuditRecoveries: false,
      providerDeletionHandoffs: false,
    },
  };
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const match = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!(match instanceof HTMLButtonElement)) throw new Error(`button not found: ${label}`);
  return match;
}

function input(container: HTMLElement, label: string): HTMLInputElement {
  const labels = Array.from(container.querySelectorAll("label"));
  const match = labels.find((candidate) => candidate.textContent?.includes(label));
  const field = match?.querySelector("input");
  if (!(field instanceof HTMLInputElement)) throw new Error(`input not found: ${label}`);
  return field;
}

async function change(field: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("deleted-subject provider settlement UI", () => {
  let container: HTMLDivElement;
  let root: Root;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { target?: string };
        if (body.target === "provider_deletion_handoff_reveal") {
          return Response.json({
            ok: true,
            requestKey: REQUEST_KEY,
            revealedAt: "2026-07-14T04:00:00.000Z",
          });
        }
        if (body.target === "provider_reconciliation_reveal") {
          return Response.json({
            ok: true,
            requestKey: LIVE_REQUEST_KEY,
            revealedAt: "2026-07-14T04:01:00.000Z",
          });
        }
        return Response.json({ ok: true });
      }
      return Response.json(queuePayload());
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows only the payload-free operations identity and requires both confirmations", async () => {
    const confirm = vi.spyOn(window, "confirm")
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true);
    const prompt = vi.spyOn(window, "prompt")
      .mockReturnValueOnce("wrong confirmation")
      .mockReturnValueOnce("REVEAL_PROVIDER_REQUEST_KEY")
      .mockReturnValueOnce("wrong resolution")
      .mockReturnValueOnce("CONFIRM_PROVIDER_NO_CHARGE");

    await act(async () => {
      root.render(<CoupleCourtModerationPage />);
    });
    await settle();

    expect(container.textContent).not.toContain(REQUEST_KEY);
    expect(container.textContent).not.toContain(LIVE_REQUEST_KEY);
    expect(container.textContent).not.toMatch(/[a-f0-9]{64}/);
    expect(container.textContent).not.toContain("private deleted subject");
    expect(container.textContent).not.toContain("private deleted case");
    expect(container.textContent).not.toContain("private deleted statement");
    expect(container.textContent).not.toContain("private deleted verdict");

    expect(button(container, "청구 없음으로 정산").disabled).toBe(true);

    await act(async () => button(container, "요청 키 1건 공개").click());
    expect(prompt).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);

    await act(async () => button(container, "요청 키 1건 공개").click());
    expect(container.textContent).toContain("고정 확인 문구가 일치하지 않아");
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);

    await act(async () => button(container, "요청 키 1건 공개").click());
    await settle();
    expect(container.textContent).toContain(REQUEST_KEY);
    expect(container.textContent).not.toContain(LIVE_REQUEST_KEY);
    expect(button(container, "청구 없음으로 정산").disabled).toBe(false);

    await act(async () => button(container, "청구 없음으로 정산").click());
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);

    await act(async () => button(container, "청구 없음으로 정산").click());
    await settle();

    const postCalls = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(postCalls).toHaveLength(2);
    expect(confirm).toHaveBeenCalledTimes(5);
    expect(prompt).toHaveBeenCalledTimes(4);
    expect(JSON.parse(String(postCalls[0]?.[1]?.body))).toEqual({
      target: "provider_deletion_handoff_reveal",
      id: VERDICT_ID,
      decision: "reveal_request_key",
      confirmation: "REVEAL_PROVIDER_REQUEST_KEY",
    });
    expect(JSON.parse(String(postCalls[1]?.[1]?.body))).toEqual({
      target: "provider_deletion_handoff",
      id: VERDICT_ID,
      decision: "confirm_no_charge",
      confirmation: "CONFIRM_PROVIDER_NO_CHARGE",
    });
    expect(container.textContent).not.toContain(REQUEST_KEY);
  });

  it("submits only strictly parsed provider evidence for a confirmed paid call", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(window, "prompt")
      .mockReturnValueOnce("REVEAL_PROVIDER_REQUEST_KEY")
      .mockReturnValueOnce("CONFIRM_PROVIDER_PAID");

    await act(async () => {
      root.render(<CoupleCourtModerationPage />);
    });
    await settle();

    await act(async () => button(container, "요청 키 1건 공개").click());
    await settle();

    await change(input(container, "OpenAI 모델명"), "gpt-5.6-terra");
    await change(input(container, "입력 토큰"), "301");
    await change(input(container, "출력 토큰"), "410");
    await change(input(container, "캐시 입력 토큰"), "25");
    await change(input(container, "캐시 쓰기 입력 토큰"), "0");
    await change(input(container, "비용(USD)"), "0.004200");

    await act(async () => button(container, "유료 호출로 기록").click());
    await settle();

    const postCalls = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(postCalls).toHaveLength(2);
    expect(JSON.parse(String(postCalls[1]?.[1]?.body))).toEqual({
      target: "provider_deletion_handoff",
      id: VERDICT_ID,
      decision: "record_paid",
      confirmation: "CONFIRM_PROVIDER_PAID",
      auditModel: "gpt-5.6-terra",
      inputTokens: 301,
      outputTokens: 410,
      cachedInputTokens: 25,
      cacheWriteInputTokens: 0,
      costUsd: 0.0042,
    });
  });

  it("reveals a live reconciliation key one at a time without putting it in the queue", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(window, "prompt").mockReturnValue("REVEAL_PROVIDER_REQUEST_KEY");

    await act(async () => {
      root.render(<CoupleCourtModerationPage />);
    });
    await settle();

    expect(container.textContent).not.toContain(LIVE_REQUEST_KEY);
    const revealButtons = Array.from(container.querySelectorAll("button")).filter(
      (candidate) => candidate.textContent?.trim() === "요청 키 1건 공개",
    );
    const liveReveal = revealButtons.at(-1);
    if (!(liveReveal instanceof HTMLButtonElement)) throw new Error("live reveal button not found");
    await act(async () => liveReveal.click());
    await settle();

    expect(container.textContent).toContain(LIVE_REQUEST_KEY);
    expect(container.textContent).not.toContain(REQUEST_KEY);
    const postCalls = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(postCalls).toHaveLength(1);
    expect(JSON.parse(String(postCalls[0]?.[1]?.body))).toEqual({
      target: "provider_reconciliation_reveal",
      id: LIVE_VERDICT_ID,
      decision: "reveal_request_key",
      confirmation: "REVEAL_PROVIDER_REQUEST_KEY",
    });
  });
});
