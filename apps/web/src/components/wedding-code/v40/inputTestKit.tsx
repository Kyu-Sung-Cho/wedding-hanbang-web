import { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  V40_ESCAPES,
  V40_PAIR_LEVEL_LABELS,
  pairCellAccessibleName,
  reactCellAccessibleName,
  reactGroupDescription,
} from "@/constants/weddingCodeV40";
import type {
  ChoiceView,
  EscapeLabels,
  FormBit,
  PairCellView,
  PairView,
  ReactView,
  SelfView,
  ViewAnswer,
} from "@/lib/weddingCode/v40/types";

/**
 * 입력 컴포넌트 시험이 함께 쓰는 도구(시험 파일이 아니다). 이 저장소의 시험 방식대로 createRoot 와 act 로 그린다.
 * 뷰는 코어의 present 가 아직 없어서 타입만 보고 손으로 만들었다. 폼 비트 1 의 뷰는 present 가 하게 될 뒤집기를 손으로 옮긴 것이다
 * (pair 는 카드 위아래, react 는 양끝 이름, 고르기는 보기 네 개의 순서).
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ---------------------------------------------------------------------------
// 그리기와 조작
// ---------------------------------------------------------------------------

export interface Harness {
  readonly container: HTMLDivElement;
  render(node: ReactNode): Promise<void>;
  unmount(): Promise<void>;
}

export function createHarness(): Harness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  return {
    container,
    async render(node) {
      await act(async () => {
        root.render(node);
        await Promise.resolve();
      });
    },
    async unmount() {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

export async function click(element: Element | null | undefined): Promise<void> {
  if (!element) throw new Error("누를 요소가 없어요");
  await act(async () => (element as HTMLElement).click());
}

/** 초점이 있는 요소(없으면 body)에 keydown 을 보내고 그 이벤트를 돌려준다(defaultPrevented 확인용). */
export async function pressKey(key: string, init: KeyboardEventInit = {}): Promise<KeyboardEvent> {
  const target = document.activeElement ?? document.body;
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  await act(async () => {
    target.dispatchEvent(event);
  });
  return event;
}

export function radiosIn(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('[role="radio"]')];
}

/** 낭독 이름: aria-label, 없으면 글자 내용. */
export function nameOf(element: Element): string {
  return element.getAttribute("aria-label") ?? element.textContent?.trim() ?? "";
}

/** aria-labelledby 가 가리키는 요소들의 글을 이은 이름. */
export function labelledByText(element: Element): string {
  const ids = (element.getAttribute("aria-labelledby") ?? "").split(/\s+/).filter(Boolean);
  return ids.map((id) => element.ownerDocument.getElementById(id)?.textContent?.trim() ?? "").join(" ");
}

