// 웨딩코드 wc64(64문항: 이해도 12 + 성향 52) 공유 타입과 상수.
// 이 판은 브라우저 안에서만 계산하고 저장한다. 서버·DB·이용 통계로 보내는 값은 없다.

export const WC64_VERSION = "wc64-r1-2026-10-16" as const;
/** 명시 주소 /wedding-code?v=64 */
export const WC64_QUERY_VALUE = "64" as const;
export const WC64_STORAGE_KEY = "hanbang:wedding-code:wc64:r1:draft" as const;
export const WC64_AUTOSAVE_KEY = `${WC64_STORAGE_KEY}:autosave` as const;
/** 마지막 저장부터 30일 */
export const WC64_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
/** 은행의 문항 수(식을 올릴 때 최대치). 라운지 카드가 은행 JSON을 읽지 않고 쓰는 값이라 시험이 WC64_ITEMS.length 와 맞춰 본다. */
export const WC64_ITEM_COUNT = 64;

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
/**
 * 묶음별 "넘기기" 상태. true = 묶음 전체를 넘김(답은 0).
 * false(옛 "식 대신 다른 자리로 답하기")는 2026-10-16 파운더 결정 DEC-1로 없앴다. 옛 기록에 남아 있어도 계산은 무시한다.
 */
export type Wc64Skipped = Record<string, boolean>;
/**
 * 글자 장·유형 카드 줄에 다는 '식 전제' 표식. 식 없이 하는 사람(plan "none") 결과에서는 이 표식이 붙은 줄을 뺀다.
 * 문항의 skip_tag "예식"과 같은 말이다.
 */
export const WC64_CEREMONY_TAG = "예식" as const;
/**
 * 글자 장 줄에 다는 '식 없이용' 표식. 이 표식이 붙은 줄은 식 없이 하는 사람(뺄 표식에 `WC64_CEREMONY_TAG`가 든 결과)에게만
 * 보인다. '예식' 줄이 모두 빠져 '챙겨 볼 것'이 비지 않게, 식을 전제하지 않는 줄을 하나 채우는 데 쓴다(2026-10-16 2단계 검토).
 */
export const WC64_NO_CEREMONY_ONLY_TAG = "식없이" as const;
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
  /**
   * "예식"이면 '알아 두면 좋은 것' 카드(check_title·check_note)가 식을 전제한다. 문항은 식 없이 해도 묻지만,
   * 식 없이 한 결과에서는 이 카드를 건너뛰고 다음 카드를 보인다(K1, 2026-10-16 2단계 검토).
   */
  check_tag?: "" | "예식";
  source: string;
  source_url: string;
  changed?: boolean;
  /** 이해도 문항 중 큰돈이 걸린 것(K7·K8·K10·K12). '알아 두면 좋은 것'에서 앞에 세운다. */
  big_money?: boolean;
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
  /**
   * 없앴다(2026-10-16 DEC-1: 식 없이 하는 사람에게 GUESTS 를 '다른 자리'로 묻던 갈래). 은행에는 이제 없다.
   * 화면 코드가 이 이름을 걷어 낼 때까지 선택 필드로만 남긴다. 값을 넣지 않는다(bank.test 가 지킨다).
   */
  noceremony_alt?: string;
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
  /**
   * 줄마다 뺄 조건 표식(같은 길이, "" = 늘 보임). 값은 그 줄이 기댄 묶음 id(그 묶음을 넘기면 뺀다),
   * "예식"(`WC64_CEREMONY_TAG`, 식 없이 하면 뺀다), "식없이"(`WC64_NO_CEREMONY_ONLY_TAG`, 식 없이 할 때만 보인다)
   * 또는 그 축 묶음의 문항 id(그 문항의 행동을 단정하는 줄. 그 문항에 1·2를 고르면 뺀다). 여럿이면 쉼표로 잇는다.
   * 화면은 `wc64LetterCopy(dim, letter, report.hiddenTags)`로 거른다.
   */
  line_sections?: { comfy?: string[]; watch?: string[]; app_actions?: string[] };
}

/** 묶음을 넘겼을 때 축 설명을 갈아 끼울 문구(그 묶음 이야기가 빠진 판) */
export interface Wc64DimSkipCopy { question: string; desc_a: string; desc_b: string }

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
  /** decisions 와 같은 길이. 그 결정이 기댄 묶음 id 또는 "예식"("" = 늘 보임) */
  decisions_sections?: string[];
  /** 묶음 id → 그 묶음을 넘겼을 때 쓰는 question·desc_a·desc_b */
  skip_copy?: Record<string, Wc64DimSkipCopy>;
  letters: Record<string, Wc64LetterCard>;
  balanced: string;
  couple_questions: string[];
}

