import { createHmac, timingSafeEqual } from "node:crypto";

export const RESEARCH_EMAIL_VERIFICATION_TTL_SECONDS = 2 * 60 * 60;

type ResearchEmailVerificationClaims = {
  applicationId: string;
  cohortCode: string;
};

type EncodedClaims = {
  v: 1;
  a: string;
  c: string;
  iat: number;
  exp: number;
};

const PLACEHOLDER_SECRET_PATTERN =
  /(?:change|replace|insert|your|example|sample|placeholder|todo|at[-_ ]?least|random[-_ ]?characters|secret[-_ ]?here)/i;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COHORT_CODE_PATTERN = /^[a-z0-9](?:[a-z0-9_-]{1,62}[a-z0-9])?$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const MAX_TOKEN_LENGTH = 1024;
const PRODUCTION_VERIFICATION_ORIGIN = "https://hanbang.ai";

export type ResearchEmailVerificationResult =
  | { ok: true; claims: ResearchEmailVerificationClaims }
  | { ok: false; reason: "expired" | "invalid" | "misconfigured" };

function entropyBitsPerCharacter(value: string): number {
  const counts = new Map<string, number>();
  for (const character of value) {
    counts.set(character, (counts.get(character) ?? 0) + 1);
  }
  let entropy = 0;
  for (const count of counts.values()) {
    const probability = count / value.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
}

function getVerificationSecret(): string | null {
  const secret = process.env.RESEARCH_EMAIL_VERIFICATION_SECRET;
  const reusedByAnotherBoundary = [
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    process.env.ADMIN_PASSWORD,
    process.env.DEMO_SESSION_SECRET,
    process.env.RATE_LIMIT_KEY_SECRET,
    process.env.CRON_SECRET,
    process.env.AMORA_IDEMPOTENCY_SECRET,
    process.env.OPENAI_API_KEY,
    process.env.RESEND_API_KEY,
  ].some((candidate) => candidate === secret);
  if (
    !secret
    || secret.length < 32
    || secret.length > 512
    || secret !== secret.trim()
    || PLACEHOLDER_SECRET_PATTERN.test(secret)
    || entropyBitsPerCharacter(secret) < 3
    || reusedByAnotherBoundary
  ) {
    return null;
  }
  return secret;
}

export function hasResearchEmailVerificationConfig(): boolean {
  return getVerificationSecret() !== null;
}

function signPayload(payload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(payload).digest();
}

function safeEqual(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

function areClaimsValid(claims: ResearchEmailVerificationClaims): boolean {
  return UUID_PATTERN.test(claims.applicationId)
    && COHORT_CODE_PATTERN.test(claims.cohortCode);
}

function isEncodedClaims(value: unknown): value is EncodedClaims {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const claims = value as Partial<EncodedClaims>;
  return claims.v === 1
    && typeof claims.a === "string"
    && typeof claims.c === "string"
    && Number.isSafeInteger(claims.iat)
    && Number.isSafeInteger(claims.exp)
    && claims.exp! > claims.iat!
    && claims.exp! - claims.iat! === RESEARCH_EMAIL_VERIFICATION_TTL_SECONDS;
}

export function createResearchEmailVerificationToken(
  claims: ResearchEmailVerificationClaims,
  now = Date.now()
): string | null {
  const secret = getVerificationSecret();
  if (!secret || !areClaimsValid(claims)) return null;

  // Stateless by design: persist only the eventual email_verified_at value.
  // Never write this raw capability token (or its signature) to the database.
  const issuedAt = Math.floor(now / 1000);
  const payload = Buffer.from(JSON.stringify({
    v: 1,
    a: claims.applicationId,
    c: claims.cohortCode,
    iat: issuedAt,
    exp: issuedAt + RESEARCH_EMAIL_VERIFICATION_TTL_SECONDS,
  } satisfies EncodedClaims)).toString("base64url");
  const signature = signPayload(payload, secret).toString("base64url");
  return `${payload}.${signature}`;
}

export function buildResearchEmailVerificationUrl(
  claims: ResearchEmailVerificationClaims,
  now = Date.now(),
  siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://hanbang.ai"
): string | null {
  try {
    const configured = new URL(siteUrl);
    const rootOnly = configured.pathname === "/"
      && configured.search === ""
      && configured.hash === "";
    const canonicalProductionOrigin = configured.origin === PRODUCTION_VERIFICATION_ORIGIN;
    const localHttp = process.env.NODE_ENV !== "production"
      && configured.protocol === "http:"
      && ["localhost", "127.0.0.1", "[::1]", "::1"].includes(configured.hostname);
    if (
      (!canonicalProductionOrigin && !localHttp)
      || !rootOnly
      || configured.username
      || configured.password
    ) {
      return null;
    }

    const token = createResearchEmailVerificationToken(claims, now);
    if (!token) return null;
    const url = new URL("/beta/verify", configured.origin);
    url.hash = new URLSearchParams({ token }).toString();
    return url.toString();
  } catch {
    return null;
  }
}

export function verifyResearchEmailVerificationToken(
  token: string | null | undefined,
  now = Date.now()
): ResearchEmailVerificationResult {
  const secret = getVerificationSecret();
  if (!secret) return { ok: false, reason: "misconfigured" };
  if (!token || token.length > MAX_TOKEN_LENGTH) {
    return { ok: false, reason: "invalid" };
  }

  const [payload, suppliedSignature, extra] = token.split(".");
  if (
    !payload
    || !suppliedSignature
    || extra
    || !BASE64URL_PATTERN.test(payload)
    || !BASE64URL_PATTERN.test(suppliedSignature)
    || suppliedSignature.length !== 43
  ) {
    return { ok: false, reason: "invalid" };
  }

  const signature = Buffer.from(suppliedSignature, "base64url");
  if (
    Buffer.from(payload, "base64url").toString("base64url") !== payload
    || signature.toString("base64url") !== suppliedSignature
  ) {
    return { ok: false, reason: "invalid" };
  }
  const expectedSignature = signPayload(payload, secret);
  if (!safeEqual(signature, expectedSignature)) {
    return { ok: false, reason: "invalid" };
  }

  try {
    const decoded: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!isEncodedClaims(decoded)) {
      return { ok: false, reason: "invalid" };
    }
    const claims = { applicationId: decoded.a, cohortCode: decoded.c };
    if (!areClaimsValid(claims)) {
      return { ok: false, reason: "invalid" };
    }
    const nowSeconds = Math.floor(now / 1000);
    if (decoded.iat > nowSeconds + 5 * 60) {
      return { ok: false, reason: "invalid" };
    }
    if (decoded.exp <= nowSeconds) {
      return { ok: false, reason: "expired" };
    }
    return {
      ok: true,
      claims,
    };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}
