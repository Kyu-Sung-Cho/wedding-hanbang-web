import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { V40_ESCAPES } from "@/constants/weddingCodeV40";
import { V40_COPY } from "@/lib/weddingCode/v40/copy";
import type { ChoiceView, FormBit, ViewAnswer } from "@/lib/weddingCode/v40/types";
import { ChoiceInput } from "./ChoiceInput";
import { ItemFrame } from "./ItemFrame";
import {
  Controlled,
  INSTANT_OPTION_TEXTS,
  RECALL_OPTION_TEXTS,
  click,
  createHarness,
  instantView,
  labelProblemsIn,
  labelledByText,
  nameOf,
  pressKey,
  radiosIn,
  recallView,
  type Harness,
} from "./inputTestKit";

const BITS: readonly FormBit[] = [0, 1];

interface Case {
  readonly name: string;
  readonly view: ChoiceView;
  /** 뷰가 화면에 놓아야 하는 보기 글(폼 비트가 반영된 순서). */
  readonly texts: readonly string[];
  readonly hasNone: boolean;
}

function cases(): Case[] {
  return BITS.flatMap((bit) => {
    const recallTexts = bit === 0 ? [...RECALL_OPTION_TEXTS] : [...RECALL_OPTION_TEXTS].reverse();
    const instantTexts = bit === 0 ? [...INSTANT_OPTION_TEXTS] : [...INSTANT_OPTION_TEXTS].reverse();
    return [
      { name: `지난 일 떠올리기, 폼 비트 ${bit}`, view: recallView(bit), texts: recallTexts, hasNone: true },
      { name: `그때 나는, 폼 비트 ${bit}`, view: instantView(bit), texts: instantTexts, hasNone: false },
    ];
  });
}

