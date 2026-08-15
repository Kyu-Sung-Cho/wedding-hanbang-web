import { NextResponse } from "next/server";
import {
  TODAY_ONE_CARE_ACTIONS,
  TODAY_ONE_CARE_CONTRACT_VERSION,
  TODAY_ONE_CARE_CONTRACT_VERSION_HEADER,
  TODAY_ONE_CARE_LEGACY_CONTRACT_VERSION,
  validateTodayOneCareResponse,
  type TodayOneCareAction,
  type TodayOneCareLegacyResponse,
  type TodayOneCareResponse,
} from "@hanbang/shared";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import {
  buildTodayOneScheduleCandidates,
  mergeTodayOneCandidatesWithHistory,
  type TodayOneCandidate,
  type TodayOneExposure,
  type TodayOneScheduleCandidate,
} from "@/lib/care/todayOne";
import { buildTodayOneBudgetGuardrailCandidates } from "@/lib/care/todayOneBudget";
import { buildConfirmedDecisionFollowUpCandidates } from "@/lib/care/decisionFollowUp";
import { isAmoraTodayOneEnabled } from "@/lib/features/amoraCareFlags";
import { ymdInKst } from "@/lib/utils/kstDate";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import {
  isRecord,
  isUuid,
  readBoundedUtf8Text,
} from "@/utils/requestValidation";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: `Origin, Sec-Fetch-Site, Authorization, ${TODAY_ONE_CARE_CONTRACT_VERSION_HEADER}`,
};
const MAX_BODY_BYTES = 2 * 1024;
const MAX_READS_PER_MINUTE = 60;
const MAX_ACTIONS_PER_MINUTE = 20;
const MAX_EXPOSURE_SIGNALS = 240;
const MAX_EXPOSURE_ROWS = 400;
const MAX_SAFE_REVISION = 9_007_199_254_740_991;
const SAFE_SOURCE_KEY_RE = /^[a-z0-9:_-]{1,200}$/;
const SAFE_STATE_DIGEST_RE = /^[0-9a-f]{64}$/;
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

type TodayOneResponseContract =
  | typeof TODAY_ONE_CARE_LEGACY_CONTRACT_VERSION
  | typeof TODAY_ONE_CARE_CONTRACT_VERSION;
const ACTION_KEYS = [
  "cardId",
  "expectedRevision",
  "expectedSourceRevision",
  "action",
] as const;

type RequestClient = Awaited<ReturnType<typeof createClientFromRequest>>;
type AuthContext = {
  supabase: RequestClient;
  userId: string;
};
type TodayOneContext = {
  supabase: RequestClient;
  userId: string;
  coupleId: string;
  weddingDate: string | null;
  totalBudget: unknown;
  progress: Record<string, unknown>;
  stateRevision: number;
  actorRole: "bride" | "groom";
  currentMemberUserIds: string[];
};
type PreferenceRow = {
  enabled: boolean;
  optedInAt: string | null;
  pausedUntil: string | null;
  dailyLimit: 1;
};
type RecipientStateRow = {
  id: string;
  coupleId: string;
  recipientUserId: string;
  revision: number;
  sourceRevision: number;
  state: "ready" | "snoozed" | "opened" | "dismissed" | "muted";
  claimedForDate: string;
  expiresAt: string;
};
type RpcError = {
  code?: unknown;
  message?: unknown;
  details?: unknown;
  hint?: unknown;
};

function response(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: PRIVATE_NO_STORE_HEADERS,
  });
}

function withPrivateHeaders(result: NextResponse) {
  for (const [name, value] of Object.entries(PRIVATE_NO_STORE_HEADERS)) {
    result.headers.set(name, value);
  }
  return result;
}

function unavailableResponse() {
  return response({ available: false });
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
) {
  const allowedSet = new Set(allowed);
  return Object.keys(value).every((key) => allowedSet.has(key));
}

function validRevision(value: unknown, minimum: 0 | 1): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= minimum
    && value <= MAX_SAFE_REVISION;
}

function safeIsoTimestamp(value: unknown): value is string {
  return typeof value === "string"
    && value.length <= 40
    && Number.isFinite(Date.parse(value));
}

