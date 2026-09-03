/**
 * 모델 답변에서 **사람이 읽을 수 없는 조각**을 걷어낸다.
 *
 * 2026-08-25 에 만든 `amoraSpamTail` 은 차단 목록이다 — 목록 밖은 전부 지나간다.
 * 2026-09-03 2차 감사가 그 구멍으로 나간 것을 하나 잡았다. Turn 20 답변이
 * 이렇게 나갔다:
 *
 *   "মাস행사 일정만으로는 날짜를 저장할 수 없습니다"
 *
 * `মাস` 는 벵골 문자다. 사용자도 도구 결과도 그 글자를 쓴 적이 없다 — 모델이
 * 만들어낸 조각이다. 기존 후처리 둘 다 이 형태를 통과시킨다:
 * `stripAmoraReasoningPreamble` 은 **문단 단위**라 첫 문단이 한국어면 즉시
 * 돌려주고(`amoraReasoningLeak.ts`), `scrubAmoraSpam` 은 어휘 목록이라 무관하다.
 *
 * ## 왜 토큰이 아니라 문자 런인가
 *
 * 처음 제안은 "공백으로 가른 토큰이 통째로 안전 집합 밖일 때만 지운다" 였다.
 * 그러면 관측된 형태(`মাস행사`)는 **한 글자라도 한글이라 안 잡힌다**. 그래서
 * 판정 단위를 연속 문자 런으로 둔다: 안전 집합 밖 문자가 이어진 구간만 지우고
 * (`মাস` → 삭제) 좌우 공백을 정리한다.
 *
 * ## 안전 집합에 한글 자모를 반드시 넣는다
 *
 * `ㅋㅋ`·`ㅠㅠ` 는 한글 음절(가-힣)이 아니라 호환 자모(U+3130-318F)다.
 * 빠뜨리면 웃음과 울음이 통째로 사라진다. 이 실수를 막는 테스트가
 * `__tests__/amoraOutputHygiene.test.ts` 에 먼저 들어가 있다.
 *
 * ## 남겨 둔 위험과 그 완화
 *
 * 사용자가 해외 예식·신혼여행 지명을 그 나라 문자로 물으면 아모라의 인용이
 * 지워질 수 있다. 운영 사용자 메시지 853건 중 그런 문자는 0건이라 오늘의
 * 기저율은 0이지만 영구적 위험이다. 완화책: **직전 사용자 메시지에 있던 문자는
 * 안전 집합에 임시로 넣는다.** 모델이 사용자의 말을 그대로 인용하는 형태 —
 * 실제로 일어나는 형태 — 는 이것으로 살아남는다. 사용자가 쓰지 않은 다른
 * 단어를 같은 문자 체계로 새로 쓰는 경우는 여전히 지워진다. 알고 남긴다.
 *
 * 그리고 **스크럽이 본문을 통째로 비우면 아무것도 하지 않는다.** 답변 전체가
 * 안전 집합 밖이라는 것은 스팸이라는 뜻이 아니라 우리 안전 집합이 틀렸다는
 * 뜻일 가능성이 더 크다. 빈 답변은 사용자가 아무것도 못 받는 결과다.
 *
 * ## 라틴 조각은 지우지 않는다 — 세어만 둔다
 *
 * 감사 제안에는 `cvs` 같은 뜻 없는 영문 조각도 있었다. 지우지 않는다.
 * `cm`·`kg`·`vs`·영문 상호와 구별할 방법이 없기 때문이다(반증자 지적).
 * 그래서 3계층은 **탐지 개수만** 남기고 본문은 건드리지 않는다. 오늘 밤 팀이
 * 무엇이 얼마나 걸렸는지 뒤에서 셀 수 있게 하는 것이 목적이다.
 */

import { scrubAmoraSpam } from "@/lib/ai/amoraSpamTail";

