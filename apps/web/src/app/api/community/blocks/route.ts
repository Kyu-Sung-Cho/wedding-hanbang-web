import { NextRequest, NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import {
  isBodyTooLarge,
  isRecord,
  isUuid,
  readBoundedUtf8Text,
} from "@/utils/requestValidation";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";

const MAX_BODY_BYTES = 1024;
const REASON_CATEGORIES = new Set([
  "safety",
  "harassment",
  "unwanted_contact",
  "irrelevant",
  "other",
]);
const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Authorization, Cookie, Origin, Sec-Fetch-Site",
};

type BlockRow = {
  blocked_user_id: string;
  reason_category: string | null;
  created_at: string;
};

function json(body: unknown, init?: { status?: number }) {
  return NextResponse.json(body, {
    ...init,
    headers: PRIVATE_NO_STORE_HEADERS,
  });
}

function parseBlockRows(value: unknown): BlockRow[] | null {
  if (!Array.isArray(value)) return null;
  const rows: BlockRow[] = [];
  for (const row of value) {
    if (
      !isRecord(row)
      || Object.keys(row).some(
        (key) => !["blocked_user_id", "reason_category", "created_at"].includes(key),
      )
      || !isUuid(row.blocked_user_id)
      || (
        row.reason_category !== null
        && (
          typeof row.reason_category !== "string"
          || !REASON_CATEGORIES.has(row.reason_category)
        )
      )
      || typeof row.created_at !== "string"
      || !Number.isFinite(Date.parse(row.created_at))
    ) {
      return null;
    }
    rows.push({
      blocked_user_id: row.blocked_user_id,
      reason_category: row.reason_category,
      created_at: row.created_at,
    });
  }
  return rows;
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClientFromRequest(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return json({ error: "로그인이 필요합니다." }, { status: 401 });

    const { data, error } = await supabase.rpc(
      "community_list_user_blocks" as never,
    );
    const rows = parseBlockRows(data);
    if (error || rows === null) {
      console.error("[community blocks] list failed", {
        category: error ? "rpc_error" : "invalid_receipt",
        code: error?.code ?? "invalid_receipt",
      });
      return json(
        {
          error: "차단 목록을 안전하게 확인하지 못했습니다.",
          code: "COMMUNITY_BLOCK_LIST_UNAVAILABLE",
        },
        { status: 503 },
      );
    }

    const blockedUserIds = rows.map((row) => row.blocked_user_id);
    const { data: profiles, error: profileError } = blockedUserIds.length > 0
      ? await createAdminClient()
          .from("community_public_profiles")
          .select("user_id, nickname, avatar_url, rank")
          .in("user_id", blockedUserIds)
      : { data: [], error: null };

    if (profileError) {
      console.error("[community blocks] safe profile lookup failed", {
        category: "profile_projection_error",
        code: profileError.code ?? "unknown",
      });
    }
    const profileById = new Map(
      (profiles ?? []).map((profile) => [profile.user_id as string, profile]),
    );

    return json({
      ownerId: user.id,
      blocks: rows.map((row) => ({
        ...row,
        profile: profileById.get(row.blocked_user_id) ?? null,
      })),
    });
  } catch {
    console.error("[community blocks] list unexpected", {
      category: "unexpected",
    });
    return json(
      {
        error: "차단 목록을 안전하게 확인하지 못했습니다.",
        code: "COMMUNITY_BLOCK_LIST_UNAVAILABLE",
      },
      { status: 503 },
    );
  }
}

export async function POST(request: NextRequest) {
  if (!isTrustedMutationRequest(request)) {
    return json({ error: "잘못된 요청 출처입니다." }, { status: 403 });
  }
  if (isBodyTooLarge(request, MAX_BODY_BYTES)) {
    return json({ error: "요청이 너무 큽니다." }, { status: 413 });
  }

  try {
    const supabase = await createClientFromRequest(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return json({ error: "로그인이 필요합니다." }, { status: 401 });

    const limited = await checkRateLimitPersistent(
      rateLimitKey("community:user-block:set", request, user.id),
      { maxRequests: 20, windowMs: 60 * 1000 },
    );
    if (limited) return limited;

    const bodyResult = await readBoundedUtf8Text(request, MAX_BODY_BYTES);
    if (!bodyResult.ok) {
      return json(
        { error: bodyResult.reason === "too_large" ? "요청이 너무 큽니다." : "요청을 읽을 수 없습니다." },
        { status: bodyResult.reason === "too_large" ? 413 : 400 },
      );
    }

    let body: unknown;
    try {
      body = JSON.parse(bodyResult.text) as unknown;
    } catch {
      body = null;
    }
    if (
      !isRecord(body)
      || Object.keys(body).some(
        (key) => !["blocked_user_id", "blocked", "reason_category"].includes(key),
      )
      || !isUuid(body.blocked_user_id)
      || typeof body.blocked !== "boolean"
      || body.blocked_user_id === user.id
      || (
        body.reason_category !== undefined
        && body.reason_category !== null
        && (
          typeof body.reason_category !== "string"
          || !REASON_CATEGORIES.has(body.reason_category)
        )
      )
    ) {
      return json({ error: "차단 설정을 확인해 주세요." }, { status: 400 });
    }

    const reasonCategory = body.blocked
      ? typeof body.reason_category === "string"
        ? body.reason_category
        : null
      : null;
    // The mutation can expire responder capacity and hide already-enqueued
    // notifications atomically. Keep that cross-table operation service-only,
    // while pinning the actor to the user verified from this request session.
    const { data, error } = await createAdminClient().rpc(
      "community_set_user_block" as never,
      {
        p_actor_id: user.id,
        p_blocked_user_id: body.blocked_user_id,
        p_blocked: body.blocked,
        p_reason_category: reasonCategory,
      } as never,
    );

    if (error) {
      console.error("[community blocks] set failed:", {
        category: "rpc_error",
        code: error.code,
      });
      const status = error.code === "22023" ? 400 : error.code === "42501" ? 403 : 503;
      return json(
        {
          error: status === 400
            ? "차단 설정을 확인해 주세요."
            : "차단 설정을 안전하게 저장하지 못했습니다.",
          code: status === 503
            ? "COMMUNITY_BLOCK_WRITE_UNAVAILABLE"
            : "COMMUNITY_BLOCK_WRITE_REJECTED",
        },
        { status },
      );
    }

    if (
      !isRecord(data)
      || data.ok !== true
      || data.blocked_user_id !== body.blocked_user_id
      || data.blocked !== body.blocked
      || typeof data.changed !== "boolean"
    ) {
      return json(
        {
          error: "차단 설정 결과를 확인하지 못해 완료로 처리하지 않았습니다.",
          code: "COMMUNITY_BLOCK_INVALID_RECEIPT",
        },
        { status: 503 },
      );
    }

    return json({
      ok: true,
      blocked_user_id: data.blocked_user_id,
      blocked: data.blocked,
      changed: data.changed,
    });
  } catch {
    console.error("[community blocks] set unexpected", {
      category: "unexpected",
    });
    return json(
      {
        error: "차단 설정을 안전하게 저장하지 못했습니다.",
        code: "COMMUNITY_BLOCK_WRITE_UNAVAILABLE",
      },
      { status: 503 },
    );
  }
}