function requestedResponseContract(
  request: Request,
): TodayOneResponseContract | NextResponse {
  const requested = request.headers
    .get(TODAY_ONE_CARE_CONTRACT_VERSION_HEADER)
    ?.trim() ?? null;
  if (requested === null || requested === String(TODAY_ONE_CARE_LEGACY_CONTRACT_VERSION)) {
    return TODAY_ONE_CARE_LEGACY_CONTRACT_VERSION;
  }
  if (requested === String(TODAY_ONE_CARE_CONTRACT_VERSION)) {
    return TODAY_ONE_CARE_CONTRACT_VERSION;
  }
  return response({
    error: "지원하지 않는 오늘의 한 가지 응답 버전입니다. 앱을 업데이트해 주세요.",
    code: "TODAY_ONE_CONTRACT_UNSUPPORTED",
  }, 426);
}

function projectResponseContract(
  result: TodayOneCareResponse,
  contractVersion: TodayOneResponseContract,
): TodayOneCareResponse | TodayOneCareLegacyResponse {
  if (contractVersion === TODAY_ONE_CARE_CONTRACT_VERSION) return result;
  const base = {
    version: TODAY_ONE_CARE_LEGACY_CONTRACT_VERSION,
    recipientUserId: result.recipientUserId,
    claimedForDate: result.claimedForDate,
  } as const;
  if (result.state !== "ready" || !result.card) {
    return { ...base, state: result.state };
  }
  if (result.card.kind === "decision_follow_up") {
    return { ...base, state: "none" };
  }
  const legacyCard: NonNullable<TodayOneCareLegacyResponse["card"]> = {
    id: result.card.id,
    revision: result.card.revision,
    sourceRevision: result.card.sourceRevision,
    sourceKey: result.card.sourceKey,
    kind: result.card.kind,
    whyNow: result.card.whyNow,
    confirmed: [...result.card.confirmed],
    unknown: [...result.card.unknown],
    nextAction: { ...result.card.nextAction },
    impact: result.card.impact,
    choices: result.card.choices.map((choice) => ({ ...choice })),
    expiresAt: result.card.expiresAt,
  };
  return {
    ...base,
    state: "ready",
    card: legacyCard,
  };
}

function apiResult(
  result: TodayOneCareResponse,
  options: {
    staleMessage?: string;
    contractVersion?: TodayOneResponseContract;
  } = {},
) {
  const projected = projectResponseContract(
    result,
    options.contractVersion ?? TODAY_ONE_CARE_CONTRACT_VERSION,
  );
  if (result.state === "source_stale") {
    return response(
      {
        available: true,
        result: projected,
        code: "TODAY_ONE_SOURCE_STALE",
        error:
          options.staleMessage
          ?? "준비 기록이 바뀌었어요. 최신 내용을 다시 불러와 확인해 주세요.",
      },
      409,
    );
  }
  return response({ available: true, result: projected });
}

function localResult(
  userId: string,
  state: Exclude<TodayOneCareResponse["state"], "ready">,
  now: Date,
): TodayOneCareResponse {
  return {
    version: TODAY_ONE_CARE_CONTRACT_VERSION,
    state,
    recipientUserId: userId,
    claimedForDate: ymdInKst(now),
  };
}

function rpcErrorText(error: RpcError): string {
  return [error.code, error.message, error.details, error.hint]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
}

function rosterFailure() {
  return response(
    {
      code: "TODAY_ONE_ROSTER_CHANGED",
      error: "커플 연결 상태가 바뀌었어요. 새로고침한 뒤 다시 확인해 주세요.",
    },
    403,
  );
}

