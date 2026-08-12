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
import {
  CATEGORY_CHECKLISTS,
  CHECKLIST_CATEGORY_LABELS,
  type WeddingChecklistCategoryKey,
} from "@hanbang/shared/constants";
import { PLANNING_CHECKLIST_PROFILE_KEY } from "@hanbang/shared/utils";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const MAX_BODY_BYTES = 128 * 1024;
const MAX_SUMMARY_CHARS = 240;
const MAX_VENUE_CHARS = 120;
const MAX_BUDGET_LABEL_CHARS = 200;
const MAX_CHECKLIST_ID_CHARS = 120;
const MAX_CHECKLIST_LABEL_CHARS = 400;
const MAX_CHECKLIST_NOTE_CHARS = 1_000;
const MAX_CHECKLIST_ASSIGNEE_LABEL_CHARS = 80;
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
const KNOWN_CHECKLIST_CATEGORY_KEYS = new Set(
  Object.keys(CHECKLIST_CATEGORY_LABELS),
);
function isKnownChecklistCategoryKey(key: string): key is WeddingChecklistCategoryKey {
  return KNOWN_CHECKLIST_CATEGORY_KEYS.has(key);
}
const KNOWN_CHECKLIST_ITEM_IDS = new Set(
  CATEGORY_CHECKLISTS.flatMap((category) => category.items.map((item) => item.id)),
);
const CHECKLIST_TEMPLATE_ITEMS_BY_CATEGORY = new Map(
  CATEGORY_CHECKLISTS.map((category) => [
    category.key,
    new Map(category.items.map((item) => [item.id, item.label])),
  ]),
);
const VALID_CHECKLIST_STATUSES = new Set([
  "not_started",
  "in_progress",
  "completed",
  "not_applicable",
]);
const VALID_CHECKLIST_ITEM_STATES = new Set([
  "todo",
  "in_progress",
  "waiting",
  "blocked",
  "completed",
  "not_applicable",
]);
const CHECKLIST_ITEM_KEYS = new Set([
  "id",
  "label",
  "done",
  "state",
  "assignee",
  "dueDate",
  "note",
  "completedAt",
  "completedByProfileId",
]);
const CHECKLIST_OPTIONAL_ITEM_KEYS = [
  "assignee",
  "dueDate",
  "note",
  "completedAt",
  "completedByProfileId",
] as const;
const CHECKLIST_PROFILE_KEYS = new Set([
  "version",
  "reviewedAt",
  "answers",
  "autoExcludedItemIds",
]);
const CHECKLIST_REVIEW_FIELDS = new Set([
  "checklistReviewedAt",
  "checklistReviewedByProfileId",
  "checklistReviewSource",
]);
const CHECKLIST_CATEGORY_FIELDS = new Set([
  "category",
  "label",
  "status",
  "budget",
  "spent",
  "vendor",
  "notes",
  "payer",
  "checklist",
  "checklistReviewedAt",
  "checklistReviewedByProfileId",
  "checklistReviewSource",
  // 아래 네 필드는 구 일정/책임 화면의 저장값을 안전하게 왕복하기 위한 호환 필드다.
  "assigned_to",
  "responsibility",
  "dueDate",
  "due_date",
]);
const CHECKLIST_LEGACY_CATEGORY_FIELDS = new Set([
  "vendor",
  "notes",
  "assigned_to",
  "responsibility",
  "dueDate",
  "due_date",
]);
const VALID_CHECKLIST_REVIEW_SOURCES = new Set(["manual", "situation_profile"]);
const CHECKLIST_PROFILE_ANSWER_KEYS = [
  "ceremony",
  "legalMarriage",
  "travel",
  "housing",
  "internationalMarriage",
  "religiousCeremony",
  "remarriage",
  "childrenParticipating",
  "accessibilitySupport",
  "healthSupport",
  "petParticipation",
  "familyTradition",
] as const;
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

function canonicalizeLegacyChecklistItems(
  progress: Record<string, unknown>,
): Record<string, unknown> | null {
  const canonicalProgress: Record<string, unknown> = { ...progress };

  for (const [categoryKey, value] of Object.entries(canonicalProgress)) {
    if (!isKnownChecklistCategoryKey(categoryKey) || !isRecord(value)) continue;
    if (!Array.isArray(value.checklist)) continue;
    const templateItems = CHECKLIST_TEMPLATE_ITEMS_BY_CATEGORY.get(categoryKey);
    const canonicalChecklist: unknown[] = [];

    for (const rawItem of value.checklist) {
      if (!isRecord(rawItem) || !hasOwn(rawItem, "completed")) {
        canonicalChecklist.push(rawItem);
        continue;
      }
      if (
        typeof rawItem.completed !== "boolean"
        || typeof rawItem.id !== "string"
        || !templateItems?.has(rawItem.id)
        || Object.keys(rawItem).some(
          (field) => field !== "completed" && !CHECKLIST_ITEM_KEYS.has(field),
        )
      ) return null;

      const templateLabel = templateItems.get(rawItem.id);
      const state = hasOwn(rawItem, "state")
        ? rawItem.state
        : rawItem.completed ? "completed" : "todo";
      if (
        typeof state !== "string"
        || !VALID_CHECKLIST_ITEM_STATES.has(state)
        || rawItem.completed !== (state === "completed")
        || (hasOwn(rawItem, "done") && rawItem.done !== rawItem.completed)
      ) return null;

      const rest = { ...rawItem };
      delete rest.completed;
      canonicalChecklist.push({
        ...rest,
        id: rawItem.id,
        label: templateLabel,
        done: rawItem.completed,
        state,
      });
    }
    canonicalProgress[categoryKey] = { ...value, checklist: canonicalChecklist };
  }
  return canonicalProgress;
}

