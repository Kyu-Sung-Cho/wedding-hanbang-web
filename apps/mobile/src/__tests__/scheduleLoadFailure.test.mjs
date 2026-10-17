import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { URL } from "node:url";
import ts from "typescript";
import { createScheduleSessionFence } from "../lib/scheduleSessionFence.mjs";

const OWNER_A = "10000000-0000-4000-8000-000000000001";
const OWNER_B = "10000000-0000-4000-8000-000000000002";
const COUPLE_A = "50000000-0000-4000-8000-000000000001";

// 실제 화면의 읽기 함수를 실행한다. 네트워크 응답과 React 상태 경계만 대체한다.
function loadHarness({ user = { id: OWNER_A }, userError = null, profile = null, profileError = null } = {}) {
  const source = readFileSync(new URL("../../app/schedule/index.tsx", import.meta.url), "utf8");
  const file = ts.createSourceFile("schedule.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback;
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === "loadData"
      && node.initializer && ts.isCallExpression(node.initializer)) {
      callback = node.initializer.arguments[0];
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  assert.ok(callback, "일정 화면의 실제 loadData 경계를 찾을 수 있어야 한다");
  const compiled = ts.transpileModule(`const load = ${callback.getText(file)};`, {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const fence = createScheduleSessionFence();
  fence.setIdentity(OWNER_A, COUPLE_A);
  const state = { events: ["A의 기존 일정"], error: null, clearOwners: [], queries: [], loading: true };
  const sequence = { current: 0 };
  const clear = (owner) => {
    state.clearOwners.push(owner);
    state.events = [];
    state.error = null;
  };
  const scope = {
    supabase: {
      auth: { getUser: async () => ({ data: { user }, error: userError }) },
      from: (table) => {
        state.queries.push(table);
        assert.equal(table, "profiles", "오류 또는 커플 미연결이면 준비 정보까지 조회하지 않는다");
        const query = {
          select: () => query,
          eq: () => query,
          single: async () => ({ data: profile, error: profileError }),
        };
        return query;
      },
    },
    scheduleLoadSequenceRef: sequence,
    scheduleSessionFenceRef: fence,
    clearIdentityBoundState: clear,
    setProfileId: () => {},
    setCoupleId: () => {},
    approvalIdentityRef: { current: null },
    setEvents: (events) => { state.events = events; },
    setScheduleDataError: (error) => { state.error = error; },
    setLoading: (loading) => { state.loading = loading; },
    ScheduleMutationError: class ScheduleMutationError extends Error {},
    console: { error: () => {} },
  };
  const load = new Function(...Object.keys(scope), `${compiled}\nreturn load;`)(...Object.values(scope));
  return { load, state, fence };
}

test("프로필 조회 실패는 커플 미연결 빈 상태로 처리하지 않는다", async () => {
  const { load, state } = loadHarness({ profileError: new Error("synthetic connection failure") });
  await load();
  assert.equal(state.error, "load");
  assert.deepEqual(state.clearOwners, []);
  assert.deepEqual(state.events, []);
  assert.equal(state.loading, false);
});

test("인증 조회 실패는 이전 계정 자료를 비우고 재시도 상태로 끝낸다", async () => {
  const { load, state, fence } = loadHarness({ user: null, userError: new Error("synthetic auth failure") });
  await load();
  assert.equal(state.error, "load");
  assert.deepEqual(state.clearOwners, [null]);
  assert.deepEqual(state.queries, []);
  assert.equal(fence.capture(), null);
});

test("조회가 성공한 실제 커플 미연결 계정은 오류로 표시하지 않는다", async () => {
  const { load, state } = loadHarness({ profile: { couple_id: null } });
  await load();
  assert.equal(state.error, null);
  assert.deepEqual(state.clearOwners, [OWNER_A]);
  assert.deepEqual(state.queries, ["profiles"]);
});

test("정상 로그아웃은 오류가 아닌 빈 상태로 끝낸다", async () => {
  const { load, state, fence } = loadHarness({ user: null });
  await load();
  assert.equal(state.error, null);
  assert.deepEqual(state.clearOwners, [null]);
  assert.equal(fence.capture(), null);
});

test("B 계정 프로필 조회 실패 후 A 계정 자료를 유지하지 않는다", async () => {
  const { load, state, fence } = loadHarness({ user: { id: OWNER_B }, profileError: new Error("synthetic profile failure") });
  await load();
  assert.deepEqual(state.clearOwners, [OWNER_B]);
  assert.deepEqual(state.events, []);
  assert.equal(state.error, "load");
  assert.equal(fence.capture(), null);
});
