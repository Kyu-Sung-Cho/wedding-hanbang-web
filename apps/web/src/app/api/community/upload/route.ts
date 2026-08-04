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
import { checkCommunityWriteAccess } from "@/lib/community/writeAccess";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";
import {
  COMMUNITY_MEDIA_DISABLED_CODE,
  isCommunityMediaPublishingEnabled,
} from "@/lib/community/mediaPublishingGate";

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

async function readStrictInitBody(request: Request): Promise<{
  mimeType: string;
  size: number;
} | null> {
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase()
      !== "application/json") {
    return null;
  }

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_INIT_BODY_BYTES) return null;

  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_INIT_BODY_BYTES) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  if (Object.keys(record).sort().join(",") !== "mimeType,size") return null;
  if (typeof record.mimeType !== "string" || typeof record.size !== "number") return null;
  return { mimeType: record.mimeType, size: record.size };
}

export async function POST(req: NextRequest) {
  if (!isTrustedMutationRequest(req)) {
    return json(
      { error: "올바르지 않은 요청 출처예요.", code: "UNTRUSTED_ORIGIN" }, 403);
  }

  const requestClient = await createClientFromRequest(req);
  const {
    data: { user },
  } = await requestClient.auth.getUser();

  if (!user) {
    return json({ error: "로그인이 필요해요.", code: "AUTH_REQUIRED" }, 401);
  }

  if (!isCommunityMediaPublishingEnabled()) {
    return json(
      {
        error: "통제 베타에서는 커뮤니티 이미지 업로드를 아직 사용할 수 없어요.",
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

  const body = await readStrictInitBody(req);
  const mimeType = normalizeCommunityMimeType(body?.mimeType);
  if (!body || !mimeType || !isValidCommunityMediaSize(mimeType, body.size)) {
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
  const expiresAt = new Date(Date.now() + COMMUNITY_SIGNED_UPLOAD_TTL_MS).toISOString();

  const { error: sessionError } = await admin
    .from("community_upload_sessions")
    .insert({
      id: uploadId,
      user_id: user.id,
      staging_path: path,
      final_bucket: rule.bucket,
      final_path: path,
      declared_mime_type: mimeType,
      declared_size: body.size,
      status: "issued",
      expires_at: expiresAt,
    })
    .select("id")
    .single();

  if (sessionError) {
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
