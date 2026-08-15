import { buildAmoraHomePersonalization } from "./amoraPersonalizationSettings.mjs";
import { getAmoraCoupleCriterionView } from "./amoraCoupleCriterion.mjs";
import { normalizeAmoraCoreCriterionText } from "@hanbang/shared/amora-core-criterion";

function pluralDay(days) {
  return `${Math.abs(days)}일`;
}

const EXTENDED_PICTOGRAPHIC_PATTERN = /^\p{Extended_Pictographic}$/u;
const DASHBOARD_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DASHBOARD_ACTION_ID_PATTERN = /^[0-9A-Za-z_-]{1,200}$/u;
const DASHBOARD_ACTION_SOURCES = new Set([
  "chat",
  "quote",
  "schedule",
  "budget",
  "guardrail",
  "manual",
]);
const DASHBOARD_ACTION_CATEGORY_KEYS = new Set([
  "meeting", "venue", "studio", "dress", "makeup", "ring", "hanbok",
  "yedan", "honeymoon", "houseware", "housing", "invitation", "snap",
  "shoes", "bouquet", "gift", "mc", "ham", "pyebaek",
]);
export const DASHBOARD_OPEN_ACTION_CANDIDATE_LIMIT = 80;
export const DASHBOARD_ACTION_DUE_SOON_DAYS = 7;
const DASHBOARD_ACTION_PRIORITY_RANK = Object.freeze({ high: 0, medium: 1, low: 2 });

function isEmojiAdornment(character) {
  const codePoint = character?.codePointAt(0);
  return character === "\ufe0e"
    || character === "\ufe0f"
    || (codePoint != null && codePoint >= 0x1f3fb && codePoint <= 0x1f3ff);
}

function hasUnsafeDashboardFormatting(value) {
  const characters = Array.from(value);
  return characters.some((character, index) => {
    if (character === "\u200d") {
      let previousIndex = index - 1;
      while (previousIndex >= 0 && isEmojiAdornment(characters[previousIndex])) {
        previousIndex -= 1;
      }
      let nextIndex = index + 1;
      while (nextIndex < characters.length && isEmojiAdornment(characters[nextIndex])) {
        nextIndex += 1;
      }
      return previousIndex < 0
        || nextIndex >= characters.length
        || !EXTENDED_PICTOGRAPHIC_PATTERN.test(characters[previousIndex])
        || !EXTENDED_PICTOGRAPHIC_PATTERN.test(characters[nextIndex]);
    }
    return /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(character);
  });
}

function normalizeDashboardActionText(value, maxLength) {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (
    !normalized
    || Array.from(normalized).length > maxLength
    || hasUnsafeDashboardFormatting(normalized)
  ) return null;
  return normalized;
}