/**
 * 지우지 않을 문자.
 *
 * 정규식 **리터럴**로 쓴다. 문자열을 조립해 `new RegExp` 에 넣으면 백슬래시가
 * 한 번 더 조리돼 조용히 죽은 검사가 된다(2026-08-29 같은 병으로 가드 하나가
 * 무조건 통과했다).
 *
 * - U+0000-024F  ASCII·라틴1 보충·라틴 확장 A/B (숫자·구두점·줄바꿈 포함)
 * - U+02B0-02FF  수정 문자 (ʼ 등)
 * - U+1100-11FF  한글 자모
 * - U+2000-206F  일반 구두점 (…, —, ·, ZWJ)
 * - U+2070-209F  위·아래 첨자
 * - U+20A0-20BF  통화 기호 (₩, €)
 * - U+2100-218F  문자꼴 기호·숫자 형식 (№, ™, ½)
 * - U+2190-23FF  화살표·수학·기술 기호
 * - U+2460-24FF  원문자 (①)
 * - U+25A0-27BF  도형·기타 기호·딩뱃 (■, ●, ☀, ✅)
 * - U+2B00-2BFF  기타 기호와 화살표 (⭐)
 * - U+3000-303F  CJK 구두점 (、「」)
 * - U+3040-30FF  히라가나·가타카나
 * - U+3130-318F  한글 호환 자모 (ㅋㅋ, ㅠㅠ) — 빠뜨리면 안 된다
 * - U+31F0-31FF  가타카나 확장
 * - U+3200-33FF  괄호·원문자·CJK 호환 (㈜, ㎡, ℃)
 * - U+4E00-9FFF  한자
 * - U+AC00-D7A3  한글 음절
 * - U+F900-FAFF  CJK 호환 한자
 * - U+FE0E-FE0F  variation selector (이모지 표현)
 * - U+FF00-FFEF  전각 영숫자·반각 가나
 * - U+1F000-1FAFF 이모지
 * - U+20000-2A6DF CJK 확장 B
 */
const SAFE_CHAR_RE =
  /[\u0000-\u024F\u02B0-\u02FF\u1100-\u11FF\u2000-\u206F\u2070-\u209F\u20A0-\u20BF\u2100-\u218F\u2190-\u23FF\u2460-\u24FF\u25A0-\u27BF\u2B00-\u2BFF\u3000-\u303F\u3040-\u30FF\u3130-\u318F\u31F0-\u31FF\u3200-\u33FF\u4E00-\u9FFF\uAC00-\uD7A3\uF900-\uFAFF\uFE0E\uFE0F\uFF00-\uFFEF\u{1F000}-\u{1FAFF}\u{20000}-\u{2A6DF}]/u;

/** 로그에 남길 이름. 본문은 남기지 않는다 — 블록 이름과 개수만. */
const UNICODE_BLOCKS: ReadonlyArray<readonly [number, number, string]> = [
  [0x0370, 0x03ff, "Greek"],
  [0x0400, 0x04ff, "Cyrillic"],
  [0x0530, 0x058f, "Armenian"],
  [0x0590, 0x05ff, "Hebrew"],
  [0x0600, 0x06ff, "Arabic"],
  [0x0700, 0x074f, "Syriac"],
  [0x0900, 0x097f, "Devanagari"],
  [0x0980, 0x09ff, "Bengali"],
  [0x0a00, 0x0a7f, "Gurmukhi"],
  [0x0a80, 0x0aff, "Gujarati"],
  [0x0b00, 0x0b7f, "Oriya"],
  [0x0b80, 0x0bff, "Tamil"],
  [0x0c00, 0x0c7f, "Telugu"],
  [0x0c80, 0x0cff, "Kannada"],
  [0x0d00, 0x0d7f, "Malayalam"],
  [0x0d80, 0x0dff, "Sinhala"],
  [0x0e00, 0x0e7f, "Thai"],
  [0x0e80, 0x0eff, "Lao"],
  [0x0f00, 0x0fff, "Tibetan"],
  [0x1000, 0x109f, "Myanmar"],
  [0x10a0, 0x10ff, "Georgian"],
  [0x1200, 0x137f, "Ethiopic"],
  [0x1780, 0x17ff, "Khmer"],
];

