import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { isProfileAvatarEmoji } from "@hanbang/shared/profile-avatar";
import { isRecord, isUuid } from "@/utils/requestValidation";
import { sanitizeCommunityImage } from "@/lib/community/imageSanitizer";
import { log } from "@/utils/log";

export const PROFILE_AVATAR_BUCKET = "profile-avatars";
export const PROFILE_AVATAR_MAX_BYTES = 4 * 1024 * 1024;
export const PROFILE_AVATAR_HEADERS = { "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff" };
const COLUMNS = "user_id,kind,emoji,object_path,revision,updated_at";
const WEBP_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$/;

export class ProfileAvatarError extends Error {
  constructor(public code: string, public status = 503) { super(code); }
}
export interface ProfileAvatarRow {
  user_id: string; kind: "initial" | "emoji" | "photo"; emoji: string | null;
  object_path: string | null; revision: string; updated_at: string;
}
export type ProfileAvatarSelection = { kind: "initial" } | { kind: "emoji"; emoji: string } | { kind: "photo"; bytes: Uint8Array; mimeType: string };

export function isProfileAvatarPath(path: unknown, userId: string): path is string {
  return typeof path === "string" && isUuid(userId) && path.startsWith(`${userId}/`) && WEBP_FILE.test(path.slice(userId.length + 1));
}
function parseRow(value: unknown): ProfileAvatarRow | null {
  if (!isRecord(value) || !isUuid(value.user_id) || !isUuid(value.revision) || typeof value.updated_at !== "string") return null;
  const initial = value.kind === "initial" && value.emoji === null && value.object_path === null;
  const emoji = value.kind === "emoji" && isProfileAvatarEmoji(value.emoji) && value.object_path === null;
  const photo = value.kind === "photo" && value.emoji === null && isProfileAvatarPath(value.object_path, String(value.user_id));
  if (!initial && !emoji && !photo) return null;
  return {
    user_id: value.user_id, kind: photo ? "photo" : emoji ? "emoji" : "initial",
    emoji: typeof value.emoji === "string" ? value.emoji : null,
    object_path: typeof value.object_path === "string" ? value.object_path : null,
    revision: value.revision, updated_at: value.updated_at,
  };
}
export function profileAvatarPresentation(row: ProfileAvatarRow | null) {
  return {
    avatar_url: row?.kind === "emoji" ? row.emoji : row?.kind === "photo"
      ? `/api/profile/avatar/image?userId=${encodeURIComponent(row.user_id)}&version=${encodeURIComponent(row.revision)}` : null,
    revision: row?.revision ?? null,
  };
}
export async function readProfileAvatar(admin: SupabaseClient, userId: string): Promise<ProfileAvatarRow | null> {
  const { data, error } = await admin.from("profile_avatars").select(COLUMNS).eq("user_id", userId).maybeSingle();
  if (error) throw new ProfileAvatarError("PROFILE_AVATAR_UNAVAILABLE");
  if (!data) return null;
  const row = parseRow(data);
  if (!row || row.user_id !== userId) throw new ProfileAvatarError("PROFILE_AVATAR_UNAVAILABLE");
  return row;
}
/** 인증 경계가 이미 확인한 본인/현재 상대 ID만 받는다. 선택 기능 실패는 로그인을 막지 않는다. */
export async function readOptionalProfileAvatars(admin: SupabaseClient, userIds: string[]) {
  const ids = [...new Set(userIds.filter(isUuid))];
  const avatars = new Map<string, ReturnType<typeof profileAvatarPresentation>>();
  if (!ids.length) return avatars;
  try {
    const { data, error } = await admin.rpc("read_profile_avatar_snapshot", { p_user_id: ids[0] });
    if (error || !Array.isArray(data)) return avatars;
    // 성공한 빈 조회는 기본 글자, 실패하거나 손상된 행은 미확인 상태로 구분한다.
    for (const id of ids) {
      const value = data.find(item => isRecord(item) && item.user_id === id);
      if (value === undefined) avatars.set(id, { ...profileAvatarPresentation(null) });
      else { const row = parseRow(value); if (row) avatars.set(id, { ...profileAvatarPresentation(row) }); }
    }
  } catch { /* 선택 기능이 미적용된 환경에서도 인증 자체는 유지한다. */ }
  return avatars;
}
export async function sanitizeProfileAvatar(bytes: Uint8Array, mimeType: string): Promise<Buffer> {
  if (bytes.byteLength > PROFILE_AVATAR_MAX_BYTES) throw new ProfileAvatarError("AVATAR_TOO_LARGE", 413);
  if (bytes.byteLength === 0 || (mimeType !== "image/jpeg" && mimeType !== "image/png" && mimeType !== "image/webp")) throw new ProfileAvatarError("INVALID_IMAGE", 400);
  try {
    const sanitized = await sanitizeCommunityImage(bytes, mimeType);
    return await sharp(sanitized.bytes, { limitInputPixels: 24_000_000 }).resize(256, 256, { fit: "cover" }).webp({ quality: 85 }).toBuffer();
  } catch { throw new ProfileAvatarError("INVALID_IMAGE", 400); }
}
async function removeSafely(admin: SupabaseClient, path: string) {
  try { const { error } = await admin.storage.from(PROFILE_AVATAR_BUCKET).remove([path]); if (error) log.error("profile-avatar:cleanup-deferred"); }
  catch { log.error("profile-avatar:cleanup-deferred"); }
}
function isDefinitiveSaveRejection(error: unknown) {
  return isRecord(error) && error.code === "P0001" && typeof error.message === "string"
    && ["PROFILE_AVATAR_INVALID", "PROFILE_AVATAR_DELETION_PENDING", "PROFILE_AVATAR_CONFLICT", "PROFILE_AVATAR_ASSET_INVALID"].includes(error.message);
}
export async function saveProfileAvatar(admin: SupabaseClient, userId: string, selection: ProfileAvatarSelection, expectedRevision: string | null) {
  if (!isUuid(userId) || (expectedRevision !== null && !isUuid(expectedRevision))) throw new ProfileAvatarError("INVALID_AVATAR", 400);
  const previous = await readProfileAvatar(admin, userId);
  if ((previous?.revision ?? null) !== expectedRevision) throw new ProfileAvatarError("AVATAR_SAVE_CONFLICT", 409);
  const revision = randomUUID();
  let newPath: string | null = null;
  if (selection.kind === "photo") {
    const bytes = await sanitizeProfileAvatar(selection.bytes, selection.mimeType);
    const { data: registered, error } = await admin.rpc("register_profile_avatar_asset", { p_user_id: userId, p_revision: revision });
    if (error || !isRecord(registered) || registered.object_path !== `${userId}/${revision}.webp`) throw new ProfileAvatarError("PROFILE_AVATAR_UNAVAILABLE");
    newPath = `${userId}/${revision}.webp`;
    try {
      const { error: uploadError } = await admin.storage.from(PROFILE_AVATAR_BUCKET).upload(newPath, bytes, { contentType: "image/webp", cacheControl: "0", upsert: false });
      if (uploadError) throw uploadError;
    } catch {
      // 업로드 응답이 끊겨도 서버에는 나중에 도착할 수 있다. 등록 장부를 유지해 삭제가 추적한다.
      throw new ProfileAvatarError("AVATAR_SAVE_FAILED");
    }
  }
  try {
    const { error } = await admin.rpc("save_profile_avatar", {
      p_user_id: userId, p_kind: selection.kind, p_emoji: selection.kind === "emoji" ? selection.emoji : null,
      p_revision: revision, p_expected_revision: expectedRevision,
    });
    // RPC 결과가 불확실해도 현재 revision을 다시 확인한다. 이미 저장된 사진은 삭제하지 않는다.
    const current = await readProfileAvatar(admin, userId);
    if (current?.revision !== revision) {
      // 네트워크 오류 뒤 옛 row를 읽었다고 아직 대기 중인 DB commit이 취소된 것은 아니다.
      if (newPath && (!error || isDefinitiveSaveRejection(error))) await removeSafely(admin, newPath);
      const conflict = !error || (isRecord(error) && error.code === "P0001" && error.message === "PROFILE_AVATAR_CONFLICT");
      throw new ProfileAvatarError(conflict ? "AVATAR_SAVE_CONFLICT" : "AVATAR_SAVE_FAILED", conflict ? 409 : 503);
    }
    if (previous?.object_path && previous.object_path !== current.object_path) await removeSafely(admin, previous.object_path);
    return profileAvatarPresentation(current);
  } catch (error) {
    if (error instanceof ProfileAvatarError) throw error;
    // 네트워크 예외 후에도 정본이 신규 revision이면 성공이다. 확인할 수 없으면 삭제를 보류한다.
    try {
      const current = await readProfileAvatar(admin, userId);
      if (current?.revision === revision) {
        if (previous?.object_path && previous.object_path !== current.object_path) await removeSafely(admin, previous.object_path);
        return profileAvatarPresentation(current);
      }
      // transport 예외는 늦은 commit이 가능하므로 신규 객체를 지우지 않는다.
    } catch { /* 자산 장부에 남겨 계정 삭제 때도 빠짐없이 정리한다. */ }
    throw new ProfileAvatarError("AVATAR_SAVE_FAILED");
  }
}

/** 본인 인증 후에만 호출하며 권한과 행을 하나의 SQL 스냅샷에서 읽는다. */
export async function readAuthorizedProfileAvatar(admin: SupabaseClient, requesterId: string, targetId: string) {
  if (!isUuid(requesterId) || !isUuid(targetId)) throw new ProfileAvatarError("INVALID_AVATAR", 400);
  const { data, error } = await admin.rpc("read_profile_avatar_snapshot", { p_user_id: requesterId });
  if (error || !Array.isArray(data)) throw new ProfileAvatarError("PROFILE_AVATAR_UNAVAILABLE");
  const found = data.find(value => isRecord(value) && value.user_id === targetId);
  if (!found) return null;
  const row = parseRow(found);
  if (!row || row.user_id !== targetId) throw new ProfileAvatarError("PROFILE_AVATAR_UNAVAILABLE");
  return row;
}
