/**
 * 웨딩코드 4.0 (v4.0-tendency) 기준 계산기(reference oracle).
 *
 * TypeScript 구현(apps/web/src/lib/weddingCode/v40)과 섞이지 않는 순수 JS 이며, 설계 문서 5절(채점)과
 * 링크 코덱(계약 9절 6항, contract.ts CodecModule)을 그대로 다시 구현한다. 은행 검사(lint), 시험, 코어 구현 대조가
 * 이 파일 하나를 기준으로 삼는다. 부동소수는 판정에 쓰지 않는다(축 점수 s 는 화면과 시험용 참고값일 뿐이다).
 *
 * 표현 약속(TS 와 같다)
 *   bank      makeBank(data) 가 만든 조회 구조. items 는 질문 순서(= 링크 코드 순서) 68개.
 *   responses { [문항 id]: 저장값 }. 저장값은 상태 문자 한 개, "skip"(잘 모르겠어요) 또는 "na"(제 상황과 안 맞아요).
 *             답하지 않은 문항은 키가 없다. 상태 문자는 은행 배치(폼 비트 0 화면 순서) 기준이며 폼 비트로 뒤집히지 않는다.
 *   view      화면 답. pair/self {fmt,cell 0..5}, react {fmt,cell 0..4}, recall/instant {fmt,option 0..3},
 *             bestworst {fmt,best,worst}, split {fmt,counts:[v0,v1,v2]}, 공통 {fmt:"escape",which:"unsure"|"na"}.
 *             번호는 모두 화면 기준(폼 비트 반영 뒤)이다.
 *   부호      문항 값은 정수 -6..+6, 양수는 앞극(V W U H) 쪽. 값은 카드와 보기의 pole 필드에서 계산하며 key 필드를 읽지 않는다.
 *
 * 내보내는 것
 *   상수
 *     VERSION, AXES, FACETS_OF, LETTER_OF, FORMATS, ALPHABET, SKIP_CHAR, NA_CHAR, STATE_COUNTS, CODE_LENGTH, MIN_VALID_ANSWERS,
 *     MIN_COUNTED_FACETS, SKIP_HINT_OVER, RHYTHM_MIN_ANSWERS, RHYTHM_THRESHOLD_16THS, BAND_CLEAR_PER_FACET, BAND_LEAN_PER_FACET,
 *     UNSET_LETTER_MARK, DEFAULT_LAYOUT_PATH, DEFAULT_BANK_PATH
 *   불러오기와 조회 구조
 *     loadLayout(path?)            배치 골격 68행(scripts/lib/wedding-code-v40-layout.json)을 읽는다.
 *     loadBankData(path?)          문항 은행 원본 JSON(docs/wedding-code/2026-09-29_v40_items.json)을 읽는다.
 *     makeBank(data, options?)     조회 구조. options.strict(기본 true)이면 버전, 68개, id 순서를 배치 골격과 대조해 어긋나면 던진다.
 *     familyOf(fmt)                pair | react | choose(recall+instant) | bestworst | split | self.
 *   저장 상태 문자
 *     stateChar(i), stateIndexOf(char), isStateFor(fmt, char), isResponseValueFor(fmt, v), splitStateOf(a, b), splitCountsOf(s),
 *     bestWorstStateOf(best, worst), bestWorstPairOf(s), toCodeChar(v), fromCodeChar(c)
 *   문항 값
 *     stateValue(item, s)          상태 색인 s 의 문항 값(채점 문항).
 *     itemValue(item, v)           저장값 v 의 문항 값. skip, na, 없음, 그 형식에 없는 문자는 null(빠진 값이며 0 이 아니다).
 *     selfChoice(item, v)          자기 선택 문항의 {side, level} 또는 null.
 *   화면 답 <-> 저장값
 *     viewToStored(item, formBit, view)     화면 답을 저장값으로. 중간 상태나 범위 밖이면 null.
 *     storedToView(item, formBit, v)        저장값을 화면 답으로(위의 역).
 *     viewValue(item, formBit, view)        화면 답의 문항 값(채점 문항) 또는 null.
 *     isViewComplete(item, view)            화면 답이 저장값으로 바뀔 만큼 완성됐는가.
 *     viewPosition(item, formBit, v)        위치 반복 검사용 화면 위치(pair 위 0 아래 1, react 0..4, recall/instant 0..3).
 *   채점
 *     scoreAxis(bank, responses, axis) / scoreResponses(bank, responses)
 *         유효 답, 측면 집계, 세는 측면, 정수 가중합 N, 글자, 동점 사슬 1~5단계, 세기(정수 임계 |N| >= 36m, 18m).
 *     demoteBand(band)              한 단계 낮춤.
 *     rhythmReport(bank, formBit, responses)   위치 반복 검사(주기 1~4, 임계 pair 15/16, react와 choose 14/16).
 *     skippedCount(bank, responses), skipHint(bank, responses)
 *     buildResult(bank, formBit, responses)    힌트, 관문, 코드 글자열, 직접 고른 쪽 대비, 품질 안내까지 낸 전체 결과.
 *     selfLine(bank, responses, axis)          마지막에 직접 고른 쪽 줄(4.1 단계 1): 자기 선택에 답했고 그 주제에 글자가 있고 대비가 없을 때만
 *                                              {axis, side, letter, level}, 아니면 null. axis 는 buildResult 가 낸 주제 결과.
 *   링크 코덱
 *     checksumChar(body), encodeCode(bank, formBit, responses), decodeCode(bank, code),
 *     buildShareUrl(bank, origin, first, second?), buildQuestionOnlyUrl(origin, options?),
 *     decodeShareParams(bank, a, b), parseShareHash(bank, hash)
 *   시드 무작위 응답자
 *     mulberry32(seed), randomRespondent(bank, seed, options?)   결정적 응답자(uniform 또는 persona), 화면 답과 저장값을 함께 낸다.
 *   정적 균형과 배치 검증
 *     checkStaticBalance({ items, layout }, options?)   고정 응답과 위치 함수 응답의 형식별 합이 모두 0 인지(폼 비트 0, 1).
 *     verifyLayout(layout)                              배치 골격 자체의 성질(라틴 배치, 거울, 키 균형, 화면 규칙).
 *     derivedKey(item)                                  카드, 보기, 항목의 극 배열에서 파생한 키(+1, -1, 또는 배열이 어느 쪽도 아니면 null).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_LAYOUT_PATH = join(HERE, "wedding-code-v40-layout.json");
export const DEFAULT_BANK_PATH = join(HERE, "..", "..", "docs", "wedding-code", "2026-09-29_v40_items.json");

// ---------------------------------------------------------------------------
// 상수
// ---------------------------------------------------------------------------

export const VERSION = "v4.0-tendency";
export const AXES = ["money", "process", "scope", "support"];
export const FACETS_OF = {
  money: ["limit", "check", "worth", "moment"],
  process: ["search", "detail", "report", "owner"],
  scope: ["timing", "circle", "final", "form"],
  support: ["vent", "fight", "give", "recover"],
};
/** 주제마다 앞 글자(front, 값 양수)와 뒤 글자(back, 값 음수). */
export const LETTER_OF = {
  money: { front: "V", back: "S" },
  process: { front: "W", back: "D" },
  scope: { front: "U", back: "F" },
  support: { front: "H", back: "A" },
};
export const FORMATS = ["pair", "react", "recall", "instant", "bestworst", "split", "self"];
export const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
export const SKIP_CHAR = "-";
export const NA_CHAR = "_";
export const STATE_COUNTS = { pair: 6, react: 5, recall: 4, instant: 4, bestworst: 12, split: 28, self: 6 };
export const CODE_LENGTH = 70;
export const MIN_VALID_ANSWERS = 12;
export const MIN_COUNTED_FACETS = 3;
export const SKIP_HINT_OVER = 16;
export const RHYTHM_MIN_ANSWERS = 12;
/** agree x 16 >= considered x 값 이면 위치 반복(표시). pair 15, react 14, choose 14. */
export const RHYTHM_THRESHOLD_16THS = { pair: 15, react: 14, choose: 14 };
/** |N| >= 36 x m 이면 뚜렷해요, |N| >= 18 x m 이면 기울어요(정수 비교). */
export const BAND_CLEAR_PER_FACET = 36;
export const BAND_LEAN_PER_FACET = 18;
export const UNSET_LETTER_MARK = "·";

