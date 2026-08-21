const SUMMARY_DEFINITIONS = Object.freeze([
  { key: "in_progress", field: "inProgressTopics", label: "진행 중", tone: "active" },
  { key: "completed", field: "completedTopics", label: "완료", tone: "success" },
  { key: "needs_review", field: "needsReviewTopics", label: "확인 필요", tone: "warning" },
  { key: "not_started", field: "notStartedTopics", label: "시작 전", tone: "neutral" },
  { key: "unknown", field: "unknownTopics", label: "확인 전", tone: "neutral" },
  { key: "not_applicable", field: "notApplicableTopics", label: "하지 않기로 함", tone: "muted" },
]);

const HOME_STATUS_DEFINITIONS = Object.freeze([
  { key: "in_progress", fields: ["inProgressTopics"], label: "진행 중", tone: "active" },
  { key: "needs_attention", fields: ["needsReviewTopics", "notStartedTopics"], label: "확인 필요", tone: "warning" },
  { key: "unknown", fields: ["unknownTopics"], label: "아직 모름", tone: "neutral" },
  { key: "completed", fields: ["completedTopics"], label: "완료", tone: "success" },
]);

const REASON_LABELS = Object.freeze({
  continue_saved_progress: "저장한 진행 상태부터 이어서 볼게요.",
  basic_check_window: "결혼식 날짜 기준의 기본 확인 시점이 가까워요.",
  saved_not_started: "필요하다고 정한 준비를 시작해 볼 차례예요.",
  confirm_applicability: "필요한 준비인지부터 하나씩 확인해요.",
  resolve_conflict: "저장된 상태가 서로 달라 한 번 확인이 필요해요.",
});

const JOURNEY_CHAPTER_DEFINITIONS = Object.freeze([
  Object.freeze({
    key: "agreements",
    title: "먼저 맞출 것",
    description: "두 사람과 가족이 큰 방향을 맞추는 준비예요.",
    topicKeys: Object.freeze(["greeting", "meeting", "venue"]),
  }),
  Object.freeze({
    key: "vendors",
    title: "주요 선택과 예약",
    description: "비교하고 확인할 업체와 상품을 모았어요.",
    topicKeys: Object.freeze(["studio", "dress", "makeup", "ring"]),
  }),
  Object.freeze({
    key: "life_and_family",
    title: "생활과 가족 준비",
    description: "신혼생활과 가족 사이에서 맞출 준비예요.",
    topicKeys: Object.freeze([
      "hanbok", "yedan", "honeymoon", "houseware", "housing", "registration",
    ]),
  }),
  Object.freeze({
    key: "ceremony_details",
    title: "예식 전 세부 준비",
    description: "당일이 편안하도록 미리 정리할 준비예요.",
    topicKeys: Object.freeze([
      "invitation", "snap", "shoes", "bouquet", "gift", "mc", "ham", "pyebaek",
    ]),
  }),
]);

const JOURNEY_STATE_DEFINITIONS = Object.freeze({
  unknown: Object.freeze({ label: "확인 전", tone: "neutral", symbol: "?" }),
  needs_review: Object.freeze({ label: "확인 필요", tone: "warning", symbol: "!" }),
  not_applicable: Object.freeze({ label: "해당 없음", tone: "muted", symbol: "—" }),
  not_started: Object.freeze({ label: "준비 전", tone: "neutral", symbol: "○" }),
  in_progress: Object.freeze({ label: "준비 중", tone: "active", symbol: "◐" }),
  completed: Object.freeze({ label: "완료", tone: "success", symbol: "✓" }),
});

function buildJourneyNode(topic, focusTopicKeys) {
  const stateDefinition = JOURNEY_STATE_DEFINITIONS[topic?.state];
  if (
    !stateDefinition
    || typeof topic?.topicKey !== "string"
    || topic.topicKey.length === 0
    || typeof topic?.label !== "string"
    || topic.label.length === 0
  ) return null;

  const isFocus = focusTopicKeys.has(topic.topicKey);
  const focusReasonLabel = isFocus
    ? REASON_LABELS[topic.attentionReason] ?? null
    : null;
  if (isFocus && !focusReasonLabel) return null;
  return Object.freeze({
    topicKey: topic.topicKey,
    title: topic.label,
    state: topic.state,
    stateLabel: stateDefinition.label,
    tone: stateDefinition.tone,
    symbol: stateDefinition.symbol,
    isFocus,
    focusReasonLabel,
    accessibilityLabel: `${topic.label}, ${stateDefinition.label}${
      isFocus ? `, 이번에 볼 준비, ${focusReasonLabel}` : ""
    }`,
  });
}

