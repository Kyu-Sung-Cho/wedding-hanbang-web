import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { CourtApiError } from "./_shared";

export const COURT_INVITE_HANDOFF_COOKIE = "court_invite_handoff";
export const COURT_INVITE_HANDOFF_MAX_AGE_SECONDS = 10 * 60;
export const COURT_INVITE_HANDOFF_COOKIE_PATH = "/api/couple-court/invites/accept";

const PLACEHOLDER_RE = /(?:replace|change|example|placeholder|your[-_ ]?secret|at[-_ ]?least)/i;

function inviteCookieKey(): Buffer {
  const dedicated = process.env.COUPLE_COURT_INVITE_COOKIE_SECRET?.trim() ?? "";
  const localFallback = process.env.NODE_ENV === "production"
    ? ""
    : process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  const secret = dedicated || localFallback;
  if (secret.length < 32 || PLACEHOLDER_RE.test(secret)) {
    throw new CourtApiError(
      503,
      "COURT_INVITE_HANDOFF_UNAVAILABLE",
      "로그인 연결을 안전하게 보관할 수 없어요. 잠시 후 다시 시도해 주세요.",
    );
  }
  return createHash("sha256")
    .update(`weddinghanbang-court-invite-cookie-v1\0${secret}`, "utf8")
    .digest();
}
export function sealCourtInviteHandoff(
  tokenHash: string,
  now = Date.now(),
): string {
  if (!/^[a-f0-9]{64}$/.test(tokenHash)) {
    throw new CourtApiError(400, "COURT_INVITE_INVALID", "초대 링크를 확인해 주세요.");
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", inviteCookieKey(), iv);
  cipher.setAAD(Buffer.from("court-invite-handoff-v1", "utf8"));
  const plaintext = Buffer.from(JSON.stringify({
    tokenHash,
    expiresAt: now + COURT_INVITE_HANDOFF_MAX_AGE_SECONDS * 1000,
  }), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map((value) => value.toString("base64url")).join(".");
}

export function openCourtInviteHandoff(
  value: string,
  now = Date.now(),
): { tokenHash: string } {
  try {
    const [rawIv, rawTag, rawCiphertext, extra] = value.split(".");
    if (!rawIv || !rawTag || !rawCiphertext || extra) throw new Error("invalid_shape");
    const iv = Buffer.from(rawIv, "base64url");
    const tag = Buffer.from(rawTag, "base64url");
    const ciphertext = Buffer.from(rawCiphertext, "base64url");
    if (iv.length !== 12 || tag.length !== 16 || ciphertext.length > 512) {
      throw new Error("invalid_bounds");
    }
    const decipher = createDecipheriv("aes-256-gcm", inviteCookieKey(), iv);
    decipher.setAAD(Buffer.from("court-invite-handoff-v1", "utf8"));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    const parsed = JSON.parse(plaintext) as { tokenHash?: unknown; expiresAt?: unknown };
    if (
      typeof parsed.tokenHash !== "string"
      || !/^[a-f0-9]{64}$/.test(parsed.tokenHash)
      || typeof parsed.expiresAt !== "number"
      || !Number.isSafeInteger(parsed.expiresAt)
      || parsed.expiresAt <= now
      || parsed.expiresAt > now + COURT_INVITE_HANDOFF_MAX_AGE_SECONDS * 1000
    ) {
      throw new Error("invalid_payload");
    }
    return { tokenHash: parsed.tokenHash };
  } catch (error) {
    if (error instanceof CourtApiError) throw error;
    throw new CourtApiError(410, "COURT_INVITE_HANDOFF_EXPIRED", "로그인 시간이 지나 초대 링크를 다시 열어야 해요.");
  }
}

export function courtInviteHandoffFromRequest(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie") ?? "";
  for (const item of cookieHeader.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0) continue;
    const name = item.slice(0, separator).trim();
    if (name !== COURT_INVITE_HANDOFF_COOKIE) continue;
    try {
      return decodeURIComponent(item.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}
