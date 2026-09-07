import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setImmediate } from 'node:timers';
import { URL } from 'node:url';
import ts from 'typescript';
import * as contract from '@hanbang/shared/amora-personal-actions';
import { createPersonalActionsSession } from '../lib/personalActions.mjs';

const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const source = '33333333-3333-4333-8333-333333333333';
const id = '44444444-4444-4444-8444-444444444444';
const couple = '55555555-5555-4555-8555-555555555555';
const requestId = '66666666-6666-4666-8666-666666666666';
const draft = { title: '혼자 생각할 기준', description: '공유하지 않는 생각', dueDate: '2026-09-10' };
const action = (patch = {}) => ({ id, ownerUserId: owner, sourceMessageId: source, ...draft, status: 'open', revision: 1, createdAt: '2026-09-06T15:00:00Z', updatedAt: '2026-09-06T15:00:00Z', ...patch });
const response = (body, status = 200) => new globalThis.Response(JSON.stringify(body), { status });
const page = (actions = [], next_cursor = null, count = actions.length) => response({ actions, count, next_cursor });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const settle = () => new Promise(resolve => setImmediate(resolve));

test('personal list distinguishes malformed read from empty success and retries without losing existing rows', async () => {
  const replies = [page([action()]), response({}), page([])];
  const session = createPersonalActionsSession(async () => replies.shift(), owner);
  assert.equal(await session.load(), true);
  assert.equal(await session.load(), false);
  assert.match(session.getState().error, /불러오지 못/);
  assert.equal(session.getState().actions[0].title, draft.title);
  assert.equal(await session.load(), true);
  assert.equal(session.getState().error, null);
  assert.deepEqual(session.getState().actions, []);
});

test('personal preview performs no automatic request; explicit save sends reviewed fields and exact receipt then reads back', async () => {
  const calls = [];
  const session = createPersonalActionsSession(async (user, path, options) => {
    calls.push({ user, path, options });
    return options.method === 'POST' ? response({ saved: true, action: action() }) : page([action()]);
  }, owner);
  assert.equal(calls.length, 0);
  const result = await session.save(source, couple, draft, requestId);
  await settle();
  assert.deepEqual(result, action());
  assert.deepEqual(JSON.parse(calls[0].options.body), { messageId: source, expectedCoupleId: couple, requestId, ...draft, expectedOwnerId: owner });
  assert.equal(calls[0].user, owner);
  assert.equal(calls[1].options.method, 'GET');
  assert.deepEqual(session.getState().actions, [action()]);
});

test('personal save double click sends once, mismatched receipt fails and retry keeps the chosen request id', async () => {
  const pending = deferred(); const bodies = [];
  let attempt = 0;
  const session = createPersonalActionsSession(async (_owner, _path, options) => {
    if (options.method === 'GET') return page([]);
    bodies.push(JSON.parse(options.body)); attempt += 1;
    return attempt === 1 ? pending.promise : response({ saved: true, action: action() });
  }, owner);
  const first = session.save(source, couple, draft, requestId);
  assert.equal(await session.save(source, couple, draft, requestId), null);
  assert.equal(bodies.length, 1);
  pending.resolve(response({ saved: true, action: action({ title: '다른 내용' }) }));
  assert.equal(await first, null); await settle();
  assert.match(session.getState().writeError, /결과를 확인하지 못/);
  assert.deepEqual(session.getState().actions, []);
  assert.equal((await session.save(source, couple, draft, requestId)).id, id);
  assert.equal(bodies[0].requestId, bodies[1].requestId);
});

test('personal owner A to B to A invalidates old read and save even if transport ignores abort', async () => {
  const oldRead = deferred(); const oldWrite = deferred(); let reads = 0;
  const session = createPersonalActionsSession(async (_owner, _path, options) => options.method === 'POST' ? oldWrite.promise : ++reads === 1 ? oldRead.promise : page([]), owner);
  const reading = session.load();
  const saving = session.save(source, couple, draft, requestId);
  session.setOwner(other); session.setOwner(owner);
  await session.load();
  oldRead.resolve(page([action()])); oldWrite.resolve(response({ saved: true, action: action() }));
  assert.equal(await reading, false); assert.equal(await saving, null);
  assert.deepEqual(session.getState().actions, []);
  assert.deepEqual(session.getState().busyIds, []);
  assert.equal(session.getState().writeError, null);
});

