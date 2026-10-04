import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { V40_COPY } from "@/lib/weddingCode/v40/copy";
import type { PairView, SelfView, ViewAnswer } from "@/lib/weddingCode/v40/types";
import { ItemFrame } from "./ItemFrame";
import { PairInput } from "./PairInput";
import {
  Controlled,
  click,
  createHarness,
  describedByText,
  isBefore,
  labelProblemsIn,
  labelledByText,
  nameOf,
  pairView,
  pressKey,
  radiosIn,
  selfView,
  type Harness,
} from "./inputTestKit";

/** DOM 순서로 굳혀 두는 여섯 칸 이름. 뷰가 무엇을 주든 척도를 따라 걷는 순서가 바뀌면 이 시험이 깨진다. */
const SCALE_NAMES = [
  "위 카드에 아주 가까워요",
  "위 카드에 꽤 가까워요",
  "위 카드에 조금 가까워요",
  "아래 카드에 조금 가까워요",
  "아래 카드에 꽤 가까워요",
  "아래 카드에 아주 가까워요",
] as const;

const CASES: readonly { readonly name: string; readonly view: PairView | SelfView }[] = [
  { name: "두 가지 중 고르기, 폼 비트 0", view: pairView(0) },
  { name: "두 가지 중 고르기, 폼 비트 1", view: pairView(1) },
  { name: "자기 선택, 폼 비트 0", view: selfView(0) },
  { name: "자기 선택, 폼 비트 1", view: selfView(1) },
];

