import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import {
  cleanOptionalIsoDate,
  isRecord,
  isUuid,
  readBoundedUtf8Text,
  sanitizeJsonObject,
} from "@/utils/requestValidation";
import { isValidWeddingWonAmount } from "@/lib/weddingBudget";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { sanitizeText } from "@/utils/sanitize";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";
import { PLANNING_CATEGORY_LABELS } from "@/constants/planningCategories";
import { log } from "@/utils/log";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const MAX_BODY_BYTES = 128 * 1024;
const MAX_SUMMARY_CHARS = 240;
const MAX_VENUE_CHARS = 120;
const MAX_BUDGET_LABEL_CHARS = 200;
const MAX_CHECKLIST_ID_CHARS = 120;
const MAX_CHECKLIST_LABEL_CHARS = 400;
const MAX_PROGRESS_DEPTH = 8;
const MAX_PROGRESS_ARRAY_LENGTH = 500;
const MAX_PROGRESS_OBJECT_KEYS = 300;
const MAX_PROGRESS_STRING_CHARS = 1_500;
const MAX_PROGRESS_REMOVE_KEYS = 50;
const MAX_REVISION_BEFORE_UPDATE = Number.MAX_SAFE_INTEGER - 1;
const PROGRESS_KEY_PATTERN = /^[a-zA-Z0-9_.:-]{1,80}$/;
const FORBIDDEN_OBJECT_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const BUDGET_PROGRESS_FIELDS = new Set([
  "budget",
  "spent",
  "cost",
  "payer",
]);
const BUDGET_PAYER_VALUES = new Set([
  "couple",
  "bride_parents",
  "groom_parents",
  "both_parents",
]);
const BUDGET_ITEM_FIELDS = new Set([
  "budget",
  "spent",
  "payer",
  "category",
  "label",
]);
const KNOWN_BUDGET_CATEGORY_KEYS = new Set(
  Object.keys(PLANNING_CATEGORY_LABELS),
);
const VALID_CHECKLIST_STATUSES = new Set([
  "not_started",
  "in_progress",
  "completed",
  "not_applicable",
]);
const VALID_SURFACES = new Set(["/schedule", "/budget", "/dashboard"]);
const SCHEDULE_PROGRESS_FIELDS = new Set([
  "__events",
  "checklist",
  "status",
  "assigned_to",
  "responsibility",
  "dueDate",
  "due_date",
]);
const PATCH_KEYS = new Set([
  "expected_revision",
  "expected_couple_id",
  "wedding_date",
  "total_budget",
  "venue",
  "progress",
  "progress_patch",
  "progress_remove_keys",
]);
const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
};

type PlanChangeStatus =
  | "applied"
  | "pending_partner"
  | "stale"
  | "rejected";

type PlanChangeResult = {
  requestId: string;
  status: PlanChangeStatus;
  requiredCount: number;
  acceptedCount: number;
  summary?: string;
  surface?: ParsedPatch["surface"];
  journey?: Record<string, unknown>;
};

type ParsedPatch = {
  expectedRevision: number;
  expectedCoupleId: string;
  changes: Record<string, unknown>;
  summary: string;
  surface: "/schedule" | "/budget" | "/dashboard";
};

type ParsePatchResult =
  | { ok: true; value: ParsedPatch }
  | { ok: false; error: string };

function privateResponse(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: PRIVATE_NO_STORE_HEADERS,
  });
}

function privateNoStore(response: Response) {
  response.headers.set(
    "Cache-Control",
    PRIVATE_NO_STORE_HEADERS["Cache-Control"],
  );
  return response;
}

function hasOwn(record: object, key: string) {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function hasUnsafeDisplayCharacter(value: string) {
  return /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value);
}

function hasValidProgressShape(value: unknown, depth = 0): boolean {
  if (depth > MAX_PROGRESS_DEPTH) return false;
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") {
    return Array.from(value).length <= MAX_PROGRESS_STRING_CHARS
      && !hasUnsafeDisplayCharacter(value);
  }
  if (Array.isArray(value)) {
    return value.length <= MAX_PROGRESS_ARRAY_LENGTH
      && value.every((item) => hasValidProgressShape(item, depth + 1));
  }
  if (!isRecord(value)) return false;

  const entries = Object.entries(value);
  return entries.length <= MAX_PROGRESS_OBJECT_KEYS
    && entries.every(([key, item]) => (
      PROGRESS_KEY_PATTERN.test(key)
      && !FORBIDDEN_OBJECT_KEYS.has(key)
      && hasValidProgressShape(item, depth + 1)
    ));
}

