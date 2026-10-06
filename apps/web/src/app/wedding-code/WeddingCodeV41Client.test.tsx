// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHarness, click, type Harness } from "@/components/wedding-code/v40/inputTestKit";
import { V41_SELF_INTRO_DETAIL, WEDDING_CODE_V41_VERSION } from "@/constants/weddingCodeV41";
import { WEDDING_CODE_V40_BANK } from "@/lib/weddingCode/v40/bank";
import { V40_FIXTURES } from "@/lib/weddingCode/v40/fixtures";
import { WEDDING_CODE_V41_BANK } from "@/lib/weddingCode/v41/bank";
import { writeProgress } from "@/lib/weddingCode/v41/storage";
import WeddingCodeV41Client from "./WeddingCodeV41Client";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("v4.1 클라이언트 실제 질문 경로", () => {
  let harness: Harness | null = null;
  beforeEach(() => {
    window.history.replaceState(null, "", `/wedding-code?v=${WEDDING_CODE_V41_VERSION}`);
    window.localStorage.clear();
  });
  afterEach(async () => {
    await harness?.unmount();
    harness = null;
    window.localStorage.clear();
  });

  it("새 판 진행만 이어받아 v4.1 문항 원문을 보여준다", async () => {
    const id = "scope.timing.1";
    const index = WEDDING_CODE_V41_BANK.codeIndexById.get(id);
    if (index === undefined) throw new Error("v4.1 item missing");
    const sample = V40_FIXTURES[0];
    const responses = Object.fromEntries(WEDDING_CODE_V41_BANK.items.slice(0, index).map((item) => [item.id, sample.responses[item.id]]));
    const snapshot = { formBit: sample.formBit, responses, screen: "questions" as const, cursor: index, skippedReviewDone: false };
    expect(writeProgress(window.localStorage, WEDDING_CODE_V41_BANK, snapshot, null, Date.now()).status).toBe("saved");
    harness = createHarness();
    await harness.render(<WeddingCodeV41Client shareOrigin="https://hanbang.ai" initial={{ partner: null, both: null }} resolved />);
    const button = [...harness.container.querySelectorAll("button")].find((candidate) => candidate.textContent?.includes("이어서 하기"));
    expect(button).toBeDefined();
    await click(button);
    const question = harness.container.querySelector<HTMLElement>(`[data-item="${id}"]`);
    const revised = WEDDING_CODE_V41_BANK.byId.get(id);
    const old = WEDDING_CODE_V40_BANK.byId.get(id);
    expect(question).not.toBeNull();
    expect(revised?.stem).not.toBe(old?.stem);
    expect(question?.textContent).toContain(revised?.stem);
    expect(question?.textContent).not.toContain(old?.stem);
    expect(harness.container.querySelector(`[data-wedding-code-version="${WEDDING_CODE_V41_VERSION}"]`)).not.toBeNull();
  });

  it("마지막 자기 예상 카드에서 v4.1 전용 안내를 보여준다", async () => {
    const firstSelf = WEDDING_CODE_V41_BANK.codeIndexById.get("self.money");
    if (firstSelf === undefined) throw new Error("v4.1 self item missing");
    const sample = V40_FIXTURES[0];
    const responses = Object.fromEntries(WEDDING_CODE_V41_BANK.items.slice(0, firstSelf).map((item) => [item.id, sample.responses[item.id]]));
    const snapshot = { formBit: sample.formBit, responses, screen: "questions" as const, cursor: firstSelf, skippedReviewDone: false };
    expect(writeProgress(window.localStorage, WEDDING_CODE_V41_BANK, snapshot, null, Date.now()).status).toBe("saved");
    harness = createHarness();
    await harness.render(<WeddingCodeV41Client shareOrigin="https://hanbang.ai" initial={{ partner: null, both: null }} resolved />);
    const resume = [...harness.container.querySelectorAll("button")].find((candidate) => candidate.textContent?.includes("이어서 하기"));
    expect(resume).toBeDefined();
    await click(resume);
    expect(harness.container.querySelector('[data-item="self.money"]')).not.toBeNull();
    const previous = [...harness.container.querySelectorAll("button")].find((candidate) => candidate.textContent?.includes("이전"));
    expect(previous).toBeDefined();
    await click(previous);
    expect(harness.container.querySelector('[data-screen="self-intro"]')?.textContent).toContain(V41_SELF_INTRO_DETAIL);
    expect(harness.container.querySelector('[data-screen="self-intro"]')?.textContent).toContain("끝까지 갈리지 않을 때만 마지막 기준");
  });
});
