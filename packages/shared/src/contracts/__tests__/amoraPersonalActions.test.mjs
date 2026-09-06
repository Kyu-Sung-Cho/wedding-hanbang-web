import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePersonalActionDraft, parsePersonalAction, parsePersonalActionPage, parsePersonalActionReceipt, isPersonalActionDeleteReceipt } from '../amoraPersonalActions.mjs';

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