async function loadContext(
  auth: AuthContext,
): Promise<{ ok: true; value: TodayOneContext } | { ok: false; response: NextResponse }> {
  const { supabase, userId } = auth;
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("couple_id, role")
    .eq("id", userId)
    .single();
  if (profileError) {
    console.error("[today-one] profile read failed", { code: profileError.code });
    return {
      ok: false,
      response: response({ error: "커플 정보를 확인하지 못했어요." }, 503),
    };
  }
  if (!isUuid(profile?.couple_id)) {
    return {
      ok: false,
      response: response(
        { error: "커플 연결을 완료한 뒤 사용할 수 있어요.", code: "TODAY_ONE_COUPLE_REQUIRED" },
        409,
      ),
    };
  }

  const { data: couple, error: coupleError } = await supabase
    .from("couples")
    .select("bride_id, groom_id")
    .eq("id", profile.couple_id)
    .single();
  if (coupleError) {
    console.error("[today-one] couple read failed", { code: coupleError.code });
    return { ok: false, response: response({ error: "커플 정보를 확인하지 못했어요." }, 503) };
  }
  const validRoster =
    (profile.role === "bride" && couple?.bride_id === userId)
    || (profile.role === "groom" && couple?.groom_id === userId);
  if (!validRoster) return { ok: false, response: rosterFailure() };
  const currentMemberUserIds = [couple?.bride_id, couple?.groom_id]
    .filter((memberId): memberId is string => isUuid(memberId));
  if (
    (profile.role !== "bride" && profile.role !== "groom")
    || currentMemberUserIds.length < 1
    || currentMemberUserIds.length > 2
    || new Set(currentMemberUserIds).size !== currentMemberUserIds.length
    || !currentMemberUserIds.includes(userId)
  ) return { ok: false, response: rosterFailure() };

  const { data: journey, error: journeyError } = await supabase
    .from("wedding_journeys")
    .select("wedding_date, total_budget, progress, state_revision")
    .eq("couple_id", profile.couple_id)
    .single();
  if (journeyError) {
    console.error("[today-one] journey read failed", { code: journeyError.code });
    return { ok: false, response: response({ error: "현재 준비 기록을 불러오지 못했어요." }, 503) };
  }
  if (
    !journey
    || !(journey.wedding_date === null || typeof journey.wedding_date === "string")
    || !isRecord(journey.progress)
    || !validRevision(journey.state_revision, 0)
  ) {
    return {
      ok: false,
      response: response(
        {
          error: "현재 준비 기록의 최신 버전을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.",
          code: "TODAY_ONE_SOURCE_UNAVAILABLE",
        },
        503,
      ),
    };
  }

  return {
    ok: true,
    value: {
      supabase,
      userId,
      coupleId: profile.couple_id,
      weddingDate: journey.wedding_date,
      totalBudget: journey.total_budget,
      progress: journey.progress,
      stateRevision: journey.state_revision,
      actorRole: profile.role,
      currentMemberUserIds,
    },
  };
}

async function readPrivacyEpoch(
  context: TodayOneContext,
): Promise<number | NextResponse> {
  const { data, error } = await context.supabase.rpc(
    "get_own_amora_privacy_epoch",
    {
      p_couple_id: context.coupleId,
      p_visibility: "shared",
    },
  );
  if (error || !validRevision(data, 1)) {
    console.error("[today-one] privacy epoch read failed", {
      code: typeof error?.code === "string" ? error.code : "invalid-result",
    });
    return response(
      {
        error: "현재 커플 공유 범위를 안전하게 확인하지 못했어요.",
        code: "TODAY_ONE_PRIVACY_CONTEXT_UNAVAILABLE",
      },
      503,
    );
  }
  return data;
}

async function readDecisionFollowUpCandidates(
  context: TodayOneContext,
  now: Date,
): Promise<TodayOneCandidate[] | NextResponse> {
  const { data, error } = await context.supabase
    .from("decision_nodes")
    .select(
      "id, couple_id, visibility, decision_type, title, source_ref_id, source_actor_role, user_confirmed_at, decided_at, superseded_at, metadata",
    )
    .eq("couple_id", context.coupleId)
    .eq("visibility", "shared")
    .in("decision_type", ["decided", "scheduled"])
    .order("user_confirmed_at", { ascending: false })
    .limit(40);
  if (error || !Array.isArray(data)) {
    console.error("[today-one] confirmed decision read failed", {
      code: typeof error?.code === "string" ? error.code : "invalid-result",
    });
    return response(
      {
        error: "확인된 결정 기록을 안전하게 불러오지 못했어요.",
        code: "TODAY_ONE_DECISION_CONTEXT_UNAVAILABLE",
      },
      503,
    );
  }
  return buildConfirmedDecisionFollowUpCandidates({
    coupleId: context.coupleId,
    recipientUserId: context.userId,
    actorRole: context.actorRole,
    currentMemberUserIds: context.currentMemberUserIds,
    stateRevision: context.stateRevision,
    decisions: data,
    now,
  });
}

async function authenticate(
  request: Request,
): Promise<{ ok: true; value: AuthContext } | { ok: false; response: NextResponse }> {
  const supabase = await createClientFromRequest(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isUuid(user.id)) {
    return {
      ok: false,
      response: response({ error: "인증이 필요합니다.", code: "TODAY_ONE_AUTH_REQUIRED" }, 401),
    };
  }
  return { ok: true, value: { supabase, userId: user.id } };
}

