import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { isRecord, readBoundedUtf8Text } from "@/utils/requestValidation";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";

const BUCKET = "chat-image";
const MAX_PATHS = 5;
const MAX_BODY_BYTES = 2 * 1024;
const MAX_UPLOAD_AGE_MS = 15 * 60 * 1000;
const MAX_FUTURE_CLOCK_SKEW_MS = 2 * 60 * 1000;
const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CANONICAL_FILE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|png|gif|webp)$/;
const BODY_KEYS = new Set(["coupleId", "expectedActorUserId", "paths"]);
const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
} as const;

type CleanupRequest = {
  coupleId: string;
  expectedActorUserId: string;
  paths: string[];
};

type AdminClient = ReturnType<typeof createAdminClient>;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: PRIVATE_NO_STORE_HEADERS });
}

function isMissingStorageObject(error: unknown): boolean {
  if (!isRecord(error)) return false;
  const status = String(error.statusCode ?? error.status ?? "");
  const detail = `${String(error.error ?? "")} ${String(error.message ?? "")}`
    .toLowerCase();
  return status === "404" || detail.includes("not found");
}

function parseBody(value: unknown): CleanupRequest | null {
  if (
    !isRecord(value)
    || Object.keys(value).length !== BODY_KEYS.size
    || Object.keys(value).some((key) => !BODY_KEYS.has(key))
    || typeof value.coupleId !== "string"
    || !CANONICAL_UUID_PATTERN.test(value.coupleId)
    || typeof value.expectedActorUserId !== "string"
    || !CANONICAL_UUID_PATTERN.test(value.expectedActorUserId)
    || !Array.isArray(value.paths)
    || value.paths.length < 1
    || value.paths.length > MAX_PATHS
  ) {
    return null;
  }

  const prefix = `${value.coupleId}/${value.expectedActorUserId}/`;
  const paths: string[] = [];
  for (const path of value.paths) {
    if (
      typeof path !== "string"
      || path.length > 512
      || !path.startsWith(prefix)
      || !CANONICAL_FILE_PATTERN.test(path.slice(prefix.length))
      || path.split("/").length !== 3
      || path.includes("%")
      || path.includes("\\")
      || path.includes("?")
      || path.includes("#")
      || /[\u0000-\u001f\u007f]/u.test(path)
      || paths.includes(path)
    ) {
      return null;
    }
    paths.push(path);
  }

  return {
    coupleId: value.coupleId,
    expectedActorUserId: value.expectedActorUserId,
    paths,
  };
}

async function findBoundPath(admin: AdminClient, paths: string[]) {
  for (const path of paths) {
    const { data, error } = await admin
      .from("chat_messages")
      .select("id")
      .contains("metadata", { imagePaths: [path] })
      .limit(1)
      .maybeSingle();
    if (error) return { ok: false as const, path: null };
    if (data) return { ok: true as const, path };
  }
  return { ok: true as const, path: null };
}

function isFreshUpload(createdAt: unknown, now: number): boolean {
  if (typeof createdAt !== "string") return false;
  const createdAtMs = Date.parse(createdAt);
  if (!Number.isFinite(createdAtMs)) return false;
  const age = now - createdAtMs;
  return age >= -MAX_FUTURE_CLOCK_SKEW_MS && age <= MAX_UPLOAD_AGE_MS;
}

