import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { hasActiveAccountDeletion } from "@/lib/accountDeletion/communityStorageSaga";
import {
  COMMUNITY_MEDIA_RULES,
  COMMUNITY_SIGNED_UPLOAD_TTL_MS,
  COMMUNITY_STAGING_BUCKET,
  isValidCommunityMediaSize,
  normalizeCommunityMimeType,
} from "@/lib/community/uploadPolicy";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { readBoundedUtf8Text } from "@/utils/requestValidation";
import {
  COMMUNITY_WRITE_DENIED_MESSAGE,
  isCommunityActorWriteDenied,
} from "@/lib/community/actorWriteGate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_INIT_BODY_BYTES = 2 * 1024;
const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

function json(body: Record<string, unknown>, status: number, headers: HeadersInit = {}) {
  return NextResponse.json(body, {
    status,
    headers: { ...NO_STORE_HEADERS, ...headers },
  });
}

type StrictInitBodyResult =
  | { ok: true; value: { mimeType: string; size: number } }
  | { ok: false; reason: "too_large" | "invalid" };

async function readStrictInitBody(request: Request): Promise<StrictInitBodyResult> {
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase()
      !== "application/json") {
    return { ok: false, reason: "invalid" };
  }

  const bodyResult = await readBoundedUtf8Text(request, MAX_INIT_BODY_BYTES);
  if (!bodyResult.ok) {
    return {
      ok: false,
      reason: bodyResult.reason === "too_large" ? "too_large" : "invalid",
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyResult.text);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, reason: "invalid" };
  }
  const record = parsed as Record<string, unknown>;
  if (Object.keys(record).sort().join(",") !== "mimeType,size") {
    return { ok: false, reason: "invalid" };
  }
  if (typeof record.mimeType !== "string" || typeof record.size !== "number") {
    return { ok: false, reason: "invalid" };
  }
  return { ok: true, value: { mimeType: record.mimeType, size: record.size } };
}