function isValidDashboardYmd(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year === 0) return false;
  const parsed = new Date(0);
  parsed.setUTCHours(0, 0, 0, 0);
  parsed.setUTCFullYear(year, month - 1, day);
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function formatDashboardDueDate(value) {
  if (!isValidDashboardYmd(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  return `마감일은 ${year}년 ${month}월 ${day}일이에요.`;
}

export function parseDashboardOpenAction(value, expectedCoupleId) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (typeof expectedCoupleId !== "string" || value.couple_id !== expectedCoupleId) return null;
  if (value.status !== "open") return null;
  if (typeof value.id !== "string" || !DASHBOARD_ACTION_ID_PATTERN.test(value.id)) return null;

  const title = normalizeDashboardActionText(value.title, 120);
  const description = value.description == null
    ? null
    : normalizeDashboardActionText(value.description, 500);
  const dueDate = value.due_date == null || value.due_date === ""
    ? null
    : isValidDashboardYmd(value.due_date)
      ? value.due_date
      : undefined;
  const createdAt = typeof value.created_at === "string"
    && Number.isFinite(Date.parse(value.created_at))
    ? value.created_at
    : null;
  const sourceRevision = value.follow_up_revision == null
    ? null
    : Number.isSafeInteger(value.follow_up_revision) && value.follow_up_revision > 0
      ? value.follow_up_revision
      : undefined;
  const categoryKey = value.category_key == null || value.category_key === "general"
    ? null
    : typeof value.category_key === "string"
        && DASHBOARD_ACTION_CATEGORY_KEYS.has(value.category_key)
      ? value.category_key
      : undefined;

  if (
    !title
    || (value.description != null && !description)
    || dueDate === undefined
    || (value.priority !== "high" && value.priority !== "medium" && value.priority !== "low")
    || !DASHBOARD_ACTION_SOURCES.has(value.source)
    || categoryKey === undefined
    || sourceRevision === undefined
    || !createdAt
  ) return null;

  return Object.freeze({
    id: value.id,
    title,
    description,
    dueDate,
    priority: value.priority,
    source: value.source,
    categoryKey,
    sourceRevision,
    createdAt,
  });
}

function addDashboardDays(ymd, days) {
  const [year, month, day] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function getDashboardActionSortKey(action, todayYmd, dueSoonYmd) {
  const dueDate = action.dueDate;
  const bucket = dueDate && dueDate <= todayYmd
    ? 0
    : dueDate && dueDate <= dueSoonYmd
      ? 1
      : action.priority === "high"
        ? 2
        : dueDate
          ? 3
          : 4;
  return [
    bucket,
    dueDate ?? "9999-12-31",
    DASHBOARD_ACTION_PRIORITY_RANK[action.priority],
    -Date.parse(action.createdAt),
    action.id,
  ];
}

function compareDashboardActionSortKeys(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] < right[index]) return -1;
    if (left[index] > right[index]) return 1;
  }
  return 0;
}

function getDashboardActionWhyNow(action, todayYmd) {
  if (!isValidDashboardYmd(todayYmd)) return null;
  if (action.dueDate) {
    if (action.dueDate < todayYmd) {
      return "저장한 마감일이 지나 먼저 확인할 일이에요.";
    }
    if (action.dueDate === todayYmd) {
      return "오늘까지로 저장한 일이어서 먼저 보여드려요.";
    }
    if (action.dueDate <= addDashboardDays(todayYmd, DASHBOARD_ACTION_DUE_SOON_DAYS)) {
      return "7일 안에 저장한 마감일이 있어 먼저 보여드려요.";
    }
  }
  if (action.priority === "high") {
    return "중요도를 ‘높음’으로 저장한 일이어서 먼저 보여드려요.";
  }
  if (action.dueDate) {
    return "마감일이 저장된 열린 행동이에요.";
  }
  return "저장된 열린 행동이에요.";
}

export function selectDashboardOpenAction(values, expectedCoupleId, todayYmd) {
  if (!Array.isArray(values) || !isValidDashboardYmd(todayYmd)) return null;
  const dueSoonYmd = addDashboardDays(todayYmd, DASHBOARD_ACTION_DUE_SOON_DAYS);
  const candidates = values
    .slice(0, DASHBOARD_OPEN_ACTION_CANDIDATE_LIMIT)
    .map((value) => parseDashboardOpenAction(value, expectedCoupleId))
    .filter(Boolean)
    .map((action) => ({
      action,
      sortKey: getDashboardActionSortKey(action, todayYmd, dueSoonYmd),
    }))
    .sort((left, right) => compareDashboardActionSortKeys(left.sortKey, right.sortKey));
  return candidates[0]?.action ?? null;
}

export function selectDashboardReceiptAction(values, expectedCoupleId, actionId) {
  if (
    !Array.isArray(values)
    || typeof actionId !== "string"
    || !DASHBOARD_ACTION_ID_PATTERN.test(actionId)
  ) return null;
  for (const value of values.slice(0, DASHBOARD_OPEN_ACTION_CANDIDATE_LIMIT)) {
    const action = parseDashboardOpenAction(value, expectedCoupleId);
    if (action?.id === actionId) return action;
  }
  return null;
}

