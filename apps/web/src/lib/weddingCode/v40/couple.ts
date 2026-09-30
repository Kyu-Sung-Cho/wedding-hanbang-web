/**
 * 웨딩코드 4.0 두 사람 보기(CoupleModule, 설계 7절 두 사람 보기, README 7절 15항).
 *
 * 각자 buildResult 를 하고 주제마다 태그 셋(같은 글자, 다른 글자, 한쪽 또는 둘 다 반반이에요) 중 하나를 붙인다.
 * 두 코드를 하나의 수치로 합치거나 점수로 만들지 않고, 같은 글자 개수나 비슷한 주제 개수를 세지 않는다.
 * 글자를 못 정했거나 임시 글자인 자리는 비교에서 뺀다(excluded). 문항 단위 비교는 두 사람이 모두 유효 답을 한 채점 문항만 본다.
 * 값은 저장 상태에서 나오므로 두 사람의 폼 비트가 달라도 된다.
 */
import type {
  Axis,
  AxisResult,
  Bank,
  CoupleAxisRow,
  CoupleItemPair,
  CoupleResult,
  CoupleSideInfo,
  CoupleTag,
  DecodedCode,
  FormBit,
  Perspective,
} from "./types";
import type { CoupleModule } from "./contract";
import { encodeCode } from "./codec";
import { answerText } from "./present";
import { buildResult } from "./score";
import { responseAt } from "./states";
import { itemValue } from "./value";

/** 먼저 이야기해 볼 질문: 값의 부호가 반대이고 값 차이가 이 값 이상(설계 7절 두 사람 보기 5). 재검사 표준오차를 재기 전의 임시값이다. */
export const COUPLE_TALK_MIN_GAP = 8;
/** 이미 비슷하게 고른 질문: 값의 부호가 같고 두 사람 모두 |값| 이 이 값 이상(설계 7절 두 사람 보기 6). 임시값이다. */
export const COUPLE_SIMILAR_MIN_ABS = 4;
/** 두 목록의 최대 개수. */
export const COUPLE_LIST_LIMIT = 3;

const formBitOf = (decoded: DecodedCode): FormBit => (decoded.formBit === 1 ? 1 : 0);

const settled = (axis: AxisResult): boolean => axis.shownBand === "clear" || axis.shownBand === "lean";

function sideInfo(axis: AxisResult): CoupleSideInfo {
  return { letter: axis.letter, shownBand: axis.shownBand, provisional: axis.provisional };
}

/**
 * 주제 한 줄. 둘 다 기울어요 이상이고 임시 글자가 아니면 글자가 같은지 다른지를 말하고, 그 밖은 같다도 다르다도 말하지 않는다(even).
 * 어느 쪽이든 글자를 못 정했거나 임시 글자이면 excluded 이고 tag 는 even 이다. 어느 쪽이든 관문이 닫혀 있으면(gateClosed)
 * 그 사람의 글자는 코드로 내놓을 수 없는 값이라 네 줄 모두 excluded 다(계약 밖 확장, 설계 5절 관문).
 */
function axisRow(first: AxisResult, second: AxisResult, gateClosed: boolean): CoupleAxisRow {
  const excluded = gateClosed || first.letter === null || second.letter === null || first.provisional || second.provisional;
  let tag: CoupleTag = "even";
  if (!excluded && settled(first) && settled(second)) tag = first.letter === second.letter ? "same" : "different";
  return { axis: first.axis, first: sideInfo(first), second: sideInfo(second), tag, excluded };
}

interface Entry {
  readonly pair: CoupleItemPair;
  /** 질문 순서(같은 순위에서 앞선 것을 먼저). */
  readonly order: number;
  /** 클수록 먼저(먼저 이야기해 볼 질문은 값 차이, 비슷한 질문은 작은 쪽의 절댓값). */
  readonly rank: number;
}

/**
 * 순위 큰 순(같으면 질문 순서)으로 정렬한 뒤 주제마다 가장 앞선 하나를 먼저 뽑고 남는 자리를 채워 최대 limit 개를 낸다.
 * 최종 목록도 같은 순서다. 주제가 limit 보다 많으면 주제별 대표 가운데 순위가 높은 것부터 뽑는다.
 */
function selectEntries(entries: readonly Entry[], limit: number): CoupleItemPair[] {
  const sorted = [...entries].sort((a, b) => b.rank - a.rank || a.order - b.order);
  const leaders = new Map<Axis, Entry>();
  for (const entry of sorted) if (!leaders.has(entry.pair.axis)) leaders.set(entry.pair.axis, entry);
  const chosen = new Set<Entry>();
  for (const entry of sorted) {
    if (chosen.size >= limit) break;
    if (leaders.get(entry.pair.axis) === entry) chosen.add(entry);
  }
  for (const entry of sorted) {
    if (chosen.size >= limit) break;
    chosen.add(entry);
  }
  return sorted.filter((entry) => chosen.has(entry)).map((entry) => entry.pair);
}

