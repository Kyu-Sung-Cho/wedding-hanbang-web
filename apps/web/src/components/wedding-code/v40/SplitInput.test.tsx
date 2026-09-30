import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { V40_ESCAPES, V40_SPLIT_TOTAL } from "@/constants/weddingCodeV40";
import {
  V40_COPY,
  splitAddLabel,
  splitCountLabel,
  splitRemainingNotice,
  splitRemoveLabel,
  splitStatus,
} from "@/lib/weddingCode/v40/copy";
import type { SplitView, SplitViewAnswer, ViewAnswer } from "@/lib/weddingCode/v40/types";
import { ItemFrame } from "./ItemFrame";
import { SplitInput, splitRemaining } from "./SplitInput";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ---------------------------------------------------------------------------
// 고정 표본: 폼 비트 0 과 1 의 화면(뷰). 폼 비트 1 은 앞 두 항목의 자리만 바뀌고 세 번째는 그대로다.
// 컴포넌트는 극과 폼 비트를 모르므로 어느 쪽 뷰든 화면 순서의 칸 수를 그대로 알려야 한다.
// ---------------------------------------------------------------------------

const ENTRY_TEXTS = [
  "상대와 시간을 맞춰 같이 전화하고 같이 정하기",
  "내가 맡아서 알아보고 결과를 정리해서 알려 주기",
  "일단 미루고 다른 급한 일부터 하기",
] as const;

function makeView(formBit: 0 | 1): SplitView {
  const [first, second, third] = ENTRY_TEXTS;
  const texts = formBit === 0 ? [first, second, third] : [second, first, third];
  return {
    id: `fixture.split.${formBit}`,
    fmt: "split",
    caption: "웨딩홀 상담 잡기",
    stem: "이번 주말까지 웨딩홀 상담 두 곳을 잡아야 해요. 준비 에너지를 어디에 쓸지 나눠 놓아 주세요.",
    escapes: { unsure: V40_ESCAPES.unsure, notApplicable: V40_ESCAPES.notApplicable },
    entries: [{ text: texts[0] }, { text: texts[1] }, { text: texts[2] }],
    total: V40_SPLIT_TOTAL,
  };
}

function splitAnswer(a: number, b: number, c: number): SplitViewAnswer {
  return { fmt: "split", counts: [a, b, c] };
}

// ---------------------------------------------------------------------------
// 화면 붙이기
// ---------------------------------------------------------------------------

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/** 화면 답을 되먹여 주는 부모. 실제 흐름(reducer 의 drafts)처럼 중간 상태도 다시 value 로 내려준다. */
function Harness({
  view,
  initial = null,
  incomplete = false,
  idPrefix = "q1",
  onAnswer,
}: {
  view: SplitView;
  initial?: ViewAnswer | null;
  incomplete?: boolean;
  idPrefix?: string;
  onAnswer?: (answer: ViewAnswer) => void;
}) {
  const [value, setValue] = useState<ViewAnswer | null>(initial);
  return (
    <SplitInput
      view={view}
      value={value}
      idPrefix={idPrefix}
      incomplete={incomplete}
      onAnswer={(answer) => {
        onAnswer?.(answer);
        setValue(answer);
      }}
    />
  );
}

function render(node: React.ReactNode) {
  act(() => root.render(node));
}

function addButton(index: number): HTMLButtonElement {
  return host.querySelectorAll<HTMLButtonElement>('[data-step="add"]')[index];
}

function removeButton(index: number): HTMLButtonElement {
  return host.querySelectorAll<HTMLButtonElement>('[data-step="remove"]')[index];
}

function countTexts(): string[] {
  return [...host.querySelectorAll("[data-count]")].map((element) => element.textContent ?? "");
}

/** 눈에 보이는 남은 칸 글(aria-live 영역 안의 보이는 부분). */
function remainingEl(): HTMLElement {
  const element = host.querySelector<HTMLElement>("[data-split-remaining]");
  if (!element) throw new Error("남은 칸 영역이 없어요");
  return element;
}

/** 남은 칸을 알리는 aria-live 영역 전체(낭독기에만 읽히는 방금 바꾼 항목의 칸 수를 포함한다). */
function liveEl(): HTMLElement {
  const element = host.querySelector<HTMLElement>("[data-split-live]");
  if (!element) throw new Error("남은 칸 aria-live 영역이 없어요");
  return element;
}

/** 다음을 눌렀는데 칸이 남았을 때의 안내 영역(목록 위). */
function noticeEl(): HTMLElement {
  const element = host.querySelector<HTMLElement>("[data-split-notice]");
  if (!element) throw new Error("안내 영역이 없어요");
  return element;
}

/** 항목 index 의 카드 안에서 누를 수 없는 단추의 이유가 뜨는 aria-live 영역. */
function blockedEl(index: number): HTMLElement {
  const element = host.querySelectorAll<HTMLElement>("[data-split-blocked]")[index];
  if (!element) throw new Error(`항목 ${index} 의 이유 영역이 없어요`);
  return element;
}