const DASHBOARD_ACTION_FEEDBACK_OUTCOMES = new Set([
  "completed",
  "blocked",
  "changed",
  "not_sure",
]);
const DASHBOARD_ACTION_FEEDBACK_BLOCKERS = new Set([
  "time",
  "partner_check",
  "missing_info",
  "other",
]);

function parseDashboardActionOutcomeFeedback(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const actionTitle = normalizeDashboardActionText(value.actionTitle, 120);
  const recordedAtMs = typeof value.recordedAt === "string"
    ? Date.parse(value.recordedAt)
    : Number.NaN;
  const validUntilMs = typeof value.validUntil === "string"
    ? Date.parse(value.validUntil)
    : Number.NaN;
  if (
    typeof value.outcomeId !== "string"
    || !DASHBOARD_UUID_PATTERN.test(value.outcomeId)
    || typeof value.actionId !== "string"
    || !DASHBOARD_ACTION_ID_PATTERN.test(value.actionId)
    || !actionTitle
    || !Number.isSafeInteger(value.sourceRevision)
    || value.sourceRevision < 1
    || !Number.isSafeInteger(value.actionRevision)
    || value.actionRevision < 1
    || !DASHBOARD_ACTION_FEEDBACK_OUTCOMES.has(value.outcome)
    || !Number.isFinite(recordedAtMs)
    || !Number.isFinite(validUntilMs)
    || validUntilMs <= recordedAtMs
  ) return null;

  if (value.outcome === "blocked") {
    if (
      value.actionStatus !== "open"
      || value.actionRevision !== value.sourceRevision
      || !DASHBOARD_ACTION_FEEDBACK_BLOCKERS.has(value.blockerCode)
    ) return null;
  } else if (
    value.blockerCode !== undefined
    || (value.outcome === "completed"
      ? value.actionStatus !== "done" || value.actionRevision <= value.sourceRevision
      : value.actionStatus !== "open" || value.actionRevision !== value.sourceRevision)
  ) return null;

  return Object.freeze({
    actionId: value.actionId,
    actionTitle,
    sourceRevision: value.sourceRevision,
    actionRevision: value.actionRevision,
    actionStatus: value.actionStatus,
    outcome: value.outcome,
    ...(value.blockerCode ? { blockerCode: value.blockerCode } : {}),
    recordedAt: value.recordedAt,
    validUntil: value.validUntil,
  });
}

function buildDashboardRecoveryCopy(feedback) {
  if (feedback.outcome === "changed") {
    return {
      ctaLabel: "바뀐 내용 다시 맞추기",
      description:
        "계획이 바뀌었다고 남겨주셨어요. 바뀐 사실 한 가지만 확인한 뒤 다음 행동을 다시 맞출게요.",
    };
  }
  if (feedback.outcome === "not_sure") {
    return {
      ctaLabel: "확인할 사실 하나 보기",
      description:
        "아직 모르겠다고 남겨주셨어요. 완료로 단정하지 않고 확인할 사실 한 가지부터 같이 볼게요.",
    };
  }
  switch (feedback.blockerCode) {
    case "time":
      return {
        ctaLabel: "지금 가능한 범위 정하기",
        description:
          "시간이 더 필요하다고 남겨주셨어요. 지금 가능한 범위를 줄이거나 새 시점을 정하는 한 가지부터 같이 볼게요.",
      };
    case "partner_check":
      return {
        ctaLabel: "질문 한 가지 정리하기",
        description:
          "두 사람이 먼저 확인해야 한다고 남겨주셨어요. 상대에게 물을 중립적인 질문 한 가지부터 정리해요.",
      };
    case "missing_info":
      return {
        ctaLabel: "확인할 사실 하나 찾기",
        description:
          "정보가 더 필요하다고 남겨주셨어요. 결정 전에 확인할 사실 한 가지부터 찾게 도와드릴게요.",
      };
    default:
      return {
        ctaLabel: "막힘부터 함께 풀기",
        description:
          "막힘이 있다고 남겨주셨어요. 이유를 길게 설명하지 않아도 지금 풀 수 있는 한 가지부터 정리해요.",
      };
  }
}

