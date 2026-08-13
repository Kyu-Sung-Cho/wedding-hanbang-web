export type PlanningChecklistStatus =
  | "not_started"
  | "in_progress"
  | "completed"
  | "not_applicable";

export type PlanningChecklistItemState =
  | "todo"
  | "in_progress"
  | "waiting"
  | "blocked"
  | "completed"
  | "not_applicable";

/**
 * 보는 사람에 따라 뜻이 바뀌는 `me`/`partner` 대신 안정적인 담당자 식별자를 저장한다.
 */
export type PlanningChecklistAssignee =
  | { kind: "member"; profileId: string }
  | { kind: "couple" }
  | { kind: "external"; label: string };

export interface PlanningChecklistItem {
  id: string;
  label: string;
  done: boolean;
  /** `done`은 구버전 호환용이며 새 화면의 정본은 state다. */
  state?: PlanningChecklistItemState;
  assignee?: PlanningChecklistAssignee | null;
  /** 사용자가 정한 개인 마감일(YYYY-MM-DD). */
  dueDate?: string | null;
  note?: string;
  completedAt?: string | null;
  completedByProfileId?: string | null;
}

export interface PlanningChecklistProgress {
  status?: PlanningChecklistStatus;
  checklist?: PlanningChecklistItem[];
  /** 사용자가 이 분야의 적용 여부를 명시적으로 확인한 증거. */
  checklistReviewedAt?: string;
  checklistReviewedByProfileId?: string | null;
  checklistReviewSource?: "manual" | "situation_profile";
}

export function hasChecklistReviewEvidence(value: PlanningChecklistProgress | undefined): boolean {
  return Boolean(
    value
    && (
      typeof value.checklistReviewedAt === "string"
      || value.status === "not_applicable"
      || value.status === "in_progress"
      || value.status === "completed"
      || value.checklist?.some((item) => {
        const state = getItemState(item);
        return state === "completed"
          || state === "in_progress"
          || state === "waiting"
          || state === "blocked"
          || state === "not_applicable"
          || item.assignee !== undefined
          || Boolean(item.dueDate)
          || Boolean(item.note?.trim())
          || Boolean(item.completedAt)
          || Boolean(item.completedByProfileId);
      }) === true
    )
  );
}

export interface PlanningChecklistTemplateLike {
  key: string;
  label?: string;
  items: PlanningChecklistItem[];
  /** 생략되면 기존(v1) 템플릿으로 간주한다. */
  introducedInVersion?: 1 | 2;
  /** 양수=D-n, 0=D-day, 음수=D+n. 개인 마감일이 없을 때만 제안에 쓴다. */
  ddayDeadline?: number;
}

export interface PlanningChecklistGuidanceLike {
  completionCriteria?: string;
  tip?: string;
  caution?: string;
  /** 양수=D-n, 0=D-day, 음수=D+n. */
  relativeDueDays?: number;
  applicabilityTags?: readonly string[];
}

export type PlanningChecklistTriState = "yes" | "no" | "undecided";

export interface PlanningChecklistProfileAnswers {
  ceremony: PlanningChecklistTriState;
  legalMarriage: PlanningChecklistTriState;
  travel: "domestic" | "international" | "none" | "undecided";
  housing: "rent" | "buy" | "other" | "undecided";
  internationalMarriage: boolean | null;
  religiousCeremony: boolean | null;
  remarriage: boolean | null;
  childrenParticipating: boolean | null;
  accessibilitySupport: boolean | null;
  healthSupport: boolean | null;
  petParticipation: boolean | null;
  familyTradition: boolean | null;
}

export interface PlanningChecklistProfile {
  version: 1;
  reviewedAt: string;
  answers: PlanningChecklistProfileAnswers;
  /** 이 설정이 자동 제외한 항목만 기록한다. 사용자가 직접 제외한 항목과 구분한다. */
  autoExcludedItemIds: string[];
}

export const PLANNING_CHECKLIST_PROFILE_KEY = "__checklist_profile" as const;

export const DEFAULT_PLANNING_CHECKLIST_PROFILE_ANSWERS: Readonly<PlanningChecklistProfileAnswers> = Object.freeze({
  ceremony: "undecided",
  legalMarriage: "undecided",
  travel: "undecided",
  housing: "undecided",
  internationalMarriage: null,
  religiousCeremony: null,
  remarriage: null,
  childrenParticipating: null,
  accessibilitySupport: null,
  healthSupport: null,
  petParticipation: null,
  familyTradition: null,
});

