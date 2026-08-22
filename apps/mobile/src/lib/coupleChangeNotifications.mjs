// 파트너가 무엇을 바꿨는지 모바일에서 보여주기 위한 순수 로직.
//
// 서버(`couple_change_notifications`)와 `/api/notifications` 는 이미 있었고 웹은
// 상단 패널로 보여준다. 그런데 **소비자의 주 제품인 모바일에는 호출자가 하나도
// 없었다** — 상대가 총예산을 바꿔도 앱을 열어 숫자를 직접 보지 않는 한 알 수 없었다.
//
// 문구는 서버가 소유한다(`title`·`message`). 여기서 지어내지 않는다.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * `couple_change_notifications_event_kind_check` 의 **현재** 집합(7종).
 * 모르는 종류는 버린다 — 뜻을 모르는 것을 보여줄 수는 없다.
 *
 * 첫 판은 처음 만들어진 4종 + approval_pending 만 알고 있었다. 그 결과
 * `change_rejected`("계획 변경 요청을 반영하지 않았어요") 행이 파서에서 통째로
 * 버려져, **파트너가 변경을 거절하면 모바일은 아무 말도 하지 않았다.**
 * 마이그레이션이 종류를 늘리면 여기도 같이 늘려야 한다.
 */
const EVENT_KINDS = new Set([
  "approval_requested",
  "approval_pending",
  "approval_ready",
  "approval_withdrawn",
  "change_applied",
  "change_rejected",
  "change_stale",
]);

/** DB CHECK 와 같은 집합. */
const HREFS = new Set([
  "/chat",
  "/budget",
  "/schedule",
  "/dashboard",
  "/settings",
  "/lounge",
]);

/**
 * 웹 경로 → 모바일 경로.
 *
 * `/dashboard` 와 `/lounge` 는 같은 화면이다 — 2026-08-19 파운더 결정으로 이름이
 * "웨딩 라운지"로 합쳐졌고, 모바일 탭 경로는 `/(tabs)/lounge` 다.
 */
const NATIVE_ROUTES = {
  "/chat": "/(tabs)/chat",
  "/budget": "/budget",
  "/schedule": "/schedule",
  "/dashboard": "/(tabs)/lounge",
  "/settings": "/settings",
  "/lounge": "/(tabs)/lounge",
};

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isBoundedText(value, maxLength) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maxLength;
}

function isIsoTimestamp(value) {
  return typeof value === "string"
    && value.length <= 40
    && /^\d{4}-\d{2}-\d{2}T/.test(value)
    && Number.isFinite(Date.parse(value));
}

/**
 * 알림 한 줄. 경계에서 검증한다 — 서버가 보낸 것이라도 화면에 바로 꽂지 않는다.
 * 한 줄이 깨졌다고 나머지를 못 보여주면 안 되므로, 깨진 줄만 버린다.
 */
function parseNotification(value) {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string" || !UUID_RE.test(value.id)) return null;
  if (typeof value.event_kind !== "string" || !EVENT_KINDS.has(value.event_kind)) {
    return null;
  }
  if (!isBoundedText(value.tool_name, 80)) return null;
  if (!isBoundedText(value.title, 120)) return null;
  if (!isBoundedText(value.message, 240)) return null;
  if (typeof value.href !== "string" || !HREFS.has(value.href)) return null;
  if (!isIsoTimestamp(value.created_at)) return null;
  if (!(value.read_at === null || isIsoTimestamp(value.read_at))) return null;
  if (!(value.action_id === undefined
    || value.action_id === null
    || (typeof value.action_id === "string" && UUID_RE.test(value.action_id)))) {
    return null;
  }
  return {
    id: value.id,
    eventKind: value.event_kind,
    toolName: value.tool_name,
    title: value.title,
    message: value.message,
    href: value.href,
    createdAt: value.created_at,
    readAt: value.read_at,
  };
}

/** `/api/notifications` 응답 봉투. */
export function parseCoupleChangeNotifications(value) {
  if (!isRecord(value)) return null;
  if (!Array.isArray(value.notifications)) return null;
  if (!(value.ownerId === null
    || (typeof value.ownerId === "string" && UUID_RE.test(value.ownerId)))) {
    return null;
  }
  const rows = [];
  for (const row of value.notifications) {
    const parsed = parseNotification(row);
    if (parsed) rows.push(parsed);
  }
  return { ownerId: value.ownerId, notifications: rows };
}

export function getCoupleChangeNativeRoute(href) {
  return typeof href === "string" && Object.prototype.hasOwnProperty.call(NATIVE_ROUTES, href)
    ? NATIVE_ROUTES[href]
    : null;
}