export function applyDashboardActionOutcomeFeedback({
  focus,
  openAction,
  feedback: rawFeedback,
}) {
  if (!focus || typeof focus !== "object" || Array.isArray(focus)) return focus;
  const feedback = parseDashboardActionOutcomeFeedback(rawFeedback);
  if (!feedback) return focus;

  if (feedback.outcome === "completed") {
    if (openAction?.id === feedback.actionId) return focus;
    return Object.freeze({
      ...focus,
      feedbackApplied: true,
      feedbackOutcome: feedback.outcome,
      feedbackNotice:
        `‘${feedback.actionTitle}’ 완료 기록을 반영해 다음 한 가지를 골랐어요.`,
    });
  }

  if (
    openAction?.id === feedback.actionId
    && (
      openAction.title !== feedback.actionTitle
      || openAction.sourceRevision !== feedback.actionRevision
    )
  ) return focus;

  if (
    focus.kind !== "action"
    || !openAction
    || openAction.id !== feedback.actionId
  ) {
    return Object.freeze({
      ...focus,
      feedbackApplied: true,
      feedbackOutcome: feedback.outcome,
      feedbackNotice:
        `‘${feedback.actionTitle}’에 남긴 결과를 기록했고, 현재 준비에서 다음 한 가지를 골랐어요.`,
    });
  }

  const recovery = buildDashboardRecoveryCopy(feedback);
  return Object.freeze({
    ...focus,
    eyebrow: "방금 기록 반영",
    description: recovery.description,
    selectionReason: recovery.description,
    ctaLabel: recovery.ctaLabel,
    route: "/(tabs)/chat",
    claimBeforeCare: false,
    suppressActionFollowUpClaim: true,
    feedbackApplied: true,
    feedbackOutcome: feedback.outcome,
    feedbackNotice: "방금 남긴 결과를 반영해 도움 방식을 바꿨어요.",
  });
}

const DASHBOARD_RECOMMENDATION_SOURCES = Object.freeze({
  setup: "현재 커플 연결과 결혼식 날짜 설정 상태",
  urgent: "예식일과 체크리스트의 기본 확인 시점",
  today: "오늘로 저장된 일정",
  booking: "직접 저장한 업체 진행 기록",
  action: "직접 확인해 저장한 공동 준비 행동과 마감·중요도",
  next: "예식일과 체크리스트 진행 상태",
  calm: "예식일과 현재 준비 기록",
});

function recommendationContextRow(label, detail, scope) {
  return Object.freeze({ label, detail, scope });
}

function recommendationContextDetail(value, effect) {
  if (typeof value !== "string" || !value.trim()) return null;
  return `${value.trim()}. ${effect}`;
}

