import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StatementForm, { parseStoredStatementDraft } from "../StatementForm";
import { courtStatementDraftKey, readScopedCourtDraft, writeScopedCourtDraft } from "../draftStorage";
import type { CourtCase } from "../types";

const mocks = vi.hoisted(() => ({
  getCase: vi.fn(),
  submitStatement: vi.fn(),
  push: vi.fn(),
  back: vi.fn(),
  captureCourtEvent: vi.fn(),
}));

vi.mock("../api", () => ({
  getCase: mocks.getCase,
  submitStatement: mocks.submitStatement,
}));

vi.mock("../analytics", () => ({
  captureCourtEvent: mocks.captureCourtEvent,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, back: mocks.back }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CASE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SECOND_CASE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab";
const OWNER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FALLBACK_REQUEST_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SAVED_REQUEST_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const originalSessionStorage = window.sessionStorage;

const validStoredDraft = {
  facts: "",
  feelings: "",
  expectations: "",
  attempts: "",
  desiredAgreement: "",
};

const submittedDraft = {
  facts: "x".repeat(80),
  feelings: "x".repeat(80),
  expectations: "x".repeat(80),
  attempts: "x".repeat(80),
  desiredAgreement: "x".repeat(80),
};

function courtCase(): CourtCase {
  return {
    id: CASE_ID,
    title: "Test case",
    category: "budget",
    mode: "solo",
    tone: "gentle",
    status: "awaiting_applicant_statement",
    viewerRole: "applicant",
    applicantStatementSubmitted: false,
    partnerJoined: false,
    partnerStatementSubmitted: false,
    canJudge: false,
    verdictReady: false,
  };
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function setTextareaValue(textarea: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  setter?.call(textarea, value);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

async function fillValidDraftAndOpenPreview(container: HTMLDivElement): Promise<void> {
  const textareas = Array.from(container.querySelectorAll<HTMLTextAreaElement>("textarea"));
  expect(textareas).toHaveLength(5);
  await act(async () => {
    for (const textarea of textareas) setTextareaValue(textarea, "x".repeat(80));
  });
  await act(async () => {
    container.querySelector<HTMLFormElement>("form")?.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
}

describe("StatementForm submission safety", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      value: originalSessionStorage,
    });
    originalSessionStorage.clear();
    mocks.getCase.mockReset().mockResolvedValue(courtCase());
    mocks.submitStatement.mockReset().mockResolvedValue({ safety: null });
    mocks.push.mockReset();
    mocks.back.mockReset();
    mocks.captureCourtEvent.mockReset();
    vi.spyOn(window.crypto, "randomUUID").mockReturnValue(FALLBACK_REQUEST_ID);
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({ matches: true })),
    });
    Object.defineProperty(window, "scrollTo", {
      configurable: true,
      value: vi.fn(),
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      value: originalSessionStorage,
    });
    vi.restoreAllMocks();
  });

  it("submits a valid random UUID when session storage reads and writes throw", async () => {
    const unavailableStorage: Storage = {
      length: 0,
      clear: vi.fn(),
      getItem: vi.fn(() => { throw new Error("blocked read"); }),
      key: vi.fn(() => null),
      removeItem: vi.fn(),
      setItem: vi.fn(() => { throw new Error("blocked write"); }),
    };
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      value: unavailableStorage,
    });

    await act(async () => root.render(
      <StatementForm caseId={CASE_ID} draftOwnerId={OWNER_ID} />,
    ));
    await settle();
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 550));
    });
    expect(unavailableStorage.setItem).toHaveBeenCalled();
    await fillValidDraftAndOpenPreview(container);

    const confirmation = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(confirmation).not.toBeNull();
    await act(async () => confirmation?.click());
    const buttons = container.querySelectorAll<HTMLButtonElement>("button");
    await act(async () => buttons.item(buttons.length - 1).click());
    await settle();

    expect(unavailableStorage.getItem).toHaveBeenCalled();
    expect(mocks.submitStatement).toHaveBeenCalledWith(
      CASE_ID,
      expect.objectContaining({ submissionRequestId: FALLBACK_REQUEST_ID }),
    );
    expect(mocks.submitStatement.mock.calls[0]?.[1]).not.toHaveProperty("safetyLevel");
    expect(FALLBACK_REQUEST_ID).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it.each([
    ["ignores a malformed saved request ID", "not-a-uuid", FALLBACK_REQUEST_ID],
    ["reuses a valid saved request ID", SAVED_REQUEST_ID, SAVED_REQUEST_ID],
  ])("%s", async (_name, savedRequestId, expectedRequestId) => {
    writeScopedCourtDraft(
      window.sessionStorage,
      courtStatementDraftKey(OWNER_ID, CASE_ID, false),
      OWNER_ID,
      { draft: validStoredDraft, submissionRequestId: savedRequestId },
    );

    await act(async () => root.render(
      <StatementForm caseId={CASE_ID} draftOwnerId={OWNER_ID} />,
    ));
    await settle();
    await fillValidDraftAndOpenPreview(container);
    const confirmation = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    await act(async () => confirmation?.click());
    const buttons = container.querySelectorAll<HTMLButtonElement>("button");
    await act(async () => buttons.item(buttons.length - 1).click());
    await settle();

    expect(mocks.submitStatement).toHaveBeenCalledWith(
      CASE_ID,
      expect.objectContaining({ submissionRequestId: expectedRequestId }),
    );
  });

  it("rejects malformed field types and overlong values before rendering", () => {
    expect(parseStoredStatementDraft({
      draft: { ...validStoredDraft, facts: 123 },
    })).toBeNull();
    expect(parseStoredStatementDraft({
      draft: { ...validStoredDraft, feelings: "x".repeat(801) },
    })).toBeNull();
    expect(parseStoredStatementDraft({
      draft: validStoredDraft,
      safetyConcern: "yes",
    })).toBeNull();
  });

  it("discards a malformed revision draft and restores the immutable submitted statement", async () => {
    const ownStatement = {
      facts: "서버에 보관된 기존 사실 진술",
      feelings: "서버에 보관된 기존 감정 진술",
      expectations: "서버에 보관된 기존 기대 진술",
      attempts: "서버에 보관된 기존 시도 진술",
      desiredAgreement: "서버에 보관된 기존 합의 진술",
    };
    mocks.getCase.mockResolvedValue({
      ...courtCase(),
      status: "verdict_ready",
      applicantStatementSubmitted: true,
      verdictReady: true,
      ownStatement,
    });
    const key = courtStatementDraftKey(OWNER_ID, CASE_ID, true);
    writeScopedCourtDraft(window.sessionStorage, key, OWNER_ID, {
      draft: { ...validStoredDraft, facts: { corrupted: true } },
      submissionRequestId: SAVED_REQUEST_ID,
    });

    await act(async () => root.render(
      <StatementForm caseId={CASE_ID} draftOwnerId={OWNER_ID} revisionMode />,
    ));
    await settle();

    const textareas = Array.from(container.querySelectorAll<HTMLTextAreaElement>("textarea"));
    expect(textareas.map((textarea) => textarea.value)).toEqual(Object.values(ownStatement));
    expect(window.sessionStorage.getItem(key)).toBeNull();
  });

  it("requires confirmation again after returning from the preview to edit", async () => {
    await act(async () => root.render(
      <StatementForm caseId={CASE_ID} draftOwnerId={OWNER_ID} />,
    ));
    await settle();
    await fillValidDraftAndOpenPreview(container);
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 20));
    });

    expect(document.activeElement).toBe(container.querySelector("h1"));

    let confirmation = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(confirmation?.checked).toBe(false);
    await act(async () => confirmation?.click());
    expect(confirmation?.checked).toBe(true);

    let buttons = container.querySelectorAll<HTMLButtonElement>("button");
    await act(async () => buttons.item(0).click());
    expect(container.querySelector("form")).not.toBeNull();

    await act(async () => {
      container.querySelector<HTMLFormElement>("form")?.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });

    confirmation = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    buttons = container.querySelectorAll<HTMLButtonElement>("button");
    expect(confirmation?.checked).toBe(false);
    expect(buttons.item(buttons.length - 1).disabled).toBe(true);
  });

  it("requires confirmation again after statement or safety edits", async () => {
    await act(async () => root.render(
      <StatementForm caseId={CASE_ID} draftOwnerId={OWNER_ID} />,
    ));
    await settle();
    await fillValidDraftAndOpenPreview(container);

    let confirmation = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    await act(async () => confirmation?.click());
    let buttons = container.querySelectorAll<HTMLButtonElement>("button");
    await act(async () => buttons.item(1).click());

    const firstTextarea = container.querySelector<HTMLTextAreaElement>("textarea");
    await act(async () => {
      if (firstTextarea) setTextareaValue(firstTextarea, "y".repeat(80));
    });
    await act(async () => {
      container.querySelector<HTMLFormElement>("form")?.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    confirmation = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(confirmation?.checked).toBe(false);

    await act(async () => confirmation?.click());
    buttons = container.querySelectorAll<HTMLButtonElement>("button");
    await act(async () => buttons.item(1).click());
    const safetyCheckbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    await act(async () => safetyCheckbox?.click());
    await act(async () => {
      container.querySelector<HTMLFormElement>("form")?.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });

    confirmation = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(confirmation?.checked).toBe(false);
  });

  it("restores a saved safety concern and submits it as high risk", async () => {
    await act(async () => root.render(
      <StatementForm caseId={CASE_ID} draftOwnerId={OWNER_ID} />,
    ));
    await settle();

    let safetyCheckbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(safetyCheckbox?.checked).toBe(false);
    await act(async () => safetyCheckbox?.click());
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 550));
    });

    act(() => root.unmount());
    root = createRoot(container);
    await act(async () => root.render(
      <StatementForm caseId={CASE_ID} draftOwnerId={OWNER_ID} />,
    ));
    await settle();

    safetyCheckbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(safetyCheckbox?.checked).toBe(true);
    await fillValidDraftAndOpenPreview(container);
    const confirmation = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    await act(async () => confirmation?.click());
    const buttons = container.querySelectorAll<HTMLButtonElement>("button");
    await act(async () => buttons.item(buttons.length - 1).click());
    await settle();

    expect(mocks.submitStatement).toHaveBeenCalledWith(
      CASE_ID,
      expect.objectContaining({ safetyLevel: "high_risk" }),
    );
    expect(window.sessionStorage.getItem(
      courtStatementDraftKey(OWNER_ID, CASE_ID, false),
    )).toBeNull();
  });

  it("shows the server high-risk response immediately instead of navigating into the normal flow", async () => {
    mocks.submitStatement.mockResolvedValue({
      safety: {
        level: "high_risk",
        categories: ["violence"],
        requiresImmediateHelp: true,
        resourceMessage: "지금 안전한 장소에서 믿을 수 있는 사람에게 도움을 요청해 주세요.",
      },
    });
    await act(async () => root.render(
      <StatementForm caseId={CASE_ID} draftOwnerId={OWNER_ID} />,
    ));
    await settle();
    const safetyCheckbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    await act(async () => safetyCheckbox?.click());
    await fillValidDraftAndOpenPreview(container);
    const confirmation = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    await act(async () => confirmation?.click());
    const buttons = container.querySelectorAll<HTMLButtonElement>("button");
    await act(async () => buttons.item(buttons.length - 1).click());
    await settle();

    expect(mocks.push).not.toHaveBeenCalled();
    expect(container.textContent).toContain("재미있는 판결보다 안전 확인이 먼저예요");
    expect(container.textContent).toContain("지금 안전한 장소에서 믿을 수 있는 사람에게 도움을 요청해 주세요.");
    expect(container.querySelector(`a[href$="/couple-court/cases/${CASE_ID}"]`)).not.toBeNull();
  });

  it("shows safety resources instead of a form on a high-risk deep link", async () => {
    mocks.getCase.mockResolvedValue({
      ...courtCase(),
      safetyLevel: "high_risk",
      status: "verdict_ready",
      applicantStatementSubmitted: true,
      verdictReady: true,
    });

    await act(async () => root.render(
      <StatementForm caseId={CASE_ID} draftOwnerId={OWNER_ID} revisionMode />,
    ));
    await settle();

    expect(container.textContent).toContain("재미있는 판결보다 안전 확인이 먼저예요");
    expect(container.textContent).toContain("진술 보완이나 재심보다 안전 확인을 먼저");
    expect(container.querySelector('a[href="tel:112"]')).not.toBeNull();
    expect(container.querySelector("form")).toBeNull();
    expect(container.textContent).not.toContain("다시 시도");
  });

  it("renders an archived statement deep link as read-only without a form", async () => {
    mocks.getCase.mockResolvedValue({
      ...courtCase(),
      status: "archived",
      applicantStatementSubmitted: true,
      verdictReady: true,
      ownStatement: {
        facts: "보관된 기존 사실 진술",
        feelings: "보관된 기존 감정 진술",
        expectations: "보관된 기존 기대 진술",
        attempts: "보관된 기존 시도 진술",
        desiredAgreement: "보관된 기존 합의 진술",
      },
    });

    await act(async () => root.render(
      <StatementForm caseId={CASE_ID} draftOwnerId={OWNER_ID} revisionMode />,
    ));
    await settle();

    expect(container.textContent).toContain("보관된 사건은 읽기 전용이에요");
    expect(container.querySelector(`a[href$="/couple-court/cases/${CASE_ID}"]`)).not.toBeNull();
    expect(container.querySelector(`a[href$="/couple-court/cases/${CASE_ID}/verdict"]`)).not.toBeNull();
    expect(container.querySelector("form")).toBeNull();
    expect(container.textContent).not.toContain("새 진술 제출하기");
    expect(container.textContent).not.toContain("다시 시도");
    expect(mocks.submitStatement).not.toHaveBeenCalled();
  });

  it("records a server-detected safety redirect without relying on the checkbox", async () => {
    mocks.submitStatement.mockResolvedValue({
      safety: {
        level: "high_risk",
        categories: ["coercion"],
        requiresImmediateHelp: false,
        resourceMessage: "안전을 먼저 확인해 주세요.",
      },
    });
    await act(async () => root.render(
      <StatementForm caseId={CASE_ID} draftOwnerId={OWNER_ID} />,
    ));
    await settle();
    await fillValidDraftAndOpenPreview(container);
    const confirmation = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    await act(async () => confirmation?.click());
    const buttons = container.querySelectorAll<HTMLButtonElement>("button");
    await act(async () => buttons.item(buttons.length - 1).click());
    await settle();

    expect(mocks.captureCourtEvent).toHaveBeenCalledWith(
      "couple_court_safety_redirect",
      expect.objectContaining({ status: "statement" }),
    );
    expect(container.textContent).toContain("재미있는 판결보다 안전 확인이 먼저예요");
  });

  it("does not autosave an empty revision while the existing statement is still loading", async () => {
    let resolveCase!: (value: CourtCase) => void;
    mocks.getCase.mockReturnValue(new Promise<CourtCase>((resolve) => {
      resolveCase = resolve;
    }));
    const storageKey = courtStatementDraftKey(OWNER_ID, CASE_ID, true);
    await act(async () => root.render(
      <StatementForm caseId={CASE_ID} draftOwnerId={OWNER_ID} revisionMode />,
    ));
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 550));
    });
    expect(window.sessionStorage.getItem(storageKey)).toBeNull();

    await act(async () => resolveCase({
      ...courtCase(),
      status: "verdict_ready",
      applicantStatementSubmitted: true,
      verdictReady: true,
      ownStatement: {
        facts: "기존 사실 진술",
        feelings: "기존 감정 진술",
        expectations: "기존 기대 진술",
        attempts: "기존 시도 진술",
        desiredAgreement: "기존 합의 진술",
      },
    }));
    await settle();
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 550));
    });
    const saved = readScopedCourtDraft<{ draft?: { facts?: string } }>(
      window.sessionStorage,
      storageKey,
      OWNER_ID,
    );
    expect(saved?.draft?.facts).toBe("기존 사실 진술");
  });

  it("recovers an exact committed submission after a lost response and page remount", async () => {
    const storageKey = courtStatementDraftKey(OWNER_ID, CASE_ID, false);
    writeScopedCourtDraft(window.sessionStorage, storageKey, OWNER_ID, {
      draft: submittedDraft,
      submissionRequestId: SAVED_REQUEST_ID,
      safetyConcern: false,
    });
    mocks.getCase.mockResolvedValue({
      ...courtCase(),
      status: "statements_complete",
      applicantStatementSubmitted: true,
      canJudge: true,
      ownStatement: {
        ...submittedDraft,
        submissionRequestId: SAVED_REQUEST_ID,
        safetyLevel: "normal",
      },
    });

    await act(async () => root.render(
      <StatementForm caseId={CASE_ID} draftOwnerId={OWNER_ID} />,
    ));
    await settle();

    expect(mocks.submitStatement).not.toHaveBeenCalled();
    expect(mocks.push).toHaveBeenCalledWith(
      expect.stringContaining(`/couple-court/cases/${CASE_ID}`),
    );
    expect(window.sessionStorage.getItem(storageKey)).toBeNull();
  });

  it("recovers a committed statement when the submit acknowledgement is lost", async () => {
    mocks.submitStatement.mockRejectedValue(new Error("응답을 확인하지 못했어요."));
    mocks.getCase
      .mockResolvedValueOnce(courtCase())
      .mockResolvedValueOnce({
        ...courtCase(),
        status: "statements_complete",
        applicantStatementSubmitted: true,
        canJudge: true,
        ownStatement: {
          ...submittedDraft,
          submissionRequestId: FALLBACK_REQUEST_ID,
          safetyLevel: "normal",
        },
      });

    await act(async () => root.render(
      <StatementForm caseId={CASE_ID} draftOwnerId={OWNER_ID} />,
    ));
    await settle();
    await fillValidDraftAndOpenPreview(container);
    const confirmation = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    await act(async () => confirmation?.click());
    const buttons = container.querySelectorAll<HTMLButtonElement>("button");
    await act(async () => buttons.item(buttons.length - 1).click());
    await settle();

    expect(mocks.getCase).toHaveBeenCalledTimes(2);
    expect(mocks.push).toHaveBeenCalledWith(
      expect.stringContaining(`/couple-court/cases/${CASE_ID}`),
    );
    expect(container.textContent).not.toContain("응답을 확인하지 못했어요");
  });

  it("rotates the idempotency key after editing an uncertain submission", async () => {
    vi.mocked(window.crypto.randomUUID)
      .mockReturnValueOnce(FALLBACK_REQUEST_ID)
      .mockReturnValueOnce(SAVED_REQUEST_ID);
    mocks.submitStatement.mockRejectedValue(new Error("네트워크 오류"));
    mocks.getCase.mockResolvedValue(courtCase());

    await act(async () => root.render(
      <StatementForm caseId={CASE_ID} draftOwnerId={OWNER_ID} />,
    ));
    await settle();
    await fillValidDraftAndOpenPreview(container);
    let confirmation = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    await act(async () => confirmation?.click());
    let buttons = container.querySelectorAll<HTMLButtonElement>("button");
    await act(async () => buttons.item(buttons.length - 1).click());
    await settle();

    await act(async () => buttons.item(0).click());
    const firstTextarea = container.querySelector<HTMLTextAreaElement>("textarea");
    await act(async () => {
      if (firstTextarea) setTextareaValue(firstTextarea, "y".repeat(80));
    });
    await act(async () => {
      container.querySelector<HTMLFormElement>("form")?.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    confirmation = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    await act(async () => confirmation?.click());
    buttons = container.querySelectorAll<HTMLButtonElement>("button");
    await act(async () => buttons.item(buttons.length - 1).click());
    await settle();

    expect(mocks.submitStatement.mock.calls.map((call) => call[1].submissionRequestId))
      .toEqual([FALLBACK_REQUEST_ID, SAVED_REQUEST_ID]);
  });

  it("never autosaves one case's draft into a newly rendered case key", async () => {
    await act(async () => root.render(
      <StatementForm caseId={CASE_ID} draftOwnerId={OWNER_ID} />,
    ));
    await settle();
    const firstTextarea = container.querySelector<HTMLTextAreaElement>("textarea");
    await act(async () => {
      if (firstTextarea) setTextareaValue(firstTextarea, "첫 사건에만 남아야 하는 비공개 진술");
      await new Promise((resolve) => window.setTimeout(resolve, 550));
    });

    await act(async () => root.render(
      <StatementForm caseId={SECOND_CASE_ID} draftOwnerId={OWNER_ID} />,
    ));
    await settle();
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 550));
    });

    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("");
    const secondCaseDraft = readScopedCourtDraft<{ draft?: { facts?: string } }>(
      window.sessionStorage,
      courtStatementDraftKey(OWNER_ID, SECOND_CASE_ID, false),
      OWNER_ID,
    );
    expect(secondCaseDraft?.draft?.facts ?? "").not.toContain("첫 사건에만 남아야");
  });
});
