const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const isPersonalActionId = value => typeof value === 'string' && UUID.test(value);

function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function timestamp(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
}

export function normalizePersonalActionDraft(value) {
  if (!object(value) || typeof value.title !== 'string') return null;
  const title = value.title.trim();
  if (!title || title.length > 120) return null;
  if (value.description != null && typeof value.description !== 'string') return null;
  const description = typeof value.description === 'string' ? value.description.trim() || null : null;
  if (description && description.length > 500) return null;
  const dueDate = value.dueDate === '' || value.dueDate == null ? null : value.dueDate;
  if (dueDate !== null && !date(dueDate)) return null;
  return { title, description, dueDate };
}

export function parsePersonalActionDraftMetadata(value) {
  if (!object(value) || Object.keys(value).length !== 3
    || !Object.hasOwn(value, 'title') || !Object.hasOwn(value, 'description') || !Object.hasOwn(value, 'dueDate')
    || !(value.description === null || typeof value.description === 'string')
    || !(value.dueDate === null || (typeof value.dueDate === 'string' && date(value.dueDate)))) return null;
  return normalizePersonalActionDraft(value);
}

export function parsePersonalActionsViewMetadata(value) {
  return object(value) && Object.keys(value).length === 1 && ['open', 'done', 'all'].includes(value.status) ? value.status : null;
}

export function parsePersonalAction(value, expectedOwnerId) {
  if (!object(value) || !isPersonalActionId(value.id) || !isPersonalActionId(value.sourceMessageId)
    || !isPersonalActionId(expectedOwnerId) || value.ownerUserId !== expectedOwnerId
    || !['open', 'done'].includes(value.status) || !Number.isSafeInteger(value.revision) || value.revision < 1
    || !timestamp(value.createdAt) || !timestamp(value.updatedAt)
    || !(value.description === null || typeof value.description === 'string')
    || !(value.dueDate === null || typeof value.dueDate === 'string')) return null;
  const draft = normalizePersonalActionDraft(value);
  if (!draft || draft.title !== value.title || draft.description !== value.description || draft.dueDate !== value.dueDate) return null;
  return { id: value.id, ownerUserId: value.ownerUserId, sourceMessageId: value.sourceMessageId, ...draft,
    status: value.status, revision: value.revision, createdAt: value.createdAt, updatedAt: value.updatedAt };
}

export function parsePersonalActionPage(value, expectedOwnerId) {
  if (!object(value) || !Array.isArray(value.actions) || value.actions.length > 100
    || !Number.isSafeInteger(value.count) || value.count < value.actions.length
    || !(value.next_cursor === null || (typeof value.next_cursor === 'string' && value.next_cursor.length > 0 && value.next_cursor.length <= 2048))) return null;
  const actions = value.actions.map(action => parsePersonalAction(action, expectedOwnerId));
  if (actions.some(action => !action) || new Set(actions.map(action => action.id)).size !== actions.length
    || (value.next_cursor && actions.length === 0)) return null;
  return { actions, count: value.count, nextCursor: value.next_cursor };
}

export function parsePersonalActionReceipt(value, expectedOwnerId, expected) {
  if (!object(value) || !object(expected)) return null;
  const action = parsePersonalAction(value.action, expectedOwnerId);
  if (!action) return null;
  if (expected.kind === 'save') {
    return value.saved === true && action.sourceMessageId === expected.sourceMessageId
      && action.title === expected.draft.title && action.description === expected.draft.description
      && action.dueDate === expected.draft.dueDate ? action : null;
  }
  if (expected.kind === 'update') {
    return value.updated === true && action.id === expected.id && action.status === expected.status
      && action.revision > expected.revision ? action : null;
  }
  return null;
}

export function isPersonalActionDeleteReceipt(value, expectedId) {
  return object(value) && value.deleted === true && value.id === expectedId;
}

const CONTINUATION_ERROR = '이 할 일을 현재 나만 상담으로 이어갈 수 있는지 확인하지 못했어요. 개인 목록에서 다시 확인해 주세요.';
const sameScope = (left, right) => left && right && left.ownerId === right.ownerId && left.coupleId === right.coupleId;
const validScope = value => object(value) && isPersonalActionId(value.ownerId) && isPersonalActionId(value.coupleId);

/** 원문을 저장하지 않는 일회성 전달. 선택·확인·수신마다 현재 출처를 다시 확인한다. */
export function createPersonalActionContinuation({ readScope, readAction }) {
  let generation = 0;
  let pending = null;
  const current = async (scope, expectedGeneration) => {
    const latest = await readScope();
    return generation === expectedGeneration && sameScope(latest, scope);
  };
  const read = async (id, scope, expectedGeneration) => {
    if (!isPersonalActionId(id) || !validScope(scope) || !await current(scope, expectedGeneration)) throw new Error(CONTINUATION_ERROR);
    const page = parsePersonalActionPage(await readAction(id, scope), scope.ownerId);
    if (!await current(scope, expectedGeneration) || !page || page.count !== 1 || page.nextCursor !== null
      || page.actions.length !== 1 || page.actions[0].id !== id) throw new Error(CONTINUATION_ERROR);
    return page.actions[0];
  };
  return {
    reset() { generation += 1; pending = null; },
    hasPending: () => pending !== null,
    async review(id) {
      const expectedGeneration = generation;
      const scope = await readScope();
      const action = await read(id, scope, expectedGeneration);
      return { action, scope: { ...scope }, generation: expectedGeneration };
    },
    async stage(review) {
      const action = await read(review.action.id, review.scope, review.generation);
      if (JSON.stringify(action) !== JSON.stringify(review.action)) throw new Error(CONTINUATION_ERROR);
      pending = { id: action.id, revision: action.revision, scope: { ...review.scope }, generation: review.generation };
    },
    async take(scope) {
      const selection = pending;
      pending = null;
      if (!selection) return null;
      if (!sameScope(selection.scope, scope)) throw new Error(CONTINUATION_ERROR);
      const action = await read(selection.id, scope, selection.generation);
      if (action.revision !== selection.revision) throw new Error(CONTINUATION_ERROR);
      return ['이 개인 할 일을 이어서 상담하고 싶어요.', `제목: ${action.title}`,
        action.description ? `내용: ${action.description}` : null,
        action.dueDate ? `마감일: ${action.dueDate}` : null].filter(Boolean).join('\n');
    },
  };
}
