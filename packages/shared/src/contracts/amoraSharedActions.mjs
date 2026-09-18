/**
 * 공유 할 일(`/api/amora/actions`) 을 앱이 웹과 같은 규칙으로 읽고 쓰는 계약.
 *
 * ## 왜 공용 모듈인가
 *
 * 웹 보드(`AmoraDecisionBoard`)와 훅(`useAmoraPreparationActions`)은 출시 점검을 통과한
 * 코드라 손대지 않는다. 앱이 같은 동작을 하려면 **같은 말과 같은 정규화**가 필요한데,
 * 웹 쪽 정본은 Next 경로(`@/utils/requestValidation`) 안에 있어 앱이 가져올 수 없다.
 * 그래서 이 파일은 앱만 쓰고, 웹에는 둘이 같은지 재는 테스트만 둔다
 * (`apps/web/src/lib/amora/__tests__/sharedActionsParity.test.ts`).
 *
 * ## 지키는 것
 *
 * - id 는 서버 수정 경로(`/api/amora/actions/[id]` 의 `SAFE_ACTION_ID_RE`)와 같은 모양만
 *   받는다. **자르지 않고 거부한다** — 잘린 id 로 PATCH 를 보내면 다른 항목을 고치거나
 *   없는 항목을 고친다.
 * - 예정일은 사용자가 쓴 글 그대로다("다음 주 중"). 날짜 모양이어도 확정 날짜로 바꾸지
 *   않는다(DESIGN.md: planned time remains user text).
 * - 저장 성공은 서버 영수증이 보낸 값과 **서버가 정규화했을 값**이 같을 때만이다.
 *   서버는 줄바꿈까지 한 칸으로 합치므로 앞뒤 공백만 지운 값과 비교하면 여러 줄 설명이
 *   저장됐는데도 실패로 읽힌다.
 */

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

export const SHARED_ACTION_ID_PATTERN = /^[A-Za-z0-9_-]{4,120}$/;
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COUPLE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const SHARED_ACTION_TITLE_MAX = 120;
export const SHARED_ACTION_DESCRIPTION_MAX = 500;
export const SHARED_ACTION_DUE_MAX = 40;
const CATEGORY_KEY_MAX = 80;
const HREF_MAX = 180;

const STATUSES = ['open', 'done', 'dismissed'];
const PRIORITIES = ['high', 'medium', 'low'];

/** 웹 `PREPARATION_COLUMNS` 의 이름과 설명. 순서도 같다. */
export const SHARED_ACTION_STATUS_COLUMNS = Object.freeze([
  Object.freeze({ status: 'done', label: '완료', rule: '완료로 표시한 할 일이에요.' }),
  Object.freeze({ status: 'open', label: '진행 중', rule: '아직 완료하지 않은 할 일이에요. 준비가 끝나면 완료로 표시해 주세요.' }),
  Object.freeze({ status: 'dismissed', label: '보류·숨김', rule: '숨겨 둔 할 일이에요. 필요할 때 다시 진행 중으로 옮길 수 있어요.' }),
]);

/** 상태를 바꾼 뒤 읽어 주는 말. 웹 보드와 같다. */
export const SHARED_ACTION_STATUS_ANNOUNCEMENTS = Object.freeze({
  done: '완료로 표시했어요.',
  dismissed: '보류·숨김으로 옮겼어요.',
  open: '진행 중으로 다시 꺼냈어요.',
});

/** 웹 `PREPARATION_SOURCES`. */
export const SHARED_ACTION_SOURCE_LABELS = Object.freeze({
  chat: '대화에서 추가된 할 일',
  quote: '견적 확인에서 추가된 할 일',
  schedule: '일정에서 추가된 할 일',
  budget: '예산에서 추가된 할 일',
  guardrail: '준비 점검에서 추가된 할 일',
  manual: '직접 추가한 할 일',
});

/** 모르는 출처에는 이름을 붙이지 않는다(빈 문자열). */
export function sharedActionSourceLabel(source) {
  return typeof source === 'string' && hasOwn(SHARED_ACTION_SOURCE_LABELS, source) ? SHARED_ACTION_SOURCE_LABELS[source] : '';
}

export const isSharedActionId = (value) => typeof value === 'string' && SHARED_ACTION_ID_PATTERN.test(value);

