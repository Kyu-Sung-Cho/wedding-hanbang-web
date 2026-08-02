import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AmoraQuoteCheckResult } from "@/lib/amora/quoteCheck";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  publishQuoteForSharing: vi.fn(),
}));

vi.mock("@/lib/privacy/quotePublication", () => ({
  publishQuoteForSharing: mocks.publishQuoteForSharing,
}));

vi.mock("./ReportCardButton", () => ({ default: () => null }));

import { ResultPanel } from "./page";

const QUOTE_ID = "10000000-0000-4000-8000-000000000001";
const PUBLIC_PATH = `/quote/${QUOTE_ID}`;

const RESULT: AmoraQuoteCheckResult = {
  category: "studio",
  scope: "seoul",
  quotePriceManwon: 320,
  marketMedianManwon: 0,
  marketComparatorLabel: "업체별 최신 공시가 확인 필요",
  priceDiffPercent: 0,
  checkedItemCount: 1,
  missingCriticalCount: 1,
  missingHighCount: 0,
  missingMediumCount: 0,
  includedItems: [],
  missingItems: [{
    id: "originals",
    name: "원본 제공",
    category: "studio",
    severity: "critical",
    checkQuestion: "원본이 제공되나요?",
    reason: "계약 전 확인이 필요합니다.",
    disguise: "별도 표기 없음",
  }],
  summaryTitle: "핵심 확인 항목이 있어요",
  summaryText: "계약 전에 확인해 주세요.",
  recommendedAction: "업체에 질문해 보세요.",
  contractQuestions: ["원본 제공 여부를 알려주세요."],
  negotiationScript: "계약 전에 한 가지 확인할게요.",
  sourceNote: "입력한 견적서를 기준으로 확인했습니다.",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

async function flushAsyncWork() {
  await new Promise((resolve) => window.setTimeout(resolve, 0));
  await Promise.resolve();
}

function shareButtons(container: HTMLDivElement) {
  const buttons = [...container.querySelectorAll<HTMLButtonElement>("button")];
  const message = buttons.find((button) => button.textContent?.includes("카톡"));
  const instagram = buttons.find((button) => button.textContent?.includes("인스타"));
  if (!message || !instagram) throw new Error("share buttons not rendered");
  return { instagram, message };
}

describe("quote publication before sharing", () => {
  let container: HTMLDivElement;
  let root: Root;
  let clipboardWrite: ReturnType<typeof vi.fn>;
  let openWindow: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    clipboardWrite = vi.fn().mockResolvedValue(undefined);
    openWindow = vi.fn().mockReturnValue(null);
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: clipboardWrite },
    });
    vi.stubGlobal("open", openWindow);

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<ResultPanel result={RESULT} savedId={QUOTE_ID} />));
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await act(async () => root.unmount());
    document.body.replaceChildren();
  });

  it("publishes once before either share channel and reuses the validated server path", async () => {
    mocks.publishQuoteForSharing.mockResolvedValue(PUBLIC_PATH);
    const buttons = shareButtons(container);

    await act(async () => {
      buttons.message.click();
      await flushAsyncWork();
    });

    expect(mocks.publishQuoteForSharing).toHaveBeenCalledOnce();
    expect(mocks.publishQuoteForSharing).toHaveBeenCalledWith(QUOTE_ID);
    expect(clipboardWrite).toHaveBeenCalledWith(
      expect.stringContaining(`${window.location.origin}${PUBLIC_PATH}`),
    );

    await act(async () => {
      buttons.instagram.click();
      await flushAsyncWork();
    });

    expect(mocks.publishQuoteForSharing).toHaveBeenCalledOnce();
    expect(clipboardWrite).toHaveBeenCalledTimes(2);
    expect(openWindow).toHaveBeenCalledWith(
      "https://www.instagram.com/",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("does not share on publication failure and leaves a visible retry path", async () => {
    mocks.publishQuoteForSharing
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(PUBLIC_PATH);
    const buttons = shareButtons(container);

    await act(async () => {
      buttons.message.click();
      await flushAsyncWork();
    });

    expect(clipboardWrite).not.toHaveBeenCalled();
    expect(openWindow).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("다시 시도");
    expect(buttons.message.disabled).toBe(false);

    await act(async () => {
      buttons.message.click();
      await flushAsyncWork();
    });

    expect(mocks.publishQuoteForSharing).toHaveBeenCalledTimes(2);
    expect(clipboardWrite).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("allows only one publication and one share action during concurrent clicks", async () => {
    const publication = deferred<string>();
    mocks.publishQuoteForSharing.mockReturnValue(publication.promise);
    const buttons = shareButtons(container);

    await act(async () => {
      buttons.message.click();
      buttons.instagram.click();
      await Promise.resolve();
    });

    expect(mocks.publishQuoteForSharing).toHaveBeenCalledOnce();
    expect(buttons.message.disabled).toBe(true);
    expect(buttons.instagram.disabled).toBe(true);
    expect(clipboardWrite).not.toHaveBeenCalled();
    expect(openWindow).not.toHaveBeenCalled();

    await act(async () => {
      publication.resolve(PUBLIC_PATH);
      await flushAsyncWork();
    });

    expect(clipboardWrite).toHaveBeenCalledOnce();
    expect(openWindow).not.toHaveBeenCalled();
    expect(buttons.message.disabled).toBe(false);
    expect(buttons.instagram.disabled).toBe(false);
  });
});
