import assert from "node:assert/strict";
import test from "node:test";

import { createCommunityCacheSession } from "../lib/communityCacheSession.mjs";

const USER_A = "10000000-0000-4000-8000-000000000001";
const USER_B = "10000000-0000-4000-8000-000000000002";

test("a fresh cache session is unresolved until guest or member identity is confirmed", () => {
  const session = createCommunityCacheSession();

  assert.deepEqual(session.capture(), { generation: 0, viewerKey: "unresolved" });
  assert.equal(session.setViewer(null), true);
  assert.deepEqual(session.capture(), { generation: 1, viewerKey: "guest" });
});

test("a late community response from account A is rejected after switching to B", () => {
  const session = createCommunityCacheSession();
  session.setViewer(USER_A);
  const accountAToken = session.capture();

  assert.equal(session.isCurrent(accountAToken), true);
  assert.equal(session.setViewer(USER_B), true);
  assert.equal(session.isCurrent(accountAToken), false);
  assert.equal(session.capture().viewerKey, `user:${USER_B}`);
});

test("sign-out invalidates member cache work and creates an explicit guest scope", () => {
  const session = createCommunityCacheSession();
  session.setViewer(USER_A);
  const memberToken = session.capture();

  assert.equal(session.setViewer(null), true);
  assert.equal(session.isCurrent(memberToken), false);
  assert.deepEqual(session.capture(), {
    generation: memberToken.generation + 1,
    viewerKey: "guest",
  });
});

test("repeating the same viewer does not invalidate safe in-flight work", () => {
  const session = createCommunityCacheSession();
  assert.equal(session.setViewer(USER_A), true);
  const token = session.capture();

  assert.equal(session.setViewer(USER_A.toUpperCase()), false);
  assert.equal(session.isCurrent(token), true);
});