describe.each(CASES)("PairInput: $name", ({ view }) => {
  let harness: Harness;
  beforeEach(() => {
    harness = createHarness();
  });
  afterEach(async () => {
    await harness.unmount();
  });

  async function renderInput(value: ViewAnswer | null = null, options: { incomplete?: boolean; onAnswer?: (answer: ViewAnswer) => void } = {}) {
    const onAnswer = options.onAnswer ?? vi.fn();
    await harness.render(
      <ItemFrame view={view} value={value} onAnswer={onAnswer} idPrefix="q1">
        <PairInput view={view} value={value} onAnswer={onAnswer} idPrefix="q1" incomplete={options.incomplete} />
      </ItemFrame>,
    );
    return onAnswer;
  }

  /** 제어되는 부모 안에서 그린다. 답을 기록한다. */
  async function renderControlled(initial: ViewAnswer | null = null) {
    const answers: ViewAnswer[] = [];
    await harness.render(
      <Controlled initial={initial} spy={(answer) => answers.push(answer)}>
        {({ value, onAnswer }) => (
          <ItemFrame view={view} value={value} onAnswer={onAnswer} idPrefix="q1">
            <PairInput view={view} value={value} onAnswer={onAnswer} idPrefix="q1" />
          </ItemFrame>
        )}
      </Controlled>,
    );
    return answers;
  }

  const radios = () => radiosIn(harness.container);

  it("라디오 그룹 하나에 칸 여섯 개가 있고 그룹 이름은 앞말이다", async () => {
    await renderInput();
    const groups = harness.container.querySelectorAll('[role="radiogroup"]');
    expect(groups).toHaveLength(1);
    expect(radiosIn(groups[0])).toHaveLength(6);
    expect(labelledByText(groups[0])).toBe(view.stem);
  });

  it("DOM 순서가 위 아주, 꽤, 조금, 아래 조금, 꽤, 아주이고 이름은 뷰의 낭독 이름이다", async () => {
    await renderInput();
    expect(radios().map(nameOf)).toEqual([...SCALE_NAMES]);
    expect(radios().map(nameOf)).toEqual(view.cells.map((cell) => cell.accessibleName));
  });

  it("보이는 칸 글자는 조금, 꽤, 아주이고 번호가 없다", async () => {
    await renderInput();
    expect(radios().map((radio) => radio.textContent?.trim())).toEqual(["아주", "꽤", "조금", "조금", "꽤", "아주"]);
  });

  it("카드 글은 뷰가 준 위아래 순서로 나오고 위 세 칸은 위 카드 안, 아래 세 칸은 아래 카드 안에 있다", async () => {
    await renderInput();
    const findCard = (text: string) => {
      const paragraph = [...harness.container.querySelectorAll("p")].find((element) => element.textContent?.includes(text));
      expect(paragraph).toBeDefined();
      return paragraph!.parentElement!;
    };
    const top = findCard(view.cards[0].text);
    const bottom = findCard(view.cards[1].text);
    expect(top).not.toBe(bottom);
    expect(isBefore(top, bottom)).toBe(true);
    const found = radios();
    expect(found.slice(0, 3).every((radio) => top.contains(radio))).toBe(true);
    expect(found.slice(3).every((radio) => bottom.contains(radio))).toBe(true);
  });

  it("칸마다 자기 카드의 글이 설명(aria-describedby)으로 붙어 있어 이름이 위치만 말해도 카드 내용을 듣는다", async () => {
    await renderInput();
    const found = radios();
    found.forEach((radio, index) => {
      const card = view.cards[index < 3 ? 0 : 1];
      const description = describedByText(radio);
      expect(description).toContain(card.text);
      // 다른 카드의 글은 섞이지 않는다.
      expect(description).not.toContain(view.cards[index < 3 ? 1 : 0].text);
    });
    // 같은 카드의 세 칸은 같은 설명 요소를 가리킨다.
    expect(found[0].getAttribute("aria-describedby")).toBe(found[2].getAttribute("aria-describedby"));
    expect(found[3].getAttribute("aria-describedby")).toBe(found[5].getAttribute("aria-describedby"));
    expect(found[0].getAttribute("aria-describedby")).not.toBe(found[3].getAttribute("aria-describedby"));
    // 이름은 그대로 위치만 말한다(설명이 이름을 바꾸지 않는다).
    expect(found.map(nameOf)).toEqual([...SCALE_NAMES]);
  });

  it("카드는 낭독기에만 위와 아래로 불린다", async () => {
    await renderInput();
    const hidden = [...harness.container.querySelectorAll(".sr-only")].map((element) => element.textContent?.trim());
    expect(hidden).toEqual(expect.arrayContaining(["위 카드.", "아래 카드."]));
  });

  it("탭 자리는 하나다: 답이 없으면 첫 칸, 답이 있으면 고른 칸", async () => {
    await renderInput();
    expect(radios().map((radio) => radio.tabIndex)).toEqual([0, -1, -1, -1, -1, -1]);
    expect(radios().every((radio) => radio.getAttribute("aria-checked") === "false")).toBe(true);

    await renderInput({ fmt: view.fmt, cell: 4 });
    expect(radios().map((radio) => radio.tabIndex)).toEqual([-1, -1, -1, -1, 0, -1]);
    expect(radios().map((radio) => radio.getAttribute("aria-checked"))).toEqual(["false", "false", "false", "false", "true", "false"]);
  });

  it("칸마다 눌렀을 때 그 칸 번호와 뷰의 형식을 한 번씩 알린다", async () => {
    const answers = await renderControlled();
    const clicks = [3, 0, 5, 2, 4, 1];
    for (const cell of clicks) await click(radios()[cell]);
    expect(answers).toEqual(clicks.map((cell) => ({ fmt: view.fmt, cell })));
  });

  it("누르면 그 칸만 고른 상태가 되고 고른 칸에만 체크 표식이 있다", async () => {
    await renderControlled();
    await click(radios()[2]);
    expect(radios().map((radio) => radio.getAttribute("aria-checked"))).toEqual(["false", "false", "true", "false", "false", "false"]);
    expect(radios().map((radio) => radio.querySelector("svg") !== null)).toEqual([false, false, true, false, false, false]);
    expect(radios().map((radio) => radio.tabIndex)).toEqual([-1, -1, 0, -1, -1, -1]);
    await click(radios()[5]);
    expect(radios().map((radio) => radio.getAttribute("aria-checked"))).toEqual(["false", "false", "false", "false", "false", "true"]);
  });

  it("자동으로 넘어가지 않는다: 고른 뒤에도 같은 화면이고 알림은 그 답 하나뿐이다", async () => {
    const answers = await renderControlled();
    await click(radios()[1]);
    expect(answers).toEqual([{ fmt: view.fmt, cell: 1 }]);
    expect(radios()).toHaveLength(6);
    expect(harness.container.textContent).toContain(view.stem);
  });

  it("오른쪽과 아래 방향키는 척도를 따라 다음 칸으로 가서 그 칸을 고른다(위 조금에서 아래 조금으로 이어진다)", async () => {
    const answers = await renderControlled();
    radios()[0].focus();
    const walked: string[] = [nameOf(document.activeElement!)];
    for (const key of ["ArrowRight", "ArrowDown", "ArrowRight", "ArrowDown", "ArrowRight"]) {
      const event = await pressKey(key);
      expect(event.defaultPrevented).toBe(true);
      walked.push(nameOf(document.activeElement!));
    }
    expect(walked).toEqual([...SCALE_NAMES]);
    expect(answers).toEqual([1, 2, 3, 4, 5].map((cell) => ({ fmt: view.fmt, cell })));
    expect(radios()[5].getAttribute("aria-checked")).toBe("true");
    expect(radios()[5].tabIndex).toBe(0);
  });

  it("왼쪽과 위 방향키는 거꾸로 걷는다", async () => {
    const answers = await renderControlled({ fmt: view.fmt, cell: 5 });
    radios()[5].focus();
    const walked: string[] = [];
    for (const key of ["ArrowLeft", "ArrowUp", "ArrowLeft", "ArrowUp", "ArrowLeft"]) {
      await pressKey(key);
      walked.push(nameOf(document.activeElement!));
    }
    expect(walked).toEqual([...SCALE_NAMES].slice(0, 5).reverse());
    expect(answers).toEqual([4, 3, 2, 1, 0].map((cell) => ({ fmt: view.fmt, cell })));
  });

  it("끝에서 반대쪽 끝으로 돈다", async () => {
    const answers = await renderControlled();
    radios()[5].focus();
    await pressKey("ArrowRight");
    expect(document.activeElement).toBe(radios()[0]);
    await pressKey("ArrowLeft");
    expect(document.activeElement).toBe(radios()[5]);
    expect(answers).toEqual([{ fmt: view.fmt, cell: 0 }, { fmt: view.fmt, cell: 5 }]);
  });

  it("방향키가 아니거나 알트, 컨트롤, 메타를 함께 누른 방향키는 아무것도 하지 않는다", async () => {
    const answers = await renderControlled();
    radios()[2].focus();
    for (const key of ["Tab", "a", "Enter", "Home", "End", "Escape"]) {
      const event = await pressKey(key);
      expect(event.defaultPrevented).toBe(false);
    }
    for (const init of [{ altKey: true }, { ctrlKey: true }, { metaKey: true }]) {
      const event = await pressKey("ArrowRight", init);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(document.activeElement).toBe(radios()[2]);
    expect(answers).toEqual([]);
  });

  it("넘기기를 고른 상태에서는 고른 칸이 없다", async () => {
    await renderInput({ fmt: "escape", which: "unsure" });
    expect(radios().every((radio) => radio.getAttribute("aria-checked") === "false")).toBe(true);
    expect(radios().map((radio) => radio.tabIndex)).toEqual([0, -1, -1, -1, -1, -1]);
  });

  it("다른 형식(이럴 때 내 마음)의 답이 와도 칸을 고른 것으로 그리지 않는다", async () => {
    await renderInput({ fmt: "react", cell: 2 }, { incomplete: true });
    expect(radios().every((radio) => radio.getAttribute("aria-checked") === "false")).toBe(true);
    expect(radios().map((radio) => radio.tabIndex)).toEqual([0, -1, -1, -1, -1, -1]);
    // 이 문항의 답이 아니니 다음을 눌렀다면 안내가 그대로 뜬다.
    expect(harness.container.querySelector("#q1-incomplete")?.textContent).toBe(V40_COPY.question.incomplete);
  });

  it("칸을 고른 뒤 넘기기를 누르면 칸이 풀리고 다시 칸을 고르면 넘기기가 풀린다", async () => {
    const answers = await renderControlled();
    await click(radios()[1]);
    const escapeButtons = [...harness.container.querySelectorAll<HTMLButtonElement>("button:not([role='radio'])")];
    expect(escapeButtons.map((button) => button.textContent?.trim())).toEqual(["잘 모르겠어요", "제 상황과 안 맞아요"]);
    await click(escapeButtons[0]);
    expect(radios().every((radio) => radio.getAttribute("aria-checked") === "false")).toBe(true);
    const frameStatus = () => harness.container.querySelector("#q1-status");
    expect(frameStatus()?.textContent).toBe(V40_COPY.question.escapeChosenUnsure);
    await click(radios()[4]);
    expect(radios()[4].getAttribute("aria-checked")).toBe("true");
    expect(frameStatus()?.textContent).toBe("");
    expect(answers).toEqual([
      { fmt: view.fmt, cell: 1 },
      { fmt: "escape", which: "unsure" },
      { fmt: view.fmt, cell: 4 },
    ]);
  });

  it("막는 칸이 없다: 비어 있을 때도, 칸을 고른 뒤에도, 넘기기를 고른 뒤에도 어떤 칸도 disabled 나 aria-disabled 가 아니다", async () => {
    const values: (ViewAnswer | null)[] = [null, { fmt: view.fmt, cell: 2 }, { fmt: "escape", which: "na" }];
    for (const value of values) {
      await renderInput(value);
      expect(radios()).toHaveLength(6);
      for (const radio of radios()) {
        expect(radio.hasAttribute("disabled")).toBe(false);
        expect(radio.getAttribute("aria-disabled")).toBeNull();
        expect(radio.className).toMatch(/min-h-1[1-9]/);
      }
    }
  });

  it("다음을 눌렀는데 비어 있으면(incomplete) 남은 것을 aria-live 로 안내하고, 답이 있으면 안내하지 않는다", async () => {
    await renderInput(null, { incomplete: true });
    const notice = harness.container.querySelector("#q1-incomplete");
    expect(notice?.getAttribute("aria-live")).toBe("polite");
    expect(notice?.textContent).toBe(V40_COPY.question.incomplete);
    // 안내는 다섯 형식이 같은 상자 모양으로 보인다. 글이 없을 때는 빈 상자가 보이지 않는다.
    expect(notice?.className).toMatch(/rounded-lg/);

    await renderInput({ fmt: view.fmt, cell: 0 }, { incomplete: true });
    expect(harness.container.querySelector("#q1-incomplete")?.textContent).toBe("");
    expect(harness.container.querySelector("#q1-incomplete")?.className).not.toMatch(/rounded-lg/);

    await renderInput({ fmt: "escape", which: "na" }, { incomplete: true });
    expect(harness.container.querySelector("#q1-incomplete")?.textContent).toBe("");

    await renderInput(null, { incomplete: false });
    expect(harness.container.querySelector("#q1-incomplete")?.textContent).toBe("");
  });

  it("번호, n/N, A/B, 가나 라벨이 화면에도 낭독 이름에도 없다", async () => {
    await renderInput({ fmt: view.fmt, cell: 3 }, { incomplete: true });
    expect(labelProblemsIn(harness.container)).toEqual([]);
  });

  it("주제, 글자, 극을 알려 주는 것이 문서에 없다", async () => {
    await renderInput();
    const html = harness.container.innerHTML;
    expect(html).not.toMatch(/data-(pole|value|key|axis|facet|letter)/);
    expect(html).not.toContain(view.id);
  });
});