function normalizeProgress(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value) || !hasValidProgressShape(value)) return null;
  return sanitizeJsonObject(value, {
    maxDepth: MAX_PROGRESS_DEPTH,
    maxArrayLength: MAX_PROGRESS_ARRAY_LENGTH,
    maxObjectKeys: MAX_PROGRESS_OBJECT_KEYS,
    maxStringLength: MAX_PROGRESS_STRING_CHARS,
  });
}

function hasValidBudgetFields(progress: Record<string, unknown>) {
  return Object.entries(progress).every(([key, item]) => {
    if (!isRecord(item)) {
      return !KNOWN_BUDGET_CATEGORY_KEYS.has(key)
        && !BUDGET_ITEM_FIELDS.has(key);
    }
    return (!hasOwn(item, "budget") || isValidWeddingWonAmount(item.budget))
      && (!hasOwn(item, "spent") || isValidWeddingWonAmount(item.spent))
      && (!hasOwn(item, "payer") || (
        typeof item.payer === "string"
        && BUDGET_PAYER_VALUES.has(item.payer)
      ))
      && (!hasOwn(item, "category") || item.category === key)
      && (!hasOwn(item, "label") || (
        typeof item.label === "string"
        && Array.from(item.label.trim()).length >= 1
        && Array.from(item.label).length <= MAX_BUDGET_LABEL_CHARS
        && !hasUnsafeDisplayCharacter(item.label)
      ));
  });
}

function hasValidChecklistFields(progress: Record<string, unknown>) {
  return Object.entries(progress).every(([key, item]) => {
    if (!KNOWN_BUDGET_CATEGORY_KEYS.has(key)) return true;
    if (!isRecord(item)) return false;
    if (hasOwn(item, "category") && item.category !== key) return false;
    if (hasOwn(item, "status") && (
      typeof item.status !== "string"
      || !VALID_CHECKLIST_STATUSES.has(item.status)
    )) return false;
    if (!hasOwn(item, "checklist")) return true;
    if (!Array.isArray(item.checklist)) return false;

    const ids = new Set<string>();
    let doneCount = 0;
    for (const checklistItem of item.checklist) {
      if (!isRecord(checklistItem)) return false;
      if (
        typeof checklistItem.id !== "string"
        || !PROGRESS_KEY_PATTERN.test(checklistItem.id)
        || Array.from(checklistItem.id).length > MAX_CHECKLIST_ID_CHARS
        || ids.has(checklistItem.id)
        || typeof checklistItem.label !== "string"
        || Array.from(checklistItem.label.trim()).length === 0
        || Array.from(checklistItem.label).length > MAX_CHECKLIST_LABEL_CHARS
        || hasUnsafeDisplayCharacter(checklistItem.label)
        || typeof checklistItem.done !== "boolean"
      ) return false;
      ids.add(checklistItem.id);
      if (checklistItem.done) doneCount += 1;
    }

    if (!hasOwn(item, "status") || item.status === "not_applicable") return true;
    const derivedStatus = doneCount === 0 || item.checklist.length === 0
      ? "not_started"
      : doneCount === item.checklist.length
        ? "completed"
        : "in_progress";
    return item.status === derivedStatus;
  });
}

function jsonValuesEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((item, index) => jsonValuesEqual(item, right[index]));
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length
    && leftKeys.every(
      (key) => hasOwn(right, key) && jsonValuesEqual(left[key], right[key]),
    );
}

function progressSummary(changes: Record<string, unknown>) {
  if (hasOwn(changes, "progress")) return "진행 상황: 전체 변경";

  const patch = changes.progress_patch;
  const removeKeys = changes.progress_remove_keys;
  const patchCount = isRecord(patch) ? Object.keys(patch).length : 0;
  const removeCount = Array.isArray(removeKeys) ? removeKeys.length : 0;
  const parts: string[] = [];
  if (patchCount > 0) parts.push(`${patchCount}개 수정`);
  if (removeCount > 0) parts.push(`${removeCount}개 삭제`);
  return parts.length > 0 ? `진행 상황: ${parts.join(" · ")}` : null;
}

