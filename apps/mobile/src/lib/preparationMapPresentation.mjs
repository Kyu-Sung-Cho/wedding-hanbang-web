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