/**
 * 결과 이름표: 형용사 + 동물(2026-10-17 파운더 결정). 고른 답 묶음에 붙인 이름이지 성격 설명이 아니다.
 * 그림·캐릭터 없이 글로만 쓴다. 16유형은 `Wc64TypeCard.name`, 식 없이 한 두 글자 결과 넷은 `Wc64Bank.no_ceremony_names`.
 */
export interface Wc64Name { adjective: string; animal: string }

/** 리포트에 붙는 이름(`Wc64Report.name`). label = 형용사와 동물을 띄어 쓴 것(예: "정갈한 두루미") */
export interface Wc64ReportName extends Wc64Name { label: string }

export interface Wc64TypeCard {
  title: string;
  sub: string;
  /** 이 유형의 이름(형용사 + 동물). 16유형 모두 다른 동물이다. */
  name: Wc64Name;
  one_liner: string;
  meets: string[];
  first: string;
  later: string;
  tips: string[];
  /**
   * 뺄 줄 표식("" = 늘 보임). "FAMILY"(가족 묶음을 넘기면 뺀다) 또는 문항 id(그 문항의 행동을 단정하는 줄, 그 문항에 1·2를
   * 고르면 뺀다). 여럿이면 쉼표로 잇는다. meets·tips 는 같은 길이 배열, first·later 는 그 글 전체.
   * 화면은 `wc64TypeCopy(card, report.hiddenTags)`로 거른다(뺀 first·later 는 빈 글자). one_liner 는 거르지 않는다.
   */
  line_sections?: { meets?: string[]; tips?: string[]; first?: string; later?: string };
}

export interface Wc64SceneCopy { here: string; tip: string }
export interface Wc64Scene {
  id: string;
  title: string;
  axis: Wc64DimId;
  /** 장면이 그리는 묶음. 그 묶음이 글자와 반대쪽·가운데면 a/b 대신 half 를 쓰고, 넘긴 묶음이면 장면을 뺀다. */
  section: string;
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
  // start_note(성향 문항 전체 안내)는 2026-10-16 감사(FIX-21)로 첫 성향 묶음 PLAN 의 intro 로 옮겼다.
  recheck_note: string;
  checked_on: string;
}

export interface Wc64Bank {
  meta: Wc64Meta;
  sections: Wc64Section[];
  order: string[];
  dims: Wc64Dim[];
  types: Record<string, Wc64TypeCard>;
  /**
   * 식 없이 한 결과(두 글자)의 이름. 키는 모델이 그 결과에 실제로 만드는 code 그대로다: 비운 SPEND·CIRCLE 자리는
   * 가운뎃점(U+00B7)이라 "D··M"·"D··R"·"O··M"·"O··R" 넷이다. 찾을 때는 `wc64NoCeremonyName(code)`.
   */
  no_ceremony_names: Record<string, Wc64Name>;
  scenes: Wc64Scene[];
  fund: Wc64FundCopy;
  /** 예산 막대(BUDGET 4문장, 식 계획과 상관없이 늘 글자 밖) 이름과 설명. 모양은 fund 와 같다. */
  budget_bar: Wc64FundCopy;
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
  /**
   * 원본 값: 같은 글자 조합 + 반반 조합 × 0.5 를 반올림한 수(= R × total). 화면 문장의 '~가지에서 나와요'에 쓰지 않는다
   * (반반을 절반으로 쳐서 부푼다, 2026-10-17 심사 HON-1). 화면은 same·tie 를 쓴다.
   */
  agree: number;
  /** 문장을 반씩 골라 다시 계산한 경우 중 원래 글자와 같은 쪽이 나온 수(정수). N = 0(동점)이면 0 */
  same: number;
  /** 다시 계산한 경우 중 반반(N = 0)이 나온 수 */
  tie: number;
  /** 다시 계산한 경우 수(6:6이면 400, 4:4이면 36) */
  total: number;
  /** 단계 기준(원본 그대로): (같은 글자 수 + 반반 수 × 0.5) ÷ total. N = 0 이면 (반반 수 + 나머지 × 0.5) ÷ total */
  R: number;
  /**
   * 반반이 되거나 반대 글자로 넘어가려면 답을 몇 칸 옮겨야 하는지(무게가 큰 쪽부터 옮긴 수). 옮긴 끝이 꼭 반반은 아니다:
   * 양쪽 문장 수가 다르면(해당 없음·안 답함) 반반을 건너뛰어 바로 반대 글자가 될 수 있다(2026-10-17 심사 HON-6).
   * 못 닿으면 Infinity, N = 0 이면 0.
   */
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

/**
 * 묶음 %를 내지 못한 까닭(판정 순서대로).
 * skipped = 묶음을 넘겼거나, 남은 문장(식 때문에 빠진 것 말고)을 모두 '해당 없음'으로 골랐다(본인이 고른 것을 먼저 본다)
 * · no-ceremony = 식 없이 해서 '예식' 문항이 빠지는 바람에 남은 문장이 한쪽뿐이거나 없다 · too-few = 그 밖(답이 적다).
 * 답과 식 계획만으로 정하므로 답 코드로 받은 상대 결과에서도 같게 나온다.
 */
export type Wc64FacetSkipReason = "no-ceremony" | "skipped" | "too-few";

/**
 * 글자를 정하지 못한 까닭(`wc64DimSkipReason`). 화면 셋(한눈에 보기·글자 장·비교)이 같은 판정을 쓴다.
 * no-ceremony = 식 없이 해서 남은 문장으로는 아무리 답해도 글자를 정할 수 없다(식 없이 하면 CIRCLE·SPEND)
 * · skipped = 넘긴 묶음이나 모두 '해당 없음'으로 고른 묶음이 있다 · too-few = 그 밖(답한 문장이 적다).
 */
export type Wc64DimSkipReason = Wc64FacetSkipReason;

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
  | { decided: false; reason: Wc64FacetSkipReason }
  | { decided: true; N: number; exact: number; pctX: number; pctY: number; pos: Wc64FacetPos }
);