async function readPreference(
  context: TodayOneContext,
): Promise<PreferenceRow | null | NextResponse> {
  const { data, error } = await context.supabase
    .from("amora_today_one_preferences")
    .select("enabled, opted_in_at, paused_until, daily_limit")
    .eq("user_id", context.userId)
    .maybeSingle();
  if (error) {
    console.error("[today-one] preference read failed", { code: error.code });
    return response({ error: "오늘의 한 가지 설정을 불러오지 못했어요." }, 503);
  }
  if (!data) return null;
  if (
    typeof data.enabled !== "boolean"
    || !(data.opted_in_at === null || safeIsoTimestamp(data.opted_in_at))
    || !(data.paused_until === null || safeIsoTimestamp(data.paused_until))
    || data.daily_limit !== 1
    || data.enabled !== (data.opted_in_at !== null)
    || (!data.enabled && data.paused_until !== null)
  ) {
    return response(
      { error: "저장된 오늘의 한 가지 설정을 확인하지 못했어요." },
      503,
    );
  }
  return {
    enabled: data.enabled,
    optedInAt: data.opted_in_at,
    pausedUntil: data.paused_until,
    dailyLimit: 1,
  };
}

async function readExposureHistory(
  context: TodayOneContext,
  candidates: ReadonlyArray<TodayOneCandidate>,
  today: string,
): Promise<TodayOneExposure[] | NextResponse> {
  const sourceKeys = [...new Set(candidates.map(({ sourceKey }) => sourceKey))];
  if (sourceKeys.length === 0) return [];
  if (
    sourceKeys.length > MAX_EXPOSURE_SIGNALS
    || sourceKeys.some((sourceKey) => !SAFE_SOURCE_KEY_RE.test(sourceKey))
  ) {
    return response({ error: "오늘 확인할 후보 기록의 범위를 확인하지 못했어요." }, 503);
  }

  const { data: rawCurrentSignals, error: currentSignalError } = await context.supabase
    .from("amora_today_one_signals")
    .select("id, source_key")
    .eq("recipient_user_id", context.userId)
    .eq("couple_id", context.coupleId)
    .in("source_key", sourceKeys)
    .limit(MAX_EXPOSURE_SIGNALS);
  if (currentSignalError) {
    console.error("[today-one] exposure signal read failed", { code: currentSignalError.code });
    return response({ error: "오늘의 한 가지 노출 기록을 확인하지 못했어요." }, 503);
  }
  if (!Array.isArray(rawCurrentSignals)) {
    return response({ error: "저장된 오늘의 한 가지 노출 기록을 확인하지 못했어요." }, 503);
  }

  // 이미 보여 준 예산 위험이 해소되어 오늘 후보에서 사라져도, 새 D-1
  // 일정이 다음 예산 위험에 계속 밀리지 않도록 예산 도메인의 노출 표식
  // 하나를 현재 후보 키와 별도로 읽는다. 커플·수신자 경계와 1행 상한은
  // 유지하므로 이전 관계의 기록이나 무제한 이력을 섞지 않는다.
  let rawBudgetDomainSignals: unknown[] = [];
  if (candidates.some(({ kind }) => kind === "budget_guardrail")) {
    const { data, error } = await context.supabase
      .from("amora_today_one_signals")
      .select("id, source_key")
      .eq("recipient_user_id", context.userId)
      .eq("couple_id", context.coupleId)
      .like("source_key", "budget:%")
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) {
      console.error("[today-one] budget-domain exposure read failed", { code: error.code });
      return response({ error: "오늘의 한 가지 노출 기록을 확인하지 못했어요." }, 503);
    }
    if (!Array.isArray(data)) {
      return response({ error: "저장된 오늘의 한 가지 노출 기록을 확인하지 못했어요." }, 503);
    }
    rawBudgetDomainSignals = data;
  }

  const sourceKeyBySignalId = new Map<string, string>();
  for (const rawSignal of [...rawCurrentSignals, ...rawBudgetDomainSignals]) {
    if (
      !isRecord(rawSignal)
      || !isUuid(rawSignal.id)
      || typeof rawSignal.source_key !== "string"
      || !SAFE_SOURCE_KEY_RE.test(rawSignal.source_key)
      || (
        !sourceKeys.includes(rawSignal.source_key)
        && !rawSignal.source_key.startsWith("budget:")
      )
    ) {
      return response({ error: "저장된 오늘의 한 가지 노출 기록을 확인하지 못했어요." }, 503);
    }
    const existingSourceKey = sourceKeyBySignalId.get(rawSignal.id);
    if (existingSourceKey && existingSourceKey !== rawSignal.source_key) {
      return response({ error: "저장된 오늘의 한 가지 노출 기록을 확인하지 못했어요." }, 503);
    }
    sourceKeyBySignalId.set(rawSignal.id, rawSignal.source_key);
  }
  if (sourceKeyBySignalId.size === 0) return [];

  const { data: rawStates, error: stateError } = await context.supabase
    .from("amora_today_one_recipient_states")
    .select("signal_id, state_digest, claimed_for_date")
    .eq("recipient_user_id", context.userId)
    .eq("couple_id", context.coupleId)
    .in("signal_id", [...sourceKeyBySignalId.keys()])
    .order("claimed_for_date", { ascending: false })
    .limit(MAX_EXPOSURE_ROWS);
  if (stateError) {
    console.error("[today-one] exposure state read failed", { code: stateError.code });
    return response({ error: "오늘의 한 가지 노출 기록을 확인하지 못했어요." }, 503);
  }
  if (!Array.isArray(rawStates)) {
    return response({ error: "저장된 오늘의 한 가지 노출 기록을 확인하지 못했어요." }, 503);
  }

  const history: TodayOneExposure[] = [];
  for (const rawState of rawStates) {
    if (
      !isRecord(rawState)
      || !isUuid(rawState.signal_id)
      || typeof rawState.state_digest !== "string"
      || !SAFE_STATE_DIGEST_RE.test(rawState.state_digest)
      || typeof rawState.claimed_for_date !== "string"
      || !YMD_RE.test(rawState.claimed_for_date)
    ) {
      return response({ error: "저장된 오늘의 한 가지 노출 기록을 확인하지 못했어요." }, 503);
    }
    const sourceKey = sourceKeyBySignalId.get(rawState.signal_id);
    if (!sourceKey) continue;
    history.push({
      sourceKey,
      sourceStateDigest: rawState.state_digest,
      claimedForDate: rawState.claimed_for_date,
      claimedToday: rawState.claimed_for_date === today,
    });
  }
  return history;
}

