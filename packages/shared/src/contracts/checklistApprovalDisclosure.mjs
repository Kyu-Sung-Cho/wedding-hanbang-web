const PROFILE_KEY = "__checklist_profile";
const MAX_PROPOSAL_BYTES = 131_072;
const KEY_PATTERN = /^[a-zA-Z0-9_.:-]{1,120}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RFC3339_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const ITEM_STATES = new Set([
  "todo",
  "in_progress",
  "waiting",
  "blocked",
  "completed",
  "not_applicable",
]);
const CATEGORY_STATUSES = new Set([
  "not_started",
  "in_progress",
  "completed",
  "not_applicable",
]);
const ITEM_FIELDS = new Set([
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
const CATEGORY_FIELDS = new Set([
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
  "assigned_to",
  "responsibility",
  "dueDate",
  "due_date",
]);
const NON_SITUATION_CATEGORY_FIELDS = [
  "category",
  "label",
  "budget",
  "spent",
  "vendor",
  "notes",
  "payer",
  "assigned_to",
  "responsibility",
  "dueDate",
  "due_date",
];
const NON_SITUATION_ITEM_FIELDS = [
  "assignee",
  "dueDate",
  "note",
  "completedAt",
  "completedByProfileId",
];
const QUESTION_META = [
  ["ceremony", "예식", { yes: "진행", no: "진행 안 함", undecided: "미정" }],
  ["legalMarriage", "법률혼(혼인신고)", { yes: "진행", no: "진행 안 함", undecided: "미정" }],
  ["travel", "신혼여행", { domestic: "국내", international: "해외", none: "안 감", undecided: "미정" }],
  ["housing", "신혼집", { rent: "임차", buy: "매수", other: "기타·이미 마련", undecided: "미정" }],
  ["internationalMarriage", "국제혼인", { true: "해당", false: "해당 없음", null: "미정" }],
  ["religiousCeremony", "종교식", { true: "진행", false: "진행 안 함", null: "미정" }],
  ["remarriage", "재혼", { true: "해당", false: "해당 없음", null: "미정" }],
  ["childrenParticipating", "자녀 동반", { true: "참여", false: "참여 안 함", null: "미정" }],
  ["accessibilitySupport", "접근성 지원", { true: "필요", false: "필요 없음", null: "미정" }],
  ["healthSupport", "건강·임신 지원", { true: "필요", false: "필요 없음", null: "미정" }],
  ["petParticipation", "반려동물 참여", { true: "참여", false: "참여 안 함", null: "미정" }],
  ["familyTradition", "전통 의례", { true: "진행", false: "진행 안 함", null: "미정" }],
];
const QUESTION_KEYS = new Set(QUESTION_META.map(([key]) => key));
const DEFAULT_ANSWERS = Object.freeze({
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

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isSafeText(value, maximumCharacters) {
  return typeof value === "string"
    && Array.from(value).length >= 1
    && Array.from(value).length <= maximumCharacters
    && value.trim() === value
    && !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value);
}

function isTimestamp(value) {
  return typeof value === "string"
    && RFC3339_PATTERN.test(value)
    && Number.isFinite(Date.parse(value));
}

function utf8Length(value) {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint <= 0x7f) bytes += 1;
    else if (codePoint <= 0x7ff) bytes += 2;
    else if (codePoint <= 0xffff) bytes += 3;
    else bytes += 4;
  }
  return bytes;
}

function jsonEqual(left, right) {
  if (left === right) return true;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

function itemState(value) {
  if (!isRecord(value)) return null;
  if (typeof value.state === "string" && ITEM_STATES.has(value.state)) {
    return value.state;
  }
  if (typeof value.done !== "boolean") return null;
  return value.done ? "completed" : "todo";
}

function validateAssignee(value) {
  if (value === null) return true;
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  if (value.kind === "couple") return Object.keys(value).length === 1;
  if (value.kind === "member") {
    return Object.keys(value).length === 2
      && typeof value.profileId === "string"
      && UUID_PATTERN.test(value.profileId);
  }
  if (value.kind === "external") {
    return Object.keys(value).length === 2 && isSafeText(value.label, 80);
  }
  return false;
}

function validateItem(value) {
  if (
    !isRecord(value)
    || Object.keys(value).some((key) => !ITEM_FIELDS.has(key))
    || typeof value.id !== "string"
    || !KEY_PATTERN.test(value.id)
    || !isSafeText(value.label, 400)
    || typeof value.done !== "boolean"
  ) return false;
  const state = itemState(value);
  if (!state || value.done !== (state === "completed")) return false;
  if (hasOwn(value, "assignee") && !validateAssignee(value.assignee)) return false;
  if (hasOwn(value, "dueDate") && !(
    value.dueDate === null
    || (typeof value.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.dueDate))
  )) return false;
  if (hasOwn(value, "note") && !(
    typeof value.note === "string"
    && Array.from(value.note).length <= 1_000
    && !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value.note)
  )) return false;
  if (hasOwn(value, "completedAt") && !(
    value.completedAt === null || isTimestamp(value.completedAt)
  )) return false;
  if (hasOwn(value, "completedByProfileId") && !(
    value.completedByProfileId === null
    || (typeof value.completedByProfileId === "string" && UUID_PATTERN.test(value.completedByProfileId))
  )) return false;
  if ((value.completedAt == null) !== (value.completedByProfileId == null)) return false;
  if ((value.completedAt != null || value.completedByProfileId != null) && state !== "completed") {
    return false;
  }
  return true;
}