const PLANNING_CHECKLIST_PROFILE_ANSWER_KEYS = Object.keys(
  DEFAULT_PLANNING_CHECKLIST_PROFILE_ANSWERS,
) as Array<keyof PlanningChecklistProfileAnswers>;

export function isCanonicalPlanningChecklistProfile(
  value: unknown,
): value is PlanningChecklistProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<PlanningChecklistProfile> & Record<string, unknown>;
  if (
    Object.keys(candidate).length !== 4
    || !["version", "reviewedAt", "answers", "autoExcludedItemIds"].every((key) => (
      Object.prototype.hasOwnProperty.call(candidate, key)
    ))
    || candidate.version !== 1
    || typeof candidate.reviewedAt !== "string"
    || !Number.isFinite(Date.parse(candidate.reviewedAt))
    || new Date(candidate.reviewedAt).toISOString() !== candidate.reviewedAt
    || !candidate.answers
    || typeof candidate.answers !== "object"
    || Array.isArray(candidate.answers)
    || Object.keys(candidate.answers).length !== PLANNING_CHECKLIST_PROFILE_ANSWER_KEYS.length
    || !PLANNING_CHECKLIST_PROFILE_ANSWER_KEYS.every((key) => (
      Object.prototype.hasOwnProperty.call(candidate.answers, key)
    ))
    || !Array.isArray(candidate.autoExcludedItemIds)
  ) return false;
  const answers = candidate.answers as unknown as Record<string, unknown>;
  if (
    !(answers.ceremony === "yes" || answers.ceremony === "no" || answers.ceremony === "undecided")
    || !(answers.legalMarriage === "yes" || answers.legalMarriage === "no" || answers.legalMarriage === "undecided")
    || !(answers.travel === "domestic" || answers.travel === "international" || answers.travel === "none" || answers.travel === "undecided")
    || !(answers.housing === "rent" || answers.housing === "buy" || answers.housing === "other" || answers.housing === "undecided")
    || [
      "internationalMarriage",
      "religiousCeremony",
      "remarriage",
      "childrenParticipating",
      "accessibilitySupport",
      "healthSupport",
      "petParticipation",
      "familyTradition",
    ].some((key) => answers[key] !== null && typeof answers[key] !== "boolean")
  ) return false;
  const seen = new Set<string>();
  for (const itemId of candidate.autoExcludedItemIds) {
    if (
      typeof itemId !== "string"
      || !/^[a-z0-9][a-z0-9_-]{0,119}$/.test(itemId)
      || seen.has(itemId)
    ) return false;
    seen.add(itemId);
  }
  return true;
}

/**
 * 구버전의 부분 상황 설정을 안전한 기본값 위에 올린다.
 * 새 저장은 항상 정확한 v1 모양을 쓰며, 알 수 없는 값은 추측하지 않고 미정으로 둔다.
 */
export function normalizePlanningChecklistProfile(
  value: unknown,
): PlanningChecklistProfile | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Partial<PlanningChecklistProfile> & Record<string, unknown>;
  if (candidate.version !== 1) return undefined;
  const rawAnswers = candidate.answers && typeof candidate.answers === "object" && !Array.isArray(candidate.answers)
    ? candidate.answers as unknown as Record<string, unknown>
    : {};
  const triState = (answer: unknown): PlanningChecklistTriState => (
    answer === "yes" || answer === "no" || answer === "undecided" ? answer : "undecided"
  );
  const travel = rawAnswers.travel;
  const housing = rawAnswers.housing;
  const optionalBoolean = (answer: unknown): boolean | null => (
    typeof answer === "boolean" ? answer : null
  );
  const autoExcludedItemIds = Array.isArray(candidate.autoExcludedItemIds)
    ? [...new Set(candidate.autoExcludedItemIds.filter(
        (itemId): itemId is string => typeof itemId === "string" && /^[a-z0-9][a-z0-9_-]{0,119}$/.test(itemId),
      ))]
    : [];
  return {
    version: 1,
    reviewedAt: typeof candidate.reviewedAt === "string" && Number.isFinite(Date.parse(candidate.reviewedAt))
      ? candidate.reviewedAt
      : new Date(0).toISOString(),
    answers: {
      ...DEFAULT_PLANNING_CHECKLIST_PROFILE_ANSWERS,
      ceremony: triState(rawAnswers.ceremony),
      legalMarriage: triState(rawAnswers.legalMarriage),
      travel: travel === "domestic" || travel === "international" || travel === "none" || travel === "undecided"
        ? travel
        : "undecided",
      housing: housing === "rent" || housing === "buy" || housing === "other" || housing === "undecided"
        ? housing
        : "undecided",
      internationalMarriage: optionalBoolean(rawAnswers.internationalMarriage),
      religiousCeremony: optionalBoolean(rawAnswers.religiousCeremony),
      remarriage: optionalBoolean(rawAnswers.remarriage),
      childrenParticipating: optionalBoolean(rawAnswers.childrenParticipating),
      accessibilitySupport: optionalBoolean(rawAnswers.accessibilitySupport),
      healthSupport: optionalBoolean(rawAnswers.healthSupport),
      petParticipation: optionalBoolean(rawAnswers.petParticipation),
      familyTradition: optionalBoolean(rawAnswers.familyTradition),
    },
    autoExcludedItemIds,
  };
}

