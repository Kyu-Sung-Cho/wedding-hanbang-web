import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { V40_AXES, V40_AXIS_KEYS, V40_ESCAPES, axisInfo, letterInfo, type Letter } from "@/constants/weddingCodeV40";
import { V40_COPY, V40_NOT_VALIDATED_PHRASE } from "@/lib/weddingCode/v40/copy";
import { letterGuessChoices } from "@/lib/weddingCode/v40/letterGuess/letterGuess";
import { V40_LETTER_GUESS_COPY, letterGuessCardText, letterGuessStorageNote } from "@/lib/weddingCode/v40/letterGuess/letterGuessCopy";
import type { LetterGuess, LetterGuessStorageMode } from "@/lib/weddingCode/v40/letterGuess/types";
import type { FormBit } from "@/lib/weddingCode/v40/types";
import { click, createHarness, labelledByText, pressKey, radiosIn, type Harness } from "../inputTestKit";
import { ALLOWED_LETTERS, buttonByText, hasButton, standaloneCapitals, textOf } from "../resultTestKit";
import { LetterGuessScreen, type LetterGuessScreenProps } from "./LetterGuessScreen";

let harness: Harness;
beforeEach(() => {
  harness = createHarness();
});
afterEach(async () => {
  Reflect.deleteProperty(navigator, "sendBeacon");
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await harness.unmount();
});

function guess(...picks: (Letter | null)[]): LetterGuess {
  return picks as unknown as LetterGuess;
}

/** 지금 한 번에 부를 수 있게 콜백을 가짜로 둔 props. 두 번 눌림 막기는 기본으로 끈다(막기 시험만 켠다). */
function propsOf(overrides: Partial<LetterGuessScreenProps> = {}) {
  return {
    formBit: 0 as FormBit,
    initial: null,
    storageMode: "on" as LetterGuessStorageMode,
    turnGuardMs: 0,
    onContinue: vi.fn(),
    onSkip: vi.fn(),
    ...overrides,
  } satisfies LetterGuessScreenProps;
}

async function mount(overrides: Partial<LetterGuessScreenProps> = {}) {
  const props = propsOf(overrides);
  await harness.render(<LetterGuessScreen {...props} />);
  const root = harness.container.querySelector<HTMLElement>('[data-screen="letter-guess"]');
  if (root === null) throw new Error("화면 뿌리가 없어요");
  return { props, root };
}

/** 주제 하나의 블록과 그 안의 라디오 셋(두 글자, 잘 모르겠어요). */
function topicOf(root: HTMLElement, axis: string): { block: HTMLElement; radios: HTMLElement[] } {
  const block = root.querySelector<HTMLElement>(`[data-letter-guess-axis="${axis}"]`);
  if (block === null) throw new Error(`주제 블록이 없어요: ${axis}`);
  return { block, radios: radiosIn(block) };
}

const checkedIn = (radios: readonly HTMLElement[]): number[] => radios.flatMap((radio, index) => (radio.getAttribute("aria-checked") === "true" ? [index] : []));

// ---------------------------------------------------------------------------
// 구성
// ---------------------------------------------------------------------------

