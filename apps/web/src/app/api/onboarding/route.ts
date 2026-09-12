import { hasWebSignupConsentAccess } from "@/lib/auth/signupConsentAccess";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";
import {
  isPreparationStageValue,
  PREPARATION_STAGE_PROGRESS_KEY,
  WEDDING_BUDGET_TENDENCY_OPTIONS,
  WEDDING_GUEST_COUNT_OPTIONS,
  WEDDING_PRIORITY_OPTIONS,
  WEDDING_STYLE_OPTIONS,
} from "@hanbang/shared";

import { determineStage } from "@/lib/ai/stage-router";
import {
  isMembershipRpcMissing,
  joinCoupleThroughServerRpc,
  joinNeutralPreparationSpaceThroughServerRpc,
  parseMembershipRpcResponse,
  parseNeutralMembershipRpcResponse,
  type CoupleRole,
  type MembershipAction,
} from "@/lib/couples/membershipRpc";
import { inviteRoleMismatchForJoin } from "@/lib/couples/inviteRoleHint";
import { recordDecision } from "@/lib/memory/record-decision";
import { createClientFromRequest } from "@/lib/supabase/server";
import {
  getEvents,
  getScheduleEventStatus,
  inspectScheduleEvents,
  upsertMomentEvent,
} from "@/utils/scheduleEvents";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";
import { isRecord, readBoundedUtf8Text } from "@/utils/requestValidation";
import { isValidWeddingWonAmount } from "@/lib/weddingBudget";
import { PROGRESS_CHECKLIST_ITEMS } from "@/types/onboarding.types";


const ONBOARDING_JOIN_RATE = { maxRequests: 10, windowMs: 10 * 60 * 1000 };
const MAX_ONBOARDING_BODY_BYTES = 128 * 1024;
const REQUEST_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UNSAFE_DISPLAY_CHARACTER = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const CHECKLIST_STATUSES: ReadonlySet<string> = new Set([
  "not_started",
  "in_progress",
  "completed",
  "not_applicable",
]);
const PROGRESS_CATEGORY_KEYS: ReadonlySet<string> = new Set(
  PROGRESS_CHECKLIST_ITEMS.map(({ key }) => key),
);
const PROGRESS_ITEM_KEYS: ReadonlySet<string> = new Set(["status", "spent"]);
const PREFERENCE_KEYS: ReadonlySet<string> = new Set([
  "weddingStyle",
  "priorities",
  "budgetTendency",
  "guestCount",
]);
const WEDDING_STYLE_VALUES: ReadonlySet<string> = new Set(
  WEDDING_STYLE_OPTIONS.map(({ value }) => value),
);
const WEDDING_PRIORITY_VALUES: ReadonlySet<string> = new Set(
  WEDDING_PRIORITY_OPTIONS.map(({ value }) => value),
);
const WEDDING_BUDGET_TENDENCY_VALUES: ReadonlySet<string> = new Set(
  WEDDING_BUDGET_TENDENCY_OPTIONS.map(({ value }) => value),
);
const WEDDING_GUEST_COUNT_VALUES: ReadonlySet<string> = new Set(
  WEDDING_GUEST_COUNT_OPTIONS.map(({ value }) => value),
);
const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
};

type NormalizedOnboardingBudget =
  | { ok: true; totalBudgetWon: number | null }
  | { ok: false };

function normalizeOnboardingBudget(value: unknown): NormalizedOnboardingBudget {
  if (value === undefined || value === null || value === "" || value === 0) {
    return { ok: true, totalBudgetWon: null };
  }

  // 기존 웹과 배포 전 클라이언트는 원 단위 숫자를 전송한다.
  if (typeof value === "number") {
    return isValidWeddingWonAmount(value) && value > 0
      ? { ok: true, totalBudgetWon: value }
      : { ok: false };
  }

  if (!isRecord(value)) return { ok: false };
  const keys = Object.keys(value).sort();
  if (keys.length !== 2 || keys[0] !== "amount" || keys[1] !== "unit") {
    return { ok: false };
  }

  const { amount, unit } = value;
  if (
    typeof amount !== "number"
    || !Number.isSafeInteger(amount)
    || amount <= 0
    || (unit !== "won" && unit !== "manwon")
  ) {
    return { ok: false };
  }

  const totalBudgetWon = unit === "manwon"
    ? amount * 10_000
    : amount;
  return isValidWeddingWonAmount(totalBudgetWon) && totalBudgetWon > 0
    ? { ok: true, totalBudgetWon }
    : { ok: false };
}

function getAdmin() {
  return createAdminClient();
}

type AdminClient = ReturnType<typeof getAdmin>;

class OnboardingPersistenceError extends Error {
  constructor(operation: string, cause?: unknown) {
    super(`Onboarding persistence failed: ${operation}`, { cause });
    this.name = "OnboardingPersistenceError";
  }
}

class SanggyeonryeDateConflictError extends Error {
  constructor(
    readonly existingDate: string,
    readonly requestedDate: string,
  ) {
    super("The authoritative sanggyeonrye date differs from onboarding input.");
    this.name = "SanggyeonryeDateConflictError";
  }
}

class ScheduleEventsRepairRequiredError extends Error {
  constructor() {
    super("Stored schedule events must be repaired before onboarding can append an event.");
    this.name = "ScheduleEventsRepairRequiredError";
  }
}

function privateResponse(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: PRIVATE_NO_STORE_HEADERS,
  });
}