function deriveSummary(changes: Record<string, unknown>) {
  const parts: string[] = [];
  if (hasOwn(changes, "wedding_date")) {
    parts.push(
      changes.wedding_date === null
        ? "결혼 예정일: 미정"
        : `결혼 예정일: ${String(changes.wedding_date)}`,
    );
  }
  if (hasOwn(changes, "total_budget")) {
    parts.push(`총예산: ${String(changes.total_budget)}원`);
  }
  if (hasOwn(changes, "venue")) {
    parts.push(
      changes.venue === null
        ? "예식장: 미정"
        : `예식장: ${String(changes.venue)}`,
    );
  }
  const progress = progressSummary(changes);
  if (progress) parts.push(progress);

  const summary = parts.join(" · ");
  return Array.from(summary).length <= MAX_SUMMARY_CHARS ? summary : null;
}

function deriveSurface(
  changes: Record<string, unknown>,
): ParsedPatch["surface"] {
  const progressChange = hasOwn(changes, "progress")
    ? changes.progress
    : changes.progress_patch;
  const containsProgressField = (
    value: unknown,
    fields: ReadonlySet<string>,
  ): boolean => {
    if (Array.isArray(value)) {
      return value.some((item) => containsProgressField(item, fields));
    }
    if (!isRecord(value)) return false;
    return Object.entries(value).some(
      ([key, item]) => fields.has(key)
        || containsProgressField(item, fields),
    );
  };
  const touchesBudget =
    hasOwn(changes, "total_budget")
    || containsProgressField(progressChange, BUDGET_PROGRESS_FIELDS);
  const touchesSchedule =
    hasOwn(changes, "wedding_date")
    || containsProgressField(progressChange, SCHEDULE_PROGRESS_FIELDS);
  if (touchesBudget && !touchesSchedule) return "/budget";
  if (touchesSchedule && !touchesBudget) return "/schedule";
  return "/dashboard";
}