const ALPHA_INDEX = new Map([...ALPHABET].map((c, i) => [c, i]));

// ---------------------------------------------------------------------------
// 불러오기와 조회 구조
// ---------------------------------------------------------------------------

let layoutCache = null;

export function loadLayout(path) {
  if (!path && layoutCache) return layoutCache;
  const rows = JSON.parse(readFileSync(path ?? DEFAULT_LAYOUT_PATH, "utf8"));
  if (!path) layoutCache = rows;
  return rows;
}

export function loadBankData(path) {
  return JSON.parse(readFileSync(path ?? DEFAULT_BANK_PATH, "utf8"));
}

export function familyOf(fmt) {
  if (fmt === "recall" || fmt === "instant") return "choose";
  return fmt;
}

/**
 * 조회 구조. data 는 { version, items } (placeholder 같은 여분 필드는 무시).
 * items 배열은 질문 순서: 채점 64개(화면 0..39) 다음에 자기 선택 4개.
 */
export function makeBank(data, options = {}) {
  const strict = options.strict !== false;
  const layout = options.layout ?? loadLayout();
  const items = data.items;
  if (!Array.isArray(items)) throw new Error("items 가 배열이 아니다");
  if (strict) {
    if (data.version !== VERSION) throw new Error(`version 이 ${VERSION} 이 아니다: ${data.version}`);
    if (items.length !== layout.length) throw new Error(`items ${items.length}개, 배치 ${layout.length}개`);
    items.forEach((it, i) => {
      if (it.id !== layout[i].id) throw new Error(`items[${i}].id ${it.id} 는 배치의 ${layout[i].id} 가 아니다`);
    });
  }
  const scored = items.filter((it) => it.fmt !== "self");
  const self = items.filter((it) => it.fmt === "self");
  const byId = new Map(items.map((it) => [it.id, it]));
  const codeIndexById = new Map(items.map((it, i) => [it.id, i]));
  const scoredByAxis = {};
  for (const axis of AXES) scoredByAxis[axis] = scored.filter((it) => it.axis === axis);
  const screens = [];
  for (const it of items) (screens[it.screen] ??= []).push(it.id);
  return { version: data.version ?? VERSION, items, scored, self, byId, codeIndexById, scoredByAxis, screens, layout };
}

// ---------------------------------------------------------------------------
// 저장 상태 문자
// ---------------------------------------------------------------------------

export function stateChar(i) {
  if (!Number.isInteger(i) || i < 0 || i >= ALPHABET.length) throw new RangeError(`상태 색인 범위 밖: ${i}`);
  return ALPHABET[i];
}

export function stateIndexOf(char) {
  if (typeof char !== "string" || char.length !== 1) return null;
  return ALPHA_INDEX.has(char) ? ALPHA_INDEX.get(char) : null;
}

export function isStateFor(fmt, char) {
  const i = stateIndexOf(char);
  return i !== null && fmt in STATE_COUNTS && i < STATE_COUNTS[fmt];
}

export function isResponseValueFor(fmt, v) {
  return v === "skip" || v === "na" || isStateFor(fmt, v);
}

/** 칸 나누기 상태 색인: a = 첫 항목 칸 수, b = 둘째 항목 칸 수, 나머지 6-a-b 가 셋째. s = a(15-a)/2 + b. */
export function splitStateOf(a, b) {
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a + b > 6) throw new RangeError(`칸 수 범위 밖: ${a}, ${b}`);
  return (a * (15 - a)) / 2 + b;
}

export function splitCountsOf(s) {
  if (!Number.isInteger(s) || s < 0 || s > 27) throw new RangeError(`칸 나누기 상태 범위 밖: ${s}`);
  for (let a = 6; a >= 0; a -= 1) {
    const start = (a * (15 - a)) / 2;
    if (s >= start) return [a, s - start, 6 - a - (s - start)];
  }
  throw new RangeError(`unreachable ${s}`);
}

export function bestWorstStateOf(best, worst) {
  if (![best, worst].every((x) => Number.isInteger(x) && x >= 0 && x <= 3) || best === worst) throw new RangeError(`가장·아닌 것 범위 밖: ${best}, ${worst}`);
  return 3 * best + (worst < best ? worst : worst - 1);
}

export function bestWorstPairOf(s) {
  if (!Number.isInteger(s) || s < 0 || s > 11) throw new RangeError(`가장·아닌 것 상태 범위 밖: ${s}`);
  const best = Math.floor(s / 3);
  const r = s % 3;
  return { best, worst: r < best ? r : r + 1 };
}

export function toCodeChar(v) {
  if (v === "skip") return SKIP_CHAR;
  if (v === "na") return NA_CHAR;
  return v;
}

export function fromCodeChar(c) {
  if (c === SKIP_CHAR) return "skip";
  if (c === NA_CHAR) return "na";
  return stateIndexOf(c) !== null ? c : null;
}

// ---------------------------------------------------------------------------
// 문항 값
// ---------------------------------------------------------------------------

const sgn = (pole) => (pole === "front" ? 1 : pole === "back" ? -1 : 0);

/** 상태 색인 s 의 문항 값(채점 문항). 카드, 보기, 항목의 pole 에서 계산한다. 값 0 은 -0 이 아니라 0 이다. */
export function stateValue(item, s) {
  const value = rawStateValue(item, s);
  return value === 0 ? 0 : value;
}

function rawStateValue(item, s) {
  switch (item.fmt) {
    case "pair": {
      const card = s < 3 ? item.cards[0] : item.cards[1];
      const level = s < 3 ? 3 - s : s - 2;
      return 2 * level * sgn(card.pole);
    }
    case "react":
      return (s - 2) * 3 * sgn(item.highPole);
    case "recall":
    case "instant": {
      const opt = item.options[s];
      return sgn(opt.pole) * (opt.strength === "strong" ? 6 : 2);
    }
    case "bestworst": {
      const { best, worst } = bestWorstPairOf(s);
      return 4 * sgn(item.cards[best].pole) - 2 * sgn(item.cards[worst].pole);
    }
    case "split": {
      const counts = splitCountsOf(s);
      return counts.reduce((sum, n, i) => sum + n * sgn(item.entries[i].pole), 0);
    }
    default:
      throw new Error(`채점 문항이 아니다: ${item.fmt}`);
  }
}

