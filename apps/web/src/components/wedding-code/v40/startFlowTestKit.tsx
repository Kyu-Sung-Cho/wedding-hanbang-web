import { act } from "react";
import { V40_COUNTS, V40_STORAGE } from "@/constants/weddingCodeV40";
import { V40_NOT_VALIDATED_PHRASE } from "@/lib/weddingCode/v40/copy";
import { labelProblems, labelProblemsIn } from "./inputTestKit";

/**
 * 시작과 질문 흐름 화면 시험이 함께 쓰는 도구(시험 파일이 아니다). 그리기와 조작은 inputTestKit 을 그대로 쓴다.
 * 이 파일은 소스 가드(규칙 2)가 훑는 소스라서 주장으로 쓰지 않는 낱말 목록을 두지 않는다. 그 목록은 시험 파일
 * startFlowScreens.hygiene.test.tsx 안에만 있다(시험 파일은 가드가 훑지 않는다).
 */

/** 낭독 알림과 안내를 다시 읽히려고 화면이 거는 짧은 시간제한이 지나가게 기다린다. */
export async function settle(ms: number = 200): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
  });
}

export function countOccurrences(text: string, needle: string): number {
  if (needle === "") return 0;
  return text.split(needle).length - 1;
}

/** 화면에 「검증을 마친 심리검사가 아니」 고지가 몇 번 있는가. */
export function notValidatedCount(root: ParentNode & { textContent: string | null }): number {
  return countOccurrences(root.textContent ?? "", V40_NOT_VALIDATED_PHRASE);
}

/** 시작 화면과 받는 사람 화면이 밝혀도 되는 숫자: 질문 수와 저장 기간. */
export function allowedNumberPhrases(): readonly string[] {
  const days = Math.round(V40_STORAGE.ttlMs / (24 * 60 * 60 * 1000));
  return [`${V40_COUNTS.items}개`, `${days}일`];
}

function stripPhrases(root: Node, phrases: readonly string[]): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text);
  for (const node of nodes) {
    let value = node.nodeValue ?? "";
    for (const phrase of phrases) value = value.split(phrase).join("");
    node.nodeValue = value;
  }
}

/**
 * 보이는 글자에 번호, n/N, 선택지 번호, A/B, 가나 라벨이 있으면 그 종류를 돌려준다(없으면 빈 배열).
 * - 낭독 알림 자리(data-announcement)는 「지금 두 번째 구간이에요」처럼 낭독용 말이라 뺀다.
 * - 칸 나누기 입력(data-split)은 입력 컴포넌트 몫의 칸 수 글자(몇 칸)를 그리므로 뺀다(입력 시험이 본다).
 * - allowed 로 준 낱말(시작 화면의 질문 수와 저장 기간)은 뺀다.
 */
export function visibleLabelProblems(root: HTMLElement, allowed: readonly string[] = []): string[] {
  const clone = root.cloneNode(true) as HTMLElement;
  for (const element of clone.querySelectorAll("[data-announcement], [data-split]")) element.remove();
  stripPhrases(clone, allowed);
  return labelProblemsIn(clone);
}

/**
 * visibleLabelProblems 에서 숫자와 A/B 만 본다(몇 번째, 가나 라벨, 동그라미 숫자는 보지 않는다).
 * 문항 문구(장면 글)는 다른 흐름이 다듬고 있어서 「두 번째 상담」 같은 서수를 쓸 수 있다. 그 경우 이 화면의 잘못이 아니므로 문항이 들어간 화면 시험은 이것을 쓴다.
 * 문항 문구의 번호 라벨(1. A. 가. 같은 것)은 은행 검사가 막는다.
 */
export function visibleNumberProblems(root: HTMLElement, allowed: readonly string[] = []): string[] {
  const clone = root.cloneNode(true) as HTMLElement;
  for (const element of clone.querySelectorAll("[data-announcement], [data-split]")) element.remove();
  stripPhrases(clone, allowed);
  const problems = labelProblems(clone.textContent ?? "", { spokenName: true }).map((problem) => `글자: ${problem}`);
  for (const element of clone.querySelectorAll("[aria-label]")) {
    for (const problem of labelProblems(element.getAttribute("aria-label") ?? "", { spokenName: true })) {
      problems.push(`aria-label: ${problem}`);
    }
  }
  return problems;
}

/** 줄표(긴 것과 짧은 것)가 있는가. */
export function hasDash(text: string): boolean {
  return /[–—]/.test(text);
}
