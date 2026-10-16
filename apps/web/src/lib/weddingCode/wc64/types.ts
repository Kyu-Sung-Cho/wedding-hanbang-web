// 웨딩코드 wc64(64문항: 이해도 12 + 성향 52) 공유 타입과 상수.
// 이 판은 브라우저 안에서만 계산하고 저장한다. 서버·DB·이용 통계로 보내는 값은 없다.

export const WC64_VERSION = "wc64-r1-2026-10-16" as const;
/** 명시 주소 /wedding-code?v=64 */
export const WC64_QUERY_VALUE = "64" as const;
export const WC64_STORAGE_KEY = "hanbang:wedding-code:wc64:r1:draft" as const;
export const WC64_AUTOSAVE_KEY = `${WC64_STORAGE_KEY}:autosave` as const;
/** 마지막 저장부터 30일 */
export const WC64_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export type Wc64Letter = "D" | "O" | "W" | "L" | "C" | "U" | "M" | "R";
export type Wc64Rating = 1 | 2 | 3 | 4 | 5;
/** 1~5 = 고른 칸, 0 = 해당 없음. 키가 없으면 안 답함. */
export type Wc64Answer = Wc64Rating | 0;
export type Wc64Answers = Record<string, Wc64Answer>;
export type Wc64Plan = "yes" | "maybe" | "none";
/** 화면: clear 또렷해요 · lean 기울어 있어요 · slight 아슬해요 · half 반반이에요 */
export type Wc64Level = "clear" | "lean" | "slight" | "half";
export type Wc64DimId = "PACE" | "SPEND" | "CIRCLE" | "BOND";
/** 묶음 위치: 축 글자와 같은 쪽 / 반대쪽 / 가운데 / 두 쪽 다 끌림 / 두 쪽 다 덜 와닿음 */
export type Wc64FacetPos = "same" | "opp" | "mid" | "both-high" | "both-low";
export type Wc64Pattern = "same" | "agree";
/** 묶음별 "넘기기" 상태. true = 묶음 전체를 넘김(답은 0), false = 식 대신 다른 자리로 답하기로 함. */
export type Wc64Skipped = Record<string, boolean>;
export type Wc64Screen = "intro" | "plan" | "questions" | "result";

/* ---------------- 문항 은행(data/wc64-bank.json) ---------------- */

export interface Wc64Item {
  id: string;
  /** 성향 문항은 A/B, 이해도 문항은 L */
  pole: "A" | "B" | "L";
  /** 이해도 단계 L1~L4, 성향 문항은 "" */
  level: "" | "L1" | "L2" | "L3" | "L4";
  text: string;
  /** "예식"이면 식을 안 올릴 때 빠진다. "가족"·"예식"이면 '해당 없음'을 고를 수 있다. */
  skip_tag: "" | "예식" | "가족";
  facet: string;
  check_title: string;
  check_note: string;
  source: string;
  source_url: string;
  changed?: boolean;
}

export interface Wc64Pole { name: string; desc: string }

export interface Wc64Section {
  id: string;
  kind: "knowledge" | "bipolar";
  group_label: string;
  title: string;
  short: string;
  definition: string;
  pole_a: Wc64Pole;
  pole_b: Wc64Pole;
  intro: string;
  /** 비어 있지 않으면 묶음 전체를 넘기는 버튼 이름 */
  skip_all: string;
  /** 비어 있지 않으면 식을 안 올리는 사람에게 보여 줄 다른 자리 안내 */
  noceremony_alt: string;
  app_action: string;
  couple_question: string;
  items: Wc64Item[];
}

export interface Wc64Facet { axis: string; a_is: "A" | "B" }

export interface Wc64LetterCard {
  letter: Wc64Letter;
  comfy: string[];
  watch: { text: string; source: string }[];
  app_actions: string[];
  amora_line: string;
}

export interface Wc64Dim {
  id: Wc64DimId;
  name: string;
  question: string;
  letter_a: Wc64Letter;
  name_a: string;
  desc_a: string;
  letter_b: Wc64Letter;
  name_b: string;
  desc_b: string;
  facets: Wc64Facet[];
  decisions: string[];
  letters: Record<string, Wc64LetterCard>;
  balanced: string;
  couple_questions: string[];
}

export interface Wc64TypeCard {
  title: string;
  sub: string;
  one_liner: string;
  meets: string[];
  first: string;
  later: string;
  tips: string[];
}

export interface Wc64SceneCopy { here: string; tip: string }
export interface Wc64Scene {
  id: string;
  title: string;
  axis: Wc64DimId;
  a: Wc64SceneCopy;
  b: Wc64SceneCopy;
  half: Wc64SceneCopy;
}

export interface Wc64FundCopy { a_name: string; b_name: string; why_outside: string; couple_question: string }
export interface Wc64KnowledgeCopy { levels: string[]; stages: string[] }

export interface Wc64Meta {
  version: typeof WC64_VERSION;
  facts: { label: string; value: string }[];
  /** 다섯 칸 이름(1~5 순서) */
  scale: string[];
  plan_question: { q: string; options: { value: Wc64Plan; label: string }[]; help: string };
  start_note: string;
  recheck_note: string;
  checked_on: string;
}

export interface Wc64Bank {
  meta: Wc64Meta;
  sections: Wc64Section[];
  order: string[];
  dims: Wc64Dim[];
  types: Record<string, Wc64TypeCard>;
  scenes: Wc64Scene[];
  fund: Wc64FundCopy;
  knowledge: Wc64KnowledgeCopy;
}