function validateCategory(value, categoryKey, currentRaw) {
  if (
    !isRecord(value)
    || (hasOwn(value, "category") && value.category !== categoryKey)
    || typeof value.status !== "string"
    || !CATEGORY_STATUSES.has(value.status)
    || !Array.isArray(value.checklist)
    || value.checklist.length > 500
  ) return false;
  const proposedLegacyFields = Object.keys(value).filter((key) => !CATEGORY_FIELDS.has(key));
  const currentLegacyFields = isRecord(currentRaw)
    ? Object.keys(currentRaw).filter((key) => !CATEGORY_FIELDS.has(key))
    : [];
  if (
    proposedLegacyFields.some((key) => !hasOwn(currentRaw, key) || !jsonEqual(value[key], currentRaw[key]))
    || currentLegacyFields.some((key) => !hasOwn(value, key) || !jsonEqual(value[key], currentRaw[key]))
  ) return false;
  if (hasOwn(value, "label") && !isSafeText(value.label, 200)) return false;
  if (hasOwn(value, "checklistReviewedAt") && !isTimestamp(value.checklistReviewedAt)) return false;
  if (hasOwn(value, "checklistReviewedByProfileId") && !(
    value.checklistReviewedByProfileId === null
    || (typeof value.checklistReviewedByProfileId === "string" && UUID_PATTERN.test(value.checklistReviewedByProfileId))
  )) return false;
  if (hasOwn(value, "checklistReviewSource") && !(
    value.checklistReviewSource === "manual"
    || value.checklistReviewSource === "situation_profile"
  )) return false;
  if (["checklistReviewedAt", "checklistReviewedByProfileId", "checklistReviewSource"]
    .some((key) => hasOwn(value, key))) {
    if (
      !hasOwn(value, "checklistReviewedAt")
      || !hasOwn(value, "checklistReviewSource")
    ) return false;
  }
  const ids = new Set();
  for (const item of value.checklist) {
    if (!validateItem(item) || ids.has(item.id)) return false;
    ids.add(item.id);
  }
  return true;
}

function validateAnswers(value) {
  if (
    !isRecord(value)
    || Object.keys(value).length !== QUESTION_KEYS.size
    || Object.keys(value).some((key) => !QUESTION_KEYS.has(key))
  ) return false;
  const triState = new Set(["yes", "no", "undecided"]);
  const travel = new Set(["domestic", "international", "none", "undecided"]);
  const housing = new Set(["rent", "buy", "other", "undecided"]);
  return triState.has(value.ceremony)
    && triState.has(value.legalMarriage)
    && travel.has(value.travel)
    && housing.has(value.housing)
    && [
      "internationalMarriage",
      "religiousCeremony",
      "remarriage",
      "childrenParticipating",
      "accessibilitySupport",
      "healthSupport",
      "petParticipation",
      "familyTradition",
    ].every((key) => value[key] === null || typeof value[key] === "boolean");
}

