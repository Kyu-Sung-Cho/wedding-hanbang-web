import { sanitizeText } from "@/utils/sanitize";

export const COMMUNITY_NICKNAME_MAX_LENGTH = 20;

const RESERVED_NICKNAME_FRAGMENTS = [
  "admin",
  "administrator",
  "hanbang",
  "official",
  "root",
  "staff",
  "support",
  "system",
  "weddinghanbang",
  "관리자",
  "고객센터",
  "공식",
  "아모라",
  "운영자",
  "웨딩한방",
  "한방운영",
];

const PROHIBITED_NICKNAME_FRAGMENTS = [
  "18놈",
  "18년",
  "18새",
  "bitch",
  "cunt",
  "fuck",
  "sex",
  "shit",
  "ㅂㅅ",
  "ㅅㅂ",
  "개새",
  "느금",
  "니미",
  "병신",
  "보지",
  "새끼",
  "섹스",
  "시발",
  "씨발",
  "애미",
  "자지",
  "존나",
  "좆",
];

export type CommunityNicknameValidationResult =
  | { ok: true; nickname: string; key: string }
  | { ok: false; message: string };

export function normalizeCommunityNickname(raw: unknown): string | null {
  if (typeof raw !== "string") return null;

  const nickname = sanitizeText(raw)
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();

  return nickname.length > 0 ? nickname : null;
}

export function getCommunityNicknameKey(nickname: string): string {
  return nickname
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/\s+/g, "")
    .trim();
}

export function validateCommunityNickname(raw: unknown): CommunityNicknameValidationResult {
  const nickname = normalizeCommunityNickname(raw);

  if (!nickname) {
    return { ok: false, message: "닉네임을 입력해 주세요." };
  }

  if (/[\x00-\x1F\x7F]/.test(nickname)) {
    return { ok: false, message: "사용할 수 없는 문자가 포함되어 있습니다." };
  }

  if (Array.from(nickname).length > COMMUNITY_NICKNAME_MAX_LENGTH) {
    return { ok: false, message: "닉네임은 20자 이내로 입력해 주세요." };
  }

  if (!/^[\p{L}\p{N} ._-]+$/u.test(nickname)) {
    return {
      ok: false,
      message: "닉네임은 한글, 영문, 숫자, 공백, ., _, -만 사용할 수 있습니다.",
    };
  }

  const key = getCommunityNicknameKey(nickname);
  if (!key) {
    return { ok: false, message: "닉네임을 입력해 주세요." };
  }

  if (RESERVED_NICKNAME_FRAGMENTS.some((term) => key.includes(term))) {
    return { ok: false, message: "공식 계정으로 오해될 수 있는 닉네임은 사용할 수 없습니다." };
  }

  if (PROHIBITED_NICKNAME_FRAGMENTS.some((term) => key.includes(term))) {
    return { ok: false, message: "부적절한 표현이 포함된 닉네임은 사용할 수 없습니다." };
  }

  return { ok: true, nickname, key };
}

export function getCommunityNicknameFallback(userId: string): string {
  const suffix = userId.replace(/-/g, "").slice(0, 8) || "member";
  return `user-${suffix}`;
}

export function getSafeDefaultCommunityNickname(rawName: unknown, userId: string): string {
  const result = validateCommunityNickname(rawName);
  return result.ok ? result.nickname : getCommunityNicknameFallback(userId);
}

export function isCommunityNicknameUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const maybeError = error as { code?: unknown; message?: unknown; details?: unknown };
  const text = `${String(maybeError.message ?? "")} ${String(maybeError.details ?? "")}`;

  return (
    maybeError.code === "23505" &&
    /community_profiles.*nickname|nickname.*community_profiles|nickname_key/i.test(text)
  );
}