export function buildDashboardRecommendationDisclosure({
  focus,
  personalizationLabel,
  coreCriterionLabel,
  coupleCriterionLabel,
  coreCriterionLoaded,
  coupleCriterionLoaded,
}) {
  const focusKind = typeof focus?.kind === "string" ? focus.kind : "calm";
  const priorityReason = typeof focus?.description === "string"
    && focus.description.trim().length > 0
    ? focus.description
    : "현재 저장된 준비 기록을 기준으로 한 가지를 골랐어요.";
  const feedbackRows = focus.feedbackApplied !== true
    ? []
    : focus.feedbackOutcome === "completed"
      ? [
          recommendationContextRow(
            "완료 결과 영수증",
            "내가 남긴 완료 결과의 상세 영수증은 나만 볼 수 있어요.",
            "나만 보기",
          ),
          recommendationContextRow(
            "공동 행동 완료 상태",
            "확인한 완료 상태는 커플 준비 기록에 반영됐어요.",
            "커플 공유",
          ),
        ]
      : [recommendationContextRow(
          "방금 남긴 행동 결과",
          "이 제안과 도움 방식을 맞추는 데만 반영했어요. 나만 볼 수 있는 결과예요.",
          "나만 보기",
        )];
  const contextRows = [
    ...feedbackRows,
    recommendationContextRow(
      "내 답변 방식",
      recommendationContextDetail(
        personalizationLabel,
        "홈의 준비 순서는 바꾸지 않고, 아모라와 이어볼 때 답변의 시작·분량·도움 순서에 반영해요.",
      )
        ?? "관리 화면에서 확인하거나 바꿀 수 있어요.",
      "나만 보기",
    ),
    recommendationContextRow(
      "내 기준",
      recommendationContextDetail(
        coreCriterionLabel,
        "홈의 마감·일정 순서는 바꾸지 않고, 아모라와 이어볼 때 관련 있는 후보가 비슷할 때만 나의 판단 기준으로 참고해요.",
      )
        ?? (coreCriterionLoaded
          ? "저장된 내 기준은 없어요. 원할 때 직접 적을 수 있어요."
          : "현재 내 기준을 확인하지 못했어요. 관리 화면에서 다시 확인할 수 있어요."),
      "나만 보기",
    ),
    recommendationContextRow(
      "우리 기준",
      recommendationContextDetail(
        coupleCriterionLabel,
        "홈의 마감·일정 순서는 바꾸지 않고, 아모라와 이어볼 때 관련 있는 후보가 비슷할 때만 두 사람이 확인한 판단 기준으로 참고해요.",
      )
        ?? (coupleCriterionLoaded
          ? "두 사람이 확인해 확정한 우리 기준은 없어요."
          : "현재 우리 기준을 확인하지 못했어요. 관리 화면에서 다시 확인할 수 있어요."),
      "커플 공유",
    ),
  ];

  return Object.freeze({
    prioritySource:
      DASHBOARD_RECOMMENDATION_SOURCES[focusKind]
      ?? DASHBOARD_RECOMMENDATION_SOURCES.calm,
    priorityReason,
    contextRows: Object.freeze(contextRows),
    memoryNotice:
      "대화 기억은 이 홈 제안의 우선순위를 정하는 데 사용하지 않았어요. 대화 안에서만 허용한 범위로 참고해요.",
  });
}

export const HOME_SERVICES = Object.freeze([
  {
    key: "checklist",
    title: "체크리스트",
    description: "준비 항목",
    route: "/checklist",
  },
  {
    key: "schedule",
    title: "일정",
    description: "오늘 할 일",
    route: "/schedule",
  },
  {
    key: "budget",
    title: "예산",
    description: "지출과 분담",
    route: "/budget",
  },
  {
    key: "prices",
    title: "공시가·위약금",
    description: "업체 원문",
    route: "/market-prices",
  },
  {
    key: "quote",
    title: "견적 체크",
    description: "계약 전 질문",
    route: "/quote-check",
  },
  {
    key: "bookings",
    title: "상담 요청 기록",
    description: "아모라 내부 후보",
    route: "/bookings",
  },
  {
    key: "community",
    title: "커뮤니티",
    description: "같은 시기 커플",
    route: "/(tabs)/community",
  },
]);

const COUPLE_BOUND_SERVICE_KEYS = new Set(["checklist", "schedule", "budget"]);

export function resolveDashboardServiceRoute(service, hasCouple) {
  if (!hasCouple && COUPLE_BOUND_SERVICE_KEYS.has(service?.key)) {
    return "/onboarding";
  }
  return service?.route;
}