const ITEM_STATES = new Set<PlanningChecklistItemState>([
  "todo",
  "in_progress",
  "waiting",
  "blocked",
  "completed",
  "not_applicable",
]);

function getItemState(item: PlanningChecklistItem): PlanningChecklistItemState {
  if (item.state && ITEM_STATES.has(item.state)) return item.state;
  const legacyCompleted = (item as unknown as { completed?: unknown }).completed;
  return item.done === true || legacyCompleted === true ? "completed" : "todo";
}

/** 구버전 done 값과 새 state 값을 모순 없이 한 형태로 만든다. */
export function normalizePlanningChecklistItem<T extends PlanningChecklistItem>(
  item: T,
): T {
  const state = getItemState(item);
  const done = state === "completed";
  const { completed: _legacyCompleted, ...canonicalItem } = item as T & {
    completed?: unknown;
  };
  return {
    ...canonicalItem,
    state,
    done,
    ...(state === "completed"
      ? {}
      : Object.prototype.hasOwnProperty.call(item, "completedAt")
        ? { completedAt: null }
        : {}),
    ...(state === "completed"
      ? {}
      : Object.prototype.hasOwnProperty.call(item, "completedByProfileId")
        ? { completedByProfileId: null }
        : {}),
  } as T;
}

/**
 * 템플릿의 안정적인 순서를 유지하면서 이전 버전·직접 추가 항목도 잃지 않는다.
 * 알 수 없는 저장 항목은 마지막에 붙여 round-trip 저장 시에도 보존한다.
 */
export function mergePlanningChecklist<T extends PlanningChecklistItem>(
  template: readonly T[],
  saved: readonly T[] | undefined,
  _legacyStatus?: PlanningChecklistStatus,
): T[] {
  if (!Array.isArray(saved) || saved.length === 0) {
    return template.map((item) => normalizePlanningChecklistItem({
      ...item,
      // A category-level legacy status is review evidence, not proof that each
      // newly introduced canonical item was completed. Keep every item pending
      // until the couple confirms it item by item.
      state: "todo",
      done: false,
    }));
  }

  const savedById = new Map<string, T>();
  for (const item of saved) {
    if (!savedById.has(item.id)) savedById.set(item.id, item);
  }
  const templateIds = new Set(template.map((item) => item.id));
  const merged = template.map((item) => {
    const savedItem = savedById.get(item.id);
    return normalizePlanningChecklistItem({
      ...(savedItem ?? {}),
      ...item,
      state: savedItem ? getItemState(savedItem) : "todo",
      done: savedItem?.done ?? false,
    } as T);
  });

  const appendedIds = new Set<string>();
  for (const item of saved) {
    if (!templateIds.has(item.id) && !appendedIds.has(item.id)) {
      merged.push(normalizePlanningChecklistItem({
        ...item,
        label: typeof item.label === "string" && item.label.trim().length > 0
          ? item.label
          : item.id,
      }));
      appendedIds.add(item.id);
    }
  }
  return merged;
}