describe.each(cases())("ChoiceInput: $name", ({ view, texts, hasNone }) => {
  const rowCount = texts.length + (hasNone ? 1 : 0);
  const noneIndex = hasNone ? texts.length : -1;

  let harness: Harness;
  beforeEach(() => {
    harness = createHarness();
  });
  afterEach(async () => {
    await harness.unmount();
  });

  async function renderInput(value: ViewAnswer | null = null, options: { incomplete?: boolean } = {}) {
    const onAnswer = vi.fn();
    await harness.render(
      <ItemFrame view={view} value={value} onAnswer={onAnswer} idPrefix="q1">
        <ChoiceInput view={view} value={value} onAnswer={onAnswer} idPrefix="q1" incomplete={options.incomplete} />
      </ItemFrame>,
    );
    return onAnswer;
  }

  async function renderControlled(initial: ViewAnswer | null = null) {
    const answers: ViewAnswer[] = [];
    await harness.render(
      <Controlled initial={initial} spy={(answer) => answers.push(answer)}>
        {({ value, onAnswer }) => (
          <ItemFrame view={view} value={value} onAnswer={onAnswer} idPrefix="q1">
            <ChoiceInput view={view} value={value} onAnswer={onAnswer} idPrefix="q1" />
          </ItemFrame>
        )}
      </Controlled>,
    );
    return answers;
  }

  const radios = () => radiosIn(harness.container);

  it("라디오 그룹 하나에 보기 카드가 뷰의 순서대로 있다", async () => {
    await renderInput();
    const groups = harness.container.querySelectorAll('[role="radiogroup"]');
    expect(groups).toHaveLength(1);
    expect(labelledByText(groups[0])).toBe(view.stem);
    expect(radios()).toHaveLength(rowCount);
    expect(radios().slice(0, texts.length).map(nameOf)).toEqual([...texts]);
  });

  it("지난 일 떠올리기에만 이런 일이 없었어요 카드가 마지막에 있다", async () => {
    await renderInput();
    if (hasNone) {
      expect(nameOf(radios()[noneIndex])).toBe(V40_ESCAPES.recallNone);
      expect(view.noneLabel).toBe("이런 일이 없었어요");
    } else {
      expect(view.noneLabel).toBeNull();
      expect(harness.container.textContent).not.toContain(V40_ESCAPES.recallNone);
    }
  });

  it("카드에는 보기 글과 표식만 있고 번호나 극, 세기 표시가 없다", async () => {
    await renderInput();
    const group = harness.container.querySelector('[role="radiogroup"]')!;
    const expected = [...texts, ...(hasNone ? [V40_ESCAPES.recallNone] : [])].join("");
    expect(group.textContent).toBe(expected);
  });

  it("보기를 누르면 뷰의 형식과 화면 위에서부터의 번호를 한 번씩 알린다", async () => {
    const answers = await renderControlled();
    const order = [2, 0, 3, 1];
    for (const option of order) await click(radios()[option]);
    expect(answers).toEqual(order.map((option) => ({ fmt: view.fmt, option })));
  });

  it("이런 일이 없었어요를 누르면 제 상황과 안 맞아요와 같은 값을 알린다", async () => {
    if (!hasNone) return;
    const answers = await renderControlled();
    await click(radios()[noneIndex]);
    expect(answers).toEqual([{ fmt: "escape", which: "na" }]);
    expect(radios()[noneIndex].getAttribute("aria-checked")).toBe("true");
    expect(harness.container.querySelector("#q1-status")?.textContent).toBe(V40_COPY.question.escapeChosenRecallNone);
  });

  it("고른 보기만 고른 상태이고 체크 표식과 탭 자리가 그 카드에 있다", async () => {
    await renderControlled();
    expect(radios().map((radio) => radio.tabIndex)).toEqual(radios().map((_, index) => (index === 0 ? 0 : -1)));
    await click(radios()[1]);
    expect(radios().map((radio) => radio.getAttribute("aria-checked"))).toEqual(radios().map((_, index) => (index === 1 ? "true" : "false")));
    expect(radios().map((radio) => radio.querySelector("svg") !== null)).toEqual(radios().map((_, index) => index === 1));
    expect(radios().map((radio) => radio.tabIndex)).toEqual(radios().map((_, index) => (index === 1 ? 0 : -1)));
  });

  it("들어온 답에 맞춰 고른 카드를 그린다", async () => {
    await renderInput({ fmt: view.fmt, option: 3 });
    expect(radios()[3].getAttribute("aria-checked")).toBe("true");
    expect(radios().filter((radio) => radio.getAttribute("aria-checked") === "true")).toHaveLength(1);

    await renderInput({ fmt: "escape", which: "na" });
    const checked = radios().filter((radio) => radio.getAttribute("aria-checked") === "true");
    expect(checked).toHaveLength(hasNone ? 1 : 0);
    if (hasNone) expect(checked[0]).toBe(radios()[noneIndex]);

    await renderInput({ fmt: "escape", which: "unsure" });
    expect(radios().filter((radio) => radio.getAttribute("aria-checked") === "true")).toHaveLength(0);

    // 범위 밖 번호나 다른 형식의 답은 고른 것으로 그리지 않는다.
    await renderInput({ fmt: view.fmt, option: 9 });
    expect(radios().filter((radio) => radio.getAttribute("aria-checked") === "true")).toHaveLength(0);
    await renderInput({ fmt: "react", cell: 1 });
    expect(radios().filter((radio) => radio.getAttribute("aria-checked") === "true")).toHaveLength(0);
  });

  it("자동으로 넘어가지 않는다", async () => {
    const answers = await renderControlled();
    await click(radios()[0]);
    expect(answers).toEqual([{ fmt: view.fmt, option: 0 }]);
    expect(radios()).toHaveLength(rowCount);
    expect(harness.container.textContent).toContain(view.stem);
  });

  it("방향키는 카드를 위에서 아래로 걸으며 고르고 끝에서 돈다(지난 일 떠올리기는 마지막 카드까지)", async () => {
    const answers = await renderControlled();
    radios()[0].focus();
    for (let step = 1; step < rowCount; step += 1) {
      const event = await pressKey(step % 2 === 0 ? "ArrowRight" : "ArrowDown");
      expect(event.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(radios()[step]);
    }
    await pressKey("ArrowDown");
    expect(document.activeElement).toBe(radios()[0]);
    await pressKey("ArrowUp");
    expect(document.activeElement).toBe(radios()[rowCount - 1]);
    const expected: ViewAnswer[] = [];
    for (let step = 1; step < rowCount; step += 1) expected.push(step === noneIndex ? { fmt: "escape", which: "na" } : { fmt: view.fmt, option: step });
    expected.push({ fmt: view.fmt, option: 0 });
    expected.push(rowCount - 1 === noneIndex ? { fmt: "escape", which: "na" } : { fmt: view.fmt, option: rowCount - 1 });
    expect(answers).toEqual(expected);
  });

  it("방향키가 아닌 키와 수정키가 붙은 방향키는 무시한다", async () => {
    const answers = await renderControlled();
    radios()[1].focus();
    for (const key of ["Tab", "1", "a", "Home", "End"]) expect((await pressKey(key)).defaultPrevented).toBe(false);
    expect((await pressKey("ArrowDown", { metaKey: true })).defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(radios()[1]);
    expect(answers).toEqual([]);
  });

  it("긴 보기는 줄바꿈되고 잘리지 않는다", async () => {
    await renderInput();
    for (const radio of radios()) {
      expect(radio.className).not.toMatch(/whitespace-nowrap|truncate|overflow-hidden|line-clamp/);
      expect(radio.className).toMatch(/min-h-1[1-9]/);
      const text = radio.querySelector("span:last-child");
      expect(text?.className).toMatch(/min-w-0/);
    }
  });

  it("막는 카드가 없다", async () => {
    await renderInput();
    for (const radio of radios()) {
      expect(radio.hasAttribute("disabled")).toBe(false);
      expect(radio.getAttribute("aria-disabled")).toBeNull();
    }
  });

  it("비어 있는데 다음을 눌렀으면 안내하고 답이 있으면 안내하지 않는다", async () => {
    await renderInput(null, { incomplete: true });
    expect(harness.container.querySelector("#q1-incomplete")?.textContent).toBe(V40_COPY.question.incomplete);
    await renderInput({ fmt: view.fmt, option: 1 }, { incomplete: true });
    expect(harness.container.querySelector("#q1-incomplete")?.textContent).toBe("");
    await renderInput({ fmt: "escape", which: "unsure" }, { incomplete: true });
    expect(harness.container.querySelector("#q1-incomplete")?.textContent).toBe("");
  });

  it("번호, n/N, A/B, 가나 라벨이 화면에도 낭독 이름에도 없다", async () => {
    await renderInput({ fmt: view.fmt, option: 2 }, { incomplete: true });
    expect(labelProblemsIn(harness.container)).toEqual([]);
  });

  it("문서에 극, 세기, 문항 id 가 없다", async () => {
    await renderInput();
    const html = harness.container.innerHTML;
    expect(html).not.toMatch(/data-(pole|value|key|axis|facet|letter|strength)/);
    expect(html).not.toContain(view.id);
  });
});
