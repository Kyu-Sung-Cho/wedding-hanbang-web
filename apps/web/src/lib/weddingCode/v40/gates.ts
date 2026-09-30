/**
 * 웨딩코드 4.0 위치 반복 검사와 건너뜀 힌트(GatesModule, 설계 5절 주의 검사 1과 2).
 *
 * 위치 반복 검사는 저장 상태가 아니라 화면 위치(폼 비트 반영)의 열로 한다(present.viewPosition). 세 묶음 각각에서
 * 질문 순서대로 유효 답(건너뜀, 해당 없음, 빠진 값은 뺀 나머지 순서)의 위치 열을 만들고, 답이 12개 이상일 때만 주기 1에서 4를 시험한다.
 * 비교는 모두 정수다(agree x 16 >= considered x 임계).
 *
 * 알려진 한계(적대적 검토 2026-09-30): 검사는 형식마다 유효 답 12개가 있어야 하고 건너뜀 힌트는 16개를 넘어야 하며 해당 없음은 어디에도 세지 않는다.
 * 그래서 묶음마다 5개씩(합 15개) 건너뛰거나 해당 없음으로 넘기면 검사도 힌트도 조용해진다. 설계 5절 주의 검사 2의 「건너뜀으로 검사를
 * 피할 수 없다」는 문장은 그대로는 맞지 않는다. 문턱을 바꾸는 일은 제품 결정이라 이 파일은 계약 값(12, 16)을 그대로 둔다.
 */
import { V40_COUNTS } from "@/constants/weddingCodeV40";
import type { Bank, FormBit, Item, Responses, RhythmFamily, RhythmFormatReport, RhythmReport } from "./types";
import type { GatesModule } from "./contract";
import { viewPosition } from "./present";
import { responseAt } from "./states";

/** 위치 반복 검사를 시작하는 유효 답 수(설계 5절 주의 검사 1). */
export const RHYTHM_MIN_ANSWERS = 12;

/** 묶음마다 임계 분자(16분율, 설계 5절 주의 검사 1): agree x 16 >= considered x 이 값 이면 위치 반복. 두 가지 중 고르기 15, 이럴 때와 고르기 14. */
export const RHYTHM_THRESHOLD_16THS: Readonly<Record<RhythmFamily, number>> = { pair: 15, react: 14, choose: 14 };

const FAMILIES: readonly RhythmFamily[] = ["pair", "react", "choose"];

/** 형식이 속한 위치 반복 검사 묶음(자기 선택, 가장·아닌 것, 칸 나누기는 null). */
function familyOfItem(item: Item): RhythmFamily | null {
  switch (item.fmt) {
    case "pair":
      return "pair";
    case "react":
      return "react";
    case "recall":
    case "instant":
      return "choose";
    default:
      return null;
  }
}

/** 한 묶음의 위치 열(질문 순서, 유효 답만)로 최적 주기와 일치 수를 낸다. 답이 12개 미만이면 검사하지 않고 considered 만 채운다. */
function reportFamily(family: RhythmFamily, positions: readonly number[]): RhythmFormatReport {
  const considered = positions.length;
  if (considered < RHYTHM_MIN_ANSWERS) return { family, considered, period: null, agree: 0, flagged: false };
  let bestAgree = -1;
  let bestPeriod: 1 | 2 | 3 | 4 = 1;
  for (const period of [1, 2, 3, 4] as const) {
    let agree = 0;
    for (let residue = 0; residue < period; residue += 1) {
      const counts = new Map<number, number>();
      let top = 0;
      for (let index = residue; index < considered; index += period) {
        const next = (counts.get(positions[index]) ?? 0) + 1;
        counts.set(positions[index], next);
        if (next > top) top = next;
      }
      agree += top;
    }
    if (agree > bestAgree) {
      bestAgree = agree;
      bestPeriod = period;
    }
  }
  const flagged = bestAgree * 16 >= considered * RHYTHM_THRESHOLD_16THS[family];
  return { family, considered, period: bestPeriod, agree: bestAgree, flagged };
}

/**
 * 위치 반복 검사(설계 5절 주의 검사 1). pair, react, choose(recall 과 instant 를 질문 순서로 합침) 각각의 화면 위치 열에서
 * 주기 1에서 4 중 위치 묶음별 최다 값 수의 합이 가장 큰 주기(가장 작은 최적 p)를 고르고, 임계를 넘으면 flagged.
 */
export function rhythmReport(bank: Bank, formBit: FormBit, responses: Responses): RhythmReport {
  const positionsByFamily: Record<RhythmFamily, number[]> = { pair: [], react: [], choose: [] };
  for (const item of bank.scored) {
    const family = familyOfItem(item);
    if (family === null) continue;
    const value = responseAt(responses, item.id);
    if (value === undefined) continue;
    const position = viewPosition(item, formBit, value);
    if (position !== null) positionsByFamily[family].push(position);
  }
  const formats = FAMILIES.map((family) => reportFamily(family, positionsByFamily[family])) as [
    RhythmFormatReport,
    RhythmFormatReport,
    RhythmFormatReport,
  ];
  const flaggedCount = formats.filter((format) => format.flagged).length as 0 | 1 | 2 | 3;
  return { formats, flaggedCount };
}

/** 채점 문항 중 skip(잘 모르겠어요) 개수. na 는 세지 않는다(설계 5절 주의 검사 2). */
export function skippedCount(bank: Bank, responses: Responses): number {
  let count = 0;
  for (const item of bank.scored) {
    if (responseAt(responses, item.id) === "skip") count += 1;
  }
  return count;
}

/**
 * 건너뜀 개수가 V40_COUNTS.skipHintOver(16) 를 넘는가(설계 5절 주의 검사 2). 건너뜀 힌트 규칙이 사는 유일한 자리다.
 * skipHint 와 buildResult(score.ts)가 모두 이 함수를 쓰므로 두 곳이 따로 어긋나지 않는다.
 */
export function isSkipHintCount(count: number): boolean {
  return count > V40_COUNTS.skipHintOver;
}

/** skippedCount 가 V40_COUNTS.skipHintOver(16) 를 넘으면 true(설계 5절 주의 검사 2). */
export function skipHint(bank: Bank, responses: Responses): boolean {
  return isSkipHintCount(skippedCount(bank, responses));
}

/** 이 파일의 함수를 계약(GatesModule)대로 묶은 객체. */
export const gatesModule = { rhythmReport, skippedCount, skipHint, isSkipHintCount } satisfies GatesModule;
