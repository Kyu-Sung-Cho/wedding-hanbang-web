import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CourtCase } from "../types";

const mocks = vi.hoisted(() => ({
  archiveCase: vi.fn(),
  cancelInvite: vi.fn(),
  captureCourtEvent: vi.fn(),
  createInvite: vi.fn(),
  deleteCase: vi.fn(),
  getCase: vi.fn(),
  leaveCase: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
  requestVerdict: vi.fn(),
  writeText: vi.fn(),
}));

vi.mock("../api", () => ({
  archiveCase: mocks.archiveCase,
  cancelInvite: mocks.cancelInvite,
  createInvite: mocks.createInvite,
  deleteCase: mocks.deleteCase,
  getCase: mocks.getCase,
  leaveCase: mocks.leaveCase,
  requestVerdict: mocks.requestVerdict,
}));

vi.mock("../analytics", () => ({
  captureCourtEvent: mocks.captureCourtEvent,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mocks.push,
    refresh: mocks.refresh,
    replace: mocks.replace,
  }),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, as }: { children: React.ReactNode; href: string; as?: string }) => (
    <a href={as ?? href}>{children}</a>
  ),
}));

import CaseDetail from "../CaseDetail";
import SoloUpgradeInvite from "../SoloUpgradeInvite";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const baseCase: CourtCase = {
  id: "case-1",
  title: "예산 확인 사건",
  category: "budget",
  mode: "couple",
  tone: "gentle",
  status: "awaiting_partner",
  viewerRole: "applicant",
  applicantStatementSubmitted: true,
  partnerJoined: false,
  partnerStatementSubmitted: false,
  canJudge: false,
  verdictReady: false,
  safetyLevel: "normal",
};

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function button(container: HTMLElement, label: string) {
  return Array.from(container.querySelectorAll("button"))
    .find((candidate) => candidate.textContent?.includes(label));
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("CaseDetail terminal states", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.cancelInvite.mockResolvedValue({ revoked: true, status: "revoked" });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: mocks.writeText },
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: undefined,
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
    document.body.replaceChildren();
    Reflect.deleteProperty(navigator, "clipboard");
    Reflect.deleteProperty(navigator, "share");
  });

  it("puts high-risk support first, hides progression, and preserves privacy deletion", async () => {
    mocks.getCase.mockResolvedValue({
      ...baseCase,
      mode: "solo",
      status: "verdict_ready",
      verdictReady: true,
      safetyLevel: "high_risk",
    });

    await act(async () => root.render(<CaseDetail caseId="case-1" />));
    await settle();

    const content = container.textContent ?? "";
    expect(content).toContain("재미있는 판결보다 안전 확인이 먼저예요");
    expect(content).toContain("안전하게 사건 목록으로 돌아가기");
    expect(content.indexOf("재미있는 판결보다 안전 확인이 먼저예요"))
      .toBeLessThan(content.indexOf("중재보다 지금의 안전을 먼저 확인해 주세요"));
    expect(container.textContent).not.toContain("판결 확인하기");
    expect(container.textContent).not.toContain("상대방을 초대해 정식 판결로 전환");
    expect(container.textContent).not.toContain("사건 보관");
    expect(container.textContent).toContain("영구 삭제 시작");
    expect(content.indexOf("재미있는 판결보다 안전 확인이 먼저예요"))
      .toBeLessThan(content.indexOf("사건과 비공개 기록을 영구 삭제"));
    expect(container.querySelectorAll("button")).toHaveLength(1);
    expect(mocks.createInvite).not.toHaveBeenCalled();
    expect(mocks.requestVerdict).not.toHaveBeenCalled();
  });

  it("renders an archived deep link as read-only while preserving privacy deletion", async () => {
    mocks.getCase.mockResolvedValue({
      ...baseCase,
      status: "archived",
      applicantStatementSubmitted: false,
      updatedAt: "2026-07-14T01:00:00.000Z",
    });

    await act(async () => root.render(<CaseDetail caseId="case-1" />));
    await settle();

    expect(container.textContent).toContain("보관된 사건 기록이에요");
    expect(container.textContent).toContain("내 사건 목록으로 돌아가기");
    expect(container.textContent).not.toContain("진술 작성하기");
    expect(container.textContent).not.toContain("한방 판결 요청하기");
    expect(container.textContent).not.toContain("사건 보관");
    expect(container.textContent).toContain("영구 삭제 시작");
    expect(container.querySelectorAll("button")).toHaveLength(1);
    expect(container.querySelectorAll("a")).toHaveLength(1);
  });

  it("permanently deletes an eligible archived case only after typed confirmation", async () => {
    mocks.getCase.mockResolvedValue({
      ...baseCase,
      status: "archived",
      applicantStatementSubmitted: false,
    });
    mocks.deleteCase.mockResolvedValue(undefined);

    await act(async () => root.render(<CaseDetail caseId="case-1" />));
    await settle();
    await act(async () => button(container, "영구 삭제 시작")?.click());
    const confirmation = container.querySelector<HTMLInputElement>("#court-delete-confirmation");
    expect(document.activeElement).toBe(confirmation);
    expect(button(container, "확인하고 영구 삭제")?.disabled).toBe(true);
    await act(async () => {
      if (confirmation) setInputValue(confirmation, "영구삭제");
    });
    await act(async () => button(container, "확인하고 영구 삭제")?.click());
    await settle();

    expect(mocks.deleteCase).toHaveBeenCalledWith("case-1", "영구삭제");
    expect(mocks.replace).toHaveBeenCalled();
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("explains the joint-record policy instead of offering unilateral deletion", async () => {
    mocks.getCase.mockResolvedValue({
      ...baseCase,
      status: "archived",
      partnerJoined: true,
      partnerStatementSubmitted: true,
    });

    await act(async () => root.render(<CaseDetail caseId="case-1" />));
    await settle();

    expect(container.textContent).toContain("상대방 진술이 포함된 공동 기록");
    expect(container.textContent).not.toContain("영구 삭제 시작");
    expect(mocks.deleteCase).not.toHaveBeenCalled();
  });

  it("shows the issued URL and selects it when clipboard copy is blocked", async () => {
    const inviteUrl = "https://example.com/wedding/couple-court/invite#secret-token";
    mocks.getCase
      .mockResolvedValueOnce(baseCase)
      .mockResolvedValueOnce({
        ...baseCase,
        inviteExpiresAt: "2026-07-15T01:00:00.000Z",
      });
    mocks.createInvite.mockResolvedValue({ inviteUrl, expiresAt: "2026-07-15T01:00:00.000Z" });
    mocks.writeText.mockRejectedValue(new Error("clipboard denied"));

    await act(async () => root.render(<CaseDetail caseId="case-1" />));
    await settle();
    const issueButton = button(container, "초대 링크 만들기");
    expect(issueButton).toBeDefined();
    await act(async () => issueButton?.click());
    await settle();

    const field = container.querySelector<HTMLTextAreaElement>("#court-invite-url");
    expect(field).not.toBeNull();
    expect(field?.readOnly).toBe(true);
    expect(field?.value).toBe(inviteUrl);

    const copyButton = button(container, "링크 복사");
    expect(copyButton).toBeDefined();
    await act(async () => copyButton?.click());
    await settle();

    expect(document.activeElement).toBe(field);
    expect(field?.selectionStart).toBe(0);
    expect(field?.selectionEnd).toBe(inviteUrl.length);
    expect(container.textContent).toContain("자동 복사가 차단됐어요");
  });

  it("shows the accepted state without offering another invite", async () => {
    mocks.getCase.mockResolvedValue({
      ...baseCase,
      status: "awaiting_partner_statement",
      partnerJoined: true,
      inviteExpiresAt: undefined,
    });

    await act(async () => root.render(<CaseDetail caseId="case-1" />));
    await settle();

    expect(container.textContent).toContain("상대방이 초대를 수락했어요");
    expect(container.textContent).toContain("상대방 진술을 기다리고 있어요");
    expect(container.textContent).not.toContain("초대 링크 만들기");
    expect(container.textContent).not.toContain("새 링크 발급");
    expect(mocks.createInvite).not.toHaveBeenCalled();
  });

  it("refreshes the waiting state when the applicant returns to the tab", async () => {
    mocks.getCase
      .mockResolvedValueOnce(baseCase)
      .mockResolvedValueOnce({
        ...baseCase,
        inviteExpiresAt: "2099-07-15T01:00:00.000Z",
      })
      .mockResolvedValueOnce({
        ...baseCase,
        status: "awaiting_partner_statement",
        partnerJoined: true,
        inviteExpiresAt: undefined,
      });
    mocks.createInvite.mockResolvedValue({
      inviteUrl: "https://example.com/wedding/couple-court/invite#now-stale",
      expiresAt: "2099-07-15T01:00:00.000Z",
    });

    await act(async () => root.render(<CaseDetail caseId="case-1" />));
    await settle();
    await act(async () => button(container, "초대 링크 만들기")?.click());
    await settle();
    expect(container.querySelector("#court-invite-url")).not.toBeNull();

    await act(async () => window.dispatchEvent(new Event("focus")));
    await settle();

    expect(mocks.getCase).toHaveBeenCalledTimes(3);
    expect(container.textContent).toContain("상대방이 초대를 수락했어요");
    expect(container.textContent).not.toContain("초대 링크 만들기");
    expect(container.querySelector("#court-invite-url")).toBeNull();
  });

  it("requires explicit confirmation before replacing a restored invite", async () => {
    const replacement = {
      inviteUrl: "https://example.com/wedding/couple-court/invite#replacement",
      expiresAt: "2099-07-16T01:00:00.000Z",
    };
    mocks.getCase
      .mockResolvedValueOnce({
        ...baseCase,
        inviteExpiresAt: "2099-07-15T01:00:00.000Z",
      })
      .mockResolvedValueOnce({ ...baseCase, inviteExpiresAt: replacement.expiresAt });
    mocks.createInvite.mockResolvedValue(replacement);

    await act(async () => root.render(<CaseDetail caseId="case-1" />));
    await settle();
    await act(async () => button(container, "새 링크 재발급")?.click());

    expect(mocks.createInvite).not.toHaveBeenCalled();
    expect(container.textContent).toContain("기존 링크는 즉시 무효가 돼요");
    await act(async () => button(container, "기존 링크 무효화 후 재발급")?.click());
    await settle();

    expect(mocks.createInvite).toHaveBeenCalledTimes(1);
    expect(container.querySelector<HTMLTextAreaElement>("#court-invite-url")?.value)
      .toBe(replacement.inviteUrl);
  });

  it("does not claim cancellation when the invite was accepted concurrently", async () => {
    mocks.getCase
      .mockResolvedValueOnce({
        ...baseCase,
        inviteExpiresAt: "2099-07-15T01:00:00.000Z",
      })
      .mockResolvedValueOnce({
        ...baseCase,
        status: "awaiting_partner_statement",
        partnerJoined: true,
        inviteExpiresAt: undefined,
      });
    mocks.cancelInvite.mockResolvedValue({
      revoked: false,
      status: "no_active_invite",
    });

    await act(async () => root.render(<CaseDetail caseId="case-1" />));
    await settle();
    await act(async () => button(container, "기존 링크 취소")?.click());
    await settle();

    expect(container.textContent).toContain("상대방이 초대를 수락했어요");
    expect(container.textContent).not.toContain("초대 링크를 취소했고");
    expect(container.textContent).not.toContain("기존 링크로는 참여할 수 없어요");
  });

  it("recovers an active invite when the create acknowledgement is lost", async () => {
    mocks.getCase
      .mockResolvedValueOnce(baseCase)
      .mockResolvedValueOnce({
        ...baseCase,
        inviteExpiresAt: "2099-07-15T01:00:00.000Z",
      });
    mocks.createInvite.mockRejectedValue(new Error("응답 유실"));

    await act(async () => root.render(<CaseDetail caseId="case-1" />));
    await settle();
    await act(async () => button(container, "초대 링크 만들기")?.click());
    await settle();

    expect(container.textContent).toContain("서버에서 활성 초대를 확인했어요");
    expect(container.textContent).toContain("기존 초대 링크가 아직 유효해요");
    expect(container.textContent).not.toContain("응답 유실");
  });
});

