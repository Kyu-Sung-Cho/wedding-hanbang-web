import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CourtCase, CourtVerdict } from "../types";

const mocks = vi.hoisted(() => ({
  captureCourtEvent: vi.fn(),
  getCase: vi.fn(),
  getVerdict: vi.fn(),
  getVerdictHistory: vi.fn(),
  getVerdictStatus: vi.fn(),
  requestVerdict: vi.fn(),
}));

vi.mock("../api", async (importOriginal) => {
  const original = await importOriginal<typeof import("../api")>();
  return {
    ...original,
    getCase: mocks.getCase,
    getVerdict: mocks.getVerdict,
    getVerdictHistory: mocks.getVerdictHistory,
    getVerdictStatus: mocks.getVerdictStatus,
    requestVerdict: mocks.requestVerdict,
  };
});

vi.mock("../analytics", () => ({
  captureCourtEvent: mocks.captureCourtEvent,
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

import VerdictView, { verdictPollDelayMs } from "../VerdictView";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const courtCase: CourtCase = {
  id: "case-1",
  title: "예산 확인 사건",
  category: "budget",
  mode: "couple",
  tone: "gentle",
  status: "verdict_ready",
  applicantStatementSubmitted: true,
  partnerJoined: true,
  partnerStatementSubmitted: true,
  canJudge: false,
  verdictReady: true,
  safetyLevel: "normal",
};

const verdict: CourtVerdict = {
  id: "verdict-1",
  provisional: false,
  safetyLevel: "normal",
  verdictOneLine: "함께 확인 규칙을 정해요.",
  summary: "답변 시점이 달랐어요.",
  facts: [],
  applicantPerspective: "답변 기한이 필요했어요.",
  respondentPerspective: "검토 시간이 필요했어요.",
  coreIssues: [],
  repairScripts: [],
  missions: [],
};

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("VerdictView polling", () => {
  let container: HTMLDivElement;
  let root: Root;
  let hidden = false;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    vi.spyOn(Math, "random").mockReturnValue(0);
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => hidden ? "hidden" : "visible");
    hidden = false;
    mocks.getCase.mockResolvedValue(courtCase);
    mocks.getVerdict.mockResolvedValue(verdict);
    mocks.getVerdictHistory.mockResolvedValue([]);
    mocks.requestVerdict.mockResolvedValue(undefined);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("polls one lightweight status call per Retry-After and loads full data once after ready", async () => {
    mocks.getVerdictStatus
      .mockResolvedValueOnce({ status: "judging", retryAfterSeconds: 7, recoveryAllowed: false })
      .mockResolvedValueOnce({ status: "ready", recoveryAllowed: false });

    await act(async () => root.render(<VerdictView caseId="case-1" publicEnabled={false} />));
    await settle();

    expect(mocks.getVerdictStatus).toHaveBeenCalledTimes(1);
    expect(mocks.getCase).not.toHaveBeenCalled();
    expect(mocks.getVerdict).not.toHaveBeenCalled();
    expect(mocks.getVerdictHistory).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_999);
    });
    expect(mocks.getVerdictStatus).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    await settle();

    expect(mocks.getVerdictStatus).toHaveBeenCalledTimes(2);
    expect(mocks.getCase).toHaveBeenCalledTimes(1);
    expect(mocks.getVerdict).toHaveBeenCalledTimes(1);
    expect(mocks.getVerdictHistory).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("함께 확인 규칙을 정해요.");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(mocks.getVerdictStatus).toHaveBeenCalledTimes(2);

    hidden = true;
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    hidden = false;
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await settle();
    expect(mocks.getVerdictStatus).toHaveBeenCalledTimes(2);
    expect(mocks.getCase).toHaveBeenCalledTimes(1);
  });

  it("aborts and pauses while hidden, resumes once, and ignores the stale response", async () => {
    let resolveFirst!: (value: { status: "ready"; recoveryAllowed: false }) => void;
    let firstSignal: AbortSignal | undefined;
    const first = new Promise<{ status: "ready"; recoveryAllowed: false }>((resolve) => {
      resolveFirst = resolve;
    });
    mocks.getVerdictStatus
      .mockImplementationOnce((_caseId: string, signal?: AbortSignal) => {
        firstSignal = signal;
        return first;
      })
      .mockResolvedValueOnce({ status: "judging", retryAfterSeconds: 9, recoveryAllowed: false });

    await act(async () => root.render(<VerdictView caseId="case-1" publicEnabled={false} />));
    await settle();
    expect(mocks.getVerdictStatus).toHaveBeenCalledTimes(1);

    hidden = true;
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(firstSignal?.aborted).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(mocks.getVerdictStatus).toHaveBeenCalledTimes(1);

    hidden = false;
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await settle();
    expect(mocks.getVerdictStatus).toHaveBeenCalledTimes(2);

    resolveFirst({ status: "ready", recoveryAllowed: false });
    await settle();
    expect(mocks.getCase).not.toHaveBeenCalled();
    expect(mocks.getVerdict).not.toHaveBeenCalled();
  });

  it("attempts an expired-lease recovery only once before resuming status polling", async () => {
    mocks.getVerdictStatus
      .mockResolvedValueOnce({ status: "judging", retryAfterSeconds: 1, recoveryAllowed: true })
      .mockResolvedValueOnce({ status: "judging", retryAfterSeconds: 1, recoveryAllowed: true })
      .mockResolvedValueOnce({ status: "ready", recoveryAllowed: false });

    await act(async () => root.render(<VerdictView caseId="case-1" publicEnabled={false} />));
    await settle();
    expect(mocks.requestVerdict).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    await settle();
    expect(mocks.requestVerdict).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    await settle();
    expect(mocks.requestVerdict).toHaveBeenCalledTimes(1);
    expect(mocks.getCase).toHaveBeenCalledTimes(1);
  });

  it("keeps an archived verdict readable without mutation or progression actions", async () => {
    mocks.getVerdictStatus.mockResolvedValue({ status: "ready", recoveryAllowed: false });
    mocks.getCase.mockResolvedValue({
      ...courtCase,
      status: "archived",
      mode: "solo",
    });
    mocks.getVerdict.mockResolvedValue({
      ...verdict,
      missions: [{
        id: "mission-1",
        title: "저녁 일정 확인",
        description: "보관 당시 정한 처방이에요.",
        ownerRole: "applicant",
      }],
      publicCard: {
        safeTitle: "익명 판결",
        oneLine: "함께 확인해요.",
        resultLabel: "대화 필요",
        hashtags: ["대화"],
      },
    });

    await act(async () => root.render(
      <VerdictView caseId="case-1" publicEnabled />,
    ));
    await settle();

    expect(container.textContent).toContain("함께 확인 규칙을 정해요.");
    expect(container.textContent).toContain("보관된 사건은 읽기 전용이에요");
    expect(container.textContent).toContain("보관됨");
    expect(container.textContent).not.toContain("화해 처방 바로 실행하기");
    expect(container.textContent).not.toContain("화해 처방 실행하기");
    expect(container.textContent).not.toContain("상대방을 초대해 정식 판결로 전환");
    expect(container.textContent).not.toContain("판결 공유 카드");
    expect(container.textContent).not.toContain("선택적으로 익명 공개하기");
    expect(container.textContent).not.toContain("내 진술 보완하고 재심 요청");
  });
});

describe("verdictPollDelayMs", () => {
  it("bounds Retry-After and adds only positive bounded jitter", () => {
    expect(verdictPollDelayMs(0, 0)).toBe(1_000);
    expect(verdictPollDelayMs(5, 0.5)).toBe(5_250);
    expect(verdictPollDelayMs(999, 0.999)).toBeLessThan(301_000);
  });
});