/**
 * 동점(N = 0)에서 글자를 정한 규칙(계약 §3.3 순서).
 * five = '완전히 그래요' 비율 · agree = 4·5 비율 · disagree = 1·2 비율(적은 쪽) · facet = 기운 묶음 수 · default = 앞 글자
 */
export type Wc64TieRule = "five" | "agree" | "disagree" | "facet" | "default";

export type Wc64DimResult =
  | {
      dim: Wc64DimId;
      decided: false;
      /** 정하지 못한 까닭(`Wc64DimSkipReason`). 식 없이 하면 CIRCLE·SPEND 가 늘 "no-ceremony" */
      reason: Wc64DimSkipReason;
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
      /** 동점일 때 글자를 정한 규칙. 동점이 아니면 null */
      tieRule: Wc64TieRule | null;
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
      /** 단단함 기준(R·dist)은 '또렷해요'인데 문장이 8개보다 적어 '기울어 있어요'로 낮춘 경우 true */
      cappedByN: boolean;
      band: [number, number];
      facets: Wc64FacetResult[];
      /** 글자 쪽으로 가장 세게 고른 문장 2개, 반대쪽 1개 */
      quotes: { pro: Wc64Quote[]; con: Wc64Quote[] };
    };

export type Wc64KnowledgeLevelId = "L1" | "L2" | "L3" | "L4";

/**
 * 이해도 단계를 셈하지 못한(skip) 까닭.
 * no-ceremony = 식을 안 올려 그 단계 문항이 모두 빠졌다 · not-applicable = '해당 없음'만 골랐다 · unanswered = 답이 없다.
 */
export type Wc64KnowledgeSkipReason = "no-ceremony" | "not-applicable" | "unanswered";

export interface Wc64KnowledgeLevel {
  L: Wc64KnowledgeLevelId;
  name: string;
  state: "pass" | "no" | "skip";
  pct?: number;
  /** state 가 skip 일 때만 */
  skipReason?: Wc64KnowledgeSkipReason;
}