/**
 * 두 사람 비교(설계 7절 두 사람 보기). 주제 네 줄의 태그와, 문항 단위의 먼저 이야기해 볼 질문(부호 반대, 값 차이 8 이상)과
 * 이미 비슷하게 고른 질문(부호 같고 둘 다 |값| 4 이상)을 각각 최대 3개 낸다. 두 코드를 합치거나 점수로 만들지 않는다.
 * 비교에서 뺀 주제(excluded)의 문항은 목록에도 넣지 않는다(설계 7절: 그 자리는 비교에서 뺀다). 어느 쪽이든 관문이 닫혀 있으면
 * 네 주제가 모두 빠지므로 두 목록이 빈다(모든 줄이 excluded 로 나오는 것으로 화면이 알 수 있다).
 */
export function compareCouple(bank: Bank, first: DecodedCode, second: DecodedCode): CoupleResult {
  const resultA = buildResult(bank, formBitOf(first), first.responses);
  const resultB = buildResult(bank, formBitOf(second), second.responses);
  const gateClosed = resultA.gate.closed || resultB.gate.closed;
  const axes: CoupleResult["axes"] = [
    axisRow(resultA.axes[0], resultB.axes[0], gateClosed),
    axisRow(resultA.axes[1], resultB.axes[1], gateClosed),
    axisRow(resultA.axes[2], resultB.axes[2], gateClosed),
    axisRow(resultA.axes[3], resultB.axes[3], gateClosed),
  ];
  const excludedAxes = new Set<Axis>(axes.filter((row) => row.excluded).map((row) => row.axis));
  const talk: Entry[] = [];
  const similar: Entry[] = [];
  bank.scored.forEach((item, order) => {
    if (excludedAxes.has(item.axis)) return;
    const rawA = responseAt(first.responses, item.id);
    const rawB = responseAt(second.responses, item.id);
    if (rawA === undefined || rawB === undefined) return;
    const a = itemValue(item, rawA);
    const b = itemValue(item, rawB);
    if (a === null || b === null || a === 0 || b === 0) return;
    const textA = answerText(item, rawA);
    const textB = answerText(item, rawB);
    if (textA === null || textB === null) return;
    const gap = Math.abs(a - b);
    const pair: CoupleItemPair = {
      itemId: item.id,
      axis: item.axis,
      facet: item.facet,
      caption: item.caption,
      firstValue: a,
      secondValue: b,
      gap,
      firstText: textA,
      secondText: textB,
    };
    const oppositeSigns = (a > 0) !== (b > 0);
    if (oppositeSigns) {
      if (gap >= COUPLE_TALK_MIN_GAP) talk.push({ pair, order, rank: gap });
    } else {
      const smaller = Math.min(Math.abs(a), Math.abs(b));
      if (smaller >= COUPLE_SIMILAR_MIN_ABS) similar.push({ pair, order, rank: smaller });
    }
  });
  return { axes, talk: selectEntries(talk, COUPLE_LIST_LIMIT), similar: selectEntries(similar, COUPLE_LIST_LIMIT) };
}

function codeOf(bank: Bank, decoded: DecodedCode | null | undefined): string | null {
  if (decoded === null || decoded === undefined || typeof decoded !== "object") return null;
  return encodeCode(bank, formBitOf(decoded), decoded.responses);
}

/**
 * 나 기준 전환의 자동 선택(설계 7절 두 사람 보기 2). 이 브라우저에 저장된 본인 답을 70자 코드로 만들어 링크의 a 와 같으면 first,
 * b 와 같으면 second, 둘 다 아니거나 본인 답이 없거나 코드로 만들 수 없으면 null(화면이 먼저 답한 사람 / 나중에 답한 사람 선택을 보여 준다).
 */
export function detectPerspective(bank: Bank, savedOwn: DecodedCode | null, first: DecodedCode, second: DecodedCode): Perspective | null {
  const own = codeOf(bank, savedOwn);
  if (own === null) return null;
  if (own === codeOf(bank, first)) return "first";
  if (own === codeOf(bank, second)) return "second";
  return null;
}

/** 이 파일의 함수를 계약(CoupleModule)대로 묶은 객체. */
export const coupleModule = { compareCouple, detectPerspective } satisfies CoupleModule;
