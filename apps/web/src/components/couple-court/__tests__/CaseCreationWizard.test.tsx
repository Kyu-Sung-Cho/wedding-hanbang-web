import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CaseCreationWizard, { parseStoredCaseDraft } from "../CaseCreationWizard";
import {
  courtCaseDraftKey,
  readScopedCourtDraft,
  writeScopedCourtDraft,
} from "../draftStorage";

const mocks = vi.hoisted(() => ({
  createCase: vi.fn(),
  submitStatement: vi.fn(),
  push: vi.fn(),
  back: vi.fn(),
  captureCourtEvent: vi.fn(),
}));

vi.mock("../api", () => ({
  createCase: mocks.createCase,
  submitStatement: mocks.submitStatement,
}));

vi.mock("../analytics", () => ({
  captureCourtEvent: mocks.captureCourtEvent,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, back: mocks.back }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const OWNER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CASE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CREATION_REQUEST_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SUBMISSION_REQUEST_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const FALLBACK_REQUEST_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

function completeDraft(overrides: Record<string, unknown> = {}) {
  return {
    creationRequestId: CREATION_REQUEST_ID,
    submissionRequestId: SUBMISSION_REQUEST_ID,
    mode: "solo",
    category: "budget",
    title: "예산 의견 차이 사건",
    facts: "확인 가능한 사실을 충분한 길이로 작성한 테스트 문장입니다. 날짜와 대화 내용을 함께 적었습니다.",
    hurtAction: "decided_alone",
    hurtActionOther: "",
    feelings: "상의 없이 결정되어서 많이 당황하고 서운했습니다.",
    agreementType: "budget_defined",
    agreementTypeOther: "",
    expectations: "결제 전에 예산 범위를 함께 확인하기로 기대했습니다.",
    attempts: "서로 편한 시간에 다시 대화하자고 먼저 제안했습니다.",
    desiredOutcomes: ["budget"],
    desiredAgreement: "추가 비용은 결제 전에 함께 확인하기로 합의하고 싶습니다.",
    selfChange: "결정 전에 먼저 물어보겠습니다.",
    safetyConcern: true,
    tone: "gentle",
    ...overrides,
  };
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function submitCurrentStep(container: HTMLDivElement): Promise<void> {
  await act(async () => {
    container.querySelector<HTMLFormElement>("form")?.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
}

describe("CaseCreationWizard safety flow", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    window.history.replaceState({}, "", "/wedding/couple-court/new");
    window.sessionStorage.clear();
    mocks.createCase.mockReset();
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
    window.sessionStorage.clear();
    window.history.replaceState({}, "", "/");
    vi.restoreAllMocks();
  });

  it("restores and persists the step-three safety concern", async () => {
    const storageKey = courtCaseDraftKey(OWNER_ID);
    writeScopedCourtDraft(
      window.sessionStorage,
      storageKey,
      OWNER_ID,
      completeDraft(),
    );

    await act(async () => root.render(<CaseCreationWizard draftOwnerId={OWNER_ID} />));
    await settle();
    await submitCurrentStep(container);
    await submitCurrentStep(container);

    const safetyCheckbox = container.querySelector<HTMLInputElement>("#case-safety-concern");
    expect(safetyCheckbox?.checked).toBe(true);
    expect(container.textContent).toContain("재미있는 판결보다 안전 확인이 먼저예요");

    await act(async () => safetyCheckbox?.click());
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 550));
    });

    const saved = readScopedCourtDraft<{ safetyConcern?: boolean }>(
      window.sessionStorage,
      storageKey,
      OWNER_ID,
    );
    expect(saved?.safetyConcern).toBe(false);
  });

  it("keeps the safety-first notice visible and submits restored risk as high risk", async () => {
    const storageKey = courtCaseDraftKey(OWNER_ID);
    writeScopedCourtDraft(
      window.sessionStorage,
      storageKey,
      OWNER_ID,
      completeDraft({ createdCaseId: CASE_ID }),
    );

    await act(async () => root.render(<CaseCreationWizard draftOwnerId={OWNER_ID} />));
    await settle();

    expect(container.textContent).toContain("재미있는 판결보다 안전 확인이 먼저예요");
    expect(container.textContent).toContain("접수 후에는 재미있는 판결이나 공개 기능보다 안전 확인과 도움 안내를 먼저 보여드려요.");

    await submitCurrentStep(container);
    await settle();

    expect(mocks.createCase).not.toHaveBeenCalled();
    expect(mocks.submitStatement).toHaveBeenCalledWith(
      CASE_ID,
      expect.objectContaining({
        submissionRequestId: SUBMISSION_REQUEST_ID,
        safetyLevel: "high_risk",
      }),
    );
    expect(mocks.captureCourtEvent).toHaveBeenCalledWith(
      "couple_court_safety_redirect",
      expect.objectContaining({ status: "statement" }),
    );
    expect(mocks.push).toHaveBeenCalledWith(`/wedding/couple-court/cases/${CASE_ID}`);
    expect(window.sessionStorage.getItem(storageKey)).toBeNull();
  });

  it("uses the server high-risk result immediately instead of entering the normal case flow", async () => {
    const storageKey = courtCaseDraftKey(OWNER_ID);
    writeScopedCourtDraft(
      window.sessionStorage,
      storageKey,
      OWNER_ID,
      completeDraft({ createdCaseId: CASE_ID, safetyConcern: false }),
    );
    mocks.submitStatement.mockResolvedValue({
      safety: {
        level: "high_risk",
        categories: ["coercion"],
        requiresImmediateHelp: true,
        resourceMessage: "지금 위험하다면 안전한 장소에서 도움을 요청해 주세요.",
      },
    });

    await act(async () => root.render(<CaseCreationWizard draftOwnerId={OWNER_ID} />));
    await settle();
    await submitCurrentStep(container);
    await settle();

    expect(mocks.push).not.toHaveBeenCalled();
    expect(container.textContent).toContain("재미있는 판결보다 안전 확인이 먼저예요");
    expect(container.textContent).toContain("지금 위험하다면 안전한 장소에서 도움을 요청해 주세요.");
    expect(mocks.captureCourtEvent).toHaveBeenCalledWith(
      "couple_court_safety_redirect",
      expect.objectContaining({ status: "statement" }),
    );
    expect(window.sessionStorage.getItem(storageKey)).toBeNull();
  });

  it("rejects malformed or oversized stored fields instead of spreading them into the form", () => {
    expect(parseStoredCaseDraft(completeDraft({ facts: 123 }))).toBeNull();
    expect(parseStoredCaseDraft(completeDraft({ title: "x".repeat(121) }))).toBeNull();
    expect(parseStoredCaseDraft(completeDraft({ desiredOutcomes: ["budget", "budget"] }))).toBeNull();
  });

  it("removes a malformed stored draft and starts from a safe empty form", async () => {
    const storageKey = courtCaseDraftKey(OWNER_ID);
    writeScopedCourtDraft(
      window.sessionStorage,
      storageKey,
      OWNER_ID,
      completeDraft({ facts: { corrupted: true } }),
    );

    await act(async () => root.render(<CaseCreationWizard draftOwnerId={OWNER_ID} />));
    await settle();

    expect(container.textContent).toContain("지금 두 분에게 맞는 방법은?");
    expect(window.sessionStorage.getItem(storageKey)).toBeNull();
  });

  it("preserves an existing draft when a different category link is opened", async () => {
    const storageKey = courtCaseDraftKey(OWNER_ID);
    const existingDraft = completeDraft();
    writeScopedCourtDraft(
      window.sessionStorage,
      storageKey,
      OWNER_ID,
      existingDraft,
    );
    window.history.replaceState(
      {},
      "",
      "/wedding/couple-court/new?mode=couple&category=venue",
    );

    await act(async () => root.render(<CaseCreationWizard draftOwnerId={OWNER_ID} />));
    await settle();

    expect(container.textContent).toContain("기존 초안을 어떻게 할까요?");
    expect(container.textContent).toContain("작성한 내용을 임의로 바꾸지 않을게요.");
    expect(readScopedCourtDraft(
      window.sessionStorage,
      storageKey,
      OWNER_ID,
    )).toMatchObject(existingDraft);

    const keepButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("기존 초안 이어쓰기"),
    );
    await act(async () => keepButton?.click());

    const selectedMode = container.querySelector<HTMLButtonElement>("button[aria-pressed='true']");
    expect(selectedMode?.textContent).toContain("혼자 임시판결");
    expect(readScopedCourtDraft(
      window.sessionStorage,
      storageKey,
      OWNER_ID,
    )).toMatchObject(existingDraft);
  });

  it("discards a conflicting draft only after the user explicitly starts fresh", async () => {
    const storageKey = courtCaseDraftKey(OWNER_ID);
    writeScopedCourtDraft(
      window.sessionStorage,
      storageKey,
      OWNER_ID,
      completeDraft(),
    );
    window.history.replaceState(
      {},
      "",
      "/wedding/couple-court/new?mode=couple&category=venue",
    );

    await act(async () => root.render(<CaseCreationWizard draftOwnerId={OWNER_ID} />));
    await settle();
    const resetButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("기존 초안을 지우고 새 사건 시작"),
    );
    await act(async () => resetButton?.click());
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 550));
    });

    const saved = readScopedCourtDraft<Record<string, unknown>>(
      window.sessionStorage,
      storageKey,
      OWNER_ID,
    );
    expect(saved).toMatchObject({
      mode: "couple",
      category: "venue",
      facts: "",
    });
    expect(saved).not.toHaveProperty("createdCaseId");
    expect(saved?.title).toContain("웨딩홀");
    expect(container.textContent).not.toContain("기존 초안을 어떻게 할까요?");
    expect(container.textContent).toContain("지금 두 분에게 맞는 방법은?");
  });
});