describe("LetterGuessScreen: 구성", () => {
  it("뿌리는 data-screen letter-guess 이고 초점을 받을 수 있으며 진행 막대가 없다(끼어들기 화면)", async () => {
    const { root } = await mount();
    expect(root.getAttribute("tabindex")).toBe("-1");
    expect(root.querySelector('[role="progressbar"], [data-progress]')).toBeNull();
    // 화면이 뜨면 뿌리로 초점이 간다(낭독기가 화면 이름을 읽는다).
    expect(document.activeElement).toBe(root);
    expect(labelledByText(root)).toBe(V40_LETTER_GUESS_COPY.screen.title);
  });

  it("제목 수준: 독립 화면은 1, 라운지 안(embedded)은 2", async () => {
    const standalone = await mount();
    expect(standalone.root.querySelector("h1")?.textContent).toBe(V40_LETTER_GUESS_COPY.screen.title);
    expect(standalone.root.querySelector("h2")).toBeNull();
    await harness.unmount();
    harness = createHarness();
    const embedded = await mount({ embedded: true });
    expect(embedded.root.querySelector("h2")?.textContent).toBe(V40_LETTER_GUESS_COPY.screen.title);
    expect(embedded.root.querySelector("h1")).toBeNull();
  });

  it("제목, 안내, 저장 안내 한 줄이 문구 파일의 글 그대로다", async () => {
    const { root } = await mount();
    const text = textOf(root);
    expect(text).toContain("결과를 보기 전에, 내가 어느 쪽에 가까운지 골라 볼까요?");
    expect(text).toContain(V40_LETTER_GUESS_COPY.screen.lead);
    expect(text).toContain(V40_LETTER_GUESS_COPY.screen.storageOn);
  });

  it("저장 안내는 저장 모드를 따른다(켜짐, 꺼짐, 막힘)", async () => {
    for (const mode of ["on", "off", "blocked"] as const) {
      const { root } = await mount({ storageMode: mode });
      const note = root.querySelector<HTMLElement>("[data-letter-guess-storage]");
      expect(note?.getAttribute("data-letter-guess-storage")).toBe(mode);
      expect(note?.textContent).toBe(letterGuessStorageNote(mode));
      await harness.unmount();
      harness = createHarness();
    }
    const { root } = await mount({ storageMode: "off" });
    expect(textOf(root)).not.toContain(V40_LETTER_GUESS_COPY.screen.storageOn);
    expect(textOf(root)).toContain("저장하지 않아요");
  });

  it("주제 네 개가 주제 순서로, 주제 이름은 상수의 제목 그대로 나온다", async () => {
    const { root } = await mount();
    const blocks = [...root.querySelectorAll<HTMLElement>("[data-letter-guess-axis]")];
    expect(blocks.map((block) => block.getAttribute("data-letter-guess-axis"))).toStrictEqual([...V40_AXIS_KEYS]);
    blocks.forEach((block, index) => {
      expect(block.querySelector("p")?.textContent).toBe(V40_AXES[index].title);
      const group = block.querySelector('[role="radiogroup"]');
      expect(group, V40_AXES[index].title).not.toBeNull();
      // 라디오 그룹의 이름이 주제 이름이다.
      expect(labelledByText(group as Element)).toBe(V40_AXES[index].title);
      expect((group as Element).getAttribute("aria-label")).toBe(V40_AXES[index].title);
    });
  });

  it("주제마다 라디오가 셋: 두 글자 카드(글자와 이름과 뜻 한 줄)와 「잘 모르겠어요」", async () => {
    const { root } = await mount();
    expect(radiosIn(root)).toHaveLength(12);
    for (const axis of V40_AXIS_KEYS) {
      const { radios } = topicOf(root, axis);
      expect(radios).toHaveLength(3);
      const [first, second] = letterGuessChoices(0, axis);
      expect(radios[0].textContent).toBe(letterGuessCardText(first));
      expect(radios[1].textContent).toBe(letterGuessCardText(second));
      expect(radios[2].textContent).toBe(V40_ESCAPES.unsure);
      // 글자 이름과 뜻은 상수에서 그대로 읽는다.
      expect(radios[0].textContent).toContain(letterInfo(first).meaning);
      expect(radios[1].textContent).toContain(letterInfo(second).name);
    }
  });

  it("글자 카드의 위아래는 폼 비트를 따른다: 폼 비트 0 은 앞 글자가 위, 1 은 뒤 글자가 위", async () => {
    for (const formBit of [0, 1] as const) {
      const { root } = await mount({ formBit });
      for (const axis of V40_AXIS_KEYS) {
        const { radios } = topicOf(root, axis);
        const info = axisInfo(axis);
        const top = formBit === 0 ? info.front : info.back;
        const bottom = formBit === 0 ? info.back : info.front;
        expect(radios[0].textContent?.startsWith(`${top} ${letterInfo(top).name}`), `${axis} 폼 비트 ${formBit} 위`).toBe(true);
        expect(radios[1].textContent?.startsWith(`${bottom} ${letterInfo(bottom).name}`), `${axis} 폼 비트 ${formBit} 아래`).toBe(true);
      }
      await harness.unmount();
      harness = createHarness();
    }
  });

  it("단추 셋: 결과 보기(주), 고르지 않고 결과 보기, 이전(onBack 이 있을 때만)", async () => {
    const { root } = await mount();
    expect(hasButton(root, "결과 보기")).toBe(true);
    expect(hasButton(root, "고르지 않고 결과 보기")).toBe(true);
    expect(hasButton(root, V40_COPY.question.previousButton)).toBe(false);
    await harness.unmount();
    harness = createHarness();
    const withBack = await mount({ onBack: vi.fn() });
    expect(hasButton(withBack.root, V40_COPY.question.previousButton)).toBe(true);
  });

  it("고지 문장이 없고, 번호나 A/B 라벨이나 숫자가 없고, 글자는 여덟 글자뿐이다", async () => {
    const { root } = await mount();
    const text = textOf(root);
    expect(text).not.toContain(V40_NOT_VALIDATED_PHRASE);
    expect(text).not.toMatch(/\d/u);
    expect(text).not.toMatch(/짐작/u);
    expect(text).not.toMatch(/번째|\d\s*\/\s*\d/u);
    for (const capital of standaloneCapitals(root)) expect(ALLOWED_LETTERS.has(capital), capital).toBe(true);
    // 질문 화면의 넘기기 단추(제 상황과 안 맞아요)는 이 화면에 없다: 「잘 모르겠어요」는 카드로만 있다.
    expect(text).not.toContain(V40_ESCAPES.notApplicable);
    expect([...root.querySelectorAll("button")].filter((button) => button.textContent === V40_ESCAPES.unsure && button.getAttribute("role") !== "radio")).toHaveLength(0);
  });

  it("문서 안의 id 가 겹치지 않는다(주제마다 접두어가 다르다)", async () => {
    const { root } = await mount();
    const ids = [...root.querySelectorAll("[id]")].map((element) => element.id);
    expect(ids.length).toBeGreaterThan(8);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ---------------------------------------------------------------------------
// 고르기
// ---------------------------------------------------------------------------

describe("LetterGuessScreen: 고르기와 나가기", () => {
  it("아무것도 안 고르고 결과 보기를 눌러도 진행한다: onContinue(null)", async () => {
    const { props, root } = await mount();
    await click(buttonByText(root, "결과 보기"));
    expect(props.onContinue).toHaveBeenCalledTimes(1);
    expect(props.onContinue).toHaveBeenCalledWith(null);
    expect(props.onSkip).not.toHaveBeenCalled();
  });

  it("글자를 고르면 그 카드가 눌린 모양이고 결과 보기가 고른 글자를 준다(안 고른 주제는 null)", async () => {
    const { props, root } = await mount();
    await click(topicOf(root, "money").radios[1]);
    await click(topicOf(root, "scope").radios[0]);
    expect(checkedIn(topicOf(root, "money").radios)).toStrictEqual([1]);
    expect(checkedIn(topicOf(root, "scope").radios)).toStrictEqual([0]);
    expect(checkedIn(topicOf(root, "process").radios)).toStrictEqual([]);
    await click(buttonByText(root, "결과 보기"));
    expect(props.onContinue).toHaveBeenCalledWith(guess("S", null, "U", null));
  });

  it("폼 비트 1 에서도 눌린 카드의 글자가 그대로 나온다(위아래가 뒤집혀도 고른 글자는 같다)", async () => {
    const { props, root } = await mount({ formBit: 1 });
    // 폼 비트 1: 위가 뒤 글자다. 돈의 위 카드는 S, 지쳤을 때의 아래 카드는 H.
    await click(topicOf(root, "money").radios[0]);
    await click(topicOf(root, "support").radios[1]);
    await click(buttonByText(root, "결과 보기"));
    expect(props.onContinue).toHaveBeenCalledWith(guess("S", null, null, "H"));
  });

  it("네 주제를 모두 고를 수 있고 바꿔 고르면 마지막이 남는다", async () => {
    const { props, root } = await mount();
    for (const axis of V40_AXIS_KEYS) await click(topicOf(root, axis).radios[0]);
    await click(topicOf(root, "process").radios[1]);
    await click(buttonByText(root, "결과 보기"));
    expect(props.onContinue).toHaveBeenCalledWith(guess("V", "D", "U", "H"));
  });

  it("「잘 모르겠어요」는 고르지 않음으로 센다: 카드는 눌린 모양이고 결과 보기에는 null 로 간다", async () => {
    const { props, root } = await mount();
    await click(topicOf(root, "money").radios[0]);
    await click(topicOf(root, "money").radios[2]);
    await click(topicOf(root, "process").radios[2]);
    expect(checkedIn(topicOf(root, "money").radios)).toStrictEqual([2]);
    expect(checkedIn(topicOf(root, "process").radios)).toStrictEqual([2]);
    await click(buttonByText(root, "결과 보기"));
    // 둘 다 잘 모르겠다고 했고 다른 주제는 안 눌렀으니 고른 것이 없다.
    expect(props.onContinue).toHaveBeenCalledWith(null);
  });

  it("잘 모르겠어요를 누른 주제가 있어도 다른 주제에서 고른 글자는 그대로 나간다", async () => {
    const { props, root } = await mount();
    await click(topicOf(root, "money").radios[2]);
    await click(topicOf(root, "support").radios[1]);
    await click(buttonByText(root, "결과 보기"));
    expect(props.onContinue).toHaveBeenCalledWith(guess(null, null, null, "A"));
  });

  it("잘 모르겠어요를 누른 뒤에 글자를 고르면 글자가 눌린다", async () => {
    const { props, root } = await mount();
    await click(topicOf(root, "scope").radios[2]);
    await click(topicOf(root, "scope").radios[1]);
    expect(checkedIn(topicOf(root, "scope").radios)).toStrictEqual([1]);
    await click(buttonByText(root, "결과 보기"));
    expect(props.onContinue).toHaveBeenCalledWith(guess(null, null, "F", null));
  });

  it("방향키로 라디오 사이를 옮기며 고른다(입력 컴포넌트를 그대로 재사용한다)", async () => {
    const { root } = await mount();
    const { radios } = topicOf(root, "money");
    radios[0].focus();
    await pressKey("ArrowDown");
    expect(checkedIn(topicOf(root, "money").radios)).toStrictEqual([1]);
    expect(document.activeElement).toBe(topicOf(root, "money").radios[1]);
    await pressKey("ArrowDown");
    expect(checkedIn(topicOf(root, "money").radios)).toStrictEqual([2]);
    await pressKey("ArrowUp");
    expect(checkedIn(topicOf(root, "money").radios)).toStrictEqual([1]);
  });

  it("고르지 않고 결과 보기는 onSkip 을 부르고 onContinue 는 부르지 않는다(고른 것이 있어도)", async () => {
    const { props, root } = await mount();
    await click(topicOf(root, "money").radios[0]);
    await click(buttonByText(root, "고르지 않고 결과 보기"));
    expect(props.onSkip).toHaveBeenCalledTimes(1);
    expect(props.onContinue).not.toHaveBeenCalled();
  });

  it("이전은 onBack 을 부른다", async () => {
    const onBack = vi.fn();
    const { props, root } = await mount({ onBack });
    await click(buttonByText(root, V40_COPY.question.previousButton));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(props.onContinue).not.toHaveBeenCalled();
    expect(props.onSkip).not.toHaveBeenCalled();
  });

  it("이전은 지금까지 고른 것을 함께 넘기고(안 골랐으면 null) 저장은 부모가 정한다", async () => {
    const onBack = vi.fn();
    const first = await mount({ onBack });
    await click(buttonByText(first.root, V40_COPY.question.previousButton));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onBack).toHaveBeenLastCalledWith(null);
  });

  it("이전에 넘기는 값은 글자만이다: 「잘 모르겠어요」와 안 누른 주제는 null", async () => {
    const onBack = vi.fn();
    const { root } = await mount({ onBack });
    await click(topicOf(root, "money").radios[0]);
    await click(topicOf(root, "support").radios[2]);
    await click(buttonByText(root, V40_COPY.question.previousButton));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onBack).toHaveBeenCalledWith(guess("V", null, null, null));
  });

  it("StrictMode 의 이중 실행에서도 고른 것과 콜백이 한 번씩만 나간다", async () => {
    const props = propsOf();
    await harness.render(
      <StrictMode>
        <LetterGuessScreen {...props} />
      </StrictMode>,
    );
    const root = harness.container.querySelector<HTMLElement>('[data-screen="letter-guess"]') as HTMLElement;
    await click(topicOf(root, "money").radios[0]);
    await click(buttonByText(root, "결과 보기"));
    expect(props.onContinue).toHaveBeenCalledTimes(1);
    expect(props.onContinue).toHaveBeenCalledWith(guess("V", null, null, null));
    expect(props.onSkip).not.toHaveBeenCalled();
  });

  it("부모가 다시 그려도 고른 것이 남는다(상태는 화면 안에 있다)", async () => {
    const first = propsOf();
    await harness.render(<LetterGuessScreen {...first} />);
    const root = harness.container.querySelector<HTMLElement>('[data-screen="letter-guess"]') as HTMLElement;
    await click(topicOf(root, "money").radios[1]);
    const second = propsOf();
    await harness.render(<LetterGuessScreen {...second} />);
    expect(checkedIn(topicOf(root, "money").radios)).toStrictEqual([1]);
    await click(buttonByText(root, "결과 보기"));
    expect(second.onContinue).toHaveBeenCalledWith(guess("S", null, null, null));
    expect(first.onContinue).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 이미 골라 둔 것
// ---------------------------------------------------------------------------

describe("LetterGuessScreen: 이미 골라 둔 것(initial)", () => {
  it("골라 둔 글자가 눌린 채로 뜬다(폼 비트 0)", async () => {
    const { props, root } = await mount({ initial: guess("S", "W", null, "A") });
    expect(checkedIn(topicOf(root, "money").radios)).toStrictEqual([1]);
    expect(checkedIn(topicOf(root, "process").radios)).toStrictEqual([0]);
    expect(checkedIn(topicOf(root, "scope").radios)).toStrictEqual([]);
    expect(checkedIn(topicOf(root, "support").radios)).toStrictEqual([1]);
    await click(buttonByText(root, "결과 보기"));
    expect(props.onContinue).toHaveBeenCalledWith(guess("S", "W", null, "A"));
  });

  it("폼 비트가 1 이면 같은 글자가 다른 위치에서 눌린다(글자 기준으로 되돌린다)", async () => {
    const { props, root } = await mount({ formBit: 1, initial: guess("S", "W", null, "A") });
    expect(checkedIn(topicOf(root, "money").radios)).toStrictEqual([0]);
    expect(checkedIn(topicOf(root, "process").radios)).toStrictEqual([1]);
    expect(checkedIn(topicOf(root, "support").radios)).toStrictEqual([0]);
    await click(buttonByText(root, "결과 보기"));
    expect(props.onContinue).toHaveBeenCalledWith(guess("S", "W", null, "A"));
  });

  it("그 주제에 없는 글자는 눌리지 않는다(다른 주제의 글자가 섞인 값은 그 칸을 버린다)", async () => {
    const stray = ["W", null, "V", "S"] as unknown as LetterGuess;
    const { props, root } = await mount({ initial: stray });
    for (const axis of V40_AXIS_KEYS) expect(checkedIn(topicOf(root, axis).radios), axis).toStrictEqual([]);
    await click(buttonByText(root, "결과 보기"));
    expect(props.onContinue).toHaveBeenCalledWith(null);
  });
});

// ---------------------------------------------------------------------------
// 두 번 눌림 막기
// ---------------------------------------------------------------------------

describe("LetterGuessScreen: 두 번 눌림 막기", () => {
  const T0 = new Date(2026, 9, 1, 12, 0, 0).getTime();

  /** 날짜만 가짜로 두고(타이머는 그대로) 정해 둔 시각에 화면을 띄운다. turnGuardMs 를 안 주면 화면의 기본값을 쓴다. */
  async function mountAt(turnGuardMs?: number) {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    const onContinue = vi.fn();
    const onSkip = vi.fn();
    const onBack = vi.fn();
    await harness.render(
      turnGuardMs === undefined ? (
        <LetterGuessScreen formBit={0} initial={null} storageMode="on" onContinue={onContinue} onSkip={onSkip} onBack={onBack} />
      ) : (
        <LetterGuessScreen formBit={0} initial={null} storageMode="on" turnGuardMs={turnGuardMs} onContinue={onContinue} onSkip={onSkip} onBack={onBack} />
      ),
    );
    const root = harness.container.querySelector<HTMLElement>('[data-screen="letter-guess"]') as HTMLElement;
    return { root, onContinue, onSkip, onBack };
  }

  it("뜬 직후 300밀리초 안의 결과 보기와 고르지 않고 결과 보기는 무시하고 그 뒤에는 통한다(기본값)", async () => {
    const { root, onContinue, onSkip } = await mountAt();
    await click(buttonByText(root, "결과 보기"));
    await click(buttonByText(root, "고르지 않고 결과 보기"));
    expect(onContinue).not.toHaveBeenCalled();
    expect(onSkip).not.toHaveBeenCalled();
    vi.setSystemTime(T0 + 299);
    await click(buttonByText(root, "결과 보기"));
    expect(onContinue).not.toHaveBeenCalled();
    vi.setSystemTime(T0 + 300);
    await click(buttonByText(root, "결과 보기"));
    expect(onContinue).toHaveBeenCalledTimes(1);
    await click(buttonByText(root, "고르지 않고 결과 보기"));
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it("turnGuardMs 를 주면 그 시간만큼 막고 0 이면 끈다", async () => {
    const guarded = await mountAt(1000);
    vi.setSystemTime(T0 + 999);
    await click(buttonByText(guarded.root, "결과 보기"));
    expect(guarded.onContinue).not.toHaveBeenCalled();
    vi.setSystemTime(T0 + 1000);
    await click(buttonByText(guarded.root, "결과 보기"));
    expect(guarded.onContinue).toHaveBeenCalledTimes(1);
    await harness.unmount();
    harness = createHarness();
    const off = await mountAt(0);
    await click(buttonByText(off.root, "결과 보기"));
    expect(off.onContinue).toHaveBeenCalledTimes(1);
  });

  it("이전과 글자 고르기는 막지 않는다(앞으로 넘기는 단추 둘만 막는다)", async () => {
    const { root, onBack, onContinue } = await mountAt(1000);
    await click(topicOf(root, "money").radios[0]);
    expect(checkedIn(topicOf(root, "money").radios)).toStrictEqual([0]);
    await click(buttonByText(root, V40_COPY.question.previousButton));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onContinue).not.toHaveBeenCalled();
  });

  it("막힌 누름은 고른 것을 건드리지 않는다(그 뒤에 누르면 고른 글자가 나간다)", async () => {
    const { root, onContinue } = await mountAt(500);
    await click(topicOf(root, "process").radios[1]);
    await click(buttonByText(root, "결과 보기"));
    expect(onContinue).not.toHaveBeenCalled();
    vi.setSystemTime(T0 + 500);
    await click(buttonByText(root, "결과 보기"));
    expect(onContinue).toHaveBeenCalledWith(guess(null, "D", null, null));
  });
});

// ---------------------------------------------------------------------------
// 저장소, 네트워크, 링크를 만지지 않는다
// ---------------------------------------------------------------------------

describe("LetterGuessScreen: 저장소, 네트워크, 링크를 만지지 않는다", () => {
  it("고르고 넘기고 돌아가는 동안 브라우저 저장소 호출, fetch, sendBeacon, 주소 바꾸기가 0건이다", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    const removeItem = vi.spyOn(Storage.prototype, "removeItem");
    const fetchSpy = vi.fn();
    const beaconSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    Object.defineProperty(navigator, "sendBeacon", { value: beaconSpy, configurable: true, writable: true });
    const hashBefore = window.location.hash;
    const stateBefore = window.history.state;

    const onBack = vi.fn();
    const { props, root } = await mount({ onBack, initial: guess("V", null, null, null) });
    for (const axis of V40_AXIS_KEYS) await click(topicOf(root, axis).radios[1]);
    await click(topicOf(root, "money").radios[2]);
    await click(buttonByText(root, "결과 보기"));
    await click(buttonByText(root, "고르지 않고 결과 보기"));
    await click(buttonByText(root, V40_COPY.question.previousButton));
    expect(props.onContinue).toHaveBeenCalledTimes(1);

    expect(setItem).not.toHaveBeenCalled();
    expect(getItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(beaconSpy).not.toHaveBeenCalled();
    expect(window.location.hash).toBe(hashBefore);
    expect(window.history.state).toStrictEqual(stateBefore);
    expect(window.name).toBe("");
    // 고른 글자는 화면 어디에도 속성값으로 새지 않는다(콜백으로만 나간다).
    expect(harness.container.innerHTML).not.toMatch(/ga=|gb=|hanbang:wedding-code/u);
  });
});
