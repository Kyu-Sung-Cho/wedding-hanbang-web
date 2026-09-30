import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { V40_COPY } from "@/lib/weddingCode/v40/copy";
import type { FormBit, ReactView, ViewAnswer } from "@/lib/weddingCode/v40/types";
import { ItemFrame } from "./ItemFrame";
import { ReactInput } from "./ReactInput";
import {
  Controlled,
  click,
  createHarness,
  describedByText,
  isBefore,
  labelProblemsIn,
  labelledByText,
  nameOf,
  pressKey,
  radiosIn,
  reactView,
  type Harness,
} from "./inputTestKit";

const MIDDLE_NAMES = ["다섯 칸 중 왼쪽에서 두 번째", "다섯 칸 중 가운데", "다섯 칸 중 오른쪽에서 두 번째"] as const;

const BITS: readonly FormBit[] = [0, 1];

describe.each(BITS)("ReactInput: 폼 비트 %i", (formBit) => {
  const view: ReactView = reactView(formBit);
  // 뷰가 이미 양끝 이름의 자리를 반영했다. 컴포넌트는 폼 비트를 모르고 뷰만 그린다.
  const left = formBit === 0 ? "서운할 것 같아요" : "든든할 것 같아요";
  const right = formBit === 0 ? "든든할 것 같아요" : "서운할 것 같아요";

  let harness: Harness;
  beforeEach(() => {
    harness = createHarness();
  });
  afterEach(async () => {
    await harness.unmount();
  });

  async function renderInput(
    value: ViewAnswer | null = null,
    options: { incomplete?: boolean; view?: ReactView } = {},
  ) {
    const onAnswer = vi.fn();
    const shown = options.view ?? view;
    await harness.render(
      <ItemFrame view={shown} value={value} onAnswer={onAnswer} idPrefix="q1">
        <ReactInput view={shown} value={value} onAnswer={onAnswer} idPrefix="q1" incomplete={options.incomplete} />
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
            <ReactInput view={view} value={value} onAnswer={onAnswer} idPrefix="q1" />
          </ItemFrame>
        )}
      </Controlled>,
    );
    return answers;
  }

  const radios = () => radiosIn(harness.container);

  it("사연은 인용 블록으로 따로 나오고 말한 사람이 밝혀진다", async () => {
    await renderInput();
    const figure = harness.container.querySelector("figure");
    expect(figure).not.toBeNull();
    const quote = figure!.querySelector("blockquote");
    expect(quote?.textContent).toBe("「그럼 내일 할 일부터 같이 정리해 볼까?」");
    const speaker = figure!.querySelector("figcaption");
    expect(speaker?.textContent).toContain("상대");
    expect(speaker?.textContent).toContain("말한 사람");
    expect(labelledByText(figure!)).toBe(speaker?.textContent?.trim());
    // 앞말, 인용, 물음, 다섯 칸 순서.
    const stem = harness.container.querySelector("#q1-stem")!;
    const question = harness.container.querySelector("#q1-question")!;
    expect(isBefore(stem, figure!)).toBe(true);
    expect(isBefore(figure!, question)).toBe(true);
    expect(isBefore(question, radios()[0])).toBe(true);
  });

  it("인용이 없는 뷰에는 인용 블록이 없다", async () => {
    await renderInput(null, { view: reactView(formBit, { quote: false }) });
    expect(harness.container.querySelector("figure")).toBeNull();
    expect(harness.container.querySelector("blockquote")).toBeNull();
    expect(harness.container.querySelector("#q1-question")?.textContent).toBe(view.question);
  });

  it("라디오 그룹의 이름은 물음이고 설명은 사연(말한 사람과 인용문)에 이어 양끝 이름이다", async () => {
    await renderInput();
    const groups = harness.container.querySelectorAll('[role="radiogroup"]');
    expect(groups).toHaveLength(1);
    expect(labelledByText(groups[0])).toBe("그때 내 마음은?");
    // 폼 컨트롤만 훑는 낭독기 사용자도 그룹에 들어오면 누가 무슨 말을 했는지부터 듣는다.
    const speaker = harness.container.querySelector("figcaption")?.textContent?.trim();
    const quote = harness.container.querySelector("blockquote")?.textContent?.trim();
    expect(speaker).toBe("말한 사람: 상대");
    expect(quote).toBe("「그럼 내일 할 일부터 같이 정리해 볼까?」");
    expect(describedByText(groups[0])).toBe([speaker, quote, view.groupDescription].join(" "));
    // 어느 이름이 어느 쪽 끝인지까지 맞아야 한다(두 이름이 들어 있기만 하면 거울 짝이 뒤집혀도 통과한다).
    expect(view.groupDescription).toContain(`왼쪽 끝은 「${left}」`);
    expect(view.groupDescription).toContain(`오른쪽 끝은 「${right}」`);
  });

  it("사연이 없는 뷰에서는 그룹 설명이 양끝 이름뿐이다", async () => {
    const plain = reactView(formBit, { quote: false });
    await renderInput(null, { view: plain });
    const group = harness.container.querySelector('[role="radiogroup"]')!;
    expect(describedByText(group)).toBe(plain.groupDescription);
    // 없는 요소를 가리키는 id 가 남아 있지 않다.
    for (const id of (group.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean)) {
      expect(harness.container.ownerDocument.getElementById(id)).not.toBeNull();
    }
  });

  it("다섯 칸의 낭독 이름은 위치를 낱말로 말하고 양끝 칸에는 끝 이름이 앞에 붙는다", async () => {
    await renderInput();
    expect(radios().map(nameOf)).toEqual([
      `${left}, 다섯 칸 중 왼쪽 끝`,
      MIDDLE_NAMES[0],
      MIDDLE_NAMES[1],
      MIDDLE_NAMES[2],
      `${right}, 다섯 칸 중 오른쪽 끝`,
    ]);
    expect(radios().map(nameOf)).toEqual(view.cells.map((cell) => cell.accessibleName));
  });

  it("양끝 이름은 화면 왼쪽과 오른쪽에 뷰가 준 대로 보이고 칸 자체에는 글자가 없다", async () => {
    await renderInput();
    // 양끝 이름은 칸의 낭독 이름과 그룹 설명에 이미 있어서 눈에만 보이는 줄(aria-hidden)에 놓는다.
    const ends = harness.container.querySelector<HTMLElement>('div[aria-hidden="true"]')!;
    const labels = [...ends.querySelectorAll("span")];
    expect(labels.map((element) => element.textContent)).toEqual([left, right]);
    expect(isBefore(labels[0], labels[1])).toBe(true);
    expect(isBefore(radios()[4], ends)).toBe(true);
    for (const radio of radios()) expect(radio.textContent?.trim()).toBe("");
  });

  it("칸을 누르면 왼쪽부터 칸 번호를 알린다", async () => {
    const answers = await renderControlled();
    const order = [4, 0, 2, 3, 1];
    for (const cell of order) await click(radios()[cell]);
    expect(answers).toEqual(order.map((cell) => ({ fmt: "react", cell })));
  });

  it("고른 칸만 고른 상태이고 체크 표식과 탭 자리가 그 칸에 있다", async () => {
    await renderControlled();
    expect(radios().map((radio) => radio.tabIndex)).toEqual([0, -1, -1, -1, -1]);
    await click(radios()[3]);
    expect(radios().map((radio) => radio.getAttribute("aria-checked"))).toEqual(["false", "false", "false", "true", "false"]);
    expect(radios().map((radio) => radio.querySelector("svg") !== null)).toEqual([false, false, false, true, false]);
    expect(radios().map((radio) => radio.tabIndex)).toEqual([-1, -1, -1, 0, -1]);
  });

  it("자동으로 넘어가지 않는다", async () => {
    const answers = await renderControlled();
    await click(radios()[2]);
    expect(answers).toEqual([{ fmt: "react", cell: 2 }]);
    expect(radios()).toHaveLength(5);
    expect(harness.container.textContent).toContain(view.question);
  });

  it("방향키는 칸을 왼쪽에서 오른쪽으로 걸으며 고르고 끝에서 돈다", async () => {
    const answers = await renderControlled();
    radios()[0].focus();
    const walked: string[] = [];
    for (const key of ["ArrowRight", "ArrowDown", "ArrowRight", "ArrowDown"]) {
      const event = await pressKey(key);
      expect(event.defaultPrevented).toBe(true);
      walked.push(nameOf(document.activeElement!));
    }
    expect(walked).toEqual([...MIDDLE_NAMES, `${right}, 다섯 칸 중 오른쪽 끝`]);
    await pressKey("ArrowRight");
    expect(document.activeElement).toBe(radios()[0]);
    await pressKey("ArrowLeft");
    expect(document.activeElement).toBe(radios()[4]);
    await pressKey("ArrowUp");
    expect(document.activeElement).toBe(radios()[3]);
    expect(answers).toEqual([1, 2, 3, 4, 0, 4, 3].map((cell) => ({ fmt: "react", cell })));
  });

  it("방향키가 아닌 키와 수정키가 붙은 방향키는 무시한다", async () => {
    const answers = await renderControlled();
    radios()[2].focus();
    for (const key of ["Tab", "x", "Home", "End"]) expect((await pressKey(key)).defaultPrevented).toBe(false);
    for (const init of [{ altKey: true }, { ctrlKey: true }, { metaKey: true }]) {
      expect((await pressKey("ArrowRight", init)).defaultPrevented).toBe(false);
    }
    expect(document.activeElement).toBe(radios()[2]);
    expect(answers).toEqual([]);
  });

  it("넘기기를 고르면 고른 칸이 없다", async () => {
    await renderInput({ fmt: "escape", which: "unsure" });
    expect(radios().every((radio) => radio.getAttribute("aria-checked") === "false")).toBe(true);
  });

  it("다른 형식의 답이 와도 칸을 고른 것으로 그리지 않는다", async () => {
    await renderInput({ fmt: "pair", cell: 2 });
    expect(radios().every((radio) => radio.getAttribute("aria-checked") === "false")).toBe(true);
  });

  it("막는 칸이 없고 터치 목표 클래스가 있다: 비어 있을 때도, 칸을 고른 뒤에도, 넘기기를 고른 뒤에도", async () => {
    const values: (ViewAnswer | null)[] = [null, { fmt: "react", cell: 2 }, { fmt: "escape", which: "na" }];
    for (const value of values) {
      await renderInput(value);
      expect(radios()).toHaveLength(5);
      for (const radio of radios()) {
        expect(radio.hasAttribute("disabled")).toBe(false);
        expect(radio.getAttribute("aria-disabled")).toBeNull();
        expect(radio.className).toMatch(/min-h-1[1-9]/);
      }
    }
  });

  it("비어 있는데 다음을 눌렀으면 안내하고 답이 있으면 안내하지 않는다", async () => {
    await renderInput(null, { incomplete: true });
    const notice = harness.container.querySelector("#q1-incomplete");
    expect(notice?.textContent).toBe(V40_COPY.question.incomplete);
    // 안내 자리는 처음부터 문서에 있는 aria-live 영역이고, 글이 있을 때만 다섯 형식이 같은 상자 모양으로 보인다.
    expect(notice?.getAttribute("role")).toBe("status");
    expect(notice?.getAttribute("aria-live")).toBe("polite");
    expect(notice?.className).toMatch(/rounded-lg/);
    await renderInput({ fmt: "react", cell: 2 }, { incomplete: true });
    expect(harness.container.querySelector("#q1-incomplete")).toBe(notice);
    expect(notice?.getAttribute("aria-live")).toBe("polite");
    expect(notice?.textContent).toBe("");
    expect(notice?.className).not.toMatch(/rounded-lg/);
    // 넘기기도 답이다.
    await renderInput({ fmt: "escape", which: "unsure" }, { incomplete: true });
    expect(harness.container.querySelector("#q1-incomplete")?.textContent).toBe("");
    await renderInput({ fmt: "escape", which: "na" }, { incomplete: true });
    expect(harness.container.querySelector("#q1-incomplete")?.textContent).toBe("");
  });

  it("번호, n/N, A/B, 가나 라벨이 화면에도 낭독 이름에도 없다", async () => {
    await renderInput({ fmt: "react", cell: 1 }, { incomplete: true });
    expect(labelProblemsIn(harness.container)).toEqual([]);
  });

  it("칸 이름 어디에도 숫자가 없다(다섯 칸은 낱말로 말한다)", async () => {
    await renderInput();
    for (const radio of radios()) expect(nameOf(radio)).not.toMatch(/\d/);
  });
});