/**
 * 화면에 보여줄 안 읽은 알림.
 *
 * 상단에 얹는 자리라 길면 화면을 잡아먹는다. 최신 것부터 `limit` 개만 보여주고
 * 나머지는 개수로만 알린다. 정렬은 서버 순서를 믿지 않고 여기서 다시 한다 —
 * 실시간으로 새 줄이 끼어들 수 있다.
 */
/**
 * 보는 사람의 것이 맞을 때만 고른다.
 *
 * 서버는 봉투에 `ownerId` 를 실어 보내고 **웹은 그것을 세션 사용자와 대조한다**
 * (`useNotifications`, 회귀 테스트로 고정). 모바일만 그 대조가 비어 있었다.
 * 세션 신원 검사(요청 시점 Bearer 소유자·응답 후 재확인)는 "누구로 물었나"를 보고,
 * 이것은 "누구의 답인가"를 본다. 둘은 다른 질문이다.
 *
 * 데모 세션은 `ownerId: null` 과 빈 목록을 돌려준다 — 일치로 치지 않고 조용히 비운다.
 */
export function selectCoupleChangesForViewer(envelope, viewerUserId, limit = 3) {
  const empty = { visible: [], unreadCount: 0, hiddenCount: 0 };
  if (!isRecord(envelope) || !Array.isArray(envelope.notifications)) return empty;
  if (typeof viewerUserId !== "string" || !UUID_RE.test(viewerUserId)) return empty;
  if (typeof envelope.ownerId !== "string") return empty;
  // 저장소 관례대로 대소문자를 무시하고 견준다.
  if (envelope.ownerId.toLowerCase() !== viewerUserId.toLowerCase()) return empty;
  return selectUnreadCoupleChanges(envelope.notifications, limit);
}

export function selectUnreadCoupleChanges(notifications, limit = 3) {
  if (!Array.isArray(notifications)) return { visible: [], unreadCount: 0, hiddenCount: 0 };
  const unread = notifications
    .filter((row) => isRecord(row) && row.readAt === null)
    .slice()
    .sort((left, right) => {
      const byTime = String(right.createdAt).localeCompare(String(left.createdAt));
      return byTime !== 0 ? byTime : String(right.id).localeCompare(String(left.id));
    });
  const bounded = Number.isSafeInteger(limit) && limit > 0 ? limit : 3;
  return {
    visible: unread.slice(0, bounded),
    unreadCount: unread.length,
    hiddenCount: Math.max(0, unread.length - bounded),
  };
}

/**
 * 아직 **내가** 눌러야 끝나는 줄인가.
 *
 * `approval_*` 를 한 덩어리로 묶으면 안 된다. 서버가 각 종류에 붙이는 문구가
 * 정본이고, 셋의 뜻이 서로 다르다:
 *
 *     approval_requested  "함께 확인할 변경이 있어요"            ← 내가 확인해야 한다
 *     approval_pending    "파트너 확인을 기다리는 계획 변경이에요"  ← 상대를 기다리는 중
 *     approval_ready      "두 사람의 확인이 끝났어요"             ← 확인은 이미 끝났다
 *     approval_withdrawn  "공동 확인이 철회됐어요"
 *     change_applied      "함께 쓰는 정보가 변경됐어요"
 *
 * 첫 판은 셋을 다 "확인 필요"로 표시했다. `approval_ready` 옆에 "확인 필요"가
 * 붙으면 **서버가 방금 한 말과 정면으로 어긋난다.**
 */
export function isAwaitingMyApproval(notification) {
  return isRecord(notification)
    && notification.eventKind === "approval_requested";
}

/**
 * 이 줄을 눌러 **다른 화면으로 갈 수 있는가.**
 *
 * `/dashboard`·`/lounge` 알림은 지금 보고 있는 라운지를 가리킨다. 눌러도 화면은
 * 그대로인데 읽음 처리만 되면 그 줄은 아무 일도 없이 사라진다. 특히 모바일에는
 * 계획 변경 승인 화면이 따로 없어서, 승인 대기 줄이 그렇게 없어지면 확인할 방법이
 * 사라진다. 그런 줄은 눌리지 않게 두고 "모두 읽음"으로만 지운다.
 */
export function canOpenCoupleChange(notification) {
  if (!isRecord(notification)) return false;
  const route = getCoupleChangeNativeRoute(notification.href);
  return route !== null && route !== "/(tabs)/lounge";
}

/** 읽음 처리 요청 본문. 서버는 `{ids}` 또는 `{all:true}` 만 받는다. */
export function buildMarkReadBody(ids) {
  if (ids === "all") return { all: true };
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 50) return null;
  const unique = [...new Set(ids)];
  return unique.every((id) => typeof id === "string" && UUID_RE.test(id))
    ? { ids: unique }
    : null;
}