export function buildPreparationJourneyMapModel(overview) {
  if (
    !overview
    || overview.version !== 1
    || !overview.coverage
    || !Array.isArray(overview.topics)
    || !Array.isArray(overview.attentionTopics)
    || overview.coverage.stage === "invalid"
  ) return null;

  const topicByKey = new Map();
  for (const topic of overview.topics) {
    if (
      typeof topic?.topicKey !== "string"
      || topic.topicKey.length === 0
      || topicByKey.has(topic.topicKey)
    ) return null;
    topicByKey.set(topic.topicKey, topic);
  }

  const focusTopicKeys = new Set();
  for (const topic of overview.attentionTopics.slice(0, 3)) {
    const canonicalTopic = topicByKey.get(topic?.topicKey);
    if (
      typeof topic?.topicKey !== "string"
      || !canonicalTopic
      || topic.state === "completed"
      || topic.state === "not_applicable"
      || canonicalTopic.attentionReason !== topic.attentionReason
      || !REASON_LABELS[topic.attentionReason]
    ) return null;
    focusTopicKeys.add(topic.topicKey);
  }

  const assignedTopicKeys = new Set();
  const chapters = JOURNEY_CHAPTER_DEFINITIONS.map((chapter) => {
    const nodes = chapter.topicKeys
      .map((topicKey) => topicByKey.get(topicKey))
      .filter(Boolean)
      .map((topic) => buildJourneyNode(topic, focusTopicKeys));
    if (nodes.some((node) => node === null)) return null;
    for (const node of nodes) assignedTopicKeys.add(node.topicKey);
    return Object.freeze({
      key: chapter.key,
      title: chapter.title,
      description: chapter.description,
      hasFocus: nodes.some((node) => node.isFocus),
      nodes: Object.freeze(nodes),
    });
  });
  if (chapters.some((chapter) => chapter === null)) return null;

  const ungroupedTopics = overview.topics.filter(
    (topic) => !assignedTopicKeys.has(topic.topicKey),
  );
  if (ungroupedTopics.length > 0) {
    const nodes = ungroupedTopics.map((topic) => buildJourneyNode(topic, focusTopicKeys));
    if (nodes.some((node) => node === null)) return null;
    chapters.push(Object.freeze({
      key: "other",
      title: "그 밖의 준비",
      description: "현재 연결된 다른 준비를 모았어요.",
      hasFocus: nodes.some((node) => node.isFocus),
      nodes: Object.freeze(nodes),
    }));
  }

  const nodesByKey = new Map(
    chapters.flatMap((chapter) => chapter.nodes).map((node) => [node.topicKey, node]),
  );
  if (nodesByKey.size !== overview.topics.length) return null;
  const focusNodes = overview.attentionTopics
    .slice(0, 3)
    .map((topic) => nodesByKey.get(topic.topicKey));
  if (focusNodes.some((node) => !node)) return null;

  return Object.freeze({
    description: "저장한 기록에서 이번에 볼 준비를 모았어요.",
    boundaryLabel: "저장한 준비 기록 기준",
    coverageNotice: overview.coverage.stage === "partial"
      ? "현재 체크리스트에 연결된 준비만 보여요. 예식 당일과 결혼 후처럼 아직 연결되지 않은 준비는 포함되지 않아요."
      : null,
    viewOptions: Object.freeze([
      Object.freeze({ key: "map", label: "지도" }),
      Object.freeze({ key: "details", label: "상세 목록" }),
    ]),
    focus: Object.freeze({
      title: focusNodes.length > 0 ? "이번에 볼 준비" : "필요한 주제부터 보기",
      description: focusNodes.length > 0
        ? "저장한 상태와 기본 확인 시점을 기준으로 골랐어요. 각 이유를 함께 확인해 주세요."
        : "모든 준비를 잠그지 않았어요. 필요한 주제부터 편하게 확인해요.",
      nodes: Object.freeze(focusNodes),
    }),
    chapters: Object.freeze(chapters),
  });
}

