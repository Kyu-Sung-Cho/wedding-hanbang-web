import { NextResponse } from "next/server";
import { createClientFromRequest } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { readUserRequestedMediationV2 } from "@/lib/ai/mediation";
import {
  computeCoupleRosterFingerprint,
  ROSTER_FINGERPRINT_PATTERN,
} from "@/lib/amora/coupleRosterFingerprint";
import { isBodyTooLarge } from "@/utils/requestValidation";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MUTATION_KEYS = new Set([
  "messageId",
  "expectedProposalVersion",
  "expectedRosterFingerprint",
]);
const MAX_BODY_BYTES = 2 * 1024;

type ExpectedProposal = {
  proposalVersion: string;
  rosterFingerprint: string;
};

type MediationContext = {
  user: { id: string };
  coupleId: string;
  resolution: string;
  proposalVersion: string | null;
  proposalRosterFingerprint: string | null;
};

type MediationContextResult = MediationContext | { error: NextResponse };

function expectedProposal(
  proposalVersion: unknown,
  proposalRosterFingerprint: unknown,
): ExpectedProposal | null {
  if (
    typeof proposalVersion !== "string"
    || !UUID_PATTERN.test(proposalVersion)
    || typeof proposalRosterFingerprint !== "string"
    || !ROSTER_FINGERPRINT_PATTERN.test(proposalRosterFingerprint)
  ) {
    return null;
  }
  return {
    proposalVersion: proposalVersion.toLowerCase(),
    rosterFingerprint: proposalRosterFingerprint,
  };
}

function proposalMatches(
  current: { proposalVersion: string | null; proposalRosterFingerprint: string | null },
  expected: ExpectedProposal,
): boolean {
  return current.proposalVersion === expected.proposalVersion
    && current.proposalRosterFingerprint === expected.rosterFingerprint;
}

function proposalChangedResponse() {
  return NextResponse.json(
    { error: "선택안이 바뀌었어요. 최신 내용을 다시 확인해 주세요." },
    { status: 409 },
  );
}

async function context(request: Request, messageId: string): Promise<MediationContextResult> {
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
  const rawMediation = (message?.metadata as {
    mediation?: Record<string, unknown>;
  } | null)?.mediation;
  const mediation = readUserRequestedMediationV2(rawMediation);
  if (
    error || !message || message.sender_type !== "ai" || message.role !== "assistant"
    || message.visibility !== "shared" || !mediation
  ) {
    return { error: NextResponse.json({ error: "중재안을 찾을 수 없습니다." }, { status: 404 }) };
  }
  return {
    user,
    coupleId: profile.couple_id as string,
    resolution: mediation.resolution.trim(),
    proposalVersion: typeof rawMediation?.proposalVersion === "string"
      && UUID_PATTERN.test(rawMediation.proposalVersion)
      ? rawMediation.proposalVersion.toLowerCase()
      : null,
    proposalRosterFingerprint: typeof rawMediation?.rosterFingerprint === "string"
      && ROSTER_FINGERPRINT_PATTERN.test(rawMediation.rosterFingerprint)
      ? rawMediation.rosterFingerprint
      : null,
  };
}