// ── 서버 정규화의 이식 ────────────────────────────────────────────────
// 정본: apps/web/src/utils/sanitize.ts (stripDangerousBlocks · sanitizeText)
//       apps/web/src/utils/requestValidation.ts (cleanOptionalText)
function stripDangerousBlocks(input) {
  return input
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\s*(script|style|iframe|object|embed|form|input)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|style|iframe|object|embed|form|input)\b[^>]*\/?>/gi, '');
}

function sanitizeText(dirty) {
  return stripDangerousBlocks(dirty ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 서버 `cleanOptionalText(raw, max)` 와 같은 값. 비면 `null`. */
export function normalizeLikeServer(raw, maxLength) {
  if (typeof raw !== 'string') return null;
  const value = sanitizeText(raw).slice(0, maxLength).trim();
  return value.length > 0 ? value : null;
}

// ── 항목 해석 ─────────────────────────────────────────────────────────

function boundedText(value, max) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function categoryKeyOf(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed.length > CATEGORY_KEY_MAX ? '' : trimmed;
}

function hrefOf(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed.startsWith('/') && trimmed.length <= HREF_MAX ? trimmed : '';
}

/**
 * `/api/amora/actions` 항목 하나를 화면이 그릴 모양으로. 읽을 수 없으면 `null`.
 *
 * 제목이 없거나 상태를 모르면 버린다 — 무엇을 바꾸는지 모르는 줄에 상태 버튼을 주면
 * 확인하지 않은 변경이 된다.
 */
export function parseSharedAction(entry) {
  if (!object(entry) || !isSharedActionId(entry.id) || typeof entry.title !== 'string') return null;
  const title = boundedText(entry.title, SHARED_ACTION_TITLE_MAX);
  if (!title || !STATUSES.includes(entry.status)) return null;
  return {
    id: entry.id,
    title,
    description: boundedText(entry.description, SHARED_ACTION_DESCRIPTION_MAX),
    dueDate: boundedText(entry.dueDate, SHARED_ACTION_DUE_MAX),
    categoryKey: categoryKeyOf(entry.categoryKey),
    source: typeof entry.source === 'string' && hasOwn(SHARED_ACTION_SOURCE_LABELS, entry.source) ? entry.source : null,
    href: hrefOf(entry.href),
    status: entry.status,
    priority: PRIORITIES.includes(entry.priority) ? entry.priority : 'medium',
    updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : '',
  };
}

/** 응답의 `actions` 에서 읽을 수 있는 항목만 순서대로. 호출자는 개수를 비교해 잘못된 응답을 가린다. */
export function parseSharedActionList(payload) {
  const raw = object(payload) ? payload.actions : null;
  if (!Array.isArray(raw)) return [];
  const parsed = [];
  for (const entry of raw) {
    const action = parseSharedAction(entry);
    if (action) parsed.push(action);
  }
  return parsed;
}

// ── 직접 추가 ─────────────────────────────────────────────────────────

const optionalString = (value) => (value === undefined || value === null ? '' : typeof value === 'string' ? value : null);

/**
 * 웹 `useAmoraPreparationActions.create` 와 같은 몸통. 비운 칸은 보내지 않는다.
 * 같은 필드로 다시 보낼 때는 **이 결과를 다시 만들지 말고 처음 몸통을 그대로** 보낸다.
 */
export function buildManualCreateBody(fields, scope) {
  if (!object(fields) || !object(scope) || typeof fields.title !== 'string') return null;
  const title = fields.title.trim();
  const categoryKey = optionalString(fields.categoryKey);
  const description = optionalString(fields.description);
  const dueDate = optionalString(fields.dueDate);
  if (!title || title.length > SHARED_ACTION_TITLE_MAX || !normalizeLikeServer(title, SHARED_ACTION_TITLE_MAX)
    || categoryKey === null || categoryKey.length > CATEGORY_KEY_MAX
    || description === null || description.length > SHARED_ACTION_DESCRIPTION_MAX
    || dueDate === null || dueDate.length > SHARED_ACTION_DUE_MAX) return null;
  if (typeof scope.requestId !== 'string' || !REQUEST_ID.test(scope.requestId)
    || typeof scope.expectedOwnerId !== 'string' || !scope.expectedOwnerId
    || typeof scope.expectedCoupleId !== 'string' || !COUPLE_ID.test(scope.expectedCoupleId)) return null;
  return {
    title,
    ...(categoryKey ? { category_key: categoryKey } : {}),
    ...(description ? { description } : {}),
    ...(dueDate ? { due_date: dueDate } : {}),
    status: 'open', priority: 'medium', source: 'manual',
    requestId: scope.requestId.toLowerCase(),
    expectedOwnerId: scope.expectedOwnerId,
    expectedCoupleId: scope.expectedCoupleId,
  };
}

const sameStoredText = (raw, sent, max) => optionalString(raw) === (normalizeLikeServer(sent, max) ?? '');

/**
 * 생성 영수증이 **보낸 그 몸통**을 저장한 결과인지. 맞으면 해석한 항목, 아니면 `null`.
 * `replayed: true`(같은 요청번호의 재전송)도 성공이다.
 */
export function matchesManualCreateReceipt(payload, body) {
  if (!object(payload) || !object(body) || typeof body.requestId !== 'string'
    || payload.requestId !== body.requestId || typeof payload.replayed !== 'boolean' || !object(payload.action)) return null;
  const raw = payload.action;
  const action = parseSharedAction(raw);
  if (!action || raw.title !== normalizeLikeServer(body.title, SHARED_ACTION_TITLE_MAX)
    || !sameStoredText(raw.description, body.description, SHARED_ACTION_DESCRIPTION_MAX)
    || !sameStoredText(raw.dueDate, body.due_date, SHARED_ACTION_DUE_MAX)
    || !sameStoredText(raw.categoryKey, body.category_key, CATEGORY_KEY_MAX)
    || raw.source !== 'manual' || raw.status !== 'open' || raw.priority !== 'medium'
    || raw.href !== undefined) return null;
  return action;
}

// ── 수정 ──────────────────────────────────────────────────────────────

/**
 * 수정 화면의 초안에서 **바뀐 칸만** 담은 PATCH 몸통. 비운 칸은 `""` 로 보낸다.
 * 보낼 수 없는 초안(빈 제목·길이 초과)은 `null`, 바뀐 것이 없으면 `{}`.
 */
export function buildActionUpdateDiff(original, draft) {
  if (!object(original) || !object(draft)) return null;
  const title = typeof draft.title === 'string' ? draft.title.trim() : '';
  const categoryKey = optionalString(draft.categoryKey);
  const description = optionalString(draft.description);
  const dueDate = optionalString(draft.dueDate);
  if (!title || title.length > SHARED_ACTION_TITLE_MAX || !normalizeLikeServer(title, SHARED_ACTION_TITLE_MAX)
    || categoryKey === null || description === null || dueDate === null) return null;
  const updates = {};
  if (title !== original.title) updates.title = title;
  if (categoryKey !== (original.categoryKey ?? '')) {
    if (categoryKey.length > CATEGORY_KEY_MAX) return null;
    updates.category_key = categoryKey;
  }
  if (description !== (original.description ?? '')) {
    if (description.length > SHARED_ACTION_DESCRIPTION_MAX) return null;
    updates.description = description;
  }
  if (dueDate !== (original.dueDate ?? '')) {
    if (dueDate.length > SHARED_ACTION_DUE_MAX) return null;
    updates.due_date = dueDate;
  }
  return updates;
}

/**
 * 수정 영수증이 같은 항목이고, 보낸 칸마다 서버가 정규화했을 값과 같은지.
 * 맞으면 해석한 항목, 아니면 `null`. 상태만 바꾸는 요청도 같은 검사를 쓴다.
 */
export function matchesActionUpdateReceipt(payload, id, updates) {
  if (!object(payload) || !object(payload.action) || !object(updates)) return null;
  const raw = payload.action;
  const action = parseSharedAction(raw);
  if (!action || action.id !== id) return null;
  if (hasOwn(updates, 'status') && raw.status !== updates.status) return null;
  if (hasOwn(updates, 'title') && raw.title !== normalizeLikeServer(updates.title, SHARED_ACTION_TITLE_MAX)) return null;
  if (hasOwn(updates, 'category_key') && !sameStoredText(raw.categoryKey, updates.category_key, CATEGORY_KEY_MAX)) return null;
  if (hasOwn(updates, 'description') && !sameStoredText(raw.description, updates.description, SHARED_ACTION_DESCRIPTION_MAX)) return null;
  if (hasOwn(updates, 'due_date') && !sameStoredText(raw.dueDate, updates.due_date, SHARED_ACTION_DUE_MAX)) return null;
  return action;
}
