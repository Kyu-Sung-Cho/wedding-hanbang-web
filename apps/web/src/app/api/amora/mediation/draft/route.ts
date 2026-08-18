import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { isBodyTooLarge } from "@/utils/requestValidation";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 2 * 1024;

type DraftContext = {
  userId: string;
  coupleId: string;
};

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

async function parseContext(request: Request): Promise<DraftContext | NextResponse> {
  const supabase = await createClientFromRequest(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return json({ error: "인증이 필요합니다." }, 401);
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("couple_id")
    .eq("id", user.id)
    .single();
  if (error || typeof profile?.couple_id !== "string") {
    return json({ error: "커플 연결이 필요합니다." }, 403);
  }
  const limited = checkRateLimit(rateLimitKey("amora:mediation-draft", request, user.id), {
    maxRequests: 20,
    windowMs: 60 * 1000,
  });
  if (limited) return limited;
  return { userId: user.id, coupleId: profile.couple_id };
}

async function parseMessageId(request: Request): Promise<string | NextResponse> {
  if (!isTrustedMutationRequest(request)) {
    return json({ error: "잘못된 요청 출처입니다." }, 403);
  }
  if (isBodyTooLarge(request, MAX_BODY_BYTES)) {
    return json({ error: "요청 데이터가 너무 큽니다." }, 413);
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "요청 형식이 올바르지 않습니다." }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: "요청 형식이 올바르지 않습니다." }, 400);
  }
  const keys = Object.keys(body);
  const messageId = (body as Record<string, unknown>).messageId;
  if (
    keys.length !== 1
    || keys[0] !== "messageId"
    || typeof messageId !== "string"
    || !UUID_PATTERN.test(messageId)
  ) {
    return json({ error: "초안 식별자가 올바르지 않습니다." }, 400);
  }
  return messageId.toLowerCase();
}

function rpcFailure(error: { code?: string; message?: string }, action: "share" | "discard") {
  const failure = `${error.code ?? ""} ${error.message ?? ""}`;
  console.error("[amora-mediation-draft] mutation failed", {
    action,
    code: error.code ?? "unknown",
  });
  if (failure.includes("AMORA_MEDIATION_DRAFT_ROSTER_CHANGED")) {
    return json({ error: "함께 준비하는 구성이 바뀌어 이 초안은 보낼 수 없어요." }, 409);
  }
  if (failure.includes("AMORA_MEDIATION_DRAFT_NOT_FOUND")) {
    return json({ error: "조율 초안을 찾을 수 없어요." }, 404);
  }
  if (
    failure.includes("AMORA_MEDIATION_DRAFT_NOT_SENDABLE")
    || failure.includes("AMORA_MEDIATION_DRAFT_NOT_DISCARDABLE")
    || failure.includes("AMORA_MEDIATION_SCOPE_INVALID")
  ) {
    return json({
      error: action === "share"
        ? "이 초안은 현재 함께 보낼 수 없어요."
        : "이미 보낸 초안은 여기서 버릴 수 없어요.",
    }, 409);
  }
  return json({
    error: action === "share"
      ? "초안을 함께 보내지 못했어요."
      : "초안을 버리지 못했어요.",
  }, 503);
}

export async function POST(request: Request) {
  const messageId = await parseMessageId(request);
  if (messageId instanceof NextResponse) return messageId;
  const context = await parseContext(request);
  if (context instanceof NextResponse) return context;
  const { data, error } = await createAdminClient().rpc("share_amora_mediation_draft", {
    p_draft_message_id: messageId,
    p_user_id: context.userId,
    p_accept: true,
  });
  if (error) return rpcFailure(error, "share");
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return json({ error: "초안을 함께 보내지 못했어요." }, 503);
  }
  const result = data as Record<string, unknown>;
  if (
    typeof result.shared_message_id !== "string"
    || !UUID_PATTERN.test(result.shared_message_id)
    || typeof result.reused !== "boolean"
  ) {
    return json({ error: "초안을 함께 보내지 못했어요." }, 503);
  }
  return json({
    sharedMessageId: result.shared_message_id.toLowerCase(),
    reused: result.reused,
  });
}

export async function DELETE(request: Request) {
  const messageId = await parseMessageId(request);
  if (messageId instanceof NextResponse) return messageId;
  const context = await parseContext(request);
  if (context instanceof NextResponse) return context;
  const { data, error } = await createAdminClient().rpc("discard_amora_mediation_draft", {
    p_draft_message_id: messageId,
    p_user_id: context.userId,
  });
  if (error) return rpcFailure(error, "discard");
  if (typeof data !== "boolean") {
    return json({ error: "초안을 버리지 못했어요." }, 503);
  }
  return json({ discarded: data });
}
