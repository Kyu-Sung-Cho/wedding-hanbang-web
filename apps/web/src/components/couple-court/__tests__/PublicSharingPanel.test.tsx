import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CourtCase, PublicSnapshotPreview } from "../types";

const mocks = vi.hoisted(() => ({
  createPublicPreview: vi.fn(),
  getCase: vi.fn(),
  requestPublicReview: vi.fn(),
  setPublicConsent: vi.fn(),
  withdrawPublicPost: vi.fn(),
  captureCourtEvent: vi.fn(),
}));

vi.mock("../api", () => ({
  createPublicPreview: mocks.createPublicPreview,
  getCase: mocks.getCase,
  requestPublicReview: mocks.requestPublicReview,
  setPublicConsent: mocks.setPublicConsent,
  withdrawPublicPost: mocks.withdrawPublicPost,
}));

vi.mock("../analytics", () => ({
  captureCourtEvent: mocks.captureCourtEvent,
}));

vi.mock("next/link", () => ({
  default: ({ children, href, as }: { children: React.ReactNode; href: string; as?: string }) => (
    <a href={as ?? href}>{children}</a>
  ),
}));

import PublicSharingPanel from "../PublicSharingPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function courtCase(publicStatus: string): CourtCase {
  return {
    id: "case-1",
    title: "공개 상태 테스트",
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
    publicStatus,
    publicPostId: "post-1",
  };
}

const persistedPreview: PublicSnapshotPreview = {
  publicPostId: "post-1",
  snapshotHash: "a".repeat(64),
  snapshotVersion: 3,
  snapshot: {
    safeTitle: "익명 예산 사건",
    oneLine: "예산 기준을 다시 맞추기로 했어요.",
    resultLabel: "함께 조정",
    hashtags: ["예산"],
    provisional: false,
  },
};

