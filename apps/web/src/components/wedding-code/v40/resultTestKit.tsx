import { vi } from "vitest";
import { V40_LETTER_LIST } from "@/constants/weddingCodeV40";
import { WEDDING_CODE_V40_BANK } from "@/lib/weddingCode/v40/bank";
import { V40_FIXTURES, fixtureByName } from "@/lib/weddingCode/v40/fixtures";
import { pickQuotes } from "@/lib/weddingCode/v40/quote";
import { buildResult } from "@/lib/weddingCode/v40/score";
import type { AxisQuotes, HistoryEntry, V40Result } from "@/lib/weddingCode/v40/types";
import type { ResultScreenProps } from "./ResultScreen";

/**
 * 혼자 보는 결과 화면 시험이 함께 쓰는 도구(시험 파일이 아니다).
 * 화면은 문항 문구에 기대지 않는다: 고정 표본 응답을 실제 채점기와 인용 뽑기에 넣은 결과로 그린다.
 */

export const FIXTURE_NAMES: readonly string[] = V40_FIXTURES.map((fixture) => fixture.name);

export interface ResultCase {
  readonly name: string;
  readonly result: V40Result;
  readonly quotes: readonly AxisQuotes[];
}

/** 고정 표본 하나의 결과와 주제별 인용. */
export function resultCase(name: string): ResultCase {
  const fixture = fixtureByName(name);
  if (fixture === undefined) throw new Error(`고정 표본이 없어요: ${name}`);
  const result = buildResult(WEDDING_CODE_V40_BANK, fixture.formBit, fixture.responses);
  const quotes = result.axes.map((axis) => pickQuotes(WEDDING_CODE_V40_BANK, fixture.responses, axis));
  return { name, result, quotes };
}

/** 결과에서 지난번 기록 한 건을 만든다(글자와 세기, 시각, 폼 비트만). 세기는 화면에 보인 shownBand 를 쓴다. */
export function historyOf(result: V40Result, at: number): HistoryEntry {
  const axes = result.axes.map((axis) => ({
    letter: axis.letter,
    band: axis.letter === null ? null : axis.shownBand,
    provisional: axis.provisional,
  })) as unknown as HistoryEntry["axes"];
  return { at, formBit: result.formBit, axes };
}

/** 2026-09-29 12:00 한국 시간(표시는 9월 29일). */
export const SEPT_29_NOON_KST = Date.UTC(2026, 8, 29, 3, 0, 0);

/** 콜백은 언제나 시험용 가짜(mock)라서 .mock 으로 부른 기록을 볼 수 있다. 나머지는 덮어쓸 수 있다. */
type ScreenOverrides = Partial<Omit<ResultScreenProps, "onCopyCode" | "onReviewAxis" | "onRestart" | "onClearStorage" | "onOpenTaste">>;

export function screenProps(name: string, overrides: ScreenOverrides = {}) {
  const { result, quotes } = resultCase(name);
  return {
    result,
    quotes,
    onCopyCode: vi.fn(async (text: string) => text !== ""),
    onReviewAxis: vi.fn(),
    onRestart: vi.fn(),
    onClearStorage: vi.fn(async () => true),
    onOpenTaste: vi.fn(),
    ...overrides,
  } satisfies ResultScreenProps;
}

/** 공백을 하나로 줄인 화면 글(숨긴 글과 낭독 전용 글 포함). */
export function textOf(root: { textContent: string | null }): string {
  return (root.textContent ?? "").replace(/\s+/g, " ").trim();
}

export function countOf(text: string, part: string): number {
  return part === "" ? 0 : text.split(part).length - 1;
}

/**
 * 요소 경계마다 공백을 끼워 넣은 글. textContent 는 옆 칸의 글을 붙여 버려서(예: 「Verify」 바로 뒤에 다음 칸의 「S」)
 * 낱글자 검사가 글자를 놓칠 수 있다. 눈에 보이는 낱말 경계를 따라 읽으려고 쓴다.
 */
export function spacedText(root: Node): string {
  const parts: string[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.textContent ?? "");
      return;
    }
    parts.push(" ");
    for (const child of node.childNodes) walk(child);
    parts.push(" ");
  };
  walk(root);
  return parts.join("").replace(/\s+/g, " ").trim();
}

/** 글 안에서 앞뒤에 알파벳이나 숫자가 붙지 않은 대문자 한 자들. 영어 낱말(Verify 등)의 머리글자는 잡히지 않는다. 요소를 주면 spacedText 로 읽는다. */
export function standaloneCapitals(source: string | Node): string[] {
  const text = typeof source === "string" ? source : spacedText(source);
  return [...text.matchAll(/(?<![A-Za-z0-9])[A-Z](?![A-Za-z0-9])/g)].map((match) => match[0]);
}

export const ALLOWED_LETTERS: ReadonlySet<string> = new Set(V40_LETTER_LIST);

/** data-result-section 이 나오는 순서(같은 이름이 여럿이면 첫 번째 위치). */
export function sectionOrder(root: ParentNode): string[] {
  const seen: string[] = [];
  for (const element of root.querySelectorAll("[data-result-section]")) {
    const name = element.getAttribute("data-result-section") ?? "";
    if (!seen.includes(name)) seen.push(name);
  }
  return seen;
}

export function buttonByText(root: ParentNode, label: string): HTMLButtonElement {
  const found = [...root.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === label);
  if (!found) throw new Error(`단추가 없어요: ${label}`);
  return found;
}

export function hasButton(root: ParentNode, label: string): boolean {
  return [...root.querySelectorAll("button")].some((button) => button.textContent?.trim() === label);
}
