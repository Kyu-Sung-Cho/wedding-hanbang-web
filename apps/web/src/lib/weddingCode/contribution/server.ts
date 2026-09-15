import { createHmac, randomBytes } from "node:crypto";

import { WEDDING_CODE_RESEARCH_RECEIPT_PATTERN } from "./contract";

/**
 * 삭제 코드와 그 해시. 서버에는 해시만 남긴다(`docs/wedding-code/56` §9.1).
 *
 * 원문 코드는 저장소·로그·분석·URL·브라우저 저장소 어디에도 두지 않고, 보낸 직후
 * 화면에 한 번만 보여준다. 해시는 서버 비밀값으로 keyed HMAC을 쓴다 — DB가 새도
 * 해시에서 코드를 되짚어 남의 답을 지울 수 없게.
 */
const SECRET_ENV = "WEDDING_CODE_RESEARCH_RECEIPT_SECRET";
const ENABLED_ENV = "WEDDING_CODE_RESEARCH_CONTRIBUTION_ENABLED";
const MIN_SECRET_LENGTH = 32;

function receiptSecret(): string | null {
  const secret = process.env[SECRET_ENV]?.trim();
  return secret && secret.length >= MIN_SECRET_LENGTH ? secret : null;
}

/**
 * 보태기를 받을 수 있는가.
 *
 * 플래그와 비밀값이 **둘 다** 있어야 연다. 화면 카드와 처리방침 문단도 이 값 하나로
 * 켜지므로, 받을 수 없는 동안에는 받는다고 말하지 않는다(AGENTS.md: 수집 API가 닫혀
 * 있으면 UI만 열지 않는다). 운영 순서는 DB 레인 적용 → 비밀값 → 플래그다.
 */
export function isWeddingCodeResearchContributionOpen(): boolean {
  return process.env[ENABLED_ENV] === "true" && receiptSecret() !== null;
}

/** PostgREST가 bytea로 읽는 `\x` 16진 표기. */
function toByteaHex(digest: Buffer): string {
  return `\\x${digest.toString("hex")}`;
}

export function hashWeddingCodeResearchReceipt(receipt: string): string | null {
  const secret = receiptSecret();
  if (!secret || !WEDDING_CODE_RESEARCH_RECEIPT_PATTERN.test(receipt)) return null;
  return toByteaHex(createHmac("sha256", secret).update(receipt).digest());
}

export function createWeddingCodeResearchReceipt(): { receipt: string; hash: string } | null {
  const receipt = `wc_del_${randomBytes(32).toString("base64url")}`;
  const hash = hashWeddingCodeResearchReceipt(receipt);
  return hash ? { receipt, hash } : null;
}
