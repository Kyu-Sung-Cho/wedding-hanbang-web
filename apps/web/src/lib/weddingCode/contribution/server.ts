import { createHmac } from "node:crypto";

import {
  WEDDING_CODE_RESEARCH_CONTRIBUTION_EFFECTIVE_AT,
  WEDDING_CODE_RESEARCH_RECEIPT_PATTERN,
} from "./contract";

/**
 * 웨딩코드 답 보태기의 서버 스위치와 삭제 코드 해시.
 *
 * ## 스위치가 둘인 이유 — 받기와 지키기는 따로 켜진다
 *
 * 2026-09-16 적대 검토에서 한 스위치에 전부 묶은 설계가 잡혔다. 수집을 멈추려고
 * 플래그를 끄면 자동 삭제·삭제 요청·처리방침 문단까지 같이 꺼져, **이미 받은 답이
 * 60일 약속을 넘겨 남는다.** 그래서 나눈다.
 *
 * - `isWeddingCodeResearchStorageActive()` — 저장소를 지키는 일(자동 삭제 크론, 삭제 요청,
 *   삭제 폼, 처리방침 문단). **비밀값이 있으면 켜진다.** 삭제 코드를 확인하려면 비밀값이
 *   필요하므로, 받은 답이 남아 있을 수 있는 동안(마지막 보태기 후 60일)은 비밀값을 지우거나
 *   바꾸지 않는다.
 * - `isWeddingCodeResearchContributionOpen()` — 새 답을 받는 일(동의 카드, 보태기 API).
 *   지키기가 켜져 있고 플래그가 `true`이며, 처리방침 제10조의 사전 고지 기간이 지난 뒤에만.
 *   수집을 멈출 때는 이 플래그만 끈다.
 */
const SECRET_ENV = "WEDDING_CODE_RESEARCH_RECEIPT_SECRET";
const ENABLED_ENV = "WEDDING_CODE_RESEARCH_CONTRIBUTION_ENABLED";
const MIN_SECRET_LENGTH = 32;
const CONTRIBUTION_EFFECTIVE_MS = Date.parse(WEDDING_CODE_RESEARCH_CONTRIBUTION_EFFECTIVE_AT);

function receiptSecret(): string | null {
  const secret = process.env[SECRET_ENV]?.trim();
  return secret && secret.length >= MIN_SECRET_LENGTH ? secret : null;
}

export function isWeddingCodeResearchStorageActive(): boolean {
  return receiptSecret() !== null;
}

export function isWeddingCodeResearchContributionOpen(now: number = Date.now()): boolean {
  return process.env[ENABLED_ENV] === "true"
    && isWeddingCodeResearchStorageActive()
    && now >= CONTRIBUTION_EFFECTIVE_MS;
}

/** PostgREST가 bytea로 읽는 `\x` 16진 표기. */
function toByteaHex(digest: Buffer): string {
  return `\\x${digest.toString("hex")}`;
}

/**
 * 삭제 코드의 해시. 서버에는 이것만 남긴다(`docs/wedding-code/56` §9.1).
 *
 * 삭제 코드는 **브라우저가 만든다**(카드가 뜰 때 32바이트). 응답이 끊겨도 같은 코드로
 * 다시 보내면 같은 해시라 한 번만 저장되고, 보냈는지 모르는 상태에서도 그 코드로 지울 수
 * 있다. 원문은 저장소·로그·분석·URL·브라우저 저장소에 두지 않는다. keyed HMAC이라 DB가
 * 새도 해시에서 코드를 되짚어 남의 답을 지울 수 없다.
 */
export function hashWeddingCodeResearchReceipt(receipt: string): string | null {
  const secret = receiptSecret();
  if (!secret || !WEDDING_CODE_RESEARCH_RECEIPT_PATTERN.test(receipt)) return null;
  return toByteaHex(createHmac("sha256", secret).update(receipt).digest());
}