export function itemValue(item, v) {
  if (item.fmt === "self") return null;
  if (v === undefined || v === "skip" || v === "na") return null;
  const s = stateIndexOf(v);
  if (s === null || s >= STATE_COUNTS[item.fmt]) return null;
  return stateValue(item, s);
}

export function selfChoice(item, v) {
  if (item.fmt !== "self" || v === undefined || v === "skip" || v === "na") return null;
  const s = stateIndexOf(v);
  if (s === null || s >= 6) return null;
  const card = s < 3 ? item.cards[0] : item.cards[1];
  return { side: card.pole, level: s < 3 ? 3 - s : s - 2 };
}

// ---------------------------------------------------------------------------
// 화면 답 <-> 저장값 (폼 비트 규칙)
// ---------------------------------------------------------------------------
//   pair, self      카드 위아래 교환      저장 색인 s = 5 - 화면 칸
//   react           양끝 자리 교환        s = 4 - 화면 칸
//   recall, instant 보기 순서 뒤집기       s = 3 - 화면 번호
//   bestworst       카드 순서 뒤집기       best, worst 각각 3 - 화면 색인
//   split           앞 두 항목만 교환      저장 (a, b, c) = 화면 (v1, v0, v2)

const isInt = (x) => Number.isInteger(x);

export function isViewComplete(item, view) {
  if (!view || typeof view !== "object") return false;
  if (view.fmt === "escape") return view.which === "unsure" || view.which === "na";
  if (view.fmt !== item.fmt) return false;
  switch (item.fmt) {
    case "pair":
    case "self":
      return isInt(view.cell) && view.cell >= 0 && view.cell <= 5;
    case "react":
      return isInt(view.cell) && view.cell >= 0 && view.cell <= 4;
    case "recall":
    case "instant":
      return isInt(view.option) && view.option >= 0 && view.option <= 3;
    case "bestworst":
      return isInt(view.best) && isInt(view.worst) && view.best >= 0 && view.best <= 3 && view.worst >= 0 && view.worst <= 3 && view.best !== view.worst;
    case "split":
      return Array.isArray(view.counts) && view.counts.length === 3 && view.counts.every((n) => isInt(n) && n >= 0) && view.counts[0] + view.counts[1] + view.counts[2] === 6;
    default:
      return false;
  }
}

export function viewToStored(item, formBit, view) {
  if (!isViewComplete(item, view)) return null;
  if (view.fmt === "escape") return view.which === "unsure" ? "skip" : "na";
  const flip = formBit === 1;
  switch (item.fmt) {
    case "pair":
    case "self":
      return stateChar(flip ? 5 - view.cell : view.cell);
    case "react":
      return stateChar(flip ? 4 - view.cell : view.cell);
    case "recall":
    case "instant":
      return stateChar(flip ? 3 - view.option : view.option);
    case "bestworst": {
      const best = flip ? 3 - view.best : view.best;
      const worst = flip ? 3 - view.worst : view.worst;
      return stateChar(bestWorstStateOf(best, worst));
    }
    case "split": {
      const [v0, v1, v2] = view.counts;
      const [a, b] = flip ? [v1, v0] : [v0, v1];
      void v2;
      return stateChar(splitStateOf(a, b));
    }
    default:
      return null;
  }
}

export function storedToView(item, formBit, v) {
  if (v === "skip") return { fmt: "escape", which: "unsure" };
  if (v === "na") return { fmt: "escape", which: "na" };
  if (!isStateFor(item.fmt, v)) return null;
  const s = stateIndexOf(v);
  const flip = formBit === 1;
  switch (item.fmt) {
    case "pair":
      return { fmt: "pair", cell: flip ? 5 - s : s };
    case "self":
      return { fmt: "self", cell: flip ? 5 - s : s };
    case "react":
      return { fmt: "react", cell: flip ? 4 - s : s };
    case "recall":
    case "instant":
      return { fmt: item.fmt, option: flip ? 3 - s : s };
    case "bestworst": {
      const { best, worst } = bestWorstPairOf(s);
      return { fmt: "bestworst", best: flip ? 3 - best : best, worst: flip ? 3 - worst : worst };
    }
    case "split": {
      const [a, b, c] = splitCountsOf(s);
      return { fmt: "split", counts: flip ? [b, a, c] : [a, b, c] };
    }
    default:
      return null;
  }
}

export function viewValue(item, formBit, view) {
  if (item.fmt === "self") return null;
  const stored = viewToStored(item, formBit, view);
  return stored === null ? null : itemValue(item, stored);
}

