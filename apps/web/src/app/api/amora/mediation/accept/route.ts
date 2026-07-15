import { NextResponse } from "next/server";
import { createClientFromRequest } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isBodyTooLarge } from "@/utils/requestValidation";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 2 * 1024;

async function context(request: Request, messageId: string) {
  const supabase = await createClientFromRequest(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 }) };
  const { data: profile } = await supabase
    .from("profiles").select("couple_id").eq("id", user.id).single();
  if (!profile?.couple_id) return { error: NextResponse.json({ error: "커플 연결이 필요합니다." }, { status: 403 }) };
  const { data: message, error } = await supabase
    .from("chat_messages")
    .select("id, metadata, sender_type, role, visibility")
    .eq("id", messageId)
    .eq("couple_id", profile.couple_id)
    .maybeSingle();
  const mediation = (message?.metadata as { mediation?: { resolution?: unknown } } | null)?.mediation;
  if (
    error || !message || message.sender_type !== "ai" || message.role !== "assistant"
    || message.visibility !== "shared" || typeof mediation?.resolution !== "string"
    || mediation.resolution.trim().length === 0 || mediation.resolution.length > 500
  ) {
    return { error: NextResponse.json({ error: "중재안을 찾을 수 없습니다." }, { status: 404 }) };
  }
  return { user, coupleId: profile.couple_id as string, resolution: mediation.resolution.trim() };
}

export async function GET(request: Request) {
  const messageId = new URL(request.url).searchParams.get("messageId");
  if (!messageId || !UUID_PATTERN.test(messageId)) {
    return NextResponse.json({ error: "메시지 식별자가 올바르지 않습니다." }, { status: 400 });
  }
  const auth = await context(request, messageId);
  if ("error" in auth) return auth.error;
  const admin = createAdminClient();
  const [{ data: couple }, { data: acceptances, error }] = await Promise.all([
    admin.from("couples").select("bride_id, groom_id").eq("id", auth.coupleId).single(),
    admin.from("amora_mediation_acceptances").select("user_id").eq("couple_id", auth.coupleId).eq("message_id", messageId),
  ]);
  if (error || !couple) return NextResponse.json({ error: "동의 상태를 확인하지 못했어요." }, { status: 503 });
  const members = [...new Set(
    [couple.bride_id, couple.groom_id].filter((value): value is string => typeof value === "string"),
  )];
  const acceptedIds = new Set((acceptances ?? []).map((item) => item.user_id));
  return NextResponse.json({
    accepted: acceptedIds.has(auth.user.id),
    acceptedCount: members.filter((id) => acceptedIds.has(id)).length,
    requiredCount: members.length,
    completed: members.length > 0 && members.every((id) => acceptedIds.has(id)),
  }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  if (isBodyTooLarge(request, MAX_BODY_BYTES)) {
    return NextResponse.json({ error: "요청 데이터가 너무 큽니다." }, { status: 413 });
  }
  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }
  const messageId = (body as { messageId?: unknown }).messageId;
  if (typeof messageId !== "string" || !UUID_PATTERN.test(messageId)) {
    return NextResponse.json({ error: "메시지 식별자가 올바르지 않습니다." }, { status: 400 });
  }
  const auth = await context(request, messageId);
  if ("error" in auth) return auth.error;
  const limited = checkRateLimit(rateLimitKey("amora:mediation", request, auth.user.id), {
    maxRequests: 20,
    windowMs: 60 * 1000,
  });
  if (limited) return limited;
  const admin = createAdminClient();
  const title = `함께 확인한 합의 · ${auth.resolution.slice(0, 56)}`;
  const { data, error } = await admin.rpc("accept_amora_mediation", {
    p_couple_id: auth.coupleId,
    p_message_id: messageId,
    p_user_id: auth.user.id,
    p_title: title,
    p_resolution: auth.resolution,
  });
  if (error) {
    console.error("[amora-mediation] acceptance failed", error.code ?? "unknown");
    return NextResponse.json({ error: "동의를 저장하지 못했어요." }, { status: 503 });
  }
  const result = data as { accepted_count?: unknown; required_count?: unknown; completed?: unknown } | null;
  if (
    !result
    || typeof result.accepted_count !== "number"
    || !Number.isInteger(result.accepted_count)
    || typeof result.required_count !== "number"
    || !Number.isInteger(result.required_count)
    || typeof result.completed !== "boolean"
  ) {
    console.error("[amora-mediation] invalid acceptance result");
    return NextResponse.json({ error: "동의 상태를 확인하지 못했어요." }, { status: 503 });
  }
  return NextResponse.json({
    accepted: true,
    acceptedCount: result.accepted_count,
    requiredCount: result.required_count,
    completed: result.completed,
  });
}
