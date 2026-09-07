import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePersonalActionDraft, parsePersonalActionDraftMetadata, parsePersonalAction, parsePersonalActionPage, parsePersonalActionReceipt, isPersonalActionDeleteReceipt, createPersonalActionContinuation } from '../amoraPersonalActions.mjs';

const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const source = '33333333-3333-4333-8333-333333333333';
const id = '44444444-4444-4444-8444-444444444444';
const action = () => ({ id, ownerUserId: owner, sourceMessageId: source, title: '사진 예산 생각해 보기', description: '혼자 생각한 기준만 정리', dueDate: '2026-09-10', status: 'open', revision: 1, createdAt: '2026-09-06T15:00:00.000Z', updatedAt: '2026-09-06T15:00:00.000Z' });

test('personal action draft preserves reviewed text/date and rejects empty/overflow/invalid dates', () => {
  assert.deepEqual(normalizePersonalActionDraft({ title: '  할 일  ', description: '  내용 ', dueDate: '2028-02-29' }), { title: '할 일', description: '내용', dueDate: '2028-02-29' });
  assert.deepEqual(normalizePersonalActionDraft({ title: '할 일', description: '', dueDate: '' }), { title: '할 일', description: null, dueDate: null });
  for (const value of [{ title: '' }, { title: '가'.repeat(121) }, { title: '할 일', description: '😀'.repeat(251) }, { title: '할 일', dueDate: '2026-02-29' }, { title: '할 일', dueDate: '2026-13-01' }]) assert.equal(normalizePersonalActionDraft(value), null);
});

test('personal action rows must belong to the expected account and have canonical source/id/revision', () => {
  assert.deepEqual(parsePersonalAction(action(), owner), action());
  for (const patch of [{ ownerUserId: other }, { sourceMessageId: 'shared' }, { id: '' }, { revision: 0 }, { status: 'dismissed' }, { createdAt: 'unknown' }, { dueDate: 'tomorrow' }]) assert.equal(parsePersonalAction({ ...action(), ...patch }, owner), null);
});

test('private metadata requires one complete bounded draft and never infers dates or trusts additional fields', () => {
  const draft = { title: '내가 검토할 초안', description: null, dueDate: null };
  assert.deepEqual(parsePersonalActionDraftMetadata(draft), draft);
  assert.deepEqual(parsePersonalActionDraftMetadata({ ...draft, dueDate: '2028-02-29' }), { ...draft, dueDate: '2028-02-29' });
  for (const value of [null, [draft], { title: draft.title }, { ...draft, ownerUserId: other }, { ...draft, dueDate: '' }, { ...draft, dueDate: '내일' }, { ...draft, dueDate: '2026-02-29' }, { ...draft, title: '😀'.repeat(61) }, { ...draft, description: '😀'.repeat(251) }]) {
    assert.equal(parsePersonalActionDraftMetadata(value), null);
  }
});

test('personal action pages distinguish empty success from malformed and reject duplicated/foreign rows', () => {
  assert.deepEqual(parsePersonalActionPage({ actions: [], count: 0, next_cursor: null }, owner), { actions: [], count: 0, nextCursor: null });
  assert.equal(parsePersonalActionPage({}, owner), null);
  assert.equal(parsePersonalActionPage({ actions: [action(), action()], count: 2, next_cursor: null }, owner), null);
  assert.equal(parsePersonalActionPage({ actions: [{ ...action(), ownerUserId: other }], count: 1, next_cursor: null }, owner), null);
  assert.equal(parsePersonalActionPage({ actions: [], count: 0, next_cursor: 'more' }, owner), null);
  assert.equal(parsePersonalActionPage({ actions: [action()], count: 0, next_cursor: null }, owner), null);
});

test('save receipt must acknowledge the exact reviewed private action rather than any HTTP200', () => {
  const expected = { kind: 'save', sourceMessageId: source, draft: { title: action().title, description: action().description, dueDate: action().dueDate } };
  assert.deepEqual(parsePersonalActionReceipt({ saved: true, action: action() }, owner, expected), action());
  for (const payload of [{}, { saved: false, action: action() }, { saved: true, action: { ...action(), sourceMessageId: other } }, { saved: true, action: { ...action(), title: '서버가 임의로 바꾼 제목' } }, { saved: true, action: { ...action(), ownerUserId: other } }]) assert.equal(parsePersonalActionReceipt(payload, owner, expected), null);
});