function persistenceCauseText(error: OnboardingPersistenceError): string {
  const cause = error.cause;
  if (isRecord(cause)) {
    return ["code", "message", "details", "hint"]
      .map((key) => cause[key])
      .filter((value): value is string => typeof value === "string")
      .join(" ");
  }
  return typeof cause === "string" ? cause : "";
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
): boolean {
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function parsePreferences(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value) || !hasOnlyKeys(value, PREFERENCE_KEYS)) return null;

  const {
    weddingStyle,
    priorities = [],
    budgetTendency,
    guestCount,
  } = value;
  if (
    weddingStyle !== undefined
    && weddingStyle !== null
    && (
      typeof weddingStyle !== "string"
      || !WEDDING_STYLE_VALUES.has(weddingStyle)
    )
  ) {
    return null;
  }
  if (
    !Array.isArray(priorities)
    || priorities.length > 3
    || priorities.some(
      (priority) =>
        typeof priority !== "string"
        || !WEDDING_PRIORITY_VALUES.has(priority),
    )
    || new Set(priorities).size !== priorities.length
  ) {
    return null;
  }
  if (
    budgetTendency !== undefined
    && budgetTendency !== null
    && (
      typeof budgetTendency !== "string"
      || !WEDDING_BUDGET_TENDENCY_VALUES.has(budgetTendency)
    )
  ) {
    return null;
  }
  if (
    guestCount !== undefined
    && guestCount !== null
    && (
      typeof guestCount !== "string"
      || !WEDDING_GUEST_COUNT_VALUES.has(guestCount)
    )
  ) {
    return null;
  }

  const normalized: Record<string, unknown> = {};
  if (typeof weddingStyle === "string") normalized.weddingStyle = weddingStyle;
  if (priorities.length > 0) normalized.priorities = priorities;
  if (typeof budgetTendency === "string") {
    normalized.budgetTendency = budgetTendency;
  }
  if (typeof guestCount === "string") normalized.guestCount = guestCount;
  return normalized;
}

function parseOnboardingProgress(
  value: unknown,
): Record<string, unknown> | null {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) return null;

  const normalized: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === "__events") return null;
    // 준비 단계 — 온보딩에서 한 줄로 받는 자기 신고. 19개 카테고리와 같은 JSONB에
    // 살지만 카테고리가 아니므로 `__` 접두 예약 키를 쓴다. 체크리스트 완료율이나
    // 예산 어디에도 들어가지 않는다.
    if (key === PREPARATION_STAGE_PROGRESS_KEY) {
      if (item === null) continue;
      if (!isPreparationStageValue(item)) return null;
      normalized[PREPARATION_STAGE_PROGRESS_KEY] = item;
      continue;
    }
    if (key === "__preferences") {
      const preferences = parsePreferences(item);
      if (!preferences) return null;
      if (Object.keys(preferences).length > 0) {
        normalized.__preferences = preferences;
      }
      continue;
    }
    if (
      !PROGRESS_CATEGORY_KEYS.has(key)
      || !isRecord(item)
      || !hasOnlyKeys(item, PROGRESS_ITEM_KEYS)
      || typeof item.status !== "string"
      || !CHECKLIST_STATUSES.has(item.status)
    ) {
      return null;
    }

    const hasSpent = Object.hasOwn(item, "spent");
    if (
      hasSpent
      && (
        item.status !== "completed"
        || !isValidWeddingWonAmount(item.spent)
      )
    ) {
      return null;
    }
    if (item.status === "not_started" && !hasSpent) continue;
    normalized[key] = hasSpent
      ? { status: item.status, spent: item.spent }
      : { status: item.status };
  }
  return normalized;
}

function storedProgress(value: unknown): Record<string, unknown> {
  if (value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new OnboardingPersistenceError("journey progress validation");
  }

  return value as Record<string, unknown>;
}

function getAuthoritativeSanggyeonryeDate(
  progress: Record<string, unknown>,
): string | null {
  const dates = [
    ...new Set(
      getEvents(progress)
        .filter(
          (event) =>
            getScheduleEventStatus(event) !== "cancelled"
            && event.momentType === "sanggyeonrye",
        )
        .map((event) => event.date),
    ),
  ];
  if (dates.length > 1) {
    throw new OnboardingPersistenceError(
      "multiple authoritative sanggyeonrye dates",
    );
  }
  return dates[0] ?? null;
}

function hasSanggyeonryeEvent(
  progress: Record<string, unknown>,
  expectedDate?: string,
): boolean {
  const date = getAuthoritativeSanggyeonryeDate(progress);
  return date !== null && (expectedDate === undefined || date === expectedDate);
}

function upsertStableOnboardingSanggyeonryeEvent(
  progress: Record<string, unknown>,
  date: string,
): Record<string, unknown> {
  if (hasSanggyeonryeEvent(progress, date)) return progress;

  const result = upsertMomentEvent(progress, {
    momentType: "sanggyeonrye",
    date,
    title: "양쪽 부모님 첫 만남",
  });
  if (!result.created) return result.newProgress;

  // A retry while a two-person request is pending must produce the exact same
  // intent digest. Generic schedule helpers use random IDs and wall-clock
  // timestamps, so onboarding gives this imported event stable provenance.
  const stableEvent = {
    ...result.event,
    id: `onboarding:sanggyeonrye:${date}`,
    sourceKey: "onboarding:sanggyeonrye",
    createdAt: `${date}T00:00:00.000Z`,
    updatedAt: `${date}T00:00:00.000Z`,
  };
  const events = Array.isArray(result.newProgress.__events)
    ? result.newProgress.__events.map((event) =>
        isRecord(event) && event.id === result.event.id ? stableEvent : event
      )
    : [stableEvent];
  return {
    ...result.newProgress,
    __events: events,
  };
}

