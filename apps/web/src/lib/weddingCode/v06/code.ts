import {
  WEDDING_CODE_V06_QUESTIONS,
  type WeddingCodeV06OptionValue,
  type WeddingCodeV06QuestionKey,
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
 * v0.6는 답을 **링크에 싣는다.** 16글자면 끝난다(`ABCDABCD…`). 로그인도 계정 연동도
 * 저장도 없다. 상대는 링크를 열고 자기 16문항만 풀면 그 자리에서 둘의 차이 지도를 본다.
 * 서버에 남는 게 없으므로 응답 보관·RLS·삭제 요청 문제도 생기지 않는다.
 *
 * 코드는 **비밀이 아니다.** 열여섯 글자로 무엇을 골랐는지 드러나므로, 링크를 받은 사람은
 * 상대가 뭘 골랐는지 알게 된다 — 그게 이 제품의 목적이다. 다만 제3자에게 흘러가면
 * 같은 내용이 보이므로, 결과 페이지는 색인하지 않는다.
 */

const VALUES = ["A", "B", "C", "D"] as const;
const VALUE_SET = new Set<string>(VALUES);

/** 코드 문자열 한 글자 = 문항 하나의 답. 미응답은 `-`. */
export const WEDDING_CODE_V06_SKIP = "-";

export type WeddingCodeV06SharePayload = {
  firstCode: string;
  firstAnswers: WeddingCodeV06Answers;
  secondCode: string | null;
  secondAnswers: WeddingCodeV06Answers | null;
};

export function encodeWeddingCodeV06(answers: WeddingCodeV06Answers): string {
  return WEDDING_CODE_V06_QUESTIONS.map(
    (question) => answers[question.key] ?? WEDDING_CODE_V06_SKIP,
  ).join("");
}

/**
 * 코드를 답으로 되돌린다.
 *
 * 잘못된 코드에 **조용히 기본값을 채우지 않는다** — 그러면 상대가 고르지도 않은 답이
 * 「상대는 이렇게 답했어요」로 화면에 뜬다. 이 제품에서 그건 거짓말이다.
 */
export function decodeWeddingCodeV06(code: string | null | undefined): WeddingCodeV06Answers | null {
  if (typeof code !== "string") return null;
  const trimmed = code.trim().toUpperCase();
  if (trimmed.length !== WEDDING_CODE_V06_QUESTIONS.length) return null;

  const answers: WeddingCodeV06Answers = {};
  let answered = 0;
  for (let index = 0; index < trimmed.length; index += 1) {
    const character = trimmed[index];
    if (character === WEDDING_CODE_V06_SKIP) continue;
    if (!VALUE_SET.has(character)) return null;
    const key: WeddingCodeV06QuestionKey = WEDDING_CODE_V06_QUESTIONS[index].key;
    answers[key] = character as WeddingCodeV06OptionValue;
    answered += 1;
  }
  // 전부 미응답인 코드는 유효한 코드가 아니라 빈 링크다.
  if (answered === 0) return null;
  return answers;
}

export function isCompleteWeddingCodeV06(answers: WeddingCodeV06Answers): boolean {
  return WEDDING_CODE_V06_QUESTIONS.every((question) => Boolean(answers[question.key]));
}

/**
 * 공유 답변은 URL fragment에만 둔다. Fragment는 HTTP 요청과 Referer 헤더에
 * 포함되지 않으므로 CDN, 서버, 프록시 접근 로그로 답변이 전송되지 않는다.
 */
export function decodeWeddingCodeV06ShareHash(
  hash: string | null | undefined,
): WeddingCodeV06SharePayload | null {
  if (typeof hash !== "string") return null;
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw || raw.length > 256) return null;

  const params = new URLSearchParams(raw);
  const firstCode = (params.get("a") ?? "").trim().toUpperCase();
  const firstAnswers = decodeWeddingCodeV06(firstCode);
  if (!firstAnswers) return null;

  const candidateSecondCode = (params.get("b") ?? "").trim().toUpperCase();
  const secondAnswers = decodeWeddingCodeV06(candidateSecondCode);

  return {
    firstCode,
    firstAnswers,
    secondCode: secondAnswers ? candidateSecondCode : null,
    secondAnswers,
  };
}

export function buildWeddingCodeV06ShareUrl(
  origin: string,
  firstCode: string,
  secondCode?: string | null,
): string {
  const params = new URLSearchParams({ a: firstCode.trim().toUpperCase() });
  if (secondCode) params.set("b", secondCode.trim().toUpperCase());
  return `${origin.replace(/\/$/, "")}/wedding-code#${params.toString()}`;
}
