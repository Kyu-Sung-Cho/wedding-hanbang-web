export type ChecklistItemState =
  | "todo"
  | "in_progress"
  | "waiting"
  | "blocked"
  | "completed"
  | "not_applicable";

export type ChecklistAssignee =
  | { kind: "member"; profileId: string }
  | { kind: "couple" }
  | { kind: "external"; label: string };

export interface MobileChecklistItem {
  id: string;
  label: string;
  done: boolean;
  state?: ChecklistItemState;
  assignee?: ChecklistAssignee | null;
  dueDate?: string | null;
  note?: string;
  completedAt?: string | null;
  completedByProfileId?: string | null;
}

export interface MobileChecklistCategory {
  key: string;
  label: string;
  tip?: string;
  ddayDeadline?: number;
  status?: string;
  items: MobileChecklistItem[];
}

export interface ChecklistFocusItem {
  categoryKey: string;
  categoryLabel: string;
  itemId: string;
  itemLabel: string;
  state: ChecklistItemState;
  dueDate: string;
  assignee?: ChecklistAssignee;
}

export function buildChecklistCategoryOptions(
  templates: readonly { key: string; label: string }[],
): Array<{ key: string; label: string }>;

export function normalizeChecklistItem<T extends MobileChecklistItem>(
  item: T,
): T & { state: ChecklistItemState };

export function readChecklistItemsSnapshot(
  value: unknown,
): Array<MobileChecklistItem & { state: ChecklistItemState }> | undefined;

export function resolveProtectedChecklistMutationStatus(
  existing: { checklist?: unknown; status?: unknown },
  mergedItems: readonly MobileChecklistItem[],
  derivedStatus: string,
): { conflict: boolean; status: string };

export function applyChecklistItemUpdate<T extends MobileChecklistItem>(
  item: T,
  patch: Partial<MobileChecklistItem>,
  context: { now: string; profileId: string },
): T & { state: ChecklistItemState };

export function applyChecklistItemPatchForStage<T extends MobileChecklistItem>(
  item: T,
  patch: Partial<MobileChecklistItem>,
  context: { now: string; profileId: string },
  stage: "routine" | "assignee",
): T | (T & { state: ChecklistItemState });

export function buildChecklistFocus(
  categories: readonly MobileChecklistCategory[],
  todayKey: string,
): {
  overdue: ChecklistFocusItem[];
  today: ChecklistFocusItem[];
  thisWeek: ChecklistFocusItem[];
};

export function filterChecklistCategories<T extends MobileChecklistCategory>(
  categories: readonly T[],
  filters: {
    query?: string;
    state?: ChecklistItemState | "all";
    owner?: "all" | "mine" | "partner" | "couple" | "unassigned";
    hideCompleted?: boolean;
    profileId?: string | null;
  },
): T[];

export function findChecklistItemTarget<T extends MobileChecklistCategory>(
  categories: readonly T[],
  target: { categoryKey: string; itemId: string },
): { category: T; item: T["items"][number] } | null;

export function getChecklistStateLabel(state?: string): string;

export function getMobileChecklistGuidance(
  category: { tip?: string },
  item: { label: string },
  guidance?: {
    completionCriteria?: string;
    tip?: string;
    caution?: string;
    sourceRefs?: readonly { title: string; url: string; checkedAt: string }[];
  } | null,
): {
  completionCriteria: string;
  tip?: string;
  caution: string;
  sourceRefs?: readonly { title: string; url: string; checkedAt: string }[];
};

export function buildChecklistEmptyFocusPresentation<T>(
  focusTab: "today" | "week" | "overdue",
  reviewSuggestions: readonly T[],
): {
  emptyTitle: string;
  reviewTitle: "먼저 검토할 분야" | null;
  reviewSuggestions: readonly T[];
};

export interface ChecklistReviewEvidence {
  checklistReviewedAt: string;
  checklistReviewedByProfileId: string | null;
  checklistReviewSource: "manual" | "situation_profile";
}

export function buildManualChecklistReviewEvidence(
  existing: {
    checklistReviewedAt?: unknown;
    checklistReviewedByProfileId?: unknown;
    checklistReviewSource?: unknown;
  },
  context: { now: string; profileId: string | null; preserveExisting?: boolean },
): ChecklistReviewEvidence;