async function ensureProfileExists(
  admin: AdminClient,
  user: { id: string; email?: string | null; user_metadata?: Record<string, unknown> },
) {
  const { data: profile, error: profileReadError } = await admin
    .from("profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();

  if (profileReadError) {
    throw new OnboardingPersistenceError("profile lookup", profileReadError);
  }

  if (profile) return;

  const metadataName =
    typeof user.user_metadata?.name === "string" ? user.user_metadata.name.trim() : "";
  const { error: profileInsertError } = await admin.from("profiles").insert({
    id: user.id,
    name: metadataName || user.email?.split("@")[0] || "사용자",
    email: user.email ?? null,
    onboarding_completed: false,
    onboarding_step: 0,
  });

  if (profileInsertError) {
    throw new OnboardingPersistenceError("profile creation", profileInsertError);
  }
}

async function completeProfile(
  admin: AdminClient,
  userId: string,
  coupleId: string,
) {
  const { data: profile, error } = await admin
    .from("profiles")
    .update({ onboarding_completed: true, onboarding_step: 5 })
    .eq("id", userId)
    .eq("couple_id", coupleId)
    .select("id, couple_id")
    .single();

  if (error || !profile || profile.couple_id !== coupleId) {
    throw new OnboardingPersistenceError("profile completion", error);
  }
}

type JourneyInput = {
  coupleId: string;
  actorUserId: string;
  isLinked: boolean;
  weddingDate: string | null;
  venue: string | null;
  totalBudget: number | null;
  progress: Record<string, unknown>;
  sanggyeonryeDate: string | null;
};

type OnboardingPlanOutcome = {
  status:
    | "unchanged"
    | "applied"
    | "pending_partner"
    | "rejected"
    | "stale";
  requestId?: string;
  summary?: string;
  fullPlanApplied: boolean;
  sanggyeonryeApplied: boolean;
  routineProgressDeferred: boolean;
};

type PlanChangeRpcClient = {
  rpc: (
    name: "submit_couple_plan_change",
    args: {
      p_couple_id: string;
      p_actor_user_id: string;
      p_expected_revision: number;
      p_changes: Record<string, unknown>;
      p_surface: "/dashboard";
      p_summary: string;
    },
  ) => Promise<{
    data: unknown;
    error: { code?: string; message?: string } | null;
  }>;
};

type ExistingJourneyPlan = {
  wedding_date?: string | null;
  venue?: string | null;
  total_budget?: number | null;
};

function parseInitialPlanResult(
  value: unknown,
  coupleId: string,
  expectedRevision: number,
  expectedSanggyeonryeDate: string | null,
  routineProgressDeferred: boolean,
): OnboardingPlanOutcome {
  if (!isRecord(value)
      || typeof value.requestId !== "string"
      || !REQUEST_ID_PATTERN.test(value.requestId)
      || typeof value.summary !== "string"
      || value.summary.length < 1
      || value.summary.length > 240
      || value.summary !== value.summary.trim()) {
    throw new OnboardingPersistenceError("initial plan response validation");
  }

  if (value.status === "pending_partner") {
    if (value.requiredCount !== 2
        || value.acceptedCount !== 1
        || value.isHighImpact !== true
        || value.journey !== null) {
      throw new OnboardingPersistenceError("initial plan pending validation");
    }
    return {
      status: "pending_partner",
      requestId: value.requestId,
      summary: value.summary,
      fullPlanApplied: false,
      sanggyeonryeApplied: false,
      routineProgressDeferred,
    };
  }

  if (value.status === "rejected" || value.status === "stale") {
    if (value.requiredCount !== 2
        || value.acceptedCount !== 1
        || value.isHighImpact !== true
        || value.appliedRevision !== null
        || value.journey !== null) {
      throw new OnboardingPersistenceError("initial plan terminal validation");
    }
    return {
      status: value.status,
      requestId: value.requestId,
      summary: value.summary,
      fullPlanApplied: false,
      sanggyeonryeApplied: false,
      routineProgressDeferred,
    };
  }

  if (value.status !== "applied"
      || (value.requiredCount !== 1 && value.requiredCount !== 2)
      || value.acceptedCount !== value.requiredCount
      || value.appliedRevision !== expectedRevision + 1
      || typeof value.isHighImpact !== "boolean"
      || !isRecord(value.journey)
      || value.journey.couple_id !== coupleId
      || value.journey.state_revision !== expectedRevision + 1) {
    throw new OnboardingPersistenceError("initial plan applied validation");
  }

  if (
    expectedSanggyeonryeDate
    && !hasSanggyeonryeEvent(
      storedProgress(value.journey.progress),
      expectedSanggyeonryeDate,
    )
  ) {
    throw new OnboardingPersistenceError("initial plan schedule verification");
  }

  return {
    status: "applied",
    requestId: value.requestId,
    summary: value.summary,
    fullPlanApplied: true,
    sanggyeonryeApplied: expectedSanggyeonryeDate !== null,
    routineProgressDeferred,
  };
}

async function submitInitialJourneyPlan(
  admin: AdminClient,
  input: JourneyInput,
  expectedRevision: number,
  options: {
    includeInputProgress?: boolean;
    progressPatch?: Record<string, unknown>;
    current?: ExistingJourneyPlan;
    routineProgressDeferred?: boolean;
  } = {},
): Promise<OnboardingPlanOutcome> {
  const includeInputProgress = options.includeInputProgress ?? true;
  const progressPatch =
    options.progressPatch
    ?? (includeInputProgress ? input.progress : {});
  const changes: Record<string, unknown> = {};
  if (input.weddingDate && input.weddingDate !== options.current?.wedding_date) {
    changes.wedding_date = input.weddingDate;
  }
  if (input.venue && input.venue !== options.current?.venue) {
    changes.venue = input.venue;
  }
  if (input.totalBudget && input.totalBudget !== options.current?.total_budget) {
    changes.total_budget = input.totalBudget;
  }
  if (Object.keys(progressPatch).length > 0) {
    changes.progress_patch = progressPatch;
  }
  if (Object.keys(changes).length === 0) {
    return {
      status: "unchanged",
      fullPlanApplied: false,
      sanggyeonryeApplied: false,
      routineProgressDeferred: options.routineProgressDeferred ?? false,
    };
  }
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw new OnboardingPersistenceError("journey revision validation");
  }

  const { data, error } = await (admin as unknown as PlanChangeRpcClient).rpc(
    "submit_couple_plan_change",
    {
      p_couple_id: input.coupleId,
      p_actor_user_id: input.actorUserId,
      p_expected_revision: expectedRevision,
      p_changes: changes,
      p_surface: "/dashboard",
      p_summary: "온보딩에서 입력한 결혼 준비 정보를 저장해요.",
    },
  );
  if (error) {
    throw new OnboardingPersistenceError("initial plan submission", error);
  }
  return parseInitialPlanResult(
    data,
    input.coupleId,
    expectedRevision,
    input.sanggyeonryeDate !== null
      && hasSanggyeonryeEvent(progressPatch, input.sanggyeonryeDate)
      ? input.sanggyeonryeDate
      : null,
    options.routineProgressDeferred ?? false,
  );
}