function normalizeProgress(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value) || !hasValidProgressShape(value)) return null;
  const sanitized = sanitizeJsonObject(value, {
    maxDepth: MAX_PROGRESS_DEPTH,
    maxArrayLength: MAX_PROGRESS_ARRAY_LENGTH,
    maxObjectKeys: MAX_PROGRESS_OBJECT_KEYS,
    maxStringLength: MAX_PROGRESS_STRING_CHARS,
  });
  if (!sanitized) return null;
  return canonicalizeLegacyChecklistItems(sanitized);
}

function isCanonicalIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = cleanOptionalIsoDate(value);
  return parsed === value && !value.startsWith("0000-");
}

function isCanonicalIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || Array.from(value).length > 40) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function hasValidChecklistAssignee(value: unknown): boolean {
  if (value === null) return true;
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  const keys = Object.keys(value);
  if (value.kind === "couple") return keys.length === 1;
  if (value.kind === "member") {
    return keys.length === 2
      && typeof value.profileId === "string"
      && isUuid(value.profileId);
  }
  if (value.kind === "external") {
    return keys.length === 2
      && typeof value.label === "string"
      && Array.from(value.label.trim()).length >= 1
      && Array.from(value.label).length <= MAX_CHECKLIST_ASSIGNEE_LABEL_CHARS
      && !hasUnsafeDisplayCharacter(value.label);
  }
  return false;
}

function hasValidChecklistProfile(value: unknown): boolean {
  if (
    !isRecord(value)
    || Object.keys(value).length !== CHECKLIST_PROFILE_KEYS.size
    || Object.keys(value).some((key) => !CHECKLIST_PROFILE_KEYS.has(key))
    || value.version !== 1
    || !isCanonicalIsoTimestamp(value.reviewedAt)
    || !isRecord(value.answers)
  ) return false;
  const answers = value.answers;
  if (
    Object.keys(answers).length !== CHECKLIST_PROFILE_ANSWER_KEYS.length
    || CHECKLIST_PROFILE_ANSWER_KEYS.some((key) => !hasOwn(answers, key))
    || Object.keys(answers).some(
      (key) => !CHECKLIST_PROFILE_ANSWER_KEYS.includes(
        key as (typeof CHECKLIST_PROFILE_ANSWER_KEYS)[number],
      ),
    )
    || !Array.isArray(value.autoExcludedItemIds)
    || value.autoExcludedItemIds.length > KNOWN_CHECKLIST_ITEM_IDS.size
    || !value.autoExcludedItemIds.every(
      (itemId) => typeof itemId === "string" && KNOWN_CHECKLIST_ITEM_IDS.has(itemId),
    )
    || new Set(value.autoExcludedItemIds).size !== value.autoExcludedItemIds.length
  ) return false;

  const triState = new Set(["yes", "no", "undecided"]);
  const travel = new Set(["domestic", "international", "none", "undecided"]);
  const housing = new Set(["rent", "buy", "other", "undecided"]);
  if (
    typeof answers.ceremony !== "string"
    || !triState.has(answers.ceremony)
    || typeof answers.legalMarriage !== "string"
    || !triState.has(answers.legalMarriage)
    || typeof answers.travel !== "string"
    || !travel.has(answers.travel)
    || typeof answers.housing !== "string"
    || !housing.has(answers.housing)
  ) return false;

  return [
    "internationalMarriage",
    "religiousCeremony",
    "remarriage",
    "childrenParticipating",
    "accessibilitySupport",
    "healthSupport",
    "petParticipation",
    "familyTradition",
  ].every((key) => answers[key] === null || typeof answers[key] === "boolean");
}

