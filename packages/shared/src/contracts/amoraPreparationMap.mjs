import { auditAmoraPreparationCoverage } from "./amoraPreparationCoverage.mjs";

export const AMORA_PREPARATION_MAP_CONTRACT_VERSION = 1;

const MAX_ATTENTION_TOPICS = 3;
const SAVED_TOPIC_STATUSES = new Set([
  "not_started",
  "in_progress",
  "completed",
  "not_applicable",
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function getTemplateItemIds(topic) {
  if (!Array.isArray(topic?.items)) return [];
  const ids = [];
  const seen = new Set();
  for (const item of topic.items) {
    if (
      !isRecord(item)
      || typeof item.id !== "string"
      || item.id.length === 0
      || seen.has(item.id)
    ) continue;
    seen.add(item.id);
    ids.push(item.id);
  }
  return ids;
}

function readSavedChecklist(topic, saved) {
  const doneById = new Map(getTemplateItemIds(topic).map((id) => [id, false]));
  let malformed = false;
  let hasChecklistEvidence = false;

  if (Object.prototype.hasOwnProperty.call(saved, "checklist")) {
    if (!Array.isArray(saved.checklist)) {
      malformed = true;
    } else {
      hasChecklistEvidence = true;
      const seenSavedIds = new Set();
      for (const item of saved.checklist) {
        if (
          !isRecord(item)
          || typeof item.id !== "string"
          || item.id.length === 0
          || typeof item.done !== "boolean"
          || seenSavedIds.has(item.id)
        ) {
          malformed = true;
          continue;
        }
        seenSavedIds.add(item.id);
        doneById.set(item.id, item.done);
      }
    }
  } else {
    for (const [key, value] of Object.entries(saved)) {
      if (typeof value !== "boolean") continue;
      hasChecklistEvidence = true;
      doneById.set(key, value);
    }
  }

  return {
    malformed,
    hasChecklistEvidence,
    completedItems: [...doneById.values()].filter(Boolean).length,
    totalItems: doneById.size,
  };
}

function deriveTopicView(topic, safeProgress, attentionKeys) {
  const topicKey = typeof topic?.key === "string" ? topic.key : "";
  const label = typeof topic?.label === "string" ? topic.label : topicKey;
  const templateItemCount = getTemplateItemIds(topic).length;
  const hasSavedRecord = Object.prototype.hasOwnProperty.call(safeProgress, topicKey);

  if (!hasSavedRecord) {
    return Object.freeze({
      topicKey,
      label,
      state: "unknown",
      source: "no_saved_record",
      completedItems: 0,
      totalItems: templateItemCount,
      percent: 0,
      attentionReason: attentionKeys.has(topicKey)
        ? "basic_check_window"
        : "confirm_applicability",
    });
  }

  const saved = safeProgress[topicKey];
  if (!isRecord(saved)) {
    return Object.freeze({
      topicKey,
      label,
      state: "needs_review",
      source: "saved_checklist",
      completedItems: 0,
      totalItems: templateItemCount,
      percent: 0,
      attentionReason: "resolve_conflict",
    });
  }

  const explicitStatus = saved.status;
  const hasValidStatus = SAVED_TOPIC_STATUSES.has(explicitStatus);
  const hasInvalidStatus = explicitStatus !== undefined && !hasValidStatus;
  const checklist = readSavedChecklist(topic, saved);

  if (explicitStatus === "not_applicable") {
    const state = checklist.malformed ? "needs_review" : "not_applicable";
    return Object.freeze({
      topicKey,
      label,
      state,
      source: "saved_checklist",
      completedItems: 0,
      totalItems: 0,
      percent: 0,
      attentionReason: state === "needs_review" ? "resolve_conflict" : null,
    });
  }

  const derivedState = checklist.completedItems === 0
    ? "not_started"
    : checklist.totalItems > 0 && checklist.completedItems === checklist.totalItems
      ? "completed"
      : "in_progress";
  const conflictsWithStatus = hasValidStatus && explicitStatus !== derivedState;
  const hasEvidence = hasValidStatus || checklist.hasChecklistEvidence;
  const state = checklist.malformed
    || hasInvalidStatus
    || conflictsWithStatus
    || !hasEvidence
    ? "needs_review"
    : derivedState;
  const attentionReason = state === "needs_review"
    ? "resolve_conflict"
    : state === "in_progress"
      ? "continue_saved_progress"
      : attentionKeys.has(topicKey)
        ? "basic_check_window"
        : state === "not_started"
          ? "saved_not_started"
          : null;

  return Object.freeze({
    topicKey,
    label,
    state,
    source: "saved_checklist",
    completedItems: checklist.completedItems,
    totalItems: checklist.totalItems,
    percent: checklist.totalItems > 0
      ? Math.round((checklist.completedItems / checklist.totalItems) * 100)
      : 0,
    attentionReason,
  });
}

export function buildAmoraPreparationOverview({
  topics,
  progress,
  attentionTopicKeys = [],
}) {
  const safeTopics = Array.isArray(topics) ? topics : [];
  const safeProgress = progress && typeof progress === "object" && !Array.isArray(progress)
    ? progress
    : {};
  const attentionKeys = new Set(
    Array.isArray(attentionTopicKeys)
      ? attentionTopicKeys.filter((key) => typeof key === "string")
      : [],
  );

  const seenTopicKeys = new Set();
  const topicViews = safeTopics
    .filter((topic) => {
      if (
        typeof topic?.key !== "string"
        || topic.key.length === 0
        || seenTopicKeys.has(topic.key)
      ) return false;
      seenTopicKeys.add(topic.key);
      return true;
    })
    .map((topic) => deriveTopicView(topic, safeProgress, attentionKeys));
  const countedTopics = topicViews.filter((topic) => topic.state !== "not_applicable");
  const completedItems = countedTopics.reduce(
    (total, topic) => total + topic.completedItems,
    0,
  );
  const totalItems = countedTopics.reduce(
    (total, topic) => total + topic.totalItems,
    0,
  );
  const attentionTopics = topicViews
    .map((topic, index) => ({ topic, index }))
    .filter(({ topic }) => topic.state !== "completed" && topic.state !== "not_applicable")
    .sort((left, right) => {
      const rank = (topic) => {
        if (topic.state === "needs_review") return 0;
        if (topic.state === "in_progress") return 1;
        if (attentionKeys.has(topic.topicKey)) return 2;
        if (topic.state === "not_started") return 3;
        return 4;
      };
      return rank(left.topic) - rank(right.topic) || left.index - right.index;
    })
    .slice(0, MAX_ATTENTION_TOPICS)
    .map(({ topic }) => topic);
  const coverageAudit = auditAmoraPreparationCoverage({
    checklistTopics: safeTopics,
  });

  return Object.freeze({
    version: AMORA_PREPARATION_MAP_CONTRACT_VERSION,
    coverage: Object.freeze({
      version: coverageAudit.version,
      stage: coverageAudit.issues.length > 0
        ? "invalid"
        : coverageAudit.isComplete ? "complete" : "partial",
      connectedTopicCount: coverageAudit.connectedChecklistTopics.length,
      journeyAxisCount: coverageAudit.axes.length,
      gapCount: coverageAudit.gaps.length,
      issueCount: coverageAudit.issues.length,
    }),
    summary: Object.freeze({
      totalTopics: topicViews.length,
      unknownTopics: topicViews.filter((topic) => topic.state === "unknown").length,
      notStartedTopics: topicViews.filter((topic) => topic.state === "not_started").length,
      inProgressTopics: topicViews.filter((topic) => topic.state === "in_progress").length,
      completedTopics: topicViews.filter((topic) => topic.state === "completed").length,
      notApplicableTopics: topicViews.filter((topic) => topic.state === "not_applicable").length,
      needsReviewTopics: topicViews.filter((topic) => topic.state === "needs_review").length,
      completedItems,
      totalItems,
      percent: totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0,
    }),
    topics: Object.freeze(topicViews),
    attentionTopics: Object.freeze(attentionTopics),
  });
}