export function viewPosition(item, formBit, v) {
  if (!isStateFor(item.fmt, v)) return null;
  const s = stateIndexOf(v);
  switch (item.fmt) {
    case "pair": {
      const bankCard = s < 3 ? 0 : 1;
      return formBit === 1 ? 1 - bankCard : bankCard;
    }
    case "react":
      return formBit === 1 ? 4 - s : s;
    case "recall":
    case "instant":
      return formBit === 1 ? 3 - s : s;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// 채점 (설계 5절)
// ---------------------------------------------------------------------------

export function demoteBand(band) {
  return band === "clear" ? "lean" : "even";
}

/** 한 주제의 집계. 측면 4개, 유효 답 12개 이상, 세는 측면 3개 이상이면 글자를 만든다. */
export function scoreAxis(bank, responses, axis) {
  const items = bank.scoredByAxis[axis];
  const facets = FACETS_OF[axis].map((facet) => ({ facet, answered: 0, frontCount: 0, backCount: 0, neutralCount: 0, sum: 0, counted: false }));
  const facetIndex = new Map(facets.map((f, i) => [f.facet, i]));
  let answered = 0;
  let frontCount = 0;
  let backCount = 0;
  let neutralCount = 0;
  let skipped = 0;
  let notApplicable = 0;
  let sum = 0;
  let chooseSum = 0;
  let reactSum = 0;
  for (const item of items) {
    const raw = responses[item.id];
    if (raw === "skip") skipped += 1;
    else if (raw === "na") notApplicable += 1;
    const value = itemValue(item, raw);
    if (value === null) continue;
    answered += 1;
    if (value > 0) frontCount += 1;
    else if (value < 0) backCount += 1;
    else neutralCount += 1;
    sum += value;
    const f = facets[facetIndex.get(item.facet)];
    f.answered += 1;
    if (value > 0) f.frontCount += 1;
    else if (value < 0) f.backCount += 1;
    else f.neutralCount += 1;
    f.sum += value;
    if (item.fmt === "recall" || item.fmt === "instant") chooseSum += value;
    if (item.fmt === "react") reactSum += value;
  }
  for (const f of facets) f.counted = f.answered >= 2;
  const counted = facets.filter((f) => f.counted);
  const countedFacets = counted.length;
  const unusable = countedFacets < MIN_COUNTED_FACETS || answered < MIN_VALID_ANSWERS;
  const base = { axis, answered, frontCount, backCount, neutralCount, skipped, notApplicable, facets, countedFacets, sum, unusable };
  if (unusable) {
    return { ...base, weighted: null, s: null, side: null, letter: null, tieLevel: null, provisional: false, band: null };
  }
  let weighted = 0;
  for (const f of counted) {
    const factor = 12 / f.answered; // 2, 3, 4 -> 6, 4, 3 (항상 정수)
    if (!Number.isInteger(factor)) throw new Error(`12/n 이 정수가 아니다: ${f.answered}`);
    weighted += f.sum * factor;
  }
  let side;
  let tieLevel = 0;
  if (weighted > 0) side = "front";
  else if (weighted < 0) side = "back";
  else {
    // 동점 사슬
    const signSide = (n) => (n > 0 ? "front" : n < 0 ? "back" : null);
    let decided = signSide(chooseSum);
    tieLevel = 1;
    if (!decided) {
      decided = signSide(reactSum);
      tieLevel = 2;
    }
    if (!decided) {
      const pos = counted.filter((f) => f.sum > 0).length;
      const neg = counted.filter((f) => f.sum < 0).length;
      decided = pos > neg ? "front" : neg > pos ? "back" : null;
      tieLevel = 3;
    }
    if (!decided) {
      const selfItem = bank.self.find((it) => it.axis === axis);
      const choice = selfItem ? selfChoice(selfItem, responses[selfItem.id]) : null;
      decided = choice ? choice.side : null;
      tieLevel = 4;
    }
    if (!decided) {
      decided = "front";
      tieLevel = 5;
    }
    side = decided;
  }
  const abs = Math.abs(weighted);
  let band;
  if (tieLevel > 0) band = "even";
  else if (abs >= BAND_CLEAR_PER_FACET * countedFacets) band = "clear";
  else if (abs >= BAND_LEAN_PER_FACET * countedFacets) band = "lean";
  else band = "even";
  return {
    ...base,
    weighted,
    s: weighted / (72 * countedFacets), // 참고값(판정에 쓰지 않는다)
    side,
    letter: LETTER_OF[axis][side],
    tieLevel,
    provisional: tieLevel === 5,
    band,
  };
}

export function scoreResponses(bank, responses) {
  return { axes: AXES.map((axis) => scoreAxis(bank, responses, axis)) };
}

// ---------------------------------------------------------------------------
// 위치 반복 검사, 건너뜀 힌트
// ---------------------------------------------------------------------------

const RHYTHM_FAMILIES = ["pair", "react", "choose"];

export function rhythmReport(bank, formBit, responses) {
  const formats = RHYTHM_FAMILIES.map((family) => {
    const seq = [];
    for (const item of bank.scored) {
      if (familyOf(item.fmt) !== family) continue;
      const pos = viewPosition(item, formBit, responses[item.id]);
      if (pos !== null) seq.push(pos);
    }
    const considered = seq.length;
    if (considered < RHYTHM_MIN_ANSWERS) return { family, considered, period: null, agree: 0, flagged: false };
    let bestAgree = -1;
    let bestPeriod = 1;
    for (let p = 1; p <= 4; p += 1) {
      let agree = 0;
      for (let r = 0; r < p; r += 1) {
        const counts = new Map();
        let top = 0;
        for (let i = r; i < considered; i += p) {
          const n = (counts.get(seq[i]) ?? 0) + 1;
          counts.set(seq[i], n);
          if (n > top) top = n;
        }
        agree += top;
      }
      if (agree > bestAgree) {
        bestAgree = agree;
        bestPeriod = p;
      }
    }
    const flagged = bestAgree * 16 >= considered * RHYTHM_THRESHOLD_16THS[family];
    return { family, considered, period: bestPeriod, agree: bestAgree, flagged };
  });
  const flaggedCount = formats.filter((f) => f.flagged).length;
  return { formats, flaggedCount };
}

export function skippedCount(bank, responses) {
  return bank.scored.filter((it) => responses[it.id] === "skip").length;
}

export function skipHint(bank, responses) {
  return skippedCount(bank, responses) > SKIP_HINT_OVER;
}

// ---------------------------------------------------------------------------
// 전체 결과
// ---------------------------------------------------------------------------

export function buildResult(bank, formBit, responses) {
  const { axes: scores } = scoreResponses(bank, responses);
  const rhythm = rhythmReport(bank, formBit, responses);
  const skipped = skippedCount(bank, responses);
  const hintRhythm = rhythm.flaggedCount >= 2;
  const hintSkip = skipped > SKIP_HINT_OVER;
  const demoted = hintRhythm || hintSkip;
  const axes = scores.map((sc) => {
    const shownBand = sc.band === null ? null : demoted ? demoteBand(sc.band) : sc.band;
    let contrast = null;
    if (sc.letter !== null && (shownBand === "clear" || shownBand === "lean")) {
      const selfItem = bank.self.find((it) => it.axis === sc.axis);
      const choice = selfItem ? selfChoice(selfItem, responses[selfItem.id]) : null;
      if (choice && choice.side !== sc.side && choice.level >= 2) {
        contrast = {
          axis: sc.axis,
          selfSide: choice.side,
          selfLetter: LETTER_OF[sc.axis][choice.side],
          selfLevel: choice.level,
          gatheredSide: sc.side,
          gatheredLetter: sc.letter,
          gatheredBand: shownBand,
        };
      }
    }
    return { ...sc, shownBand, contrast };
  });
  const hasConfirmed = axes.some((a) => a.letter !== null && !a.provisional);
  let gate = { closed: false, reason: null };
  if (rhythm.flaggedCount === 3) gate = { closed: true, reason: "rhythm" };
  else if (!hasConfirmed) gate = { closed: true, reason: "noInformation" };
  const code = gate.closed ? null : axes.map((a) => a.letter ?? UNSET_LETTER_MARK).join("");
  const notes = {
    hintRhythm,
    hintSkip,
    demoted,
    hasOmitted: bank.scored.some((it) => responses[it.id] === "skip" || responses[it.id] === "na"),
    skippedCount: skipped,
    notApplicableCount: bank.scored.filter((it) => responses[it.id] === "na").length,
    unusableAxes: axes.filter((a) => a.unusable).map((a) => a.axis),
    provisionalAxes: axes.filter((a) => a.provisional).map((a) => a.axis),
  };
  return { formBit, axes, code, gate, rhythm, notes };
}

// ---------------------------------------------------------------------------
// 마지막에 직접 고른 쪽 줄 (4.1 단계 1)
// ---------------------------------------------------------------------------

/**
 * 결과 화면 주제 블록의 사실 줄. 본인이 자기 선택 문항에서 고른 방향과 세기만 담고 모은 답과 견주지 않는다.
 * 조건: 그 주제에 글자가 있다(못 정한 주제는 null, 반반이에요는 있다) + 자기 선택에 답했다(skip, na, 빠진 답은 null.
 * 임시 글자는 자기 선택이 동점을 못 가른 주제라 자기 선택이 비어 있어서 줄이 없다) + 직접 고른 쪽 대비(axis.contrast)가 그 주제에 없다
 * (대비 문장이 같은 사실을 이미 말한다).
 * 세기, 힌트, 관문은 읽지 않는다. buildResult 의 어떤 필드도 바꾸지 않는다.
 * axis 는 buildResult 가 낸 주제 결과여야 한다. contrast 가 없는(undefined) 객체를 넘기면 대비가 없는 주제로 잘못 읽어 줄을 만들거나
 * 조용히 null 을 내는 대신 던진다(기준 계산기는 모양이 틀린 입력을 눈에 띄게 거절해야 다른 계산기와의 대조가 헛돌지 않는다).
 */
export function selfLine(bank, responses, axis) {
  if (axis === null || typeof axis !== "object" || axis.contrast === undefined) {
    throw new TypeError("selfLine: axis.contrast 가 없다(undefined). buildResult 가 낸 주제 결과를 넘겨야 한다");
  }
  if (axis.letter === null || axis.contrast !== null) return null;
  const selfItem = bank.self.find((it) => it.axis === axis.axis);
  const choice = selfItem ? selfChoice(selfItem, responses[selfItem.id]) : null;
  if (choice === null) return null;
  return { axis: axis.axis, side: choice.side, letter: LETTER_OF[axis.axis][choice.side], level: choice.level };
}

// ---------------------------------------------------------------------------
// 링크 코덱 (70자)
// ---------------------------------------------------------------------------

function codeCharValue(c) {
  if (c === SKIP_CHAR) return 59;
  if (c === NA_CHAR) return 60;
  const i = stateIndexOf(c);
  if (i === null) throw new RangeError(`체크섬에 쓸 수 없는 문자: ${JSON.stringify(c)}`);
  return i;
}

/** T = 합 ((i mod 60) + 1) x v(body[i]), 체크섬 문자 = 알파벳[T mod 61]. */
export function checksumChar(body) {
  let t = 0;
  for (let i = 0; i < body.length; i += 1) t += ((i % 60) + 1) * codeCharValue(body[i]);
  return ALPHABET[t % 61];
}

export function encodeCode(bank, formBit, responses) {
  if (formBit !== 0 && formBit !== 1) return null;
  let body = String(formBit);
  let stateChars = 0;
  for (const item of bank.items) {
    const v = responses[item.id];
    if (v === undefined || !isResponseValueFor(item.fmt, v)) return null;
    if (v !== "skip" && v !== "na") stateChars += 1;
    body += toCodeChar(v);
  }
  if (stateChars === 0) return null;
  return body + checksumChar(body);
}

export function decodeCode(bank, code) {
  if (typeof code !== "string" || code.length !== CODE_LENGTH) return null;
  if (code[0] !== "0" && code[0] !== "1") return null;
  const responses = {};
  let stateChars = 0;
  for (let i = 0; i < bank.items.length; i += 1) {
    const item = bank.items[i];
    const ch = code[i + 1];
    const v = fromCodeChar(ch);
    if (v === null || !isResponseValueFor(item.fmt, v)) return null;
    if (v !== "skip" && v !== "na") stateChars += 1;
    responses[item.id] = v;
  }
  let expected;
  try {
    expected = checksumChar(code.slice(0, CODE_LENGTH - 1));
  } catch {
    return null;
  }
  if (code[CODE_LENGTH - 1] !== expected) return null;
  if (stateChars === 0) return null;
  return { formBit: Number(code[0]), responses };
}

export function buildShareUrl(bank, origin, first, second) {
  const a = encodeCode(bank, first.formBit, first.responses);
  if (a === null) return null;
  const base = `${String(origin).replace(/\/+$/, "")}/wedding-code#v=${VERSION}&a=${a}`;
  if (!second) return base;
  const b = encodeCode(bank, second.formBit, second.responses);
  return b === null ? null : `${base}&b=${b}`;
}

export function buildQuestionOnlyUrl(origin, options = {}) {
  const explicitVersion = options.explicitVersion !== false;
  const base = `${String(origin).replace(/\/+$/, "")}/wedding-code`;
  return explicitVersion ? `${base}?v=${VERSION}` : base;
}

/** a, b 는 해시에서 뽑은 값(없으면 null). a 와 b 가 모두 null 이면 none, b 만 있으면 invalid, 하나라도 못 풀면 invalid. */
export function decodeShareParams(bank, a, b) {
  if (a === null && b === null) return { kind: "none" };
  if (a === null) return { kind: "invalid" };
  const first = decodeCode(bank, a);
  if (!first) return { kind: "invalid" };
  if (b === null) return { kind: "partner", first };
  const second = decodeCode(bank, b);
  if (!second) return { kind: "invalid" };
  return { kind: "both", first, second };
}

/** 주소의 해시(# 포함 또는 제외) 전체를 읽는다. 키는 v, a, b 만 한 번씩 허용하고 v 는 판 태그여야 한다. */
export function parseShareHash(bank, hash) {
  if (hash === null || hash === undefined) return { kind: "none" };
  const s = String(hash).startsWith("#") ? String(hash).slice(1) : String(hash);
  if (s === "") return { kind: "none" };
  const seen = new Map();
  for (const part of s.split("&")) {
    const eq = part.indexOf("=");
    if (eq <= 0) return { kind: "invalid" };
    const key = part.slice(0, eq);
    const val = part.slice(eq + 1);
    if (!["v", "a", "b"].includes(key) || seen.has(key)) return { kind: "invalid" };
    seen.set(key, val);
  }
  if (seen.get("v") !== VERSION) return { kind: "invalid" };
  return decodeShareParams(bank, seen.get("a") ?? null, seen.get("b") ?? null);
}

// ---------------------------------------------------------------------------
// 시드 무작위 응답자
// ---------------------------------------------------------------------------

/** 설계 분석 스크립트와 같은 mulberry32. 0 이상 1 미만. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normal(rng) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * 결정적 응답자. 같은 seed 와 options 는 언제나 같은 결과다.
 * options: { mode: "uniform" | "persona"(기본), formBit(기본은 무작위), skipRate(0.04), naRate(0.03), spread(persona 의 주제 기울기 표준편차, 2.0) }
 * 반환: { seed, mode, formBit, responses(68개 모두 채움), views(문항 id -> 화면 답), theta(persona 만) }
 * 전부 skip/na 인 응답은 나오지 않는다(첫 문항이 상태 문자가 아니면 하나를 상태 문자로 바꾼다).
 */
export function randomRespondent(bank, seed, options = {}) {
  const rng = mulberry32(seed);
  const mode = options.mode ?? "persona";
  const skipRate = options.skipRate ?? 0.04;
  const naRate = options.naRate ?? 0.03;
  const spread = options.spread ?? 2.0;
  const formBit = options.formBit ?? (rng() < 0.5 ? 0 : 1);
  const theta = Object.fromEntries(AXES.map((axis) => [axis, normal(rng) * spread]));
  const responses = {};
  const views = {};
  const pickState = (item) => {
    const n = STATE_COUNTS[item.fmt];
    if (mode === "uniform") return Math.floor(rng() * n);
    // persona: 값이 큰 상태일수록 성향 쪽으로 확률을 준다(다항 로짓).
    const x = theta[item.axis] + normal(rng) * 0.6;
    const weights = [];
    for (let s = 0; s < n; s += 1) {
      let score;
      if (item.fmt === "self") {
        const card = s < 3 ? item.cards[0] : item.cards[1];
        score = sgn(card.pole) * (s < 3 ? 3 - s : s - 2);
      } else {
        score = stateValue(item, s);
      }
      weights.push(Math.exp((x * score) / 3));
    }
    const total = weights.reduce((a, b) => a + b, 0);
    let r = rng() * total;
    for (let s = 0; s < n; s += 1) {
      r -= weights[s];
      if (r <= 0) return s;
    }
    return n - 1;
  };
  bank.items.forEach((item, index) => {
    const r = rng();
    let stored;
    if (r < skipRate) stored = "skip";
    else if (r < skipRate + naRate) stored = "na";
    else stored = stateChar(pickState(item));
    if (index === 0 && (stored === "skip" || stored === "na")) stored = stateChar(pickState(item));
    responses[item.id] = stored;
    views[item.id] = storedToView(item, formBit, stored);
  });
  return { seed, mode, formBit, responses, views, theta: mode === "persona" ? theta : undefined };
}

// ---------------------------------------------------------------------------
// 키 파생과 정적 균형
// ---------------------------------------------------------------------------

/** 극 배열에서 파생한 키. pair/self: 위 카드 극, react: highPole, 나머지: 배열 규칙. 어느 쪽도 아니면 null. */
export function derivedKey(item) {
  const poleKey = (p) => (p === "front" ? 1 : p === "back" ? -1 : null);
  const same = (list, want) => list.length === want.length && list.every((x, i) => x === want[i]);
  switch (item.fmt) {
    case "pair":
    case "self": {
      if (!Array.isArray(item.cards) || item.cards.length !== 2) return null;
      const [a, b] = item.cards.map((c) => c?.pole);
      if (a === "front" && b === "back") return 1;
      if (a === "back" && b === "front") return -1;
      return null;
    }
    case "react":
      return poleKey(item.highPole);
    case "recall":
    case "instant": {
      if (!Array.isArray(item.options) || item.options.length !== 4) return null;
      const sig = item.options.map((o) => `${o?.pole}:${o?.strength}`);
      if (same(sig, ["back:weak", "front:strong", "front:weak", "back:strong"])) return 1;
      if (same(sig, ["front:weak", "back:strong", "back:weak", "front:strong"])) return -1;
      return null;
    }
    case "bestworst": {
      if (!Array.isArray(item.cards) || item.cards.length !== 4) return null;
      const poles = item.cards.map((c) => c?.pole);
      if (same(poles, ["front", "back", "back", "front"])) return 1;
      if (same(poles, ["back", "front", "front", "back"])) return -1;
      return null;
    }
    case "split": {
      if (!Array.isArray(item.entries) || item.entries.length !== 3) return null;
      const poles = item.entries.map((e) => e?.pole);
      if (same(poles, ["front", "back", "neutral"])) return 1;
      if (same(poles, ["back", "front", "neutral"])) return -1;
      return null;
    }
    default:
      return null;
  }
}

function viewOfIndex(family, fmt, rng) {
  switch (family) {
    case "pair":
      return { fmt: "pair", cell: Math.floor(rng() * 6) };
    case "react":
      return { fmt: "react", cell: Math.floor(rng() * 5) };
    case "choose":
      return { fmt, option: Math.floor(rng() * 4) };
    case "bestworst": {
      const best = Math.floor(rng() * 4);
      let worst = Math.floor(rng() * 3);
      if (worst >= best) worst += 1;
      return { fmt: "bestworst", best, worst };
    }
    case "split": {
      const counts = [0, 0, 0];
      for (let t = 0; t < 6; t += 1) counts[Math.floor(rng() * 3)] += 1;
      return { fmt: "split", counts };
    }
    default:
      throw new Error(family);
  }
}

function contextsOf(items, layout) {
  const scoredCount = layout.filter((r) => r.fmt !== "self").length;
  const famCount = {};
  const ctxs = [];
  for (let g = 0; g < scoredCount; g += 1) {
    const item = items[g];
    const fam = familyOf(item.fmt);
    const fi = (famCount[fam] = (famCount[fam] ?? -1) + 1);
    const section = layout[g].section;
    ctxs.push({ g, item, fam, fi, section, posInSection: g - section * 16, axis: item.axis });
  }
  return ctxs;
}

/** 고정 화면 답(형식마다 가능한 모든 칸)과 위치 함수 응답의 형식별 합이 모두 0 인가. 폼 비트 0, 1 모두. */
export function checkStaticBalance({ items, layout }, options = {}) {
  const trials = options.trials ?? 40;
  const ctxs = contextsOf(items, layout);
  const violations = [];
  let checks = 0;
  const record = (kind, strategy, formBit, axis, group, sum) => {
    checks += 1;
    if (sum !== 0) violations.push({ kind, strategy, formBit, axis, group, sum });
  };
  const sumBy = (formBit, pick, groupOf, viewFor) => {
    const totals = new Map();
    for (const c of ctxs) {
      const view = viewFor(c);
      if (!view || !pick(c)) continue;
      const value = viewValue(c.item, formBit, view);
      if (value === null) throw new Error(`정적 균형 시험이 만든 화면 답이 채점되지 않는다: ${c.item.id} ${JSON.stringify(view)}`);
      const key = `${c.axis}|${groupOf(c)}`;
      totals.set(key, (totals.get(key) ?? 0) + value);
    }
    return totals;
  };
  // 1) 고정 화면 답: 형식마다 하나의 칸만 계속 누른다.
  const constants = [];
  for (let cell = 0; cell < 6; cell += 1) constants.push({ fmt: "pair", name: `pair 늘 같은 칸 ${cell}`, view: () => ({ fmt: "pair", cell }) });
  for (let cell = 0; cell < 5; cell += 1) constants.push({ fmt: "react", name: `react 늘 같은 칸 ${cell}`, view: () => ({ fmt: "react", cell }) });
  for (const f of ["recall", "instant"]) for (let option = 0; option < 4; option += 1) constants.push({ fmt: f, name: `${f} 늘 같은 보기 ${option}`, view: () => ({ fmt: f, option }) });
  for (let best = 0; best < 4; best += 1) for (let worst = 0; worst < 4; worst += 1) if (best !== worst) constants.push({ fmt: "bestworst", name: `bestworst 늘 같은 자리 ${best}/${worst}`, view: () => ({ fmt: "bestworst", best, worst }) });
  for (let a = 0; a <= 6; a += 1) for (let b = 0; a + b <= 6; b += 1) constants.push({ fmt: "split", name: `split 늘 같은 칸 ${a}/${b}/${6 - a - b}`, view: () => ({ fmt: "split", counts: [a, b, 6 - a - b] }) });
  for (const formBit of [0, 1]) {
    for (const cs of constants) {
      const totals = sumBy(formBit, (c) => c.item.fmt === cs.fmt, () => cs.fmt, () => cs.view());
      for (const axis of AXES) record("fixed", cs.name, formBit, axis, cs.fmt, totals.get(`${axis}|${cs.fmt}`) ?? 0);
    }
  }
  // 2) 번갈아, 돌려 누르기(서식 안 색인 기준의 결정적 함수)
  const alternating = (name, viewFor) => ({ name, viewFor });
  const shaped = [
    alternating("좌우 번갈아(서식 안 색인 짝홀)", (c) => {
      const hi = c.fi % 2 === 1;
      switch (c.fam) {
        case "pair": return { fmt: "pair", cell: hi ? 5 : 0 };
        case "react": return { fmt: "react", cell: hi ? 4 : 0 };
        case "choose": return { fmt: c.item.fmt, option: hi ? 3 : 0 };
        case "bestworst": return hi ? { fmt: "bestworst", best: 3, worst: 0 } : { fmt: "bestworst", best: 0, worst: 3 };
        default: return { fmt: "split", counts: hi ? [0, 6, 0] : [6, 0, 0] };
      }
    }),
    alternating("돌려 누르기(서식 안 색인 mod 4)", (c) => {
      const k = c.fi % 4;
      switch (c.fam) {
        case "pair": return { fmt: "pair", cell: [0, 2, 3, 5][k] };
        case "react": return { fmt: "react", cell: k };
        case "choose": return { fmt: c.item.fmt, option: k };
        case "bestworst": return { fmt: "bestworst", best: k, worst: (k + 2) % 4 };
        default: return { fmt: "split", counts: [[6, 0, 0], [0, 6, 0], [0, 0, 6], [2, 2, 2]][k] };
      }
    }),
  ];
  for (const formBit of [0, 1]) {
    for (const st of shaped) {
      const totals = sumBy(formBit, () => true, (c) => c.fam, st.viewFor);
      for (const axis of AXES) for (const fam of ["pair", "react", "choose", "bestworst", "split"]) record("fixed", st.name, formBit, axis, fam, totals.get(`${axis}|${fam}`) ?? 0);
    }
  }
  // 3) 위치 함수 응답: 같은 부류(구간 안 위치, 전체 순서 mod, 서식 안 색인 mod)는 같은 화면 답을 누른다.
  const classFns = {
    "구간 안 위치 x 구간 홀짝": (c) => `${c.posInSection}:${c.section % 2}`,
    "전체 순서 mod 32": (c) => c.g % 32,
    "전체 순서 mod 16": (c) => c.g % 16,
    "전체 순서 mod 8": (c) => c.g % 8,
    "전체 순서 mod 4": (c) => c.g % 4,
    "전체 순서 mod 2": (c) => c.g % 2,
    "서식 안 색인 mod 4": (c) => c.fi % 4,
    "서식 안 색인 mod 2": (c) => c.fi % 2,
  };
  const rng = mulberry32(options.seed ?? 20260929);
  for (const [name, fn] of Object.entries(classFns)) {
    for (let t = 0; t < trials; t += 1) {
      const table = new Map();
      const viewFor = (c) => {
        const key = `${c.fam}:${fn(c)}`;
        if (!table.has(key)) table.set(key, viewOfIndex(c.fam, c.item.fmt, rng));
        const base = table.get(key);
        return c.fam === "choose" ? { ...base, fmt: c.item.fmt } : base;
      };
      const formBit = rng() < 0.5 ? 0 : 1;
      const totals = sumBy(formBit, () => true, (c) => c.fam, viewFor);
      for (const axis of AXES) for (const fam of ["pair", "react", "choose", "bestworst", "split"]) record("class", name, formBit, axis, fam, totals.get(`${axis}|${fam}`) ?? 0);
    }
  }
  return { violations, checks };
}

// ---------------------------------------------------------------------------
// 배치 골격 자체의 성질
// ---------------------------------------------------------------------------

const LIGHT = new Set(["pair", "react", "recall", "instant"]);
const HEAVY = new Set(["bestworst", "split"]);
const slotOfFmt = (fmt) => (fmt === "pair" ? 0 : fmt === "react" ? 1 : fmt === "recall" || fmt === "instant" ? 2 : 3);

/** 문제 목록 [{ rule, message }]. 비어 있으면 설계 성질을 모두 만족한다. */
export function verifyLayout(layout) {
  const problems = [];
  const bad = (rule, message) => problems.push({ rule, message });
  if (layout.length !== 68) bad("layout-count", `배치가 ${layout.length}행이다(68행이어야 한다)`);
  const ids = new Set(layout.map((r) => r.id));
  if (ids.size !== layout.length) bad("layout-duplicate-id", "배치에 같은 id 가 있다");
  const scored = layout.filter((r) => r.fmt !== "self");
  const self = layout.filter((r) => r.fmt === "self");
  if (scored.length !== 64 || self.length !== 4) bad("layout-count", `채점 ${scored.length}행, 자기 선택 ${self.length}행이다`);
  // 축마다 형식 개수
  const want = { pair: 4, react: 4, recall: 2, instant: 2, bestworst: 2, split: 2 };
  for (const axis of AXES) {
    const rows = scored.filter((r) => r.axis === axis);
    if (rows.length !== 16) bad("layout-axis-count", `${axis} 채점 문항이 ${rows.length}개다`);
    for (const [fmt, n] of Object.entries(want)) {
      const got = rows.filter((r) => r.fmt === fmt).length;
      if (got !== n) bad("layout-format-count", `${axis} ${fmt} ${got}개(${n}개여야 한다)`);
    }
    // 측면: 각 4문항, 서로 다른 네 슬롯
    for (const facet of FACETS_OF[axis]) {
      const fr = rows.filter((r) => r.facet === facet);
      if (fr.length !== 4) bad("layout-facet-count", `${axis}.${facet} 이 ${fr.length}문항이다`);
      const slots = new Set(fr.map((r) => slotOfFmt(r.fmt)));
      if (slots.size !== 4) bad("layout-latin", `${axis}.${facet} 이 네 슬롯을 한 번씩 만나지 않는다`);
    }
    // 키 균형
    for (const fmt of Object.keys(want)) {
      const sum = rows.filter((r) => r.fmt === fmt).reduce((s, r) => s + r.key, 0);
      if (sum !== 0) bad("layout-key-balance", `${axis} ${fmt} 키 합이 ${sum}이다`);
    }
    const choose = rows.filter((r) => r.fmt === "recall" || r.fmt === "instant").reduce((s, r) => s + r.key, 0);
    if (choose !== 0) bad("layout-key-balance", `${axis} 고르기 키 합이 ${choose}이다`);
    for (const kind of ["action", "story"]) {
      const sum = rows.filter((r) => r.fmt === "react" && r.kind === kind).reduce((s, r) => s + r.key, 0);
      if (sum !== 0) bad("layout-key-balance", `${axis} react ${kind} 키 합이 ${sum}이다`);
    }
    const kinds = rows.filter((r) => r.fmt === "pair").map((r) => r.kind).sort().join(",");
    if (kinds !== "friends,method,method,moment") bad("layout-kind", `${axis} pair 종류가 ${kinds}이다`);
    // 자기 묘사 6개 이하(pair method, instant, bestworst), 간접 10개 이상
    const selfDescribing = rows.filter((r) => (r.fmt === "pair" && r.kind === "method") || r.fmt === "instant" || r.fmt === "bestworst").length;
    if (selfDescribing > 6 || 16 - selfDescribing < 10) bad("layout-indirect", `${axis} 자기 묘사 ${selfDescribing}개`);
  }
  if (self.reduce((s, r) => s + r.key, 0) !== 0) bad("layout-key-balance", "자기 선택 키 합이 0이 아니다");
  // 구간: 형식 구성, 축마다 측면 4개
  for (let c = 0; c < 4; c += 1) {
    const rows = scored.filter((r) => r.section === c);
    if (rows.length !== 16) bad("layout-section-count", `구간 ${c} 이 ${rows.length}문항이다`);
    for (const [fmt, n] of Object.entries(want)) {
      const got = rows.filter((r) => r.fmt === fmt).length;
      if (got !== n) bad("layout-section-format", `구간 ${c} ${fmt} ${got}개`);
    }
    for (const axis of AXES) {
      const facets = new Set(rows.filter((r) => r.axis === axis).map((r) => r.facet));
      if (facets.size !== 4) bad("layout-latin", `구간 ${c} ${axis} 측면이 ${facets.size}개다`);
    }
    // 하위 종류
    for (const r of rows) {
      if (r.fmt === "pair") {
        const expect = c === 1 ? "moment" : c === 3 ? "friends" : "method";
        if (r.kind !== expect) bad("layout-kind", `${r.id} pair 종류 ${r.kind}(${expect}여야 한다)`);
      }
      if (r.fmt === "react") {
        const expect = c % 2 === 0 ? "action" : "story";
        if (r.kind !== expect) bad("layout-kind", `${r.id} react 종류 ${r.kind}(${expect}여야 한다)`);
      }
    }
  }
  // 화면 규칙
  const screens = new Map();
  for (const r of layout) {
    if (!screens.has(r.screen)) screens.set(r.screen, []);
    screens.get(r.screen).push(r);
  }
  const expectedScreens = 42;
  if (screens.size !== expectedScreens) bad("layout-screens", `화면이 ${screens.size}개다(${expectedScreens}개여야 한다)`);
  for (const [n, rows] of screens) {
    rows.forEach((r, i) => {
      if (r.pos !== i) bad("layout-screens", `화면 ${n} 의 ${r.id} pos ${r.pos}(${i}여야 한다)`);
    });
    if (rows.length > 2) bad("layout-screens", `화면 ${n} 에 ${rows.length}개가 있다`);
    if (rows.length === 2) {
      if (rows[0].axis === rows[1].axis) bad("layout-screens", `화면 ${n} 에 같은 주제 두 문항이 있다`);
      if (!rows.every((r) => LIGHT.has(r.fmt) || r.fmt === "self")) bad("layout-screens", `화면 ${n} 에 무거운 형식이 다른 문항과 함께 있다`);
    }
    if (rows.some((r) => HEAVY.has(r.fmt)) && rows.length !== 1) bad("layout-screens", `무거운 형식 화면 ${n} 은 한 문항이어야 한다`);
    const sections = new Set(rows.map((r) => r.section));
    if (sections.size !== 1) bad("layout-screens", `화면 ${n} 이 구간을 가로지른다`);
    const s = rows[0].section;
    if (s < 4 && (n < s * 10 || n >= s * 10 + 10)) bad("layout-screens", `화면 ${n} 의 번호가 구간 ${s} 범위 밖이다`);
    if (s === 4 && n < 40) bad("layout-screens", `자기 선택 화면 번호 ${n}`);
  }
  // 행 순서가 화면 순서인가
  for (let i = 1; i < layout.length; i += 1) {
    const a = layout[i - 1];
    const b = layout[i];
    if (b.screen < a.screen || (b.screen === a.screen && b.pos <= a.pos)) bad("layout-order", `${b.id} 가 화면 순서를 어긴다`);
  }
  // 같은 주제가 연달아 나오지 않는다(채점 문항 흐름, 화면 경계 포함)
  for (let i = 1; i < scored.length; i += 1) if (scored[i].axis === scored[i - 1].axis) bad("layout-adjacent-axis", `${scored[i - 1].id} 다음에 ${scored[i].id} 가 같은 주제로 이어진다`);
  // 구간 시작과 끝, 첫 구간 앞 두 화면
  for (let c = 0; c < 4; c += 1) {
    const secScreens = [...screens.entries()].filter(([, rows]) => rows[0].section === c).sort((x, y) => x[0] - y[0]);
    if (secScreens.length !== 10) bad("layout-screens", `구간 ${c} 화면이 ${secScreens.length}개다`);
    const first = secScreens[0]?.[1] ?? [];
    const last = secScreens.at(-1)?.[1] ?? [];
    if (!first.every((r) => r.fmt === "pair" || r.fmt === "react")) bad("layout-screens", `구간 ${c} 첫 화면이 두 가지 중 고르기나 이럴 때가 아니다`);
    if (last.some((r) => HEAVY.has(r.fmt))) bad("layout-screens", `구간 ${c} 마지막 화면이 무거운 형식이다`);
    // 마음이 무거운 측면(마지막 선택, 다툰 뒤)은 구간 앞 세 화면과 마지막 화면에 오지 않는다
    secScreens.forEach(([n, rows], idx) => {
      for (const r of rows) {
        if ((r.facet === "final" || r.facet === "fight") && (idx < 3 || idx === secScreens.length - 1)) bad("layout-heavy-topic", `${r.id} 가 구간 ${c} 의 ${idx + 1}번째 화면(${n})에 있다`);
        if (c === 0 && (r.facet === "final" || r.facet === "fight") && !(r.fmt === "pair" || r.fmt === "react")) bad("layout-heavy-topic", `${r.id} 는 첫 구간에서 가벼운 형식이어야 한다`);
      }
    });
    if (c === 0) {
      secScreens.slice(0, 2).forEach(([n, rows]) => {
        for (const r of rows) {
          if (!(r.fmt === "pair" || r.fmt === "react")) bad("layout-screens", `첫 구간 화면 ${n} 에 ${r.fmt} 가 있다`);
          if (r.axis === "support") bad("layout-screens", `첫 구간 앞 두 화면에 지쳤을 때 주제가 있다: ${r.id}`);
        }
      });
    }
  }
  // 거울: 구간 0 과 2, 1 과 3 은 (주제, 화면 위치)가 같고 형식 묶음이 같으며 키가 반대
  for (const r of scored.filter((x) => x.section < 2)) {
    const partner = scored.find((x) => x.section === r.section + 2 && x.axis === r.axis && x.screen === r.screen + 20 && x.pos === r.pos);
    if (!partner) {
      bad("layout-mirror", `${r.id} 의 거울 문항이 없다`);
      continue;
    }
    if (familyOf(partner.fmt) !== familyOf(r.fmt)) bad("layout-mirror", `${r.id} 와 ${partner.id} 의 형식 묶음이 다르다`);
    if (partner.key !== -r.key) bad("layout-mirror", `${r.id} 와 ${partner.id} 의 키가 반대가 아니다`);
    if (r.fmt === "recall" || r.fmt === "instant") {
      // 거울 쌍에서 두 하위 종류가 서로 바뀐다(이 성질이 깨져도 합은 0 이지만 설계가 달라진다)
      if (partner.fmt === r.fmt) bad("layout-mirror", `${r.id} 와 ${partner.id} 의 고르기 하위 종류가 같다`);
    }
  }
  return problems;
}
