import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CourtCase, CourtVerdict } from "../types";

const mocks = vi.hoisted(() => ({
  captureCourtEvent: vi.fn(),
  getCase: vi.fn(),
  getVerdict: vi.fn(),
  saveMissionAction: vi.fn(),
  submitFollowup: vi.fn(),
  updateMissionStatus: vi.fn(),
}));

vi.mock("../api", () => ({
  getCase: mocks.getCase,
  getVerdict: mocks.getVerdict,
  saveMissionAction: mocks.saveMissionAction,
  submitFollowup: mocks.submitFollowup,
  updateMissionStatus: mocks.updateMissionStatus,
}));

vi.mock("../analytics", () => ({ captureCourtEvent: mocks.captureCourtEvent }));

vi.mock("next/link", () => ({
  default: ({ children, href, as }: { children: React.ReactNode; href: string; as?: string }) => (
    <a href={as ?? href}>{children}</a>
  ),
}));

import MissionView from "../MissionView";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = Date.UTC(2026, 6, 14, 3, 0, 0);

function courtCase(mode: "solo" | "couple" = "couple"): CourtCase {
  return {
    id: "case-1",
    title: "화해 처방 테스트",
    category: "budget",
    mode,
    tone: "gentle",
    status: "verdict_ready",
    viewerRole: "applicant",
    applicantStatementSubmitted: true,
    partnerJoined: mode === "couple",
    partnerStatementSubmitted: mode === "couple",
    canJudge: false,
    verdictReady: true,
    safetyLevel: "normal",
  };
}

function verdict(createdAt: string, withMission = false): CourtVerdict {
  return {
    id: "verdict-1",
    provisional: false,
    safetyLevel: "normal",
    verdictOneLine: "서로 확인할 규칙을 정해요.",
    summary: "작은 행동부터 확인해요.",
    facts: [],
    applicantPerspective: "일정을 미리 알고 싶어요.",
    respondentPerspective: "확인할 시간이 필요해요.",
    coreIssues: [],
    repairScripts: [],
    missions: withMission
      ? [{ id: "mission-1", title: "매일 일정 확인", description: "저녁에 함께 확인해요.", ownerRole: "applicant" }]
      : [],
    createdAt,
  };
}

function findButton(container: HTMLElement, label: string) {
  const match = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!match) throw new Error(`button not found: ${label}`);
  return match;
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("MissionView follow-up and solo-save UX", () => {
  let container: HTMLDivElement;
  let root: Root;
  let visibilityState: DocumentVisibilityState;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.resetAllMocks();
    visibilityState = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(
      () => visibilityState,
    );
    mocks.getCase.mockResolvedValue(courtCase());
    mocks.getVerdict.mockResolvedValue(
      verdict(new Date(NOW - 72 * 60 * 60 * 1_000 + 1_000).toISOString()),
    );
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

  it("unlocks the 72-hour follow-up at its deadline without reopening the tab", async () => {
    await act(async () => root.render(<MissionView caseId="case-1" />));
    await settle();
    expect(container.querySelector("#remaining-issue")).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_050);
    });

    expect(container.querySelector("#remaining-issue")).not.toBeNull();
  });

  it("refreshes the follow-up lock when a throttled tab becomes visible", async () => {
    mocks.getVerdict.mockResolvedValue(
      verdict(new Date(NOW - 72 * 60 * 60 * 1_000 + 10_000).toISOString()),
    );
    await act(async () => root.render(<MissionView caseId="case-1" />));
    await settle();
    expect(container.querySelector("#remaining-issue")).toBeNull();

    visibilityState = "hidden";
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    vi.setSystemTime(NOW + 11_000);
    visibilityState = "visible";
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await settle();

    expect(container.querySelector("#remaining-issue")).not.toBeNull();
  });

  it("renders safety resources on a high-risk deep link without requesting the verdict", async () => {
    mocks.getCase.mockResolvedValue({
      ...courtCase(),
      safetyLevel: "high_risk",
      status: "archived",
    });
    mocks.getVerdict.mockRejectedValue(new Error("court_safety_redirect"));

    await act(async () => root.render(<MissionView caseId="case-1" />));
    await settle();

    expect(container.textContent).toContain("재미있는 판결보다 안전 확인이 먼저예요");
    expect(container.textContent).toContain("기존 판결과 처방을 표시하거나 실행하지 않아요");
    expect(container.querySelector('a[href="tel:112"]')).not.toBeNull();
    expect(mocks.getVerdict).not.toHaveBeenCalled();
    expect(container.querySelector("#remaining-issue")).toBeNull();
  });

  it("renders an archived mission deep link as read-only without mutation controls", async () => {
    mocks.getCase.mockResolvedValue({
      ...courtCase(),
      status: "archived",
      verdictReady: true,
    });
    mocks.getVerdict.mockResolvedValue(
      verdict(new Date(NOW - 73 * 60 * 60 * 1_000).toISOString(), true),
    );

    await act(async () => root.render(<MissionView caseId="case-1" />));
    await settle();

    expect(container.textContent).toContain("보관된 사건은 읽기 전용이에요");
    expect(container.querySelector('a[href$="/couple-court/cases/case-1"]')).not.toBeNull();
    expect(container.querySelector('a[href$="/couple-court/cases/case-1/verdict"]')).not.toBeNull();
    expect(container.textContent).not.toContain("이 처방 수락");
    expect(container.textContent).not.toContain("공용 일정·할 일로 저장");
    expect(container.textContent).not.toContain("3일 후 체크인");
    expect(container.querySelector("form")).toBeNull();
    expect(mocks.getVerdict).not.toHaveBeenCalled();
  });

  it("keeps a solo-save failure announced and focused inside a viewport-safe dialog", async () => {
    mocks.getCase.mockResolvedValue(courtCase("solo"));
    mocks.getVerdict.mockResolvedValue(
      verdict(new Date(NOW - 73 * 60 * 60 * 1_000).toISOString(), true),
    );
    mocks.saveMissionAction.mockRejectedValue(new Error("할 일을 저장하지 못했어요."));

    await act(async () => root.render(<MissionView caseId="case-1" />));
    await settle();
    act(() => findButton(container, "공용 일정·할 일로 저장").click());

    const dialog = container.querySelector<HTMLElement>('[role="alertdialog"]')!;
    const overlay = dialog.parentElement!;
    expect(dialog.className).toContain("overflow-y-auto");
    expect(dialog.style.maxHeight).toContain("100dvh");
    expect(overlay.className).toContain("overflow-y-auto");
    expect(overlay.className).toContain("safe-area-inset-bottom");

    act(() => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    await act(async () => findButton(container, "확인하고 저장").click());
    await settle();

    const modalError = container.querySelector<HTMLElement>("#solo-share-error");
    expect(modalError?.textContent).toBe("할 일을 저장하지 못했어요.");
    expect(modalError?.closest('[aria-live="assertive"]')).not.toBeNull();
    expect(document.activeElement).toBe(modalError);
    expect(container.querySelector('[role="alertdialog"]')).not.toBeNull();
  });
});