export function calculatePlanningChecklistStatus(
  checklist: readonly PlanningChecklistItem[],
): PlanningChecklistStatus {
  if (checklist.length === 0) {
    return "not_started";
  }
  const applicable = checklist.filter(
    (item) => getItemState(item) !== "not_applicable",
  );
  if (applicable.length === 0) return "not_applicable";
  if (applicable.every((item) => getItemState(item) === "completed")) {
    return "completed";
  }
  if (applicable.every((item) => getItemState(item) === "todo")) {
    return "not_started";
  }
  return "in_progress";
}

/**
 * Returns the canonical category status derived from item-level evidence.
 * A legacy category-level `completed`/`in_progress` value proves only that the
 * category was reviewed; it cannot complete or hide newly materialized items.
 * Explicit category-level N/A remains authoritative because it is a deliberate
 * applicability decision and may exist without an item array.
 */
export function getEffectivePlanningChecklistStatus(
  template: readonly PlanningChecklistItem[],
  saved: PlanningChecklistProgress | undefined,
): PlanningChecklistStatus {
  if (saved?.status === "not_applicable") return "not_applicable";
  return calculatePlanningChecklistStatus(
    mergePlanningChecklist(template, saved?.checklist, saved?.status),
  );
}

export interface PlanningChecklistCompletionAudit {
  completedAt: string;
  completedByProfileId?: string | null;
}

/** 카테고리 단위 상태 변경을 항목 상태로 투영해 두 개의 진실이 생기지 않게 한다. */
export function setPlanningChecklistCategoryStatus<T extends PlanningChecklistItem>(
  template: readonly T[],
  saved: readonly T[] | undefined,
  previousStatus: PlanningChecklistStatus | undefined,
  nextStatus: PlanningChecklistStatus,
  audit: PlanningChecklistCompletionAudit,
): { status: PlanningChecklistStatus; checklist: T[] } {
  const merged = mergePlanningChecklist(template, saved, previousStatus);
  if (nextStatus === "not_applicable") {
    return { status: nextStatus, checklist: merged };
  }
  const hasEvidenceOfProgress = merged.some((item) => {
    const state = getItemState(item);
    return state !== "todo" && state !== "not_applicable";
  });
  let promotedOne = false;
  const checklist = merged.map((item) => {
    const state = getItemState(item);
    if (state === "not_applicable") return item;
    if (nextStatus === "completed") {
      if (state === "completed") return item;
      return normalizePlanningChecklistItem({
        ...item,
        state: "completed",
        done: true,
        completedAt: audit.completedAt,
        ...(audit.completedByProfileId
          ? { completedByProfileId: audit.completedByProfileId }
          : {}),
      } as T);
    }
    if (nextStatus === "not_started") {
      if (
        state === "todo"
        && item.completedAt == null
        && item.completedByProfileId == null
      ) return item;
      return normalizePlanningChecklistItem({
        ...item,
        state: "todo",
        done: false,
        completedAt: null,
        completedByProfileId: null,
      } as T);
    }
    if (!hasEvidenceOfProgress && !promotedOne) {
      promotedOne = true;
      return normalizePlanningChecklistItem({
        ...item,
        state: "in_progress",
        done: false,
      } as T);
    }
    return item;
  });
  return {
    status: calculatePlanningChecklistStatus(checklist),
    checklist,
  };
}

export function getPlanningChecklistCounts(
  checklist: readonly PlanningChecklistItem[] | undefined,
): { done: number; total: number } {
  if (!checklist || checklist.length === 0) return { done: 0, total: 0 };
  const applicable = checklist.filter(
    (item) => getItemState(item) !== "not_applicable",
  );
  return {
    done: applicable.filter((item) => getItemState(item) === "completed").length,
    total: applicable.length,
  };
}

export interface PlanningChecklistSummary {
  /** 미검토 분야까지 포함한 보수적인 전체 진행률. */
  done: number;
  total: number;
  percent: number;
  /** 사용자가 검토한 분야 안에서의 실행 진행률. */
  executionDone: number;
  executionTotal: number;
  executionPercent: number;
  skippedCategories: number;
  completedCategories: number;
  applicableCategories: number;
  reviewedCategories: number;
  unreviewedCategories: number;
  coveragePercent: number;
  /** 하위 호환 이름: 아직 검토하지 않은 v2 분야 수. */
  availableNewCategories: number;
}