function unicodeBlockName(codePoint: number): string {
  for (const [start, end, name] of UNICODE_BLOCKS) {
    if (codePoint >= start && codePoint <= end) return name;
  }
  return "Other";
}

/**
 * 3계층에서 세는 라틴 조각의 예외.
 *
 * 결혼 준비 대화에서 실제로 쓰이는 짧은 영문이다. 여기 없다고 스팸이라는
 * 뜻이 아니다 — 이 계층은 **세기만 한다.**
 */
const KNOWN_SHORT_LATIN = new Set([
  "cm", "mm", "km", "kg", "ml", "oz", "ft", "pt", "px",
  "ok", "tv", "pc", "ai", "id", "pdf", "url", "diy", "faq",
  "gb", "mb", "kb", "hr", "min", "sec", "vs", "no", "yes",
  "am", "pm", "sd", "sdm", "dm", "qr", "ceo", "vip", "diy",
  "a", "i",
]);

/** 공백으로 가른 짧은 소문자 라틴 토큰(URL·이메일·마크다운 밖). */
const SHORT_LATIN_TOKEN_RE = /(?<![0-9A-Za-z@/:._%+-])[a-z]{1,5}(?![0-9A-Za-z@/:._%+-])/g;

export type AmoraOutputHygieneAction =
  | { kind: "spam_tail_trimmed" }
  | { kind: "spam_body_replaced" }
  | {
      kind: "foreign_run_removed";
      /** 지운 런의 개수. */
      runs: number;
      /** 지운 글자 수(코드포인트). */
      removedChars: number;
      /** 어느 유니코드 블록이었는가. 본문은 남기지 않는다. */
      blocks: string[];
    }
  | {
      kind: "foreign_run_kept_empty_result";
      runs: number;
    }
  | { kind: "latin_fragment_detected"; count: number };

export type AmoraOutputHygieneResult = {
  text: string;
  /** 무엇을 했는가 — 로그·메타데이터·테스트가 이 값을 본다. */
  actions: AmoraOutputHygieneAction[];
};

function buildExemptCharSet(userText: string): Set<string> {
  const exempt = new Set<string>();
  if (typeof userText !== "string" || userText.length === 0) return exempt;
  for (const char of userText) {
    if (!SAFE_CHAR_RE.test(char)) exempt.add(char);
  }
  return exempt;
}

type ForeignRunScrub = {
  text: string;
  runs: number;
  removedChars: number;
  blocks: string[];
};

function removeForeignRuns(text: string, exempt: Set<string>): ForeignRunScrub {
  const kept: string[] = [];
  const blocks = new Set<string>();
  let runs = 0;
  let removedChars = 0;
  let inRun = false;

  for (const char of text) {
    if (SAFE_CHAR_RE.test(char) || exempt.has(char)) {
      kept.push(char);
      inRun = false;
      continue;
    }
    if (!inRun) {
      runs += 1;
      inRun = true;
    }
    removedChars += 1;
    blocks.add(unicodeBlockName(char.codePointAt(0) ?? 0));
  }

  if (runs === 0) {
    return { text, runs: 0, removedChars: 0, blocks: [] };
  }

  // 지운 자리에 남은 공백만 정리한다. **제거가 일어난 답변에서만** 손댄다 —
  // 정상 답변의 줄바꿈·들여쓰기를 우리가 다시 쓰기 시작하면 오탐의 정의가
  // 무너진다.
  const normalized = kept
    .join("")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+(?=\n)/g, "")
    .replace(/^[ \t]+|[ \t]+$/g, "");

  return {
    text: normalized,
    runs,
    removedChars,
    blocks: [...blocks].sort(),
  };
}

function countShortLatinFragments(text: string): number {
  let count = 0;
  for (const match of text.matchAll(SHORT_LATIN_TOKEN_RE)) {
    const token = match[0];
    if (!KNOWN_SHORT_LATIN.has(token)) count += 1;
  }
  return count;
}