export interface Wc64Knowledge {
  pct: number | null;
  /**
   * 단계 위치(0~4) = L1부터 이어서 통과한 마지막 단계의 번호. skip 은 끊지 않고 건너뛴다(L1 통과, L2 skip,
   * L3·L4 통과면 4). 처음 만난 '아직'(no)에서 멈춘다. stageName = knowledge.stages[stage].
   */
  stage: number;
  stageName: string;
  n: number;
  levels: Wc64KnowledgeLevel[];
  /** 멈춘 단계 뒤에서 통과한 단계(예: L1 이 아직인데 L3·L4 통과면 ["L3","L4"]) */
  passedLater: Wc64KnowledgeLevelId[];
  /** 1~3을 고른 이해도 문항 3개(알아 두면 좋은 것). 큰돈 문항(big_money)을 앞에 세우고 나머지는 은행 순서 */
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
  /** 장면이 그리는 묶음 id */
  section: string;
  /** 그 묶음의 위치(묶음 %를 못 냈으면 null). same 이 아니면 key 는 half */
  facetPos: Wc64FacetPos | null;
  key: "a" | "b" | "half";
  here: string;
  tip: string;
}

export interface Wc64Glance {
  /** 또렷·기운 글자 중 2개: 또렷해요를 먼저, 같은 단계 안에서는 가운데서 먼 순서 */
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
  /**
   * 결과 이름(2026-10-17 파운더 결정). 식을 올리거나 아직이면(plan yes·maybe, 계산이 같은 null 도) 네 글자를 모두 정해
   * 유형 카드(type)가 있을 때만 그 유형 이름, 식 없이 하면(none) 남는 두 글자(D/O·M/R)를 모두 정했을 때만 식 없이 이름이다.
   * 글자가 하나라도 정해지지 않으면 null(화면은 글자를 메인으로 둔다). 참고로만 결과(아슬·반반 글자 둘 이상, 답 모양 알림)에도
   * 이름은 있다(화면이 참고로만 안내를 바로 붙인다).
   */
  name: Wc64ReportName | null;
  dims: Wc64DimResult[];
  knowledge: Wc64Knowledge;
  fund: Wc64Fund;
  scenes: Wc64SceneResult[];
  glance: Wc64Glance;
  /**
   * 넘긴 성향 묶음 id(묶음 넘기기, 또는 그 묶음을 모두 '해당 없음'). 답에서 정하므로 답 코드로 받은 결과도 같다.
   */
  skippedSections: string[];
  /**
   * 1·2(전혀·별로 아니에요)를 고른 성향 문항 id(`wc64DisagreedItems`). 은행 줄 표식에 문항 id 가 붙은 줄(그 문항의 행동을
   * 단정하는 줄)을 이 사람에게서 빼는 데 쓴다(2026-10-17 심사 UX-1). hiddenTags 에도 들어 있다.
   */
  disagreedItems: string[];
  /**
   * 글자 장·유형 카드 문구에서 뺄 표식 = skippedSections + (식 없이 하면 "예식") + disagreedItems.
   * 화면은 `wc64LetterCopy`·`wc64DimCopy`·`wc64TypeCopy` 에 이 목록을 넘긴다.
   */
  hiddenTags: string[];
  /**
   * 예산 막대: BUDGET 4문장(A = 정한 선을 지키는 쪽, B = 마음에 들면 더 쓰는 쪽)을 FUND 처럼 글자 밖에서 본다.
   * 식 계획과 상관없이 늘 낸다(2026-10-17 파운더 결정, DEC-7 뒤집기. 그 전에는 식 없이 할 때만 냈고 나머지는 null 이었다).
   */
  budget: Wc64Fund;
  patterns: Wc64Pattern[];
  /** 계산에 넣은 문항 중 1~5로 답한 수 */
  answered: number;
  /** 계산에 넣은 문항 중 '해당 없음'(0) 수 */
  notApplicable: number;
}

/**
 * 유형 카드가 없을 때(식 없이 하거나 글자가 덜 정해졌을 때) 정해진 글자에서 고른 '다음에 해 볼 것' 한 줄.
 * text 는 그 축의 '둘이 나눌 질문'(dims.couple_questions)이다. 글자 장의 할 일(app_actions)을 되풀이하지 않는다.
 */
export interface Wc64NextStep { dim: Wc64DimId; letter: Wc64Letter; text: string }

/**
 * '내 답 전체'에서 문항 옆에 적을 자리(`wc64AnswerSide`).
 * letter = 그 문항이 미는 글자 · bar = 글자 밖 막대(FUND·BUDGET, 식 계획과 상관없이)와 그 쪽 이름 · knowledge = 이해도.
 */
export type Wc64AnswerSide =
  | { kind: "letter"; dim: Wc64DimId; letter: Wc64Letter }
  | { kind: "bar"; bar: "FUND" | "BUDGET"; side: "A" | "B"; name: string }
  | { kind: "knowledge" };

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
