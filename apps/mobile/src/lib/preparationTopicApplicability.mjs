const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SAFE_STATUS_VALUES = new Set([
  "not_started",
  "in_progress",
  "completed",
  "not_applicable",
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSafeText(value, maximumCharacters) {
  return typeof value === "string"
    && value.trim() === value
    && Array.from(value).length > 0
    && Array.from(value).length <= maximumCharacters
    && !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value);
}

function readTemplateItems(topic) {
  if (!isRecord(topic) || !isSafeText(topic.key, 80) || !Array.isArray(topic.items)) {
    return null;
  }
  const seen = new Set();
  const items = [];
  for (const item of topic.items) {
    if (
      !isRecord(item)
      || !isSafeText(item.id, 120)
      || !isSafeText(item.label, 240)
      || seen.has(item.id)
    ) return null;
    seen.add(item.id);
    items.push({ id: item.id, label: item.label, done: false });
  }
  return items;
}

function readSavedChecklist(savedTopic, templateItems) {
  const templateById = new Map(templateItems.map((item) => [item.id, item]));
  const savedById = new Map();

  if (Object.hasOwn(savedTopic, "checklist")) {
    if (!Array.isArray(savedTopic.checklist) || savedTopic.checklist.length > 200) return null;
    for (const item of savedTopic.checklist) {
      if (
        !isRecord(item)
        || !isSafeText(item.id, 120)
        || !isSafeText(item.label, 240)
        || typeof item.done !== "boolean"
        || savedById.has(item.id)
      ) return null;
      savedById.set(item.id, item);
    }
  } else {
    for (const templateItem of templateItems) {
      if (typeof savedTopic[templateItem.id] === "boolean") {
        savedById.set(templateItem.id, {
          ...templateItem,
          done: savedTopic[templateItem.id],
        });
      }
    }
  }

  const checklist = templateItems.map((templateItem) => ({
    ...templateItem,
    done: savedById.get(templateItem.id)?.done === true,
  }));
  for (const item of savedById.values()) {
    if (!templateById.has(item.id)) checklist.push({ ...item });
  }
  return checklist;
}

function statusForChecklist(checklist) {
  if (checklist.length === 0 || checklist.every((item) => item.done === false)) {
    return "not_started";
  }
  return checklist.every((item) => item.done === true) ? "completed" : "in_progress";
}

function readConnectedRecordCount(view) {
  if (!Array.isArray(view.linkedScheduleIds) || !Array.isArray(view.linkedActionIds)) {
    return null;
  }
  const ids = [...view.linkedScheduleIds, ...view.linkedActionIds];
  if (ids.some((id) => !isSafeText(id, 200)) || new Set(ids).size !== ids.length) {
    return null;
  }
  return ids.length;
}

export function classifyPreparationTopicApplicabilityFailure(status, payload) {
  if (status !== 409 || !isRecord(payload)) return "failed";
  if (payload.code === "PLAN_CHANGE_ACTIVE_REQUEST") return "active_request";
  if (payload.code === "PLAN_CHANGE_STALE") return "stale";
  return "failed";
}

export function buildPreparationTopicApplicabilityControl(view) {
  if (
    !isRecord(view)
    || view.version !== 1
    || !isSafeText(view.topicKey, 80)
    || !isSafeText(view.label, 120)
    || !(
      view.applicability === "unknown"
      || view.applicability === "applicable"
      || view.applicability === "not_applicable"
    )
    || !(
      view.status === "not_started"
      || view.status === "exploring"
      || view.status === "decision_needed"
      || view.status === "in_progress"
      || view.status === "completed"
    )
    || view.actionReadState !== "loaded"
  ) return null;
  if (view.applicability !== "not_applicable" && view.status === "decision_needed") {
    return null;
  }
  const connectedRecordCount = readConnectedRecordCount(view);
  if (connectedRecordCount === null) return null;
  const connectedRecordLabel = connectedRecordCount > 0
    ? ` 연결된 기록 ${connectedRecordCount}개는 ${view.applicability === "not_applicable" ? "그대로예요" : "지워지지 않아요"}.`
    : "";

  if (view.applicability === "not_applicable") {
    return Object.freeze({
      version: 1,
      intent: "reinclude",
      label: "다시 준비에 포함",
      description: `이전 체크 기록이 진행률에 다시 반영돼요.${connectedRecordLabel}`,
      confirmTitle: "공유 준비 목록에 다시 포함할까요?",
      confirmMessage: "이전 체크 기록이 진행률에 다시 반영돼요. 연결된 일정·행동은 그대로 유지돼요.",
      confirmActionLabel: "다시 포함",
      accessibilityLabel: `${view.label} 다시 준비 목록에 넣기`,
      disabledReason: null,
    });
  }

  return Object.freeze({
    version: 1,
    intent: "exclude",
    label: "이 준비는 하지 않아요",
    description: `진행률과 마감 알림에서 제외해요. 체크 기록과${connectedRecordLabel || " 연결된 일정·행동은 지워지지 않아요."}`,
    confirmTitle: "공유 준비 목록에서 제외할까요?",
    confirmMessage: "진행률과 마감 알림에서 빠져요. 이전 체크 기록과 연결된 일정·행동은 지워지지 않으며, 언제든 다시 포함할 수 있어요.",
    confirmActionLabel: "준비에서 제외",
    accessibilityLabel: `${view.label} 준비 목록에서 제외하기`,
    disabledReason: null,
  });
}

export function buildPreparationTopicApplicabilityMutation({
  expectedCoupleId,
  expectedRevision,
  intent,
  topic,
  savedTopic,
}) {
  if (
    typeof expectedCoupleId !== "string"
    || !UUID_PATTERN.test(expectedCoupleId)
    || !Number.isSafeInteger(expectedRevision)
    || expectedRevision < 0
    || expectedRevision >= Number.MAX_SAFE_INTEGER
    || !(intent === "exclude" || intent === "reinclude")
  ) return null;

  const templateItems = readTemplateItems(topic);
  if (!templateItems) return null;
  const normalizedSaved = savedTopic === undefined ? {} : savedTopic;
  if (!isRecord(normalizedSaved)) return null;
  if (
    Object.hasOwn(normalizedSaved, "category")
    && normalizedSaved.category !== topic.key
  ) return null;
  if (
    Object.hasOwn(normalizedSaved, "status")
    && !SAFE_STATUS_VALUES.has(normalizedSaved.status)
  ) return null;

  const wasExcluded = normalizedSaved.status === "not_applicable";
  if ((intent === "exclude" && wasExcluded) || (intent === "reinclude" && !wasExcluded)) {
    return null;
  }
  const checklist = readSavedChecklist(normalizedSaved, templateItems);
  if (!checklist) return null;
  const nextStatus = intent === "exclude"
    ? "not_applicable"
    : statusForChecklist(checklist);
  const nextTopic = Object.freeze({
    ...normalizedSaved,
    category: topic.key,
    status: nextStatus,
    checklist: Object.freeze(checklist.map((item) => Object.freeze({ ...item }))),
  });
  const progressPatch = Object.freeze({ [topic.key]: nextTopic });

  return Object.freeze({
    version: 1,
    intent,
    previousStatus: wasExcluded ? "not_applicable" : normalizedSaved.status ?? "unknown",
    nextStatus,
    retainedCompletedItems: checklist.filter((item) => item.done).length,
    body: Object.freeze({
      expected_couple_id: expectedCoupleId.toLowerCase(),
      expected_revision: expectedRevision,
      progress_patch: progressPatch,
    }),
  });
}
