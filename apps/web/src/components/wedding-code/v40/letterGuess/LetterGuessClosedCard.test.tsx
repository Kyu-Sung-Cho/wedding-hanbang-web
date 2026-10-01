import { act, StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { V40_NOT_VALIDATED_PHRASE } from "@/lib/weddingCode/v40/copy";
import { V40_LETTER_GUESS_COPY, letterGuessLineText } from "@/lib/weddingCode/v40/letterGuess/letterGuessCopy";
import type { LetterGuessLine, LetterGuessSummary } from "@/lib/weddingCode/v40/letterGuess/types";
import { click, createHarness, labelledByText, pressKey, type Harness } from "../inputTestKit";
import { buttonByText, hasButton, textOf } from "../resultTestKit";
import { LetterGuessClosedCard } from "./LetterGuessClosedCard";
import { LetterGuessLines } from "./LetterGuessLines";

let harness: Harness;
beforeEach(() => {
  harness = createHarness();
});
afterEach(async () => {
  restoreVisibility();
  vi.restoreAllMocks();
  await harness.unmount();
});

const COPY = V40_LETTER_GUESS_COPY;
const OPEN = COPY.closedCard.openButton;
const CLOSE = COPY.closedCard.closeButton;

const LINE_PROCESS: LetterGuessLine = { axis: "process", guessed: "W", shown: "D" };
const LINE_SUPPORT: LetterGuessLine = { axis: "support", guessed: "A", shown: "H" };
const LINES: LetterGuessSummary = { kind: "lines", lines: [LINE_PROCESS, LINE_SUPPORT] };
const SAME: LetterGuessSummary = { kind: "same" };
const UNSETTLED: LetterGuessSummary = { kind: "unsettledOnly" };
const NONE: LetterGuessSummary = { kind: "none" };

async function mount(summary: LetterGuessSummary, headingLevel: 2 | 3 = 3, idPrefix?: string) {
  await harness.render(<LetterGuessClosedCard summary={summary} headingLevel={headingLevel} idPrefix={idPrefix} />);
  return harness.container.querySelector<HTMLElement>('[data-letter-guess="closed-card"]');
}

const body = (): HTMLElement | null => harness.container.querySelector<HTMLElement>("[data-letter-guess-body]");
const toggle = (): HTMLButtonElement => {
  const section = harness.container.querySelector<HTMLElement>('[data-letter-guess="closed-card"]') as HTMLElement;
  const button = section.querySelector<HTMLButtonElement>("button");
  if (button === null) throw new Error("토글 단추가 없어요");
  return button;
};

/** 화면이 숨겨졌다고 알린다(탭을 바꾸거나 앱을 내림). */
async function hideDocument(): Promise<void> {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

async function showDocument(): Promise<void> {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

function restoreVisibility(): void {
  Reflect.deleteProperty(document, "visibilityState");
}

describe("LetterGuessClosedCard: 요약이 none 이면 카드 전체를 그리지 않는다", () => {
  it("none 은 아무것도 그리지 않는다", async () => {
    expect(await mount(NONE)).toBeNull();
    expect(harness.container.innerHTML).toBe("");
  });

  it("열려 있다가 요약이 none 이 되면 사라지고, 다시 줄이 생겨도 닫힌 채로 시작한다", async () => {
    await mount(LINES);
    await click(toggle());
    expect(body()).not.toBeNull();
    await harness.render(<LetterGuessClosedCard summary={NONE} headingLevel={3} />);
    expect(harness.container.innerHTML).toBe("");
    await harness.render(<LetterGuessClosedCard summary={LINES} headingLevel={3} />);
    expect(body()).toBeNull();
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
  });
});

describe("LetterGuessClosedCard: 기본으로 닫혀 있다", () => {
  it("열기 전에는 줄이 문서에 없다(숨기는 스타일이 아니라 그리지 않는다): 요약 세 가지 모두", async () => {
    for (const summary of [LINES, SAME, UNSETTLED]) {
      const card = (await mount(summary)) as HTMLElement;
      expect(card.getAttribute("data-letter-guess-open"), summary.kind).toBe("false");
      expect(body(), summary.kind).toBeNull();
      expect(card.querySelector("li, ul, [data-letter-guess-sentence], [data-letter-guess-closing]"), summary.kind).toBeNull();
      const html = card.innerHTML;
      for (const line of [LINE_PROCESS, LINE_SUPPORT]) expect(html).not.toContain(letterGuessLineText(line));
      expect(html).not.toContain(COPY.lines.same);
      expect(html).not.toContain(COPY.lines.unsettledOnly);
      expect(html).not.toContain(COPY.lines.closing);
      // 글자 한 자도 문서에 없다(옆 사람이 본다 해도 어느 글자를 골랐는지 알 수 없다).
      expect(textOf(card)).not.toMatch(/[A-Z]/u);
      await harness.unmount();
      harness = createHarness();
    }
  });

  it("닫힌 카드에는 제목, 안내 한 줄, 열기 단추만 있다", async () => {
    const card = (await mount(LINES)) as HTMLElement;
    expect(card.querySelector("h3")?.textContent).toBe(COPY.lines.heading);
    expect(textOf(card)).toContain(COPY.closedCard.note);
    expect(card.querySelectorAll("button")).toHaveLength(1);
    expect(toggle().textContent).toBe(OPEN);
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(toggle().hasAttribute("aria-controls")).toBe(false);
    expect(OPEN).toBe("먼저 고른 글자와 나란히 보기");
    expect(COPY.closedCard.note).toBe("먼저 고른 글자는 누르기 전에는 보이지 않아요.");
  });

  it("제목 수준은 headingLevel 을 따르고 구역 이름은 제목이다", async () => {
    const level2 = (await mount(LINES, 2)) as HTMLElement;
    expect(level2.querySelector("h2")?.textContent).toBe(COPY.lines.heading);
    expect(labelledByText(level2)).toBe(COPY.lines.heading);
    await harness.unmount();
    harness = createHarness();
    const level3 = (await mount(LINES, 3)) as HTMLElement;
    expect(level3.querySelector("h3")?.textContent).toBe(COPY.lines.heading);
    expect(level3.querySelector("h2")).toBeNull();
  });
});

describe("LetterGuessClosedCard: 열고 가린다", () => {
  it("열기 단추를 누르면 줄이 나오고 단추는 가리기로 바뀌며 안내 한 줄은 사라진다", async () => {
    const card = (await mount(LINES)) as HTMLElement;
    await click(toggle());
    expect(card.getAttribute("data-letter-guess-open")).toBe("true");
    const opened = body() as HTMLElement;
    expect([...opened.querySelectorAll("li")].map((item) => item.textContent)).toStrictEqual([LINE_PROCESS, LINE_SUPPORT].map(letterGuessLineText));
    expect(opened.querySelector("[data-letter-guess-closing]")?.textContent).toBe(COPY.lines.closing);
    expect(toggle().textContent).toBe(CLOSE);
    expect(CLOSE).toBe("가리기");
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    expect(toggle().getAttribute("aria-controls")).toBe(opened.id);
    expect(opened.id).not.toBe("");
    expect(textOf(card)).not.toContain(COPY.closedCard.note);
    expect(hasButton(card, OPEN)).toBe(false);
  });

  it("같음과 나란히 놓을 수 없음도 열면 그 한 문장과 끝 줄이 나온다", async () => {
    await mount(SAME);
    await click(toggle());
    expect(body()?.querySelector("[data-letter-guess-sentence]")?.textContent).toBe(COPY.lines.same);
    await harness.unmount();
    harness = createHarness();
    await mount(UNSETTLED);
    await click(toggle());
    expect(body()?.querySelector("[data-letter-guess-sentence]")?.textContent).toBe(COPY.lines.unsettledOnly);
    expect(body()?.querySelector("[data-letter-guess-closing]")).not.toBeNull();
  });

  it("가리기를 누르면 줄이 문서에서 사라진다(스타일로 감추는 것이 아니다)", async () => {
    const card = (await mount(LINES)) as HTMLElement;
    await click(toggle());
    expect(body()).not.toBeNull();
    await click(buttonByText(card, CLOSE));
    expect(body()).toBeNull();
    expect(card.getAttribute("data-letter-guess-open")).toBe("false");
    expect(card.innerHTML).not.toContain(letterGuessLineText(LINE_PROCESS));
    expect(card.innerHTML).not.toContain(COPY.lines.closing);
    expect(toggle().textContent).toBe(OPEN);
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(textOf(card)).toContain(COPY.closedCard.note);
  });

  it("열었다 가리고 다시 열 수 있다", async () => {
    await mount(LINES);
    for (let round = 0; round < 3; round += 1) {
      await click(toggle());
      expect(body(), `열기 ${round}`).not.toBeNull();
      await click(toggle());
      expect(body(), `가리기 ${round}`).toBeNull();
    }
  });

  it("열었을 때의 구역 안쪽이 혼자 결과의 열린 구역과 같은 글이다", async () => {
    await mount(LINES);
    await click(toggle());
    const closedCardText = textOf(body() as HTMLElement);
    await harness.unmount();
    harness = createHarness();
    await harness.render(<LetterGuessLines summary={LINES} headingLevel={2} />);
    const lines = harness.container.querySelector<HTMLElement>('[data-letter-guess="lines"]') as HTMLElement;
    expect(textOf(lines)).toContain(closedCardText);
  });

  it("새로 그리면 다시 닫힌 채다(열림 상태는 이 화면 안의 메모리뿐이고 어디에도 저장하지 않는다)", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    await mount(LINES);
    await click(toggle());
    expect(body()).not.toBeNull();
    await harness.unmount();
    harness = createHarness();
    await mount(LINES);
    expect(body()).toBeNull();
    expect(setItem).not.toHaveBeenCalled();
    expect(getItem).not.toHaveBeenCalled();
  });

  it("카드 안에 고지 문장이 없다", async () => {
    await mount(LINES);
    await click(toggle());
    expect(textOf(harness.container)).not.toContain(V40_NOT_VALIDATED_PHRASE);
  });
});

describe("LetterGuessClosedCard: 화면이 숨겨지거나 Escape 를 누르면 닫힌다", () => {
  it("열린 동안 화면이 숨겨지면(visibilitychange 가 hidden) 닫힌다", async () => {
    await mount(LINES);
    await click(toggle());
    expect(body()).not.toBeNull();
    await hideDocument();
    expect(body()).toBeNull();
    expect(toggle().textContent).toBe(OPEN);
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
  });

  it("화면이 다시 보이는 것만으로는 열리지 않는다", async () => {
    await mount(LINES);
    await hideDocument();
    await showDocument();
    expect(body()).toBeNull();
  });

  it("visibilitychange 가 와도 상태가 보임(visible)이면 닫지 않는다", async () => {
    await mount(LINES);
    await click(toggle());
    await showDocument();
    expect(body()).not.toBeNull();
  });

  it("열린 동안 Escape 를 누르면 닫힌다. 다른 키는 닫지 않는다", async () => {
    await mount(LINES);
    await click(toggle());
    await pressKey("Enter");
    await pressKey("a");
    await pressKey("ArrowDown");
    expect(body()).not.toBeNull();
    await pressKey("Escape");
    expect(body()).toBeNull();
    expect(toggle().textContent).toBe(OPEN);
  });

  it("닫혀 있을 때의 Escape 와 visibilitychange 는 아무 일도 하지 않는다", async () => {
    await mount(LINES);
    await pressKey("Escape");
    await hideDocument();
    expect(body()).toBeNull();
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    // 그 뒤에도 눌러서 열 수 있다.
    await showDocument();
    await click(toggle());
    expect(body()).not.toBeNull();
  });

  it("열린 동안에만 문서에 두 가지 귀를 달고 닫히거나 사라지면 같은 귀를 뗀다(새는 귀가 없다)", async () => {
    const add = vi.spyOn(document, "addEventListener");
    const remove = vi.spyOn(document, "removeEventListener");
    await mount(LINES);
    const watched = (spy: typeof add) => spy.mock.calls.filter(([type]) => type === "visibilitychange" || type === "keydown");
    expect(watched(add)).toHaveLength(0);
    await click(toggle());
    const added = watched(add);
    expect(added.map(([type]) => type).sort()).toStrictEqual(["keydown", "visibilitychange"]);
    await click(toggle());
    const removedAfterClose = watched(remove);
    expect(removedAfterClose.map(([type]) => type).sort()).toStrictEqual(["keydown", "visibilitychange"]);
    // 달았던 바로 그 함수를 뗐다.
    for (const [type, listener] of added) expect(removedAfterClose.some(([t, l]) => t === type && l === listener)).toBe(true);
    // 다시 열고 그대로 사라져도 뗀다.
    await click(toggle());
    const removeCountBefore = watched(remove).length;
    await harness.unmount();
    harness = createHarness();
    expect(watched(remove).length).toBe(removeCountBefore + 2);
  });
});

describe("LetterGuessClosedCard: StrictMode", () => {
  it("이중 실행에서도 기본으로 닫혀 있고 열고 Escape 로 닫을 수 있다", async () => {
    await harness.render(
      <StrictMode>
        <LetterGuessClosedCard summary={LINES} headingLevel={3} />
      </StrictMode>,
    );
    expect(body()).toBeNull();
    await click(toggle());
    expect(body()).not.toBeNull();
    await pressKey("Escape");
    expect(body()).toBeNull();
  });
});

describe("LetterGuessClosedCard: id 와 이름", () => {
  it("본문 id 와 제목 id 는 접두어를 따른다(두 카드가 한 화면에 있어도 겹치지 않는다)", async () => {
    await harness.render(
      <>
        <LetterGuessClosedCard summary={LINES} headingLevel={3} idPrefix="a1" />
        <LetterGuessClosedCard summary={SAME} headingLevel={3} idPrefix="b2" />
      </>,
    );
    const buttons = harness.container.querySelectorAll("button");
    await click(buttons[0]);
    await click(buttons[1]);
    const ids = [...harness.container.querySelectorAll("[id]")].map((element) => element.id).sort();
    expect(ids).toStrictEqual(["a1-body", "a1-title", "b2-body", "b2-title"]);
    expect(buttons[0].getAttribute("aria-controls")).toBe("a1-body");
    expect(buttons[1].getAttribute("aria-controls")).toBe("b2-body");
  });

  it("토글 단추는 자기 구역 제목을 설명으로 가진다(두 사람 결과의 다른 구역에도 같은 이름 「가리기」가 있다)", async () => {
    await harness.render(
      <>
        <LetterGuessClosedCard summary={LINES} headingLevel={3} idPrefix="a1" />
        <LetterGuessClosedCard summary={SAME} headingLevel={3} idPrefix="b2" />
      </>,
    );
    const buttons = harness.container.querySelectorAll("button");
    expect(buttons[0].getAttribute("aria-describedby")).toBe("a1-title");
    expect(buttons[1].getAttribute("aria-describedby")).toBe("b2-title");
    await click(buttons[0]);
    expect(harness.container.querySelectorAll("button")[0].getAttribute("aria-describedby")).toBe("a1-title");
  });

  it("저장소와 네트워크와 주소를 만지지 않는다", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const hashBefore = window.location.hash;
    await mount(LINES);
    await click(toggle());
    await click(toggle());
    await pressKey("Escape");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(window.location.hash).toBe(hashBefore);
    vi.unstubAllGlobals();
  });
});
