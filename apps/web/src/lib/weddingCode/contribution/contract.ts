import { WEDDING_CODE_V08_QUESTIONS, WEDDING_CODE_V08_VERSION } from "@/constants/weddingCodeV08";

/**
 * 웨딩코드 답 익명 보태기 — 화면·API·DB가 함께 지키는 계약.
 *
 * ## 무엇을 받고 무엇을 받지 않나
 *
 * 받는 것은 문항 판, 장면마다 고른 답 기호(`A`~`D`, 건너뜀 `-`), 동의 문구 판뿐이다.
 * 이름·연락처·계정·IP·공유 링크·상대의 답은 받지 않는다. 계정과 잇는 열쇠가 없으니
 * 삭제는 **본인이 보관하는 삭제 코드**로만 할 수 있다(`docs/wedding-code/56` §9.1).
 *
 * ## 왜 v0.8만 받나
 *
 * 과거 v0.6 링크로 연 응답은 문항이 달라 한 표로 합치면 안 된다. DB CHECK도 같은 값만 받는다.
 *
 * 이 파일의 값은 마이그레이션 `wedding_code_research_contributions` 의 CHECK 와 같아야 한다.
 */
export const WEDDING_CODE_RESEARCH_SCENE_VERSION = WEDDING_CODE_V08_VERSION;
export const WEDDING_CODE_RESEARCH_SCENE_COUNT = WEDDING_CODE_V08_QUESTIONS.length;
/** 동의 문구를 고치면 판을 올린다. 이전 동의와 섞지 않는다. */
export const WEDDING_CODE_RESEARCH_CONSENT_VERSION = "wc-research-consent-v1";
export const WEDDING_CODE_RESEARCH_RETENTION_DAYS = 60;
/** 지운 삭제 코드의 해시를 남겨 같은 코드로 다시 저장되지 않게 하는 기간. */
export const WEDDING_CODE_RESEARCH_TOMBSTONE_DAYS = 30;
export const WEDDING_CODE_RESEARCH_MIN_AGE = 19;
/**
 * 새 답을 받기 시작하는 시각.
 *
 * **2026-09-16 파운더 결정**: 같은 날 받기 시작한다. 처음 계획한 7일 사전 고지(2026-09-23)
 * 대신, 고지가 나간 날부터 받는다 — 팀이 실제 흐름을 그날 확인해야 했다. 고지는 **받기 전에**
 * 화면과 처리방침에 함께 올라갔고(동의 없이는 아무것도 저장하지 않는다), 흐름 통계 쪽은
 * 원래대로 2026-09-23까지 기다린다(`WEDDING_CODE_FUNNEL_ANALYTICS_EFFECTIVE_AT`).
 * **처리방침 제1조·제3조·부칙에 적힌 날짜와 같아야 한다.**
 */
export const WEDDING_CODE_RESEARCH_CONTRIBUTION_EFFECTIVE_AT = "2026-09-16T00:00:00+09:00";

/**
 * 「2026년 9월 16일부터」. 아직 받지 않는 동안 화면이 **없는 버튼을 설명하지 않게** 한다
 * (2026-09-16 라이브 확인에서 잡혔다). 처리방침에 적힌 날짜와 같은 값에서 만든다.
 */
export function weddingCodeResearchContributionStartLabel(): string {
  const kst = new Date(Date.parse(WEDDING_CODE_RESEARCH_CONTRIBUTION_EFFECTIVE_AT) + 9 * 60 * 60 * 1000);
  return `${kst.getUTCFullYear()}년 ${kst.getUTCMonth() + 1}월 ${kst.getUTCDate()}일부터,`;
}

const ANSWER_CODE = new RegExp(`^[A-D-]{${WEDDING_CODE_RESEARCH_SCENE_COUNT}}$`);
/** `wc_del_` + base64url 32바이트(43글자). 접두사는 보안 강도가 아니라 알아보기용이다. */
export const WEDDING_CODE_RESEARCH_RECEIPT_PATTERN = /^wc_del_[A-Za-z0-9_-]{43}$/;

export type WeddingCodeResearchContribution = Readonly<{
  sceneVersion: typeof WEDDING_CODE_RESEARCH_SCENE_VERSION;
  answerCode: string;
  consentVersion: typeof WEDDING_CODE_RESEARCH_CONSENT_VERSION;
  receipt: string;
}>;

const CONTRIBUTION_KEYS = ["sceneVersion", "answerCode", "consentVersion", "adultConfirmed", "consented", "receipt"] as const;

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * 삭제 코드를 만든다(브라우저). `crypto.getRandomValues` 32바이트 → `wc_del_` + 43글자.
 * 카드가 뜰 때 한 번 만들어 메모리에만 두고, 보태기 요청에 함께 보낸다.
 */
export function createWeddingCodeResearchReceipt(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return `wc_del_${toBase64Url(bytes)}`;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isWeddingCodeResearchAnswerCode(value: unknown): value is string {
  return typeof value === "string" && ANSWER_CODE.test(value) && /[A-D]/.test(value);
}

/**
 * 요청 본문을 계약에 맞춰 읽는다. 키가 하나라도 더 있거나 동의·성인 확인이 `true`가 아니면 거절한다.
 * 기본값으로 채우지 않는다 — 체크하지 않은 동의를 동의로 바꾸는 코드가 생기면 안 된다.
 */
export function parseWeddingCodeResearchContribution(
  body: unknown,
): WeddingCodeResearchContribution | null {
  if (!isPlainRecord(body)) return null;
  const keys = Object.keys(body);
  if (keys.length !== CONTRIBUTION_KEYS.length) return null;
  if (!CONTRIBUTION_KEYS.every((key) => Object.hasOwn(body, key))) return null;
  if (body.sceneVersion !== WEDDING_CODE_RESEARCH_SCENE_VERSION) return null;
  if (body.consentVersion !== WEDDING_CODE_RESEARCH_CONSENT_VERSION) return null;
  if (body.adultConfirmed !== true || body.consented !== true) return null;
  if (!isWeddingCodeResearchAnswerCode(body.answerCode)) return null;
  if (typeof body.receipt !== "string" || !WEDDING_CODE_RESEARCH_RECEIPT_PATTERN.test(body.receipt)) return null;
  return {
    sceneVersion: WEDDING_CODE_RESEARCH_SCENE_VERSION,
    answerCode: body.answerCode,
    consentVersion: WEDDING_CODE_RESEARCH_CONSENT_VERSION,
    receipt: body.receipt,
  };
}

export function parseWeddingCodeResearchDeletion(body: unknown): string | null {
  if (!isPlainRecord(body)) return null;
  const keys = Object.keys(body);
  if (keys.length !== 1 || typeof body.receipt !== "string") return null;
  const receipt = body.receipt.trim();
  return WEDDING_CODE_RESEARCH_RECEIPT_PATTERN.test(receipt) ? receipt : null;
}