test('personal pagination appends without duplication and rejects repeated cursor/foreign owner pages', async () => {
  const paths = [];
  const replies = [page([action()], 'cursor+a', 2), page([action(), action({ id: other })], null, 2), page([action()], 'same', 2), page([action({ ownerUserId: other })])];
  const session = createPersonalActionsSession(async (_owner, path) => { paths.push(path); return replies.shift(); }, owner);
  await session.load(); await session.load('cursor+a');
  assert.equal(session.getState().actions.length, 2);
  assert.match(paths[1], /cursor=cursor%2Ba/);
  assert.equal(await session.load('same'), false);
  assert.equal(await session.load(), false);
  assert.equal(session.getState().actions.length, 2);
});

test('personal status/delete require exact canonical receipts and never replay another owner action', async () => {
  let canonical = action(); const methods = [];
  const session = createPersonalActionsSession(async (_owner, _path, options) => {
    methods.push(options.method);
    if (options.method === 'GET') return page(canonical ? [canonical] : []);
    if (options.method === 'PATCH') { canonical = action({ status: 'done', revision: 2 }); return response({ updated: true, action: canonical }); }
    canonical = null; return response({ deleted: true, id });
  }, owner);
  await session.load();
  assert.equal((await session.update(action())).status, 'done'); await settle();
  assert.equal(session.getState().actions[0].status, 'done');
  assert.equal(await session.remove(session.getState().actions[0]), true); await settle();
  assert.deepEqual(session.getState().actions, []);
  const count = methods.length; session.setOwner(other);
  assert.equal(await session.update(action()), null); assert.equal(await session.remove(action()), null);
  assert.equal(methods.length, count);
});

test('personal late read cannot undo a confirmed status; failed delete retains current data', async () => {
  const stale = deferred(); let reads = 0;
  const done = action({ status: 'done', revision: 2 });
  const session = createPersonalActionsSession(async (_owner, _path, options) => {
    if (options.method === 'PATCH') return response({ updated: true, action: done });
    if (options.method === 'DELETE') return response({ deleted: true, id: other });
    reads += 1; return reads === 2 ? stale.promise : page([reads > 2 ? done : action()]);
  }, owner);
  await session.load(); const reading = session.load();
  await session.update(action()); await settle(); stale.resolve(page([action()])); await reading;
  assert.equal(session.getState().actions[0].status, 'done');
  assert.equal(await session.remove(done), null); await settle();
  assert.equal(session.getState().actions[0].id, id);
  assert.match(session.getState().writeError, /결과를 확인하지 못/);
});

test('personal source ownership rejection provides a new-private-answer recovery path without raw error data', async () => {
  const session = createPersonalActionsSession(async (_owner, _path, options) => options.method === 'POST' ? response({ error: 'PRIVATE_INTERNAL_DETAIL' }, 403) : page([]), owner);
  assert.equal(await session.save(source, couple, draft, requestId), null);
  assert.match(session.getState().writeError, /새로 나만 상담/);
  assert.doesNotMatch(session.getState().writeError, /PRIVATE_INTERNAL_DETAIL/);
});

test('personal storage limit gives the exact removal recovery rather than a stale-update message', async () => {
  const session = createPersonalActionsSession(async (_owner, _path, options) => options.method === 'POST' ? response({ code: 'PERSONAL_ACTION_LIMIT_REACHED' }, 409) : page([]), owner);
  assert.equal(await session.save(source, couple, draft, requestId), null);
  assert.match(session.getState().writeError, /300개.*삭제한 뒤/);
});

test('personal legacy provenance code explains saving from a new private answer', async () => {
  const session = createPersonalActionsSession(async (_owner, _path, options) => options.method === 'POST' ? response({ code: 'PERSONAL_ACTION_SOURCE_PROVENANCE_UNAVAILABLE' }, 409) : page([]), owner);
  assert.equal(await session.save(source, couple, draft, requestId), null);
  assert.match(session.getState().writeError, /새로 나만 상담/);
});