export function describedByText(element: Element): string {
  const ids = (element.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
  return ids.map((id) => element.ownerDocument.getElementById(id)?.textContent?.trim() ?? "").join(" ");
}

/** 위 요소가 아래 요소보다 문서에서 앞에 있는가. */
export function isBefore(first: Node, second: Node): boolean {
  return (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

/**
 * 제어되는 부모를 흉내 낸다: onAnswer 를 받으면 기록하고 value 를 바꿔 다시 그린다(고른 칸의 탭 자리 이동 같은 것을 볼 수 있다).
 */
export function Controlled({
  initial = null,
  spy,
  children,
}: {
  readonly initial?: ViewAnswer | null;
  readonly spy?: (answer: ViewAnswer) => void;
  readonly children: (state: { value: ViewAnswer | null; onAnswer: (answer: ViewAnswer) => void }) => ReactNode;
}) {
  const [value, setValue] = useState<ViewAnswer | null>(initial);
  const onAnswer = (answer: ViewAnswer) => {
    spy?.(answer);
    setValue(answer);
  };
  return <>{children({ value, onAnswer })}</>;
}

// ---------------------------------------------------------------------------
// 보이는 글자 검사
// ---------------------------------------------------------------------------

/**
 * 화면에 번호, n/N, 선택지 번호, A/B, 가/나 라벨이 있으면 어떤 종류인지 돌려준다(없으면 빈 배열).
 * 낭독 이름은 위치를 낱말로 쓸 수 있어서 이 검사는 숫자와 A/B 만 본다(labelProblems 의 두 번째 인자).
 */
export function labelProblems(text: string, options: { readonly spokenName?: boolean } = {}): string[] {
  const problems: string[] = [];
  if (/\d/.test(text)) problems.push("숫자");
  if (/(?<![A-Za-z])[ABab](?![A-Za-z])/.test(text)) problems.push("A/B");
  if (options.spokenName) return problems;
  if (/(^|\s)[가나다라][.)\]:]/.test(text)) problems.push("가나 라벨");
  if (/[①-⑳❶-❿]/.test(text)) problems.push("동그라미 숫자");
  if (/번째/.test(text)) problems.push("몇 번째");
  return problems;
}

/** 요소 안 보이는(낭독기 전용 포함) 글자와 모든 aria-label 을 검사해 문제를 모아 돌려준다. */
export function labelProblemsIn(root: ParentNode & { textContent: string | null }): string[] {
  const problems = labelProblems(root.textContent ?? "").map((problem) => `글자: ${problem}`);
  for (const element of root.querySelectorAll("[aria-label]")) {
    for (const problem of labelProblems(element.getAttribute("aria-label") ?? "", { spokenName: true })) {
      problems.push(`aria-label: ${problem}`);
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// 손으로 만든 뷰
// ---------------------------------------------------------------------------

const escapes: EscapeLabels = { unsure: V40_ESCAPES.unsure, notApplicable: V40_ESCAPES.notApplicable };

function pairCells(): PairCellView[] {
  const order: readonly (readonly [0 | 1, 1 | 2 | 3])[] = [
    [0, 3], [0, 2], [0, 1], [1, 1], [1, 2], [1, 3],
  ];
  return order.map(([cardIndex, level], cell) => ({
    cell,
    cardIndex,
    level,
    label: V40_PAIR_LEVEL_LABELS[level - 1],
    accessibleName: pairCellAccessibleName(cardIndex, level),
  }));
}

const PAIR_CARD_TEXTS = [
  "쓸 수 있는 총액의 선부터 긋고 그 안에서 채워 가요. 접어야 하는 것이 생겨도 선은 지켜요.",
  "그날 꼭 남기고 싶은 모습부터 그려 보고 돈은 그다음에 맞춰 가요. 총액이 흔들려 불안한 날도 있어요.",
] as const;

/** 두 가지 중 고르기. 폼 비트 1 은 카드 위아래가 바뀐 화면이다(칸의 DOM 순서와 낭독 이름은 그대로 위 카드 먼저). */
export function pairView(formBit: FormBit): PairView {
  const texts = formBit === 0 ? PAIR_CARD_TEXTS : [PAIR_CARD_TEXTS[1], PAIR_CARD_TEXTS[0]];
  return {
    id: "kit-pair",
    caption: "첫 주말의 대화",
    stem: "결혼 준비를 막 시작한 주말, 둘이 마주 앉았어요. 형편이 넉넉하든 빠듯하든 지금 마음이 가는 쪽을 골라 주세요.",
    escapes,
    fmt: "pair",
    kind: "method",
    cards: [{ text: texts[0] }, { text: texts[1] }],
    cells: pairCells(),
  };
}

const SELF_CARD_TEXTS = [
  "돈이 걸린 결정에서 총액, 한도, 계약 조건 같은 숫자를 먼저 맞춰 보고 정해요.",
  "돈이 걸린 결정에서 결혼식이 끝난 뒤 남을 장면과 분위기를 먼저 그려 보고 정해요.",
] as const;

export function selfView(formBit: FormBit): SelfView {
  const texts = formBit === 0 ? SELF_CARD_TEXTS : [SELF_CARD_TEXTS[1], SELF_CARD_TEXTS[0]];
  return {
    id: "kit-self",
    caption: "직접 고른 쪽",
    stem: "스스로는 어느 쪽에 더 가깝다고 생각해요?",
    escapes,
    fmt: "self",
    cards: [{ text: texts[0] }, { text: texts[1] }],
    cells: pairCells(),
  };
}

/** 이럴 때 내 마음. 폼 비트 1 은 양끝 이름 자리가 바뀐 화면이다. quote 를 false 로 주면 인용 없는 뷰. */
export function reactView(formBit: FormBit, options: { readonly quote?: boolean } = {}): ReactView {
  const useQuote = options.quote ?? true;
  const ends = formBit === 0 ? { left: "서운할 것 같아요", right: "든든할 것 같아요" } : { left: "든든할 것 같아요", right: "서운할 것 같아요" };
  return {
    id: "kit-react",
    caption: "밤늦은 털어놓기",
    stem: "밤늦게 결혼 준비가 힘들다고 털어놨더니 상대가 바로 말해요.",
    escapes,
    fmt: "react",
    kind: "action",
    quote: useQuote ? { speaker: "상대", text: "그럼 내일 할 일부터 같이 정리해 볼까?" } : null,
    question: "그때 내 마음은?",
    ends,
    groupDescription: reactGroupDescription(ends.left, ends.right),
    cells: ([0, 1, 2, 3, 4] as const).map((cell) => ({
      cell,
      accessibleName: reactCellAccessibleName(cell, ends.left, ends.right),
    })),
  };
}

const RECALL_TEXTS = [
  "한 사람이 후보를 서너 개로 추려 오고, 마지막 하나만 같이 골랐어요.",
  "처음부터 끝까지 같이 앉아 보며 골랐어요. 시간은 더 걸렸어요.",
  "각자 조금씩 찾아본 뒤 자주 만나서 같이 골랐어요.",
  "맡은 사람이 알아서 정했고, 나머지는 결과만 듣고 따랐어요.",
] as const;

/** 고르기, 지난 일 떠올리기. 폼 비트 1 은 보기 네 개의 순서가 뒤집힌 화면이다. */
export function recallView(formBit: FormBit): ChoiceView {
  const texts = formBit === 0 ? [...RECALL_TEXTS] : [...RECALL_TEXTS].reverse();
  return {
    id: "kit-recall",
    caption: "지난 여행 준비",
    stem: "가장 최근에 여행이나 이사 같은 큰일을 준비했을 때, 후보를 찾는 일은 어떻게 했어요?",
    escapes,
    fmt: "recall",
    options: texts.map((text) => ({ text })),
    noneLabel: V40_ESCAPES.recallNone,
  };
}

const INSTANT_TEXTS = [
  "조금 들어 주다가 「내일 뭐부터 줄일까?」 하고 방법을 꺼내요.",
  "아무 말 없이 옆에 앉아 이야기가 나올 때까지 기다려요.",
  "「많이 힘들었지」 하고 먼저 말한 뒤 필요한 걸 물어봐요.",
  "그 자리에서 할 일을 적어 보고 내가 맡을 것부터 가져가요.",
] as const;

/** 고르기, 그때 나는. 이런 일이 없었어요 카드가 없다. */
export function instantView(formBit: FormBit): ChoiceView {
  const texts = formBit === 0 ? [...INSTANT_TEXTS] : [...INSTANT_TEXTS].reverse();
  return {
    id: "kit-instant",
    caption: "한숨 쉬는 상대",
    stem: "상대가 결혼 준비로 지쳐서 한숨을 쉬어요. 이럴 때 나는 보통…",
    escapes,
    fmt: "instant",
    options: texts.map((text) => ({ text })),
    noneLabel: null,
  };
}

export const RECALL_OPTION_TEXTS = RECALL_TEXTS;
export const INSTANT_OPTION_TEXTS = INSTANT_TEXTS;
