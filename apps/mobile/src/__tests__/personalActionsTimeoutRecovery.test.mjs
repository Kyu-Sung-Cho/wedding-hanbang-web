import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers';
import { createPersonalActionsSession } from '../lib/personalActions.mjs';

const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const source = '33333333-3333-4333-8333-333333333333';
const id = '44444444-4444-4444-8444-444444444444';
const couple = '55555555-5555-4555-8555-555555555555';
const requestId = '66666666-6666-4666-8666-666666666666';
const draft = { title: '내가 확인한 기준', description: '나만 볼 메모', dueDate: '2026-09-12' };
const action = { id, ownerUserId: owner, sourceMessageId: source, ...draft, status: 'open', revision: 1,
  createdAt: '2026-09-08T09:00:00Z', updatedAt: '2026-09-08T09:00:00Z' };
const response = body => new globalThis.Response(JSON.stringify(body), { status: 200 });
const page = actions => response({ actions, count: actions.length, next_cursor: null });
const settle = () => new Promise(resolve => setImmediate(resolve));
const stalled = () => new Promise(() => {});

test('native stalled save releases busy state even when the request adapter ignores abort; manual retry keeps the exact request ID', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const writes = []; const signals = [];
  const session = createPersonalActionsSession(async (_owner, _path, options) => {
    if (options.method === 'GET') return page([]);
    writes.push(JSON.parse(options.body)); signals.push(options.signal);
    return writes.length === 1 ? stalled() : response({ saved: true, action });
  }, owner);
  t.after(() => session.dispose());
  const pending = session.save(source, couple, draft, requestId);
  assert.deepEqual(session.getState().busyIds, [source]);
  t.mock.timers.tick(30_000); await settle();
  assert.deepEqual(session.getState().busyIds, []);
  assert.equal(signals[0].aborted, true);
  assert.equal(await pending, null);
  assert.match(session.getState().writeError, /처리 결과를 확인하지 못/);
  assert.doesNotMatch(session.getState().writeError, /저장되지 않았/);
  assert.equal(writes.length, 1);
  assert.deepEqual(await session.save(source, couple, draft, requestId), action);
  assert.deepEqual(writes[1], writes[0]);
  await settle();
  t.mock.timers.tick(30_000); await settle();
  assert.equal(signals[1].aborted, false, 'successful requests must not retain their abort deadline');
});

test('native unfinished response body times out, preserves existing rows, and permits a fresh read', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let reads = 0;
  const session = createPersonalActionsSession(async () => ++reads === 2 ? { ok: true, json: stalled } : page([action]), owner);
  t.after(() => session.dispose());
  assert.equal(await session.load(), true);
  const pending = session.load(); await settle();
  t.mock.timers.tick(30_000); await settle();
  assert.equal(session.getState().loading, false);
  assert.equal(await pending, false);
  assert.deepEqual(session.getState().actions, [action]);
  assert.match(session.getState().error, /불러오지 못/);
  assert.equal(await session.load(), true);
  assert.equal(session.getState().error, null);
});

test('native lost response does not mean the server rolled back: readback finds one committed row without automatic POST replay', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let committed = false; let posts = 0;
  const session = createPersonalActionsSession(async (_owner, _path, options) => {
    if (options.method === 'POST') { committed = true; posts += 1; return stalled(); }
    return page(committed ? [action] : []);
  }, owner);
  t.after(() => session.dispose());
  const pending = session.save(source, couple, draft, requestId);
  t.mock.timers.tick(30_000); await settle();
  assert.deepEqual(session.getState().busyIds, []);
  assert.equal(await pending, null);
  assert.deepEqual(session.getState().actions, [action]);
  assert.equal(session.getState().count, 1);
  assert.equal(posts, 1);
  assert.match(session.getState().writeError, /처리 결과를 확인하지 못/);
});

test('native account changes settle old requests immediately and ignore a late committed receipt even after returning to the same owner', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let resolveWrite; let settled = false;
  const session = createPersonalActionsSession(async (_owner, _path, options) => options.method === 'POST'
    ? new Promise(resolve => { resolveWrite = resolve; }) : page([]), owner);
  t.after(() => session.dispose());
  const pending = session.save(source, couple, draft, requestId).then(result => { settled = true; return result; });
  session.setOwner(other); session.setOwner(owner); await settle();
  assert.equal(settled, true);
  assert.equal(await pending, null);
  resolveWrite(response({ saved: true, action })); await settle();
  t.mock.timers.tick(30_000); await settle();
  assert.deepEqual(session.getState().actions, []);
  assert.deepEqual(session.getState().busyIds, []);
  assert.equal(session.getState().writeError, null);
});