export function buildChecklistCategoryReviewPresentation(
  reviewed: boolean,
  notApplicable: boolean,
): {
  showChoices: boolean;
  question: "이 분야가 우리 준비에 필요한가요?";
  applicableLabel: "우리에게 필요한 준비예요";
  notApplicableLabel: "필요 없는 준비예요";
};

export function getChecklistSharingNotice(hasPartner: boolean): string;

export interface ChecklistItemEditBaseline {
  itemId: string;
  state: ChecklistItemState;
  assignee: ChecklistAssignee | null;
  dueDate: string | null;
  note: string;
  completedAt: string | null;
  completedByProfileId: string | null;
}

export function captureChecklistItemEditBaseline(
  item: MobileChecklistItem,
): ChecklistItemEditBaseline;

export function hasChecklistItemEditConflict(
  baseline: ChecklistItemEditBaseline | null,
  freshItem: MobileChecklistItem | null | undefined,
): boolean;

export function hasChecklistItemMutationConflict(options: {
  categoryStatus?: string;
  expectedBaseline: ChecklistItemEditBaseline | null;
  freshItem: MobileChecklistItem | null | undefined;
}): boolean;

export function planChecklistDetailMutations(
  baseline: ChecklistItemEditBaseline,
  draft: {
    state: ChecklistItemState;
    assignee: ChecklistAssignee | null;
    dueDate: string | null;
    note: string;
  },
): {
  routinePatch: Pick<Partial<MobileChecklistItem>, "state" | "dueDate" | "note"> | null;
  assigneePatch: Pick<Partial<MobileChecklistItem>, "assignee"> | null;
};

export type ChecklistItemMutationStatus =
  | "applied"
  | "pending_partner"
  | "conflict"
  | "stale"
  | "active_request"
  | "failed";

export function executeChecklistDetailMutationPlan(
  plan: ReturnType<typeof planChecklistDetailMutations>,
  baseline: ChecklistItemEditBaseline,
  save: (
    patch: Partial<MobileChecklistItem>,
    expectedBaseline: ChecklistItemEditBaseline,
    stage: "routine" | "assignee",
  ) => Promise<
    | { status: "applied" | "pending_partner"; item: MobileChecklistItem }
    | { status: Exclude<ChecklistItemMutationStatus, "applied" | "pending_partner"> }
  >,
): Promise<{
  status: ChecklistItemMutationStatus | "no_changes";
  stage: "routine" | "assignee" | "none";
  routineApplied: boolean;
}>;

export function buildSituationModalFooter(previewVisible: boolean): {
  secondaryAction: "edit" | "dismiss";
  secondaryLabel: "선택 수정" | "나중에";
  primaryLabel: "확인하고 적용" | "제외 항목 미리보기";
};

export interface ChecklistSituationPreviewPlan<TPatch, TProfile> {
  coupleId: string;
  ownerId: string;
  stateRevision: number;
  progressPatch: TPatch;
  profile: TProfile;
  excludedItemIds: string[];
  restoredItemIds: string[];
}

export function createChecklistSituationPreviewPlan<TPatch, TProfile>(input: {
  coupleId: string;
  ownerId: string;
  stateRevision: number;
  application: {
    progressPatch: TPatch;
    profile: TProfile;
    excludedItemIds: readonly string[];
    restoredItemIds: readonly string[];
  };
}): ChecklistSituationPreviewPlan<TPatch, TProfile>;

export function isChecklistSituationApplicationNoop(
  currentProfile: { answers: unknown; autoExcludedItemIds: readonly string[] } | null,
  application: {
    profile: { answers: unknown; autoExcludedItemIds: readonly string[] };
    categoryProgressPatch: Record<string, unknown>;
  },
): boolean;

export function buildChecklistSituationPreviewSubmission<TPatch>(
  previewPlan: Pick<ChecklistSituationPreviewPlan<TPatch, unknown>, "stateRevision" | "progressPatch">,
): {
  expected_revision: number;
  progress_patch: TPatch;
};

export function formatChecklistCompletionAudit(
  item: Pick<MobileChecklistItem, "completedAt" | "completedByProfileId">,
  memberNames: ReadonlyMap<string, string>,
): string | null;

export function normalizeChecklistNote(value: string): string;

export function validateChecklistDueDate(value: string): boolean;

export function createChecklistMutationQueue(): {
  readonly pendingCount: number;
  enqueue<T>(operation: () => Promise<T> | T): Promise<T>;
};
