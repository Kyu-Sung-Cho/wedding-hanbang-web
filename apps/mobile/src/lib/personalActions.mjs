import { parsePersonalActionPage, parsePersonalActionReceipt, isPersonalActionDeleteReceipt } from '@hanbang/shared/amora-personal-actions';

const PATH = '/api/amora/personal-actions';
const REQUEST_TIMEOUT_MS = 30_000;
const empty = ownerId => ({ ownerId, actions: [], count: 0, nextCursor: null, loading: false, busyIds: [], error: null, writeError: null });

/** 계정 변경은 같은 사용자로 돌아와도 세대를 바꿔 이전 요청이 다시 나타나지 않게 한다. */
export function createPersonalActionsSession(request, initialOwnerId = null) {
  let state = empty(initialOwnerId);
  let epoch = 0;
  let sequence = 0;
  const listeners = new Set();
  const controllers = new Set();
  const busy = new Set();
  const emit = patch => { state = { ...state, ...patch }; listeners.forEach(listener => listener()); };
  const identity = () => ({ owner: state.ownerId, epoch });
  const current = token => token.owner !== null && state.ownerId === token.owner && epoch === token.epoch;
  const send = async (token, method, body, cursor) => {
    if (!current(token)) throw new Error('IDENTITY_CHANGED');
    const controller = new globalThis.AbortController();
    controllers.add(controller);
    // 인증 준비나 본문 읽기가 중단 신호를 무시해도 화면의 대기는 끝냅니다. 서버 저장 취소는 보장하지 않습니다.
    let onAbort;
    const cancelled = new Promise((_resolve, reject) => {
      onAbort = () => reject(new Error('REQUEST_ABORTED'));
      controller.signal.addEventListener('abort', onAbort, { once: true });
    });
    const timeout = globalThis.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await Promise.race([cancelled, (async () => {
        const response = await request(token.owner, method === 'GET' ? `${PATH}?status=all&limit=30${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}` : PATH, {
          method, signal: controller.signal,
          ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, expectedOwnerId: token.owner }) } : {}),
        });
        if (!current(token)) throw new Error('IDENTITY_CHANGED');
        if (!response.ok) {
          const failure = await response.json().catch(() => null);
          if (response.status === 409 && failure?.code === 'PERSONAL_ACTION_LIMIT_REACHED') throw new Error('LIMIT_REACHED');
          if (response.status === 409 && failure?.code === 'PERSONAL_ACTION_SOURCE_PROVENANCE_UNAVAILABLE') throw new Error('SOURCE_UNAVAILABLE');
          throw new Error(response.status === 409 ? 'CHANGED' : response.status === 403 && method === 'POST' ? 'SOURCE_UNAVAILABLE' : 'REQUEST_FAILED');
        }
        const payload = await response.json();
        if (!current(token)) throw new Error('IDENTITY_CHANGED');
        return payload;
      })()]);
    } finally {
      globalThis.clearTimeout(timeout);
      controller.signal.removeEventListener('abort', onAbort);
      controllers.delete(controller);
    }
  };
  const load = async cursor => {
    const token = identity();
    if (!token.owner || busy.size > 0) return false;
    const requestSequence = ++sequence;
    emit({ loading: true, error: null });
    try {
      const page = parsePersonalActionPage(await send(token, 'GET', undefined, cursor), token.owner);
      if (!page || (cursor && page.nextCursor === cursor)) throw new Error('INVALID_PAGE');
      if (!current(token) || requestSequence !== sequence) return false;
      emit({ ...page, actions: cursor ? [...new Map([...state.actions, ...page.actions].map(item => [item.id, item])).values()] : page.actions, loading: false });
      return true;
    } catch {
      if (current(token) && requestSequence === sequence) emit({ loading: false, error: '개인 할 일을 불러오지 못했어요. 다시 확인해 주세요.' });
      return false;
    }
  };
  const mutate = async (key, method, body, expected) => {
    const token = identity();
    if (!token.owner || busy.has(key)) return null;
    busy.add(key);
    sequence += 1;
    emit({ busyIds: [...busy], loading: false, writeError: null });
    try {
      const payload = await send(token, method, body);
      const action = expected ? parsePersonalActionReceipt(payload, token.owner, expected) : null;
      if (expected ? !action : !isPersonalActionDeleteReceipt(payload, key)) throw new Error('INVALID_RECEIPT');
      if (!current(token)) return null;
      const existed = state.actions.some(item => item.id === (action?.id ?? key));
      emit({ actions: action ? [action, ...state.actions.filter(item => item.id !== action.id)] : state.actions.filter(item => item.id !== key),
        count: Math.max(0, state.count + (action ? (existed ? 0 : 1) : (existed ? -1 : 0))),
      });
      return action ?? true;
    } catch (error) {
      if (current(token)) emit({ writeError: error instanceof Error && error.message === 'CHANGED'
        ? '다른 화면에서 내용이 바뀌었어요. 목록을 다시 확인해 주세요.'
        : error instanceof Error && error.message === 'SOURCE_UNAVAILABLE'
          ? '이 답변의 개인 소유를 확인하지 못했어요. 새로 나만 상담한 답변에서 다시 저장해 주세요.'
          : error instanceof Error && error.message === 'LIMIT_REACHED'
            ? '개인 할 일은 300개까지 보관할 수 있어요. 개인 목록에서 기존 할 일을 삭제한 뒤 다시 시도해 주세요.'
          : '처리 결과를 확인하지 못했어요. 개인 목록을 확인하거나 다시 시도해 주세요.' });
      return null;
    } finally {
      if (current(token)) {
        busy.delete(key);
        emit({ busyIds: [...busy] });
        void load();
      }
    }
  };
  return {
    getState: () => state,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    setOwner: ownerId => {
      if (ownerId === state.ownerId) return;
      epoch += 1; sequence += 1;
      controllers.forEach(controller => controller.abort()); controllers.clear(); busy.clear();
      state = empty(ownerId); listeners.forEach(listener => listener());
    },
    dispose: () => { epoch += 1; sequence += 1; controllers.forEach(controller => controller.abort()); controllers.clear(); busy.clear(); listeners.clear(); },
    load,
    save: (sourceMessageId, expectedCoupleId, draft, requestId) => mutate(sourceMessageId, 'POST', { messageId: sourceMessageId, expectedCoupleId, requestId, ...draft }, { kind: 'save', sourceMessageId, draft }),
    update: action => {
      if (action.ownerUserId !== state.ownerId) return Promise.resolve(null);
      const status = action.status === 'done' ? 'open' : 'done';
      return mutate(action.id, 'PATCH', { id: action.id, status, expectedRevision: action.revision }, { kind: 'update', id: action.id, status, revision: action.revision });
    },
    remove: action => action.ownerUserId === state.ownerId ? mutate(action.id, 'DELETE', { id: action.id, expectedRevision: action.revision }, null) : Promise.resolve(null),
  };
}