function saveViewHarness(initialProps = {}) {
  const slots = []; let index = 0; let tree; const saves = []; const navigation = [];
  const data = { ownerId: owner, busyIds: [], writeError: null, session: { getState: () => ({ ownerId: data.ownerId }), save: async (...args) => { saves.push(args); return action({ title: args[2].title }); } } };
  const jsx = (type, props) => ({ type, props });
  const token = new Proxy({}, { get: () => token });
  const modules = {
    react: { useState(initial) { const key = index++; slots[key] ??= { value: initial }; return [slots[key].value, value => { slots[key].value = value; }]; }, useRef(initial) { const key = index++; slots[key] ??= { current: initial }; return slots[key]; } },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { KeyboardAvoidingView: 'KeyboardAvoidingView', Modal: 'Modal', Platform: { OS: 'ios' }, Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', TextInput: 'TextInput', View: 'View', StyleSheet: { create: value => value } },
    'expo-router': { router: { push: route => navigation.push(route) } }, 'expo-crypto': { randomUUID: () => requestId },
    '@hanbang/design-tokens': { colors: token, spacing: token, radius: token }, '@hanbang/shared/amora-personal-actions': contract,
    '@/lib/usePersonalActions': { usePersonalActions: () => data },
  };
  const code = ts.transpileModule(readFileSync(new URL('../components/chat/PersonalActionSave.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  new Function('exports', 'require', code)(module.exports, name => { assert.ok(modules[name], name); return modules[name]; });
  const nodes = value => !value ? [] : Array.isArray(value) ? value.flatMap(nodes) : typeof value === 'object' ? [value, ...nodes(value.props?.children)] : [];
  const text = value => value == null ? '' : Array.isArray(value) ? value.map(text).join('') : typeof value === 'object' ? text(value.props?.children) : String(value);
  let props = initialProps;
  const render = (nextProps = props) => { props = nextProps; index = 0; tree = module.exports.PersonalActionSave({ ownerId: owner, coupleId: couple, messageId: source, content: '개인 원문은 전송하지 않아요', ...props }); };
  render();
  return { data, saves, navigation, render, nodes: () => nodes(tree), button: label => nodes(tree).find(node => node.type === 'Pressable' && text(node) === label) };
}

test('actual native private sheet starts blank, reviews optional date, and navigates only after save receipt', async () => {
  const h = saveViewHarness();
  assert.equal(h.saves.length, 0);
  h.button('개인 할 일로 저장').props.onPress(); h.render();
  assert.equal(h.nodes().find(node => node.type === 'Modal').props.visible, true);
  assert.equal(h.button('개인 할 일 저장').props.disabled, true);
  h.nodes().find(node => node.props.accessibilityLabel === '할 일 제목').props.onChangeText('내가 확인한 제목');
  h.nodes().find(node => node.props.accessibilityLabel === '개인 할 일 마감일 YYYY-MM-DD').props.onChangeText('2026-02-30'); h.render();
  assert.equal(h.button('개인 할 일 저장').props.disabled, true);
  h.nodes().find(node => node.props.accessibilityLabel === '개인 할 일 마감일 YYYY-MM-DD').props.onChangeText('2026-09-10'); h.render();
  h.button('개인 할 일 저장').props.onPress(); await settle(); h.render();
  assert.deepEqual(h.saves[0], [source, couple, { title: '내가 확인한 제목', description: null, dueDate: '2026-09-10' }, requestId]);
  assert.equal(h.nodes().find(node => node.type === 'Modal').props.visible, false);
  h.button('개인 목록 확인').props.onPress(); assert.deepEqual(h.navigation, ['/amora-personal']);
});

test('actual native sheet closes its rendered private content when the authenticated owner changes', () => {
  const h = saveViewHarness(); h.button('개인 할 일로 저장').props.onPress(); h.render();
  h.data.ownerId = other; h.render(); assert.deepEqual(h.nodes(), []); assert.equal(h.saves.length, 0);
});

test('actual native sheet prefills a validated draft but never overwrites user edits or saves automatically', async () => {
  const h = saveViewHarness({ personalActionDraft: draft });
  h.button('개인 할 일로 저장').props.onPress(); h.render();
  const field = label => h.nodes().find(node => node.props.accessibilityLabel === label);
  assert.equal(field('할 일 제목').props.value, draft.title);
  assert.equal(field('개인 할 일 내용').props.value, draft.description);
  assert.equal(field('개인 할 일 마감일 YYYY-MM-DD').props.value, draft.dueDate);
  assert.equal(h.saves.length, 0);
  field('할 일 제목').props.onChangeText('직접 바꾼 제목');
  h.render({ personalActionDraft: { ...draft, title: '늦은 초안' } });
  assert.equal(field('할 일 제목').props.value, '직접 바꾼 제목');
  h.button('개인 할 일 저장').props.onPress(); await settle();
  assert.deepEqual(h.saves[0][2], { ...draft, title: '직접 바꾼 제목' });
});

test('actual native sheet rejects incomplete or malformed metadata without copying answer prose', () => {
  for (const personalActionDraft of [{ title: '누락' }, { ...draft, dueDate: '내일' }, { ...draft, ownerUserId: other }]) {
    const h = saveViewHarness({ personalActionDraft }); h.button('개인 할 일로 저장').props.onPress(); h.render();
    assert.equal(h.nodes().find(node => node.props.accessibilityLabel === '할 일 제목').props.value, '');
    assert.equal(h.button('개인 할 일 저장').props.disabled, true); assert.equal(h.saves.length, 0);
  }
});

function nativeViewHarness(path, exportName, props, extraModules = {}) {
  const slots = []; let index = 0; let tree;
  const jsx = (type, props) => ({ type, props }); const token = new Proxy({}, { get: () => token });
  const modules = {
    react: { useState(initial) { const key = index++; slots[key] ??= { value: initial }; return [slots[key].value, value => { slots[key].value = value; }]; }, useRef(initial) { const key = index++; slots[key] ??= { current: initial }; return slots[key]; }, useEffect(callback) { const key = index++; if (!slots[key]) { slots[key] = {}; callback(); } } },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { Modal: 'Modal', Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View', StyleSheet: { create: value => value } },
    '@hanbang/design-tokens': { colors: token, spacing: token, radius: token }, ...extraModules,
  };
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} }; new Function('exports', 'require', code)(module.exports, name => { assert.ok(modules[name], name); return modules[name]; });
  const nodes = value => !value ? [] : Array.isArray(value) ? value.flatMap(nodes) : typeof value === 'object' ? [value, ...nodes(value.props?.children)] : [];
  const text = value => value == null ? '' : Array.isArray(value) ? value.map(text).join('') : typeof value === 'object' ? text(value.props?.children) : String(value);
  const render = () => { index = 0; tree = module.exports[exportName](props); }; render();
  return { render, text: () => text(tree), nodes: () => nodes(tree), button: label => nodes(tree).find(node => node.type === 'Pressable' && text(node) === label) };
}

test('actual native continuation asks for reviewed fields before staging private navigation and handles source rejection', async () => {
  let current = action(); const calls = []; const navigation = [];
  const session = contract.createPersonalActionContinuation({ readScope: () => ({ ownerId: owner, coupleId: couple }), readAction: async () => { calls.push('GET'); return { actions: current ? [current] : [], count: current ? 1 : 0, next_cursor: null }; } });
  const h = nativeViewHarness('../components/chat/PersonalActionContinue.tsx', 'PersonalActionContinue', { action: action() }, {
    'expo-router': { router: { push: path => navigation.push(path) } },
    '@/lib/personalActionContinuation': { personalActionContinuation: session },
    '@/lib/supabase': { supabase: { auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } } },
  });
  h.button('이 할 일 이어서 상담').props.onPress(); await settle(); h.render();
  assert.equal(h.nodes().find(node => node.type === 'Modal').props.visible, true); assert.deepEqual(navigation, []); assert.equal(session.hasPending(), false);
  assert.ok(h.text().includes(draft.description)); assert.ok(h.text().includes(draft.dueDate));
  current = null; h.button('나만 상담 입력창에 넣기').props.onPress(); await settle(); h.render();
  assert.match(h.text(), /확인하지 못/); assert.deepEqual(navigation, []);
  current = action(); h.button('나만 상담 입력창에 넣기').props.onPress(); await settle(); h.render();
  assert.deepEqual(navigation, ['/(tabs)/chat']); assert.equal(session.hasPending(), true);
  assert.ok((await session.take({ ownerId: owner, coupleId: couple })).includes(draft.title));
});

test('actual native recap displays exact receipt states and only prefills after explicit selection', () => {
  const sent = []; let canFill = false;
  const recap = { day: '2026-09-07', messageCount: 4, lastQuestion: { messageId: source, text: '내가 물은 질문', createdAt: '2026-09-07T00:00:00Z' }, actions: [
    { actionId: id, messageId: source, text: '예산 반영', state: 'applied' }, { actionId: other, messageId: source, text: '일정 제안', state: 'expired' },
  ] };
  const h = nativeViewHarness('../components/chat/AmoraConversationRecap.tsx', 'AmoraConversationRecap', { recap, scopeLabel: '나만 상담', disabled: false, onPrefill: text => { if (canFill) sent.push(text); return canFill; } });
  assert.deepEqual(sent, []); h.button('최근 대화 정리 · 2026-09-07').props.onPress(); h.render();
  assert.match(h.text(), /반영 결과 확인됨/); assert.match(h.text(), /기한 만료 · 새 제안 필요/);
  h.button('이 질문 이어서 상담').props.onPress(); h.render(); assert.match(h.text(), /작성 중인 메시지는 그대로/); assert.deepEqual(sent, []);
  canFill = true; h.button('이 질문 이어서 상담').props.onPress(); h.render(); assert.ok(sent[0].includes('내가 물은 질문')); assert.equal(h.nodes().find(node => node.type === 'Modal').props.visible, false);
});

test('actual native private handoff focus callback preserves all lanes and ignores delayed scope changes', async () => {
  const sourceText = readFileSync(new URL('../../app/(tabs)/chat.tsx', import.meta.url), 'utf8');
  const tree = ts.createSourceFile('chat.tsx', sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); let callback;
  const visit = node => { if (ts.isCallExpression(node) && node.expression.getText(tree) === 'useFocusEffect' && node.arguments[0]?.getText(tree).includes('personalActionContinuation.take')) callback = node.arguments[0].arguments[0].getText(tree); ts.forEachChild(node, visit); }; visit(tree); assert.ok(callback);
  const code = ts.transpileModule(`const run = ${callback};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const scenario of ['empty', 'dirty', 'scope_changed']) {
    const pending = deferred(); let currentGeneration = 1; const notices = []; const selectedScopes = [];
    const drafts = { shared_ai: '공유 질문', shared_partner: '상대에게', private_ai: scenario === 'dirty' ? '기존 개인 질문' : '' };
    const bindings = { initialLoaded: true, userId: owner, coupleId: couple, userRole: 'bride', chatLoadError: null, streaming: false, sendingRef: { current: false }, personalActionContinuation: { hasPending: () => true, take: () => pending.promise }, chatSessionGenerationRef: { current: { current: () => currentGeneration, isCurrent: value => value === currentGeneration } }, sessionUserIdRef: { current: owner }, inputByLaneRef: { current: drafts }, setPartnerSafetyNotice: value => notices.push(value), setActiveScope: value => selectedScopes.push(value), setTarget: value => assert.equal(value, 'ai'), setInputByLane: update => Object.assign(drafts, update(drafts)), updateAmoraChatLaneRecord: (current, lane, value) => ({ ...current, [lane]: value }) };
    const run = new Function('bindings', `with (bindings) { ${code} return run; }`)(bindings); run();
    if (scenario === 'scope_changed') currentGeneration += 1;
    pending.resolve('검토한 개인 할 일'); await settle();
    assert.equal(drafts.shared_ai, '공유 질문'); assert.equal(drafts.shared_partner, '상대에게');
    assert.equal(drafts.private_ai, scenario === 'empty' ? '검토한 개인 할 일' : scenario === 'dirty' ? '기존 개인 질문' : '');
    assert.deepEqual(selectedScopes, scenario === 'empty' ? ['private'] : []);
    if (scenario === 'dirty') assert.match(notices[0], /그대로 두었어요/);
  }
});
