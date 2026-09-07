import { NextResponse } from "next/server";
import { parseMediationResponseState } from "@hanbang/shared/mediation-responses";
import { createClientFromRequest } from "@/lib/supabase/server";
import { mobileBridgeJson } from "@/lib/mobile/boundedJsonResponse";
import { isBodyTooLarge, isRecord, readBoundedUtf8Text } from "@/utils/requestValidation";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE_KEYS = ["messageId", "expectedOwnerId", "expectedProposalVersion", "expectedRosterFingerprint"];
const HEADERS = { "Cache-Control": "private, no-store, max-age=0", Vary: "Origin, Sec-Fetch-Site, Authorization" };
const json = (value: unknown, status = 200) => mobileBridgeJson(value, { status, headers: HEADERS });
const unavailable = () => json({ error: "응답 상태를 확인하지 못했어요. 잠시 후 다시 시도해 주세요." }, 503);
const invalid = () => json({ error: "응답 내용을 다시 확인해 주세요." }, 400);

async function context(request: Request) {
  const client = await createClientFromRequest(request);
  const { data: { user }, error } = await client.auth.getUser();
  if (error && (!error.status || error.status >= 500)) return unavailable();
  if (!user) return json({ error: "로그인이 필요합니다." }, 401);
  const profile = await client.from("profiles").select("couple_id").eq("id", user.id).maybeSingle();
  if (profile.error) return unavailable();
  if (typeof profile.data?.couple_id !== "string") return json({ error: "현재 커플 연결을 확인해 주세요." }, 403);
  return { client, ownerId: user.id, coupleId: profile.data.couple_id as string };
}

function expected(value: Record<string, unknown>) {
  if (typeof value.messageId !== "string" || !UUID.test(value.messageId)
    || typeof value.expectedOwnerId !== "string" || !UUID.test(value.expectedOwnerId)
    || typeof value.expectedProposalVersion !== "string" || !UUID.test(value.expectedProposalVersion)
    || typeof value.expectedRosterFingerprint !== "string" || !/^[a-f0-9]{32}$/.test(value.expectedRosterFingerprint)) return null;
  return {
    messageId: value.messageId.toLowerCase(), expectedOwnerId: value.expectedOwnerId.toLowerCase(),
    expectedProposalVersion: value.expectedProposalVersion.toLowerCase(), expectedRosterFingerprint: value.expectedRosterFingerprint,
  };
}

function failure(error: { code?: string; message?: string }) {
  if (error.code === "42501") return json({ error: "계정 또는 커플 연결이 바뀌었어요. 화면을 다시 열어 주세요." }, 403);
  if (error.code === "40001") return json({ code: "AMORA_MEDIATION_RESPONSE_CHANGED", error: "다른 화면에서 응답이 바뀌었어요. 최신 상태를 확인한 뒤 다시 선택해 주세요." }, 409);
  if (error.code === "55000") {
    const completed = error.message?.includes("AMORA_MEDIATION_ALREADY_COMPLETED");
    return json({ code: completed ? "AMORA_MEDIATION_ALREADY_COMPLETED" : "AMORA_MEDIATION_PROPOSAL_CHANGED",
      error: completed ? "이미 두 분이 확정한 내용이에요. 변경하려면 새로운 조율안을 만들어 주세요." : "선택안 또는 커플 연결이 바뀌었어요. 최신 내용을 다시 확인해 주세요." }, 409);
  }
  if (error.code === "22023") return invalid();
  return unavailable();
}

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some(key => !BASE_KEYS.includes(key) || params.getAll(key).length !== 1)) return invalid();
    const scope = expected(Object.fromEntries(params)); if (!scope) return invalid();
    const auth = await context(request); if (auth instanceof NextResponse) return auth;
    if (scope.expectedOwnerId !== auth.ownerId) return json({ error: "로그인 계정이 바뀌었어요." }, 403);
    const { data, error } = await auth.client.rpc("read_own_amora_mediation_response", {
      p_message_id: scope.messageId, p_expected_owner_id: auth.ownerId,
      p_expected_proposal_version: scope.expectedProposalVersion, p_expected_roster_fingerprint: scope.expectedRosterFingerprint,
    });
    if (error) return failure(error);
    const state = parseMediationResponseState(data, auth, scope);
    return state ? json(state) : unavailable();
  } catch { return unavailable(); }
}

async function mutate(request: Request, withdraw: boolean) {
  if (!isTrustedMutationRequest(request)) return json({ error: "요청 출처를 확인해 주세요." }, 403);
  if (isBodyTooLarge(request, 8 * 1024)) return json({ error: "요청이 너무 큽니다." }, 413);
  try {
    const bounded = await readBoundedUtf8Text(request, 8 * 1024);
    if (!bounded.ok) return json({ error: "요청 본문을 확인해 주세요." }, bounded.reason === "too_large" ? 413 : 400);
    let value: unknown;
    try { value = JSON.parse(bounded.text); } catch { return invalid(); }
    const keys = [...BASE_KEYS, "expectedResponseRevision", ...(withdraw ? [] : ["choice", "condition"])];
    if (!isRecord(value) || Object.keys(value).some(key => !keys.includes(key))) return invalid();
    const scope = expected(value); if (!scope) return invalid();
    if (!Number.isSafeInteger(value.expectedResponseRevision) || (value.expectedResponseRevision as number) < 0) return invalid();
    const choice = withdraw ? null : value.choice;
    if (!withdraw && (typeof choice !== "string" || !["ok", "conditional", "difficult"].includes(choice))) return invalid();
    if (!withdraw && value.condition !== null && typeof value.condition !== "string") return invalid();
    const condition = typeof value.condition === "string" ? value.condition.trim() || null : null;
    if ((condition !== null && condition.length > 500) || (choice === "conditional" && !condition)
      || ((choice === null || choice === "ok") && condition !== null)) return invalid();
    const auth = await context(request); if (auth instanceof NextResponse) return auth;
    if (scope.expectedOwnerId !== auth.ownerId) return json({ error: "로그인 계정이 바뀌었어요." }, 403);
    const limited = checkRateLimit(rateLimitKey("amora-mediation-responses", request, auth.ownerId), { maxRequests: 30, windowMs: 60_000 });
    if (limited) return limited;
    const { data, error } = await auth.client.rpc("respond_own_amora_mediation", {
      p_message_id: scope.messageId, p_expected_owner_id: auth.ownerId,
      p_expected_proposal_version: scope.expectedProposalVersion, p_expected_roster_fingerprint: scope.expectedRosterFingerprint,
      p_expected_response_revision: value.expectedResponseRevision, p_choice: choice, p_condition: condition,
    });
    if (error) return failure(error);
    const state = parseMediationResponseState(data, auth, scope);
    if (!state || state.myResponseRevision !== (value.expectedResponseRevision as number) + 1
      || (withdraw ? state.myResponse !== null : state.myResponse?.choice !== choice || state.myResponse?.condition !== condition)) return unavailable();
    return json(state);
  } catch { return unavailable(); }
}

export async function POST(request: Request) { return mutate(request, false); }
export async function DELETE(request: Request) { return mutate(request, true); }
