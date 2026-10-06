/**
 * 웨딩코드 4.0 「내가 고른 답」 뽑기(QuoteModule, 설계 7절 내가 고른 답 뽑는 규칙, README 7절 14항).
 *
 * 한 주제의 채점 문항 16개 가운데 값이 0 이 아닌 유효 답을 |값| 큰 순(같으면 질문 순서)으로 훑고, 이미 뽑은 것과 측면이 같거나
 * 형식(fmt 여섯 가지 그대로)이 같은 것은 건너뛴다. 모자라면 모자란 대로 낸다. 건너뜀, 해당 없음, 빠진 값은 뽑지 않는다.
 * 뽑은 답에 해석을 덧붙이지 않는다(원문은 present.answerText, 제목을 붙인 문장은 answerLabel 그대로).
 */
import type { AxisQuotes, AxisResult, Bank, FacetKey, QuoteItem, Responses, ScoredFormat, ScoredItem } from "./types";
import type { QuoteModule } from "./contract";
import { answerLabel, answerText } from "./present";
import { responseAt } from "./states";
import { itemValue } from "./value";

/** 뽑는 개수와 조건(설계 7절). 반대로 고른 답은 |값| 이 이 값 이상일 때만 센다. */
export const QUOTE_LIMITS = { own: 3, opposite: 2, evenEach: 2, oppositeMinAbs: 3 } as const;

interface Candidate {
  readonly item: ScoredItem;
  readonly value: number;
  readonly quote: QuoteItem;
}

/** 후보: 그 주제의 유효 답 가운데 값이 0 이 아니고 인용 원문이 있는 것. |값| 큰 순, 같으면 질문 순서(정렬은 안정 정렬). */
function candidatesOf(bank: Bank, responses: Responses, axis: AxisResult): Candidate[] {
  const list: Candidate[] = [];
  for (const item of bank.scoredByAxis[axis.axis] ?? []) {
    const raw = responseAt(responses, item.id);
    if (raw === undefined) continue;
    const value = itemValue(item, raw);
    if (value === null || value === 0) continue;
    const text = answerText(item, raw);
    const label = answerLabel(item, raw);
    if (text === null || label === null) continue;
    const prompt = item.fmt === "react"
      ? [item.stem, ...(item.quote ? [`${item.quote.speaker} · 「${item.quote.text}」`] : []), item.question]
      : [item.stem];
    const quote: QuoteItem = { itemId: item.id, caption: item.caption, prompt, facet: item.facet, format: item.fmt, value, text, label };
    list.push({ item, value, quote });
  }
  return list.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
}

/** 정렬된 후보를 앞에서부터 보며 조건에 맞고 측면과 형식이 겹치지 않는 것을 limit 개까지 뽑는다. */
function pick(sorted: readonly Candidate[], accepts: (value: number) => boolean, limit: number): QuoteItem[] {
  const facets = new Set<FacetKey>();
  const formats = new Set<ScoredFormat>();
  const picked: QuoteItem[] = [];
  for (const candidate of sorted) {
    if (picked.length >= limit) break;
    if (!accepts(candidate.value)) continue;
    if (facets.has(candidate.quote.facet) || formats.has(candidate.quote.format)) continue;
    facets.add(candidate.quote.facet);
    formats.add(candidate.quote.format);
    picked.push(candidate.quote);
  }
  return picked;
}

/**
 * 한 주제의 인용(설계 7절). shownBand 가 뚜렷해요 또는 기울어요이면 글자 쪽 답 최대 3개와 반대로 고른 답(|값| 3 이상) 최대 2개,
 * 반반이에요(임시 글자 포함)이면 앞쪽 답과 뒤쪽 답을 각각 최대 2개(|값| 조건 없음), 글자를 못 정한 주제이면 none.
 */
export function pickQuotes(bank: Bank, responses: Responses, axis: AxisResult): AxisQuotes {
  const band = axis.shownBand;
  if (band === null || axis.side === null) return { kind: "none" };
  const sorted = candidatesOf(bank, responses, axis);
  if (band === "even") {
    return {
      kind: "even",
      front: pick(sorted, (value) => value > 0, QUOTE_LIMITS.evenEach),
      back: pick(sorted, (value) => value < 0, QUOTE_LIMITS.evenEach),
    };
  }
  const ownSign = axis.side === "front" ? 1 : -1;
  return {
    kind: "settled",
    own: pick(sorted, (value) => Math.sign(value) === ownSign, QUOTE_LIMITS.own),
    opposite: pick(sorted, (value) => Math.sign(value) === -ownSign && Math.abs(value) >= QUOTE_LIMITS.oppositeMinAbs, QUOTE_LIMITS.opposite),
  };
}

/** 이 파일의 함수를 계약(QuoteModule)대로 묶은 객체. */
export const quoteModule = { pickQuotes } satisfies QuoteModule;
