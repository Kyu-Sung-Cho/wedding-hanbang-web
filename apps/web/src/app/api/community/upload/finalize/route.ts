import { createHash, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasActiveAccountDeletion } from "@/lib/accountDeletion/communityStorageSaga";
import { createClientFromRequest } from "@/lib/supabase/server";
import { verifyRuntimeSupabaseServiceDestination } from "@/lib/supabase/destinationFence";
import {
  sanitizeCommunityImage,
  validateSanitizedCommunityImage,
} from "@/lib/community/imageSanitizer";
import {
  COMMUNITY_MEDIA_RULES,
  COMMUNITY_STAGING_BUCKET,
  communityMediaSignatureMatches,
  normalizeCommunityMimeType,
  type CommunityMimeType,
} from "@/lib/community/uploadPolicy";
import {
  claimCommunityUploadSession,
  expireIssuedCommunityUploadSession,
  markCommunityUploadCompleted,
  rejectCommunityUploadSession,
  type CommunityUploadSession,
} from "@/lib/community/uploadSession";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { checkCommunityWriteAccess } from "@/lib/community/writeAccess";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";
import {
  COMMUNITY_MEDIA_DISABLED_CODE,
  isCommunityMediaPublishingEnabled,
} from "@/lib/community/mediaPublishingGate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BODY_BYTES = 1024;
const NO_STORE = { "Cache-Control": "no-store" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/;

function json(body: Record<string, unknown>, status: number, headers: HeadersInit = {}) {
  return NextResponse.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

async function readUploadId(request: Request): Promise<string | null> {
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase()
      !== "application/json") return null;
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) return null;
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (Object.keys(record).join(",") !== "uploadId") return null;
    return typeof record.uploadId === "string" && UUID_RE.test(record.uploadId)
      ? record.uploadId
      : null;
  } catch {
    return null;
  }
}

function isSessionContractExact(session: CommunityUploadSession): boolean {
  const mimeType = normalizeCommunityMimeType(session.declared_mime_type);
  if (!mimeType || session.user_id.length === 0) return false;
  const rule = COMMUNITY_MEDIA_RULES[mimeType];
  const expectedPath = `${session.user_id}/${session.id}.${rule.extension}`;
  const baseExact = session.staging_path === expectedPath
    && session.final_path === expectedPath
    && session.final_bucket === rule.bucket
    && Number.isSafeInteger(session.declared_size)
    && session.declared_size > 0
    && session.declared_size <= rule.maxBytes;
  if (!baseExact || session.status !== "completed") return baseExact;
  return session.actual_mime_type === mimeType
    && Number.isSafeInteger(session.actual_size)
    && (session.actual_size ?? 0) > 0
    && (session.actual_size ?? 0) <= rule.maxBytes
    && typeof session.content_sha256 === "string"
    && SHA256_RE.test(session.content_sha256)
    && typeof session.sanitized_at === "string"
    && Number.isFinite(Date.parse(session.sanitized_at))
    && typeof session.completed_at === "string"
    && Number.isFinite(Date.parse(session.completed_at));
}

function objectMetadataExact(
  data: unknown,
  bucket: string,
  path: string,
  size: number,
  mimeType: CommunityMimeType,
): boolean {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const object = data as Record<string, unknown>;
  return object.name === path
    && object.bucketId === bucket
    && object.size === size
    && normalizeCommunityMimeType(object.contentType) === mimeType;
}

function objectMetadataSize(
  data: unknown,
  bucket: string,
  path: string,
  mimeType: CommunityMimeType,
): number | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const object = data as Record<string, unknown>;
  const size = object.size;
  if (object.name !== path
      || object.bucketId !== bucket
      || normalizeCommunityMimeType(object.contentType) !== mimeType
      || typeof size !== "number"
      || !Number.isSafeInteger(size)
      || size <= 0
      || size > COMMUNITY_MEDIA_RULES[mimeType].maxBytes) {
    return null;
  }
  return size;
}