export async function GET(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const messageId = searchParams.get("messageId");
  if (!messageId || !UUID_PATTERN.test(messageId)) {
    return NextResponse.json({ error: "메시지 식별자가 올바르지 않습니다." }, { status: 400 });
  }
  const expected = expectedProposal(
    searchParams.get("expectedProposalVersion"),
    searchParams.get("expectedRosterFingerprint"),
  );
  if (!expected) {
    return NextResponse.json({ error: "선택안 버전이 올바르지 않습니다." }, { status: 400 });
  }
  const auth = await context(request, messageId);
  if ("error" in auth) return auth.error;
  if (!proposalMatches(auth, expected)) return proposalChangedResponse();
  const admin = createAdminClient();
  const [{ data: couple }, { data: acceptances, error }, { data: decisions, error: decisionError }] = await Promise.all([
    admin.from("couples").select("bride_id, groom_id").eq("id", auth.coupleId).single(),
    admin.from("amora_mediation_acceptances")
      .select("user_id, proposal_resolution, proposal_version, proposal_roster_fingerprint")
      .eq("couple_id", auth.coupleId)
      .eq("message_id", messageId),
    admin.from("decision_nodes")
      .select("id, chosen_value, metadata")
      .eq("couple_id", auth.coupleId)
      .eq("category", "conflict_resolution")
      .eq("source", "chat")
      .eq("source_ref_id", messageId),
  ]);
  if (error || decisionError || !couple) {
    return NextResponse.json({ error: "확인 상태를 불러오지 못했어요." }, { status: 503 });
  }
  const members = [...new Set(
    [couple.bride_id, couple.groom_id].filter((value): value is string => typeof value === "string"),
  )];
  const currentRosterFingerprint = computeCoupleRosterFingerprint(
    couple.bride_id,
    couple.groom_id,
  );
  if (auth.proposalRosterFingerprint !== currentRosterFingerprint) {
    return proposalChangedResponse();
  }
  const proposalIsCurrent = auth.proposalVersion !== null
    && auth.proposalRosterFingerprint === currentRosterFingerprint;
  const acceptedIds = new Set(
    (acceptances ?? [])
      .filter((item) => proposalIsCurrent
        && item.proposal_resolution === auth.resolution
        && item.proposal_version?.toLowerCase() === auth.proposalVersion
        && item.proposal_roster_fingerprint === currentRosterFingerprint)
      .map((item) => item.user_id),
  );
  const acceptedCount = members.filter((id) => acceptedIds.has(id)).length;
  const unanimous = members.length === 2 && acceptedCount === 2;
  const completed = (decisions ?? []).some((decision) => {
    const decisionMetadata = decision.metadata as {
      proposal_version?: unknown;
      roster_fingerprint?: unknown;
    } | null;
    return proposalIsCurrent
      && (decision.chosen_value as { value?: unknown } | null)?.value === auth.resolution
      && decisionMetadata?.proposal_version === auth.proposalVersion
      && decisionMetadata.roster_fingerprint === currentRosterFingerprint;
  });
  return NextResponse.json({
    // If all acceptance rows exist but the durable decision is missing, allow
    // an idempotent retry instead of trapping both clients in a false success.
    accepted: acceptedIds.has(auth.user.id) && (!unanimous || completed),
    acceptedCount,
    requiredCount: 2,
    partnerLinked: members.length === 2,
    completed,
  }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  if (!isTrustedMutationRequest(request)) {
    return NextResponse.json({ error: "잘못된 요청 출처입니다." }, { status: 403 });
  }
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
  const record = body as Record<string, unknown>;
  if (Object.keys(record).some((key) => !MUTATION_KEYS.has(key))) {
    return NextResponse.json({ error: "허용되지 않은 항목이 있습니다." }, { status: 400 });
  }
  const messageId = record.messageId;
  if (typeof messageId !== "string" || !UUID_PATTERN.test(messageId)) {
    return NextResponse.json({ error: "메시지 식별자가 올바르지 않습니다." }, { status: 400 });
  }
  const expected = expectedProposal(record.expectedProposalVersion, record.expectedRosterFingerprint);
  if (!expected) {
    return NextResponse.json({ error: "선택안 버전이 올바르지 않습니다." }, { status: 400 });
  }
  const auth = await context(request, messageId);
  if ("error" in auth) return auth.error;
  if (!proposalMatches(auth, expected)) return proposalChangedResponse();
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
    p_expected_proposal_version: expected.proposalVersion,
    p_expected_roster_fingerprint: expected.rosterFingerprint,
  });
  if (error) {
    console.error("[amora-mediation] acceptance failed", error.code ?? "unknown");
    const failure = `${error.code ?? ""} ${error.message ?? ""}`;
    if (failure.includes("AMORA_MEDIATION_PARTNER_REQUIRED")) {
      return NextResponse.json({ error: "파트너가 연결된 뒤 두 분이 각각 확인할 수 있어요." }, { status: 409 });
    }
    if (failure.includes("AMORA_MEDIATION_PROPOSAL_CHANGED")) {
      return NextResponse.json({ error: "선택안이 바뀌었어요. 최신 내용을 다시 확인해 주세요." }, { status: 409 });
    }
    return NextResponse.json({ error: "확인을 저장하지 못했어요." }, { status: 503 });
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
    return NextResponse.json({ error: "확인 상태를 불러오지 못했어요." }, { status: 503 });
  }
  return NextResponse.json({
    accepted: true,
    acceptedCount: result.accepted_count,
    requiredCount: result.required_count,
    partnerLinked: true,
    completed: result.completed,
  });
}