function hasValidBudgetFields(progress: Record<string, unknown>) {
  return Object.entries(progress).every(([key, item]) => {
    if (!isRecord(item)) {
      return !KNOWN_BUDGET_CATEGORY_KEYS.has(key)
        && !BUDGET_ITEM_FIELDS.has(key);
    }
    // 전체 여정 체크리스트 전용 분야는 예산 정본이 아니다. 여기에 금액이 들어오면
    // 합계 소비자마다 포함 여부가 갈리므로 저장 경계에서 차단한다.
    if (
      KNOWN_CHECKLIST_CATEGORY_KEYS.has(key)
      && !KNOWN_BUDGET_CATEGORY_KEYS.has(key)
      && [...BUDGET_PROGRESS_FIELDS].some((field) => hasOwn(item, field))
    ) return false;
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
    if (key === PLANNING_CHECKLIST_PROFILE_KEY) {
      return hasValidChecklistProfile(item);
    }
    if (!KNOWN_CHECKLIST_CATEGORY_KEYS.has(key)) return true;
    if (!isRecord(item)) return false;
    if (hasOwn(item, "category") && item.category !== key) return false;
    if (hasOwn(item, "status") && (
      typeof item.status !== "string"
      || !VALID_CHECKLIST_STATUSES.has(item.status)
    )) return false;
    if ([...CHECKLIST_LEGACY_CATEGORY_FIELDS].some((field) => hasOwn(item, field))) {
      const validLegacyText = (value: unknown) => value === null || (
        typeof value === "string"
        && Array.from(value).length <= MAX_PROGRESS_STRING_CHARS
        && !hasUnsafeDisplayCharacter(value)
      );
      if (
        (hasOwn(item, "vendor") && !validLegacyText(item.vendor))
        || (hasOwn(item, "notes") && !validLegacyText(item.notes))
        || (hasOwn(item, "assigned_to") && !validLegacyText(item.assigned_to))
        || (hasOwn(item, "responsibility") && !validLegacyText(item.responsibility))
        || (hasOwn(item, "dueDate") && !(
          item.dueDate === null || isCanonicalIsoDate(item.dueDate)
        ))
        || (hasOwn(item, "due_date") && !(
          item.due_date === null || isCanonicalIsoDate(item.due_date)
        ))
      ) return false;
    }
    if ([...CHECKLIST_REVIEW_FIELDS].some((field) => hasOwn(item, field))) {
      if (
        !isCanonicalIsoTimestamp(item.checklistReviewedAt)
        || (hasOwn(item, "checklistReviewedByProfileId") && !(
          item.checklistReviewedByProfileId === null
          || (
            typeof item.checklistReviewedByProfileId === "string"
            && isUuid(item.checklistReviewedByProfileId)
          )
        ))
        || typeof item.checklistReviewSource !== "string"
        || !VALID_CHECKLIST_REVIEW_SOURCES.has(item.checklistReviewSource)
      ) return false;
    }
    if (!hasOwn(item, "checklist")) return true;
    if (!Array.isArray(item.checklist)) return false;

    const ids = new Set<string>();
    const states: string[] = [];
    for (const checklistItem of item.checklist) {
      if (!isRecord(checklistItem)) return false;
      if (
        Object.keys(checklistItem).some((field) => !CHECKLIST_ITEM_KEYS.has(field))
        ||
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
      const state = hasOwn(checklistItem, "state")
        ? checklistItem.state
        : checklistItem.done ? "completed" : "todo";
      if (
        typeof state !== "string"
        || !VALID_CHECKLIST_ITEM_STATES.has(state)
        || checklistItem.done !== (state === "completed")
        || (hasOwn(checklistItem, "dueDate") && !(
          checklistItem.dueDate === null || isCanonicalIsoDate(checklistItem.dueDate)
        ))
        || (hasOwn(checklistItem, "note") && !(
          typeof checklistItem.note === "string"
          && Array.from(checklistItem.note).length <= MAX_CHECKLIST_NOTE_CHARS
          && !hasUnsafeDisplayCharacter(checklistItem.note)
        ))
        || (hasOwn(checklistItem, "assignee")
          && !hasValidChecklistAssignee(checklistItem.assignee))
        || (hasOwn(checklistItem, "completedAt") && !(
          checklistItem.completedAt === null
          || isCanonicalIsoTimestamp(checklistItem.completedAt)
        ))
        || (hasOwn(checklistItem, "completedByProfileId") && !(
          checklistItem.completedByProfileId === null
          || (
            typeof checklistItem.completedByProfileId === "string"
            && isUuid(checklistItem.completedByProfileId)
          )
        ))
      ) return false;
      const completedAt = checklistItem.completedAt;
      const completedBy = checklistItem.completedByProfileId;
      const hasCompletionAudit = completedAt != null || completedBy != null;
      if (
        (hasCompletionAudit && state !== "completed")
        || ((completedAt == null) !== (completedBy == null))
      ) return false;
      ids.add(checklistItem.id);
      states.push(state);
    }

    if (!hasOwn(item, "status") || item.status === "not_applicable") return true;
    const applicableStates = states.filter((state) => state !== "not_applicable");
    const derivedStatus = item.checklist.length === 0
      ? "not_started"
      : applicableStates.length === 0
        ? "not_applicable"
        : applicableStates.every((state) => state === "completed")
          ? "completed"
          : applicableStates.every((state) => state === "todo")
            ? "not_started"
            : "in_progress";
    return item.status === derivedStatus;
  });
}

function collectChecklistMemberProfileIds(changes: Record<string, unknown>) {
  const result = new Set<string>();
  for (const progressKey of ["progress", "progress_patch"]) {
    const progress = changes[progressKey];
    if (!isRecord(progress)) continue;
    for (const [categoryKey, categoryValue] of Object.entries(progress)) {
      if (!KNOWN_CHECKLIST_CATEGORY_KEYS.has(categoryKey) || !isRecord(categoryValue)) {
        continue;
      }
      if (!Array.isArray(categoryValue.checklist)) continue;
      for (const item of categoryValue.checklist) {
        if (!isRecord(item)) continue;
        if (
          isRecord(item.assignee)
          && item.assignee.kind === "member"
          && typeof item.assignee.profileId === "string"
        ) result.add(item.assignee.profileId);
        if (typeof item.completedByProfileId === "string") {
          result.add(item.completedByProfileId);
        }
      }
    }
  }
  return result;
}

function getSituationAutoExcludedItemIds(changes: Record<string, unknown>): Set<string> {
  const incomingProgress = isRecord(changes.progress_patch)
    ? changes.progress_patch
    : isRecord(changes.progress)
      ? changes.progress
      : null;
  if (!incomingProgress) return new Set();
  const profile = incomingProgress[PLANNING_CHECKLIST_PROFILE_KEY];
  if (!isRecord(profile) || !Array.isArray(profile.autoExcludedItemIds)) return new Set();
  return new Set(
    profile.autoExcludedItemIds.filter(
      (itemId): itemId is string => typeof itemId === "string",
    ),
  );
}

function hasForgedChecklistCompletionActor(
  changes: Record<string, unknown>,
  currentProgress: Record<string, unknown>,
  actorProfileId: string,
): boolean {
  const incomingProgress = isRecord(changes.progress_patch)
    ? changes.progress_patch
    : isRecord(changes.progress)
      ? changes.progress
      : null;
  if (!incomingProgress) return false;
  const situationAutoExcludedItemIds = getSituationAutoExcludedItemIds(changes);
  for (const [categoryKey, categoryValue] of Object.entries(incomingProgress)) {
    if (!isKnownChecklistCategoryKey(categoryKey) || !isRecord(categoryValue)) continue;
    if (!Array.isArray(categoryValue.checklist)) continue;
    const currentCategory = currentProgress[categoryKey];
    const currentChecklist = isRecord(currentCategory) && Array.isArray(currentCategory.checklist)
      ? currentCategory.checklist
      : [];
    const currentById = new Map(
      currentChecklist
        .filter(isRecord)
        .map((item) => [item.id, item]),
    );
    for (const item of categoryValue.checklist) {
      if (!isRecord(item)) continue;
      const current = currentById.get(item.id);
      const currentIsCompleted = current
        && (current.state === "completed" || (current.state === undefined && current.done === true));
      const incomingIsCompleted = item.state === "completed"
        || (item.state === undefined && item.done === true);
      const currentHasAudit = current
        && typeof current.completedByProfileId === "string"
        && typeof current.completedAt === "string";

      if (currentIsCompleted && incomingIsCompleted && currentHasAudit) {
        if (
          item.completedByProfileId !== current.completedByProfileId
          || item.completedAt !== current.completedAt
        ) return true;
        continue;
      }
      if (currentIsCompleted && incomingIsCompleted && !currentHasAudit) {
        if (item.completedByProfileId != null || item.completedAt != null) return true;
        continue;
      }
      if (currentIsCompleted && !incomingIsCompleted && currentHasAudit) {
        if (
          item.state === "not_applicable"
          && typeof item.id === "string"
          && situationAutoExcludedItemIds.has(item.id)
        ) continue;
        if (current.completedByProfileId !== actorProfileId) return true;
        continue;
      }
      if (!currentIsCompleted && incomingIsCompleted) {
        if (
          item.completedByProfileId == null
          && item.completedAt == null
        ) continue;
        if (
          typeof item.completedByProfileId !== "string"
          || item.completedByProfileId !== actorProfileId
          || typeof item.completedAt !== "string"
        ) return true;
        continue;
      }
      if (typeof item.completedByProfileId === "string") {
        if (item.completedByProfileId !== actorProfileId) return true;
      }
    }
  }
  return false;
}

function hasForgedChecklistReviewActor(
  changes: Record<string, unknown>,
  currentProgress: Record<string, unknown>,
  actorProfileId: string,
): boolean {
  const incomingProgress = isRecord(changes.progress_patch)
    ? changes.progress_patch
    : isRecord(changes.progress)
      ? changes.progress
      : null;
  if (!incomingProgress) return false;
  for (const [categoryKey, categoryValue] of Object.entries(incomingProgress)) {
    if (!isKnownChecklistCategoryKey(categoryKey) || !isRecord(categoryValue)) continue;
    const current = currentProgress[categoryKey];
    const currentHasManualReview = isRecord(current)
      && current.checklistReviewSource === "manual"
      && typeof current.checklistReviewedAt === "string";
    if (!hasOwn(categoryValue, "checklistReviewedAt")) {
      if (currentHasManualReview) return true;
      continue;
    }
    if (!Array.isArray(categoryValue.checklist)) return true;
    const currentReviewIsUnchanged = isRecord(current)
      && current.checklistReviewedAt === categoryValue.checklistReviewedAt
      && current.checklistReviewedByProfileId === categoryValue.checklistReviewedByProfileId
      && current.checklistReviewSource === categoryValue.checklistReviewSource;
    if (currentReviewIsUnchanged) continue;
    if (currentHasManualReview) return true;
    if (categoryValue.checklistReviewedByProfileId !== actorProfileId) return true;
  }
  return false;
}

/**
 * Rich checklist rows are category snapshots, not partial objects. A status-only
 * write must never erase an item checklist or manufacture item completion.
 * Legacy status-only rows may round-trip unchanged until a current client
 * materializes their canonical item list.
 */
function hasUnsafeChecklistStatusOnlyTransition(
  changes: Record<string, unknown>,
  currentProgress: Record<string, unknown>,
): boolean {
  const incomingProgress = isRecord(changes.progress_patch)
    ? changes.progress_patch
    : isRecord(changes.progress)
      ? changes.progress
      : null;
  if (!incomingProgress) return false;

  if (isRecord(changes.progress)) {
    if (
      hasOwn(currentProgress, PLANNING_CHECKLIST_PROFILE_KEY)
      && !hasOwn(incomingProgress, PLANNING_CHECKLIST_PROFILE_KEY)
    ) return true;
    for (const [categoryKey, currentValue] of Object.entries(currentProgress)) {
      if (
        KNOWN_CHECKLIST_CATEGORY_KEYS.has(categoryKey)
        && isRecord(currentValue)
        && !hasOwn(incomingProgress, categoryKey)
      ) return true;
    }
  }

  for (const [categoryKey, incomingValue] of Object.entries(incomingProgress)) {
    if (!KNOWN_CHECKLIST_CATEGORY_KEYS.has(categoryKey) || !isRecord(incomingValue)) continue;
    if (Array.isArray(incomingValue.checklist)) continue;

    const currentValue = currentProgress[categoryKey];
    const current = isRecord(currentValue) ? currentValue : null;
    if (current && Array.isArray(current.checklist)) return true;
    if (!hasOwn(incomingValue, "status")) continue;

    const incomingStatus = incomingValue.status;
    if (incomingStatus === "not_applicable") continue;
    if (incomingStatus === "not_started") {
      if (!current || !hasOwn(current, "status") || current.status === "not_started") continue;
      return true;
    }
    if (incomingStatus === "in_progress" || incomingStatus === "completed") {
      if (current && !Array.isArray(current.checklist) && current.status === incomingStatus) continue;
      return true;
    }
  }
  return false;
}

function removesProtectedChecklistProgress(
  changes: Record<string, unknown>,
  currentProgress: Record<string, unknown>,
): boolean {
  const removeKeys = changes.progress_remove_keys;
  if (!Array.isArray(removeKeys)) return false;
  return removeKeys.some((key) => (
    hasOwn(currentProgress, key)
    && (KNOWN_CHECKLIST_CATEGORY_KEYS.has(key) || key === PLANNING_CHECKLIST_PROFILE_KEY)
  ));
}

function hasUnsafeChecklistItemIdentityTransition(
  changes: Record<string, unknown>,
  currentProgress: Record<string, unknown>,
): boolean {
  const incomingProgress = isRecord(changes.progress_patch)
    ? changes.progress_patch
    : isRecord(changes.progress)
      ? changes.progress
      : null;
  if (!incomingProgress) return false;

  for (const [categoryKey, categoryValue] of Object.entries(incomingProgress)) {
    if (!isKnownChecklistCategoryKey(categoryKey) || !isRecord(categoryValue)) continue;
    if (!Array.isArray(categoryValue.checklist)) continue;
    const currentValue = currentProgress[categoryKey];
    const currentChecklist = isRecord(currentValue) && Array.isArray(currentValue.checklist)
      ? currentValue.checklist
      : [];
    const currentIdList = currentChecklist
      .filter(isRecord)
      .map((item) => item.id)
      .filter((id): id is string => typeof id === "string");
    const incomingIdList = categoryValue.checklist
      .filter(isRecord)
      .map((item) => item.id)
      .filter((id): id is string => typeof id === "string");
    const currentIds = new Set(currentIdList);
    const incomingIds = new Set(incomingIdList);
    if ([...currentIds].some((id) => !incomingIds.has(id))) return true;
    if (!jsonValuesEqual(
      incomingIdList.filter((id) => currentIds.has(id)),
      currentIdList,
    )) return true;
    const templateItems = CHECKLIST_TEMPLATE_ITEMS_BY_CATEGORY.get(categoryKey);
    if ([...incomingIds].some((id) => !currentIds.has(id) && !templateItems?.has(id))) return true;
  }
  return false;
}

function hasUnsafeChecklistItemFieldTransition(
  changes: Record<string, unknown>,
  currentProgress: Record<string, unknown>,
): boolean {
  const incomingProgress = isRecord(changes.progress_patch)
    ? changes.progress_patch
    : isRecord(changes.progress)
      ? changes.progress
      : null;
  if (!incomingProgress) return false;
  const situationAutoExcludedItemIds = getSituationAutoExcludedItemIds(changes);

  for (const [categoryKey, categoryValue] of Object.entries(incomingProgress)) {
    if (!isKnownChecklistCategoryKey(categoryKey) || !isRecord(categoryValue)) continue;
    if (!Array.isArray(categoryValue.checklist)) continue;
    const currentValue = currentProgress[categoryKey];
    const currentChecklist = isRecord(currentValue) && Array.isArray(currentValue.checklist)
      ? currentValue.checklist
      : [];
    const currentById = new Map(
      currentChecklist.filter(isRecord).map((item) => [item.id, item]),
    );
    for (const incomingItem of categoryValue.checklist) {
      if (!isRecord(incomingItem) || typeof incomingItem.id !== "string") continue;
      const currentItem = currentById.get(incomingItem.id);
      if (!currentItem) continue;
      if (hasOwn(currentItem, "state") && !hasOwn(incomingItem, "state")) return true;
      for (const field of CHECKLIST_OPTIONAL_ITEM_KEYS) {
        if (!hasOwn(currentItem, field) || hasOwn(incomingItem, field)) continue;
        const clearsCompletionEvidenceForSituation = (
          (field === "completedAt" || field === "completedByProfileId")
          && incomingItem.state === "not_applicable"
          && situationAutoExcludedItemIds.has(incomingItem.id)
        );
        if (!clearsCompletionEvidenceForSituation) return true;
      }
    }
  }
  return false;
}

function hasUnsafeChecklistCategoryFieldTransition(
  changes: Record<string, unknown>,
  currentProgress: Record<string, unknown>,
): boolean {
  const incomingProgress = isRecord(changes.progress_patch)
    ? changes.progress_patch
    : isRecord(changes.progress)
      ? changes.progress
      : null;
  if (!incomingProgress) return false;

  for (const [categoryKey, incomingValue] of Object.entries(incomingProgress)) {
    if (!KNOWN_CHECKLIST_CATEGORY_KEYS.has(categoryKey) || !isRecord(incomingValue)) continue;
    const currentValue = currentProgress[categoryKey];
    const current = isRecord(currentValue) ? currentValue : null;
    for (const [field, value] of Object.entries(incomingValue)) {
      if (CHECKLIST_CATEGORY_FIELDS.has(field)) continue;
      if (!current || !hasOwn(current, field) || !jsonValuesEqual(current[field], value)) {
        return true;
      }
    }
    if (isRecord(changes.progress_patch) && current) {
      for (const field of Object.keys(current)) {
        if (!hasOwn(incomingValue, field)) return true;
      }
    }
    if (isRecord(changes.progress) && current) {
      for (const field of Object.keys(current)) {
        if (!CHECKLIST_CATEGORY_FIELDS.has(field) && !hasOwn(incomingValue, field)) return true;
      }
    }
  }
  return false;
}

function canonicalizeChecklistServerProvenance(
  changes: Record<string, unknown>,
  currentProgress: Record<string, unknown>,
  actorProfileId: string,
  now: string,
): Record<string, unknown> {
  const result = { ...changes };
  for (const progressKey of ["progress", "progress_patch"] as const) {
    const incomingProgress = result[progressKey];
    if (!isRecord(incomingProgress)) continue;
    const nextProgress: Record<string, unknown> = { ...incomingProgress };

    const profile = nextProgress[PLANNING_CHECKLIST_PROFILE_KEY];
    if (isRecord(profile)) {
      nextProgress[PLANNING_CHECKLIST_PROFILE_KEY] = { ...profile, reviewedAt: now };
    }

    for (const [categoryKey, categoryValue] of Object.entries(nextProgress)) {
      if (!isKnownChecklistCategoryKey(categoryKey) || !isRecord(categoryValue)) continue;
      const currentValue = currentProgress[categoryKey];
      const current = isRecord(currentValue) ? currentValue : null;
      const nextCategory: Record<string, unknown> = { ...categoryValue };

      if (hasOwn(nextCategory, "checklistReviewedAt")) {
        const unchanged = current
          && current.checklistReviewedAt === nextCategory.checklistReviewedAt
          && current.checklistReviewedByProfileId === nextCategory.checklistReviewedByProfileId
          && current.checklistReviewSource === nextCategory.checklistReviewSource;
        if (!unchanged) {
          nextCategory.checklistReviewedAt = now;
          nextCategory.checklistReviewedByProfileId = actorProfileId;
        }
      }

      if (Array.isArray(nextCategory.checklist)) {
        const currentChecklist = current && Array.isArray(current.checklist)
          ? current.checklist
          : [];
        const currentById = new Map(
          currentChecklist.filter(isRecord).map((item) => [item.id, item]),
        );
        const templateItems = CHECKLIST_TEMPLATE_ITEMS_BY_CATEGORY.get(categoryKey);
        nextCategory.checklist = nextCategory.checklist.map((value) => {
          if (!isRecord(value)) return value;
          const currentItem = currentById.get(value.id);
          const currentCompleted = currentItem
            && (currentItem.state === "completed"
              || (currentItem.state === undefined && currentItem.done === true));
          const incomingCompleted = value.state === "completed"
            || (value.state === undefined && value.done === true);
          const normalizedValue = {
            ...value,
            ...(typeof value.id === "string" && templateItems?.has(value.id)
              ? { label: templateItems.get(value.id) }
              : currentItem && typeof currentItem.label === "string"
                ? { label: currentItem.label }
                : {}),
          };
          if (currentCompleted || !incomingCompleted) return normalizedValue;
          return {
            ...normalizedValue,
            completedAt: now,
            completedByProfileId: actorProfileId,
          };
        });
      }
      nextProgress[categoryKey] = nextCategory;
    }
    result[progressKey] = nextProgress;
  }
  return result;
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

function checklistProfilesHaveSameMeaning(
  currentProfile: unknown,
  incomingProfile: unknown,
): boolean {
  if (
    !isRecord(currentProfile)
    || !isRecord(incomingProfile)
    || !hasValidChecklistProfile(currentProfile)
    || !hasValidChecklistProfile(incomingProfile)
    || currentProfile.version !== incomingProfile.version
    || !jsonValuesEqual(currentProfile.answers, incomingProfile.answers)
    || !Array.isArray(currentProfile.autoExcludedItemIds)
    || !Array.isArray(incomingProfile.autoExcludedItemIds)
  ) return false;

  const currentItemIds = new Set(
    currentProfile.autoExcludedItemIds.filter(
      (itemId): itemId is string => typeof itemId === "string",
    ),
  );
  return currentItemIds.size === incomingProfile.autoExcludedItemIds.length
    && incomingProfile.autoExcludedItemIds.every(
      (itemId) => typeof itemId === "string" && currentItemIds.has(itemId),
    );
}

function isChecklistProfileNoOp(
  changes: Record<string, unknown>,
  currentJourney: Record<string, unknown>,
  currentProgress: Record<string, unknown>,
): boolean {
  const fullProgress = isRecord(changes.progress) ? changes.progress : null;
  const progressPatch = isRecord(changes.progress_patch) ? changes.progress_patch : null;
  const incomingProgress = fullProgress ?? progressPatch;
  if (
    !incomingProgress
    || !hasOwn(incomingProgress, PLANNING_CHECKLIST_PROFILE_KEY)
    || !checklistProfilesHaveSameMeaning(
      currentProgress[PLANNING_CHECKLIST_PROFILE_KEY],
      incomingProgress[PLANNING_CHECKLIST_PROFILE_KEY],
    )
  ) return false;

  if (fullProgress) {
    const currentKeys = Object.keys(currentProgress).filter(
      (key) => key !== PLANNING_CHECKLIST_PROFILE_KEY,
    );
    const incomingKeys = Object.keys(fullProgress).filter(
      (key) => key !== PLANNING_CHECKLIST_PROFILE_KEY,
    );
    if (
      currentKeys.length !== incomingKeys.length
      || currentKeys.some(
        (key) => !hasOwn(fullProgress, key)
          || !jsonValuesEqual(currentProgress[key], fullProgress[key]),
      )
    ) return false;
  } else if (progressPatch) {
    for (const [key, value] of Object.entries(progressPatch)) {
      if (key === PLANNING_CHECKLIST_PROFILE_KEY) continue;
      if (!hasOwn(currentProgress, key) || !jsonValuesEqual(currentProgress[key], value)) {
        return false;
      }
    }
    if (
      Array.isArray(changes.progress_remove_keys)
      && changes.progress_remove_keys.some(
        (key) => typeof key === "string" && hasOwn(currentProgress, key),
      )
    ) return false;
  }

  for (const key of ["wedding_date", "venue", "total_budget"] as const) {
    if (
      hasOwn(changes, key)
      && (
        !hasOwn(currentJourney, key)
        || !jsonValuesEqual(changes[key], currentJourney[key])
      )
    ) return false;
  }

  return true;
}

function hasSemanticallyUnchangedChecklistProfile(
  changes: Record<string, unknown>,
  currentProgress: Record<string, unknown>,
): boolean {
  const incomingProgress = isRecord(changes.progress)
    ? changes.progress
    : isRecord(changes.progress_patch)
      ? changes.progress_patch
      : null;
  return Boolean(
    incomingProgress
    && hasOwn(incomingProgress, PLANNING_CHECKLIST_PROFILE_KEY)
    && checklistProfilesHaveSameMeaning(
      currentProgress[PLANNING_CHECKLIST_PROFILE_KEY],
      incomingProgress[PLANNING_CHECKLIST_PROFILE_KEY],
    ),
  );
}

function removeNoOpJourneyChanges(
  changes: Record<string, unknown>,
  currentJourney: Record<string, unknown>,
  currentProgress: Record<string, unknown>,
  removeChecklistProfile: boolean,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...changes };
  const rawCurrentProgress = isRecord(currentJourney.progress)
    ? currentJourney.progress
    : currentProgress;
  for (const key of ["wedding_date", "venue", "total_budget"] as const) {
    if (hasOwn(result, key) && jsonValuesEqual(result[key], currentJourney[key])) {
      delete result[key];
    }
  }

  const patch = result.progress_patch;
  if (isRecord(patch)) {
    const nextPatch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(patch)) {
      if (removeChecklistProfile && key === PLANNING_CHECKLIST_PROFILE_KEY) continue;
      if (
        (hasOwn(currentProgress, key) && jsonValuesEqual(value, currentProgress[key]))
        || (hasOwn(rawCurrentProgress, key) && jsonValuesEqual(value, rawCurrentProgress[key]))
      ) continue;
      nextPatch[key] = value;
    }
    if (Object.keys(nextPatch).length > 0) result.progress_patch = nextPatch;
    else delete result.progress_patch;
  }
  if (Array.isArray(result.progress_remove_keys) && result.progress_remove_keys.length === 0) {
    delete result.progress_remove_keys;
  }
  return result;
}