export async function POST(request: Request) {
  try {
    if (!isTrustedMutationRequest(request)) {
      return json({ error: "신뢰할 수 없는 요청입니다.", code: "UNTRUSTED_REQUEST" }, 403);
    }

    const bodyText = await readBoundedUtf8Text(request, MAX_BODY_BYTES);
    if (!bodyText.ok) {
      return json(
        {
          error: bodyText.reason === "too_large"
            ? "요청 데이터가 너무 큽니다."
            : "요청을 읽을 수 없습니다.",
          code: bodyText.reason === "too_large" ? "BODY_TOO_LARGE" : "INVALID_BODY",
        },
        bodyText.reason === "too_large" ? 413 : 400,
      );
    }

    const rawBody: unknown = (() => {
      try {
        return JSON.parse(bodyText.text) as unknown;
      } catch {
        return null;
      }
    })();
    const body = parseBody(rawBody);
    if (!body) {
      return json({ error: "올바른 정리 요청이 아닙니다.", code: "INVALID_CLEANUP_REQUEST" }, 400);
    }

    const authClient = await createClientFromRequest(request);
    const {
      data: { user },
    } = await authClient.auth.getUser();
    if (!user) {
      return json({ error: "인증이 필요합니다.", code: "AUTH_REQUIRED" }, 401);
    }
    if (user.id !== body.expectedActorUserId) {
      return json({ error: "현재 사용자와 업로드 사용자가 다릅니다.", code: "ACTOR_CHANGED" }, 403);
    }

    const limited = await checkRateLimitPersistent(
      rateLimitKey("chat:image-cleanup", request, user.id),
      { maxRequests: 30, windowMs: 10 * 60 * 1000, cost: body.paths.length },
    );
    if (limited) return limited;

    const admin = createAdminClient();
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("id, couple_id, role")
      .eq("id", user.id)
      .maybeSingle();
    if (profileError || !profile) {
      return json({ error: "현재 커플 정보를 확인할 수 없습니다.", code: "PROFILE_UNAVAILABLE" }, 409);
    }
    if (profile.couple_id !== body.coupleId) {
      return json({ error: "현재 커플과 업로드 커플이 다릅니다.", code: "COUPLE_CHANGED" }, 403);
    }

    const { data: couple, error: coupleError } = await admin
      .from("couples")
      .select("id, bride_id, groom_id")
      .eq("id", body.coupleId)
      .maybeSingle();
    const occupiesExpectedSlot =
      (profile.role === "bride" && couple?.bride_id === user.id)
      || (profile.role === "groom" && couple?.groom_id === user.id);
    if (coupleError || !couple || !occupiesExpectedSlot) {
      return json({ error: "현재 커플 멤버십을 확인할 수 없습니다.", code: "COUPLE_MEMBERSHIP_CHANGED" }, 403);
    }

    const firstBindingCheck = await findBoundPath(admin, body.paths);
    if (!firstBindingCheck.ok) {
      return json({ error: "첨부 결속 상태를 확인할 수 없습니다.", code: "BINDING_CHECK_UNAVAILABLE" }, 503);
    }
    if (firstBindingCheck.path) {
      return json({ error: "메시지에 결속된 첨부는 삭제할 수 없습니다.", code: "ATTACHMENT_ALREADY_BOUND" }, 409);
    }

    const storage = admin.storage.from(BUCKET);
    const alreadyAbsent: string[] = [];
    const existing: string[] = [];
    const now = Date.now();
    for (const path of body.paths) {
      const { data, error } = await storage.info(path);
      if (error) {
        if (isMissingStorageObject(error)) {
          alreadyAbsent.push(path);
          continue;
        }
        return json({ error: "업로드 상태를 확인할 수 없습니다.", code: "STORAGE_CHECK_UNAVAILABLE" }, 503);
      }
      if (!data || !isFreshUpload(data.createdAt, now)) {
        return json({ error: "새 업로드만 정리할 수 있습니다.", code: "UPLOAD_NOT_FRESH" }, 409);
      }
      existing.push(path);
    }

    if (existing.length > 0) {
      // Recheck immediately before the irreversible Storage call so an ingest
      // that bound the object while metadata was inspected wins over cleanup.
      const finalBindingCheck = await findBoundPath(admin, existing);
      if (!finalBindingCheck.ok) {
        return json({ error: "첨부 결속 상태를 다시 확인할 수 없습니다.", code: "BINDING_CHECK_UNAVAILABLE" }, 503);
      }
      if (finalBindingCheck.path) {
        return json({ error: "메시지에 결속된 첨부는 삭제할 수 없습니다.", code: "ATTACHMENT_ALREADY_BOUND" }, 409);
      }

      const { error: removeError } = await storage.remove(existing);
      if (removeError) {
        return json({ error: "업로드를 정리하지 못했습니다.", code: "STORAGE_DELETE_FAILED" }, 503);
      }
    }

    return json({ deleted: existing, alreadyAbsent });
  } catch (error) {
    console.error(
      "[chat image-cleanup] unexpected failure",
      error instanceof Error ? error.name : "unknown",
    );
    return json({ error: "업로드를 정리하지 못했습니다.", code: "CLEANUP_FAILED" }, 500);
  }
}
