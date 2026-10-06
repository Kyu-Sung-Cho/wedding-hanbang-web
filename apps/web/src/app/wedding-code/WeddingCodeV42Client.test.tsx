// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHarness, click, type Harness } from "@/components/wedding-code/v40/inputTestKit";
import { V40_AXIS_KEYS, axisInfo } from "@/constants/weddingCodeV40";
import { V42_SELF_INTRO_DETAIL, WEDDING_CODE_V42_VERSION } from "@/constants/weddingCodeV42";
import { WEDDING_CODE_V40_BANK } from "@/lib/weddingCode/v40/bank";
import { V40_FIXTURES } from "@/lib/weddingCode/v40/fixtures";
import { WEDDING_CODE_V42_BANK } from "@/lib/weddingCode/v42/bank";
import { encodeCode } from "@/lib/weddingCode/v42/codec";
import { V42_STORAGE, writeProgress } from "@/lib/weddingCode/v42/storage";
import { V40_COPY } from "@/lib/weddingCode/v40/copy";
import WeddingCodeV42Client from "./WeddingCodeV42Client";
import { WEDDING_CODE_V43_BANK } from "@/lib/weddingCode/v43/bank";
import { WEDDING_CODE_V43_VERSION } from "@/constants/weddingCodeV43";
import * as v43Storage from "@/lib/weddingCode/v43/storage";
import { encodeCode as encodeV43Code } from "@/lib/weddingCode/v43/codec";
import CandidateV43Client from "./WeddingCodeV43Client";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("v4.2 클라이언트 실제 질문 경로", () => {
  let harness: Harness | null = null;
  beforeEach(() => {
    window.history.replaceState(null, "", `/wedding-code?v=${WEDDING_CODE_V42_VERSION}`);
    window.localStorage.clear();
  });
  afterEach(async () => {
    await harness?.unmount();
    harness = null;
    window.localStorage.clear();
  });

  it("받은 두 사람 결과의 주소를 정리해도 v4.2 입구를 남기며 링크의 답을 저장하지 않는다", async () => {
    const first = V40_FIXTURES.find((sample) => sample.name === "swua-example");
    const second = V40_FIXTURES.find((sample) => sample.name === "couple-partner");
    if (!first || !second) throw new Error("two-person fixture missing");
    const a = encodeCode(WEDDING_CODE_V42_BANK, first.formBit, first.responses);
    const b = encodeCode(WEDDING_CODE_V42_BANK, second.formBit, second.responses);
    if (!a || !b) throw new Error("two-person codes missing");
    window.history.replaceState(null, "", `/wedding-code#v=${WEDDING_CODE_V42_VERSION}&a=${a}&b=${b}`);
    harness = createHarness();
    await harness.render(<WeddingCodeV42Client shareOrigin="https://hanbang.ai" initial={{ partner: null, both: { first: { formBit: first.formBit, responses: first.responses }, second: { formBit: second.formBit, responses: second.responses } } }} resolved />);
    expect(window.location.hash).toBe("");
    expect(window.location.search).toBe(`?v=${WEDDING_CODE_V42_VERSION}`);
    expect(harness.container.querySelector('[data-couple-codes]')).not.toBeNull();
    const report = harness.container.querySelector('[data-couple-preparation]')!;
    expect(report).not.toBeNull();
    for (const axis of V40_AXIS_KEYS) {
      await click([...report.querySelectorAll("button")].find((button) => button.textContent === axisInfo(axis).title));
      const scene = report.querySelector('[data-preparation-scene]')!;
      expect(scene).not.toBeNull();
      const item = WEDDING_CODE_V42_BANK.byId.get(scene.getAttribute("data-preparation-scene")!);
      expect(scene.textContent).toContain(item?.stem);
    }
    expect(window.localStorage.getItem(V42_STORAGE.progressKey)).toBeNull();
    expect(window.localStorage.getItem(V42_STORAGE.historyKey)).toBeNull();
  });

  it("새 판 진행만 이어받아 v4.2 문항 원문을 보여준다", async () => {
    const id = "scope.timing.1";
    const index = WEDDING_CODE_V42_BANK.codeIndexById.get(id);
    if (index === undefined) throw new Error("v4.2 item missing");
    const sample = V40_FIXTURES[0];
    const responses = Object.fromEntries(WEDDING_CODE_V42_BANK.items.slice(0, index).map((item) => [item.id, sample.responses[item.id]]));
    const snapshot = { formBit: sample.formBit, responses, screen: "questions" as const, cursor: index, skippedReviewDone: false };
    expect(writeProgress(window.localStorage, WEDDING_CODE_V42_BANK, snapshot, null, Date.now()).status).toBe("saved");
    harness = createHarness();
    await harness.render(<WeddingCodeV42Client shareOrigin="https://hanbang.ai" initial={{ partner: null, both: null }} resolved />);
    const button = [...harness.container.querySelectorAll("button")].find((candidate) => candidate.textContent?.includes("이어서 하기"));
    expect(button).toBeDefined();
    await click(button);
    const question = harness.container.querySelector<HTMLElement>(`[data-item="${id}"]`);
    const revised = WEDDING_CODE_V42_BANK.byId.get(id);
    const old = WEDDING_CODE_V40_BANK.byId.get(id);
    expect(question).not.toBeNull();
    expect(revised?.stem).not.toBe(old?.stem);
    expect(question?.textContent).toContain(revised?.stem);
    expect(question?.textContent).not.toContain(old?.stem);
    expect(harness.container.querySelector(`[data-wedding-code-version="${WEDDING_CODE_V42_VERSION}"]`)).not.toBeNull();
  });

  it("초대받은 사람이 본인 결과를 이어 열어도 두 원응답과 반환 동의가 올바르게 연결된다", async () => {
    const own = V40_FIXTURES.find((sample) => sample.name === "couple-partner")!;
    const partner = V40_FIXTURES.find((sample) => sample.name === "swua-example")!;
    const snapshot = { formBit: own.formBit, responses: own.responses, screen: "result" as const, cursor: 0, skippedReviewDone: true };
    expect(writeProgress(window.localStorage, WEDDING_CODE_V42_BANK, snapshot, null, Date.now()).status).toBe("saved");
    harness = createHarness();
    await harness.render(<WeddingCodeV42Client shareOrigin="https://hanbang.ai" initial={{ partner: { formBit: partner.formBit, responses: partner.responses }, both: null }} resolved />);
    await click([...harness.container.querySelectorAll("button")].find((button) => button.textContent === V40_COPY.intro.inviteConflict.keepMineButton));
    const report = harness.container.querySelector('[data-couple-preparation]')!;
    expect(report).not.toBeNull();
    expect(report.querySelector('[data-scene-person="second"]')?.textContent).toContain("나의 선택");
    expect(report.textContent).not.toContain("결과와 원응답을 함께 확인하지 못해");
    const returnAction = [...harness.container.querySelectorAll("button")].find((button) => button.textContent === V40_COPY.couple.returnStepButton);
    expect(returnAction).toBeDefined();
    const consentForm = harness.container.querySelector('[data-result-section="couple-share"]')!;
    expect(consentForm.querySelectorAll('input[type="checkbox"]')).toHaveLength(2);
    expect([...consentForm.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].every((input) => !input.checked)).toBe(true);
    expect(consentForm.querySelector('button[aria-disabled="true"]')).not.toBeNull();
  });

  it("마지막 자기 예상 카드에서 v4.2 전용 안내를 보여준다", async () => {
    const firstSelf = WEDDING_CODE_V42_BANK.codeIndexById.get("self.money");
    if (firstSelf === undefined) throw new Error("v4.2 self item missing");
    const sample = V40_FIXTURES[0];
    const responses = Object.fromEntries(WEDDING_CODE_V42_BANK.items.slice(0, firstSelf).map((item) => [item.id, sample.responses[item.id]]));
    const snapshot = { formBit: sample.formBit, responses, screen: "questions" as const, cursor: firstSelf, skippedReviewDone: false };
    expect(writeProgress(window.localStorage, WEDDING_CODE_V42_BANK, snapshot, null, Date.now()).status).toBe("saved");
    harness = createHarness();
    await harness.render(<WeddingCodeV42Client shareOrigin="https://hanbang.ai" initial={{ partner: null, both: null }} resolved />);
    const resume = [...harness.container.querySelectorAll("button")].find((candidate) => candidate.textContent?.includes("이어서 하기"));
    expect(resume).toBeDefined();
    await click(resume);
    expect(harness.container.querySelector('[data-item="self.money"]')).not.toBeNull();
    const previous = [...harness.container.querySelectorAll("button")].find((candidate) => candidate.textContent?.includes("이전"));
    expect(previous).toBeDefined();
    await click(previous);
    expect(harness.container.querySelector('[data-screen="self-intro"]')?.textContent).toContain(V42_SELF_INTRO_DETAIL);
    expect(harness.container.querySelector('[data-screen="self-intro"]')?.textContent).toContain("앞선 계산 기준으로도 글자가 갈리지 않을 때만");
  });
});