/** 한국 시간 기준 오늘(YYYY-MM-DD). toISOString() 은 UTC 라 새벽 0~9시에 하루가 어긋난다. */
function todayInSeoul(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function parsePatchBody(body: unknown): ParsePatchResult {
  if (
    !isRecord(body)
    || Object.keys(body).some((key) => !PATCH_KEYS.has(key))
    || !hasOwn(body, "expected_revision")
  ) {
    return { ok: false, error: "변경 요청 형식이 올바르지 않습니다." };
  }

  const expectedRevision = body.expected_revision;
  if (
    typeof expectedRevision !== "number"
    || !Number.isSafeInteger(expectedRevision)
    || expectedRevision < 0
    || expectedRevision > MAX_REVISION_BEFORE_UPDATE
  ) {
    return { ok: false, error: "변경 기준 버전이 올바르지 않습니다." };
  }

  if (!isUuid(body.expected_couple_id)) {
    return { ok: false, error: "변경 기준 커플 정보를 확인하지 못했어요. 최신 화면을 다시 불러와 주세요." };
  }
  const expectedCoupleId = body.expected_couple_id.toLowerCase();

  const changes: Record<string, unknown> = {};
  if (hasOwn(body, "wedding_date")) {
    const parsedDate = cleanOptionalIsoDate(body.wedding_date);
    if (
      parsedDate === undefined
      || (
        body.wedding_date !== null
        && (
          typeof body.wedding_date !== "string"
          || parsedDate !== body.wedding_date
          || body.wedding_date.startsWith("0000-")
        )
      )
    ) {
      return {
        ok: false,
        error: "결혼 예정일은 YYYY-MM-DD 형식의 실제 날짜여야 합니다.",
      };
    }
    // 2026-09-04 실측: 2020-01-01 이 그대로 저장돼 일정 화면이 "D-DAY +2438일 지남" 을
    // 그렸다. 결혼 준비 앱에서 지난 날짜는 오타다. 오늘(KST)은 허용한다.
    if (parsedDate !== null && parsedDate < todayInSeoul()) {
      return {
        ok: false,
        error: "결혼 예정일이 이미 지난 날짜예요. 오늘 이후 날짜로 입력해 주세요.",
      };
    }
    changes.wedding_date = parsedDate;
  }

  if (hasOwn(body, "total_budget")) {
    if (!isValidWeddingWonAmount(body.total_budget)) {
      return {
        ok: false,
        error: "예산은 0원 이상 10억원 이하의 정수여야 합니다.",
      };
    }
    changes.total_budget = body.total_budget;
  }

  if (hasOwn(body, "venue")) {
    if (!(body.venue === null || typeof body.venue === "string")) {
      return { ok: false, error: "예식장 형식이 올바르지 않습니다." };
    }
    if (typeof body.venue === "string") {
      if (
        Array.from(body.venue).length > MAX_VENUE_CHARS
        || hasUnsafeDisplayCharacter(body.venue)
      ) {
        return { ok: false, error: "예식장 형식이 올바르지 않습니다." };
      }
      const venue = sanitizeText(body.venue);
      changes.venue = venue.length > 0 ? venue : null;
    } else {
      changes.venue = null;
    }
  }

  const hasProgress = hasOwn(body, "progress");
  const hasProgressPatch = hasOwn(body, "progress_patch");
  const hasProgressRemove = hasOwn(body, "progress_remove_keys");
  if (hasProgress && (hasProgressPatch || hasProgressRemove)) {
    return {
      ok: false,
      error: "전체 진행 상황과 일부 진행 변경을 함께 보낼 수 없습니다.",
    };
  }

  if (hasProgress) {
    const progress = normalizeProgress(body.progress);
    if (!progress || !hasValidBudgetFields(progress) || !hasValidChecklistFields(progress)) {
      return { ok: false, error: "진행 데이터 형식이 올바르지 않습니다." };
    }
    changes.progress = progress;
  }

  let progressPatch: Record<string, unknown> | null = null;
  if (hasProgressPatch) {
    progressPatch = normalizeProgress(body.progress_patch);
    if (!progressPatch || !hasValidBudgetFields(progressPatch) || !hasValidChecklistFields(progressPatch)) {
      return { ok: false, error: "진행 패치 형식이 올바르지 않습니다." };
    }
    changes.progress_patch = progressPatch;
  }

  let removeKeys: string[] | null = null;
  if (hasProgressRemove) {
    if (
      !Array.isArray(body.progress_remove_keys)
      || body.progress_remove_keys.length > MAX_PROGRESS_REMOVE_KEYS
      || !body.progress_remove_keys.every(
        (key) => typeof key === "string"
          && PROGRESS_KEY_PATTERN.test(key)
          && !FORBIDDEN_OBJECT_KEYS.has(key),
      )
    ) {
      return { ok: false, error: "삭제할 진행 항목 형식이 올바르지 않습니다." };
    }
    removeKeys = body.progress_remove_keys;
    if (new Set(removeKeys).size !== removeKeys.length) {
      return { ok: false, error: "삭제할 진행 항목이 중복되었습니다." };
    }
    changes.progress_remove_keys = removeKeys;
  }

  if (
    progressPatch
    && removeKeys
    && removeKeys.some((key) => hasOwn(progressPatch, key))
  ) {
    return {
      ok: false,
      error: "같은 진행 항목을 수정하고 삭제할 수 없습니다.",
    };
  }

  if (
    (hasProgressPatch || hasProgressRemove)
    && (progressPatch ? Object.keys(progressPatch).length : 0) === 0
    && (removeKeys?.length ?? 0) === 0
  ) {
    return { ok: false, error: "수정할 진행 항목이 없습니다." };
  }

  if (Object.keys(changes).length === 0) {
    return { ok: false, error: "수정할 항목이 없습니다." };
  }

  const summary = deriveSummary(changes);
  if (!summary) {
    return { ok: false, error: "변경 요약을 안전하게 만들 수 없습니다." };
  }
  return {
    ok: true,
    value: {
      expectedRevision,
      expectedCoupleId,
      changes,
      summary,
      surface: deriveSurface(changes),
    },
  };
}

function parsePlanChangeResult(
  value: unknown,
  coupleId: string,
  expectedRevision?: number,
): PlanChangeResult | null {
  if (
    !isRecord(value)
    || !isUuid(value.requestId)
    || !(
      value.status === "applied"
      || value.status === "pending_partner"
      || value.status === "stale"
      || value.status === "rejected"
    )
    || typeof value.requiredCount !== "number"
    || !Number.isSafeInteger(value.requiredCount)
    || value.requiredCount < 1
    || value.requiredCount > 2
    || typeof value.acceptedCount !== "number"
    || !Number.isSafeInteger(value.acceptedCount)
    || value.acceptedCount < 0
    || value.acceptedCount > value.requiredCount
  ) {
    return null;
  }

  let journey: Record<string, unknown> | undefined;
  if (value.status === "applied") {
    if (
      value.acceptedCount !== value.requiredCount
      || !isRecord(value.journey)
      || value.journey.couple_id !== coupleId
      || typeof value.journey.state_revision !== "number"
      || !Number.isSafeInteger(value.journey.state_revision)
      || value.journey.state_revision < 0
      || (
        expectedRevision !== undefined
        && value.journey.state_revision <= expectedRevision
      )
    ) {
      return null;
    }
    journey = value.journey;
  } else if (
    (hasOwn(value, "journey") && value.journey !== null)
    || (
      value.status === "pending_partner"
      && (
        value.requiredCount !== 2
        || value.acceptedCount !== 1
      )
    )
  ) {
    return null;
  }
  const summary = value.summary;
  if (
    summary !== undefined
    && (
      typeof summary !== "string"
      || summary.length === 0
      || Array.from(summary).length > MAX_SUMMARY_CHARS
      || hasUnsafeDisplayCharacter(summary)
    )
  ) {
    return null;
  }
  const surface = value.surface;
  if (
    surface !== undefined
    && (
      typeof surface !== "string"
      || !VALID_SURFACES.has(surface)
    )
  ) {
    return null;
  }
  return {
    requestId: value.requestId.toLowerCase(),
    status: value.status,
    requiredCount: value.requiredCount,
    acceptedCount: value.acceptedCount,
    ...(typeof summary === "string" ? { summary } : {}),
    ...(typeof surface === "string"
      ? { surface: surface as ParsedPatch["surface"] }
      : {}),
    ...(journey ? { journey } : {}),
  };
}

function serviceErrorText(error: unknown) {
  if (!isRecord(error)) return String(error ?? "");
  return `${String(error.code ?? "")} ${String(error.message ?? "")} ${String(error.details ?? "")}`;
}

function serviceErrorResponse(error: unknown) {
  const text = serviceErrorText(error);
  if (/COUPLE_PLAN_CHANGE_(?:NOT_FOUND|JOURNEY_NOT_FOUND)/i.test(text)) {
    return privateResponse(
      {
        error: "변경 요청을 찾을 수 없습니다. 최신 화면을 다시 불러와 주세요.",
        code: "PLAN_CHANGE_NOT_FOUND",
      },
      404,
    );
  }
  if (/COUPLE_PLAN_CHANGE_SCOPE_DENIED/i.test(text)) {
    return privateResponse(
      {
        error: "이 변경 요청을 확인할 권한이 없습니다.",
        code: "PLAN_CHANGE_SCOPE_DENIED",
      },
      403,
    );
  }
  if (/COUPLE_PLAN_CHANGE_INVALID_SUMMARY_TOO_LONG/i.test(text)) {
    return privateResponse(
      {
        error: "함께 확인할 변경 내용이 너무 많아요. 날짜·예산·담당 변경을 나누어 요청해 주세요.",
        code: "PLAN_CHANGE_TOO_MANY_CHANGES",
      },
      400,
    );
  }
  if (/COUPLE_PLAN_CHANGE_UNSUPPORTED_MIXED_DELTA/i.test(text)) {
    return privateResponse(
      {
        error: "날짜·예산·식장 같은 공동 결정과 준비 현황 변경을 나누어 저장해 주세요.",
        code: "PLAN_CHANGE_MIXED_DELTA_UNSUPPORTED",
      },
      400,
    );
  }
  if (/COUPLE_PLAN_CHANGE_UNSUPPORTED_EVENT_DELTA/i.test(text)) {
    return privateResponse(
      {
        error: "공동 결정과 여러 일정 변경을 한 번에 묶지 말고 나누어 저장해 주세요.",
        code: "PLAN_CHANGE_EVENT_DELTA_UNSUPPORTED",
      },
      400,
    );
  }
  if (/COUPLE_PLAN_CHANGE_INVALID/i.test(text)) {
    return privateResponse(
      {
        error: "변경 요청이 올바르지 않습니다.",
        code: "PLAN_CHANGE_INVALID",
      },
      400,
    );
  }
  if (/COUPLE_PLAN_CHANGE_ACTIVE_REQUEST/i.test(text)) {
    return privateResponse(
      {
        error: "먼저 대기 중인 공동 확인 요청을 처리하거나 거절한 뒤 다시 변경해 주세요.",
        code: "PLAN_CHANGE_ACTIVE_REQUEST",
      },
      409,
    );
  }
  if (
    /COUPLE_PLAN_CHANGE_(?:STALE|EXPIRED|ALREADY_APPLIED|REJECTED|CONFLICT|ROSTER_CHANGED)/i
      .test(text)
  ) {
    return privateResponse(
      {
        error: "그 사이 준비 정보가 바뀌었어요. 최신 화면을 다시 불러와 주세요.",
        code: "PLAN_CHANGE_CONFLICT",
      },
      409,
    );
  }

  const code = isRecord(error) && typeof error.code === "string"
    ? error.code
    : "unknown";
  log.error("Couple plan-change RPC failed:", { code });
  return privateResponse(
    {
      error: "변경 요청의 저장 상태를 확인하지 못했어요. 잠시 후 다시 확인해 주세요.",
      code: "PLAN_CHANGE_UNAVAILABLE",
    },
    503,
  );
}

function submitResponse(
  result: PlanChangeResult,
  patch: ParsedPatch,
) {
  const common = {
    requestId: result.requestId,
    status: result.status,
    requiredCount: result.requiredCount,
    acceptedCount: result.acceptedCount,
    summary: result.summary ?? patch.summary,
    surface: result.surface ?? patch.surface,
  };
  if (result.status === "applied") {
    return privateResponse({ ...common, journey: result.journey });
  }
  if (result.status === "pending_partner") {
    return privateResponse(common, 202);
  }
  if (result.status === "stale") {
    return privateResponse(
      {
        ...common,
        error: "그 사이 준비 정보가 바뀌었어요. 최신 화면을 다시 불러와 주세요.",
        code: "PLAN_CHANGE_STALE",
      },
      409,
    );
  }
  return privateResponse(
    {
      ...common,
      error: "파트너가 이 변경을 거절했어요. 최신 화면을 다시 확인해 주세요.",
      code: "PLAN_CHANGE_REJECTED",
    },
    409,
  );
}

export async function PATCH(request: Request) {
  try {
    if (!isTrustedMutationRequest(request)) {
      return privateResponse({ error: "잘못된 요청 출처입니다." }, 403);
    }

    const bodyResult = await readBoundedUtf8Text(request, MAX_BODY_BYTES);
    if (!bodyResult.ok) {
      return privateResponse(
        {
          error: bodyResult.reason === "too_large"
            ? "요청 데이터가 너무 큽니다."
            : "요청 데이터를 읽지 못했습니다.",
        },
        bodyResult.reason === "too_large" ? 413 : 400,
      );
    }

    const supabase = await createClientFromRequest(request);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return privateResponse({ error: "인증이 필요합니다." }, 401);

    // 한도가 **정확히 10**이었다. 그래서 체크리스트에서 항목 열 개를 체크하면
    // 열한 번째부터 "요청이 너무 많습니다"로 막혔다 — 스트레스 테스트가 아니라
    // **평범한 사용에서 바로 걸리는 값**이었다(2026-08-22 파운더 제보).
    //
    // 이름은 `plan-change` 지만 이 한도는 **모든 PATCH 가 함께 쓴다.** 결혼 날짜·예산처럼
    // 드문 변경을 염두에 둔 값이 체크 토글에도 그대로 걸린 것이다. 체크리스트는 여러 개를
    // 연달아 누르는 화면이다.
    //
    // 40으로 올린다. 사람이 손으로 누르는 속도의 상한에 가깝고(1.5초에 하나씩 1분),
    // 사용자별 키라 남용은 자기 커플 기록에만 미친다. 몸집도 이미 제한돼 있다
    // (`MAX_BODY_BYTES`).
    //
    // 근본 수정은 클라이언트가 토글을 **묶어서** 보내는 것이다. 지금 `updateJourney` 는
    // 호출마다 요청 하나를 보내는데, 반환값으로 파트너 확인 대기·충돌·거절을 구분해
    // 화면이 그 결과를 쓰기 때문에 지연·병합이 그 계약을 깨뜨린다. 그래서 출시 뒤로 미뤘다.
    const limited = await checkRateLimitPersistent(
      rateLimitKey("journey:plan-change", request, user.id),
      { maxRequests: 40, windowMs: 60 * 1000 },
      { failClosed: true },
    );
    if (limited) return privateNoStore(limited);

    let rawBody: unknown;
    try {
      rawBody = JSON.parse(bodyResult.text);
    } catch {
      return privateResponse({ error: "잘못된 JSON 요청입니다." }, 400);
    }
    const parsed = parsePatchBody(rawBody);
    if (!parsed.ok) return privateResponse({ error: parsed.error }, 400);

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("couple_id")
      .eq("id", user.id)
      .single();
    if (profileError) {
      return privateResponse({ error: "커플 정보를 확인하지 못했어요." }, 503);
    }
    if (
      !isRecord(profile) || typeof profile.couple_id !== "string" ||
      profile.couple_id.toLowerCase() !== parsed.value.expectedCoupleId
    ) {
      return privateResponse({
        error: "커플 연결 상태가 바뀌었어요. 최신 화면을 다시 불러와 주세요.",
        code: "PLAN_CHANGE_IDENTITY_CHANGED",
      }, 409);
    }
    if (
      !isRecord(profile)
      || typeof profile.couple_id !== "string"
      || !isUuid(profile.couple_id)
    ) {
      return privateResponse({ error: "커플 연결이 필요합니다." }, 403);
    }

    // 확인 뒤 연결이 바뀌어도 RPC가 폼의 원래 커플 멤버십을 검증하도록 고정한다.
    const coupleId = parsed.value.expectedCoupleId;
    let rpcChanges = parsed.value.changes;
    if (hasOwn(rpcChanges, "progress")) {
      const nextProgress = rpcChanges.progress;
      if (!isRecord(nextProgress)) {
        return privateResponse({ error: "진행 데이터 형식이 올바르지 않습니다." }, 400);
      }

      const { data: currentJourney, error: currentJourneyError } = await supabase
        .from("wedding_journeys")
        .select("progress,state_revision")
        .eq("couple_id", coupleId)
        .single();
      if (
        currentJourneyError
        || !isRecord(currentJourney)
        || !isRecord(currentJourney.progress)
        || typeof currentJourney.state_revision !== "number"
        || !Number.isSafeInteger(currentJourney.state_revision)
        || currentJourney.state_revision < 0
      ) {
        return privateResponse(
          { error: "현재 준비 진행 상황을 확인하지 못했어요." },
          503,
        );
      }

      const progressPatch: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(nextProgress)) {
        if (!jsonValuesEqual(value, currentJourney.progress[key])) {
          progressPatch[key] = value;
        }
      }
      const progressRemoveKeys = Object.keys(currentJourney.progress)
        .filter((key) => !hasOwn(nextProgress, key));
      if (
        progressRemoveKeys.length > MAX_PROGRESS_REMOVE_KEYS
        || progressRemoveKeys.some(
          (key) => !PROGRESS_KEY_PATTERN.test(key)
            || FORBIDDEN_OBJECT_KEYS.has(key),
        )
      ) {
        return privateResponse(
          { error: "전체 진행 상황을 한 번에 안전하게 변경할 수 없습니다." },
          400,
        );
      }
      if (
        Object.keys(progressPatch).length === 0
        && progressRemoveKeys.length === 0
      ) {
        return privateResponse({ error: "수정할 진행 항목이 없습니다." }, 400);
      }

      rpcChanges = {};
      for (const [key, value] of Object.entries(parsed.value.changes)) {
        if (key !== "progress") rpcChanges[key] = value;
      }
      rpcChanges.progress_patch = progressPatch;
      rpcChanges.progress_remove_keys = progressRemoveKeys;
    }

    const { data, error } = await createAdminClient().rpc(
      "submit_couple_plan_change",
      {
        p_couple_id: coupleId,
        p_actor_user_id: user.id,
        p_expected_revision: parsed.value.expectedRevision,
        p_changes: rpcChanges,
        p_surface: parsed.value.surface,
        p_summary: parsed.value.summary,
      },
    );
    if (error) return serviceErrorResponse(error);

    const result = parsePlanChangeResult(
      data,
      coupleId,
      parsed.value.expectedRevision,
    );
    if (!result) {
      log.error("Couple plan-change RPC returned an invalid result.");
      return privateResponse(
        {
          error: "변경 요청의 저장 상태를 확인하지 못했어요. 잠시 후 다시 확인해 주세요.",
          code: "PLAN_CHANGE_UNAVAILABLE",
        },
        503,
      );
    }
    return submitResponse(result, parsed.value);
  } catch (error) {
    log.error("Journey plan-change API error:", error);
    return privateResponse({ error: "서버 오류" }, 500);
  }
}