describe("SoloUpgradeInvite manual copy", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.cancelInvite.mockResolvedValue({ revoked: true, status: "revoked" });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: mocks.writeText },
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: undefined,
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
    document.body.replaceChildren();
    Reflect.deleteProperty(navigator, "clipboard");
    Reflect.deleteProperty(navigator, "share");
  });

  it("keeps a read-only URL visible and selectable without clipboard permission", async () => {
    const inviteUrl = "https://example.com/wedding/couple-court/invite#solo-secret";
    mocks.createInvite.mockResolvedValue({ inviteUrl });
    mocks.writeText.mockRejectedValue(new Error("clipboard denied"));

    await act(async () => root.render(<SoloUpgradeInvite caseId="case-1" />));
    const issueButton = button(container, "정식 판결 초대 만들기");
    expect(issueButton).toBeDefined();
    await act(async () => issueButton?.click());
    await settle();

    const field = container.querySelector<HTMLTextAreaElement>("#solo-upgrade-invite-url");
    expect(field?.value).toBe(inviteUrl);
    expect(field?.readOnly).toBe(true);

    const copyButton = button(container, "링크 복사");
    expect(copyButton).toBeDefined();
    await act(async () => copyButton?.click());
    await settle();

    expect(document.activeElement).toBe(field);
    expect(field?.selectionStart).toBe(0);
    expect(field?.selectionEnd).toBe(inviteUrl.length);
    expect(container.textContent).toContain("자동 복사가 차단됐어요");
  });

  it("restores an active invite after reload without exposing or replacing its token", async () => {
    await act(async () => root.render(
      <SoloUpgradeInvite caseId="case-1" inviteExpiresAt="2099-07-15T01:00:00.000Z" />,
    ));

    expect(container.textContent).toContain("기존 초대 링크가 아직 유효해요");
    expect(container.textContent).toContain("보안상 링크 주소는 다시 표시하지 않아요");
    expect(container.querySelector("#solo-upgrade-invite-url")).toBeNull();
    expect(button(container, "기존 링크 취소")).toBeDefined();
    expect(button(container, "새 링크 재발급")).toBeDefined();
    expect(button(container, "정식 판결 초대 만들기")).toBeUndefined();
    expect(mocks.createInvite).not.toHaveBeenCalled();
  });

  it("warns before reissuing and collapses duplicate confirmation clicks", async () => {
    let resolveInvite: ((value: { inviteUrl: string; expiresAt: string }) => void) | undefined;
    mocks.createInvite.mockImplementation(() => new Promise((resolve) => {
      resolveInvite = resolve;
    }));

    await act(async () => root.render(
      <SoloUpgradeInvite caseId="case-1" inviteExpiresAt="2099-07-15T01:00:00.000Z" />,
    ));
    await act(async () => button(container, "새 링크 재발급")?.click());

    expect(mocks.createInvite).not.toHaveBeenCalled();
    expect(container.textContent).toContain("기존 링크는 즉시 무효가 돼요");
    const confirmButton = button(container, "기존 링크 무효화 후 재발급");
    expect(confirmButton).toBeDefined();

    await act(async () => {
      confirmButton?.click();
      confirmButton?.click();
    });
    expect(mocks.createInvite).toHaveBeenCalledTimes(1);

    await act(async () => resolveInvite?.({
      inviteUrl: "https://example.com/wedding/couple-court/invite#replacement",
      expiresAt: "2099-07-16T01:00:00.000Z",
    }));
    await settle();
  });

  it("collapses duplicate first-issue clicks before React disables the button", async () => {
    let resolveInvite: ((value: { inviteUrl: string; expiresAt: string }) => void) | undefined;
    mocks.createInvite.mockImplementation(() => new Promise((resolve) => {
      resolveInvite = resolve;
    }));

    await act(async () => root.render(<SoloUpgradeInvite caseId="case-1" />));
    const issueButton = button(container, "정식 판결 초대 만들기");
    await act(async () => {
      issueButton?.click();
      issueButton?.click();
    });

    expect(mocks.createInvite).toHaveBeenCalledTimes(1);
    await act(async () => resolveInvite?.({
      inviteUrl: "https://example.com/wedding/couple-court/invite#one-request",
      expiresAt: "2099-07-16T01:00:00.000Z",
    }));
    await settle();
  });

  it("reconciles an issued invite when the create response acknowledgement is lost", async () => {
    mocks.createInvite.mockRejectedValue(new Error("network acknowledgement lost"));
    mocks.getCase.mockResolvedValue({
      ...baseCase,
      mode: "solo",
      status: "verdict_ready",
      verdictReady: true,
      inviteExpiresAt: "2099-07-15T01:00:00.000Z",
    });

    await act(async () => root.render(<SoloUpgradeInvite caseId="case-1" />));
    await act(async () => button(container, "정식 판결 초대 만들기")?.click());
    await settle();

    expect(mocks.getCase).toHaveBeenCalledWith("case-1");
    expect(container.textContent).toContain("서버에서 활성 초대를 확인했어요");
    expect(container.textContent).toContain("기존 초대 링크가 아직 유효해요");
    expect(container.textContent).not.toContain("network acknowledgement lost");
  });

  it("reconciles a cancelled invite when the cancel acknowledgement is lost", async () => {
    mocks.cancelInvite.mockRejectedValue(new Error("network acknowledgement lost"));
    mocks.getCase.mockResolvedValue({
      ...baseCase,
      mode: "solo",
      status: "verdict_ready",
      verdictReady: true,
      inviteExpiresAt: undefined,
    });

    await act(async () => root.render(
      <SoloUpgradeInvite caseId="case-1" inviteExpiresAt="2099-07-15T01:00:00.000Z" />,
    ));
    await act(async () => button(container, "기존 링크 취소")?.click());
    await settle();

    expect(mocks.getCase).toHaveBeenCalledWith("case-1");
    expect(container.textContent).toContain("초대가 취소된 상태를 서버에서 확인했어요");
    expect(button(container, "새 초대 링크 만들기")).toBeDefined();
    expect(container.textContent).not.toContain("network acknowledgement lost");
  });

  it("keeps the invite active when cancellation cannot be confirmed", async () => {
    mocks.cancelInvite.mockRejectedValue(new Error("취소 요청을 확인하지 못했어요."));
    mocks.getCase.mockResolvedValue({
      ...baseCase,
      mode: "solo",
      status: "verdict_ready",
      verdictReady: true,
      inviteExpiresAt: "2099-07-15T01:00:00.000Z",
    });

    await act(async () => root.render(
      <SoloUpgradeInvite caseId="case-1" inviteExpiresAt="2099-07-15T01:00:00.000Z" />,
    ));
    await act(async () => button(container, "기존 링크 취소")?.click());
    await settle();

    expect(container.textContent).toContain("기존 초대 링크가 아직 유효해요");
    expect(container.textContent).toContain("취소 요청을 확인하지 못했어요.");
    expect(container.textContent).not.toContain("초대 링크가 취소됐어요");
  });

  it("treats an expired invite as inactive and offers a fresh issue", async () => {
    await act(async () => root.render(
      <SoloUpgradeInvite caseId="case-1" inviteExpiresAt="2000-01-01T00:00:00.000Z" />,
    ));

    expect(container.textContent).toContain("기존 초대 링크가 만료됐어요");
    expect(button(container, "새 초대 링크 만들기")).toBeDefined();
    expect(button(container, "기존 링크 취소")).toBeUndefined();
    expect(button(container, "새 링크 재발급")).toBeUndefined();
  });

  it("updates an open invite screen at the exact expiry boundary", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-14T03:00:00.000Z"));

    await act(async () => root.render(
      <SoloUpgradeInvite caseId="case-1" inviteExpiresAt="2026-07-14T03:00:01.000Z" />,
    ));
    expect(container.textContent).toContain("기존 초대 링크가 아직 유효해요");

    await act(async () => vi.advanceTimersByTime(1_050));

    expect(container.textContent).toContain("기존 초대 링크가 만료됐어요");
    expect(button(container, "새 초대 링크 만들기")).toBeDefined();
  });

  it("detects invite acceptance when the user returns to the open tab", async () => {
    mocks.getCase.mockResolvedValue({
      ...baseCase,
      mode: "couple",
      status: "awaiting_partner_statement",
      partnerJoined: true,
      verdictReady: true,
    });

    await act(async () => root.render(
      <SoloUpgradeInvite caseId="case-1" inviteExpiresAt="2099-07-15T01:00:00.000Z" />,
    ));
    await act(async () => window.dispatchEvent(new Event("focus")));
    await settle();

    expect(mocks.getCase).toHaveBeenCalledWith("case-1");
    expect(container.textContent).toContain("상대방이 초대를 수락했어요");
    expect(container.textContent).not.toContain("기존 초대 링크가 아직 유효해요");
  });

  it("does not claim cancellation when a solo upgrade was accepted concurrently", async () => {
    mocks.cancelInvite.mockResolvedValue({
      revoked: false,
      status: "no_active_invite",
    });
    mocks.getCase.mockResolvedValue({
      ...baseCase,
      mode: "couple",
      status: "awaiting_partner_statement",
      partnerJoined: true,
      verdictReady: true,
    });

    await act(async () => root.render(
      <SoloUpgradeInvite caseId="case-1" inviteExpiresAt="2099-07-15T01:00:00.000Z" />,
    ));
    await act(async () => button(container, "기존 링크 취소")?.click());
    await settle();

    expect(container.textContent).toContain("상대방이 초대를 수락했어요");
    expect(container.textContent).not.toContain("초대 링크가 취소됐어요");
  });
});