function hasHighImpactScalarChange(
  input: JourneyInput,
  current: ExistingJourneyPlan,
): boolean {
  return (
    Boolean(input.weddingDate)
      && input.weddingDate !== current.wedding_date
  ) || (
    Boolean(input.venue)
      && input.venue !== current.venue
  ) || (
    Boolean(input.totalBudget)
      && input.totalBudget !== current.total_budget
  );
}

function buildSanggyeonryeProgressPatch(
  existingProgress: Record<string, unknown>,
  requestedDate: string | null,
): Record<string, unknown> {
  if (!requestedDate) return {};
  const inspection = inspectScheduleEvents(existingProgress);
  if (
    inspection.malformedContainer
    || inspection.rejectedCount > 0
    || inspection.truncatedCount > 0
  ) {
    // Schedule helpers intentionally expose only validated, bounded events.
    // Appending to that filtered view would replace the raw array and silently
    // discard legacy or malformed entries, so preserve it for explicit repair.
    throw new ScheduleEventsRepairRequiredError();
  }
  const existingDates = [
    ...new Set(
      inspection.events
        .filter(
          (event) =>
            getScheduleEventStatus(event) !== "cancelled"
            && event.momentType === "sanggyeonrye",
        )
        .map((event) => event.date),
    ),
  ];
  if (existingDates.length > 1) {
    throw new ScheduleEventsRepairRequiredError();
  }
  const existingDate = existingDates[0] ?? null;
  if (existingDate && existingDate !== requestedDate) {
    throw new SanggyeonryeDateConflictError(existingDate, requestedDate);
  }
  if (existingDate === requestedDate) return {};

  const updated = upsertStableOnboardingSanggyeonryeEvent(
    existingProgress,
    requestedDate,
  );
  return { __events: updated.__events };
}

async function readJourney(admin: AdminClient, coupleId: string) {
  const { data, error } = await admin
    .from("wedding_journeys")
    .select("id, wedding_date, venue, total_budget, progress, state_revision")
    .eq("couple_id", coupleId)
    .maybeSingle();

  if (error) {
    throw new OnboardingPersistenceError("journey lookup", error);
  }

  if (data && typeof data.id !== "string") {
    throw new OnboardingPersistenceError("journey lookup validation");
  }

  return data;
}