function readProfile(value, knownItemIds) {
  if (
    !isRecord(value)
    || Object.keys(value).length !== 4
    || !["version", "reviewedAt", "answers", "autoExcludedItemIds"]
      .every((key) => hasOwn(value, key))
    || value.version !== 1
    || !isTimestamp(value.reviewedAt)
    || !validateAnswers(value.answers)
    || !Array.isArray(value.autoExcludedItemIds)
    || value.autoExcludedItemIds.length > knownItemIds.size
  ) return null;
  const ids = new Set();
  for (const itemId of value.autoExcludedItemIds) {
    if (typeof itemId !== "string" || !knownItemIds.has(itemId) || ids.has(itemId)) {
      return null;
    }
    ids.add(itemId);
  }
  return {
    answers: value.answers,
    autoExcludedItemIds: ids,
  };
}

function readCurrentProfile(
  value,
  itemById,
  categoryByKey,
  currentProgress,
) {
  if (
    !isRecord(value)
    || Object.keys(value).length !== 4
    || !["version", "reviewedAt", "answers", "autoExcludedItemIds"]
      .every((key) => hasOwn(value, key))
    || value.version !== 1
    || !isTimestamp(value.reviewedAt)
    || !validateAnswers(value.answers)
    || !Array.isArray(value.autoExcludedItemIds)
    || value.autoExcludedItemIds.length > 500
  ) return null;
  const rawIds = new Set();
  for (const itemId of value.autoExcludedItemIds) {
    if (
      typeof itemId !== "string"
      || !/^[a-z0-9][a-z0-9_-]{0,119}$/.test(itemId)
      || rawIds.has(itemId)
    ) return null;
    rawIds.add(itemId);
  }

  const effectiveIds = new Set();
  for (const itemId of rawIds) {
    const descriptor = itemById.get(itemId);
    if (!descriptor) continue;
    const template = categoryByKey.get(descriptor.categoryKey);
    const currentCategory = readCurrentCategory(
      currentProgress[descriptor.categoryKey],
      template,
    );
    if (
      currentCategory
      && itemState(currentCategory.items.get(itemId)) === "not_applicable"
    ) effectiveIds.add(itemId);
  }
  return {
    answers: value.answers,
    autoExcludedItemIds: effectiveIds,
  };
}

function readTemplates(templates) {
  if (!Array.isArray(templates) || templates.length < 1 || templates.length > 100) {
    return null;
  }
  const categoryByKey = new Map();
  const itemById = new Map();
  for (const category of templates) {
    if (
      !isRecord(category)
      || typeof category.key !== "string"
      || !KEY_PATTERN.test(category.key)
      || !isSafeText(category.label, 200)
      || !Array.isArray(category.items)
      || categoryByKey.has(category.key)
    ) return null;
    const categoryItems = new Map();
    for (const item of category.items) {
      if (
        !isRecord(item)
        || typeof item.id !== "string"
        || !KEY_PATTERN.test(item.id)
        || !isSafeText(item.label, 400)
        || categoryItems.has(item.id)
        || itemById.has(item.id)
      ) return null;
      const normalized = { id: item.id, label: item.label, done: false, state: "todo" };
      categoryItems.set(item.id, normalized);
      itemById.set(item.id, { ...normalized, categoryKey: category.key, categoryLabel: category.label });
    }
    categoryByKey.set(category.key, {
      key: category.key,
      label: category.label,
      items: categoryItems,
    });
  }
  return { categoryByKey, itemById };
}

