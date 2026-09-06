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