function getStatusLabel(topic) {
  switch (topic.state) {
    case "in_progress":
      return `${topic.completedItems}/${topic.totalItems} 완료`;
    case "completed":
      return "완료";
    case "not_applicable":
      return "하지 않기로 함";
    case "not_started":
      return "시작 전";
    case "needs_review":
      return "기록 확인 필요";
    default:
      return "아직 확인 전";
  }
}

function getRowTone(topic) {
  if (topic.state === "needs_review" || topic.attentionReason === "basic_check_window") {
    return "warning";
  }
  return topic.state === "in_progress" ? "active" : "neutral";
}

export function buildPreparationHomeStatusModel(overview) {
  if (
    !overview
    || overview.version !== 1
    || !overview.summary
  ) return null;

  const requiredFields = [
    "totalTopics",
    "unknownTopics",
    "notStartedTopics",
    "inProgressTopics",
    "completedTopics",
    "notApplicableTopics",
    "needsReviewTopics",
  ];
  if (requiredFields.some((field) => (
    !Number.isSafeInteger(overview.summary[field])
    || overview.summary[field] < 0
  ))) return null;

  const items = HOME_STATUS_DEFINITIONS.map((definition) => Object.freeze({
    key: definition.key,
    label: definition.label,
    count: definition.fields.reduce(
      (total, field) => total + overview.summary[field],
      0,
    ),
    tone: definition.tone,
  }));
  const representedTopics = items.reduce((total, item) => total + item.count, 0);
  if (
    representedTopics + overview.summary.notApplicableTopics
    !== overview.summary.totalTopics
  ) return null;

  return Object.freeze({
    label: "준비 상태",
    boundaryLabel: "저장한 준비 기록 기준",
    items: Object.freeze(items),
  });
}

export function buildPreparationHomeSectionModel(overview) {
  if (
    !overview
    || overview.version !== 1
    || !overview.summary
    || !Array.isArray(overview.attentionTopics)
  ) return null;

  const summaryItems = SUMMARY_DEFINITIONS
    .map((definition) => ({
      key: definition.key,
      label: definition.label,
      count: Number.isSafeInteger(overview.summary[definition.field])
        ? overview.summary[definition.field]
        : 0,
      tone: definition.tone,
    }))
    .filter((item) => item.count > 0);
  const isEntirelyUnknown = overview.summary.totalTopics > 0
    && overview.summary.unknownTopics === overview.summary.totalTopics;

  return Object.freeze({
    eyebrow: "MY PREPARATION",
    title: "내 결혼 준비",
    description: isEntirelyUnknown
      ? "아직 확인한 준비가 없어요. 필요한 것부터 하나씩 정하면 돼요."
      : "직접 저장한 준비 기록을 기준으로, 이어볼 항목을 먼저 보여드려요.",
    summaryItems: Object.freeze(summaryItems.map((item) => Object.freeze(item))),
    emptyMessage: overview.attentionTopics.length === 0
      ? "현재 확인한 준비는 모두 정리됐어요. 전체 목록에서 다음 준비를 살펴볼 수 있어요."
      : null,
    rows: Object.freeze(overview.attentionTopics.map((topic) => Object.freeze({
      topicKey: topic.topicKey,
      title: topic.label,
      statusLabel: getStatusLabel(topic),
      reasonLabel: REASON_LABELS[topic.attentionReason]
        ?? "현재 준비 기록을 한 번 확인해요.",
      tone: getRowTone(topic),
      route: Object.freeze({
        pathname: "/checklist",
        params: Object.freeze({ category: topic.topicKey }),
      }),
    }))),
    allTopicsAction: Object.freeze({
      label: "전체 준비 보기",
      route: "/checklist",
    }),
  });
}