function digest(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function storageExists(
  admin: ReturnType<typeof createAdminClient>,
  bucket: string,
  path: string,
) {
  const { data, error } = await admin.storage.from(bucket).exists(path);
  if (error || typeof data !== "boolean") throw new Error("storage existence check failed");
  return data;
}

async function deleteObject(
  admin: ReturnType<typeof createAdminClient>,
  bucket: string,
  path: string,
) {
  const { error } = await admin.storage.from(bucket).remove([path]);
  return !error;
}

async function downloadExact(
  admin: ReturnType<typeof createAdminClient>,
  bucket: string,
  path: string,
  expectedSize: number,
): Promise<Buffer | null> {
  const { data, error } = await admin.storage.from(bucket).download(path);
  if (error || !data || data.size !== expectedSize) return null;
  let bytes: Buffer;
  try {
    bytes = Buffer.from(await data.arrayBuffer());
  } catch {
    return null;
  }
  return bytes.byteLength === expectedSize ? bytes : null;
}

async function readValidatedPrefix(
  session: CommunityUploadSession,
  mimeType: CommunityMimeType,
): Promise<{ ok: true } | { ok: false; code: string }> {
  let supabaseUrl: string;
  try {
    supabaseUrl = verifyRuntimeSupabaseServiceDestination().url;
  } catch {
    return { ok: false, code: "destination_validation_failed" };
  }
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) return { ok: false, code: "destination_validation_failed" };
  const encodedPath = session.staging_path.split("/").map(encodeURIComponent).join("/");
  let response: Response;
  try {
    response = await fetch(
      `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/authenticated/${COMMUNITY_STAGING_BUCKET}/${encodedPath}`,
      {
        headers: {
          Authorization: `Bearer ${serviceRoleKey}`,
          apikey: serviceRoleKey,
          Range: "bytes=0-63",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      },
    );
  } catch {
    return { ok: false, code: "range_validation_failed" };
  }

  const contentRange = response.headers.get("content-range");
  const match = contentRange?.match(/^bytes 0-(\d+)\/(\d+)$/i);
  if (response.status !== 206 || !match) return { ok: false, code: "range_validation_failed" };
  const end = Number(match[1]);
  const total = Number(match[2]);
  if (!Number.isSafeInteger(end) || end < 0 || end > 63 || total !== session.declared_size) {
    return { ok: false, code: "range_validation_failed" };
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== end + 1 || bytes.byteLength > 64) {
    return { ok: false, code: "range_validation_failed" };
  }
  return communityMediaSignatureMatches(mimeType, bytes)
    ? { ok: true }
    : { ok: false, code: "signature_mismatch" };
}

function publicResult(admin: ReturnType<typeof createAdminClient>, session: CommunityUploadSession) {
  const mimeType = normalizeCommunityMimeType(session.declared_mime_type);
  if (!mimeType) return null;
  const { data } = admin.storage.from(session.final_bucket).getPublicUrl(session.final_path);
  if (!data?.publicUrl || typeof data.publicUrl !== "string") return null;
  return { url: data.publicUrl, type: COMMUNITY_MEDIA_RULES[mimeType].type };
}

async function rejectInvalid(
  admin: ReturnType<typeof createAdminClient>,
  session: CommunityUploadSession,
  code: string,
) {
  const deleted = await deleteObject(admin, COMMUNITY_STAGING_BUCKET, session.staging_path);
  await rejectCommunityUploadSession(admin, session, code, deleted);
  return json(
    { error: "파일을 안전하게 확인할 수 없어 업로드하지 않았어요.", code: "MEDIA_VALIDATION_FAILED" },
    422,
  );
}

async function validateCompletedFinal(
  admin: ReturnType<typeof createAdminClient>,
  session: CommunityUploadSession,
  mimeType: CommunityMimeType,
) {
  const actualSize = session.actual_size;
  const expectedHash = session.content_sha256;
  if (!actualSize || !expectedHash) return false;
  const { data, error } = await admin.storage.from(session.final_bucket).info(session.final_path);
  if (error || !objectMetadataExact(
    data,
    session.final_bucket,
    session.final_path,
    actualSize,
    mimeType,
  )) return false;
  const bytes = await downloadExact(
    admin,
    session.final_bucket,
    session.final_path,
    actualSize,
  );
  if (!bytes || digest(bytes) !== expectedHash) return false;
  try {
    await validateSanitizedCommunityImage(bytes, mimeType);
    return true;
  } catch {
    return false;
  }
}

async function sanitizeRecoveryFinal(
  admin: ReturnType<typeof createAdminClient>,
  session: CommunityUploadSession,
  mimeType: CommunityMimeType,
) {
  const { data, error } = await admin.storage.from(session.final_bucket).info(session.final_path);
  if (error) return null;
  const size = objectMetadataSize(
    data,
    session.final_bucket,
    session.final_path,
    mimeType,
  );
  if (!size) return null;
  const bytes = await downloadExact(admin, session.final_bucket, session.final_path, size);
  if (!bytes) return null;
  try {
    return await sanitizeCommunityImage(bytes, mimeType);
  } catch {
    return null;
  }
}

async function publishAndVerify(
  admin: ReturnType<typeof createAdminClient>,
  session: CommunityUploadSession,
  mimeType: CommunityMimeType,
  sanitized: Awaited<ReturnType<typeof sanitizeCommunityImage>>,
) {
  const finalStorage = admin.storage.from(session.final_bucket);
  const { error: uploadError } = await finalStorage.upload(
    session.final_path,
    sanitized.bytes,
    {
      // The URL exists before the consumer transaction attaches this upload.
      // Revalidate every read so a later orphan deletion cannot leave a
      // year-long CDN copy of an abandoned public image.
      cacheControl: "0",
      contentType: mimeType,
      upsert: true,
    },
  );
  if (uploadError) return null;
  const { data, error } = await finalStorage.info(session.final_path);
  if (error || !objectMetadataExact(
    data,
    session.final_bucket,
    session.final_path,
    sanitized.bytes.byteLength,
    mimeType,
  )) return null;
  const published = await downloadExact(
    admin,
    session.final_bucket,
    session.final_path,
    sanitized.bytes.byteLength,
  );
  if (!published || digest(published) !== digest(sanitized.bytes)) return null;
  try {
    await validateSanitizedCommunityImage(published, mimeType);
  } catch {
    return null;
  }
  return { size: published.byteLength, sha256: digest(published) };
}

export async function POST(req: NextRequest) {
  if (!isTrustedMutationRequest(req)) {
    return json(
      { error: "올바르지 않은 요청 출처예요.", code: "UNTRUSTED_ORIGIN" }, 403);
  }

  const uploadId = await readUploadId(req);
  if (!uploadId) {
    return json({ error: "올바르지 않은 업로드 요청이에요.", code: "INVALID_FINALIZE_REQUEST" }, 400);
  }

  const requestClient = await createClientFromRequest(req);
  const { data: { user } } = await requestClient.auth.getUser();
  if (!user) return json({ error: "로그인이 필요해요.", code: "AUTH_REQUIRED" }, 401);

  if (!isCommunityMediaPublishingEnabled()) {
    return json(
      {
        error: "지금은 커뮤니티 이미지 발행을 사용할 수 없어요.",
        code: COMMUNITY_MEDIA_DISABLED_CODE,
      },
      503,
      { "Retry-After": "3600" },
    );
  }

  const writeAccess = await checkCommunityWriteAccess(requestClient, user.id);
  if (!writeAccess.allowed) {
    return json(
      { error: writeAccess.message, code: writeAccess.code },
      writeAccess.status,
      writeAccess.status === 503 ? { "Retry-After": "30" } : {},
    );
  }

  const finalizeGates = [
    {
      key: rateLimitKey("community:upload:finalize:burst", req, user.id),
      config: { maxRequests: 30, windowMs: 10 * 60 * 1000 },
    },
    {
      key: rateLimitKey("community:upload:finalize:daily", req, user.id),
      config: { maxRequests: 150, windowMs: 24 * 60 * 60 * 1000 },
    },
    {
      key: rateLimitKey(`community:upload:finalize:item:${uploadId}`, req, user.id),
      config: { maxRequests: 8, windowMs: 10 * 60 * 1000 },
    },
  ];
  for (const gate of finalizeGates) {
    const limited = await checkRateLimitPersistent(
      gate.key,
      gate.config,
      { failClosed: true },
    );
    if (limited) return limited;
  }

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return json({ error: "업로드 확인 서비스를 잠시 사용할 수 없어요.", code: "UPLOAD_FINALIZE_UNAVAILABLE" }, 503, { "Retry-After": "60" });
  }

  try {
    if (await hasActiveAccountDeletion(admin, user.id)) {
      return json(
        {
          error: "계정 삭제를 처리 중이라 업로드를 완료할 수 없어요.",
          code: "ACCOUNT_DELETION_PENDING",
        },
        409,
      );
    }
  } catch {
    return json(
      {
        error: "계정 삭제 상태를 안전하게 확인하지 못했어요.",
        code: "ACCOUNT_DELETION_FENCE_UNAVAILABLE",
      },
      503,
      { "Retry-After": "30" },
    );
  }

  const proposedClaim = randomUUID();
  let session: CommunityUploadSession | null;
  try {
    session = await claimCommunityUploadSession(admin, uploadId, user.id, proposedClaim);
  } catch {
    console.error("[community upload] session claim failed");
    return json({ error: "업로드 확인에 실패했어요.", code: "UPLOAD_CLAIM_FAILED" }, 503, { "Retry-After": "2" });
  }

  if (!session) return json({ error: "업로드를 찾을 수 없어요.", code: "UPLOAD_NOT_FOUND" }, 404);
  if (session.user_id !== user.id || !isSessionContractExact(session)) {
    console.error("[community upload] session contract mismatch");
    return json({ error: "업로드 상태를 확인할 수 없어요.", code: "UPLOAD_SESSION_INVALID" }, 503);
  }

  const mimeType = normalizeCommunityMimeType(session.declared_mime_type)!;
  if (session.status === "completed") {
    const valid = await validateCompletedFinal(admin, session, mimeType);
    const result = valid ? publicResult(admin, session) : null;
    return result
      ? json(result, 200)
      : json({ error: "게시 파일의 무결성을 확인할 수 없어요.", code: "UPLOAD_FINAL_INVALID" }, 503);
  }
  if (session.status === "rejected" || session.status === "expired") {
    return json({ error: "만료되었거나 거절된 업로드예요.", code: "UPLOAD_TERMINAL" }, 410);
  }
  if (Date.parse(session.expires_at) <= Date.now()) {
    if (session.status !== "issued" || session.claim_token !== null) {
      return json({ error: "업로드 만료 처리를 기다리고 있어요.", code: "UPLOAD_EXPIRY_PENDING" }, 409, { "Retry-After": "2" });
    }
    const deleted = await deleteObject(admin, COMMUNITY_STAGING_BUCKET, session.staging_path);
    const expired = await expireIssuedCommunityUploadSession(admin, session, deleted);
    return expired
      ? json({ error: "업로드 시간이 만료되었어요. 다시 선택해 주세요.", code: "UPLOAD_EXPIRED" }, 410)
      : json({ error: "업로드 만료 처리를 완료하지 못했어요.", code: "UPLOAD_EXPIRY_FAILED" }, 503, { "Retry-After": "2" });
  }

  if (session.status !== "finalizing" || session.claim_token !== proposedClaim) {
    return json({ error: "업로드를 확인 중이에요. 잠시 후 다시 시도해 주세요.", code: "UPLOAD_FINALIZING" }, 409, { "Retry-After": "2" });
  }

  let sourceExists: boolean;
  try {
    sourceExists = await storageExists(admin, COMMUNITY_STAGING_BUCKET, session.staging_path);
  } catch {
    return json({ error: "업로드 원본 상태를 확인하지 못했어요.", code: "UPLOAD_SOURCE_UNCONFIRMED" }, 503, { "Retry-After": "2" });
  }

  let sanitized: Awaited<ReturnType<typeof sanitizeCommunityImage>> | null = null;
  if (sourceExists) {
    const staging = admin.storage.from(COMMUNITY_STAGING_BUCKET);
    const { data: stagedObject, error: stagedInfoError } = await staging.info(session.staging_path);
    if (stagedInfoError || !objectMetadataExact(
      stagedObject,
      COMMUNITY_STAGING_BUCKET,
      session.staging_path,
      session.declared_size,
      mimeType,
    )) return rejectInvalid(admin, session, "metadata_mismatch");

    const prefix = await readValidatedPrefix(session, mimeType);
    if (!prefix.ok) {
      if (prefix.code === "destination_validation_failed") {
        return json(
          { error: "업로드 저장소 연결을 안전하게 확인하지 못했어요.", code: "UPLOAD_DESTINATION_UNVERIFIED" },
          503,
          { "Retry-After": "60" },
        );
      }
      return rejectInvalid(admin, session, prefix.code);
    }
    const source = await downloadExact(
      admin,
      COMMUNITY_STAGING_BUCKET,
      session.staging_path,
      session.declared_size,
    );
    if (!source) return rejectInvalid(admin, session, "full_download_failed");
    try {
      sanitized = await sanitizeCommunityImage(source, mimeType);
    } catch {
      return rejectInvalid(admin, session, "decode_failed");
    }
  } else {
    sanitized = await sanitizeRecoveryFinal(admin, session, mimeType);
    if (!sanitized) {
      return json({ error: "이전 업로드 결과의 전체 파일을 확인하지 못했어요.", code: "UPLOAD_RECOVERY_UNVERIFIED" }, 503, { "Retry-After": "2" });
    }
  }

  const published = await publishAndVerify(admin, session, mimeType, sanitized);
  if (!published) {
    return json({ error: "게시 파일의 저장 상태를 확인하지 못했어요.", code: "UPLOAD_PUBLISH_UNCONFIRMED" }, 503, { "Retry-After": "2" });
  }

  if (sourceExists) {
    const removed = await deleteObject(admin, COMMUNITY_STAGING_BUCKET, session.staging_path);
    let stillExists = true;
    try {
      stillExists = !removed
        || await storageExists(admin, COMMUNITY_STAGING_BUCKET, session.staging_path);
    } catch {
      stillExists = true;
    }
    if (stillExists) {
      return json({ error: "비공개 원본 정리를 확인하지 못했어요.", code: "UPLOAD_STAGING_CLEANUP_FAILED" }, 503, { "Retry-After": "2" });
    }
  }

  const completed = await markCommunityUploadCompleted(
    admin,
    session,
    published.size,
    mimeType,
    published.sha256,
  );
  if (!completed) {
    return json({ error: "업로드 완료 기록에 실패했어요.", code: "UPLOAD_COMPLETION_FAILED" }, 503, { "Retry-After": "2" });
  }
  const result = publicResult(admin, session);
  return result
    ? json(result, 200)
    : json({ error: "업로드 결과를 확인할 수 없어요.", code: "UPLOAD_PUBLIC_URL_FAILED" }, 503);
}