export function formatLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function calculateChecklistProgress(progress, categories) {
  if (!Array.isArray(categories) || categories.length === 0) return 0;

  let done = 0;
  let total = 0;
  for (const category of categories) {
    const categoryProgress = progress?.[category.key];
    if (categoryProgress?.status === "not_applicable") continue;
    const doneById = new Map();

    const items = Array.isArray(category.items) ? category.items : [];
    for (const item of items) {
      if (item && typeof item.id === "string") doneById.set(item.id, false);
    }

    if (
      categoryProgress
      && typeof categoryProgress === "object"
      && Array.isArray(categoryProgress.checklist)
    ) {
      for (const item of categoryProgress.checklist) {
        if (item && typeof item.id === "string" && !doneById.has(`saved:${item.id}`)) {
          doneById.set(item.id, item.done === true);
          doneById.set(`saved:${item.id}`, true);
        }
      }
    } else if (categoryProgress && typeof categoryProgress === "object") {
      for (const [key, value] of Object.entries(categoryProgress)) {
        if (typeof value === "boolean") {
          doneById.set(key, value);
        }
      }
    }

    for (const key of [...doneById.keys()]) {
      if (key.startsWith("saved:")) doneById.delete(key);
    }
    done += [...doneById.values()].filter(Boolean).length;
    total += doneById.size;
  }

  return total > 0 ? Math.round((done / total) * 100) : 0;
}

function buildDashboardActionFocus(openAction, todayYmd) {
  const route = openAction.source === "budget"
    ? "/budget"
    : openAction.source === "schedule"
      ? "/schedule"
      : openAction.categoryKey
        ? "/checklist"
        : "/(tabs)/chat";
  const ctaLabel = route === "/budget"
    ? "예산에서 이어서 보기"
    : route === "/schedule"
      ? "일정에서 이어서 보기"
      : route === "/checklist"
        ? "관련 체크리스트 보기"
        : "아모라와 이어서 보기";
  const dueDateCopy = formatDashboardDueDate(openAction.dueDate);
  const whyNowCopy = getDashboardActionWhyNow(openAction, todayYmd);
  const actionCopy = openAction.description
    ? `${openAction.description} 공동 준비 기록에 저장된 다음 행동이에요.`
    : "공동 준비 기록에 저장된 다음 행동이에요. 하나씩 이어가면 충분해요.";
  const claimBeforeCare = Boolean(
    openAction.dueDate
    && isValidDashboardYmd(todayYmd)
    && openAction.dueDate <= addDashboardDays(todayYmd, DASHBOARD_ACTION_DUE_SOON_DAYS),
  );
  return {
    kind: "action",
    eyebrow: "저장해 둔 다음 행동",
    title: openAction.title,
    description: [dueDateCopy, whyNowCopy, actionCopy].filter(Boolean).join(" "),
    selectionReason: whyNowCopy,
    claimBeforeCare,
    ctaLabel,
    route,
    ...(openAction.categoryKey ? { categoryKey: openAction.categoryKey } : {}),
  };
}

function isConfirmedActionDueBy(openAction, todayYmd, days) {
  return Boolean(
    openAction?.dueDate
    && isValidDashboardYmd(todayYmd)
    && openAction.dueDate <= addDashboardDays(todayYmd, days),
  );
}