/** 웹·모바일·아모라가 공유하는 단일 진행률 계약. */
export function summarizePlanningChecklist(
  templates: readonly PlanningChecklistTemplateLike[],
  progress: Readonly<Record<string, PlanningChecklistProgress | undefined>>,
): PlanningChecklistSummary {
  let done = 0;
  let total = 0;
  let executionDone = 0;
  let executionTotal = 0;
  let skippedCategories = 0;
  let completedCategories = 0;
  let applicableCategories = 0;
  let availableNewCategories = 0;
  let reviewedCategories = 0;

  for (const template of templates) {
    const saved = progress[template.key];
    const hasReviewedCategory = hasChecklistReviewEvidence(saved);
    if (hasReviewedCategory) reviewedCategories += 1;
    if (template.introducedInVersion === 2 && !hasReviewedCategory) {
      availableNewCategories += 1;
    }

    if (saved?.status === "not_applicable") {
      skippedCategories += 1;
      continue;
    }

    applicableCategories += 1;
    const merged = mergePlanningChecklist(
      template.items,
      saved?.checklist,
      saved?.status,
    );
    if (calculatePlanningChecklistStatus(merged) === "not_applicable") {
      skippedCategories += 1;
      applicableCategories -= 1;
      continue;
    }
    const counts = getPlanningChecklistCounts(merged);
    done += counts.done;
    total += counts.total;
    if (hasReviewedCategory) {
      executionDone += counts.done;
      executionTotal += counts.total;
    }
    if (counts.total > 0 && counts.done === counts.total) completedCategories += 1;
  }

  const unreviewedCategories = Math.max(0, templates.length - reviewedCategories);

  return {
    done,
    total,
    percent: total > 0 ? Math.round((done / total) * 100) : 0,
    executionDone,
    executionTotal,
    executionPercent: executionTotal > 0
      ? Math.round((executionDone / executionTotal) * 100)
      : 0,
    skippedCategories,
    completedCategories,
    applicableCategories,
    reviewedCategories,
    unreviewedCategories,
    coveragePercent: templates.length > 0
      ? Math.round((reviewedCategories / templates.length) * 100)
      : 0,
    availableNewCategories,
  };
}

export type PlanningChecklistTiming =
  | "overdue"
  | "today"
  | "upcoming"
  | "later"
  | "unscheduled";

export interface PlanningChecklistInsight {
  categoryKey: string;
  categoryLabel: string;
  itemId: string;
  label: string;
  state: PlanningChecklistItemState;
  assignee?: PlanningChecklistAssignee | null;
  dueDate?: string;
  dueDateSource?: "personal" | "suggested";
  daysUntilDue?: number;
  timing: PlanningChecklistTiming;
  completionCriteria?: string;
  tip?: string;
  caution?: string;
}

export interface PlanningChecklistInsights {
  today: PlanningChecklistInsight[];
  overdue: PlanningChecklistInsight[];
  upcoming: PlanningChecklistInsight[];
  later: PlanningChecklistInsight[];
  unscheduled: PlanningChecklistInsight[];
  all: PlanningChecklistInsight[];
  review: PlanningChecklistReviewSuggestion[];
}

export interface PlanningChecklistReviewSuggestion {
  categoryKey: string;
  categoryLabel: string;
  dueDate?: string;
  daysUntilDue?: number;
  timing: PlanningChecklistTiming;
}