export async function POST(req: NextRequest) {
  const requestClient = await createClientFromRequest(req);
  const {
    data: { user },
  } = await requestClient.auth.getUser();

  if (!user) {
    return json({ error: "로그인이 필요해요.", code: "AUTH_REQUIRED" }, 401);
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return json(
      {
        error: "업로드 서비스를 잠시 사용할 수 없어요.",
        code: "COMMUNITY_UPLOAD_NOT_CONFIGURED",
      },
      503,
      { "Retry-After": "60" },
    );
  }

  try {
    if (await hasActiveAccountDeletion(admin, user.id)) {
      return json(
        {
          error: "계정 삭제를 처리 중이라 새 파일을 올릴 수 없어요.",
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

  const burstLimited = await checkRateLimitPersistent(
    rateLimitKey("community:upload:burst", req, user.id),
    { maxRequests: 20, windowMs: 10 * 60 * 1000 },
    { failClosed: true },
  );
  if (burstLimited) return burstLimited;

  const dailyLimited = await checkRateLimitPersistent(
    rateLimitKey("community:upload:daily", req, user.id),
    { maxRequests: 50, windowMs: 24 * 60 * 60 * 1000 },
    { failClosed: true },
  );
  if (dailyLimited) return dailyLimited;

  const bodyResult = await readStrictInitBody(req);
  if (!bodyResult.ok) {
    return bodyResult.reason === "too_large"
      ? json({ error: "요청 본문이 너무 큽니다.", code: "REQUEST_BODY_TOO_LARGE" }, 413)
      : json(
        {
          error: "지원하는 파일 형식과 용량을 확인해 주세요.",
          code: "INVALID_MEDIA_DECLARATION",
        },
        400,
      );
  }
  const body = bodyResult.value;
  const mimeType = normalizeCommunityMimeType(body.mimeType);
  if (!mimeType || !isValidCommunityMediaSize(mimeType, body.size)) {
    return json(
      {
        error: "지원하는 파일 형식과 용량을 확인해 주세요.",
        code: "INVALID_MEDIA_DECLARATION",
      },
      400,
    );
  }

  const uploadId = randomUUID();
  const rule = COMMUNITY_MEDIA_RULES[mimeType];
  const path = `${user.id}/${uploadId}.${rule.extension}`;
  const finalPath = `v2/${randomUUID()}.${rule.extension}`;
  const expiresAt = new Date(Date.now() + COMMUNITY_SIGNED_UPLOAD_TTL_MS).toISOString();

  const { error: sessionError } = await admin
    .rpc("community_create_upload_session_for_actor", {
      p_actor_id: user.id,
      p_upload_id: uploadId,
      p_staging_path: path,
      p_final_bucket: rule.bucket,
      p_final_path: finalPath,
      p_declared_mime_type: mimeType,
      p_declared_size: body.size,
      p_expires_at: expiresAt,
    })
    .select("id")
    .single();

  if (sessionError) {
    if (isCommunityActorWriteDenied(sessionError)) {
      return json(
        { error: COMMUNITY_WRITE_DENIED_MESSAGE, code: "COMMUNITY_WRITE_DENIED" },
        403,
      );
    }
    console.error("[community upload] durable session creation failed");
    return json(
      { error: "업로드 준비에 실패했어요. 잠시 후 다시 시도해 주세요.", code: "UPLOAD_INIT_FAILED" },
      503,
      { "Retry-After": "30" },
    );
  }

  // The first check is only a fast path. Persisting the session before this
  // second check closes the race with deletion inventory: if deletion starts
  // after this check, its worker must see this durable session; if it starts
  // before this check, no signed token is issued.
  let postSessionDeletionFence: "allowed" | "blocked" | "unavailable" = "allowed";
  try {
    if (await hasActiveAccountDeletion(admin, user.id)) {
      postSessionDeletionFence = "blocked";
    }
  } catch {
    postSessionDeletionFence = "unavailable";
  }
  if (postSessionDeletionFence !== "allowed") {
    const now = new Date().toISOString();
    await admin
      .from("community_upload_sessions")
      .update({
        status: "rejected",
        rejection_code: postSessionDeletionFence === "blocked"
          ? "account_deletion_started"
          : "account_deletion_fence_unavailable",
        rejected_at: now,
        staging_deleted_at: now,
        updated_at: now,
      })
      .eq("id", uploadId);
    return postSessionDeletionFence === "blocked"
      ? json(
        {
          error: "계정 삭제를 처리 중이라 새 파일을 올릴 수 없어요.",
          code: "ACCOUNT_DELETION_PENDING",
        },
        409,
      )
      : json(
        {
          error: "계정 삭제 상태를 안전하게 확인하지 못했어요.",
          code: "ACCOUNT_DELETION_FENCE_UNAVAILABLE",
        },
        503,
        { "Retry-After": "30" },
      );
  }

  const { data: actorStillAllowed, error: actorFenceError } = await admin.rpc(
    "community_check_active_write_actor",
    { p_actor_id: user.id },
  );
  if (actorFenceError || actorStillAllowed !== true) {
    const now = new Date().toISOString();
    await admin
      .from("community_upload_sessions")
      .update({
        status: "rejected",
        rejection_code: isCommunityActorWriteDenied(actorFenceError)
          ? "actor_suspended"
          : "actor_write_fence_unavailable",
        rejected_at: now,
        staging_deleted_at: now,
        updated_at: now,
      })
      .eq("id", uploadId);

    if (isCommunityActorWriteDenied(actorFenceError)) {
      return json(
        { error: COMMUNITY_WRITE_DENIED_MESSAGE, code: "COMMUNITY_WRITE_DENIED" },
        403,
      );
    }
    return json(
      {
        error: "커뮤니티 쓰기 권한을 안전하게 확인하지 못했어요.",
        code: "COMMUNITY_WRITE_FENCE_UNAVAILABLE",
      },
      503,
      { "Retry-After": "30" },
    );
  }

  const { data: signed, error: signError } = await admin.storage
    .from(COMMUNITY_STAGING_BUCKET)
    .createSignedUploadUrl(path, { upsert: false });

  if (signError || !signed?.token) {
    await admin
      .from("community_upload_sessions")
      .update({
        status: "rejected",
        rejection_code: "signing_failed",
        rejected_at: new Date().toISOString(),
        staging_deleted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", uploadId);
    console.error("[community upload] signed upload creation failed");
    return json(
      { error: "업로드 준비에 실패했어요. 잠시 후 다시 시도해 주세요.", code: "UPLOAD_SIGNING_FAILED" },
      503,
      { "Retry-After": "30" },
    );
  }

  return json({
    uploadId,
    bucket: COMMUNITY_STAGING_BUCKET,
    path,
    token: signed.token,
    expiresAt,
  }, 201);
}