function validateOwnedResult(value: unknown, userId: string) {
  const normalized = isRecord(value)
    && value.version === TODAY_ONE_CARE_LEGACY_CONTRACT_VERSION
    ? { ...value, version: TODAY_ONE_CARE_CONTRACT_VERSION }
    : value;
  const validation = validateTodayOneCareResponse(normalized, userId);
  return validation.ok ? validation.value : null;
}

function attachScheduleCare(
  result: TodayOneCareResponse,
  scheduleCandidates: ReadonlyArray<TodayOneScheduleCandidate>,
  userId: string,
): TodayOneCareResponse | null {
  if (result.state !== "ready" || !result.card) return result;
  const source = scheduleCandidates.find((candidate) => (
    candidate.kind === "schedule_moment"
    && candidate.sourceKey === result.card?.sourceKey
    && candidate.sourceRevision === result.card?.sourceRevision
    && candidate.care !== undefined
  ));
  if (!source?.care) return result;

  return validateOwnedResult({
    ...result,
    card: {
      ...result.card,
      care: {
        ...source.care,
        checklist: [...source.care.checklist],
        relatedChecklist: { ...source.care.relatedChecklist },
        ...(source.care.relatedBudget
          ? { relatedBudget: { ...source.care.relatedBudget } }
          : {}),
        evidence: {
          refs: source.care.evidence.refs.map((ref) => ({ ...ref })),
          limitations: [...source.care.evidence.limitations],
        },
      },
    },
  }, userId);
}

function compileError(
  error: RpcError,
  userId: string,
  now: Date,
  contractVersion: TodayOneResponseContract,
) {
  const text = rpcErrorText(error);
  if (/AMORA_TODAY_ONE_DAILY_LIMIT_V2/i.test(text)) {
    return apiResult(localResult(userId, "daily_limit", now), { contractVersion });
  }
  if (/AMORA_TODAY_ONE_RECIPIENT_FORBIDDEN/i.test(text)) return rosterFailure();
  if (/AMORA_TODAY_ONE_PRIVACY_CONTEXT_STALE/i.test(text)) {
    return response(
      {
        error: "커플 연결이나 공유 설정이 바뀌었어요. 최신 상태에서 다시 확인해 주세요.",
        code: "TODAY_ONE_PRIVACY_CONTEXT_CHANGED",
      },
      409,
    );
  }
  console.error("[today-one] compile RPC failed", {
    code: typeof error.code === "string" ? error.code : "unknown",
  });
  return response(
    {
      error: "오늘 확인할 내용을 안전하게 준비하지 못했어요. 잠시 후 다시 시도해 주세요.",
      code: "TODAY_ONE_COMPILE_UNAVAILABLE",
    },
    503,
  );
}

