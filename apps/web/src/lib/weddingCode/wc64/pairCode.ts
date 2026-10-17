// wc64 두 사람 비교용 '답 코드'. 서버 없이 사람이 직접 주고받는 글자열이다.
//
// 모양(하이픈·공백을 뺀 72자):
//   "WC64" + 판 문자 1 + 식 계획 문자 1(Y/M/N) + 답 64자 + 검사 문자 2
// - 답은 WC64_ORDER 의 묶음 순서, 묶음 안 문항 순서대로 한 글자씩: 1~5 = 고른 칸, 0 = 안 답함, 9 = 해당 없음.
// - 검사 문자는 식 계획 문자와 답 글자로 낸 가중합(자리 번호 × 값)을 소수 887 로 나눈 나머지를 30진 두 글자로 쓴 것이다.
//   자리 번호(1~65)와 값 차이(1~9)의 곱이 887 보다 작으므로 한 글자만 바뀌어도, 이웃한 두 글자가 뒤바뀌어도 반드시 어긋난다.
// - 사람이 읽기 쉽게 6자마다 '-' 를 넣는다. 읽을 때는 공백·폭 없는 공백·하이픈·소문자를 무시한다.
// - 붙여 넣은 글에 다른 말(안내 글, 따옴표, 마침표, 같은 코드 두 번)이 섞여 있어도 코드 모양 부분만 찾아 읽는다.
// - 서로 다른 코드가 여럿이면(대화방을 통째로 복사한 경우) 내 코드(mine)를 빼고 남은 하나를 읽는다.
//   그래도 둘 이상이면 고르지 않고 "several" 로 어느 코드인지 되묻는다.
// - 식 없이 하는 사람(N)의 '예식' 문항은 늘 '안 답함'(0)으로 적는다. 묶음을 다른 자리로 답하던 갈래는
//   2026-10-16 DEC-1 로 없어서 코드에 묶음 넘기기 상태를 싣지 않는다(읽은 skipped 는 늘 {}).
//
// 이 코드는 주소·저장소·서버 어디에도 싣지 않는다. 화면이 보여 주고, 사람이 복사해 보낸다.
// 복사하는 안내 글(wc64PairShareMessage)에 들어가는 주소는 시작 화면 주소일 뿐 답을 싣지 않는다.
import { WC64_ITEMS, isWc64CeremonyOff } from "./bank";
import { isWc64Rating } from "./model";
import type { Wc64Answers, Wc64Plan, Wc64Skipped } from "./types";

export const WC64_PAIR_PREFIX = "WC64" as const;
/**
 * 판 문자. wc64-r1-2026-10-16 = "A". 공개 뒤에 문항·순서·식 표시가 바뀌는 새 판은 다른 문자를 쓴다.
 * 공개 전(2026-10-16 감사·1단계·2단계 검토)에 바뀐 문장과 '예식' 표식은 "A" 그대로 둔다(계약 §7). 은행 지문은 pairCode.test 가 묶는다.
 */
export const WC64_PAIR_EDITION = "A" as const;
export const WC64_PAIR_ANSWER_COUNT = 64;
/** 하이픈을 뺀 전체 길이 */
export const WC64_PAIR_LENGTH = WC64_PAIR_PREFIX.length + 1 + 1 + WC64_PAIR_ANSWER_COUNT + 2;

const CHECK_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ"; // 30자, 헷갈리는 0·1·I·L·O·U 를 뺐다
const CHECK_MOD = 887; // 소수, 30*30 = 900 안

const PLAN_TO_CHAR: Record<Wc64Plan, "Y" | "M" | "N"> = { yes: "Y", maybe: "M", none: "N" };
const CHAR_TO_PLAN: Record<string, Wc64Plan> = { Y: "yes", M: "maybe", N: "none" };
const PLAN_VALUE: Record<string, number> = { Y: 1, M: 2, N: 3 };

export type Wc64PairCodeErrorKind =
  | "empty" | "not-wc64" | "legacy-link" | "address-only" | "other-edition" | "length" | "typo" | "several";

export const WC64_PAIR_CODE_MESSAGES: Record<Wc64PairCodeErrorKind, string> = {
  empty: "상대 코드를 붙여 넣어 주세요.",
  "not-wc64": "웨딩코드 답 코드가 아니에요. WC64로 시작하는 코드를 붙여 넣어 주세요.",
  "legacy-link": "예전 웨딩코드 링크예요. 64문항과는 질문이 달라 나란히 볼 수 없어요. 상대에게 64문항을 끝낸 뒤 나오는 WC64 코드를 보내 달라고 해 주세요.",
  "address-only": "주소만 있고 코드가 없어요. 받은 글에서 WC64로 시작하는 코드까지 붙여 넣어 주세요.",
  "other-edition": "다른 판 코드예요. 같은 질문에 답한 코드끼리만 나란히 볼 수 있어요.",
  length: "코드가 잘렸어요. 처음부터 끝까지 다시 복사해 주세요.",
  typo: "틀린 글자가 있어요. 받은 코드를 그대로 다시 붙여 넣어 주세요.",
  several: "서로 다른 코드가 둘 이상 들어 있어요. 어느 코드로 볼지 하나만 남기고 다시 붙여 넣어 주세요.",
};

