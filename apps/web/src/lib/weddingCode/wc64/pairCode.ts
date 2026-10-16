// wc64 두 사람 비교용 '답 코드'. 서버 없이 사람이 직접 주고받는 글자열이다.
//
// 모양(하이픈·공백을 뺀 72자):
//   "WC64" + 판 문자 1 + 식 계획 문자 1(Y/M/N) + 답 64자 + 검사 문자 2
// - 답은 WC64_ORDER 의 묶음 순서, 묶음 안 문항 순서대로 한 글자씩: 1~5 = 고른 칸, 0 = 안 답함, 9 = 해당 없음.
// - 검사 문자는 식 계획 문자와 답 글자로 낸 가중합(자리 번호 × 값)을 소수 887 로 나눈 나머지를 30진 두 글자로 쓴 것이다.
//   자리 번호(1~65)와 값 차이(1~9)의 곱이 887 보다 작으므로 한 글자만 바뀌어도, 이웃한 두 글자가 뒤바뀌어도 반드시 어긋난다.
// - 사람이 읽기 쉽게 6자마다 '-' 를 넣는다. 읽을 때는 공백·하이픈·소문자를 무시한다.
//
// 이 코드는 주소·저장소·서버 어디에도 싣지 않는다. 화면이 보여 주고, 사람이 복사해 보낸다.
import { WC64_ITEMS, isWc64CeremonyOff, wc64SectionById, wc64SectionIdOfItem } from "./bank";
import { isWc64Rating } from "./model";
import type { Wc64Answers, Wc64Plan, Wc64Skipped } from "./types";

export const WC64_PAIR_PREFIX = "WC64" as const;
/** 판 문자. wc64-r1-2026-10-16 = "A". 문항이나 순서가 바뀌는 새 판은 다른 문자를 쓴다. */
export const WC64_PAIR_EDITION = "A" as const;
export const WC64_PAIR_ANSWER_COUNT = 64;
/** 하이픈을 뺀 전체 길이 */
export const WC64_PAIR_LENGTH = WC64_PAIR_PREFIX.length + 1 + 1 + WC64_PAIR_ANSWER_COUNT + 2;

const CHECK_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ"; // 30자, 헷갈리는 0·1·I·L·O·U 를 뺐다
const CHECK_MOD = 887; // 소수, 30*30 = 900 안

const PLAN_TO_CHAR: Record<Wc64Plan, "Y" | "M" | "N"> = { yes: "Y", maybe: "M", none: "N" };
const CHAR_TO_PLAN: Record<string, Wc64Plan> = { Y: "yes", M: "maybe", N: "none" };
const PLAN_VALUE: Record<string, number> = { Y: 1, M: 2, N: 3 };

export type Wc64PairCodeErrorKind = "empty" | "not-wc64" | "other-edition" | "length" | "typo";

export const WC64_PAIR_CODE_MESSAGES: Record<Wc64PairCodeErrorKind, string> = {
  empty: "상대 코드를 붙여 넣어 주세요.",
  "not-wc64": "웨딩코드 답 코드가 아니에요. WC64로 시작하는 코드를 붙여 넣어 주세요.",
  "other-edition": "다른 판 코드예요. 같은 질문에 답한 코드끼리만 나란히 볼 수 있어요.",
  length: "코드가 잘렸어요. 처음부터 끝까지 다시 복사해 주세요.",
  typo: "틀린 글자가 있어요. 받은 코드를 그대로 다시 붙여 넣어 주세요.",
};

export type Wc64PairDecodeResult =
  | { ok: true; answers: Wc64Answers; plan: Wc64Plan; skipped: Wc64Skipped }
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
 * 내 답을 답 코드로 만든다. 계산에 넣지 않는 답(식을 안 올려 빠진 문항)은 '안 답함'으로 적어
 * 내 화면 결과와 상대가 보는 내 결과가 같게 한다. plan 이 null 이면 'M'(계산은 maybe 와 같다).
 */
export function encodeWc64PairCode(answers: Wc64Answers, plan: Wc64Plan | null, skipped: Wc64Skipped = {}): string {
  const planChar = PLAN_TO_CHAR[plan ?? "maybe"];
  let digits = "";
  for (const it of WC64_ITEMS) {
    const v = Object.prototype.hasOwnProperty.call(answers, it.id) ? answers[it.id] : undefined;
    if (isWc64CeremonyOff(it.id, plan, skipped)) digits += "0";
    else if (v === 0) digits += "9";
    else if (isWc64Rating(v)) digits += String(v);
    else digits += "0";
  }
  const body = `${WC64_PAIR_PREFIX}${WC64_PAIR_EDITION}${planChar}${digits}${checksum(planChar, digits)}`;
  return group(body);
}

/** 붙여 넣은 글자에서 공백·하이픈(비슷한 줄표 포함)을 빼고 대문자로 바꾼다. */
export function normalizeWc64PairCode(text: string): string {
  return text.replace(/[\s\-‐-―−­]/g, "").toUpperCase();
}

function fail(kind: Wc64PairCodeErrorKind): Wc64PairDecodeResult {
  return { ok: false, kind, reason: WC64_PAIR_CODE_MESSAGES[kind] };
}

/** 답 코드를 읽는다. 판·길이·검사 문자가 틀리면 거절하고 이유를 준다. */
export function decodeWc64PairCode(text: string): Wc64PairDecodeResult {
  const s = normalizeWc64PairCode(typeof text === "string" ? text : "");
  if (!s) return fail("empty");
  if (!s.startsWith(WC64_PAIR_PREFIX)) {
    // 'WC64' 앞부분만 남은 경우도 잘린 코드로 본다
    return WC64_PAIR_PREFIX.startsWith(s) ? fail("length") : fail("not-wc64");
  }
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
  const skipped: Wc64Skipped = {};
  WC64_ITEMS.forEach((it, i) => {
    const c = digits[i];
    if (c === "0") return;
    answers[it.id] = c === "9" ? 0 : (Number(c) as 1 | 2 | 3 | 4 | 5);
    // 식을 안 올리는데 다른 자리로 답한 묶음: 그 묶음의 "예식" 문항에 답이 있으면 다른 자리를 고른 것이다
    if (plan === "none" && it.skip_tag === "예식") {
      const sid = wc64SectionIdOfItem(it.id);
      const sec = sid ? wc64SectionById(sid) : undefined;
      if (sid && sec?.noceremony_alt) skipped[sid] = false;
    }
  });
  return { ok: true, answers, plan, skipped };
}