function actionError(error: RpcError) {
  const text = rpcErrorText(error);
  if (/AMORA_TODAY_ONE_(CARD_FORBIDDEN|AUTH_REQUIRED)/i.test(text)) {
    return response({ error: "이 카드를 변경할 권한이 없습니다." }, 403);
  }
  if (/AMORA_TODAY_ONE_ACTION_INVALID/i.test(text) || error.code === "22023") {
    return response({ error: "카드 동작이 올바르지 않습니다." }, 400);
  }
  console.error("[today-one] owner action RPC failed", {
    code: typeof error.code === "string" ? error.code : "unknown",
  });
  return response(
    { error: "선택을 저장하지 못했어요. 아무것도 바뀌지 않았으니 다시 시도해 주세요." },
    503,
  );
}

function checkRate(
  scope: string,
  request: Request,
  userId: string,
  maxRequests: number,
) {
  const limited = checkRateLimit(rateLimitKey(scope, request, userId), {
    maxRequests,
    windowMs: 60 * 1000,
  });
  return limited ? withPrivateHeaders(limited) : null;
}

export async function GET(request: Request) {
  try {
    const auth = await authenticate(request);
    if (!auth.ok) return auth.response;
    if (!isAmoraTodayOneEnabled()) return unavailableResponse();
    // This GET may atomically create today's owner-scoped card claim. Treat it
    // as a mutation boundary so a cross-site image/navigation cannot consume
    // the user's one-card-per-day allowance.
    if (!isTrustedMutationRequest(request)) {
      return response({ error: "잘못된 요청 출처입니다." }, 403);
    }
    const contractVersion = requestedResponseContract(request);
    if (contractVersion instanceof NextResponse) return contractVersion;

    const limited = checkRate(
      "amora-today-one:read",
      request,
      auth.value.userId,
      MAX_READS_PER_MINUTE,
    );
    if (limited) return limited;

    const contextResult = await loadContext(auth.value);
    if (!contextResult.ok) return contextResult.response;
    const context = contextResult.value;
    const now = new Date();
    const preference = await readPreference(context);
    if (preference instanceof NextResponse) return preference;
    if (!preference?.enabled || !preference.optedInAt) {
      return apiResult(localResult(context.userId, "disabled", now), { contractVersion });
    }
    if (
      preference.pausedUntil
      && new Date(preference.pausedUntil).getTime() > now.getTime()
    ) {
      return apiResult(localResult(context.userId, "paused", now), { contractVersion });
    }

    const initialPrivacyEpoch = await readPrivacyEpoch(context);
    if (initialPrivacyEpoch instanceof NextResponse) return initialPrivacyEpoch;

    const scheduleCandidates = buildTodayOneScheduleCandidates({
        weddingDate: context.weddingDate,
        progress: context.progress,
        stateRevision: context.stateRevision,
        now,
      });
    const budgetCandidates = buildTodayOneBudgetGuardrailCandidates({
        totalBudget: context.totalBudget,
        progress: context.progress,
        stateRevision: context.stateRevision,
      });
    let decisionFollowUpCandidates: TodayOneCandidate[] = [];
    if (contractVersion === TODAY_ONE_CARE_CONTRACT_VERSION) {
      const result = await readDecisionFollowUpCandidates(context, now);
      if (result instanceof NextResponse) return result;
      decisionFollowUpCandidates = result;
    }
    if (
      scheduleCandidates.length === 0
      && budgetCandidates.length === 0
      && decisionFollowUpCandidates.length === 0
    ) {
      return apiResult(localResult(context.userId, "none", now), { contractVersion });
    }
    const exposureHistory = await readExposureHistory(
      context,
      [
        ...scheduleCandidates,
        ...budgetCandidates,
        ...decisionFollowUpCandidates,
      ],
      ymdInKst(now),
    );
    if (exposureHistory instanceof NextResponse) return exposureHistory;
    const candidates = mergeTodayOneCandidatesWithHistory(
      exposureHistory,
      scheduleCandidates,
      budgetCandidates,
      decisionFollowUpCandidates,
    );

    const admin = createAdminClient();
    const { error: v2DailyError } = await admin.rpc(
      "assert_amora_today_one_v1_claim_available_v2",
      {
        p_couple_id: context.coupleId,
        p_recipient_user_id: context.userId,
      },
    );
    if (v2DailyError) {
      const v2DailyText = rpcErrorText(v2DailyError);
      if (/AMORA_TODAY_ONE_DAILY_LIMIT_V2/.test(v2DailyText)) {
        return apiResult(localResult(context.userId, "daily_limit", now), { contractVersion });
      }
      // Rolling deploy compatibility: the coordinator does not exist until
      // the additive v2 migration lands, so v1 remains available beforehand.
      if (!/does not exist|PGRST202/i.test(v2DailyText)) {
        console.error("[today-one] v2 daily coordinator failed", {
          code: typeof v2DailyError.code === "string" ? v2DailyError.code : "unknown",
        });
        return response({ error: "오늘의 한 가지 사용 상태를 확인하지 못했어요." }, 503);
      }
    }
    let lastNone: TodayOneCareResponse | null = null;
    for (const candidate of candidates) {
      const currentPrivacyEpoch = await readPrivacyEpoch(context);
      if (currentPrivacyEpoch instanceof NextResponse) return currentPrivacyEpoch;
      if (currentPrivacyEpoch !== initialPrivacyEpoch) {
        return response(
          {
            error: "커플 연결이나 공유 설정이 바뀌었어요. 최신 상태에서 다시 확인해 주세요.",
            code: "TODAY_ONE_PRIVACY_CONTEXT_CHANGED",
          },
          409,
        );
      }
      const presentation = {
        kind: candidate.kind,
        whyNow: candidate.whyNow,
        confirmed: candidate.confirmed,
        unknown: candidate.unknown,
        nextAction: candidate.nextAction,
        impact: candidate.impact,
        choices: candidate.choices,
      };
      const decisionId = candidate.kind === "decision_follow_up"
        ? candidate.sourceKey.slice("decision:".length)
        : null;
      const { data, error } = candidate.kind === "decision_follow_up"
        ? await admin.rpc("compile_amora_decision_follow_up_card", {
            p_couple_id: context.coupleId,
            p_recipient_user_id: context.userId,
            p_decision_id: decisionId,
            p_expected_privacy_epoch: initialPrivacyEpoch,
            p_state_digest: candidate.sourceStateDigest,
            p_source_revision: candidate.sourceRevision,
            p_priority: candidate.priority,
            p_presentation: presentation,
          })
        : await admin.rpc("compile_amora_today_one_card", {
            p_couple_id: context.coupleId,
            p_recipient_user_id: context.userId,
            p_source_key: candidate.sourceKey,
            p_state_digest: candidate.sourceStateDigest,
            p_source_revision: candidate.sourceRevision,
            p_priority: candidate.priority,
            p_presentation: presentation,
          });
      if (error) return compileError(error, context.userId, now, contractVersion);
      const result = validateOwnedResult(data, context.userId);
      if (!result) {
        console.error("[today-one] compile RPC returned an invalid owner response");
        return response({ error: "오늘 확인할 내용의 형식을 확인하지 못했어요." }, 503);
      }
      if (result.state === "none") {
        lastNone = result;
        continue;
      }
      const consumerResult = contractVersion === TODAY_ONE_CARE_CONTRACT_VERSION
        ? attachScheduleCare(result, scheduleCandidates, context.userId)
        : result;
      if (!consumerResult) {
        console.error("[today-one] generated schedule care failed validation");
        return response({ error: "오늘 확인할 안내의 형식을 확인하지 못했어요." }, 503);
      }
      return apiResult(consumerResult, { contractVersion });
    }
    return apiResult(
      lastNone ?? localResult(context.userId, "none", now),
      { contractVersion },
    );
  } catch (error) {
    console.error("[today-one] GET failed", error);
    return response({ error: "오늘 확인할 내용을 불러오지 못했어요." }, 500);
  }
}