function button(container: HTMLElement, label: string) {
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

describe("PublicSharingPanel action feedback", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.resetAllMocks();
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

  it("restores the signed-in viewer's existing consent after reload", async () => {
    const existing = {
      ...courtCase("awaiting_consents"),
      publicPreview: persistedPreview,
      publicViewerConsented: true,
    } as CourtCase & { publicViewerConsented: boolean };

    await act(async () => root.render(<PublicSharingPanel courtCase={existing} />));

    const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(checkbox?.checked).toBe(true);
    expect(checkbox?.disabled).toBe(true);
    expect(container.textContent).toContain("상대방 동의 기다리는 중");
    expect(container.textContent).not.toContain("내 공개 동의 저장");
  });

  it("refreshes partner consent when the viewer returns to the tab", async () => {
    const existing = {
      ...courtCase("awaiting_consents"),
      publicPreview: persistedPreview,
      publicViewerConsented: true,
    };
    mocks.getCase.mockResolvedValue({
      ...existing,
      publicStatus: "pending_review",
    });

    await act(async () => root.render(<PublicSharingPanel courtCase={existing} />));
    expect(container.textContent).toContain("상대방 동의 기다리는 중");

    await act(async () => window.dispatchEvent(new Event("focus")));
    await settle();

    expect(mocks.getCase).toHaveBeenCalledWith("case-1", expect.any(AbortSignal));
    expect(container.textContent).toContain("운영 검수 대기");
    expect(container.textContent).toContain("필요한 공개 동의가 모두 모였어요");
  });

  it("returns to partner-consent waiting when the partner changes consent", async () => {
    const pendingReview = {
      ...courtCase("pending_review"),
      publicPreview: persistedPreview,
      publicViewerConsented: true,
    };
    mocks.getCase.mockResolvedValue({
      ...pendingReview,
      publicStatus: "awaiting_consents",
    });

    await act(async () => root.render(<PublicSharingPanel courtCase={pendingReview} />));
    expect(container.textContent).toContain("운영 검수 대기");

    await act(async () => window.dispatchEvent(new Event("focus")));
    await settle();

    expect(container.textContent).toContain("상대방 동의 기다리는 중");
    expect(container.textContent).toContain("공개 동의 상태가 바뀌었어요");
    const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(checkbox?.checked).toBe(true);
    expect(checkbox?.disabled).toBe(true);
  });

  it("refreshes the signed-in viewer's consent on visibility return", async () => {
    const awaitingConsent = {
      ...courtCase("awaiting_consents"),
      publicPreview: persistedPreview,
      publicViewerConsented: false,
    };
    mocks.getCase.mockResolvedValue({
      ...awaitingConsent,
      publicViewerConsented: true,
    });

    await act(async () => root.render(<PublicSharingPanel courtCase={awaitingConsent} />));
    expect(container.textContent).toContain("내 공개 동의 저장");

    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    await settle();

    expect(mocks.getCase).toHaveBeenCalledWith("case-1", expect.any(AbortSignal));
    expect(container.textContent).toContain("상대방 동의 기다리는 중");
    expect(container.textContent).toContain("이 계정의 공개 동의가 저장된 상태");
  });

  it("polls the authoritative public state every 20 seconds while the tab is visible", async () => {
    vi.useFakeTimers();
    const awaitingConsent = {
      ...courtCase("awaiting_consents"),
      publicPreview: persistedPreview,
      publicViewerConsented: true,
    };
    mocks.getCase.mockResolvedValue({
      ...awaitingConsent,
      publicStatus: "pending_review",
    });

    await act(async () => root.render(<PublicSharingPanel courtCase={awaitingConsent} />));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(19_999);
    });
    expect(mocks.getCase).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(mocks.getCase).toHaveBeenCalledTimes(1);
    expect(mocks.getCase).toHaveBeenCalledWith("case-1", expect.any(AbortSignal));
    expect(container.textContent).toContain("운영 검수 대기");
  });

  it("does not poll while the tab is hidden", async () => {
    vi.useFakeTimers();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    const awaitingConsent = {
      ...courtCase("awaiting_consents"),
      publicPreview: persistedPreview,
      publicViewerConsented: true,
    };

    await act(async () => root.render(<PublicSharingPanel courtCase={awaitingConsent} />));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(mocks.getCase).not.toHaveBeenCalled();
  });

  it("does not keep polling after the public workflow reaches a terminal state", async () => {
    vi.useFakeTimers();
    const published = {
      ...courtCase("published"),
      publicPreview: persistedPreview,
      publicViewerConsented: true,
    };

    await act(async () => root.render(<PublicSharingPanel courtCase={published} />));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(mocks.getCase).not.toHaveBeenCalled();
  });

  it("keeps interval refreshes single-flight until the active request settles", async () => {
    vi.useFakeTimers();
    let resolveRefresh: ((value: CourtCase) => void) | undefined;
    const awaitingConsent = {
      ...courtCase("awaiting_consents"),
      publicPreview: persistedPreview,
      publicViewerConsented: true,
    };
    mocks.getCase.mockReturnValue(new Promise<CourtCase>((resolve) => {
      resolveRefresh = resolve;
    }));

    await act(async () => root.render(<PublicSharingPanel courtCase={awaitingConsent} />));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(mocks.getCase).toHaveBeenCalledTimes(1);

    await act(async () => resolveRefresh?.(awaitingConsent));
    await settle();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    expect(mocks.getCase).toHaveBeenCalledTimes(2);
  });

  it("lets a waiting participant check the latest consent state immediately", async () => {
    const awaitingConsent = {
      ...courtCase("awaiting_consents"),
      publicPreview: persistedPreview,
      publicViewerConsented: true,
    };
    mocks.getCase.mockResolvedValue({
      ...awaitingConsent,
      publicStatus: "pending_review",
    });

    await act(async () => root.render(<PublicSharingPanel courtCase={awaitingConsent} />));

    await act(async () => button(container, "지금 확인").click());
    await settle();

    expect(mocks.getCase).toHaveBeenCalledWith("case-1", expect.any(AbortSignal));
    expect(container.textContent).toContain("운영 검수 대기");
  });

  it("announces one in-flight manual refresh and disables duplicate checks", async () => {
    let resolveRefresh: ((value: CourtCase) => void) | undefined;
    const awaitingConsent = {
      ...courtCase("awaiting_consents"),
      publicPreview: persistedPreview,
      publicViewerConsented: true,
    };
    mocks.getCase.mockReturnValue(new Promise<CourtCase>((resolve) => {
      resolveRefresh = resolve;
    }));

    await act(async () => root.render(<PublicSharingPanel courtCase={awaitingConsent} />));

    act(() => button(container, "지금 확인").click());

    const loadingButton = button(container, "최신 상태 확인 중…") as HTMLButtonElement;
    expect(loadingButton.disabled).toBe(true);
    act(() => loadingButton.click());
    expect(mocks.getCase).toHaveBeenCalledTimes(1);

    await act(async () => resolveRefresh?.(awaitingConsent));
    await settle();

    expect((button(container, "지금 확인") as HTMLButtonElement).disabled).toBe(false);
  });

  it("confirms when a manual check finds the waiting state is already current", async () => {
    const awaitingConsent = {
      ...courtCase("awaiting_consents"),
      publicPreview: persistedPreview,
      publicViewerConsented: true,
    };
    mocks.getCase.mockResolvedValue(awaitingConsent);

    await act(async () => root.render(<PublicSharingPanel courtCase={awaitingConsent} />));
    await act(async () => button(container, "지금 확인").click());
    await settle();

    expect(container.querySelector('[aria-live="polite"]')?.textContent).toContain(
      "최신 공개 상태를 확인했어요",
    );
  });

  it("announces a manual refresh failure without removing the usable waiting state", async () => {
    const awaitingConsent = {
      ...courtCase("awaiting_consents"),
      publicPreview: persistedPreview,
      publicViewerConsented: true,
    };
    mocks.getCase.mockRejectedValue(new Error("최신 상태 확인에 실패했어요."));

    await act(async () => root.render(<PublicSharingPanel courtCase={awaitingConsent} />));
    await act(async () => button(container, "지금 확인").click());
    await settle();

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "최신 상태 확인에 실패했어요.",
    );
    expect(container.textContent).toContain("상대방 동의 기다리는 중");
    expect((button(container, "지금 확인") as HTMLButtonElement).disabled).toBe(false);
  });

  it("removes public actions when an authoritative refresh raises the safety level", async () => {
    const awaitingConsent = {
      ...courtCase("awaiting_consents"),
      publicPreview: persistedPreview,
      publicViewerConsented: true,
    };
    mocks.getCase.mockResolvedValue({
      ...awaitingConsent,
      safetyLevel: "high_risk",
      publicStatus: "hidden",
      publicPreview: undefined,
    });

    await act(async () => root.render(<PublicSharingPanel courtCase={awaitingConsent} />));
    expect(container.textContent).toContain("상대방 동의 기다리는 중");

    await act(async () => window.dispatchEvent(new Event("focus")));
    await settle();

    expect(container.textContent).toContain("이 사건은 공개재판을 사용하지 않아요");
    expect(container.textContent).not.toContain("새 미리보기 만들기");
    expect(container.textContent).not.toContain("공개 후보 철회");
  });

  it("becomes read-only when an authoritative refresh reports an archived case", async () => {
    const awaitingConsent = {
      ...courtCase("awaiting_consents"),
      publicPreview: persistedPreview,
      publicViewerConsented: true,
    };
    mocks.getCase.mockResolvedValue({
      ...awaitingConsent,
      status: "archived",
      publicStatus: "hidden",
      publicPreview: undefined,
    });

    await act(async () => root.render(<PublicSharingPanel courtCase={awaitingConsent} />));

    await act(async () => window.dispatchEvent(new Event("focus")));
    await settle();

    expect(container.textContent).toContain("보관된 사건은 공개 설정을 바꿀 수 없어요");
    expect(container.textContent).not.toContain("새 미리보기 만들기");
    expect(container.textContent).not.toContain("공개 후보 철회");
  });

  it("collapses duplicate preview creation clicks into one public operation", async () => {
    let resolvePreview: ((value: PublicSnapshotPreview) => void) | undefined;
    const pendingPreview = new Promise<PublicSnapshotPreview>((resolve) => {
      resolvePreview = resolve;
    });
    mocks.createPublicPreview.mockReturnValue(pendingPreview);
    mocks.getCase.mockResolvedValue({
      ...courtCase("awaiting_consents"),
      publicPreview: persistedPreview,
      publicViewerConsented: false,
    });
    const withoutPreview = {
      ...courtCase(""),
      publicStatus: undefined,
      publicPostId: undefined,
    };

    await act(async () => root.render(<PublicSharingPanel courtCase={withoutPreview} />));
    const createButton = button(container, "공개 전용 미리보기 만들기");
    await act(async () => {
      createButton.click();
      createButton.click();
    });

    expect(mocks.createPublicPreview).toHaveBeenCalledTimes(1);

    await act(async () => resolvePreview?.(persistedPreview));
    await settle();
  });

  it("recovers a created preview when the mutation acknowledgement is lost", async () => {
    mocks.createPublicPreview.mockRejectedValue(new Error("preview acknowledgement lost"));
    mocks.getCase.mockResolvedValue({
      ...courtCase("awaiting_consents"),
      publicPreview: persistedPreview,
      publicViewerConsented: false,
    });
    const withoutPreview = {
      ...courtCase(""),
      publicStatus: undefined,
      publicPostId: undefined,
    };

    await act(async () => root.render(<PublicSharingPanel courtCase={withoutPreview} />));
    await act(async () => button(container, "공개 전용 미리보기 만들기").click());
    await settle();

    expect(mocks.getCase).toHaveBeenCalledWith("case-1");
    expect(container.textContent).toContain("익명 예산 사건");
    expect(container.textContent).toContain("서버에서 공개 미리보기 상태를 확인했어요");
    expect(container.textContent).not.toContain("preview acknowledgement lost");
  });

  it("recovers viewer consent when its mutation acknowledgement is lost", async () => {
    mocks.setPublicConsent.mockRejectedValue(new Error("consent acknowledgement lost"));
    mocks.getCase.mockResolvedValue({
      ...courtCase("awaiting_consents"),
      publicPreview: persistedPreview,
      publicViewerConsented: true,
    });
    const awaitingConsent = {
      ...courtCase("awaiting_consents"),
      publicPreview: persistedPreview,
      publicViewerConsented: false,
    };

    await act(async () => root.render(<PublicSharingPanel courtCase={awaitingConsent} />));
    const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    act(() => checkbox?.click());
    await act(async () => button(container, "내 공개 동의 저장").click());
    await settle();

    expect(mocks.getCase).toHaveBeenCalledWith("case-1");
    expect(container.textContent).toContain("상대방 동의 기다리는 중");
    expect(container.textContent).toContain("서버에서 내 공개 동의 상태를 확인했어요");
    expect(container.textContent).not.toContain("consent acknowledgement lost");
  });

  it("recovers a public withdrawal when its acknowledgement is lost", async () => {
    mocks.withdrawPublicPost.mockRejectedValue(new Error("withdraw acknowledgement lost"));
    mocks.getCase.mockResolvedValue({
      ...courtCase("hidden"),
      publicPreview: persistedPreview,
      publicViewerConsented: false,
    });

    await act(async () => root.render(<PublicSharingPanel courtCase={courtCase("published")} />));
    act(() => button(container, "공개 철회").click());
    await act(async () => button(container, "공개 철회 확인").click());
    await settle();

    expect(mocks.getCase).toHaveBeenCalledWith("case-1");
    expect(container.textContent).toContain("공개를 철회한 사건이에요");
    expect(container.textContent).toContain("서버에서 공개 철회 상태를 확인했어요");
    expect(container.textContent).not.toContain("withdraw acknowledgement lost");
  });

  it("recovers publication when the review acknowledgement is lost", async () => {
    mocks.requestPublicReview.mockRejectedValue(new Error("publish acknowledgement lost"));
    mocks.getCase.mockResolvedValue({
      ...courtCase("published"),
      publicPreview: persistedPreview,
      publicViewerConsented: true,
    });

    await act(async () => root.render(<PublicSharingPanel courtCase={courtCase("pending_review")} />));
    await act(async () => button(container, "승인 상태 확인하고 게시").click());
    await settle();

    expect(mocks.getCase).toHaveBeenCalledWith("case-1");
    expect(container.textContent).toContain("익명 판결이 공개되어 있어요");
    expect(container.textContent).toContain("서버에서 공개 상태를 확인했어요");
    expect(container.textContent).not.toContain("publish acknowledgement lost");
  });

  it("does not let a stale focus refresh overwrite a newer withdrawal", async () => {
    let resolveStaleRefresh: ((value: CourtCase) => void) | undefined;
    const staleRefresh = new Promise<CourtCase>((resolve) => {
      resolveStaleRefresh = resolve;
    });
    const published = {
      ...courtCase("published"),
      publicPreview: persistedPreview,
      publicViewerConsented: true,
    };
    const hidden = {
      ...published,
      publicStatus: "hidden",
      publicViewerConsented: false,
    };
    mocks.getCase
      .mockReturnValueOnce(staleRefresh)
      .mockResolvedValueOnce(hidden);
    mocks.withdrawPublicPost.mockResolvedValue(undefined);

    await act(async () => root.render(<PublicSharingPanel courtCase={published} />));
    act(() => window.dispatchEvent(new Event("focus")));
    act(() => button(container, "공개 철회").click());
    await act(async () => button(container, "공개 철회 확인").click());
    await settle();
    expect(container.textContent).toContain("공개를 철회한 사건이에요");

    await act(async () => resolveStaleRefresh?.(published));
    await settle();

    expect(container.textContent).toContain("공개를 철회한 사건이에요");
    expect(container.textContent).not.toContain("익명 판결이 공개되어 있어요");
  });

  it("allows only one consent-or-withdraw mutation to own the public state", async () => {
    let resolveConsent: ((value: string | undefined) => void) | undefined;
    mocks.setPublicConsent.mockReturnValue(new Promise((resolve) => {
      resolveConsent = resolve;
    }));
    mocks.getCase.mockResolvedValue({
      ...courtCase("awaiting_consents"),
      publicPreview: persistedPreview,
      publicViewerConsented: true,
    });
    const awaitingConsent = {
      ...courtCase("awaiting_consents"),
      publicPreview: persistedPreview,
      publicViewerConsented: false,
    };

    await act(async () => root.render(<PublicSharingPanel courtCase={awaitingConsent} />));
    act(() => button(container, "공개 후보 철회").click());
    const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    act(() => checkbox?.click());
    const consentButton = button(container, "내 공개 동의 저장");
    const withdrawButton = button(container, "철회 확인");
    await act(async () => {
      consentButton.click();
      withdrawButton.click();
      consentButton.click();
    });

    expect(mocks.setPublicConsent).toHaveBeenCalledTimes(1);
    expect(mocks.withdrawPublicPost).not.toHaveBeenCalled();

    await act(async () => resolveConsent?.("awaiting_consents"));
    await settle();
  });

  it("does not carry a late preview response into a different case", async () => {
    let resolvePreview: ((value: PublicSnapshotPreview) => void) | undefined;
    mocks.createPublicPreview.mockReturnValue(new Promise((resolve) => {
      resolvePreview = resolve;
    }));
    mocks.getCase.mockResolvedValue({
      ...courtCase("awaiting_consents"),
      publicPreview: persistedPreview,
      publicViewerConsented: false,
    });
    const firstCase = {
      ...courtCase(""),
      publicStatus: undefined,
      publicPostId: undefined,
    };
    const secondCase = {
      ...courtCase("hidden"),
      id: "case-2",
      publicPostId: "post-2",
      publicPreview: undefined,
      publicViewerConsented: false,
    };

    await act(async () => root.render(<PublicSharingPanel courtCase={firstCase} />));
    act(() => button(container, "공개 전용 미리보기 만들기").click());
    await act(async () => root.render(<PublicSharingPanel courtCase={secondCase} />));
    expect(container.textContent).toContain("공개를 철회한 사건이에요");

    await act(async () => resolvePreview?.(persistedPreview));
    await settle();

    expect(container.textContent).toContain("공개를 철회한 사건이에요");
    expect(container.textContent).not.toContain("익명 예산 사건");
  });

  it("does not let an old case request clear the new case loading state", async () => {
    let resolveFirstPreview: ((value: PublicSnapshotPreview) => void) | undefined;
    let resolveSecondPreview: ((value: PublicSnapshotPreview) => void) | undefined;
    mocks.createPublicPreview
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveFirstPreview = resolve;
      }))
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveSecondPreview = resolve;
      }));
    mocks.getCase.mockImplementation(async (caseId: string) => ({
      ...courtCase("awaiting_consents"),
      id: caseId,
      publicPostId: caseId === "case-1" ? "post-1" : "post-2",
      publicPreview: {
        ...persistedPreview,
        publicPostId: caseId === "case-1" ? "post-1" : "post-2",
      },
      publicViewerConsented: false,
    }));
    const firstCase = {
      ...courtCase(""),
      publicStatus: undefined,
      publicPostId: undefined,
    };
    const secondCase = {
      ...firstCase,
      id: "case-2",
    };

    await act(async () => root.render(<PublicSharingPanel courtCase={firstCase} />));
    act(() => button(container, "공개 전용 미리보기 만들기").click());
    await act(async () => root.render(<PublicSharingPanel courtCase={secondCase} />));
    act(() => button(container, "공개 전용 미리보기 만들기").click());
    expect(container.textContent).toContain("익명화 확인 중…");

    await act(async () => resolveFirstPreview?.(persistedPreview));
    await settle();

    expect(container.textContent).toContain("익명화 확인 중…");
    expect(mocks.createPublicPreview).toHaveBeenCalledTimes(2);

    await act(async () => resolveSecondPreview?.({
      ...persistedPreview,
      publicPostId: "post-2",
    }));
    await settle();
  });

  it("keeps a withdraw failure visible and announced in the published branch", async () => {
    mocks.withdrawPublicPost.mockRejectedValue(new Error("공개 철회 요청이 실패했어요."));
    await act(async () => root.render(<PublicSharingPanel courtCase={courtCase("published")} />));

    act(() => button(container, "공개 철회").click());
    await act(async () => button(container, "공개 철회 확인").click());
    await settle();

    const alert = container.querySelector<HTMLElement>(
      '[aria-live="polite"] [role="alert"]',
    );
    expect(alert?.textContent).toBe("공개 철회 요청이 실패했어요.");
    expect(alert?.closest('[aria-live="polite"]')).not.toBeNull();
    expect(container.textContent).toContain("익명 판결이 공개되어 있어요");
  });

  it("keeps success and retry errors visible after switching to the hidden branch", async () => {
    mocks.withdrawPublicPost.mockResolvedValue(undefined);
    await act(async () => root.render(<PublicSharingPanel courtCase={courtCase("published")} />));

    act(() => button(container, "공개 철회").click());
    await act(async () => button(container, "공개 철회 확인").click());
    await settle();

    const liveRegion = container.querySelector<HTMLElement>('[aria-live="polite"]');
    expect(container.textContent).toContain("공개를 철회한 사건이에요");
    expect(liveRegion?.textContent).toContain("공개를 철회했어요.");

    mocks.createPublicPreview.mockRejectedValue(new Error("미리보기를 다시 만들지 못했어요."));
    await act(async () => button(container, "새 미리보기 만들기").click());
    await settle();

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "미리보기를 다시 만들지 못했어요.",
    );
  });
});