/** 위 요소가 아래 요소보다 문서에서 앞에 있는가. */
function isBefore(first: Node, second: Node): boolean {
  return (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

/** aria-describedby 가 가리키는 글을 이어 붙인다(숨긴 글도 설명으로 읽힌다). */
function describedText(element: Element): string {
  return (element.getAttribute("aria-describedby") ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ");
}

// ---------------------------------------------------------------------------
// 키보드 흉내. jsdom 은 키의 기본 동작(엔터와 스페이스로 단추 누르기)을 하지 않는다.
// 아래 도우미는 브라우저가 하는 기본 동작만 대신하고, keydown 이 취소(preventDefault)되면 기본 동작도 하지 않는다.
// ---------------------------------------------------------------------------

function keydown(target: HTMLElement, key: string): boolean {
  let notPrevented = true;
  act(() => {
    notPrevented = target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
  return notPrevented;
}

/** 단추에서 엔터나 스페이스: 초점을 두고 눌렀을 때 브라우저는 단추를 클릭한다. */
function press(target: HTMLElement, key: "Enter" | " " = "Enter") {
  target.focus();
  if (keydown(target, key)) act(() => target.click());
}

/** 탭 키가 서는 자리(DOM 순서). */
function tabStops(): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea, [tabindex]")].filter(
    (element) => !element.hasAttribute("disabled") && element.getAttribute("tabindex") !== "-1",
  );
}

/** 눈에 보이는 글(낭독 전용과 숨김 글 제외). */
function visibleText(): string {
  const copy = host.cloneNode(true) as HTMLElement;
  copy.querySelectorAll(".sr-only, [hidden], [aria-hidden='true']").forEach((node) => node.remove());
  // 요소마다 앞에 공백을 끼운다. 그러지 않으면 항목 글 앞의 「A.」나 「가.」 라벨이 앞 요소의 글에 붙어서
  // 아래 (^|\s) 로 찾는 검사가 라벨을 보지 못한다.
  copy.querySelectorAll("*").forEach((node) => node.before(" "));
  return copy.textContent ?? "";
}

// ---------------------------------------------------------------------------
// 시험
// ---------------------------------------------------------------------------

describe("splitRemaining (칸을 다 놓았는지 화면이 읽는 값)", () => {
  it("답이 없거나 다른 형식이면 total 전부가 남았다", () => {
    expect(splitRemaining(null, 6)).toBe(6);
    expect(splitRemaining({ fmt: "escape", which: "unsure" }, 6)).toBe(6);
    expect(splitRemaining({ fmt: "bestworst", best: 1, worst: 2 }, 6)).toBe(6);
  });

  it("합이 6 미만이면 남은 칸 수, 합이 6 이면 0", () => {
    expect(splitRemaining(splitAnswer(1, 0, 0), 6)).toBe(5);
    expect(splitRemaining(splitAnswer(2, 3, 0), 6)).toBe(1);
    expect(splitRemaining(splitAnswer(2, 3, 1), 6)).toBe(0);
    expect(splitRemaining(splitAnswer(6, 0, 0), 6)).toBe(0);
  });

  it("망가진 값은 0칸으로 보고, 남은 칸은 음수가 되지 않는다", () => {
    expect(splitRemaining(splitAnswer(-1, 1.5, Number.NaN), 6)).toBe(6);
    expect(splitRemaining(splitAnswer(6, 6, 6), 6)).toBe(0);
  });
});

describe("SplitInput 구성", () => {
  it("항목 셋마다 빼기, 더하기 단추와 현재 칸 수가 있고, 남은 칸이 함께 보인다", () => {
    render(<Harness view={makeView(0)} />);
    expect(host.querySelectorAll("li")).toHaveLength(3);
    expect(host.querySelectorAll("[data-step]")).toHaveLength(6);
    ENTRY_TEXTS.forEach((text, index) => {
      expect(removeButton(index).getAttribute("aria-label")).toBe(splitRemoveLabel(text));
      expect(addButton(index).getAttribute("aria-label")).toBe(splitAddLabel(text));
    });
    expect(countTexts()).toEqual(["0칸", "0칸", "0칸"]);
    expect(remainingEl().textContent).toBe(splitStatus(6));
    // 항목 글이 화면에 그대로 나온다.
    for (const text of ENTRY_TEXTS) expect(host.textContent).toContain(text);
  });

  it("드래그가 없다: 끌 수 있는 요소도, 슬라이더도, 범위 입력도 없다", () => {
    render(<Harness view={makeView(0)} initial={splitAnswer(2, 1, 1)} />);
    expect(host.querySelectorAll("[draggable]")).toHaveLength(0);
    expect(host.querySelectorAll('input[type="range"], [role="slider"], input')).toHaveLength(0);
  });

  it("어떤 단추에도 disabled 속성이 없다: 처음, 중간, 다 놓은 뒤 모두", () => {
    const answers: ViewAnswer[] = [];
    render(<Harness view={makeView(0)} onAnswer={(answer) => answers.push(answer)} />);
    const assertNoDisabledAttribute = () => {
      expect(host.querySelectorAll("[disabled]:not([hidden])")).toHaveLength(0);
      for (const button of host.querySelectorAll("button")) expect(button.disabled).toBe(false);
    };
    assertNoDisabledAttribute();
    act(() => addButton(0).click());
    assertNoDisabledAttribute();
    for (let step = 0; step < 5; step += 1) act(() => addButton(1).click());
    assertNoDisabledAttribute();
    expect(splitRemaining(answers[answers.length - 1], 6)).toBe(0);
  });

  it("보이는 글에 번호 라벨이나 A/B 가 없다: 숫자는 몇 칸과 남은 칸 수뿐이다", () => {
    render(<Harness view={makeView(0)} initial={splitAnswer(2, 1, 0)} />);
    const text = visibleText();
    expect(text.replace(/\d+칸/g, "").replace(/\d+개/g, "")).not.toMatch(/\d/);
    expect(text).not.toMatch(/(^|\s)[A-Za-z]([.):]|\s|$)/);
    expect(text).not.toMatch(/(^|\s)[가나다라][.)]/);
    expect(text).not.toMatch(/\d+\s*\/\s*\d+/);
    // 칸 표시 줄(눈으로 보는 작은 네모)은 글자가 없고 낭독에서 빠진다.
    for (const pips of host.querySelectorAll("[data-pips]")) {
      expect(pips.getAttribute("aria-hidden")).toBe("true");
      expect(pips.textContent).toBe("");
    }
  });

  it("한 화면에 두 문항이 있어도 id 가 겹치지 않는다", () => {
    render(
      <div>
        <Harness view={makeView(0)} idPrefix="q1" />
        <Harness view={makeView(0)} idPrefix="q2" />
      </div>,
    );
    const ids = [...host.querySelectorAll("[id]")].map((element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("답이 다른 형식이면 모두 0칸으로 시작하고 남은 칸 6칸을 알린다", () => {
    render(<Harness view={makeView(0)} initial={{ fmt: "bestworst", best: 1, worst: 2 }} />);
    expect(countTexts()).toEqual(["0칸", "0칸", "0칸"]);
    expect(remainingEl().textContent).toBe(splitStatus(6));
  });

  it("넘기기(escape) 답이면 칸은 0칸으로 돌아가고 남은 칸 안내는 비워 둔다(틀이 넘어갔다고 알린다)", () => {
    render(<Harness key="na" view={makeView(0)} initial={{ fmt: "escape", which: "na" }} />);
    expect(countTexts()).toEqual(["0칸", "0칸", "0칸"]);
    expect(remainingEl().textContent).toBe("");
    // 영역은 그대로 문서에 있어 칸을 놓으면 다시 바뀐 글이 낭독된다.
    expect(liveEl().getAttribute("role")).toBe("status");
    render(<Harness key="unsure" view={makeView(0)} initial={{ fmt: "escape", which: "unsure" }} idPrefix="u" />);
    expect(remainingEl().textContent).toBe("");
  });

  it("남은 칸과 다음 안내는 항목 목록보다 문서에서 앞에 있다(작은 화면에서 첫 항목을 만지는 동안 함께 보인다)", () => {
    render(<Harness view={makeView(0)} incomplete />);
    const list = host.querySelector("ul")!;
    expect(isBefore(liveEl(), list)).toBe(true);
    expect(isBefore(noticeEl(), list)).toBe(true);
    expect(isBefore(liveEl(), noticeEl())).toBe(true);
    // 이유 영역은 각 항목의 카드 안에 있다.
    host.querySelectorAll("li").forEach((item, index) => expect(item.contains(blockedEl(index))).toBe(true));
  });
});

describe("SplitInput 칸 놓기", () => {
  it("합이 6 이 되기 전에도 중간 상태를 그때그때 화면 순서의 칸 수로 알린다", () => {
    const answers: ViewAnswer[] = [];
    render(<Harness view={makeView(0)} onAnswer={(answer) => answers.push(answer)} />);
    act(() => addButton(1).click());
    act(() => addButton(1).click());
    act(() => addButton(0).click());
    act(() => removeButton(1).click());
    expect(answers).toEqual([splitAnswer(0, 1, 0), splitAnswer(0, 2, 0), splitAnswer(1, 2, 0), splitAnswer(1, 1, 0)]);
    expect(countTexts()).toEqual(["1칸", "1칸", "0칸"]);
  });

  it("한 곳에 6칸을 몰아 놓아도 된다", () => {
    const answers: ViewAnswer[] = [];
    render(<Harness view={makeView(0)} onAnswer={(answer) => answers.push(answer)} />);
    for (let step = 0; step < 6; step += 1) act(() => addButton(2).click());
    expect(answers[answers.length - 1]).toEqual(splitAnswer(0, 0, 6));
    expect(countTexts()).toEqual(["0칸", "0칸", "6칸"]);
  });

  it("폼 비트 1 뷰(앞 두 항목이 서로 바뀜)에서도 화면 순서의 칸 수를 그대로 알린다", () => {
    const answers: ViewAnswer[] = [];
    render(<Harness view={makeView(1)} onAnswer={(answer) => answers.push(answer)} />);
    // 화면 첫 항목은 폼 비트 0 의 둘째 항목 글이다. 세 번째는 그대로다.
    expect(addButton(0).getAttribute("aria-label")).toBe(splitAddLabel(ENTRY_TEXTS[1]));
    expect(addButton(1).getAttribute("aria-label")).toBe(splitAddLabel(ENTRY_TEXTS[0]));
    expect(addButton(2).getAttribute("aria-label")).toBe(splitAddLabel(ENTRY_TEXTS[2]));
    act(() => addButton(0).click());
    act(() => addButton(0).click());
    act(() => addButton(2).click());
    expect(answers).toEqual([splitAnswer(1, 0, 0), splitAnswer(2, 0, 0), splitAnswer(2, 0, 1)]);
  });

  it("칸을 뺀다: 0칸 밑으로 내려가지 않는다", () => {
    render(<Harness view={makeView(0)} initial={splitAnswer(1, 0, 0)} />);
    act(() => removeButton(0).click());
    expect(countTexts()).toEqual(["0칸", "0칸", "0칸"]);
    act(() => removeButton(0).click());
    expect(countTexts()).toEqual(["0칸", "0칸", "0칸"]);
  });

  it("합은 6 을 넘지 않는다", () => {
    const answers: ViewAnswer[] = [];
    render(<Harness view={makeView(0)} initial={splitAnswer(3, 3, 0)} onAnswer={(answer) => answers.push(answer)} />);
    act(() => addButton(2).click());
    expect(answers).toEqual([]);
    expect(countTexts()).toEqual(["3칸", "3칸", "0칸"]);
  });
});

describe("SplitInput 남은 칸 안내 (aria-live)", () => {
  it("남은 칸은 처음부터 있던 하나의 aria-live 영역에서 바뀐다", () => {
    render(<Harness view={makeView(0)} />);
    const live = liveEl();
    expect(live.getAttribute("role")).toBe("status");
    expect(live.getAttribute("aria-live")).toBe("polite");
    expect(live.getAttribute("aria-atomic")).toBe("true");
    const remaining = remainingEl();
    expect(live.contains(remaining)).toBe(true);
    const seen = [remaining.textContent];
    for (let step = 0; step < 6; step += 1) {
      act(() => addButton(step % 3).click());
      seen.push(remainingEl().textContent);
      expect(liveEl()).toBe(live);
    }
    expect(seen).toEqual([6, 5, 4, 3, 2, 1, 0].map(splitStatus));
    expect(seen[6]).toBe(V40_COPY.inputs.splitAllPlacedAnnouncement);
  });

  it("칸을 바꾸면 남은 칸과 함께 방금 바꾼 항목의 새 칸 수를 같은 영역에서 낭독기에만 읽어 준다", () => {
    render(<Harness view={makeView(0)} />);
    // 처음에는 바꾼 항목이 없어서 남은 칸만 있다.
    expect(liveEl().textContent).toBe(splitStatus(6));
    expect(host.querySelector("[data-split-changed]")).toBeNull();

    act(() => addButton(1).click());
    const changed = host.querySelector<HTMLElement>("[data-split-changed]");
    expect(changed).not.toBeNull();
    expect(changed?.classList.contains("sr-only")).toBe(true);
    expect(changed?.textContent).toBe(`${splitCountLabel(ENTRY_TEXTS[1], 1)}. `);
    expect(liveEl().textContent).toBe(`${splitCountLabel(ENTRY_TEXTS[1], 1)}. ${splitStatus(5)}`);

    act(() => addButton(1).click());
    act(() => addButton(2).click());
    expect(liveEl().textContent).toBe(`${splitCountLabel(ENTRY_TEXTS[2], 1)}. ${splitStatus(3)}`);
    act(() => removeButton(1).click());
    expect(liveEl().textContent).toBe(`${splitCountLabel(ENTRY_TEXTS[1], 1)}. ${splitStatus(4)}`);
    // 눈에 보이는 글은 남은 칸 하나뿐이다.
    expect(visibleText()).toContain(splitStatus(4));
    expect(visibleText()).not.toContain(splitCountLabel(ENTRY_TEXTS[1], 1));
  });

  it("누를 수 없는 단추를 눌러도 이 영역의 글은 바뀌지 않는다(이유는 따로 알린다)", () => {
    render(<Harness view={makeView(0)} initial={splitAnswer(3, 3, 0)} />);
    act(() => removeButton(2).click());
    expect(liveEl().textContent).toBe(splitStatus(0));
    act(() => addButton(2).click());
    expect(liveEl().textContent).toBe(splitStatus(0));
  });

  it("넘기기 답으로 바뀌면 방금 바꾼 항목의 칸 수 낭독은 사라진다", () => {
    const view = makeView(0);
    function Parent() {
      const [value, setValue] = useState<ViewAnswer | null>(null);
      return (
        <div>
          <SplitInput view={view} value={value} idPrefix="q1" onAnswer={setValue} />
          <button type="button" data-escape onClick={() => setValue({ fmt: "escape", which: "unsure" })}>
            넘기기
          </button>
        </div>
      );
    }
    render(<Parent />);
    act(() => addButton(0).click());
    expect(host.querySelector("[data-split-changed]")).not.toBeNull();
    act(() => host.querySelector<HTMLButtonElement>("[data-escape]")!.click());
    expect(host.querySelector("[data-split-changed]")).toBeNull();
    expect(liveEl().textContent).toBe("");
    expect(countTexts()).toEqual(["0칸", "0칸", "0칸"]);
  });

  it("칸을 빼면 남은 칸이 다시 늘어난다", () => {
    render(<Harness view={makeView(0)} initial={splitAnswer(3, 3, 0)} />);
    expect(remainingEl().textContent).toBe(splitStatus(0));
    act(() => removeButton(0).click());
    expect(remainingEl().textContent).toBe(splitStatus(1));
  });

  it("남은 칸이 없을 때 더하기를 누르면 바뀌는 것 없이 이유를 알린다", () => {
    const answers: ViewAnswer[] = [];
    render(<Harness view={makeView(0)} initial={splitAnswer(2, 2, 2)} onAnswer={(answer) => answers.push(answer)} />);
    const add = addButton(0);
    expect(add.getAttribute("aria-disabled")).toBe("true");
    expect(add.disabled).toBe(false);
    expect(describedText(add)).toContain(V40_COPY.inputs.splitNoRoomReason);
    add.focus();
    act(() => add.click());
    expect(answers).toEqual([]);
    expect(countTexts()).toEqual(["2칸", "2칸", "2칸"]);
    // 이유는 누른 항목의 카드 안에서 뜨고 다른 항목의 영역은 비어 있다.
    expect(blockedEl(0).textContent).toBe(V40_COPY.inputs.splitNoRoomReason);
    expect(blockedEl(0).getAttribute("role")).toBe("status");
    expect(blockedEl(0).getAttribute("aria-live")).toBe("polite");
    expect(blockedEl(0).closest("li")).toBe(add.closest("li"));
    expect(blockedEl(1).textContent).toBe("");
    expect(blockedEl(2).textContent).toBe("");
    expect(noticeEl().textContent).toBe("");
    expect(document.activeElement).toBe(add);
  });

  it("놓은 칸이 없는 항목에서 빼기를 누르면 이유를 알린다", () => {
    const answers: ViewAnswer[] = [];
    render(<Harness view={makeView(0)} initial={splitAnswer(0, 2, 0)} onAnswer={(answer) => answers.push(answer)} />);
    const remove = removeButton(0);
    expect(remove.getAttribute("aria-disabled")).toBe("true");
    expect(removeButton(1).hasAttribute("aria-disabled")).toBe(false);
    expect(describedText(remove)).toContain(V40_COPY.inputs.splitEmptyReason);
    act(() => remove.click());
    expect(answers).toEqual([]);
    expect(blockedEl(0).textContent).toBe(V40_COPY.inputs.splitEmptyReason);
    expect(blockedEl(1).textContent).toBe("");
    expect(blockedEl(0).closest("li")).toBe(remove.closest("li"));
  });

  it("이유 문장 둘은 처음부터 숨김 글이라 누르기 전에는 눈에 보이지 않는다", () => {
    render(<Harness view={makeView(0)} initial={splitAnswer(2, 1, 0)} />);
    for (const suffix of ["full", "empty"]) {
      expect(document.getElementById(`q1-reason-${suffix}`)?.hasAttribute("hidden")).toBe(true);
    }
    const text = visibleText();
    expect(text).not.toContain(V40_COPY.inputs.splitNoRoomReason);
    expect(text).not.toContain(V40_COPY.inputs.splitEmptyReason);
  });

  it("다른 항목의 칸을 바꾸면 앞서 뜬 이유는 사라진다(그 항목이 여전히 0칸이어도)", () => {
    render(<Harness view={makeView(0)} initial={splitAnswer(0, 2, 2)} />);
    act(() => removeButton(0).click());
    expect(blockedEl(0).textContent).toBe(V40_COPY.inputs.splitEmptyReason);
    act(() => removeButton(1).click());
    expect(countTexts()).toEqual(["0칸", "1칸", "2칸"]);
    expect(blockedEl(0).textContent).toBe("");
  });

  it("이유는 누른 항목에만 뜬다: 다른 항목의 단추를 누르면 이유가 그쪽으로 옮겨 간다", () => {
    render(<Harness view={makeView(0)} initial={splitAnswer(0, 0, 6)} />);
    act(() => removeButton(0).click());
    expect(blockedEl(0).textContent).toBe(V40_COPY.inputs.splitEmptyReason);
    act(() => removeButton(1).click());
    expect(blockedEl(0).textContent).toBe("");
    expect(blockedEl(1).textContent).toBe(V40_COPY.inputs.splitEmptyReason);
  });

  it("칸이 밖에서 바뀌어 이유가 맞지 않게 되면 이유는 보이지 않는다", () => {
    const view = makeView(0);
    function Parent() {
      const [value, setValue] = useState<ViewAnswer | null>(splitAnswer(0, 3, 3));
      return (
        <div>
          <SplitInput view={view} value={value} idPrefix="q1" onAnswer={setValue} />
          <button type="button" data-external onClick={() => setValue(splitAnswer(2, 2, 0))}>
            바깥에서 바꾸기
          </button>
        </div>
      );
    }
    render(<Parent />);
    act(() => removeButton(0).click());
    expect(blockedEl(0).textContent).toBe(V40_COPY.inputs.splitEmptyReason);
    act(() => host.querySelector<HTMLButtonElement>("[data-external]")!.click());
    expect(countTexts()).toEqual(["2칸", "2칸", "0칸"]);
    expect(blockedEl(0).textContent).toBe("");
  });

  it("누를 수 있는 단추는 설명에 이유가 없고 현재 칸 수만 있다", () => {
    render(<Harness view={makeView(0)} initial={splitAnswer(1, 0, 0)} />);
    expect(describedText(addButton(0))).toBe("1칸");
    expect(describedText(removeButton(0))).toBe("1칸");
  });

  it("같은 이유를 또 눌러도 문장이 다시 끼워져 다시 낭독되고, 칸을 바꾸면 이유가 사라진다", () => {
    render(<Harness view={makeView(0)} initial={splitAnswer(2, 2, 2)} />);
    const notice = blockedEl(0);
    act(() => addButton(0).click());
    const first = notice.firstElementChild;
    expect(first?.textContent).toBe(V40_COPY.inputs.splitNoRoomReason);
    act(() => addButton(0).click());
    const second = notice.firstElementChild;
    expect(second?.textContent).toBe(V40_COPY.inputs.splitNoRoomReason);
    expect(second).not.toBe(first);
    expect(blockedEl(0)).toBe(notice);
    act(() => removeButton(2).click());
    expect(notice.textContent).toBe("");
  });

  it("다음을 눌렀는데 칸이 남았으면(incomplete) 남은 칸 수를 이미 있던 aria-live 영역에 알린다", () => {
    render(<Harness view={makeView(0)} initial={splitAnswer(2, 2, 0)} />);
    const notice = noticeEl();
    expect(notice.textContent).toBe("");
    render(<Harness view={makeView(0)} initial={splitAnswer(2, 2, 0)} incomplete />);
    expect(noticeEl()).toBe(notice);
    expect(notice.textContent).toBe(splitRemainingNotice(2));
    expect(notice.textContent).toContain("2");
  });

  it("아무것도 놓지 않았을 때도 알리고, 다 놓았으면 알리지 않는다", () => {
    render(<Harness key="none" view={makeView(0)} incomplete />);
    expect(noticeEl().textContent).toBe(splitRemainingNotice(6));
    render(<Harness key="full" view={makeView(0)} initial={splitAnswer(2, 2, 2)} incomplete />);
    expect(noticeEl().textContent).toBe("");
  });

  it("넘기기(잘 모르겠어요, 제 상황과 안 맞아요)도 답이라 incomplete 여도 칸이 남았다고 하지 않는다", () => {
    render(<Harness key="unsure" view={makeView(0)} initial={{ fmt: "escape", which: "unsure" }} incomplete />);
    expect(noticeEl().textContent).toBe("");
    expect(remainingEl().textContent).toBe("");
    render(<Harness key="na" view={makeView(0)} initial={{ fmt: "escape", which: "na" }} incomplete idPrefix="na" />);
    expect(noticeEl().textContent).toBe("");
    expect(remainingEl().textContent).toBe("");
    // 다른 답(칸을 조금 놓은 상태)이면 여전히 안내한다.
    render(<Harness key="part" view={makeView(0)} initial={splitAnswer(1, 1, 0)} incomplete idPrefix="part" />);
    expect(noticeEl().textContent).toBe(splitRemainingNotice(4));
  });

  it("안내가 들어오는 영역에 id(접두어-incomplete)가 있어 화면이 덜 채운 문항으로 스크롤할 수 있다", () => {
    render(<Harness view={makeView(0)} idPrefix="scr" incomplete />);
    expect(noticeEl().id).toBe("scr-incomplete");
    expect(document.getElementById("scr-incomplete")?.textContent).toBe(splitRemainingNotice(6));
  });

  it("칸을 놓으면 남은 칸 수는 남은 칸 영역이 알리고, 다음 안내는 부모가 지운 뒤 사라진다", () => {
    const view = makeView(0);
    function Parent() {
      const [value, setValue] = useState<ViewAnswer | null>(splitAnswer(2, 2, 0));
      const [incomplete, setIncomplete] = useState(true);
      return (
        <SplitInput
          view={view}
          value={value}
          idPrefix="q1"
          incomplete={incomplete}
          onAnswer={(answer) => {
            setIncomplete(false);
            setValue(answer);
          }}
        />
      );
    }
    render(<Parent />);
    expect(noticeEl().textContent).toBe(splitRemainingNotice(2));
    act(() => addButton(2).click());
    expect(noticeEl().textContent).toBe("");
    expect(remainingEl().textContent).toBe(splitStatus(1));
  });
});

describe("SplitInput 작은 화면과 터치", () => {
  it("빠르게 여러 번 누르는 -/+ 단추에는 두 번 탭 확대를 막는 터치 규칙이 붙어 있다", () => {
    render(<Harness view={makeView(0)} />);
    for (const button of host.querySelectorAll<HTMLButtonElement>("[data-step]")) {
      expect(button.className).toMatch(/(^|\s)touch-manipulation(\s|$)/);
    }
  });

  it("단추는 44픽셀 이상이고 고대비에서도 초점이 보이도록 투명 윤곽선을 되살린다", () => {
    render(<Harness view={makeView(0)} />);
    for (const button of host.querySelectorAll<HTMLButtonElement>("[data-step]")) {
      expect(button.className).toMatch(/size-11/);
      expect(button.className).toContain("focus-visible:outline-hidden!");
    }
  });

  it("칸 표시와 단추가 한 줄에 안 들어가면 접히도록 줄바꿈을 허용한다", () => {
    render(<Harness view={makeView(0)} />);
    for (const pips of host.querySelectorAll("[data-pips]")) {
      expect(pips.parentElement?.className).toContain("flex-wrap");
    }
  });
});

describe("SplitInput 키보드만으로 끝내기", () => {
  it("탭이 서는 자리는 단추 여섯 개가 화면 순서로 모두이고, 숨은 탭 자리는 없다", () => {
    render(<Harness view={makeView(0)} />);
    expect(tabStops()).toEqual([removeButton(0), addButton(0), removeButton(1), addButton(1), removeButton(2), addButton(2)]);
    expect(host.querySelectorAll("[tabindex]")).toHaveLength(0);
    // 놓은 칸이 없는 빼기 단추도 초점을 받는다(aria-disabled 는 탭에서 빼지 않는다).
    expect(removeButton(0).getAttribute("aria-disabled")).toBe("true");
  });

  it("엔터와 스페이스만으로 6칸을 다 놓고, 초점은 마지막 단추에 남는다", () => {
    const answers: ViewAnswer[] = [];
    render(<Harness view={makeView(0)} onAnswer={(answer) => answers.push(answer)} />);

    const stops = tabStops();
    const addFirst = stops[1];
    press(addFirst, "Enter");
    press(addFirst, " ");
    press(addFirst, "Enter");
    const addSecond = tabStops()[3];
    press(addSecond, " ");
    press(addSecond, "Enter");
    const addThird = tabStops()[5];
    expect(document.activeElement).toBe(addSecond);
    press(addThird, "Enter");

    const last = answers[answers.length - 1] as SplitViewAnswer;
    expect(last).toEqual(splitAnswer(3, 2, 1));
    expect(last.counts[0] + last.counts[1] + last.counts[2]).toBe(V40_SPLIT_TOTAL);
    expect(remainingEl().textContent).toBe(V40_COPY.inputs.splitAllPlacedAnnouncement);
    // 다 놓으면 더하기 단추가 모두 aria-disabled 가 되지만 초점은 방금 누른 단추에 그대로 있다.
    expect(addThird.getAttribute("aria-disabled")).toBe("true");
    expect(document.activeElement).toBe(addThird);
    expect(host.contains(addThird)).toBe(true);
    expect(tabStops()).toContain(addThird);
  });

  it("다 놓은 뒤에 엔터를 또 눌러도 이유만 알리고 초점은 그대로이며, 빼기로 다시 조정할 수 있다", () => {
    const answers: ViewAnswer[] = [];
    render(<Harness view={makeView(0)} initial={splitAnswer(3, 2, 1)} onAnswer={(answer) => answers.push(answer)} />);
    const add = addButton(1);
    press(add, "Enter");
    expect(answers).toEqual([]);
    expect(blockedEl(1).textContent).toBe(V40_COPY.inputs.splitNoRoomReason);
    expect(document.activeElement).toBe(add);

    press(removeButton(0), " ");
    expect(answers[answers.length - 1]).toEqual(splitAnswer(2, 2, 1));
    expect(remainingEl().textContent).toBe(splitStatus(1));
    press(addButton(2), "Enter");
    expect(answers[answers.length - 1]).toEqual(splitAnswer(2, 2, 2));
  });

  it("컴포넌트가 키를 가로채지 않는다: 엔터, 스페이스, 방향키, 탭 키의 keydown 이 취소되지 않는다", () => {
    render(<Harness view={makeView(0)} initial={splitAnswer(6, 0, 0)} />);
    for (const target of [addButton(0), removeButton(0), removeButton(1), addButton(2)]) {
      target.focus();
      for (const key of ["Enter", " ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab", "Escape"]) {
        expect(keydown(target, key)).toBe(true);
      }
    }
  });
});

describe("SplitInput 을 ItemFrame 안에 놓았을 때", () => {
  function frame(view: SplitView, onAnswer?: (answer: ViewAnswer) => void, initial: ViewAnswer | null = null) {
    function Framed() {
      const [value, setValue] = useState<ViewAnswer | null>(initial);
      const change = (answer: ViewAnswer) => {
        onAnswer?.(answer);
        setValue(answer);
      };
      return (
        <ItemFrame view={view} value={value} onAnswer={change} idPrefix="q1">
          <SplitInput view={view} value={value} onAnswer={change} idPrefix="q1" />
        </ItemFrame>
      );
    }
    render(<Framed />);
  }

  function escapeButtons(): HTMLButtonElement[] {
    return [...host.querySelectorAll<HTMLButtonElement>("button[aria-pressed]")];
  }

  it("모든 문항 아래의 작은 두 단추(잘 모르겠어요, 제 상황과 안 맞아요)가 있고 각각 넘기기 답을 알린다", () => {
    const answers: ViewAnswer[] = [];
    frame(makeView(0), (answer) => answers.push(answer));
    expect(escapeButtons().map((button) => button.textContent?.trim())).toEqual([V40_ESCAPES.unsure, V40_ESCAPES.notApplicable]);
    act(() => escapeButtons()[0].click());
    act(() => escapeButtons()[1].click());
    expect(answers).toEqual([
      { fmt: "escape", which: "unsure" },
      { fmt: "escape", which: "na" },
    ]);
  });

  it("칸을 다 놓지 않고도 제 상황과 안 맞아요로 넘어갈 수 있고, 그 뒤 칸은 다시 0칸에서 시작한다", () => {
    const answers: ViewAnswer[] = [];
    frame(makeView(0), (answer) => answers.push(answer), splitAnswer(2, 1, 0));
    expect(countTexts()).toEqual(["2칸", "1칸", "0칸"]);
    act(() => escapeButtons()[1].click());
    expect(answers[answers.length - 1]).toEqual({ fmt: "escape", which: "na" });
    expect(countTexts()).toEqual(["0칸", "0칸", "0칸"]);
    act(() => addButton(0).click());
    expect(answers[answers.length - 1]).toEqual(splitAnswer(1, 0, 0));
  });

  it("탭 순서는 칸 단추 여섯 개 다음에 넘기기 단추 둘이고, 어느 것도 disabled 가 아니다", () => {
    frame(makeView(0));
    expect(tabStops()).toEqual([
      removeButton(0), addButton(0), removeButton(1), addButton(1), removeButton(2), addButton(2), ...escapeButtons(),
    ]);
    expect(host.querySelectorAll("[disabled]:not([hidden])")).toHaveLength(0);
  });

  it("틀 전체의 보이는 글에도 번호, A/B, 가/나가 없다", () => {
    frame(makeView(1), undefined, splitAnswer(1, 2, 3));
    const text = visibleText();
    expect(text.replace(/\d+칸/g, "").replace(/\d+개/g, "")).not.toMatch(/\d/);
    expect(text).not.toMatch(/(^|\s)[A-Za-z]([.):]|\s|$)/);
    expect(text).not.toMatch(/(^|\s)[가나다라][.)]/);
  });
});

describe("SplitInput 값 없는 렌더", () => {
  it("value 가 null 이어도 던지지 않고 onAnswer 만 부른다", () => {
    const onAnswer = vi.fn();
    render(<SplitInput view={makeView(0)} value={null} onAnswer={onAnswer} idPrefix="solo" />);
    act(() => addButton(1).click());
    expect(onAnswer).toHaveBeenCalledWith(splitAnswer(0, 1, 0));
  });
});
