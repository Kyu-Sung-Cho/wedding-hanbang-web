import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { V40_BESTWORST_LABELS, V40_ESCAPES } from "@/constants/weddingCodeV40";
import { V40_COPY } from "@/lib/weddingCode/v40/copy";
import type { BestWorstView, ViewAnswer } from "@/lib/weddingCode/v40/types";
import { BestWorstInput } from "./BestWorstInput";
import { ItemFrame } from "./ItemFrame";
import { V40_INPUT_LOCAL_COPY } from "./localCopy";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ---------------------------------------------------------------------------
// 고정 표본: 폼 비트 0 과 1 의 화면(뷰). 폼 비트 1 은 카드 네 장의 순서가 뒤집혀 있다.
// 컴포넌트는 극과 폼 비트를 모르므로 어느 쪽 뷰든 화면 순서의 색인을 그대로 알려야 한다.
// ---------------------------------------------------------------------------

const CARD_TEXTS = [
  "남는 돈은 결혼식 뒤 생활비 통장으로 옮겨 둬요",
  "사진 촬영 시간을 늘려요",
  "그날 공간의 꽃과 조명을 한 단계 올려요",
  "빠듯한 항목부터 채우고 나머지는 예비비로 둬요",
] as const;

function makeView(formBit: 0 | 1): BestWorstView {
  const texts = formBit === 0 ? [...CARD_TEXTS] : [...CARD_TEXTS].reverse();
  return {
    id: `fixture.bestworst.${formBit}`,
    fmt: "bestworst",
    caption: "뜻밖에 남은 돈",
    stem: "뜻밖에 돈이 조금 남았어요. 결혼 준비에 쓴다면 어느 쪽이 가장 나 같고 어느 쪽이 가장 나 같지 않아요?",
    escapes: { unsure: V40_ESCAPES.unsure, notApplicable: V40_ESCAPES.notApplicable },
    cards: texts.map((text) => ({ text })),
    bestLabel: V40_BESTWORST_LABELS.best,
    worstLabel: V40_BESTWORST_LABELS.worst,
    duplicateAnnounce: V40_BESTWORST_LABELS.duplicateAnnounce,
  };
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
  view: BestWorstView;
  initial?: ViewAnswer | null;
  incomplete?: boolean;
  idPrefix?: string;
  onAnswer?: (answer: ViewAnswer) => void;
}) {
  const [value, setValue] = useState<ViewAnswer | null>(initial);
  return (
    <BestWorstInput
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

function group(kind: "best" | "worst"): HTMLElement {
  const element = host.querySelector<HTMLElement>(`[data-group="${kind}"]`);
  if (!element) throw new Error(`그룹 ${kind} 이 없어요`);
  return element;
}

function radios(kind: "best" | "worst"): HTMLInputElement[] {
  return [...group(kind).querySelectorAll<HTMLInputElement>('input[type="radio"]')];
}

function checkedIndex(kind: "best" | "worst"): number | null {
  const index = radios(kind).findIndex((radio) => radio.checked);
  return index === -1 ? null : index;
}

function liveText(): string {
  return host.querySelector("[data-bestworst-live]")?.textContent ?? "";
}

// ---------------------------------------------------------------------------
// 키보드 흉내. jsdom 은 키의 기본 동작(스페이스로 고르기, 방향키로 옮기기)을 하지 않는다.
// 아래 도우미는 브라우저가 하는 기본 동작만 대신하고, keydown 이 취소(preventDefault)되면 기본 동작도 하지 않는다.
// 그래서 컴포넌트가 키를 가로채면 시험이 깨진다.
// ---------------------------------------------------------------------------

function keydown(target: HTMLElement, key: string, init: KeyboardEventInit = {}): boolean {
  let notPrevented = true;
  act(() => {
    notPrevented = target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
  });
  return notPrevented;
}

/** 라디오에서 스페이스: 초점을 둔 라디오를 고른다. */
function space(target: HTMLInputElement) {
  target.focus();
  if (keydown(target, " ")) act(() => target.click());
}

/**
 * 라디오에서 방향키: keydown 이 취소되지 않으면 브라우저는 같은 이름의 다음(이전) 라디오로 초점을 옮기고 그 라디오를 고른다(끝에서 반대쪽으로 돈다).
 * 컴포넌트가 방향키를 맡아 keydown 을 취소하면(이 컴포넌트가 그렇다) 이 도우미는 아무것도 더 하지 않고, 결과는 컴포넌트가 낸 것 그대로다.
 */
function arrow(target: HTMLInputElement, key: "ArrowDown" | "ArrowUp") {
  target.focus();
  if (!keydown(target, key)) return;
  const same = [...host.querySelectorAll<HTMLInputElement>('input[type="radio"]')].filter((radio) => radio.name === target.name);
  const at = same.indexOf(target);
  const next = same[(at + (key === "ArrowDown" ? 1 : same.length - 1)) % same.length];
  next.focus();
  act(() => next.click());
}

/** 탭 키가 서는 자리. 라디오 그룹은 고른 칸(없으면 첫 칸) 하나에만 선다(HTML 라디오 규칙). */
function tabStops(): HTMLElement[] {
  const stops: HTMLElement[] = [];
  const seenGroups = new Set<string>();
  for (const element of host.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea, [tabindex]")) {
    if (element.hasAttribute("disabled") || element.getAttribute("tabindex") === "-1") continue;
    if (element instanceof HTMLInputElement && element.type === "radio") {
      if (seenGroups.has(element.name)) continue;
      const members = [...host.querySelectorAll<HTMLInputElement>('input[type="radio"]')].filter((radio) => radio.name === element.name);
      const stop = members.find((radio) => radio.checked) ?? members[0];
      seenGroups.add(element.name);
      stops.push(stop);
      continue;
    }
    stops.push(element);
  }
  return stops;
}

/** 눈에 보이는 글(낭독 전용과 숨김 글 제외). */
function visibleText(): string {
  const copy = host.cloneNode(true) as HTMLElement;
  copy.querySelectorAll(".sr-only, [hidden], [aria-hidden='true']").forEach((node) => node.remove());
  return copy.textContent ?? "";
}

/** 카드 글만(다른 그룹에서 고른 카드에 붙는 작은 표시는 빼고). */
function labelOf(radio: HTMLInputElement): string {
  return radio.closest("label")?.querySelector("[data-card-text]")?.textContent?.trim() ?? "";
}

/** 라디오의 낭독 이름: 라벨 안에서 숨긴 글(aria-hidden)을 뺀 글. */
function spokenName(radio: HTMLInputElement): string {
  const copy = radio.closest("label")!.cloneNode(true) as HTMLElement;
  copy.querySelectorAll("[aria-hidden='true']").forEach((node) => node.remove());
  return copy.textContent?.trim() ?? "";
}

/** aria-describedby 가 가리키는 글. */
function describedBy(radio: HTMLInputElement): string {
  return (radio.getAttribute("aria-describedby") ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ")
    .trim();
}

// ---------------------------------------------------------------------------
// 시험
// ---------------------------------------------------------------------------

describe("BestWorstInput 구성", () => {
  it("라디오 그룹 둘을 함께 보여 준다: 이름과 카드 네 장씩, 이름은 서로 다르다", () => {
    render(<Harness view={makeView(0)} />);
    const groups = host.querySelectorAll('[role="radiogroup"]');
    expect(groups).toHaveLength(2);
    expect(group("best").querySelector("legend")?.textContent).toBe("가장 나 같은 것");
    expect(group("worst").querySelector("legend")?.textContent).toBe("가장 나 같지 않은 것");
    for (const kind of ["best", "worst"] as const) {
      expect(radios(kind)).toHaveLength(4);
      expect(radios(kind).map(labelOf)).toEqual([...CARD_TEXTS]);
    }
    expect(radios("best")[0].name).not.toBe(radios("worst")[0].name);
    expect(new Set(radios("best").map((radio) => radio.name)).size).toBe(1);
    expect(new Set(radios("worst").map((radio) => radio.name)).size).toBe(1);
  });

  it("두 그룹은 같은 카드 넷이라 둘 사이에 가는 선을 그어 어느 목록인지 가른다(낭독기에는 보이지 않는다)", () => {
    render(<Harness view={makeView(0)} />);
    const divider = host.querySelector("[data-group-divider]")!;
    expect(divider.getAttribute("aria-hidden")).toBe("true");
    expect(host.querySelectorAll("[data-group-divider]")).toHaveLength(1);
    // 선은 가장 나 같은 것 그룹 뒤, 가장 나 같지 않은 것 그룹 앞에 있다
    expect(group("best").compareDocumentPosition(divider) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(divider.compareDocumentPosition(group("worst")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("처음에는 아무것도 고르지 않고 낭독 영역은 비어 있지만 화면에 있다", () => {
    render(<Harness view={makeView(0)} />);
    expect(checkedIndex("best")).toBeNull();
    expect(checkedIndex("worst")).toBeNull();
    const live = host.querySelector("[data-bestworst-live]");
    expect(live).not.toBeNull();
    expect(live?.getAttribute("role")).toBe("status");
    expect(live?.getAttribute("aria-live")).toBe("polite");
    expect(live?.textContent).toBe("");
  });

  it("보이는 글에 번호, A/B, 가/나, n/N 이 없다", () => {
    render(<Harness view={makeView(0)} initial={{ fmt: "bestworst", best: 1, worst: 3 }} />);
    const text = visibleText();
    expect(text).not.toMatch(/\d/);
    expect(text).not.toMatch(/(^|\s)[A-Za-z]([.):]|\s|$)/);
    expect(text).not.toMatch(/(^|\s)[가나다라][.)]/);
    expect(text).not.toMatch(/[①②③④⑤⑥⑦⑧⑨⑩]/);
    // 카드 안의 표식(동그라미와 체크)은 글자가 없고 낭독에서 빠진다.
    for (const mark of host.querySelectorAll("label > span[aria-hidden='true']")) {
      expect(mark.textContent).toBe("");
    }
  });

  it("한 화면에 두 문항이 있어도 id 와 라디오 이름이 겹치지 않는다", () => {
    render(
      <div>
        <Harness view={makeView(0)} idPrefix="q1" />
        <Harness view={makeView(0)} idPrefix="q2" />
      </div>,
    );
    const ids = [...host.querySelectorAll("[id]")].map((element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);
    const names = [...host.querySelectorAll<HTMLInputElement>('input[type="radio"]')].map((radio) => radio.name);
    expect(new Set(names).size).toBe(4);
  });

  it("답이 다른 형식이거나 범위 밖이면 아무것도 고른 것으로 보지 않는다", () => {
    render(<Harness view={makeView(0)} initial={{ fmt: "escape", which: "unsure" }} />);
    expect(checkedIndex("best")).toBeNull();
    expect(checkedIndex("worst")).toBeNull();
    // key 를 바꿔 새로 붙인다(같은 자리의 같은 컴포넌트는 처음 값을 다시 받지 않는다).
    render(<Harness key="range" view={makeView(0)} initial={{ fmt: "bestworst", best: 9, worst: -1 }} idPrefix="q9" />);
    expect(checkedIndex("best")).toBeNull();
    expect(checkedIndex("worst")).toBeNull();
  });
});

describe("BestWorstInput 고르기와 중간 상태", () => {
  it("하나만 골라도 null 이 든 중간 답을 알리고, 둘 다 고르면 완성된 답을 알린다", () => {
    const answers: ViewAnswer[] = [];
    render(<Harness view={makeView(0)} onAnswer={(answer) => answers.push(answer)} />);
    act(() => radios("best")[2].click());
    expect(answers).toEqual([{ fmt: "bestworst", best: 2, worst: null }]);
    act(() => radios("worst")[0].click());
    expect(answers[1]).toEqual({ fmt: "bestworst", best: 2, worst: 0 });
    expect(checkedIndex("best")).toBe(2);
    expect(checkedIndex("worst")).toBe(0);
    expect(liveText()).toBe("");
  });

  it("먼저 가장 아닌 것을 골라도 같다", () => {
    const answers: ViewAnswer[] = [];
    render(<Harness view={makeView(0)} onAnswer={(answer) => answers.push(answer)} />);
    act(() => radios("worst")[3].click());
    expect(answers).toEqual([{ fmt: "bestworst", best: null, worst: 3 }]);
  });

  it("고른 것을 다른 카드로 바꾸면 그 그룹의 앞 선택이 풀린다", () => {
    render(<Harness view={makeView(0)} />);
    act(() => radios("best")[0].click());
    act(() => radios("best")[3].click());
    expect(checkedIndex("best")).toBe(3);
    expect(radios("best").filter((radio) => radio.checked)).toHaveLength(1);
  });

  it("폼 비트 1 뷰(카드 순서가 뒤집힘)에서도 화면 색인을 그대로 알린다", () => {
    const answers: ViewAnswer[] = [];
    render(<Harness view={makeView(1)} onAnswer={(answer) => answers.push(answer)} />);
    expect(radios("best").map(labelOf)).toEqual([...CARD_TEXTS].reverse());
    act(() => radios("best")[0].click());
    act(() => radios("worst")[3].click());
    // 화면 첫 카드는 뒤집힌 뒤의 첫 카드다. 컴포넌트는 저장 색인(폼 비트)을 모르고 화면 색인만 알린다.
    expect(answers).toEqual([
      { fmt: "bestworst", best: 0, worst: null },
      { fmt: "bestworst", best: 0, worst: 3 },
    ]);
    expect(labelOf(radios("best")[0])).toBe(CARD_TEXTS[3]);
  });
});

describe("BestWorstInput 같은 카드를 두 번 고를 때", () => {
  it("나중에 고른 쪽이 이긴다: 가장 나 같은 것을 가장 아닌 것으로 다시 고르면 앞 선택이 지워진다", () => {
    const answers: ViewAnswer[] = [];
    render(<Harness view={makeView(0)} onAnswer={(answer) => answers.push(answer)} />);
    act(() => radios("best")[1].click());
    act(() => radios("worst")[1].click());
    expect(answers[answers.length - 1]).toEqual({ fmt: "bestworst", best: null, worst: 1 });
    expect(checkedIndex("best")).toBeNull();
    expect(checkedIndex("worst")).toBe(1);
    // 문장은 뷰가 싣고 온 것(V40_BESTWORST_LABELS.duplicateAnnounce)을 그대로 읽는다. 문구가 바뀌어도 이 시험은 따라간다.
    expect(liveText()).toBe(makeView(0).duplicateAnnounce);
    expect(liveText()).not.toBe("");
  });

  it("반대 방향도 같다: 가장 아닌 것으로 고른 카드를 가장 나 같은 것으로 고르면 아닌 쪽이 지워진다", () => {
    const answers: ViewAnswer[] = [];
    render(<Harness view={makeView(0)} onAnswer={(answer) => answers.push(answer)} />);
    act(() => radios("worst")[2].click());
    act(() => radios("best")[2].click());
    expect(answers[answers.length - 1]).toEqual({ fmt: "bestworst", best: 2, worst: null });
    expect(checkedIndex("worst")).toBeNull();
    expect(checkedIndex("best")).toBe(2);
    expect(liveText()).toBe(V40_BESTWORST_LABELS.duplicateAnnounce);
  });

  it("문장은 이미 화면에 있던 aria-live 영역 안에 들어오고, 같은 일이 되풀이되면 문장이 다시 끼워져 다시 낭독된다", () => {
    render(<Harness view={makeView(0)} />);
    const live = host.querySelector("[data-bestworst-live]");
    act(() => radios("best")[0].click());
    act(() => radios("worst")[0].click());
    const first = live?.firstElementChild;
    expect(first?.textContent).toBe(V40_BESTWORST_LABELS.duplicateAnnounce);
    // 같은 카드를 또 반대 그룹에서 고른다.
    act(() => radios("best")[0].click());
    const second = live?.firstElementChild;
    expect(second?.textContent).toBe(V40_BESTWORST_LABELS.duplicateAnnounce);
    expect(second).not.toBe(first);
    expect(host.querySelector("[data-bestworst-live]")).toBe(live);
  });

  it("다른 카드를 고르면 문장이 사라진다", () => {
    render(<Harness view={makeView(0)} />);
    act(() => radios("best")[0].click());
    act(() => radios("worst")[0].click());
    expect(liveText()).not.toBe("");
    act(() => radios("best")[3].click());
    expect(liveText()).toBe("");
    expect(checkedIndex("best")).toBe(3);
    expect(checkedIndex("worst")).toBe(0);
  });

  it("어떤 카드도 비활성이 아니다: 어느 상태에서도 disabled, aria-disabled 가 없다", () => {
    render(<Harness view={makeView(0)} />);
    const assertNoneDisabled = () => {
      expect(host.querySelectorAll("[disabled], [aria-disabled]")).toHaveLength(0);
      for (const radio of host.querySelectorAll<HTMLInputElement>('input[type="radio"]')) {
        expect(radio.disabled).toBe(false);
      }
    };
    assertNoneDisabled();
    act(() => radios("best")[0].click());
    assertNoneDisabled();
    act(() => radios("worst")[0].click());
    assertNoneDisabled();
    act(() => radios("worst")[2].click());
    assertNoneDisabled();
  });

  it("골라 둔 같은 카드도 다른 그룹에서 여전히 누를 수 있다(눌러도 이 카드가 사라지지 않는다)", () => {
    render(<Harness view={makeView(0)} initial={{ fmt: "bestworst", best: 2, worst: null }} />);
    expect(radios("worst")[2].disabled).toBe(false);
    expect(radios("worst").map(labelOf)).toEqual([...CARD_TEXTS]);
  });
});

describe("BestWorstInput 키보드만으로 끝내기", () => {
  it("탭이 서는 자리는 그룹마다 하나이고, 그룹은 화면 순서(가장 나 같은 것, 가장 나 같지 않은 것)다", () => {
    render(<Harness view={makeView(0)} />);
    expect(tabStops()).toEqual([radios("best")[0], radios("worst")[0]]);
    // 키를 가로채는 숨은 탭 자리(tabindex)를 만들지 않았다.
    expect(host.querySelectorAll("[tabindex]")).toHaveLength(0);
    act(() => radios("best")[2].click());
    expect(tabStops()).toEqual([radios("best")[2], radios("worst")[0]]);
  });

  it("방향키와 스페이스만으로 두 그룹을 다 고르고, 초점은 고른 카드에 남는다", () => {
    const answers: ViewAnswer[] = [];
    render(<Harness view={makeView(0)} onAnswer={(answer) => answers.push(answer)} />);

    // 탭으로 첫 그룹에 들어가 방향키로 세 번째 카드까지 내려간다.
    const [firstStop] = tabStops();
    expect(firstStop).toBe(radios("best")[0]);
    arrow(firstStop as HTMLInputElement, "ArrowDown");
    arrow(radios("best")[1], "ArrowDown");
    expect(checkedIndex("best")).toBe(2);
    expect(document.activeElement).toBe(radios("best")[2]);

    // 탭으로 다음 그룹에 들어가 스페이스로 첫 카드를 고른다.
    const stops = tabStops();
    expect(stops[1]).toBe(radios("worst")[0]);
    space(stops[1] as HTMLInputElement);
    expect(checkedIndex("worst")).toBe(0);
    expect(document.activeElement).toBe(radios("worst")[0]);

    expect(answers[answers.length - 1]).toEqual({ fmt: "bestworst", best: 2, worst: 0 });
    // 사이의 중간 답도 모두 알렸다(고른 순서 그대로).
    expect(answers).toEqual([
      { fmt: "bestworst", best: 1, worst: null },
      { fmt: "bestworst", best: 2, worst: null },
      { fmt: "bestworst", best: 2, worst: 0 },
    ]);
  });

  it("방향키로 걷다가 다른 그룹에서 고른 카드를 지나가도 그 선택이 지워지지 않는다(카드에 초점만 오고 고르지 않는다)", () => {
    const answers: ViewAnswer[] = [];
    render(
      <Harness view={makeView(0)} initial={{ fmt: "bestworst", best: 1, worst: null }} onAnswer={(answer) => answers.push(answer)} />,
    );
    // 탭으로 들어온 가장 아닌 것 그룹의 첫 카드에서 아래로 세 번 걷는다. 둘째 카드는 가장 나 같은 것으로 이미 고른 카드다.
    const start = radios("worst")[0];
    start.focus();
    arrow(start, "ArrowDown");
    expect(document.activeElement).toBe(radios("worst")[1]);
    expect(checkedIndex("worst")).toBeNull();
    expect(checkedIndex("best")).toBe(1);
    expect(answers).toEqual([]);
    expect(liveText()).toBe("");

    arrow(radios("worst")[1], "ArrowDown");
    expect(checkedIndex("worst")).toBe(2);
    expect(checkedIndex("best")).toBe(1);
    arrow(radios("worst")[2], "ArrowDown");
    expect(checkedIndex("worst")).toBe(3);
    expect(checkedIndex("best")).toBe(1);
    expect(document.activeElement).toBe(radios("worst")[3]);

    // 알린 답은 두 번뿐이고 가장 나 같은 것은 한 번도 null 이 되지 않았다. 지운 적이 없으니 낭독 문장도 없다.
    expect(answers).toEqual([
      { fmt: "bestworst", best: 1, worst: 2 },
      { fmt: "bestworst", best: 1, worst: 3 },
    ]);
    expect(liveText()).toBe("");
  });

  it("끝에서 돌아 다른 그룹에서 고른 카드에 닿을 때도 초점만 온다(위쪽 방향키)", () => {
    const answers: ViewAnswer[] = [];
    render(
      <Harness view={makeView(0)} initial={{ fmt: "bestworst", best: 3, worst: null }} onAnswer={(answer) => answers.push(answer)} />,
    );
    const start = radios("worst")[0];
    start.focus();
    arrow(start, "ArrowUp");
    expect(document.activeElement).toBe(radios("worst")[3]);
    expect(checkedIndex("worst")).toBeNull();
    expect(checkedIndex("best")).toBe(3);
    expect(answers).toEqual([]);
  });

  it("지나쳐 온 카드도 스페이스로 고르면 그때는 앞의 선택이 지워지고 낭독 문장이 나온다", () => {
    render(<Harness view={makeView(0)} initial={{ fmt: "bestworst", best: 2, worst: null }} />);
    const start = radios("worst")[1];
    start.focus();
    arrow(start, "ArrowDown");
    const card = radios("worst")[2];
    expect(document.activeElement).toBe(card);
    expect(checkedIndex("best")).toBe(2);
    expect(liveText()).toBe("");
    space(card);
    expect(checkedIndex("worst")).toBe(2);
    expect(checkedIndex("best")).toBeNull();
    expect(liveText()).toBe(V40_BESTWORST_LABELS.duplicateAnnounce);
    expect(document.activeElement).toBe(card);
  });

  it("엔터도 초점이 있는 카드를 고른다. 이미 고른 카드에서 엔터를 눌러도 같은 답을 다시 알리지 않는다", () => {
    const answers: ViewAnswer[] = [];
    render(<Harness view={makeView(0)} onAnswer={(answer) => answers.push(answer)} />);
    const card = radios("best")[2];
    card.focus();
    expect(keydown(card, "Enter")).toBe(false);
    expect(checkedIndex("best")).toBe(2);
    expect(answers).toEqual([{ fmt: "bestworst", best: 2, worst: null }]);
    keydown(card, "Enter");
    expect(answers).toHaveLength(1);
    // 다른 그룹에서 고른 카드에서 엔터는 스페이스처럼 앞의 선택을 지운다.
    const other = radios("worst")[2];
    other.focus();
    keydown(other, "Enter");
    expect(checkedIndex("worst")).toBe(2);
    expect(checkedIndex("best")).toBeNull();
    expect(liveText()).toBe(V40_BESTWORST_LABELS.duplicateAnnounce);
  });

  it("알트, 컨트롤, 메타를 함께 누른 방향키와 엔터는 건드리지 않는다", () => {
    const answers: ViewAnswer[] = [];
    render(<Harness view={makeView(0)} onAnswer={(answer) => answers.push(answer)} />);
    const target = radios("best")[0];
    target.focus();
    for (const init of [{ altKey: true }, { ctrlKey: true }, { metaKey: true }]) {
      for (const key of ["ArrowDown", "ArrowUp", "Enter"]) expect(keydown(target, key, init)).toBe(true);
    }
    expect(answers).toEqual([]);
    expect(document.activeElement).toBe(target);
  });

  it("컴포넌트가 가로채는 키는 방향키와 엔터뿐이다: 스페이스, 탭, 홈, 끝, 이스케이프의 keydown 은 취소되지 않는다", () => {
    render(<Harness view={makeView(0)} />);
    const target = radios("best")[0];
    target.focus();
    for (const key of [" ", "Tab", "Home", "End", "Escape", "a"]) {
      expect(keydown(target, key)).toBe(true);
    }
    for (const key of ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Enter"]) {
      expect(keydown(target, key)).toBe(false);
    }
  });
});

describe("BestWorstInput 다른 그룹에서 이미 고른 카드의 표시", () => {
  it("다른 그룹에서 고른 카드에만 눈에 보이는 작은 표시가 붙는다(그 그룹의 이름을 쓴다)", () => {
    const view = makeView(0);
    render(<Harness view={view} initial={{ fmt: "bestworst", best: 1, worst: 3 }} />);
    // 가장 나 같은 것 그룹: 가장 아닌 것으로 고른 카드(화면 순서로 넷째)에만 붙는다.
    const inBest = [...group("best").querySelectorAll("[data-card-taken]")];
    expect(inBest).toHaveLength(1);
    expect(inBest[0].textContent).toBe(V40_INPUT_LOCAL_COPY.bestWorstTakenChip(view.worstLabel));
    expect(radios("best")[3].closest("label")?.contains(inBest[0])).toBe(true);
    // 가장 아닌 것 그룹: 둘째 카드에 붙는다.
    const inWorst = [...group("worst").querySelectorAll("[data-card-taken]")];
    expect(inWorst).toHaveLength(1);
    expect(inWorst[0].textContent).toBe(V40_INPUT_LOCAL_COPY.bestWorstTakenChip(view.bestLabel));
    expect(radios("worst")[1].closest("label")?.contains(inWorst[0])).toBe(true);
    // 표시는 글자만이고 눈에만 보이는 줄이라 카드의 낭독 이름에 섞이지 않는다.
    for (const chip of [...inBest, ...inWorst]) expect(chip.getAttribute("aria-hidden")).toBe("true");
    expect(spokenName(radios("best")[3])).toBe(CARD_TEXTS[3]);
    expect(spokenName(radios("worst")[1])).toBe(CARD_TEXTS[1]);
  });

  it("그 카드에는 고르기 전에 낭독 설명이 붙는다: 어디에서 골랐는지와 여기서 고르면 그쪽이 지워진다는 것", () => {
    const view = makeView(0);
    render(<Harness view={view} initial={{ fmt: "bestworst", best: 1, worst: null }} />);
    const taken = radios("worst")[1];
    expect(describedBy(taken)).toBe(V40_INPUT_LOCAL_COPY.bestWorstTakenHelp(view.bestLabel));
    expect(describedBy(taken)).toContain(view.bestLabel);
    // 설명 글은 라벨 밖에 있어서 카드 이름이 아니라 설명으로만 읽힌다.
    expect(taken.closest("label")?.contains(document.getElementById(taken.getAttribute("aria-describedby") ?? ""))).toBe(false);
    // 표시가 없는 카드에는 설명도 없다.
    for (const radio of [radios("worst")[0], radios("worst")[2], radios("worst")[3], ...radios("best")]) {
      expect(radio.hasAttribute("aria-describedby")).toBe(false);
    }
  });

  it("표시는 고른 상태를 따라간다: 같은 카드를 다시 고르면 표시가 반대 그룹으로 넘어가고 아무것도 고르지 않으면 없다", () => {
    const view = makeView(0);
    render(<Harness view={view} />);
    expect(host.querySelectorAll("[data-card-taken]")).toHaveLength(0);
    act(() => radios("best")[2].click());
    expect(group("worst").querySelectorAll("[data-card-taken]")).toHaveLength(1);
    expect(group("best").querySelectorAll("[data-card-taken]")).toHaveLength(0);
    act(() => radios("worst")[2].click());
    // 앞의 선택은 지워졌고, 이제 반대 그룹의 같은 카드에 표시가 붙는다.
    expect(group("worst").querySelectorAll("[data-card-taken]")).toHaveLength(0);
    const inBest = group("best").querySelectorAll("[data-card-taken]");
    expect(inBest).toHaveLength(1);
    expect(inBest[0].textContent).toBe(V40_INPUT_LOCAL_COPY.bestWorstTakenChip(view.worstLabel));
  });

  it("표시 글에도 번호, A/B, 가/나가 없고 낭독 설명 글에도 없다", () => {
    render(<Harness view={makeView(0)} initial={{ fmt: "bestworst", best: 1, worst: 3 }} />);
    for (const element of host.querySelectorAll("[data-card-taken], [id$='-taken']")) {
      expect(element.textContent).not.toMatch(/\d/);
      expect(element.textContent).not.toMatch(/(^|\s)[A-Za-z]([.):]|\s|$)/);
      expect(element.textContent).not.toMatch(/(^|\s)[가나다라][.)]/);
    }
  });
});

describe("BestWorstInput 덜 골랐을 때 안내", () => {
  it("다음을 눌렀는데 덜 골랐으면(incomplete) 이미 있던 aria-live 영역에 안내가 들어온다", () => {
    render(<Harness view={makeView(0)} initial={{ fmt: "bestworst", best: 1, worst: null }} />);
    const live = host.querySelector("[data-bestworst-live]");
    expect(live?.textContent).toBe("");
    render(<Harness view={makeView(0)} initial={{ fmt: "bestworst", best: 1, worst: null }} incomplete />);
    expect(host.querySelector("[data-bestworst-live]")).toBe(live);
    expect(live?.textContent).toBe(V40_COPY.question.incompleteBestWorst);
    expect(live?.textContent).not.toBe("");
  });

  it("아무것도 안 골랐을 때도 안내하고, 둘 다 골랐으면 안내하지 않는다", () => {
    render(<Harness view={makeView(0)} incomplete />);
    expect(liveText()).toBe(V40_COPY.question.incompleteBestWorst);
    render(<Harness key="done" view={makeView(0)} initial={{ fmt: "bestworst", best: 0, worst: 3 }} incomplete idPrefix="done" />);
    expect(liveText()).toBe("");
  });

  it("안내가 떠 있다가 남은 하나를 고르면 사라진다", () => {
    render(<Harness view={makeView(0)} initial={{ fmt: "bestworst", best: 1, worst: null }} incomplete />);
    expect(liveText()).toBe(V40_COPY.question.incompleteBestWorst);
    act(() => radios("worst")[0].click());
    expect(liveText()).toBe("");
  });

  it("넘기기(잘 모르겠어요, 제 상황과 안 맞아요)도 답이라 incomplete 여도 하나씩 골라 달라고 하지 않는다", () => {
    render(<Harness key="unsure" view={makeView(0)} initial={{ fmt: "escape", which: "unsure" }} incomplete />);
    expect(liveText()).toBe("");
    render(<Harness key="na" view={makeView(0)} initial={{ fmt: "escape", which: "na" }} incomplete idPrefix="na" />);
    expect(liveText()).toBe("");
    // 다른 답(카드를 하나만 고른 상태)이면 여전히 안내한다.
    render(<Harness key="half" view={makeView(0)} initial={{ fmt: "bestworst", best: 0, worst: null }} incomplete idPrefix="half" />);
    expect(liveText()).toBe(V40_COPY.question.incompleteBestWorst);
  });

  it("안내가 들어오는 영역에 id(접두어-incomplete)가 있어 화면이 덜 채운 문항으로 스크롤할 수 있다", () => {
    render(<Harness view={makeView(0)} idPrefix="scr" incomplete />);
    const live = host.querySelector("[data-bestworst-live]");
    expect(live?.id).toBe("scr-incomplete");
    expect(document.getElementById("scr-incomplete")?.textContent).toBe(V40_COPY.question.incompleteBestWorst);
  });
});

describe("BestWorstInput 을 ItemFrame 안에 놓았을 때", () => {
  function frame(view: BestWorstView, onAnswer?: (answer: ViewAnswer) => void, initial: ViewAnswer | null = null) {
    function Framed() {
      const [value, setValue] = useState<ViewAnswer | null>(initial);
      const change = (answer: ViewAnswer) => {
        onAnswer?.(answer);
        setValue(answer);
      };
      return (
        <ItemFrame view={view} value={value} onAnswer={change} idPrefix="q1">
          <BestWorstInput view={view} value={value} onAnswer={change} idPrefix="q1" />
        </ItemFrame>
      );
    }
    render(<Framed />);
  }

  function escapeButtons(): HTMLButtonElement[] {
    return [...host.querySelectorAll<HTMLButtonElement>("button")];
  }

  it("모든 문항 아래의 작은 두 단추(잘 모르겠어요, 제 상황과 안 맞아요)가 있고 각각 넘기기 답을 알린다", () => {
    const answers: ViewAnswer[] = [];
    frame(makeView(0), (answer) => answers.push(answer));
    const buttons = escapeButtons();
    expect(buttons.map((button) => button.textContent?.trim())).toEqual([V40_ESCAPES.unsure, V40_ESCAPES.notApplicable]);
    act(() => buttons[0].click());
    act(() => escapeButtons()[1].click());
    expect(answers).toEqual([
      { fmt: "escape", which: "unsure" },
      { fmt: "escape", which: "na" },
    ]);
  });

  it("넘기기를 누르면 카드 선택은 비고, 그 뒤에 카드를 고르면 다시 카드 답이 된다", () => {
    const answers: ViewAnswer[] = [];
    frame(makeView(0), (answer) => answers.push(answer), { fmt: "bestworst", best: 1, worst: 2 });
    expect(checkedIndex("best")).toBe(1);
    act(() => escapeButtons()[0].click());
    expect(checkedIndex("best")).toBeNull();
    expect(checkedIndex("worst")).toBeNull();
    act(() => radios("best")[3].click());
    expect(answers[answers.length - 1]).toEqual({ fmt: "bestworst", best: 3, worst: null });
  });

  it("키보드만으로 카드 둘을 고르고 넘기기 단추에도 닿는다: 탭 순서는 두 그룹 다음에 두 단추", () => {
    frame(makeView(0));
    const stops = tabStops();
    expect(stops).toEqual([radios("best")[0], radios("worst")[0], ...escapeButtons()]);
    // 넘기기 단추는 진짜 버튼이라 엔터로 눌린다. 카드는 넘기기 뒤에도 그대로 조작할 수 있다.
    const [unsure] = escapeButtons();
    unsure.focus();
    if (keydown(unsure, "Enter")) act(() => unsure.click());
    expect(unsure.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelectorAll("[disabled], [aria-disabled]")).toHaveLength(0);
  });

  it("두 그룹은 앞말을 설명으로 갖고, 앞말은 ItemFrame 이 같은 접두어로 그린다", () => {
    const view = makeView(0);
    frame(view);
    for (const kind of ["best", "worst"] as const) {
      const describedBy = group(kind).getAttribute("aria-describedby");
      expect(describedBy).not.toBeNull();
      expect(host.querySelector(`#${describedBy}`)?.textContent).toBe(view.stem);
    }
  });

  it("틀 전체의 보이는 글에도 번호, A/B, 가/나가 없다", () => {
    frame(makeView(1), undefined, { fmt: "bestworst", best: 0, worst: 2 });
    const text = visibleText();
    expect(text).not.toMatch(/\d/);
    expect(text).not.toMatch(/(^|\s)[A-Za-z]([.):]|\s|$)/);
    expect(text).not.toMatch(/(^|\s)[가나다라][.)]/);
  });
});

describe("BestWorstInput 값 없는 렌더", () => {
  it("value 가 null 이어도 던지지 않고 onAnswer 만 부른다", () => {
    const onAnswer = vi.fn();
    render(<BestWorstInput view={makeView(0)} value={null} onAnswer={onAnswer} idPrefix="solo" />);
    act(() => radios("best")[0].click());
    expect(onAnswer).toHaveBeenCalledWith({ fmt: "bestworst", best: 0, worst: null });
  });
});
