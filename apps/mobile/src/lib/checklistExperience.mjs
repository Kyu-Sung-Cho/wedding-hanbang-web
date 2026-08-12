const ITEM_STATES = new Set([
  "todo",
  "in_progress",
  "waiting",
  "blocked",
  "completed",
  "not_applicable",
]);

const CATEGORY_SEARCH_ALIASES = {
  meeting: ["상견례"],
  venue: ["웨딩홀", "예식장", "웨딩베뉴"],
  studio: ["스드메", "스튜디오", "웨딩촬영"],
  dress: ["스드메", "웨딩드레스", "예복", "턱시도"],
  makeup: ["스드메", "헤메", "헤어메이크업"],
  ring: ["예물", "웨딩링"],
  honeymoon: ["허니문"],
  invitation: ["청첩장"],
  snap: ["본식스냅", "DVD"],
  gift: ["답례품"],
  mc: ["사회자", "축가"],
  pyebaek: ["폐백"],
};

function localDateOffset(dateKey, days) {
  const date = new Date(`${dateKey}T12:00:00`);
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function buildChecklistCategoryOptions(templates) {
  return [
    ...templates.map((category) => ({
      key: category.key,
      label: category.label,
    })),
    { key: "other", label: "기타" },
  ];
}

export function normalizeChecklistItem(item) {
  const state = ITEM_STATES.has(item?.state)
    ? item.state
    : item?.done === true || item?.completed === true
      ? "completed"
      : "todo";
  const canonicalItem = { ...(item ?? {}) };
  delete canonicalItem.completed;
  return {
    ...canonicalItem,
    label: typeof canonicalItem.label === "string" && canonicalItem.label.trim().length > 0
      ? canonicalItem.label
      : canonicalItem.id,
    done: state === "completed",
    state,
  };
}

export function readChecklistItemsSnapshot(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new TypeError("invalid checklist snapshot");

  const ids = new Set();
  return value.map((item) => {
    if (
      item === null
      || typeof item !== "object"
      || Array.isArray(item)
      || typeof item.id !== "string"
      || item.id.length === 0
      || ids.has(item.id)
      || (
        (typeof item.label !== "string" || item.label.trim().length === 0)
        && !(typeof item.completed === "boolean" && !Object.hasOwn(item, "done"))
      )
      || (
        typeof item.done !== "boolean"
        && typeof item.completed !== "boolean"
      )
      || (Object.hasOwn(item, "state") && !ITEM_STATES.has(item.state))
      || (
        Object.hasOwn(item, "state")
        && typeof item.done === "boolean"
        && item.done !== (item.state === "completed")
      )
      || (
        Object.hasOwn(item, "dueDate")
        && item.dueDate !== null
        && (typeof item.dueDate !== "string" || !validateChecklistDueDate(item.dueDate))
      )
      || (Object.hasOwn(item, "note") && typeof item.note !== "string")
    ) throw new TypeError("invalid checklist snapshot");
    ids.add(item.id);
    return normalizeChecklistItem(item);
  });
}

export function resolveProtectedChecklistMutationStatus(
  existing,
  mergedItems,
  derivedStatus,
) {
  const rawChecklist = existing?.checklist;
  const currentStatus = typeof existing?.status === "string"
    ? existing.status
    : undefined;
  const requiresMaterialization = rawChecklist === undefined
    || !Array.isArray(rawChecklist)
    || rawChecklist.length !== mergedItems.length
    || rawChecklist.some((item, index) => (
      item === null
      || typeof item !== "object"
      || Array.isArray(item)
      || Object.hasOwn(item, "completed")
      || item.id !== mergedItems[index]?.id
    ));

  return {
    conflict: !requiresMaterialization
      && currentStatus !== undefined
      && currentStatus !== derivedStatus,
    status: requiresMaterialization
      ? derivedStatus
      : currentStatus ?? derivedStatus,
  };
}

export function applyChecklistItemUpdate(item, patch, context) {
  const current = normalizeChecklistItem(item);
  const next = normalizeChecklistItem({ ...current, ...patch });
  if (next.state === "completed") {
    if (current.state === "completed") {
      const preserved = { ...next, done: true };
      if (Object.hasOwn(current, "completedAt")) preserved.completedAt = current.completedAt;
      else delete preserved.completedAt;
      if (Object.hasOwn(current, "completedByProfileId")) {
        preserved.completedByProfileId = current.completedByProfileId;
      } else {
        delete preserved.completedByProfileId;
      }
      return preserved;
    }
    return {
      ...next,
      done: true,
      completedAt: context.now,
      completedByProfileId: context.profileId,
    };
  }
  return {
    ...next,
    done: false,
    completedAt: null,
    completedByProfileId: null,
  };
}

export function applyChecklistItemPatchForStage(item, patch, context, stage) {
  if (stage === "assignee") {
    const updated = { ...item };
    const assignee = copyChecklistAssignee(patch.assignee);
    updated.assignee = assignee ?? null;
    return updated;
  }
  const routinePatch = { ...patch };
  delete routinePatch.assignee;
  return applyChecklistItemUpdate(item, routinePatch, context);
}

export function buildChecklistFocus(categories, todayKey) {
  const endOfWeek = localDateOffset(todayKey, 6);
  const overdue = [];
  const today = [];
  const thisWeek = [];

  for (const category of categories) {
    if (category.status === "not_applicable") continue;
    for (const rawItem of category.items ?? []) {
      const item = normalizeChecklistItem(rawItem);
      if (
        item.state === "completed"
        || item.state === "not_applicable"
        || typeof item.dueDate !== "string"
      ) continue;
      const action = {
        categoryKey: category.key,
        categoryLabel: category.label,
        itemId: item.id,
        itemLabel: item.label,
        state: item.state,
        dueDate: item.dueDate,
        assignee: item.assignee,
      };
      if (item.dueDate < todayKey) overdue.push(action);
      else if (item.dueDate === todayKey) today.push(action);
      else if (item.dueDate <= endOfWeek) thisWeek.push(action);
    }
  }

  const byDueDate = (a, b) => a.dueDate.localeCompare(b.dueDate)
    || a.categoryLabel.localeCompare(b.categoryLabel)
    || a.itemLabel.localeCompare(b.itemLabel);
  return {
    overdue: overdue.sort(byDueDate),
    today: today.sort(byDueDate),
    thisWeek: thisWeek.sort(byDueDate),
  };
}

function matchesOwner(item, owner, profileId) {
  if (owner === "all") return true;
  if (owner === "unassigned") return item.assignee === undefined || item.assignee === null;
  if (owner === "couple") return item.assignee?.kind === "couple";
  if (owner === "mine") {
    return item.assignee?.kind === "member" && item.assignee.profileId === profileId;
  }
  if (owner === "partner") {
    return Boolean(profileId)
      && item.assignee?.kind === "member"
      && item.assignee.profileId !== profileId;
  }
  return true;
}

export function filterChecklistCategories(categories, filters) {
  const query = String(filters?.query ?? "").trim().toLocaleLowerCase("ko-KR");
  const stateFilter = filters?.state ?? "all";
  const ownerFilter = filters?.owner ?? "all";
  return categories.flatMap((category) => {
    const aliases = CATEGORY_SEARCH_ALIASES[category.key] ?? [];
    const categorySearchText = [category.label, ...aliases]
      .join(" ")
      .toLocaleLowerCase("ko-KR");
    const categoryMatches = query.length === 0 || categorySearchText.includes(query);
    const categoryMatchesNotApplicable = stateFilter === "not_applicable"
      && category.status === "not_applicable";
    const items = (category.items ?? []).filter((rawItem) => {
      const item = normalizeChecklistItem(rawItem);
      if (filters?.hideCompleted && item.state === "completed") return false;
      if (
        stateFilter !== "all"
        && !categoryMatchesNotApplicable
        && item.state !== stateFilter
      ) return false;
      if (!matchesOwner(item, ownerFilter, filters?.profileId ?? null)) return false;
      return categoryMatches
        || item.label.toLocaleLowerCase("ko-KR").includes(query)
        || String(item.note ?? "").toLocaleLowerCase("ko-KR").includes(query);
    });
    return items.length > 0 ? [{ ...category, items }] : [];
  });
}

export function findChecklistItemTarget(categories, target) {
  if (!target || typeof target.categoryKey !== "string" || typeof target.itemId !== "string") {
    return null;
  }
  const category = categories.find((candidate) => candidate.key === target.categoryKey);
  if (!category) return null;
  const item = (category.items ?? []).find((candidate) => candidate.id === target.itemId);
  return item ? { category, item } : null;
}

export function getChecklistStateLabel(state) {
  return {
    todo: "할 일",
    in_progress: "진행 중",
    waiting: "회신 대기",
    blocked: "막힘",
    completed: "완료",
    not_applicable: "해당 없음",
  }[state] ?? "할 일";
}

export function getMobileChecklistGuidance(category, item, guidance) {
  return {
    completionCriteria: guidance?.completionCriteria
      ?? `‘${item.label}’에 필요한 확인이나 합의를 마치고, 계약·결제가 있다면 관련 문서를 보관했을 때 완료로 표시하세요.`,
    tip: guidance?.tip ?? category.tip,
    caution: guidance?.caution
      ?? "구두 안내만으로 확정하지 말고, 비용·일정·취소 조건은 업체나 공식기관의 최신 문서에서 다시 확인하세요.",
    ...(Array.isArray(guidance?.sourceRefs) ? { sourceRefs: guidance.sourceRefs } : {}),
  };
}

export function buildChecklistEmptyFocusPresentation(focusTab, reviewSuggestions) {
  const suggestions = Array.isArray(reviewSuggestions) ? reviewSuggestions : [];
  return {
    emptyTitle: focusTab === "overdue"
      ? "저장된 기한 기준, 늦은 일이 없어요"
      : "이 구간에 저장된 할 일이 없어요",
    reviewTitle: suggestions.length > 0 ? "먼저 검토할 분야" : null,
    reviewSuggestions: suggestions,
  };
}

export function buildManualChecklistReviewEvidence(existing, context) {
  if (
    typeof existing?.checklistReviewedAt === "string"
    && (
      typeof existing?.checklistReviewedByProfileId === "string"
      || existing?.checklistReviewedByProfileId === null
    )
    && (
      existing?.checklistReviewSource === "manual"
      || existing?.checklistReviewSource === "situation_profile"
    )
  ) {
    return {
      checklistReviewedAt: existing.checklistReviewedAt,
      checklistReviewedByProfileId: existing.checklistReviewedByProfileId,
      checklistReviewSource: existing.checklistReviewSource,
    };
  }
  return {
    checklistReviewedAt: context.now,
    checklistReviewedByProfileId: context.profileId ?? null,
    checklistReviewSource: "manual",
  };
}

export function buildChecklistCategoryReviewPresentation(reviewed, notApplicable) {
  return {
    showChoices: !reviewed && !notApplicable,
    question: "이 분야가 우리 준비에 필요한가요?",
    applicableLabel: "우리에게 필요한 준비예요",
    notApplicableLabel: "필요 없는 준비예요",
  };
}

export function getChecklistSharingNotice(hasPartner) {
  return hasPartner
    ? "항목 기한과 메모는 파트너와 공유돼요."
    : "항목 기한과 메모는 파트너를 연결하면 함께 공유돼요.";
}

function copyChecklistAssignee(assignee) {
  if (assignee?.kind === "member" && typeof assignee.profileId === "string") {
    return { kind: "member", profileId: assignee.profileId };
  }
  if (assignee?.kind === "couple") return { kind: "couple" };
  if (assignee?.kind === "external" && typeof assignee.label === "string") {
    return { kind: "external", label: assignee.label };
  }
  return null;
}

function checklistAssigneeKey(assignee) {
  if (!assignee) return "unassigned";
  if (assignee.kind === "member") return `member:${assignee.profileId}`;
  if (assignee.kind === "external") return `external:${assignee.label}`;
  return "couple";
}

export function captureChecklistItemEditBaseline(item) {
  const normalized = normalizeChecklistItem(item);
  return {
    itemId: normalized.id,
    state: normalized.state,
    assignee: copyChecklistAssignee(normalized.assignee),
    dueDate: typeof normalized.dueDate === "string" ? normalized.dueDate : null,
    note: typeof normalized.note === "string" ? normalized.note : "",
    completedAt: typeof normalized.completedAt === "string" ? normalized.completedAt : null,
    completedByProfileId: typeof normalized.completedByProfileId === "string"
      ? normalized.completedByProfileId
      : null,
  };
}

export function hasChecklistItemEditConflict(baseline, freshItem) {
  if (!baseline || !freshItem || freshItem.id !== baseline.itemId) return true;
  const fresh = captureChecklistItemEditBaseline(freshItem);
  return fresh.state !== baseline.state
    || checklistAssigneeKey(fresh.assignee) !== checklistAssigneeKey(baseline.assignee)
    || fresh.dueDate !== baseline.dueDate
    || fresh.note !== baseline.note
    || fresh.completedAt !== baseline.completedAt
    || fresh.completedByProfileId !== baseline.completedByProfileId;
}

export function hasChecklistItemMutationConflict({
  categoryStatus,
  expectedBaseline,
  freshItem,
}) {
  return categoryStatus === "not_applicable"
    || (expectedBaseline
      ? hasChecklistItemEditConflict(expectedBaseline, freshItem)
      : false);
}

export function planChecklistDetailMutations(baseline, draft) {
  const routinePatch = {};
  if (draft.state !== baseline.state) routinePatch.state = draft.state;
  if (draft.dueDate !== baseline.dueDate) routinePatch.dueDate = draft.dueDate;
  if (draft.note !== baseline.note) routinePatch.note = draft.note;

  const draftAssignee = copyChecklistAssignee(draft.assignee);
  const assigneePatch = checklistAssigneeKey(draftAssignee)
    === checklistAssigneeKey(baseline.assignee)
    ? null
    : { assignee: draftAssignee ?? null };

  return {
    routinePatch: Object.keys(routinePatch).length > 0 ? routinePatch : null,
    assigneePatch,
  };
}

export async function executeChecklistDetailMutationPlan(plan, baseline, save) {
  let expectedBaseline = baseline;
  let routineApplied = false;

  if (plan.routinePatch) {
    const routineResult = await save(plan.routinePatch, expectedBaseline, "routine");
    if (routineResult.status !== "applied") {
      return { status: routineResult.status, stage: "routine", routineApplied: false };
    }
    expectedBaseline = captureChecklistItemEditBaseline(routineResult.item);
    routineApplied = true;
  }

  if (plan.assigneePatch) {
    const assigneeResult = await save(plan.assigneePatch, expectedBaseline, "assignee");
    return {
      status: assigneeResult.status,
      stage: "assignee",
      routineApplied,
    };
  }

  return {
    status: routineApplied ? "applied" : "no_changes",
    stage: routineApplied ? "routine" : "none",
    routineApplied,
  };
}

export function buildSituationModalFooter(previewVisible) {
  return previewVisible
    ? {
        secondaryAction: "edit",
        secondaryLabel: "선택 수정",
        primaryLabel: "확인하고 적용",
      }
    : {
        secondaryAction: "dismiss",
        secondaryLabel: "나중에",
        primaryLabel: "제외 항목 미리보기",
      };
}

export function createChecklistSituationPreviewPlan({
  coupleId,
  ownerId,
  stateRevision,
  application,
}) {
  if (
    typeof coupleId !== "string"
    || coupleId.length === 0
    || typeof ownerId !== "string"
    || ownerId.length === 0
    || !Number.isInteger(stateRevision)
    || stateRevision < 0
    || application === null
    || typeof application !== "object"
    || application.progressPatch === null
    || typeof application.progressPatch !== "object"
    || Array.isArray(application.progressPatch)
    || !Array.isArray(application.excludedItemIds)
    || !Array.isArray(application.restoredItemIds)
  ) {
    throw new TypeError("invalid checklist situation preview");
  }
  return {
    coupleId,
    ownerId,
    stateRevision,
    progressPatch: application.progressPatch,
    profile: application.profile,
    excludedItemIds: [...application.excludedItemIds],
    restoredItemIds: [...application.restoredItemIds],
  };
}

export function isChecklistSituationApplicationNoop(currentProfile, application) {
  if (
    currentProfile === null
    || typeof currentProfile !== "object"
    || application === null
    || typeof application !== "object"
    || application.profile === null
    || typeof application.profile !== "object"
    || application.categoryProgressPatch === null
    || typeof application.categoryProgressPatch !== "object"
    || Array.isArray(application.categoryProgressPatch)
    || !Array.isArray(currentProfile.autoExcludedItemIds)
    || !Array.isArray(application.profile.autoExcludedItemIds)
  ) return false;

  return JSON.stringify(currentProfile.answers) === JSON.stringify(application.profile.answers)
    && [...currentProfile.autoExcludedItemIds].sort().join("\n")
      === [...application.profile.autoExcludedItemIds].sort().join("\n")
    && Object.keys(application.categoryProgressPatch).length === 0;
}

export function buildChecklistSituationPreviewSubmission(previewPlan) {
  return {
    expected_revision: previewPlan.stateRevision,
    progress_patch: previewPlan.progressPatch,
  };
}

export function formatChecklistCompletionAudit(item, memberNames) {
  if (
    typeof item?.completedAt !== "string"
    || typeof item?.completedByProfileId !== "string"
  ) return null;
  const name = memberNames?.get(item.completedByProfileId);
  const timestamp = Date.parse(item.completedAt);
  if (!name || !Number.isFinite(timestamp)) return null;
  const koreanDay = new Date(timestamp + (9 * 60 * 60 * 1000));
  const month = koreanDay.getUTCMonth() + 1;
  const day = koreanDay.getUTCDate();
  return `${name}님이 ${month}월 ${day}일 완료`;
}

export function normalizeChecklistNote(value) {
  return String(value ?? "")
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function validateChecklistDueDate(value) {
  if (value === "") return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-")) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

export function createChecklistMutationQueue() {
  let tail = Promise.resolve();
  let count = 0;
  return {
    get pendingCount() {
      return count;
    },
    enqueue(operation) {
      count += 1;
      const result = tail.then(operation, operation);
      tail = result.then(
        () => { count -= 1; },
        () => { count -= 1; },
      );
      return result;
    },
  };
}