async function readActionBody(request: Request) {
  const body = await readBoundedUtf8Text(request, MAX_BODY_BYTES);
  if (!body.ok) {
    return response(
      {
        error: body.reason === "too_large"
          ? "요청 데이터가 너무 큽니다."
          : "요청 데이터를 읽지 못했습니다.",
      },
      body.reason === "too_large" ? 413 : 400,
    );
  }
  try {
    const value = JSON.parse(body.text) as unknown;
    if (isRecord(value)) return value;
  } catch {
    // The bounded generic response below intentionally hides parser details.
  }
  return response({ error: "요청 형식이 올바르지 않습니다." }, 400);
}

function parseRecipientState(value: unknown): RecipientStateRow | null {
  if (
    !isRecord(value)
    || !isUuid(value.id)
    || !isUuid(value.couple_id)
    || !isUuid(value.recipient_user_id)
    || !validRevision(value.revision, 1)
    || !validRevision(value.source_revision, 0)
    || !["ready", "snoozed", "opened", "dismissed", "muted"].includes(
      String(value.state),
    )
    || typeof value.claimed_for_date !== "string"
    || !/^\d{4}-\d{2}-\d{2}$/.test(value.claimed_for_date)
    || !safeIsoTimestamp(value.expires_at)
  ) {
    return null;
  }
  return {
    id: value.id,
    coupleId: value.couple_id,
    recipientUserId: value.recipient_user_id,
    revision: value.revision,
    sourceRevision: value.source_revision,
    state: value.state as RecipientStateRow["state"],
    claimedForDate: value.claimed_for_date,
    expiresAt: value.expires_at,
  };
}