describe("v4.3 클라이언트는 v4.2 진행과 새 문항 인용을 섞지 않는다", () => {
  let harness: Harness | null = null;
  beforeEach(() => {
    window.history.replaceState(null, "", `/wedding-code?v=${WEDDING_CODE_V43_VERSION}`);
    window.localStorage.clear();
  });
  afterEach(async () => {
    await harness?.unmount();
    harness = null;
    window.localStorage.clear();
  });

  it("v4.2 진행만 있으면 새 질문을 시작하고, v4.3 진행을 불러올 때는 수정된 원문만 보인다", async () => {
    const sample = V40_FIXTURES[0];
    const previous = { formBit: sample.formBit, responses: {}, screen: "questions" as const, cursor: 0, skippedReviewDone: false };
    expect(writeProgress(window.localStorage, WEDDING_CODE_V42_BANK, previous, null, Date.now()).status).toBe("saved");
    const previousRaw = window.localStorage.getItem(V42_STORAGE.progressKey);
    harness = createHarness();
    await harness.render(<CandidateV43Client shareOrigin="https://hanbang.ai" initial={{ partner: null, both: null }} resolved />);
    expect(harness.container.querySelector('[data-section-card="resume"]')).toBeNull();
    expect(harness.container.querySelector(`[data-wedding-code-version="${WEDDING_CODE_V43_VERSION}"]`)).not.toBeNull();
    await harness.unmount();
    harness = null;

    const id = "process.detail.1";
    const index = WEDDING_CODE_V43_BANK.codeIndexById.get(id);
    if (index === undefined) throw new Error("v4.3 item missing");
    const responses = Object.fromEntries(WEDDING_CODE_V43_BANK.items.slice(0, index).map((item) => [item.id, sample.responses[item.id]]));
    expect(v43Storage.writeProgress(window.localStorage, WEDDING_CODE_V43_BANK, { ...previous, responses, cursor: index }, null, Date.now()).status).toBe("saved");
    harness = createHarness();
    await harness.render(<CandidateV43Client shareOrigin="https://hanbang.ai" initial={{ partner: null, both: null }} resolved />);
    await click([...harness.container.querySelectorAll("button")].find((button) => button.textContent === "이어서 하기"));
    const question = harness.container.querySelector(`[data-item="${id}"]`);
    expect(question).not.toBeNull();
    expect(question?.textContent).toContain(WEDDING_CODE_V43_BANK.byId.get(id)?.stem);
    expect(question?.textContent).not.toContain(WEDDING_CODE_V42_BANK.byId.get(id)?.stem);
    expect(window.localStorage.getItem(V42_STORAGE.progressKey)).toBe(previousRaw);
  });

  it("받은 비교 화면은 v4.3 입구를 남기며 어느 판에도 링크 속 답을 저장하지 않는다", async () => {
    const first = V40_FIXTURES.find((sample) => sample.name === "swua-example")!;
    const second = V40_FIXTURES.find((sample) => sample.name === "couple-partner")!;
    const a = encodeV43Code(WEDDING_CODE_V43_BANK, first.formBit, first.responses);
    const b = encodeV43Code(WEDDING_CODE_V43_BANK, second.formBit, second.responses);
    if (!a || !b) throw new Error("v4.3 fixture code missing");
    window.history.replaceState(null, "", `/wedding-code#v=${WEDDING_CODE_V43_VERSION}&a=${a}&b=${b}`);
    harness = createHarness();
    await harness.render(<CandidateV43Client shareOrigin="https://hanbang.ai" initial={{ partner: null, both: { first: { formBit: first.formBit, responses: first.responses }, second: { formBit: second.formBit, responses: second.responses } } }} resolved />);
    expect(window.location.hash).toBe("");
    expect(window.location.search).toBe(`?v=${WEDDING_CODE_V43_VERSION}`);
    expect(harness.container.querySelector('[data-couple-codes]')).not.toBeNull();
    const report = harness.container.querySelector('[data-couple-preparation]');
    expect(report).not.toBeNull();
    for (const axis of V40_AXIS_KEYS) {
      await click([...report!.querySelectorAll("button")].find((button) => button.textContent === axisInfo(axis).title));
      const scene = report!.querySelector('[data-preparation-scene]');
      expect(scene).not.toBeNull();
      expect(scene?.textContent).toContain(WEDDING_CODE_V43_BANK.byId.get(scene!.getAttribute("data-preparation-scene")!)?.stem);
    }
    for (const key of [V42_STORAGE.progressKey, V42_STORAGE.historyKey, v43Storage.V43_STORAGE.progressKey, v43Storage.V43_STORAGE.historyKey]) {
      expect(window.localStorage.getItem(key)).toBeNull();
    }
  });
});
