import {
  WEDDING_CODE_V06_COMPATIBLE_VERSIONS,
  WEDDING_CODE_V06_QUESTIONS,
  type WeddingCodeV06OptionValue,
  type WeddingCodeV06Question,
  type WeddingCodeQuestionKey,
} from "@/constants/weddingCodeV06";
import type { WeddingCodeV06Answers } from "./gap";

/**
 * 답 16개를 URL에 담는 코드.
 *
 * ## 왜 저장하지 않나
 *
 * v0.5는 커플 연동(`/api/wedding-code/pair`) → DB 저장 → **상대 응답 대기** 순서였다.
 * 「아직 상대 응답을 기다리고 있어요」 화면에서 대부분이 끝난다 — 상대가 가입하고,
 * 커플로 연결되고, 16문항을 다 풀 때까지 아무것도 못 본다. 관문이 세 개다.
 *
 * v0.6는 답을 **링크에 싣는다.** 16글자면 끝난다(`ABCDABCD…`). 로그인이나 계정 연동,
 * DB 저장은 하지 않는다. 상대는 링크를 열고 자기 16문항만 풀면 그 자리에서 둘의 차이
 * 지도를 본다. 새 링크는 답을 fragment(`#`) 뒤에 넣어 서버 요청·referrer에서는 빼지만,
 * 브라우저 방문 기록과 메신저에는 전체 링크가 남을 수 있다.
 *
 * 코드는 **비밀이 아니다.** 열여섯 글자로 무엇을 골랐는지 드러나므로, 링크를 받은 사람은
 * 상대가 뭘 골랐는지 알게 된다 — 그게 이 제품의 목적이다. 다만 제3자에게 흘러가면
 * 같은 내용이 보이므로, 결과 페이지는 색인하지 않는다.
 */

/** 판마다 보기 수가 달라도 그 질문에 실제로 있는 값만 답으로 읽는다. */
export function isWeddingCodeQuestionOption(
  question: WeddingCodeV06Question,
  value: unknown,
): value is WeddingCodeV06OptionValue {
  return typeof value === "string" && question.options.some((option) => option.value === value);
}

/** 내부 호출도 없는 답으로 인용·공유를 만들지 않는다. 수신 링크는 디코더에서 null로 거부한다. */
export function assertWeddingCodeQuestionAnswers(
  answers: WeddingCodeV06Answers,
  questions: readonly WeddingCodeV06Question[],
): void {
  for (const question of questions) {
    const value = answers[question.key];
    if (value !== undefined && !isWeddingCodeQuestionOption(question, value)) {
      throw new RangeError("INVALID_WEDDING_CODE_SCENE_ANSWER");
    }
  }
}

/** 코드 문자열 한 글자 = 문항 하나의 답. 미응답은 `-`. */
export const WEDDING_CODE_V06_SKIP = "-";

/**
 * 버전이 없던 초기 v0.6 링크는 현재 문항 순서로만 해석해 이전 공유 링크를 살린다.
 * 새 링크는 반드시 버전을 싣고, 명시된 미지원 버전은 조용히 현재 문항으로 읽지 않는다.
 */
export function isCompatibleWeddingCodeV06Version(
  version: string | null | undefined,
): boolean {
  if (typeof version !== "string" || version.trim() === "") return true;
  return WEDDING_CODE_V06_COMPATIBLE_VERSIONS.includes(
    version.trim() as (typeof WEDDING_CODE_V06_COMPATIBLE_VERSIONS)[number],
  );
}

export function encodeWeddingCodeV06(
  answers: WeddingCodeV06Answers,
  questions: readonly WeddingCodeV06Question[] = WEDDING_CODE_V06_QUESTIONS,
): string {
  assertWeddingCodeQuestionAnswers(answers, questions);
  return questions.map(
    (question) => answers[question.key] ?? WEDDING_CODE_V06_SKIP,
  ).join("");
}

/**
 * 코드를 답으로 되돌린다.
 *
 * 잘못된 코드에 **조용히 기본값을 채우지 않는다** — 그러면 상대가 고르지도 않은 답이
 * 「상대는 이렇게 답했어요」로 화면에 뜬다. 이 제품에서 그건 거짓말이다.
 */
export function decodeWeddingCodeV06(
  code: string | null | undefined,
  questions: readonly WeddingCodeV06Question[] = WEDDING_CODE_V06_QUESTIONS,
): WeddingCodeV06Answers | null {
  if (typeof code !== "string") return null;
  const trimmed = code.trim().toUpperCase();
  if (trimmed.length !== questions.length) return null;

  const answers: WeddingCodeV06Answers = {};
  let answered = 0;
  for (let index = 0; index < trimmed.length; index += 1) {
    const character = trimmed[index];
    if (character === WEDDING_CODE_V06_SKIP) continue;
    if (!isWeddingCodeQuestionOption(questions[index], character)) return null;
    const key: WeddingCodeQuestionKey = questions[index].key;
    answers[key] = character;
    answered += 1;
  }
  // 전부 미응답인 코드는 유효한 코드가 아니라 빈 링크다.
  if (answered === 0) return null;
  return answers;
}

export function isCompleteWeddingCodeV06(
  answers: WeddingCodeV06Answers,
  questions: readonly WeddingCodeV06Question[] = WEDDING_CODE_V06_QUESTIONS,
): boolean {
  return questions.every((question) => isWeddingCodeQuestionOption(question, answers[question.key]));
}