function readCurrentCategory(value, template) {
  if (value === undefined) {
    return {
      raw: {},
      status: "not_started",
      items: new Map(template.items),
    };
  }
  if (!isRecord(value)) return null;
  const items = new Map(template.items);
  if (hasOwn(value, "checklist")) {
    if (!Array.isArray(value.checklist) || value.checklist.length > 500) return null;
    const seen = new Set();
    for (const rawItem of value.checklist) {
      if (!isRecord(rawItem) || typeof rawItem.id !== "string" || seen.has(rawItem.id)) return null;
      seen.add(rawItem.id);
      const state = typeof rawItem.state === "string" && ITEM_STATES.has(rawItem.state)
        ? rawItem.state
        : rawItem.done === true || rawItem.completed === true
          ? "completed"
          : rawItem.done === false || rawItem.completed === false
            ? "todo"
            : null;
      if (!state || !isSafeText(rawItem.label ?? template.items.get(rawItem.id)?.label, 400)) {
        return null;
      }
      items.set(rawItem.id, {
        ...rawItem,
        id: rawItem.id,
        label: rawItem.label ?? template.items.get(rawItem.id)?.label,
        done: state === "completed",
        state,
      });
    }
  }
  const status = typeof value.status === "string" && CATEGORY_STATUSES.has(value.status)
    ? value.status
    : "not_started";
  return { raw: value, status, items };
}

function invalid(reason) {
  return { status: "unsafe", reason };
}

function answerLabel(meta, value) {
  const lookupKey = value === null ? "null" : String(value);
  return meta[lookupKey] ?? "알 수 없음";
}

/**
 * Builds a complete, user-readable disclosure from the immutable request
 * proposal and the currently loaded journey. Unknown shapes fail closed.
 */
