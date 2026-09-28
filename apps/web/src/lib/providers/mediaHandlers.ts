import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { hasActiveAccountDeletion } from "@/lib/accountDeletion/communityStorageSaga";
import { providerAccount, providerError, providerJson, providerRateLimit, providerRpc, ProviderError, readProviderBytes } from "./api";
import { providerMediaSchema, providerMediaUrl } from "./contracts";
import { providerOutput } from "./handlers";
import { providerIdSchema, mediaInputSchema } from "./validation";
import { processProviderImage, PROVIDER_IMAGE_MAX_BYTES } from "./imageProcessing";
import { log } from "@/utils/log";

const BUCKET = "provider-portfolio";
const storedMedia = z.object({ id: z.string().uuid(), provider_id: z.string().uuid(), storage_path: z.string(), mime_type: z.enum(["image/jpeg", "image/png", "image/webp"]), status: z.enum(["uploading", "ready", "removed"]), created_at: z.string() });
const accessProfile = z.object({ id: z.string().uuid(), owner_id: z.string().uuid(), approval_status: z.string(), publication_status: z.string() });
function safeStoragePath(path: string, ownerId: string, providerId: string, mediaId: string) {
  return ["jpg", "png", "webp"].some((suffix) => path === `${ownerId}/${providerId}/${mediaId}.${suffix}`);
}
export async function uploadProviderMedia(request: Request, providerId: string) {
  let reservation: z.infer<typeof storedMedia> | undefined;
  let ownerId: string | undefined;
  try {
    const { client, user } = await providerAccount(request, true);
    ownerId = user.id;
    providerIdSchema.parse(providerId);
    await providerRateLimit(request, user.id, "provider-media");
    const admin = createAdminClient({ requestTimeoutMs: 20_000 });
    if (await hasActiveAccountDeletion(admin, user.id)) throw new ProviderError("PROVIDER_ACCOUNT_DELETION_PENDING", 409, "계정 삭제 중에는 사진을 올릴 수 없어요.");
    const contentType = request.headers.get("content-type");
    if (!contentType?.toLowerCase().startsWith("multipart/form-data;")) throw new ProviderError("PROVIDER_INVALID_INPUT", 400, "사진 파일을 선택해 주세요.");
    const bytes = await readProviderBytes(request, PROVIDER_IMAGE_MAX_BYTES + 32 * 1024);
    const form = await new Response(bytes, { headers: { "Content-Type": contentType } }).formData();
    const keys = [...form.keys()];
    if (new Set(keys).size !== keys.length || keys.some((key) => !["file", "caption", "alt_text", "rights_confirmed"].includes(key))) throw new ProviderError("PROVIDER_INVALID_INPUT", 400, "사진 입력 내용을 확인해 주세요.");
    const fields = mediaInputSchema.parse({ caption: form.get("caption") ?? "", alt_text: form.get("alt_text"), rights_confirmed: form.get("rights_confirmed") });
    const file = form.get("file");
    if (!(file instanceof File) || file.size > PROVIDER_IMAGE_MAX_BYTES) throw new ProviderError("PROVIDER_INVALID_IMAGE", 400, "5MB 이하의 사진 파일을 선택해 주세요.");
    const output = await processProviderImage(new Uint8Array(await file.arrayBuffer()), file.type);
    reservation = providerOutput(storedMedia, await providerRpc(admin, "provider_register_media_upload", { p_provider_id: providerId, p_owner_id: user.id, p_mime_type: "image/webp", p_byte_size: output.length }));
    if (!safeStoragePath(reservation.storage_path, user.id, providerId, reservation.id)) throw new Error("invalid_storage_path");
    if (!Number.isFinite(Date.parse(reservation.created_at)) || Date.now() - Date.parse(reservation.created_at) > 5 * 60 * 1000) throw new Error("expired_upload");
    if (await hasActiveAccountDeletion(admin, user.id)) throw new ProviderError("PROVIDER_ACCOUNT_DELETION_PENDING", 409, "계정 삭제 중에는 사진을 올릴 수 없어요.");
    const { error } = await admin.storage.from(BUCKET).upload(reservation.storage_path, output, { contentType: "image/webp", upsert: false, cacheControl: "0" });
    if (error) throw new Error("storage_upload_failed");
    const media = providerOutput(providerMediaSchema, await providerRpc(client, "provider_finalize_media", { p_media_id: reservation.id, p_caption: fields.caption, p_alt_text: fields.alt_text, p_rights_confirmed: true }));
    return providerJson({ media: { ...media, image_url: providerMediaUrl(providerId, media.id) } }, 201);
  } catch (error) {
    if (reservation && ownerId && safeStoragePath(reservation.storage_path, ownerId, providerId, reservation.id)) {
      try {
        const admin = createAdminClient({ requestTimeoutMs: 20_000 });
        const aborted = providerOutput(z.object({ aborted: z.boolean(), storage_path: z.string().nullable() }), await providerRpc(admin, "provider_abort_media_upload", { p_media_id: reservation.id, p_owner_id: ownerId }));
        // finalize가 성공하고 응답만 유실된 사진은 삭제하지 않는다.
        if (aborted.aborted && aborted.storage_path === reservation.storage_path) await admin.storage.from(BUCKET).remove([reservation.storage_path]);
      } catch { /* 비공개 미완료 파일은 삭제 manifest에 남겨 재처리한다. */ }
    }
    return providerError(error);
  }
}
export async function readProviderMedia(request: Request, providerId: string, mediaId: string) {
  try {
    providerIdSchema.parse(providerId); providerIdSchema.parse(mediaId);
    const admin = createAdminClient({ requestTimeoutMs: 20_000 });
    const [mediaResult, profileResult] = await Promise.all([
      admin.from("provider_media").select("id,provider_id,storage_path,mime_type,status,created_at").eq("id", mediaId).eq("provider_id", providerId).maybeSingle(),
      admin.from("provider_profiles").select("id,owner_id,approval_status,publication_status").eq("id", providerId).maybeSingle(),
    ]);
    if (mediaResult.error || profileResult.error) throw new Error("media_unavailable");
    const media = storedMedia.safeParse(mediaResult.data);
    const profile = accessProfile.safeParse(profileResult.data);
    if (!media.success || !profile.success || media.data.status !== "ready" || profile.data.approval_status !== "approved") return providerJson({ error: "사진을 찾을 수 없어요.", code: "PROVIDER_NOT_FOUND" }, 404);
    if (await hasActiveAccountDeletion(admin, profile.data.owner_id)) return providerJson({ error: "사진을 찾을 수 없어요.", code: "PROVIDER_NOT_FOUND" }, 404);
    let ownerAccess = false;
    if (profile.data.publication_status !== "published") {
      const client = await createClientFromRequest(request);
      const { data: { user }, error } = await client.auth.getUser();
      ownerAccess = !error && user?.id === profile.data.owner_id;
      if (!ownerAccess) return providerJson({ error: "사진을 찾을 수 없어요.", code: "PROVIDER_NOT_FOUND" }, 404);
    }
    if (!safeStoragePath(media.data.storage_path, profile.data.owner_id, providerId, mediaId)) throw new Error("invalid_storage_path");
    const { data, error } = await admin.storage.from(BUCKET).download(media.data.storage_path);
    if (error || !data || data.size > PROVIDER_IMAGE_MAX_BYTES) throw new Error("media_unavailable");
    // 다운로드 중 정지·비공개 전환도 확인한다. CDN에 공개 파일을 남기지 않는다.
    const { data: latest, error: latestError } = await admin.from("provider_profiles").select("id,owner_id,approval_status,publication_status").eq("id", providerId).maybeSingle();
    const finalProfile = accessProfile.safeParse(latest);
    const { data: latestMedia, error: latestMediaError } = await admin.from("provider_media").select("status").eq("id", mediaId).maybeSingle();
    if (latestError || latestMediaError) throw new Error("media_unavailable");
    if (!finalProfile.success || finalProfile.data.approval_status !== "approved" || (finalProfile.data.publication_status !== "published" && !ownerAccess) || latestMedia?.status !== "ready" || await hasActiveAccountDeletion(admin, profile.data.owner_id)) return providerJson({ error: "사진을 찾을 수 없어요.", code: "PROVIDER_NOT_FOUND" }, 404);
    return new Response(await data.arrayBuffer(), { headers: { "Content-Type": media.data.mime_type, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox" } });
  } catch (error) { return providerError(error); }
}
export async function removeProviderMedia(request: Request, providerId: string, mediaId: string) {
  try {
    const { client, user } = await providerAccount(request, true);
    providerIdSchema.parse(providerId); providerIdSchema.parse(mediaId);
    await providerRateLimit(request, user.id, "provider-media");
    const admin = createAdminClient({ requestTimeoutMs: 20_000 });
    const { data, error } = await admin.from("provider_profiles").select("owner_id").eq("id", providerId).maybeSingle();
    if (error) throw new Error("profile_unavailable");
    if (data?.owner_id !== user.id) throw new ProviderError("PROVIDER_NOT_FOUND", 404, "사진을 찾을 수 없어요.");
    const { data: media, error: mediaError } = await admin.from("provider_media").select("id").eq("id", mediaId).eq("provider_id", providerId).maybeSingle();
    if (mediaError) throw new Error("media_unavailable");
    if (!media) throw new ProviderError("PROVIDER_NOT_FOUND", 404, "사진을 찾을 수 없어요.");
    const removed = providerOutput(z.object({ id: z.string().uuid(), storage_path: z.string() }), await providerRpc(client, "provider_remove_media", { p_media_id: mediaId }));
    if (!safeStoragePath(removed.storage_path, user.id, providerId, mediaId)) throw new Error("invalid_storage_path");
    let cleanupPending = true;
    try { cleanupPending = Boolean((await admin.storage.from(BUCKET).remove([removed.storage_path])).error); } catch { /* 공개 철회는 이미 완료되었고 파일 정리는 재처리 대상이다. */ }
    if (cleanupPending) log.error("providers/media-cleanup", new Error("PROVIDER_MEDIA_CLEANUP_PENDING"));
    return providerJson({ success: true, cleanup_pending: cleanupPending });
  } catch (error) { return providerError(error); }
}
