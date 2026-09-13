import { NextResponse } from "next/server";
import { isProfileAvatarEmoji } from "@hanbang/shared/profile-avatar";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { isRecord, isUuid } from "@/utils/requestValidation";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { log } from "@/utils/log";
import { PROFILE_AVATAR_HEADERS, PROFILE_AVATAR_MAX_BYTES, ProfileAvatarError, profileAvatarPresentation, readProfileAvatar, saveProfileAvatar, type ProfileAvatarSelection } from "@/lib/profileAvatar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
function response(body: unknown, status = 200) { return NextResponse.json(body, { status, headers: PROFILE_AVATAR_HEADERS }); }
function failure(error: unknown) {
  const code = error instanceof ProfileAvatarError ? error.code : "PROFILE_AVATAR_UNAVAILABLE";
  const status = error instanceof ProfileAvatarError ? error.status : 503;
  if (status >= 500) log.error("profile-avatar:request-failed", new Error(code));
  return response({ error: status === 413 ? "사진은 4MB 이하로 선택해 주세요." : status === 400 ? "이모지 또는 JPG·PNG·WebP 사진을 확인해 주세요." : "프로필 이미지를 처리하지 못했어요. 잠시 후 다시 시도해 주세요.", code }, status);
}
export async function GET(request: Request) {
  try {
    const client = await createClientFromRequest(request);
    const { data: { user }, error: authError } = await client.auth.getUser();
    if (authError || !user || user.is_anonymous) return response({ error: "로그인이 필요해요.", code: "AUTH_REQUIRED" }, 401);
    return response(profileAvatarPresentation(await readProfileAvatar(createAdminClient(), user.id)));
  } catch (error) { return failure(error); }
}
async function readSelection(request: Request): Promise<{ selection: ProfileAvatarSelection; expectedRevision: string | null }> {
  const contentType = request.headers.get("content-type") ?? "";
  const mime = contentType.split(";", 1)[0].trim().toLowerCase();
  const limit = mime === "multipart/form-data" ? PROFILE_AVATAR_MAX_BYTES + 64 * 1024 : 1024;
  if (Number(request.headers.get("content-length")) > limit) throw new ProfileAvatarError("AVATAR_TOO_LARGE", 413);
  // Content-Length가 없거나 거짓이어도 스트림 실제 바이트 수로 제한한다.
  const reader = request.body?.getReader();
  if (!reader) throw new ProfileAvatarError("INVALID_AVATAR", 400);
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > limit) { await reader.cancel(); throw new ProfileAvatarError("AVATAR_TOO_LARGE", 413); } chunks.push(part.value); }
  const bytes = Buffer.concat(chunks);
  if (mime === "multipart/form-data") {
    let form: FormData;
    try { form = await new Response(bytes, { headers: { "Content-Type": contentType } }).formData(); }
    catch { throw new ProfileAvatarError("INVALID_AVATAR", 400); }
    if ([...form.keys()].some(key => key !== "photo" && key !== "expected_revision") || form.getAll("photo").length !== 1 || form.getAll("expected_revision").length !== 1) throw new ProfileAvatarError("INVALID_AVATAR", 400);
    const file = form.get("photo");
    if (!file || typeof file === "string") throw new ProfileAvatarError("INVALID_IMAGE", 400);
    const expected = form.get("expected_revision");
    if (expected !== "null" && !isUuid(expected)) throw new ProfileAvatarError("INVALID_AVATAR", 400);
    return { selection: { kind: "photo", bytes: new Uint8Array(await file.arrayBuffer()), mimeType: file.type }, expectedRevision: expected === "null" ? null : String(expected) };
  }
  if (mime !== "application/json") throw new ProfileAvatarError("INVALID_AVATAR", 400);
  let body: unknown; try { body = JSON.parse(bytes.toString("utf8")); } catch { throw new ProfileAvatarError("INVALID_AVATAR", 400); }
  if (!isRecord(body) || (body.expected_revision !== null && !isUuid(body.expected_revision))) throw new ProfileAvatarError("INVALID_AVATAR", 400);
  if (body.kind === "initial" && Object.keys(body).sort().join(",") === "expected_revision,kind") return { selection: { kind: "initial" }, expectedRevision: body.expected_revision as string | null };
  if (body.kind === "emoji" && Object.keys(body).sort().join(",") === "emoji,expected_revision,kind" && isProfileAvatarEmoji(body.emoji)) return { selection: { kind: "emoji", emoji: String(body.emoji) }, expectedRevision: body.expected_revision as string | null };
  throw new ProfileAvatarError("INVALID_AVATAR", 400);
}
export async function PUT(request: Request) {
  if (!isTrustedMutationRequest(request)) return response({ error: "올바르지 않은 요청 출처예요.", code: "UNTRUSTED_ORIGIN" }, 403);
  try {
    const client = await createClientFromRequest(request);
    const { data: { user }, error: authError } = await client.auth.getUser();
    if (authError || !user || user.is_anonymous) return response({ error: "로그인이 필요해요.", code: "AUTH_REQUIRED" }, 401);
    const limited = await checkRateLimitPersistent(rateLimitKey("profile:avatar", request, user.id), { maxRequests: 20, windowMs: 60 * 60 * 1000 }, { failClosed: true });
    if (limited) { for (const [key, value] of Object.entries(PROFILE_AVATAR_HEADERS)) limited.headers.set(key, value); return limited; }
    const { selection, expectedRevision } = await readSelection(request);
    return response(await saveProfileAvatar(createAdminClient(), user.id, selection, expectedRevision));
  } catch (error) { return failure(error); }
}