export interface PlanningChecklistInsightOptions {
  weddingDate?: string | null;
  today: string;
  currentProfileId?: string;
  guidance?: Readonly<Record<string, PlanningChecklistGuidanceLike | undefined>>;
  /** 기본 14일. */
  upcomingWindowDays?: number;
  /** 기본 false. 미검토 분야의 수백 개 항목을 긴급 목록에 바로 넣지 않는다. */
  includeUnreviewedItems?: boolean;
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseIsoDate(value: string | null | undefined): Date | null {
  if (!value || !ISO_DATE_PATTERN.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
    ? date
    : null;
}

function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

function timingFor(daysUntilDue: number | undefined, upcomingWindowDays: number) {
  if (daysUntilDue === undefined) return "unscheduled" as const;
  if (daysUntilDue < 0) return "overdue" as const;
  if (daysUntilDue === 0) return "today" as const;
  if (daysUntilDue <= upcomingWindowDays) return "upcoming" as const;
  return "later" as const;
}

/**
 * 저장된 개인 마감일을 우선하고, 없을 때만 D-day 기준일을 '제안일'로 계산한다.
 * 완료·해당없음 항목은 실행 목록에서 제외한다.
 */
export function buildPlanningChecklistInsights(
  templates: readonly PlanningChecklistTemplateLike[],
  progress: Readonly<Record<string, PlanningChecklistProgress | undefined>>,
  options: PlanningChecklistInsightOptions,
): PlanningChecklistInsights {
  const todayDate = parseIsoDate(options.today);
  if (!todayDate) throw new Error("today must be a valid YYYY-MM-DD date");
  const weddingDate = parseIsoDate(options.weddingDate);
  const upcomingWindowDays = Number.isInteger(options.upcomingWindowDays)
    && (options.upcomingWindowDays ?? 0) >= 1
    ? options.upcomingWindowDays as number
    : 14;
  const all: PlanningChecklistInsight[] = [];
  const review: PlanningChecklistReviewSuggestion[] = [];

  for (const template of templates) {
    const saved = progress[template.key];
    const hasReviewedCategory = hasChecklistReviewEvidence(saved);
    if (saved?.status === "not_applicable") continue;
    if (!hasReviewedCategory && options.includeUnreviewedItems !== true) {
      const suggestedDueDate = weddingDate
        && typeof template.ddayDeadline === "number"
        && Number.isInteger(template.ddayDeadline)
        ? addUtcDays(weddingDate, -template.ddayDeadline)
        : null;
      const daysUntilDue = suggestedDueDate
        ? daysBetween(todayDate, suggestedDueDate)
        : undefined;
      review.push({
        categoryKey: template.key,
        categoryLabel: template.label ?? template.key,
        ...(suggestedDueDate ? { dueDate: formatIsoDate(suggestedDueDate) } : {}),
        ...(daysUntilDue !== undefined ? { daysUntilDue } : {}),
        timing: timingFor(daysUntilDue, upcomingWindowDays),
      });
      continue;
    }
    const merged = mergePlanningChecklist(
      template.items,
      saved?.checklist,
      saved?.status,
    );
    for (const item of merged) {
      const state = getItemState(item);
      if (state === "completed" || state === "not_applicable") continue;
      const guidance = options.guidance?.[item.id];
      const personalDueDate = parseIsoDate(item.dueDate);
      const relativeDueDays = guidance?.relativeDueDays ?? template.ddayDeadline;
      const suggestedDueDate = !personalDueDate
        && weddingDate
        && typeof relativeDueDays === "number"
        && Number.isInteger(relativeDueDays)
        ? addUtcDays(weddingDate, -relativeDueDays)
        : null;
      const due = personalDueDate ?? suggestedDueDate;
      const daysUntilDue = due ? daysBetween(todayDate, due) : undefined;
      const timing = timingFor(daysUntilDue, upcomingWindowDays);
      all.push({
        categoryKey: template.key,
        categoryLabel: template.label ?? template.key,
        itemId: item.id,
        label: item.label,
        state,
        ...(item.assignee ? { assignee: item.assignee } : {}),
        ...(due ? { dueDate: formatIsoDate(due) } : {}),
        ...(due
          ? { dueDateSource: personalDueDate ? "personal" : "suggested" }
          : {}),
        ...(daysUntilDue !== undefined ? { daysUntilDue } : {}),
        timing,
        ...(guidance?.completionCriteria
          ? { completionCriteria: guidance.completionCriteria }
          : {}),
        ...(guidance?.tip ? { tip: guidance.tip } : {}),
        ...(guidance?.caution ? { caution: guidance.caution } : {}),
      });
    }
  }

  const timingRank: Record<PlanningChecklistTiming, number> = {
    overdue: 0,
    today: 1,
    upcoming: 2,
    later: 3,
    unscheduled: 4,
  };
  all.sort((left, right) => (
    timingRank[left.timing] - timingRank[right.timing]
    || (left.daysUntilDue ?? Number.MAX_SAFE_INTEGER)
      - (right.daysUntilDue ?? Number.MAX_SAFE_INTEGER)
    || left.categoryKey.localeCompare(right.categoryKey)
    || left.itemId.localeCompare(right.itemId)
  ));
  review.sort((left, right) => (
    timingRank[left.timing] - timingRank[right.timing]
    || (left.daysUntilDue ?? Number.MAX_SAFE_INTEGER)
      - (right.daysUntilDue ?? Number.MAX_SAFE_INTEGER)
    || left.categoryKey.localeCompare(right.categoryKey)
  ));

  return {
    today: all.filter((item) => item.timing === "today"),
    overdue: all.filter((item) => item.timing === "overdue"),
    upcoming: all.filter((item) => item.timing === "upcoming"),
    later: all.filter((item) => item.timing === "later"),
    unscheduled: all.filter((item) => item.timing === "unscheduled"),
    all,
    review,
  };
}

function readProgressCategory(value: unknown): PlanningChecklistProgress | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as PlanningChecklistProgress;
}

function readStoredChecklistProfile(value: unknown): PlanningChecklistProfile | undefined {
  return isCanonicalPlanningChecklistProfile(value) ? value : undefined;
}

function answerForApplicabilityTag(
  tag: string,
  answers: PlanningChecklistProfileAnswers,
): boolean | null {
  switch (tag) {
    case "ceremony":
      return answers.ceremony === "undecided" ? null : answers.ceremony === "yes";
    case "no_ceremony":
      return answers.ceremony === "undecided" ? null : answers.ceremony === "no";
    case "legal_marriage":
      return answers.legalMarriage === "undecided"
        ? null
        : answers.legalMarriage === "yes";
    case "international_marriage":
      return answers.internationalMarriage;
    case "religious_ceremony":
      return answers.religiousCeremony;
    case "remarriage":
      return answers.remarriage;
    case "children_participating":
      return answers.childrenParticipating;
    case "pregnancy_or_health_support":
      return answers.healthSupport;
    case "accessibility_support":
      return answers.accessibilitySupport;
    case "pet_participation":
      return answers.petParticipation;
    case "travel":
      return answers.travel === "undecided"
        ? null
        : answers.travel !== "none";
    case "overseas_travel":
      return answers.travel === "undecided"
        ? null
        : answers.travel === "international";
    case "rental_home":
      return answers.housing === "undecided" ? null : answers.housing === "rent";
    case "home_purchase":
      return answers.housing === "undecided" ? null : answers.housing === "buy";
    case "family_tradition":
      return answers.familyTradition;
    // 피로연은 예식 없이도 할 수 있어 ceremony 응답만으로 자동 제외하지 않는다.
    case "reception":
    default:
      return null;
  }
}

function isExplicitlyInapplicable(
  tags: readonly string[] | undefined,
  answers: PlanningChecklistProfileAnswers,
): boolean {
  if (!tags || tags.length === 0) return false;
  const decisions = tags.map((tag) => answerForApplicabilityTag(tag, answers));
  // 하나라도 해당하면 보존하고, 모든 조건이 명시적으로 아니라고 답한 때만 제외한다.
  return decisions.length > 0 && decisions.every((decision) => decision === false);
}

export interface PlanningChecklistProfileApplication {
  profile: PlanningChecklistProfile;
  categoryProgressPatch: Record<string, PlanningChecklistProgress>;
  progressPatch: Record<string, PlanningChecklistProgress | PlanningChecklistProfile>;
  excludedItemIds: string[];
  restoredItemIds: string[];
}

function categoryApplicabilityWasDecided(
  template: PlanningChecklistTemplateLike,
  answers: PlanningChecklistProfileAnswers,
  guidance: Readonly<Record<string, PlanningChecklistGuidanceLike | undefined>>,
): boolean {
  const taggedItems = template.items.filter(
    (item) => (guidance[item.id]?.applicabilityTags?.length ?? 0) > 0,
  );
  return taggedItems.length > 0 && taggedItems.every((item) => {
    const decisions = guidance[item.id]?.applicabilityTags?.map(
      (tag) => answerForApplicabilityTag(tag, answers),
    ) ?? [];
    return decisions.some((decision) => decision === true)
      || (decisions.length > 0 && decisions.every((decision) => decision === false));
  });
}

/**
 * 상황 설정은 자동 저장하지 않는다. 호출자는 반환된 변경 미리보기를 보여준 뒤
 * 사용자가 확인했을 때 profile과 category patch를 한 변경 요청으로 저장해야 한다.
 */
export function applyPlanningChecklistProfile(
  templates: readonly PlanningChecklistTemplateLike[],
  progress: Readonly<Record<string, unknown>>,
  nextProfile: PlanningChecklistProfile,
  guidance: Readonly<Record<string, PlanningChecklistGuidanceLike | undefined>>,
  reviewedByProfileId?: string | null,
): PlanningChecklistProfileApplication {
  const previousProfile = readStoredChecklistProfile(
    progress[PLANNING_CHECKLIST_PROFILE_KEY],
  );
  const previouslyAutoExcluded = new Set(
    previousProfile?.autoExcludedItemIds ?? [],
  );
  const nextAutoExcluded = new Set<string>();
  const excludedItemIds: string[] = [];
  const restoredItemIds: string[] = [];
  const progressPatch: Record<
    string,
    PlanningChecklistProgress | PlanningChecklistProfile
  > = {};
  const categoryProgressPatch: Record<string, PlanningChecklistProgress> = {};

  for (const template of templates) {
    const saved = readProgressCategory(progress[template.key]);
    const savedChecklist = saved?.checklist;
    const categoryWasFullyAutoExcluded = Array.isArray(savedChecklist)
      && savedChecklist.length > 0
      && savedChecklist.every((item) => (
        previouslyAutoExcluded.has(item.id)
        && getItemState(item) === "not_applicable"
      ));
    const categoryNotApplicableWasSituationOwned = saved?.status === "not_applicable"
      && saved.checklistReviewSource === "situation_profile"
      && categoryWasFullyAutoExcluded;
    const merged = mergePlanningChecklist(
      template.items,
      saved?.checklist,
      saved?.status,
    );
    const savedItemIds = new Set(savedChecklist?.map((item) => item.id) ?? []);
    let changed = Array.isArray(savedChecklist)
      && template.items.some((item) => !savedItemIds.has(item.id));
    const checklist = merged.map((item) => {
      const applicabilityTags = guidance[item.id]?.applicabilityTags;
      const explicitlyInapplicable = isExplicitlyInapplicable(
        applicabilityTags,
        nextProfile.answers,
      );
      if (explicitlyInapplicable) {
        const itemState = getItemState(item);
        const ownedByPreviousProfile = previouslyAutoExcluded.has(item.id);
        if (ownedByPreviousProfile || itemState !== "not_applicable") {
          nextAutoExcluded.add(item.id);
        }
        if (itemState !== "not_applicable") {
          excludedItemIds.push(item.id);
          changed = true;
        }
        return normalizePlanningChecklistItem({
          ...item,
          state: "not_applicable",
          done: false,
        });
      }
      if (
        previouslyAutoExcluded.has(item.id)
        && getItemState(item) === "not_applicable"
      ) {
        restoredItemIds.push(item.id);
        changed = true;
        return normalizePlanningChecklistItem({
          ...item,
          state: "todo",
          done: false,
        });
      }
      return item;
    });

    const profileReviewedCategory = categoryApplicabilityWasDecided(
      template,
      nextProfile.answers,
      guidance,
    );
    const shouldWriteReview = profileReviewedCategory
      && !hasChecklistReviewEvidence(saved);
    const shouldClearSituationReview = saved?.checklistReviewSource === "situation_profile"
      && !profileReviewedCategory;
    if (changed || shouldWriteReview || shouldClearSituationReview) {
      const categoryPatch: PlanningChecklistProgress = {
        ...(saved ?? {}),
        status: saved?.status === "not_applicable"
          && !categoryNotApplicableWasSituationOwned
          ? "not_applicable"
          : calculatePlanningChecklistStatus(checklist),
        checklist,
        ...(shouldWriteReview
          ? {
              checklistReviewedAt: nextProfile.reviewedAt,
              checklistReviewedByProfileId: reviewedByProfileId ?? null,
              checklistReviewSource: "situation_profile" as const,
            }
          : {}),
      };
      if (shouldClearSituationReview) {
        delete categoryPatch.checklistReviewedAt;
        delete categoryPatch.checklistReviewedByProfileId;
        delete categoryPatch.checklistReviewSource;
      }
      categoryProgressPatch[template.key] = categoryPatch;
      progressPatch[template.key] = categoryPatch;
    }
  }

  excludedItemIds.sort();
  restoredItemIds.sort();
  const profile: PlanningChecklistProfile = {
    ...nextProfile,
    autoExcludedItemIds: [...nextAutoExcluded].sort(),
  };
  progressPatch[PLANNING_CHECKLIST_PROFILE_KEY] = profile;
  return {
    profile,
    categoryProgressPatch,
    progressPatch,
    excludedItemIds,
    restoredItemIds,
  };
}