export async function POST(request: Request) {
  try {
    if (!isTrustedMutationRequest(request)) {
      return response({ error: "잘못된 요청 출처입니다." }, 403);
    }
    const contractVersion = requestedResponseContract(request);
    if (contractVersion instanceof NextResponse) return contractVersion;
    const body = await readActionBody(request);
    if (body instanceof NextResponse) return body;
    if (!hasOnlyKeys(body, ACTION_KEYS) || !ACTION_KEYS.every((key) => key in body)) {
      return response({ error: "허용되지 않은 카드 항목이 있습니다." }, 400);
    }
    if (
      !isUuid(body.cardId)
      || !validRevision(body.expectedRevision, 1)
      || !validRevision(body.expectedSourceRevision, 0)
      || !TODAY_ONE_CARE_ACTIONS.includes(body.action as TodayOneCareAction)
    ) {
      return response({ error: "카드 동작이 올바르지 않습니다." }, 400);
    }

    const auth = await authenticate(request);
    if (!auth.ok) return auth.response;
    if (!isAmoraTodayOneEnabled()) return unavailableResponse();
    const contextResult = await loadContext(auth.value);
    if (!contextResult.ok) return contextResult.response;
    const context = contextResult.value;

    const limited = checkRate(
      "amora-today-one:action",
      request,
      context.userId,
      MAX_ACTIONS_PER_MINUTE,
    );
    if (limited) return limited;

    const { data: rawState, error: stateError } = await context.supabase
      .from("amora_today_one_recipient_states")
      .select(
        "id, couple_id, recipient_user_id, revision, source_revision, state, claimed_for_date, expires_at",
      )
      .eq("id", body.cardId)
      .eq("recipient_user_id", context.userId)
      .eq("couple_id", context.coupleId)
      .maybeSingle();
    if (stateError) {
      console.error("[today-one] owner card read failed", { code: stateError.code });
      return response({ error: "카드의 최신 상태를 확인하지 못했어요." }, 503);
    }
    if (!rawState) {
      return response({ error: "현재 확인할 수 있는 카드를 찾지 못했어요." }, 403);
    }
    const state = parseRecipientState(rawState);
    if (!state) {
      return response({ error: "저장된 카드 상태를 안전하게 확인하지 못했어요." }, 503);
    }
    const sourceIsCurrent =
      state.coupleId === context.coupleId
      && state.recipientUserId === context.userId
      && state.state === "ready"
      && state.sourceRevision === context.stateRevision
      && state.revision === body.expectedRevision
      && state.sourceRevision === body.expectedSourceRevision
      && state.claimedForDate === ymdInKst()
      && new Date(state.expiresAt).getTime() > Date.now();
    if (!sourceIsCurrent) {
      return apiResult(
        localResult(context.userId, "source_stale", new Date()),
        {
          staleMessage: "일정·예산 기록이나 카드 상태가 바뀌었어요. 최신 내용을 다시 확인해 주세요.",
          contractVersion,
        },
      );
    }

    const { data, error } = await context.supabase.rpc(
      "act_on_amora_today_one_card",
      {
        p_card_id: state.id,
        p_expected_revision: state.revision,
        p_expected_source_revision: state.sourceRevision,
        p_action: body.action as TodayOneCareAction,
      },
    );
    if (error) return actionError(error);
    const result = validateOwnedResult(data, context.userId);
    if (!result) {
      console.error("[today-one] owner action RPC returned an invalid response");
      return response({ error: "선택이 저장됐는지 확인하지 못했어요." }, 503);
    }
    return apiResult(result, { contractVersion });
  } catch (error) {
    console.error("[today-one] POST failed", error);
    return response(
      { error: "선택을 저장하지 못했어요. 아무것도 바뀌지 않았으니 다시 시도해 주세요." },
      500,
    );
  }
}