test('status receipt requires same id and requested status with a newer revision', () => {
  const expected = { kind: 'update', id, status: 'done', revision: 1 };
  assert.equal(parsePersonalActionReceipt({ updated: true, action: { ...action(), status: 'done', revision: 2 } }, owner, expected)?.status, 'done');
  for (const patch of [{ id: other }, { status: 'open' }, { revision: 1 }, { ownerUserId: other }]) assert.equal(parsePersonalActionReceipt({ updated: true, action: { ...action(), status: 'done', revision: 2, ...patch } }, owner, expected), null);
});

test('delete receipt must acknowledge the requested id', () => {
  assert.equal(isPersonalActionDeleteReceipt({ deleted: true, id }, id), true);
  assert.equal(isPersonalActionDeleteReceipt({ deleted: false, id }, id), false);
  assert.equal(isPersonalActionDeleteReceipt({ deleted: true, id: other }, id), false);
});

function continuationHarness() {
  let scope = { ownerId: owner, coupleId: other }; let row = action(); const calls = [];
  let reply = async () => ({ actions: row ? [row] : [], count: row ? 1 : 0, next_cursor: null });
  const session = createPersonalActionContinuation({ readScope: () => scope, readAction: async (id, observedScope) => { calls.push({ id, scope: observedScope }); return reply(); } });
  return { session, calls, setScope: value => { scope = value; }, setRow: value => { row = value; }, setReply: value => { reply = value; }, scope: () => scope };
}

test('personal continuation rereads selected owner/source at review, confirmation and private composer without storing prose', async () => {
  const h = continuationHarness(); assert.equal(h.calls.length, 0);
  const review = await h.session.review(id); assert.equal(h.session.hasPending(), false);
  await h.session.stage(review); assert.equal(h.calls.length, 2);
  const text = await h.session.take(h.scope());
  assert.match(text, /이 개인 할 일을 이어서 상담/); assert.ok(text.includes(action().title)); assert.ok(text.includes(action().description)); assert.ok(text.includes(action().dueDate));
  assert.equal(h.calls.length, 3); assert.equal(await h.session.take(h.scope()), null);
  assert.deepEqual(h.calls[0], { id, scope: h.scope() });
});

test('personal continuation fails closed after deletion or changed review and never transfers to another couple', async () => {
  const h = continuationHarness(); const review = await h.session.review(id);
  h.setRow({ ...action(), title: '바뀐 제목', revision: 2 });
  await assert.rejects(h.session.stage(review), /확인하지 못/); assert.equal(h.session.hasPending(), false);
  h.setRow(action()); await h.session.stage(await h.session.review(id)); h.setRow(null);
  await assert.rejects(h.session.take(h.scope()), /확인하지 못/); assert.equal(h.session.hasPending(), false);
  h.setRow(action()); await h.session.stage(await h.session.review(id));
  await assert.rejects(h.session.take({ ownerId: owner, coupleId: source }), /확인하지 못/);
});

test('personal continuation ignores deferred responses across owner ABA or current-couple changes', async () => {
  const h = continuationHarness(); let resolve; h.setReply(() => new Promise(done => { resolve = done; }));
  const pending = h.session.review(id);
  while (!resolve) await Promise.resolve();
  h.session.reset(); h.setScope({ ownerId: source, coupleId: other }); h.session.reset(); h.setScope({ ownerId: owner, coupleId: other });
  resolve({ actions: [action()], count: 1, next_cursor: null });
  await assert.rejects(pending, /확인하지 못/);
  h.setReply(async () => { h.setScope({ ownerId: owner, coupleId: source }); return { actions: [action()], count: 1, next_cursor: null }; });
  await assert.rejects(h.session.review(id), /확인하지 못/);
});

test('personal continuation refuses mismatched owner/id, malformed pages and latest revision changes', async () => {
  const h = continuationHarness();
  for (const payload of [{}, { actions: [{ ...action(), ownerUserId: other }], count: 1, next_cursor: null }, { actions: [{ ...action(), id: other }], count: 1, next_cursor: null }]) {
    h.setReply(async () => payload); await assert.rejects(h.session.review(id), /확인하지 못/);
  }
  h.setReply(async () => ({ actions: [action()], count: 1, next_cursor: null }));
  await h.session.stage(await h.session.review(id));
  h.setReply(async () => ({ actions: [{ ...action(), revision: 2 }], count: 1, next_cursor: null }));
  await assert.rejects(h.session.take(h.scope()), /확인하지 못/);
});