export function buildDashboardFocus({
  hasCouple,
  weddingDate,
  todayTasks,
  urgentTasks,
  bookingOutcomeTasks,
  openAction = null,
  receiptActionId = null,
  todayYmd = formatLocalDateKey(),
}) {
  if (!hasCouple) {
    return {
      kind: "setup",
      eyebrow: "첫 번째 준비",
      title: "두 사람의 준비 공간부터 만들어요",
      description:
        "기본 설정을 마치면 저장된 준비 기록을 바탕으로 다음 한 가지를 함께 정할 수 있어요.",
      ctaLabel: "기본 설정 계속하기",
      route: "/onboarding",
    };
  }

  if (openAction && receiptActionId === openAction.id) {
    return {
      ...buildDashboardActionFocus(openAction, todayYmd),
      eyebrow: "방금 저장한 행동",
      claimBeforeCare: true,
    };
  }

  if (!weddingDate && !openAction) {
    return {
      kind: "setup",
      eyebrow: "첫 번째 준비",
      title: "지금 준비 상태부터 함께 확인해요",
      description:
        "정해진 게 없어도 괜찮아요. 저장된 기록에서 이미 한 준비와 아직 모르는 것을 나누고, 지금 할 한 가지만 정해요.",
      ctaLabel: "내 준비 상태 확인하기",
      route: "/(tabs)/chat",
      alternateAction: {
        label: "날짜만 바로 설정",
        route: "/settings",
        settingsFocus: "weddingDate",
      },
    };
  }

  if (openAction && isConfirmedActionDueBy(openAction, todayYmd, 0)) {
    return buildDashboardActionFocus(openAction, todayYmd);
  }

  const todayTask = todayTasks[0];
  if (todayTask) {
    const remainingCount = Math.max(0, todayTasks.length - 1);
    return {
      kind: "today",
      eyebrow: "오늘, 이것부터",
      title: todayTask.title,
      description:
        remainingCount > 0
          ? `오늘 저장한 할 일이 ${remainingCount}개 더 있어요. 하나씩 마치면 충분해요.`
          : "오늘 일정에 저장한 항목이에요. 하나를 끝내고 가볍게 다음으로 넘어가요.",
      ctaLabel: "오늘 일정 보기",
      route: "/schedule",
    };
  }

  const booking = bookingOutcomeTasks[0];
  if (booking) {
    return {
      kind: "booking",
      eyebrow: "다녀온 뒤 기록",
      title: `${booking.vendorName} 결과를 남겨주세요`,
      description:
        "실제 진행 여부를 직접 확인한 뒤, 사용자가 입력한 기록 지출과 만족도를 남겨보세요. 이 입력값은 결제 증빙이 아니에요.",
      ctaLabel: "결과 기록하기",
      route: "/bookings",
      bookingId: booking.id,
    };
  }

  if (
    openAction
    && (
      openAction.priority === "high"
      || isConfirmedActionDueBy(openAction, todayYmd, DASHBOARD_ACTION_DUE_SOON_DAYS)
    )
  ) {
    return buildDashboardActionFocus(openAction, todayYmd);
  }

  const urgent = urgentTasks.find(
    (task) => task.urgency === "overdue" || task.urgency === "soon",
  );
  if (urgent) {
    const description =
      urgent.urgency === "overdue"
        ? `기본 확인 시점에서 ${pluralDay(urgent.remainingDays)} 지났어요. 실제 계약·업체 일정이 우선이에요.`
        : urgent.remainingDays === 0
          ? "오늘이 기본 확인 시점이에요. 실제 계약·업체 일정이 우선이에요."
          : `기본 확인 시점까지 ${pluralDay(urgent.remainingDays)} 남았어요. 실제 계약·업체 일정이 우선이에요.`;

    return {
      kind: "urgent",
      eyebrow: "오늘, 이것부터",
      title: `${urgent.categoryLabel} 준비를 먼저 확인해요`,
      description,
      ctaLabel: "체크리스트 열기",
      route: "/checklist",
    };
  }

  if (openAction) {
    return buildDashboardActionFocus(openAction, todayYmd);
  }

  const nextTask = urgentTasks[0];
  if (nextTask) {
    return {
      kind: "next",
      eyebrow: "다음 준비",
      title: `${nextTask.categoryLabel}을 천천히 시작해요`,
      description:
        "아직 여유가 있어요. 체크리스트를 보고 두 사람에게 맞는 순서로 준비해요.",
      ctaLabel: "준비 순서 보기",
      route: "/checklist",
    };
  }

  return {
    kind: "calm",
    eyebrow: "저장된 일정 확인",
    title: "현재 저장된 일정 기준, 오늘 확인 항목이 없어요",
    description:
      "등록하지 않은 업체·가족 일정은 포함되지 않아요. 필요하면 아모라와 다음 준비를 정리해 보세요.",
    ctaLabel: "아모라와 계획하기",
    route: "/(tabs)/chat",
  };
}

const FOCUS_EVIDENCE_LABELS = Object.freeze({
  setup: "현재 저장된 프로필 기준",
  urgent: "저장된 결혼식 날짜와 체크리스트 기준",
  today: "오늘로 저장된 일정 기준",
  booking: "저장된 상담 요청 기록과 날짜 기준",
  action: "공동 준비 기록에 저장된 아모라 행동 기준",
  next: "저장된 결혼식 날짜와 체크리스트 기준",
  calm: "현재 저장된 일정과 체크리스트 기준",
});