export async function DELETE(request: Request) {
  if (!isTrustedMutationRequest(request)) {
    return NextResponse.json({ error: "잘못된 요청 출처입니다." }, { status: 403 });
  }
  if (isBodyTooLarge(request, MAX_BODY_BYTES)) {
    return NextResponse.json({ error: "요청 데이터가 너무 커요." }, { status: 413 });
  }
  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }
  const record = body as Record<string, unknown>;
  if (Object.keys(record).some((key) => !MUTATION_KEYS.has(key))) {
    return NextResponse.json({ error: "허용되지 않은 항목이 있습니다." }, { status: 400 });
  }
  const messageId = record.messageId;
  if (typeof messageId !== "string" || !UUID_PATTERN.test(messageId)) {
    return NextResponse.json({ error: "메시지 식별자가 올바르지 않습니다." }, { status: 400 });
  }
  const expected = expectedProposal(record.expectedProposalVersion, record.expectedRosterFingerprint);
  if (!expected) {
    return NextResponse.json({ error: "선택안 버전이 올바르지 않습니다." }, { status: 400 });
  }
  const auth = await context(request, messageId);
  if ("error" in auth) return auth.error;
  if (!proposalMatches(auth, expected)) return proposalChangedResponse();
  const limited = checkRateLimit(rateLimitKey("amora:mediation-revoke", request, auth.user.id), {
    maxRequests: 20,
    windowMs: 60 * 1000,
  });
  if (limited) return limited;

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("revoke_amora_mediation_acceptance", {
    p_couple_id: auth.coupleId,
    p_message_id: messageId,
    p_user_id: auth.user.id,
  });
  if (error) {
    console.error("[amora-mediation] revocation failed", error.code ?? "unknown");
    const failure = `${error.code ?? ""} ${error.message ?? ""}`;
    if (failure.includes("AMORA_MEDIATION_ALREADY_COMPLETED")) {
      return NextResponse.json({ error: "두 분의 확인이 끝나 공동 결정으로 저장되어 취소할 수 없어요." }, { status: 409 });
    }
    return NextResponse.json({ error: "내 확인을 취소하지 못했어요." }, { status: 503 });
  }
  const result = data as {
    revoked?: unknown;
    accepted_count?: unknown;
    required_count?: unknown;
    completed?: unknown;
  } | null;
  if (
    !result
    || typeof result.revoked !== "boolean"
    || typeof result.accepted_count !== "number"
    || !Number.isInteger(result.accepted_count)
    || typeof result.required_count !== "number"
    || !Number.isInteger(result.required_count)
    || result.completed !== false
  ) {
    console.error("[amora-mediation] invalid revocation result");
    return NextResponse.json({ error: "확인 상태를 확인하지 못했어요." }, { status: 503 });
  }
  return NextResponse.json({
    accepted: false,
    acceptedCount: result.accepted_count,
    requiredCount: result.required_count,
    completed: false,
  });
}