export function buildChecklistApprovalDisclosure(input) {
  if (!isRecord(input)) return invalid("invalid_input");
  const { currentProgress, currentRevision, proposal, templates } = input;
  if (!isRecord(currentProgress) || !Number.isSafeInteger(currentRevision) || currentRevision < 0) {
    return invalid("invalid_current_state");
  }
  if (
    !isRecord(proposal)
    || Object.keys(proposal).length !== 3
    || proposal.kind !== "checklist_situation"
    || !Number.isSafeInteger(proposal.baseRevision)
    || proposal.baseRevision < 0
    || !isRecord(proposal.progressPatch)
  ) return invalid("invalid_proposal");
  if (proposal.baseRevision !== currentRevision) return invalid("revision_mismatch");

  let serialized;
  try {
    serialized = JSON.stringify(proposal.progressPatch);
  } catch {
    return invalid("invalid_proposal");
  }
  if (utf8Length(serialized) > MAX_PROPOSAL_BYTES) return invalid("proposal_too_large");

  const templateIndex = readTemplates(templates);
  if (!templateIndex) return invalid("invalid_templates");
  const { categoryByKey, itemById } = templateIndex;
  const patchKeys = Object.keys(proposal.progressPatch);
  if (
    patchKeys.length < 1
    || patchKeys.length > 300
    || !hasOwn(proposal.progressPatch, PROFILE_KEY)
    || patchKeys.some((key) => key !== PROFILE_KEY && !categoryByKey.has(key))
  ) return invalid("unknown_progress_key");

  const nextProfile = readProfile(proposal.progressPatch[PROFILE_KEY], new Set(itemById.keys()));
  if (!nextProfile) return invalid("invalid_profile");
  const currentProfileValue = currentProgress[PROFILE_KEY];
  const profileChanged = !jsonEqual(
    currentProfileValue,
    proposal.progressPatch[PROFILE_KEY],
  );
  const currentProfile = currentProfileValue === undefined
    ? { answers: DEFAULT_ANSWERS, autoExcludedItemIds: new Set() }
    : readCurrentProfile(
        currentProfileValue,
        itemById,
        categoryByKey,
        currentProgress,
      )
      // The database approval boundary treats an invalid legacy profile as the
      // pre-profile default. Mirror that rule so a repair proposal cannot be
      // created successfully and then become impossible to review.
      ?? { answers: DEFAULT_ANSWERS, autoExcludedItemIds: new Set() };

  const questionChanges = [];
  for (const [key, label, labels] of QUESTION_META) {
    const before = currentProfile.answers[key];
    const after = nextProfile.answers[key];
    if (before !== after) {
      questionChanges.push({
        key,
        label,
        before: answerLabel(labels, before),
        after: answerLabel(labels, after),
      });
    }
  }

  const excludedItems = [];
  const restoredItems = [];
  const structuralChanges = [];
  const categories = [];
  const effectiveItems = new Map();

  for (const template of categoryByKey.values()) {
    const currentCategory = readCurrentCategory(currentProgress[template.key], template);
    if (!currentCategory) return invalid("invalid_current_category");
    const proposedRaw = proposal.progressPatch[template.key];
    if (proposedRaw === undefined) {
      for (const item of currentCategory.items.values()) effectiveItems.set(item.id, item);
      continue;
    }
    if (!validateCategory(proposedRaw, template.key, currentCategory.raw)) {
      return invalid("invalid_proposed_category");
    }

    for (const field of NON_SITUATION_CATEGORY_FIELDS) {
      if (!jsonEqual(proposedRaw[field], currentCategory.raw[field])) {
        return invalid("hidden_category_delta");
      }
    }

    const proposedById = new Map(proposedRaw.checklist.map((item) => [item.id, item]));
    const expectedIds = new Set(currentCategory.items.keys());
    for (const itemId of template.items.keys()) expectedIds.add(itemId);
    if (
      proposedById.size !== expectedIds.size
      || [...expectedIds].some((itemId) => !proposedById.has(itemId))
    ) return invalid("hidden_structure_delta");

    const categoryExcluded = [];
    const categoryRestored = [];
    let addedCount = 0;
    let renamedCount = 0;
    for (const [itemId, proposedItem] of proposedById) {
      const currentItem = currentCategory.items.get(itemId);
      if (!currentItem) return invalid("hidden_structure_delta");
      const templateItem = template.items.get(itemId);
      if (templateItem) {
        if (proposedItem.label !== templateItem.label) return invalid("invalid_item_label");
        if (!hasOwn(currentCategory.raw, "checklist")
          || !currentCategory.raw.checklist.some((item) => isRecord(item) && item.id === itemId)) {
          addedCount += 1;
        } else if (currentItem.label !== proposedItem.label) {
          renamedCount += 1;
        }
      } else if (proposedItem.label !== currentItem.label) {
        return invalid("hidden_custom_item_delta");
      }
      for (const field of NON_SITUATION_ITEM_FIELDS.filter(
        (field) => field !== "completedAt" && field !== "completedByProfileId",
      )) {
        if (!jsonEqual(proposedItem[field], currentItem[field])) {
          return invalid("hidden_item_delta");
        }
      }
      const beforeState = itemState(currentItem);
      const afterState = itemState(proposedItem);
      if (!beforeState || !afterState) return invalid("invalid_item_state");
      const completionAuditChanged = !jsonEqual(
        [currentItem.completedAt, currentItem.completedByProfileId],
        [proposedItem.completedAt, proposedItem.completedByProfileId],
      );
      const completionEvidenceCleared = completionAuditChanged
        && beforeState === "completed"
        && afterState === "not_applicable"
        && proposedItem.completedAt == null
        && proposedItem.completedByProfileId == null;
      if (completionAuditChanged && !completionEvidenceCleared) {
        return invalid("hidden_item_delta");
      }
      if (beforeState !== afterState) {
        const item = {
          categoryKey: template.key,
          categoryLabel: template.label,
          itemId,
          label: proposedItem.label,
          completionEvidenceCleared,
        };
        if (
          afterState === "not_applicable"
          && nextProfile.autoExcludedItemIds.has(itemId)
        ) {
          excludedItems.push(item);
          categoryExcluded.push(item);
        } else if (
          beforeState === "not_applicable"
          && currentProfile.autoExcludedItemIds.has(itemId)
          && !nextProfile.autoExcludedItemIds.has(itemId)
          && afterState === "todo"
        ) {
          restoredItems.push(item);
          categoryRestored.push(item);
        } else {
          return invalid("undisclosed_item_state_delta");
        }
      }
      effectiveItems.set(itemId, proposedItem);
    }

    const currentHasReviewEvidence = [
      "checklistReviewedAt",
      "checklistReviewedByProfileId",
      "checklistReviewSource",
    ].some((key) => hasOwn(currentCategory.raw, key));
    const proposedHasReviewEvidence = [
      "checklistReviewedAt",
      "checklistReviewedByProfileId",
      "checklistReviewSource",
    ].some((key) => hasOwn(proposedRaw, key));
    const reviewChanged = !jsonEqual(
      [
        currentCategory.raw.checklistReviewedAt,
        currentCategory.raw.checklistReviewedByProfileId,
        currentCategory.raw.checklistReviewSource,
      ],
      [
        proposedRaw.checklistReviewedAt,
        proposedRaw.checklistReviewedByProfileId,
        proposedRaw.checklistReviewSource,
      ],
    );
    let reviewChangeKind = "unchanged";
    if (reviewChanged) {
      if (currentHasReviewEvidence) {
        if (
          !profileChanged
          ||
          currentCategory.raw.checklistReviewSource !== "situation_profile"
          || proposedHasReviewEvidence
        ) return invalid("hidden_review_delta");
        reviewChangeKind = "cleared";
      } else {
        // `validateCategory` already proves a complete, valid evidence tuple.
        // With no prior evidence, this is the one transition the SQL boundary
        // classifies as an explicit review addition.
        reviewChangeKind = "added";
      }
    }
    const applicabilityChanged = currentCategory.status !== proposedRaw.status
      && (currentCategory.status === "not_applicable" || proposedRaw.status === "not_applicable");
    if (addedCount > 0 || renamedCount > 0) {
      structuralChanges.push({
        categoryKey: template.key,
        categoryLabel: template.label,
        addedCount,
        renamedCount,
      });
    }
    categories.push({
      categoryKey: template.key,
      categoryLabel: template.label,
      beforeStatus: currentCategory.status,
      afterStatus: proposedRaw.status,
      statusChanged: currentCategory.status !== proposedRaw.status,
      excludedCount: categoryExcluded.length,
      restoredCount: categoryRestored.length,
      beforeApplicable: currentCategory.status !== "not_applicable",
      afterApplicable: proposedRaw.status !== "not_applicable",
      applicabilityChanged,
      reviewChanged,
      reviewChangeKind,
      addedCount,
      renamedCount,
    });
  }

  for (const itemId of nextProfile.autoExcludedItemIds) {
    const effective = effectiveItems.get(itemId);
    if (!effective || itemState(effective) !== "not_applicable") {
      return invalid("profile_exclusion_mismatch");
    }
  }
  for (const itemId of currentProfile.autoExcludedItemIds) {
    const descriptor = itemById.get(itemId);
    if (!descriptor) return invalid("invalid_current_profile");
    const currentCategory = readCurrentCategory(
      currentProgress[descriptor.categoryKey],
      categoryByKey.get(descriptor.categoryKey),
    );
    if (!currentCategory || itemState(currentCategory.items.get(itemId)) !== "not_applicable") {
      return invalid("current_profile_exclusion_mismatch");
    }
  }

  // Automatic-exclusion ownership must move with the exact item-state delta.
  // Matching only the final N/A state would let a proposal claim a manual N/A
  // as profile-owned, or silently abandon ownership without restoring it.
  // The SQL approval boundary applies this same set-difference invariant.
  const actualExcludedIds = new Set(excludedItems.map((item) => item.itemId));
  const actualRestoredIds = new Set(restoredItems.map((item) => item.itemId));
  const addedProfileIds = new Set(
    [...nextProfile.autoExcludedItemIds].filter(
      (itemId) => !currentProfile.autoExcludedItemIds.has(itemId),
    ),
  );
  const removedProfileIds = new Set(
    [...currentProfile.autoExcludedItemIds].filter(
      (itemId) => !nextProfile.autoExcludedItemIds.has(itemId),
    ),
  );
  if (
    addedProfileIds.size !== actualExcludedIds.size
    || [...addedProfileIds].some((itemId) => !actualExcludedIds.has(itemId))
    || removedProfileIds.size !== actualRestoredIds.size
    || [...removedProfileIds].some((itemId) => !actualRestoredIds.has(itemId))
  ) return invalid("profile_exclusion_delta_mismatch");

  return {
    status: "ready",
    baseRevision: proposal.baseRevision,
    questionChanges,
    categories,
    excludedItems,
    restoredItems,
    structuralChanges,
    automaticExclusionTotal: nextProfile.autoExcludedItemIds.size,
  };
}

export function isChecklistSituationProposal(value) {
  return isRecord(value) && value.kind === "checklist_situation";
}
