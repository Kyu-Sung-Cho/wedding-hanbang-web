export const AMORA_PLANNING_FOUNDATION_CONTRACT_VERSION = 1;

const SELF_REPORTED_STAGES = new Set([
  "starting",
  "already_preparing",
  "unknown",
  "later",
]);
const READ_STATES = new Set(["loaded", "partial", "unavailable"]);
const TOPIC_STATES = new Set([
  "unknown",
  "not_started",
  "in_progress",
  "completed",
  "not_applicable",
  "needs_review",
]);
const ATTENTION_REASONS = new Set([
  "continue_saved_progress",
  "basic_check_window",
  "saved_not_started",
  "confirm_applicability",
  "resolve_conflict",
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeText(value, maxLength) {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (
    !normalized
    || Array.from(normalized).length > maxLength
    || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(normalized)
  ) return null;
  return normalized;
}

function isNonNegativeSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function parseSummary(value) {
  if (!isRecord(value)) return null;
  const keys = [
    "completedItems",
    "completedTopics",
    "inProgressTopics",
    "needsReviewTopics",
    "notApplicableTopics",
    "notStartedTopics",
    "percent",
    "totalItems",
    "totalTopics",
    "unknownTopics",
  ];
  if (Object.keys(value).sort().join(",") !== [...keys].sort().join(",")) return null;
  if (!keys.every((key) => isNonNegativeSafeInteger(value[key]))) return null;
  if (value.percent > 100) return null;
  if (
    value.unknownTopics
      + value.notStartedTopics
      + value.inProgressTopics
      + value.completedTopics
      + value.notApplicableTopics
      + value.needsReviewTopics
      !== value.totalTopics
  ) return null;
  if (value.completedItems > value.totalItems) return null;
  return value;
}

function parseCoverage(value) {
  if (!isRecord(value)) return null;
  const keys = [
    "connectedTopicCount",
    "gapCount",
    "issueCount",
    "journeyAxisCount",
    "stage",
    "version",
  ];
  if (
    Object.keys(value).sort().join(",") !== [...keys].sort().join(",")
    || value.version !== 1
    || !["complete", "partial", "invalid"].includes(value.stage)
    || !keys.slice(0, 4).every((key) => isNonNegativeSafeInteger(value[key]))
  ) return null;
  return value;
}

function parseTopic(value) {
  if (!isRecord(value)) return null;
  const keys = [
    "attentionReason",
    "completedItems",
    "label",
    "percent",
    "source",
    "state",
    "topicKey",
    "totalItems",
  ];
  if (Object.keys(value).sort().join(",") !== [...keys].sort().join(",")) return null;
  const topicKey = safeText(value.topicKey, 80);
  const label = safeText(value.label, 120);
  if (
    !topicKey
    || topicKey !== value.topicKey
    || !label
    || label !== value.label
    || !TOPIC_STATES.has(value.state)
    || value.source !== "no_saved_record" && value.source !== "saved_checklist"
    || !isNonNegativeSafeInteger(value.completedItems)
    || !isNonNegativeSafeInteger(value.totalItems)
    || value.completedItems > value.totalItems
    || !isNonNegativeSafeInteger(value.percent)
    || value.percent > 100
    || value.attentionReason !== null && !ATTENTION_REASONS.has(value.attentionReason)
  ) return null;
  return Object.freeze({ ...value, topicKey, label });
}

function parseOverview(value) {
  if (!isRecord(value)) return null;
  if (
    Object.keys(value).sort().join(",")
      !== "attentionTopics,coverage,summary,topics,version"
    || value.version !== 1
    || !Array.isArray(value.topics)
    || !Array.isArray(value.attentionTopics)
  ) return null;
  const coverage = parseCoverage(value.coverage);
  const summary = parseSummary(value.summary);
  if (!coverage || !summary) return null;
  const topics = value.topics.map(parseTopic);
  const attentionTopics = value.attentionTopics.map(parseTopic);
  if (topics.some((topic) => topic === null) || attentionTopics.some((topic) => topic === null)) {
    return null;
  }
  const topicByKey = new Map(topics.map((topic) => [topic.topicKey, topic]));
  if (topicByKey.size !== topics.length) return null;
  for (const topic of attentionTopics) {
    const canonical = topicByKey.get(topic.topicKey);
    if (!canonical || JSON.stringify(canonical) !== JSON.stringify(topic)) return null;
  }
  return Object.freeze({ coverage, summary, topics, attentionTopics });
}

function source(kind, key, label) {
  return Object.freeze({ kind, key, label });
}

function freezeResult(value) {
  if (Array.isArray(value.options)) {
    Object.freeze(value.options);
  }
  if (Array.isArray(value.usedSources)) {
    Object.freeze(value.usedSources);
  }
  return Object.freeze(value);
}

function unavailable() {
  return freezeResult({
    kind: "unavailable",
    title: "준비 상태를 다시 확인할게요",
    description: "일부 기록을 안전하게 확인하지 못해 지금은 새 행동을 추천하지 않았어요.",
    retryable: true,
    usedSources: [],
  });
}

function actionForSavedTopic(topic) {
  const usedSources = [source(
    "canonical_progress",
    topic.topicKey,
    `${topic.label} · ${topic.state === "in_progress" ? "진행 중" : "시작 전"}`,
  )];
  if (topic.state === "in_progress") {
    return freezeResult({
      kind: "action",
      actionKey: "continue_saved_topic",
      topicKey: topic.topicKey,
      title: `${topic.label} 준비 이어보기`,
      reason: "저장된 진행 중 기록이 있어 처음부터 다시 묻지 않아요.",
      completionCriterion: "현재 남은 항목 하나를 확인하거나, 지금은 해당 없다고 표시하면 끝나요.",
      usedSources,
      unknownSafe: false,
    });
  }
  return freezeResult({
    kind: "action",
    actionKey: "start_saved_topic",
    topicKey: topic.topicKey,
    title: `${topic.label} 준비에서 첫 항목 확인하기`,
    reason: "직접 시작 전으로 저장한 준비라서, 다른 주제를 추측하지 않고 여기서 시작해요.",
    completionCriterion: "첫 항목을 확인하거나, 지금은 해당 없다고 표시하면 끝나요.",
    usedSources,
    unknownSafe: false,
  });
}

export function resolvePlanningFoundationFirstValue({
  preparationOverview,
  selfReportedStage = null,
  readState = "loaded",
}) {
  if (
    !READ_STATES.has(readState)
    || readState !== "loaded"
    || selfReportedStage !== null && !SELF_REPORTED_STAGES.has(selfReportedStage)
  ) return unavailable();

  const overview = parseOverview(preparationOverview);
  if (
    !overview
    || overview.coverage.stage === "invalid"
    || overview.coverage.issueCount !== 0
  ) return unavailable();

  const conflicted = overview.attentionTopics.find(
    (topic) => topic.state === "needs_review" && topic.attentionReason === "resolve_conflict",
  );
  if (conflicted) {
    return freezeResult({
      kind: "recovery",
      recoveryKey: "review_saved_topic",
      topicKey: conflicted.topicKey,
      title: `${conflicted.label} 기록 다시 확인하기`,
      description: "저장된 상태와 체크 내용이 맞지 않아 새 행동을 추천하기 전에 확인이 필요해요.",
      usedSources: [source(
        "canonical_progress",
        conflicted.topicKey,
        `${conflicted.label} · 확인 필요`,
      )],
    });
  }

  const currentTopic = overview.attentionTopics.find(
    (topic) => topic.state === "in_progress" || topic.state === "not_started",
  );
  if (currentTopic) return actionForSavedTopic(currentTopic);

  if (selfReportedStage === null) {
    return freezeResult({
      kind: "question",
      questionKey: "preparation_stage",
      title: "지금 결혼 준비는 어디쯤인가요?",
      description: "정확하지 않아도 괜찮아요. 지금 상태에 가까운 하나만 골라주세요.",
      options: Object.freeze([
        Object.freeze({ value: "starting", label: "이제 시작해요" }),
        Object.freeze({ value: "already_preparing", label: "이미 준비 중이에요" }),
        Object.freeze({ value: "unknown", label: "아직 잘 모르겠어요" }),
      ]),
      secondaryAction: Object.freeze({ value: "later", label: "나중에 답할게요" }),
      usedSources: [],
    });
  }

  if (selfReportedStage === "later") {
    return freezeResult({
      kind: "deferred",
      title: "지금은 답하지 않아도 괜찮아요",
      description: "입력한 내용을 준비 기록으로 확정하지 않았어요. 아모라에서 언제든 다시 이어갈 수 있어요.",
      resumeKey: "preparation_stage",
      usedSources: [],
    });
  }

  if (selfReportedStage === "already_preparing") {
    return freezeResult({
      kind: "action",
      actionKey: "reconstruct_existing_preparation",
      topicKey: "planning_foundation",
      title: "이미 준비한 것 최대 세 가지 확인하기",
      reason: "기존 기록을 다시 다 입력하지 않고, 확실한 것부터 확인해야 중복 질문을 줄일 수 있어요.",
      completionCriterion: "확실한 항목만 최대 세 가지 고르고, 나머지는 확인 전으로 남기면 끝나요.",
      usedSources: [source(
        "self_report",
        "preparation_stage",
        "이미 준비 중이에요",
      )],
      unknownSafe: true,
    });
  }

  return freezeResult({
    kind: "action",
    actionKey: "establish_preparation_baseline",
    topicKey: "planning_foundation",
    title: "정한 것과 아직 모르는 것 하나씩 나누기",
    reason: "처음에는 답을 다 정하는 것보다 현재 상태를 구분해야 다음 안내가 내 상황에 맞아져요.",
    completionCriterion: "정한 것과 아직 모르는 것을 하나씩 표시하거나, 모두 아직 모름으로 남기면 끝나요.",
    usedSources: [source(
      "self_report",
      "preparation_stage",
      selfReportedStage === "unknown" ? "아직 잘 모르겠어요" : "이제 시작해요",
    )],
    unknownSafe: true,
  });
}