export type Wc64PairDecodeResult =
  /** code: 붙여 넣은 글에서 찾아 읽은 코드(하이픈 없는 72자). skipped 는 늘 {}(코드에 묶음 넘기기를 싣지 않는다) */
  | { ok: true; answers: Wc64Answers; plan: Wc64Plan; skipped: Wc64Skipped; code: string }
  | { ok: false; kind: Wc64PairCodeErrorKind; reason: string };

function checksum(planChar: string, digits: string): string {
  let s = PLAN_VALUE[planChar] ?? 0;
  for (let i = 0; i < digits.length; i++) s += (i + 2) * Number(digits[i]);
  const v = s % CHECK_MOD;
  return CHECK_ALPHABET[Math.floor(v / 30)] + CHECK_ALPHABET[v % 30];
}

function group(text: string, size = 6): string {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out.join("-");
}

/**
 * 내 답을 답 코드로 만든다. 계산에 넣지 않는 답(식 없이 하기로 해서 빠진 문항)은 '안 답함'으로 적어
 * 내 화면 결과와 상대가 보는 내 결과가 같게 한다. plan 이 null 이면 'M'(계산은 maybe 와 같다).
 * 넘긴 묶음은 흐름이 그 문항을 모두 '해당 없음'(0)으로 적어 두므로 '9' 로 실려 상대에게도 같은 까닭으로 보인다.
 * 묶음 넘기기 상태는 받지 않는다(옛 '다른 자리' 갈래 때문에 받던 셋째 인자를 2026-10-17 심사 CQ-5로 지웠다, DEC-1).
 */
export function encodeWc64PairCode(answers: Wc64Answers, plan: Wc64Plan | null): string {
  const planChar = PLAN_TO_CHAR[plan ?? "maybe"];
  let digits = "";
  for (const it of WC64_ITEMS) {
    const v = Object.prototype.hasOwnProperty.call(answers, it.id) ? answers[it.id] : undefined;
    if (isWc64CeremonyOff(it.id, plan)) digits += "0";
    else if (v === 0) digits += "9";
    else if (isWc64Rating(v)) digits += String(v);
    else digits += "0";
  }
  const body = `${WC64_PAIR_PREFIX}${WC64_PAIR_EDITION}${planChar}${digits}${checksum(planChar, digits)}`;
  return group(body);
}

/**
 * 복사 단추가 클립보드에 넣는 글: 안내 두 줄 + 코드. 받은 사람이 이 글을 통째로 붙여 넣어도 decodeWc64PairCode 가 읽는다.
 * address 는 시작 화면 주소(답을 싣지 않는다).
 */
export function wc64PairShareMessage(code: string, address: string): string {
  return [
    "웨딩코드 64문항 답 코드예요.",
    `${address} 에서 64문항을 끝내고, 결과 화면 ‘둘이 같이 보기’의 상대 코드 칸에 이 글을 그대로 붙여 넣으면 둘의 답을 나란히 볼 수 있어요.`,
    code,
  ].join("\n");
}

/**
 * 붙여 넣은 글자에서 공백·하이픈(비슷한 줄표 포함)을 빼고 대문자로 바꾼다.
 * 줄표: U+2010~2015, U+2212(빼기), U+00AD, U+2043, U+FE63, U+FF0D(전각 하이픈), U+30FC·U+FF70(장음 기호, 일본어 자판에서 섞임).
 * 폭 없는 글자: U+200B~U+200D, U+FEFF. \s 가 지우지 않아서, 메신저가 끼워 넣으면 코드가 다 있어도 잘린 코드로 읽혔다.
 */
export function normalizeWc64PairCode(text: string): string {
  return text.replace(/[\s\u200B-\u200D\uFEFF\-‐-―−­⁃﹣－ーｰ]/g, "").toUpperCase();
}

function fail(kind: Wc64PairCodeErrorKind): Wc64PairDecodeResult {
  return { ok: false, kind, reason: WC64_PAIR_CODE_MESSAGES[kind] };
}

