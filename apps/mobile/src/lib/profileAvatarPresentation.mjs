import { getProfileInitial, isProfileAvatarEmoji } from "@hanbang/shared/profile-avatar";
import { runMobileWebApiRequestWithTimeout } from "./mobileWebApiBridge.mjs";

// 개인 프로필 표시(글자·이모지·사진)를 모바일이 읽고 저장할 때 쓰는 순수 규칙.
// 서버 계약은 apps/web/src/app/api/profile/avatar/route.ts 와
// apps/web/src/lib/profileAvatar.ts(profileAvatarPresentation)가 정본이다.
// 웹 ProfileAvatarEditor 의 parseAvatarResponse 와 같은 판정을 한다.

export const PROFILE_AVATAR_MAX_PHOTO_BYTES = 4 * 1024 * 1024;
export const PROFILE_AVATAR_PHOTO_TYPES = Object.freeze(["image/jpeg", "image/png", "image/webp"]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PHOTO_PATH = /^\/api\/profile\/avatar\/image\?userId=([^&#]+)&version=([^&#]+)$/;
const EXTENSION_TYPES = Object.freeze({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" });

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/**
 * 서버가 내려준 avatar_url 이 이 소유자의 허용된 값일 때만 돌려준다.
 * - 허용 목록 이모지 → 그 이모지
 * - `/api/profile/avatar/image?userId=<소유자>&version=<uuid>` → 그 경로(호스트 없음)
 * 그 밖의 값(외부 URL, 다른 사람 경로, 목록 밖 이모지)은 null 이다. 토큰을 실어 보낼
 * 주소를 서버 응답이 고르지 못하게 하려는 것이다.
 */
export function parseProfileAvatarUrl(value, ownerId) {
  if (isProfileAvatarEmoji(value)) return value;
  if (typeof value !== "string" || typeof ownerId !== "string" || !UUID.test(ownerId)) return null;
  const match = PHOTO_PATH.exec(value);
  if (!match) return null;
  const userId = decode(match[1]);
  const version = decode(match[2]);
  if (userId === null || version === null || userId.toLowerCase() !== ownerId.toLowerCase() || !UUID.test(version)) return null;
  return value;
}

/** 화면에 무엇을 그릴지. 사진 경로는 인증 헤더와 함께 API 호스트에서만 읽는다. */
export function profileAvatarDisplay({ name, avatarUrl, ownerId }) {
  const parsed = parseProfileAvatarUrl(avatarUrl, ownerId);
  if (parsed && isProfileAvatarEmoji(parsed)) return { kind: "emoji", emoji: parsed };
  if (parsed) return { kind: "photo", path: parsed, initial: getProfileInitial(name) };
  return { kind: "initial", initial: getProfileInitial(name) };
}

/**
 * GET/PUT /api/profile/avatar 응답을 읽는다. 저장 결과(PUT)는 revision 이 반드시 있어야 한다.
 * 형식이 맞지 않으면 null — 화면은 저장됐다고 말하지 않는다.
 */
export function parseProfileAvatarResponse(value, ownerId, requireRevision = false) {
  if (!isRecord(value)) return null;
  const validRevision = typeof value.revision === "string" && UUID.test(value.revision);
  if (value.avatar_url === null && (validRevision || (!requireRevision && value.revision === null))) {
    return { avatar_url: null, revision: validRevision ? value.revision : null };
  }
  if (!validRevision) return null;
  const avatarUrl = parseProfileAvatarUrl(value.avatar_url, ownerId);
  if (!avatarUrl) return null;
  if (!isProfileAvatarEmoji(avatarUrl) && !avatarUrl.endsWith(`&version=${encodeURIComponent(value.revision)}`)) return null;
  return { avatar_url: avatarUrl, revision: value.revision };
}

export function profileAvatarKind(avatarUrl) {
  return isProfileAvatarEmoji(avatarUrl) ? "emoji" : typeof avatarUrl === "string" && avatarUrl ? "photo" : "initial";
}

/** 서버가 받는 JSON 본문. 키 집합이 정확히 맞아야 서버가 받는다. */
export function buildProfileAvatarJsonBody({ kind, emoji, expectedRevision, ownerId }) {
  if (kind === "emoji") {
    if (!isProfileAvatarEmoji(emoji)) throw new Error("INVALID_AVATAR");
    return { kind: "emoji", emoji, expected_revision: expectedRevision ?? null, expected_user_id: ownerId };
  }
  if (kind === "initial") return { kind: "initial", expected_revision: expectedRevision ?? null, expected_user_id: ownerId };
  throw new Error("INVALID_AVATAR");
}

/** 저장 응답이 요청한 선택과 같은지. 다르면 저장됐다고 보지 않는다. */
export function isSavedProfileAvatarSelection({ kind, emoji }, saved) {
  if (!saved) return false;
  if (kind === "initial") return saved.avatar_url === null;
  if (kind === "emoji") return saved.avatar_url === emoji;
  return typeof saved.avatar_url === "string" && saved.avatar_url.startsWith("/api/profile/avatar/image?");
}

/**
 * 사진 선택 결과를 업로드할 수 있는 형태로 바꾼다. 형식·크기는 서버가 다시 확인하지만,
 * 보내기 전에 걸러 쓸데없는 업로드와 요청 한도 소모를 막는다.
 */
export function readProfileAvatarPhotoAsset(asset) {
  if (!isRecord(asset) || typeof asset.uri !== "string" || !asset.uri) {
    return { ok: false, message: "사진을 읽을 수 없어요. 다른 JPG, PNG, WebP 사진을 선택해 주세요." };
  }
  const declared = typeof asset.mimeType === "string" ? asset.mimeType.split(";", 1)[0].trim().toLowerCase() : "";
  const source = typeof asset.fileName === "string" && asset.fileName ? asset.fileName : asset.uri;
  const extension = /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(source)?.[1]?.toLowerCase() ?? "";
  const type = declared || EXTENSION_TYPES[extension] || "";
  if (!PROFILE_AVATAR_PHOTO_TYPES.includes(type)) {
    return { ok: false, message: "JPG, PNG, WebP 사진을 선택해 주세요." };
  }
  if (asset.fileSize !== undefined && asset.fileSize !== null
    && (typeof asset.fileSize !== "number" || !Number.isFinite(asset.fileSize) || asset.fileSize <= 0 || asset.fileSize > PROFILE_AVATAR_MAX_PHOTO_BYTES)) {
    return { ok: false, message: "내용이 있는 4MB 이하 사진을 선택해 주세요." };
  }
  const suffix = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
  return { ok: true, photo: { uri: asset.uri, name: `profile.${suffix}`, type } };
}

export function profileAvatarSaveErrorMessage(code) {
  if (code === "AUTH_REQUIRED") return "로그인 상태를 다시 확인해 주세요.";
  if (code === "AVATAR_OWNER_CHANGED") return "계정 상태가 바뀌었어요. 현재 계정으로 프로필을 다시 열어 주세요.";
  if (code === "INVALID_IMAGE" || code === "INVALID_AVATAR") return "사진을 읽을 수 없어요. 다른 JPG, PNG, WebP 사진을 선택해 주세요.";
  if (code === "AVATAR_TOO_LARGE") return "4MB 이하의 사진을 선택해 주세요.";
  // 누가 바꿨는지는 모른다. 같은 기기의 직전 요청이 늦게 저장됐을 수도 있다.
  if (code === "AVATAR_SAVE_CONFLICT") return "프로필이 이미 바뀌었어요. 닫은 뒤 다시 열어 확인해 주세요.";
  if (code === "RATE_LIMITED") return "프로필을 너무 자주 바꿨어요. 잠시 뒤 다시 시도해 주세요.";
  return "프로필 저장 결과를 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요.";
}

/** 서버 값을 다시 읽어 시트를 맞춘 뒤 보여 주는 안내. 시트가 이미 지금 값을 보여 준다. */
export const PROFILE_AVATAR_REFRESHED_MESSAGE = "프로필이 이미 바뀌었어요. 지금 저장된 모습을 확인해 주세요.";
export const PROFILE_AVATAR_DISPLAY_READ_TIMEOUT_MS = 15_000;

/**
 * 표시용 GET /api/profile/avatar. 성공(빈 값 포함)과 실패를 나눈다.
 * - 성공: `{ ok: true, avatarUrl, revision }` — avatarUrl 이 null 이면 이름 첫 글자다.
 * - 실패(오류 응답·네트워크·모양 불일치·타임아웃): `{ ok: false }` — 호출부는 지금 보이는 값을 둔다.
 * `request(signal)` 은 Response 를 돌려준다. 타임아웃이면 signal 로 요청도 끊는다.
 */
export async function readProfileAvatarForDisplay(ownerId, request, timeoutMs = PROFILE_AVATAR_DISPLAY_READ_TIMEOUT_MS) {
  try {
    return await runMobileWebApiRequestWithTimeout(async (signal) => {
      const response = await request(signal);
      if (!response.ok) return { ok: false };
      const parsed = parseProfileAvatarResponse(await response.json().catch(() => null), ownerId);
      return parsed ? { ok: true, avatarUrl: parsed.avatar_url, revision: parsed.revision } : { ok: false };
    }, timeoutMs);
  } catch {
    return { ok: false };
  }
}

function isTransportFailure(failure) {
  // 끊김(AbortError)과 네트워크 오류(fetch TypeError)는 요청이 서버에 닿았는지 모른다.
  return failure instanceof TypeError || (typeof failure === "object" && failure !== null && failure.name === "AbortError");
}

/**
 * 프로필 표시 저장 한 번. 결과를 모르는 실패는 서버 값을 다시 읽어 판단한다.
 *
 * - `send()`: PUT 요청을 보내고 Response 를 돌려준다(끊기면 throw).
 * - `reread()`: `readProfileAvatarForDisplay` 결과 모양을 돌려준다.
 *
 * 결과
 * - `saved`: 서버에 고른 값이 있다. 이모지·기본 글자는 revision 이 바뀌고 값이 같으면 저장으로 본다.
 * - `refreshed`: 서버 값이 바뀌었지만 고른 값이라고 증명할 수 없다(사진은 서버가 다시 인코딩하고
 *   revision 을 새로 만들어 같은 사진인지 알 수 없다). 시트를 그 값으로 맞춘다.
 * - `failed`: 저장되지 않았거나 확인하지 못했다.
 */
export async function saveProfileAvatarSelection({ selection, expectedRevision, ownerId, send, reread }) {
  let code = null;
  try {
    const response = await send();
    const payload = await response.json().catch(() => null);
    if (response.ok) {
      const saved = parseProfileAvatarResponse(payload, ownerId, true);
      if (saved && isSavedProfileAvatarSelection(selection, saved)) {
        return { type: "saved", avatarUrl: saved.avatar_url, revision: saved.revision };
      }
      // 2xx 인데 모양이 틀렸다. 서버는 저장했을 수 있다.
    } else {
      code = response.status === 429 ? "RATE_LIMITED" : isRecord(payload) ? payload.code ?? null : null;
      const outcomeUnknown = response.status >= 500 || response.status === 408 || response.status < 400
        || code === "AVATAR_SAVE_CONFLICT";
      if (!outcomeUnknown) return { type: "failed", message: profileAvatarSaveErrorMessage(code) };
    }
  } catch (failure) {
    if (failure instanceof Error && failure.message === "API_SESSION_OWNER_MISMATCH") {
      return { type: "failed", message: profileAvatarSaveErrorMessage("AVATAR_OWNER_CHANGED") };
    }
    // 요청을 보내기 전에 멈춘 오류(로그인 필요 등)는 서버에 닿지 않았다.
    if (!isTransportFailure(failure)) return { type: "failed", message: profileAvatarSaveErrorMessage(null) };
  }

  let current;
  try {
    current = await reread();
  } catch {
    current = { ok: false };
  }
  if (!current || current.ok !== true) return { type: "failed", message: profileAvatarSaveErrorMessage(code) };
  if (current.revision === (expectedRevision ?? null)) {
    // 서버 값이 그대로다. 아직 처리 중일 수 있어 저장됐다고도, 안 됐다고도 단정하지 않는다.
    return { type: "failed", message: profileAvatarSaveErrorMessage(null) };
  }
  const state = { avatar_url: current.avatarUrl, revision: current.revision };
  if (selection.kind !== "photo" && isSavedProfileAvatarSelection(selection, state)) {
    return { type: "saved", avatarUrl: current.avatarUrl, revision: current.revision };
  }
  return { type: "refreshed", avatarUrl: current.avatarUrl, revision: current.revision, message: PROFILE_AVATAR_REFRESHED_MESSAGE };
}
