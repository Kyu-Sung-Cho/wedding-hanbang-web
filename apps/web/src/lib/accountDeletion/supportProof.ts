import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

const PREFIX = "HBDEL1";
const PURPOSE = "hanbang:deletion-support-identity:v1";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PROJECT_RE = /^[a-z0-9]{20}$/;
const BASE64_RE = /^[A-Za-z0-9_-]+$/;
export const SUPPORT_PROOF_LIFETIME_SECONDS = 24 * 60 * 60;

export interface DeletionSupportIdentity {
  v: 1;
  purpose: typeof PURPOSE;
  projectRef: string;
  subject: string;
  reference: string;
  issuedAt: number;
  expiresAt: number;
}

export class DeletionSupportProofError extends Error {
  constructor() {
    // 확인 코드는 오류·로그에 포함하지 않는다.
    super("DELETION_SUPPORT_PROOF_INVALID");
    this.name = "DeletionSupportProofError";
  }
}

function signingKey(secret: string): Buffer {
  if (typeof secret !== "string" || secret.length < 32 || secret.length > 8192) {
    throw new DeletionSupportProofError();
  }
  return createHmac("sha256", secret).update(PURPOSE).digest();
}

function signature(payload: string, secret: string): Buffer {
  return createHmac("sha256", signingKey(secret)).update(`${PREFIX}.${payload}`).digest();
}

function isIdentity(value: unknown): value is DeletionSupportIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return Object.keys(entry).sort().join(",") === "expiresAt,issuedAt,projectRef,purpose,reference,subject,v"
    && entry.v === 1 && entry.purpose === PURPOSE
    && typeof entry.projectRef === "string" && PROJECT_RE.test(entry.projectRef)
    && typeof entry.subject === "string" && UUID_RE.test(entry.subject)
    && typeof entry.reference === "string" && UUID_RE.test(entry.reference)
    && typeof entry.issuedAt === "number" && Number.isSafeInteger(entry.issuedAt) && entry.issuedAt > 0
    && typeof entry.expiresAt === "number" && Number.isSafeInteger(entry.expiresAt)
    && entry.expiresAt - entry.issuedAt === SUPPORT_PROOF_LIFETIME_SECONDS;
}

/** 인증된 본인이라는 증거만 발급한다. 삭제 접수·처리 승인이 아니다. */
export function issueDeletionSupportProof(input: {
  subject: string;
  projectRef: string;
  secret: string;
  now?: number;
}): { proof: string; reference: string; expiresAt: string } {
  const now = input.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now <= 0) throw new DeletionSupportProofError();
  const issuedAt = Math.floor(now / 1000);
  const identity: DeletionSupportIdentity = {
    v: 1, purpose: PURPOSE, projectRef: input.projectRef, subject: input.subject,
    reference: randomUUID(), issuedAt, expiresAt: issuedAt + SUPPORT_PROOF_LIFETIME_SECONDS,
  };
  if (!isIdentity(identity)) throw new DeletionSupportProofError();
  const payload = Buffer.from(JSON.stringify(identity), "utf8").toString("base64url");
  const proof = `${PREFIX}.${payload}.${signature(payload, input.secret).toString("base64url")}`;
  return { proof, reference: identity.reference, expiresAt: new Date(identity.expiresAt * 1000).toISOString() };
}

export function verifyDeletionSupportProof(input: {
  proof: string;
  projectRef: string;
  secret: string;
  now?: number;
}): DeletionSupportIdentity {
  const now = input.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now <= 0 || !PROJECT_RE.test(input.projectRef)
    || typeof input.proof !== "string" || input.proof.length > 2048) throw new DeletionSupportProofError();
  const parts = input.proof.split(".");
  if (parts.length !== 3 || parts[0] !== PREFIX || !BASE64_RE.test(parts[1]) || !BASE64_RE.test(parts[2])) {
    throw new DeletionSupportProofError();
  }
  const supplied = Buffer.from(parts[2], "base64url");
  if (supplied.length !== 32 || supplied.toString("base64url") !== parts[2]
    || !timingSafeEqual(supplied, signature(parts[1], input.secret))) throw new DeletionSupportProofError();
  const bytes = Buffer.from(parts[1], "base64url");
  if (bytes.toString("base64url") !== parts[1]) throw new DeletionSupportProofError();
  let identity: unknown;
  try { identity = JSON.parse(bytes.toString("utf8")); } catch { throw new DeletionSupportProofError(); }
  const seconds = Math.floor(now / 1000);
  if (!isIdentity(identity) || identity.projectRef !== input.projectRef
    || identity.issuedAt > seconds || identity.expiresAt <= seconds) throw new DeletionSupportProofError();
  return identity;
}