/* ---------------- 계산 결과 ---------------- */

/** 두 쪽 답(1~5)으로 낸 축 값. X = 앞 글자 쪽, Y = 뒷 글자 쪽. */
export interface Wc64AxisStat {
  nX: number; nY: number; SX: number; SY: number;
  /** nY*SX - nX*SY. 양수면 X 쪽 */
  N: number;
  /** 50 + 12.5*N/(nX*nY) (소수) */
  exact: number;
  winner: "X" | "Y" | "T";
  /** 이긴 쪽 정수 % (동점이면 50) */
  shown: number;
  /** X쪽 문장 동의(0~100 정수) */
  agreeX: number;
  agreeY: number;
}

export interface Wc64Firmness {
  /** 문장을 반씩 골라 다시 계산한 경우 중 같은 글자가 나온 수(반올림) */
  agree: number;
  total: number;
  R: number;
  /** 반반이 되려면 옮겨야 하는 칸 수 */
  dist: number;
  /** 다시 계산한 X쪽 %의 10%~90% 폭 */
  band: [number, number];
}

/** 근거 인용 한 줄 */
export interface Wc64Quote {
  itemId: string;
  text: string;
  value: Wc64Rating;
  /** SCALE 이름 */
  label: string;
  /** X쪽으로 기운 정도(1~5) */
  towardX: number;
}

export type Wc64FacetResult = {
  /** 묶음(구역) id */
  section: string;
  title: string;
  a_is: "A" | "B";
  /** 축 앞 글자 쪽 이름(묶음 기준) */
  xName: string;
  yName: string;
  /** 앞 글자 쪽으로 센 답 */
  fx: number[];
  fy: number[];
} & (
  | { decided: false }
  | { decided: true; N: number; exact: number; pctX: number; pctY: number; pos: Wc64FacetPos }
);

export type Wc64DimResult =
  | {
      dim: Wc64DimId;
      decided: false;
      /** "no-ceremony" = 식을 안 올리기로 해서 정하지 않음(CIRCLE) */
      reason: "no-ceremony" | "too-few";
      n: number;
      total: number;
      facets: Wc64FacetResult[];
    }
  | {
      dim: Wc64DimId;
      decided: true;
      letter: Wc64Letter;
      letterSide: "X" | "Y";
      tie: boolean;
      n: number;
      total: number;
      pctX: number;
      pctY: number;
      /** 붙은 글자 쪽 % */
      letterPct: number;
      exact: number;
      agreeX: number;
      agreeY: number;
      firm: Wc64Firmness;
      level: Wc64Level;
      band: [number, number];
      facets: Wc64FacetResult[];
      /** 글자 쪽으로 가장 세게 고른 문장 2개, 반대쪽 1개 */
      quotes: { pro: Wc64Quote[]; con: Wc64Quote[] };
    };

export interface Wc64KnowledgeLevel {
  L: "L1" | "L2" | "L3" | "L4";
  name: string;
  state: "pass" | "no" | "skip";
  pct?: number;
}

export interface Wc64Knowledge {
  pct: number | null;
  /** 통과한 단계 수(0~4) */
  stage: number;
  stageName: string;
  n: number;
  levels: Wc64KnowledgeLevel[];
  /** 1~3을 고른 이해도 문항 앞에서 3개(알아 두면 좋은 것) */
  recheck: Wc64Item[];
}

export type Wc64Fund =
  | { decided: false; n: number }
  | { decided: true; N: number; n: number; pctA: number; pctB: number };

export interface Wc64SceneResult {
  id: string;
  title: string;
  dim: Wc64DimId;
  letter: Wc64Letter;
  letterPct: number;
  level: Wc64Level;
  key: "a" | "b" | "half";
  here: string;
  tip: string;
}

export interface Wc64Glance {
  /** 또렷·기운 글자 중 가운데서 먼 순서로 2개 */
  strong: Wc64DimId[];
  /** 아슬·반반 글자 */
  shaky: Wc64DimId[];
  /** 글자와 반대쪽으로 기운 묶음 */
  opposite: { dim: Wc64DimId; section: string; title: string }[];
  /** 두 쪽 문장에 비슷하게 답한 묶음 */
  both: { dim: Wc64DimId; section: string; title: string; pos: "both-high" | "both-low" }[];
}

export interface Wc64Report {
  version: typeof WC64_VERSION;
  plan: Wc64Plan | null;
  /** 네 자리. 정하지 못한 자리는 '·' */
  code: string;
  /** 네 글자를 모두 정했는지 */
  complete: boolean;
  type: Wc64TypeCard | null;
  dims: Wc64DimResult[];
  knowledge: Wc64Knowledge;
  fund: Wc64Fund;
  scenes: Wc64SceneResult[];
  glance: Wc64Glance;
  patterns: Wc64Pattern[];
  /** 계산에 넣은 문항 중 1~5로 답한 수 */
  answered: number;
  /** 계산에 넣은 문항 중 '해당 없음'(0) 수 */
  notApplicable: number;
}

export interface Wc64Draft {
  version: typeof WC64_VERSION;
  plan: Wc64Plan | null;
  answers: Wc64Answers;
  /** 묶음 넘기기 상태(없으면 {}) */
  skipped?: Wc64Skipped;
  cursor: number;
  screen: Wc64Screen;
  updatedAt: string;
}