export function buildCompanionHomeBrief({
  focus,
  partnerActivity,
  personalization = null,
  ownerUserId = null,
  coupleCriterionLoaded = false,
  coupleCriterion = null,
  coreCriterionLoaded = false,
  coreCriterion = null,
}) {
  const recentCategories = Array.isArray(partnerActivity?.recentCategories)
    ? partnerActivity.recentCategories
        .filter((category) => typeof category === "string" && category.trim())
        .slice(0, 2)
    : [];
  const partnerName =
    typeof partnerActivity?.partnerName === "string"
      ? partnerActivity.partnerName.trim()
      : "";
  const chatIntent = focus.kind === "setup" || focus.kind === "calm"
    ? "intake"
    : "focus";
  const personalizedHome = buildAmoraHomePersonalization(
    personalization,
    chatIntent,
  );
  const coreCriterionValue = normalizeAmoraCoreCriterionText(coreCriterion?.value);
  const coupleCriterionView = coupleCriterion && ownerUserId
    ? getAmoraCoupleCriterionView(coupleCriterion, ownerUserId)
    : null;
  const coupleCriterionValue = normalizeAmoraCoreCriterionText(
    coupleCriterionView?.currentValue,
  );
  const criterionAction = chatIntent !== "intake"
    ? null
    : coupleCriterionLoaded === true && coupleCriterionView?.status === "review_required"
      ? Object.freeze({
          label: "우리 기준 확인하기",
          route: "/settings/amora-style",
        })
      : coupleCriterionLoaded === true && coupleCriterionView?.status === "waiting_partner"
        ? Object.freeze({
            label: "파트너 확인 대기 보기",
            route: "/settings/amora-style",
          })
        : coupleCriterionLoaded === true && coupleCriterionView?.status === "empty"
          ? Object.freeze({
              label: "우리 기준 함께 정하기",
              route: "/settings/amora-style",
            })
          : coreCriterionLoaded === true && !coreCriterionValue
            ? Object.freeze({
                label: "내 기준 하나 알려주기",
                route: "/settings/amora-style",
              })
            : null;

  return {
    identityLabel: "AI 결혼 준비 동반자",
    eyebrow: "지금 같이 볼 준비",
    priorityTitle: focus.title,
    whyNow: focus.description,
    evidenceLabel:
      FOCUS_EVIDENCE_LABELS[focus.kind] ?? "현재 저장된 준비 기록 기준",
    continuity:
      partnerName && recentCategories.length > 0
        ? `최근 저장된 기록에 ${partnerName}님의 ${recentCategories.join(", ")} 업데이트가 있어요.`
        : null,
    personalizationLabel: personalizedHome?.label ?? null,
    coupleCriterion: coupleCriterionValue,
    coupleCriterionLabel: coupleCriterionValue
      ? `우리 기준: ${coupleCriterionValue}`
      : null,
    coreCriterion: coreCriterionValue,
    coreCriterionLabel: coreCriterionValue
      ? `내 기준: ${coreCriterionValue}`
      : null,
    criterionAction,
    primaryActionLabel: focus.ctaLabel,
    chatActionLabel: coupleCriterionValue
      ? (chatIntent === "intake"
          ? "우리 기준으로 다음 한 가지"
          : "우리 기준으로 이어보기")
      : personalizedHome?.chatActionLabel
        ?? (chatIntent === "intake" ? "뭐부터 할지 같이 정하기" : "아모라와 이어보기"),
    chatIntent,
  };
}

export function getWeddingMomentMessage(dday) {
  if (dday === null) {
    return "두 사람만의 결혼 준비, 오늘부터 함께 시작해요";
  }
  if (dday === 0) {
    return "오늘, 두 사람의 결혼을 진심으로 축하해요";
  }
  if (dday < 0) {
    return "함께 만든 그날 이후의 이야기까지 이어가요";
  }
  return "두 사람이 고른 날까지, 오늘도 한 걸음 가까워졌어요";
}