/** 정규화한 글 안의 온전한 코드 모양(판 문자는 아무 대문자, 검사 문자 확인 전) */
const FULL_CODE = new RegExp(`${WC64_PAIR_PREFIX}[A-Z][YMN][0-59]{${WC64_PAIR_ANSWER_COUNT}}[${CHECK_ALPHABET}]{2}`, "g");
/** 예전 판 링크의 표시(#v=, #wc-likert=, ?ct=, 64 가 아닌 ?v=). 원문(정규화 전)에서 본다. */
const LEGACY_LINK = /#v=|#wc-likert=|[?&]ct=|[?&]v=(?!64(?![0-9a-z]))/i;
/** 주소처럼 보이는 글 */
const ADDRESS_LIKE = /https?:\/\/|www\.|hanbang\.ai|\/wedding-code/i;

/**
 * 답 코드를 읽는다. 붙여 넣은 글에서 코드 모양 부분을 찾아 그 부분만 읽고, 앞뒤 다른 글자는 버린다.
 * 판·길이·검사 문자가 틀리면 거절하고 이유를 준다. 코드가 없고 링크·주소만 있으면 그렇다고 알린다.
 * 검사 문자까지 맞는 서로 다른 코드가 여럿이면 opts.mine(내 코드, 하이픈 있어도 됨)과 같은 것을 빼고,
 * 남은 것이 하나면 그것을, 둘 이상이면 "several" 을 돌려준다(오래된 쪽이나 내 쪽을 말없이 고르지 않는다).
 * 내 코드만 있으면 내 코드를 읽는다(화면이 '내 코드와 같아요'를 알린다).
 */
export function decodeWc64PairCode(text: string, opts: { mine?: string } = {}): Wc64PairDecodeResult {
  const raw = typeof text === "string" ? text : "";
  const s = normalizeWc64PairCode(raw);
  if (!s) return fail("empty");
  // 1) 온전한 모양: 검사 문자까지 맞는 코드(같은 코드를 두 번 붙여도 하나로 본다). 다 틀리면 첫 코드의 이유.
  const full = [...s.matchAll(FULL_CODE)].map(m => m[0]);
  const valid = new Map<string, Wc64PairDecodeResult>();
  for (const c of full) {
    if (valid.has(c)) continue;
    const r = readCode(c);
    if (r.ok) valid.set(c, r);
  }
  if (valid.size > 0) {
    const mine = typeof opts.mine === "string" ? normalizeWc64PairCode(opts.mine) : "";
    const others = [...valid.keys()].filter(c => c !== mine);
    if (others.length === 0) return valid.get(mine) as Wc64PairDecodeResult;
    if (others.length > 1) return fail("several");
    return valid.get(others[0]) as Wc64PairDecodeResult;
  }
  if (full.length) return readCode(full[0]);
  // 2) 'WC64' 뒤로 영숫자가 가장 길게 이어진 곳(잘렸거나 틀린 코드에 앞뒤 말이 붙은 경우)
  let run = "";
  for (const m of s.matchAll(/WC64[A-Z0-9]*/g)) if (m[0].length > run.length) run = m[0];
  if (run) return readCode(run);
  // 3) 코드가 없다
  if (LEGACY_LINK.test(raw)) return fail("legacy-link");
  if (ADDRESS_LIKE.test(raw)) return fail("address-only");
  // 'WC64' 앞부분만 남은 경우도 잘린 코드로 본다
  return WC64_PAIR_PREFIX.startsWith(s) ? fail("length") : fail("not-wc64");
}

/** 'WC64' 로 시작하는 글(하이픈 없음)을 코드로 읽는다. */
function readCode(s: string): Wc64PairDecodeResult {
  if (s.length < WC64_PAIR_PREFIX.length + 1) return fail("length");
  if (s[WC64_PAIR_PREFIX.length] !== WC64_PAIR_EDITION) return fail("other-edition");
  if (s.length < WC64_PAIR_LENGTH) return fail("length");
  if (s.length > WC64_PAIR_LENGTH) return fail("typo");
  const planChar = s[WC64_PAIR_PREFIX.length + 1];
  const digits = s.slice(WC64_PAIR_PREFIX.length + 2, WC64_PAIR_PREFIX.length + 2 + WC64_PAIR_ANSWER_COUNT);
  const check = s.slice(WC64_PAIR_LENGTH - 2);
  if (!(planChar in CHAR_TO_PLAN) || !/^[0-59]+$/.test(digits) || checksum(planChar, digits) !== check) return fail("typo");

  const plan = CHAR_TO_PLAN[planChar];
  const answers: Wc64Answers = {};
  WC64_ITEMS.forEach((it, i) => {
    const c = digits[i];
    if (c === "0") return;
    // 식 없이 하는 사람(N)의 '예식' 문항은 이 화면이 늘 0 으로 적는다. 손으로 만든 코드에 답이 있어도 계산처럼 버린다.
    if (isWc64CeremonyOff(it.id, plan)) return;
    answers[it.id] = c === "9" ? 0 : (Number(c) as 1 | 2 | 3 | 4 | 5);
  });
  return { ok: true, answers, plan, skipped: {}, code: s };
}