const NO_SEMANTIC_CHANGE = Symbol("NO_SEMANTIC_CHANGE");

function semanticJsonDelta(next: unknown, current: unknown): unknown | typeof NO_SEMANTIC_CHANGE {
  if (jsonValuesEqual(next, current)) return NO_SEMANTIC_CHANGE;
  if (!isRecord(next) || !isRecord(current)) return next;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(next)) {
    const delta = semanticJsonDelta(value, current[key]);
    if (delta !== NO_SEMANTIC_CHANGE) result[key] = delta;
  }
  return Object.keys(result).length > 0 ? result : NO_SEMANTIC_CHANGE;
}

function buildSemanticChangeView(
  changes: Record<string, unknown>,
  currentJourney: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...changes };
  const patch = changes.progress_patch;
  const rawProgress = isRecord(currentJourney.progress) ? currentJourney.progress : {};
  if (isRecord(patch)) {
    const semanticPatch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(patch)) {
      const delta = semanticJsonDelta(value, rawProgress[key]);
      if (delta !== NO_SEMANTIC_CHANGE) semanticPatch[key] = delta;
    }
    if (Object.keys(semanticPatch).length > 0) result.progress_patch = semanticPatch;
    else delete result.progress_patch;
  }
  return result;
}

function preserveUnchangedLegacyChecklistShapes(
  changes: Record<string, unknown>,
  rawCurrentProgress: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...changes };
  const canonicalCurrentProgress = canonicalizeLegacyChecklistItems(rawCurrentProgress);
  if (!canonicalCurrentProgress) return result;

  for (const progressKey of ["progress", "progress_patch"] as const) {
    const incomingProgress = result[progressKey];
    if (!isRecord(incomingProgress)) continue;
    const nextProgress: Record<string, unknown> = { ...incomingProgress };

    for (const [categoryKey, categoryValue] of Object.entries(nextProgress)) {
      if (!isKnownChecklistCategoryKey(categoryKey) || !isRecord(categoryValue)) continue;
      if (!Array.isArray(categoryValue.checklist)) continue;
      const rawCurrentCategory = rawCurrentProgress[categoryKey];
      const canonicalCurrentCategory = canonicalCurrentProgress[categoryKey];
      if (!isRecord(rawCurrentCategory) || !Array.isArray(rawCurrentCategory.checklist)) continue;
      if (!isRecord(canonicalCurrentCategory) || !Array.isArray(canonicalCurrentCategory.checklist)) {
        continue;
      }
      const rawById = new Map(
        rawCurrentCategory.checklist.filter(isRecord).map((item) => [item.id, item]),
      );
      const canonicalById = new Map(
        canonicalCurrentCategory.checklist.filter(isRecord).map((item) => [item.id, item]),
      );
      const checklist = categoryValue.checklist.map((item) => {
        if (!isRecord(item) || typeof item.id !== "string") return item;
        const rawCurrentItem = rawById.get(item.id);
        const canonicalCurrentItem = canonicalById.get(item.id);
        if (
          !rawCurrentItem
          || !hasOwn(rawCurrentItem, "completed")
          || !canonicalCurrentItem
          || !jsonValuesEqual(item, canonicalCurrentItem)
        ) return item;
        return rawCurrentItem;
      });
      nextProgress[categoryKey] = { ...categoryValue, checklist };
    }
    result[progressKey] = nextProgress;
  }
  return result;
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
  const touchesChecklistProfile = isRecord(progressChange)
    && hasOwn(progressChange, PLANNING_CHECKLIST_PROFILE_KEY);
  const touchesSchedule =
    hasOwn(changes, "wedding_date")
    || touchesChecklistProfile
    || containsProgressField(progressChange, SCHEDULE_PROGRESS_FIELDS);
  if (touchesChecklistProfile) return "/schedule";
  if (touchesBudget && !touchesSchedule) return "/budget";
  if (touchesSchedule && !touchesBudget) return "/schedule";
  return "/dashboard";
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
  console.error("Couple plan-change RPC failed:", { code });
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

    const limited = await checkRateLimitPersistent(
      rateLimitKey("journey:plan-change", request, user.id),
      // 체크박스는 항목마다 즉시 저장한다. 인증된 사용자 단위로 제한하되,
      // 두 카테고리를 연달아 정리해도 정상 사용이 막히지 않는 범위를 허용한다.
      { maxRequests: 30, windowMs: 60 * 1000 },
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
      !isRecord(profile)
      || typeof profile.couple_id !== "string"
      || !isUuid(profile.couple_id)
    ) {
      return privateResponse({ error: "커플 연결이 필요합니다." }, 403);
    }

    const coupleId = profile.couple_id;
    const referencedMemberIds = collectChecklistMemberProfileIds(
      parsed.value.changes,
    );
    const foreignReferencedIds = [...referencedMemberIds]
      .filter((profileId) => profileId !== user.id);
    if (foreignReferencedIds.length > 0) {
      const { data: couple, error: coupleError } = await supabase
        .from("couples")
        .select("bride_id,groom_id")
        .eq("id", coupleId)
        .single();
      if (coupleError || !isRecord(couple)) {
        return privateResponse(
          { error: "담당자로 지정할 커플 구성원을 확인하지 못했어요." },
          503,
        );
      }
      const allowedMemberIds = new Set(
        [couple.bride_id, couple.groom_id]
          .filter((memberId): memberId is string => typeof memberId === "string"),
      );
      if (
        !allowedMemberIds.has(user.id)
        || foreignReferencedIds.some((profileId) => !allowedMemberIds.has(profileId))
      ) {
        return privateResponse(
          { error: "같은 커플의 구성원만 담당자나 완료자로 기록할 수 있습니다." },
          400,
        );
      }
    }
    const { data: currentJourney, error: currentJourneyError } = await supabase
      .from("wedding_journeys")
      .select("wedding_date,venue,total_budget,progress,state_revision")
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
    const currentProgress = canonicalizeLegacyChecklistItems(currentJourney.progress)
      ?? currentJourney.progress;
    const semanticallyUnchangedChecklistProfile = hasSemanticallyUnchangedChecklistProfile(
      parsed.value.changes,
      currentProgress,
    );
    if (isChecklistProfileNoOp(
      parsed.value.changes,
      currentJourney,
      currentProgress,
    )) {
      return privateResponse(
        {
          error: "우리 상황 설정에 달라진 내용이 없어요.",
          code: "CHECKLIST_PROFILE_NO_CHANGES",
        },
        400,
      );
    }
    if (hasUnsafeChecklistStatusOnlyTransition(
      parsed.value.changes,
      currentProgress,
    )) {
      return privateResponse(
        {
          error: "체크리스트 상태를 바꾸려면 실제 항목 목록을 함께 저장해 주세요.",
          code: "CHECKLIST_ITEMS_REQUIRED",
        },
        400,
      );
    }
    if (removesProtectedChecklistProgress(
      parsed.value.changes,
      currentProgress,
    )) {
      return privateResponse(
        {
          error: "저장된 체크리스트와 상황 설정은 삭제할 수 없습니다. 해당 없음이나 상황 변경으로 정리해 주세요.",
          code: "CHECKLIST_DELETE_NOT_ALLOWED",
        },
        400,
      );
    }
    if (hasUnsafeChecklistItemIdentityTransition(
      parsed.value.changes,
      currentProgress,
    )) {
      return privateResponse(
        {
          error: "저장된 체크리스트 항목을 삭제하거나 알 수 없는 항목으로 바꿀 수 없습니다.",
          code: "CHECKLIST_ITEMS_INVALID",
        },
        400,
      );
    }
    if (hasUnsafeChecklistItemFieldTransition(
      parsed.value.changes,
      currentProgress,
    )) {
      return privateResponse(
        {
          error: "저장된 체크리스트 항목의 담당자·기한·메모·완료 기록을 빠뜨릴 수 없어요. 최신 항목 전체를 다시 불러와 저장해 주세요.",
          code: "CHECKLIST_ITEM_FIELDS_REQUIRED",
        },
        400,
      );
    }
    if (hasUnsafeChecklistCategoryFieldTransition(
      parsed.value.changes,
      currentProgress,
    )) {
      return privateResponse(
        {
          error: "체크리스트 분야의 기존 정보를 빠뜨리거나 지원하지 않는 필드를 새로 저장할 수 없습니다.",
          code: "CHECKLIST_FIELDS_INVALID",
        },
        400,
      );
    }
    if (hasForgedChecklistCompletionActor(
      parsed.value.changes,
      currentProgress,
      user.id,
    )) {
      return privateResponse(
        { error: "완료 기록은 실제로 체크한 본인만 남길 수 있습니다." },
        400,
      );
    }
    if (hasForgedChecklistReviewActor(
      parsed.value.changes,
      currentProgress,
      user.id,
    )) {
      return privateResponse(
        { error: "분야 검토 기록은 실제로 확인한 본인만 남길 수 있습니다." },
        400,
      );
    }

    let rpcChanges = canonicalizeChecklistServerProvenance(
      parsed.value.changes,
      currentProgress,
      user.id,
      new Date().toISOString(),
    );
    rpcChanges = preserveUnchangedLegacyChecklistShapes(
      rpcChanges,
      currentJourney.progress,
    );
    if (hasOwn(rpcChanges, "progress")) {
      const nextProgress = rpcChanges.progress;
      if (!isRecord(nextProgress)) {
        return privateResponse({ error: "진행 데이터 형식이 올바르지 않습니다." }, 400);
      }

      const progressPatch: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(nextProgress)) {
        if (!jsonValuesEqual(value, currentProgress[key])) {
          progressPatch[key] = value;
        }
      }
      const progressRemoveKeys = Object.keys(currentProgress)
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

    rpcChanges = removeNoOpJourneyChanges(
      rpcChanges,
      currentJourney,
      currentProgress,
      semanticallyUnchangedChecklistProfile,
    );
    if (Object.keys(rpcChanges).length === 0) {
      return privateResponse(
        {
          error: "우리 상황 설정에 달라진 내용이 없어요.",
          code: "CHECKLIST_PROFILE_NO_CHANGES",
        },
        400,
      );
    }
    const effectiveSummary = deriveSummary(rpcChanges);
    if (!effectiveSummary) {
      return privateResponse(
        { error: "변경 요약을 안전하게 만들 수 없습니다." },
        400,
      );
    }
    const effectivePatch: ParsedPatch = {
      ...parsed.value,
      changes: rpcChanges,
      summary: effectiveSummary,
      surface: deriveSurface(buildSemanticChangeView(rpcChanges, currentJourney)),
    };

    const { data, error } = await createAdminClient().rpc(
      "submit_couple_plan_change",
      {
        p_couple_id: coupleId,
        p_actor_user_id: user.id,
        p_expected_revision: parsed.value.expectedRevision,
        p_changes: rpcChanges,
        p_surface: effectivePatch.surface,
        p_summary: effectivePatch.summary,
      },
    );
    if (error) return serviceErrorResponse(error);

    const result = parsePlanChangeResult(
      data,
      coupleId,
      parsed.value.expectedRevision,
    );
    if (!result) {
      console.error("Couple plan-change RPC returned an invalid result.");
      return privateResponse(
        {
          error: "변경 요청의 저장 상태를 확인하지 못했어요. 잠시 후 다시 확인해 주세요.",
          code: "PLAN_CHANGE_UNAVAILABLE",
        },
        503,
      );
    }
    return submitResponse(result, effectivePatch);
  } catch (error) {
    console.error("Journey plan-change API error:", error);
    return privateResponse({ error: "서버 오류" }, 500);
  }
}