/**
 * 답변 위생 3계층을 한 번에 적용한다.
 *
 * 1. 기존 스팸 어휘 차단(`scrubAmoraSpam`) — 그대로 유지.
 * 2. 안전 집합 밖 문자 런 삭제 — 좁고 근거 있는 삭제.
 * 3. 짧은 라틴 조각 — **세기만 한다.**
 *
 * 호출 자리는 `api/chat/route.ts` 의 표식 제거 뒤, 예전 `stripAmoraSpamTail`
 * 자리 하나뿐이다.
 */
export function applyAmoraOutputHygiene(
  text: string,
  options: { userText?: string } = {},
): AmoraOutputHygieneResult {
  const actions: AmoraOutputHygieneAction[] = [];
  if (typeof text !== "string" || text.length === 0) {
    return { text, actions };
  }

  const spam = scrubAmoraSpam(text);
  if (spam.action === "trimmed_tail") actions.push({ kind: "spam_tail_trimmed" });
  if (spam.action === "replaced_body") actions.push({ kind: "spam_body_replaced" });

  // 본문이 서버 문장으로 통째로 대체됐으면 더 볼 것이 없다.
  if (spam.action === "replaced_body") {
    return { text: spam.text, actions };
  }

  const exempt = buildExemptCharSet(options.userText ?? "");
  const scrubbed = removeForeignRuns(spam.text, exempt);

  let finalText = spam.text;
  if (scrubbed.runs > 0) {
    if (scrubbed.text.trim().length === 0) {
      // 전부 지워진다는 것은 스팸이 아니라 우리 안전 집합이 틀렸다는 신호다.
      // 사용자에게 빈 답변을 주지 않는다.
      actions.push({
        kind: "foreign_run_kept_empty_result",
        runs: scrubbed.runs,
      });
    } else {
      finalText = scrubbed.text;
      actions.push({
        kind: "foreign_run_removed",
        runs: scrubbed.runs,
        removedChars: scrubbed.removedChars,
        blocks: scrubbed.blocks,
      });
    }
  }

  const latinFragments = countShortLatinFragments(finalText);
  if (latinFragments > 0) {
    actions.push({ kind: "latin_fragment_detected", count: latinFragments });
  }

  return { text: finalText, actions };
}

/**
 * 터미널 본문이 비었을 때 대신 내보낼 서버 소유 문장.
 *
 * 문구는 `amoraPersistenceClaims.ts` 의 `SERVER_OWNED_UNVERIFIED_NOTICE` 와
 * **한 글자도 다르지 않다.** 그 상수가 export 되어 있지 않고 그 파일은 오늘
 * 다른 사람이 고치는 중이라 여기서 같은 문장을 다시 쓴다. 새로 지어낸 문구가
 * 아니며, 두 곳이 갈라지면 `__tests__/amoraOutputHygiene.test.ts` 가 잡는다.
 */
export const AMORA_EMPTY_TERMINAL_FALLBACK_TEXT =
  "실제 실행 결과가 확인되지 않아 이 변경은 아직 반영되지 않았어요. 변경할 내용을 확인한 뒤 다시 요청해주세요.";

/**
 * 빈 본문이 원장으로 넘어가는 것을 막는 이중 안전망.
 *
 * 2026-08-24 운영에서 아모라가 아무 말도 하지 않고 '같은 식별자로 다시 이어갈 수
 * 없어요' 로 끝난 턴들의 원인 후보다. 본문이 비면 저장도 스트리밍도 아무 글자를
 * 내보내지 않아 사용자는 침묵만 본다.
 *
 * 근본 수정은 빈 문자열을 만들지 않는 쪽(`composeAmoraPersistenceTerminal`)에
 * 있고 그쪽은 따로 고쳐진다. 이것은 그 뒤에 서는 그물이다.
 */
export function ensureNonEmptyTerminalText(text: unknown): string {
  return typeof text === "string" && text.trim().length > 0
    ? text
    : AMORA_EMPTY_TERMINAL_FALLBACK_TEXT;
}