async function ensureJourney(admin: AdminClient, input: JourneyInput) {
  let journey = await readJourney(admin, input.coupleId);

  if (!journey) {
    const { data: inserted, error: insertError } = await admin
      .from("wedding_journeys")
      .insert({
        couple_id: input.coupleId,
        wedding_date: null,
        venue: null,
        total_budget: 0,
        progress: {},
      })
      .select("id, progress, state_revision")
      .single();

    if (!insertError && inserted) {
      if (typeof inserted.id !== "string"
          || inserted.state_revision !== 0) {
        throw new OnboardingPersistenceError("journey creation verification");
      }
      const highImpactScalarChange = hasHighImpactScalarChange(input, {
        wedding_date: null,
        venue: null,
        total_budget: 0,
      });
      const routineProgressDeferred =
        input.isLinked
        && highImpactScalarChange
        && Object.keys(input.progress).length > 0;
      const progressPatch = {
        ...(routineProgressDeferred ? {} : input.progress),
        ...buildSanggyeonryeProgressPatch({}, input.sanggyeonryeDate),
      };
      return submitInitialJourneyPlan(
        admin,
        input,
        inserted.state_revision,
        {
          includeInputProgress: false,
          progressPatch,
          routineProgressDeferred,
        },
      );
    }

    // A lost-response retry or the partner can win the unique(couple_id)
    // insert race. Re-read that canonical row; every other failure is fatal.
    if (insertError?.code !== "23505") {
      throw new OnboardingPersistenceError("journey creation", insertError);
    }

    journey = await readJourney(admin, input.coupleId);
    if (!journey) {
      throw new OnboardingPersistenceError("journey creation race recovery", insertError);
    }
  }

  const existingProgress = storedProgress(journey.progress);
  const mayInitializeProgress =
    journey.progress === null
    || (isRecord(journey.progress) && Object.keys(journey.progress).length === 0);
  const current = {
    wedding_date:
      typeof journey.wedding_date === "string" ? journey.wedding_date : null,
    venue: typeof journey.venue === "string" ? journey.venue : null,
    total_budget:
      typeof journey.total_budget === "number" ? journey.total_budget : null,
  };
  const routineProgressRequested = Object.keys(input.progress).length > 0;
  const routineProgressDeferred =
    routineProgressRequested
    && (
      !mayInitializeProgress
      || (input.isLinked && hasHighImpactScalarChange(input, current))
    );
  const progressPatch = {
    ...(mayInitializeProgress && !routineProgressDeferred ? input.progress : {}),
    ...buildSanggyeonryeProgressPatch(
      existingProgress,
      input.sanggyeonryeDate,
    ),
  };

  return submitInitialJourneyPlan(
    admin,
    input,
    Number(journey.state_revision),
    {
      // An existing shared plan is authoritative. Onboarding may propose the
      // user's explicit date, venue and total, but must not replace the
      // partner's checklist or preferences wholesale. A truly neutral
      // bootstrap row is the sole safe case where onboarding may initialize it.
      includeInputProgress: false,
      progressPatch,
      current,
      routineProgressDeferred,
    },
  );
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export async function POST(request: Request) {
  try {
    if (!isTrustedMutationRequest(request)) {
      return privateResponse({ error: "허용되지 않은 요청입니다." }, 403);
    }
    const rawBody = await readBoundedUtf8Text(
      request,
      MAX_ONBOARDING_BODY_BYTES,
    );
    if (!rawBody.ok) {
      return privateResponse(
        {
          error: rawBody.reason === "too_large"
            ? "요청 내용이 너무 큽니다."
            : "요청을 읽지 못했습니다.",
        },
        rawBody.reason === "too_large" ? 413 : 400,
      );
    }
    let body: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(rawBody.text);
      if (!isRecord(parsed)) throw new Error("body must be an object");
      body = parsed;
    } catch {
      return privateResponse({ error: "요청 형식이 올바르지 않습니다." }, 400);
    }

    const supabase = await createClientFromRequest(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return privateResponse({ error: "인증이 필요합니다." }, 401);
    }

    // 온보딩은 (auth) 라우트 그룹이라 AuthenticatedAppShell 의 동의 관문 밖에
    // 있다. 콜백에서 /consent 로 돌려세워도 주소를 직접 치면 이 화면에 닿고,
    // 여기서 커플과 예식일이 **실제로 만들어진다.** 화면이 아니라 쓰는 자리를
    // 막는다 — 모바일 등 다른 클라이언트도 같은 관문을 지난다.
    if (!hasWebSignupConsentAccess(user)) {
      return privateResponse(
        {
          error: "이용약관과 개인정보 처리방침에 동의해야 시작할 수 있어요.",
          code: "SIGNUP_CONSENT_REQUIRED",
        },
        400,
      );
    }

    const {
      role: rawRole,
      membershipMode: rawMembershipMode,
      coupleAction: rawCoupleAction,
      partnerInviteCode,
      weddingDate: rawWeddingDate,
      venue: rawVenue,
      sanggyeonryeDate: rawSanggyeonryeDate,
      totalBudget: rawTotalBudget,
      progress,
    } = body;

    // 중립 준비 공간: 역할을 묻지 않고 시작한다. 내부 슬롯 배정은 DB 함수가 하고,
    // 앱은 그 값을 정체성으로 취급하지 않는다.
    if (
      rawMembershipMode !== undefined
      && rawMembershipMode !== "neutral_preparation_space"
    ) {
      return privateResponse({ error: "유효하지 않은 준비 공간 방식입니다." }, 400);
    }
    const neutralPreparationSpace =
      rawMembershipMode === "neutral_preparation_space";
    if (
      neutralPreparationSpace
      && process.env.AMORA_NEUTRAL_PREPARATION_SPACE_ENABLED !== "true"
    ) {
      return privateResponse({
        error: "중립 준비 공간을 아직 사용할 수 없습니다.",
        code: "NEUTRAL_PREPARATION_SPACE_UNAVAILABLE",
      }, 404);
    }
    if (neutralPreparationSpace && rawRole !== undefined && rawRole !== null) {
      return privateResponse({ error: "중립 준비 공간에는 역할을 보내지 않습니다." }, 400);
    }
    if (!neutralPreparationSpace && rawRole !== "bride" && rawRole !== "groom") {
      return privateResponse({ error: "유효하지 않은 역할입니다." }, 400);
    }
    const role: CoupleRole | null = neutralPreparationSpace
      ? null
      : (rawRole as CoupleRole);

    if (rawCoupleAction !== "create" && rawCoupleAction !== "join") {
      return privateResponse({ error: "유효하지 않은 커플 연결 방식입니다." }, 400);
    }
    const coupleAction: MembershipAction = rawCoupleAction;

    let normalizedInviteCode: string | null = null;
    if (coupleAction === "join") {
      const limited = await checkRateLimitPersistent(
        rateLimitKey("onboarding_couple_join", request, user.id),
        ONBOARDING_JOIN_RATE,
        { failClosed: true },
      );
      if (limited) {
        limited.headers.set(
          "Cache-Control",
          PRIVATE_NO_STORE_HEADERS["Cache-Control"],
        );
        return limited;
      }

      if (typeof partnerInviteCode !== "string") {
        return privateResponse({ error: "파트너 초대 코드를 입력해주세요." }, 400);
      }

      normalizedInviteCode = partnerInviteCode.trim().toUpperCase();
      if (!/^WH-[A-Z0-9]{6,12}$/.test(normalizedInviteCode)) {
        return privateResponse({ error: "초대 코드 형식이 올바르지 않습니다." }, 400);
      }
    }

    const hasWeddingDateInput =
      rawWeddingDate !== undefined
      && rawWeddingDate !== null
      && rawWeddingDate !== "";
    if (hasWeddingDateInput && !validDate(rawWeddingDate)) {
      return privateResponse({ error: "결혼식 날짜 형식이 올바르지 않습니다." }, 400);
    }
    const weddingDate = validDate(rawWeddingDate) ? rawWeddingDate : null;
    if (rawVenue !== undefined && rawVenue !== null && typeof rawVenue !== "string") {
      return privateResponse({ error: "예식장 형식이 올바르지 않습니다." }, 400);
    }
    const normalizedVenue = typeof rawVenue === "string" ? rawVenue.trim() : "";
    if (
      Array.from(normalizedVenue).length > 100
      || UNSAFE_DISPLAY_CHARACTER.test(normalizedVenue)
    ) {
      return privateResponse({ error: "예식장 이름을 다시 확인해주세요." }, 400);
    }
    const venue = normalizedVenue || null;
    const normalizedBudget = normalizeOnboardingBudget(rawTotalBudget);
    if (!normalizedBudget.ok) {
      return privateResponse(
        { error: "총 예산은 10억 원 이하의 금액으로 입력해주세요." },
        400,
      );
    }
    const totalBudget = normalizedBudget.totalBudgetWon;
    const hasSanggyeonryeDateInput =
      rawSanggyeonryeDate !== undefined
      && rawSanggyeonryeDate !== null
      && rawSanggyeonryeDate !== "";
    if (hasSanggyeonryeDateInput && !validDate(rawSanggyeonryeDate)) {
      return privateResponse(
        { error: "양쪽 부모님 첫 만남 날짜 형식이 올바르지 않습니다." },
        400,
      );
    }
    const sanggyeonryeDate = validDate(rawSanggyeonryeDate)
      ? rawSanggyeonryeDate
      : null;
    const baseProgress = parseOnboardingProgress(progress);
    if (!baseProgress) {
      return privateResponse(
        { error: "준비 현황 형식이 올바르지 않습니다." },
        400,
      );
    }

    const admin = getAdmin();
    await ensureProfileExists(admin, user);

    // 2026-09-04 실측: 신부가 만든 유효한 코드에 신랑이 역할만 '신부'로 고르면 DB 는
    // INVALID_INVITE_CODE(같은 역할은 못 들어감)를 돌려주고, 화면은 "초대 코드가 올바르지
    // 않습니다" 라고 해서 사용자가 코드 오타를 의심하며 재시도 한도(10회/10분)만 태웠다.
    // 코드로 커플을 먼저 찾아, 고른 역할의 자리가 **다른 사람**으로 이미 차 있고 반대
    // 자리가 비어 있으면 기존 ROLE_MISMATCH 문구로 안내한다. 중립 공간(역할 없음)과
    // 본인 재합류(멱등)는 건드리지 않는다. 그 밖의 판정은 그대로 DB 가 한다.
    if (
      !neutralPreparationSpace && coupleAction === "join" && normalizedInviteCode && role
      && await inviteRoleMismatchForJoin(admin as unknown as Parameters<typeof inviteRoleMismatchForJoin>[0], {
        inviteCode: normalizedInviteCode,
        role,
        actorUserId: user.id,
      })
    ) {
      return privateResponse(
        { error: "파트너가 만든 커플과 반대 역할을 선택해 주세요.", code: "ROLE_MISMATCH" },
        409,
      );
    }

    let rpcResponse = neutralPreparationSpace
      ? coupleAction === "create"
        ? await supabase.rpc("create_neutral_preparation_space_for_current_user", {})
        : await joinNeutralPreparationSpaceThroughServerRpc(admin, {
            actorUserId: user.id,
            inviteCode: normalizedInviteCode!,
          })
      : coupleAction === "create"
        ? await supabase.rpc("create_couple_for_current_user", { p_role: role! })
        : await joinCoupleThroughServerRpc(admin, {
            actorUserId: user.id,
            inviteCode: normalizedInviteCode!,
            role: role!,
          });
    // 새 방식 화면으로 **옛 방식 공간**에 들어온 경우 옛 경로로 되부른다.
    //
    // ## 무엇이 막혀 있었나 (2026-08-31 운영 실측)
    //
    // `join_neutral_preparation_space_server` 는 대상 공간이 `member_model_version
    // <> 2` 이면 `LEGACY_PREPARATION_SPACE` 로 거절한다. 그런데 운영의 커플 57쌍 중
    // **55쌍이 model 1** 이고 그중 **17쌍이 "혼자 + 초대 열림"** 이었다 — 8월 하순
    // 전에 시작한 사람은 배우자를 연결할 방법이 아예 없었다.
    //
    // 거절 문구는 "코드를 만든 분에게 새 코드를 요청해 주세요" 인데 **새 코드를
    // 받아도 같은 공간이라 똑같이 거절된다.** 그리고 그 거절은 시도 기록을 남기기
    // 전에 일어나 DB 에 흔적조차 없었다 — 사용자에게는 아무 일도 안 일어나는 것으로
    // 보였다.
    //
    // ## 왜 역할을 묻지 않고 두 번 시도하나
    //
    // 옛 공간은 자리가 둘이고, 초대가 열려 있다는 것은 한 자리가 비었다는 뜻이다.
    // 신랑이 차 있으면 들어오는 사람은 신부다 — 고를 것이 없으므로 새 방식 화면이
    // 역할을 묻지 않는 것과 어긋나지 않는다.
    //
    // 어느 자리가 비었는지는 **RPC 만 안다.** `couples` 를 여기서 직접 읽는 길도
    // 있지만 그건 이 라우트의 DB 접근 경계를 고정한 검사가 막는다(그 경계가 생긴
    // 이유는 `coupleConnectionSettings.test.ts` 에 적혀 있다). 그래서 신부로 한 번,
    // 안 되면 신랑으로 한 번 부른다. 실패한 시도는 아무것도 바꾸지 않고, 한도는
    // 10분에 10번이라 두 번 써도 넉넉하다.
    let legacyFallbackRole: "bride" | "groom" | null = null;
    if (neutralPreparationSpace && coupleAction === "join" && !rpcResponse.error) {
      // 오류 코드는 정본 파서로 읽는다. 여기서 직접 꺼내면 그쪽의 레거시 문구
      // 매핑(`LEGACY_ERROR_CODES`)과 어긋날 수 있다.
      const neutralAttempt = parseNeutralMembershipRpcResponse(rpcResponse.data, coupleAction);
      if (!neutralAttempt.ok && neutralAttempt.errorCode === "LEGACY_PREPARATION_SPACE") {
        for (const candidate of ["bride", "groom"] as const) {
          // 앞서 동의와 인증을 확인한 본인만 서버 전용 경로로 연결한다.
          const retry = await joinCoupleThroughServerRpc(admin, {
            actorUserId: user.id,
            inviteCode: normalizedInviteCode!,
            role: candidate,
          });
          rpcResponse = retry;
          legacyFallbackRole = candidate;
          if (retry.error) break;
          const outcome = parseMembershipRpcResponse(retry.data, candidate, coupleAction, user.id);
          if (outcome.ok || outcome.errorCode !== "INVALID_INVITE_CODE") break;
        }
      }
    }

    if (rpcResponse.error) {
      console.error(`[onboarding ${coupleAction}] membership RPC failed`, rpcResponse.error);
      // 함수 자체가 없으면(=마이그레이션 미적용) "잠시 후 다시" 는 거짓말이다.
      // 몇 번을 눌러도 안 되고, 사용자는 자기가 뭘 잘못한 줄 안다.
      if (isMembershipRpcMissing(rpcResponse.error)) {
        return privateResponse(
          {
            error: neutralPreparationSpace
              ? "새 방식 준비 공간을 아직 사용할 수 없어요. 잠시 뒤 다시 열립니다."
              : "커플 연결 기능을 일시적으로 사용할 수 없어요.",
            code: "MEMBERSHIP_RPC_UNAVAILABLE",
          },
          503,
        );
      }
      return privateResponse(
        { error: "커플 연결을 완료하지 못했습니다. 잠시 후 다시 시도해주세요." },
        500,
      );
    }

    const membership = legacyFallbackRole
      ? parseMembershipRpcResponse(rpcResponse.data, legacyFallbackRole, coupleAction, user.id)
      : neutralPreparationSpace
        ? parseNeutralMembershipRpcResponse(rpcResponse.data, coupleAction)
        : parseMembershipRpcResponse(rpcResponse.data, role!, coupleAction, coupleAction === "join" ? user.id : undefined);
    if (!membership.ok) {
      console.warn(`[onboarding ${coupleAction}] membership rejected`, membership.errorCode);
      return privateResponse({ error: membership.message }, membership.status);
    }

    try {
      const planOutcome = await ensureJourney(admin, {
        coupleId: membership.coupleId,
        actorUserId: user.id,
        isLinked: coupleAction === "join" || membership.idempotent,
        weddingDate,
        venue,
        totalBudget,
        progress: baseProgress,
        sanggyeonryeDate,
      });
      if (planOutcome.status === "rejected" || planOutcome.status === "stale") {
        return privateResponse(
          {
            error:
              planOutcome.status === "rejected"
                ? "파트너가 이 계획에 동의하지 않았어요. 내용을 바꾸거나 해당 항목을 비워 다시 저장해주세요."
                : "계획이 달라져 요청을 다시 확인해야 해요. 최신 내용을 확인한 뒤 다시 저장해주세요.",
            planChange: {
              status: planOutcome.status,
              requestId: planOutcome.requestId,
              summary: planOutcome.summary,
            },
          },
          409,
        );
      }
      // Completion is the final durable step. If plan persistence fails, the
      // user must remain in onboarding so their inputs can be retried safely.
      await completeProfile(admin, user.id, membership.coupleId);
      const shouldRecordFullPlan = planOutcome.fullPlanApplied;
      const shouldRecordSanggyeonrye = planOutcome.sanggyeonryeApplied;

      // Optional memory enrichment is deliberately outside the core completion
      // transaction. Pending partner decisions must never be recorded as facts.
      void (async () => {
        try {
          const stageTag = determineStage(weddingDate);
          const baseMeta = neutralPreparationSpace
            ? {
                hook: "onboarding",
                membershipMode: "neutral_preparation_space",
                coupleAction,
              }
            : { hook: "onboarding", role, coupleAction };

          if (weddingDate && shouldRecordFullPlan) {
            await recordDecision({
              coupleId: membership.coupleId,
              userId: user.id,
              category: "timeline",
              title: "결혼식 날짜 확정",
              chosenValue: { wedding_date: weddingDate },
              decisionType: "decided",
              stageTag,
              source: "onboarding",
              confidence: 0.95,
              metadata: baseMeta,
            });
          }

          if (venue && shouldRecordFullPlan) {
            await recordDecision({
              coupleId: membership.coupleId,
              userId: user.id,
              category: "venue",
              title: venue,
              chosenValue: { venue },
              decisionType: "considering",
              stageTag,
              source: "onboarding",
              confidence: 0.7,
              metadata: baseMeta,
            });
          }

          if (sanggyeonryeDate && shouldRecordSanggyeonrye) {
            await recordDecision({
              coupleId: membership.coupleId,
              userId: user.id,
              category: "timeline",
              title: "양쪽 부모님 첫 만남 일정",
              chosenValue: { sanggyeonrye_date: sanggyeonryeDate },
              decisionType: "decided",
              stageTag,
              source: "onboarding",
              confidence: 0.9,
              metadata: baseMeta,
            });
          }

          if (totalBudget && shouldRecordFullPlan) {
            await recordDecision({
              coupleId: membership.coupleId,
              userId: user.id,
              category: "budget",
              title: "총 예산 설정",
              chosenValue: { total_budget: totalBudget },
              decisionType: "decided",
              stageTag,
              source: "onboarding",
              confidence: 0.9,
              metadata: baseMeta,
            });
          }
        } catch (error) {
          console.error("[onboarding recordDecision] optional enrichment failed", error);
        }
      })();

      return privateResponse({
        success: true,
        coupleId: membership.coupleId,
        inviteCode: membership.inviteCode,
        created: membership.changed,
        idempotent: membership.idempotent,
        planChange: {
          status: planOutcome.status,
          requestId: planOutcome.requestId,
          summary: planOutcome.summary,
        },
        routineProgress: planOutcome.routineProgressDeferred
          ? {
              status: "deferred",
              message:
                "입력한 준비 현황과 결혼식 선호는 이번 요청에 반영되지 않았어요. 계획 변경이 결정된 뒤 다시 입력해주세요.",
            }
          : undefined,
      });
    } catch (error) {
      if (error instanceof ScheduleEventsRepairRequiredError) {
        return privateResponse(
          {
            error:
              "저장된 일정 중 확인이 필요한 항목이 있어 양쪽 부모님 첫 만남 날짜를 저장하지 않았어요. 날짜 입력을 비우고 계속하거나, 기존 일정을 정리한 뒤 다시 시도해주세요.",
            code: "SCHEDULE_EVENTS_REPAIR_REQUIRED",
          },
          409,
        );
      }
      if (error instanceof SanggyeonryeDateConflictError) {
        return privateResponse(
          {
            error:
              `이미 저장된 양쪽 부모님 첫 만남 날짜(${error.existingDate})와 요청한 날짜(${error.requestedDate})가 달라요. 기존 일정을 확인한 뒤 다시 입력해주세요.`,
            code: "SANGGYEONRYE_DATE_CONFLICT",
            conflict: {
              field: "sanggyeonryeDate",
              existingDate: error.existingDate,
              requestedDate: error.requestedDate,
            },
          },
          409,
        );
      }
      if (
        error instanceof OnboardingPersistenceError
        && /COUPLE_PLAN_CHANGE_UNSUPPORTED_MIXED_DELTA/i.test(
          persistenceCauseText(error),
        )
      ) {
        return privateResponse(
          {
            error:
              "파트너 연결 상태가 방금 바뀌어 입력을 안전하게 저장하지 않았어요. 최신 상태로 다시 시도해주세요.",
            code: "ONBOARDING_PLAN_RETRY_REQUIRED",
          },
          409,
        );
      }
      // The membership RPC is atomic and idempotent, so a retry finishes these
      // post-steps against the same couple instead of creating another couple.
      console.error(`[onboarding ${coupleAction}] completion failed`, error);
      return privateResponse(
        { error: "온보딩 저장을 완료하지 못했습니다. 잠시 후 다시 시도해주세요." },
        500,
      );
    }

  } catch (error) {
    console.error("[onboarding] unexpected error", error);
    return privateResponse(
      { error: "서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요." },
      500,
    );
  }
}
