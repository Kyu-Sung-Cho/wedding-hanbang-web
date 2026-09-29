/* global URL, Response, setImmediate */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../../app/settings/index.tsx", import.meta.url), "utf8");
const syntax = ts.createSourceFile("settings.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let declaration;
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "showDeletionConfirmation") declaration = node.getText(syntax);
  ts.forEachChild(node, visit);
}
visit(syntax);
assert.ok(declaration, "실제 설정의 삭제 확인 핸들러를 실행한다");
const compiled = ts.transpileModule(declaration, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function harness() {
  const calls = [], alerts = [], routes = [], signOuts = [];
  const mounted = { current: true };
  let currentUser = "user-a", listener;
  let respond = async () => new Response(JSON.stringify({ success: true }));
  let beforeSignOut = async () => {};
  function changeUser(id) { currentUser = id; listener?.("SIGNED_IN", id ? { user: { id } } : null); }
  const bindings = {
    settingsMountedRef: mounted, deletionInFlightRef: { current: false },
    supabase: { auth: {
      getSession: async () => ({ data: { session: currentUser ? { user: { id: currentUser } } : null }, error: null }),
      onAuthStateChange: callback => { listener = callback; return { data: { subscription: { unsubscribe: () => { listener = undefined; } } } }; },
    } },
    ACCOUNT_DELETION_FACTS: [], Alert: { alert: (...args) => alerts.push(args) },
    apiFetchForExpectedUser: async (...args) => { calls.push(args); return respond(); },
    signOut: async options => {
      await beforeSignOut();
      if (!options.isCurrentSession()) throw new Error("stale session");
      signOuts.push(currentUser); changeUser(null); return { decisionDataPurged: true };
    },
    router: { replace: path => routes.push(path) }, toKoreanErrorMessage: (_error, fallback) => fallback,
    purgeCommunityDecisionPendingForOwnerWithRetry: async () => {},
  };
  const open = new Function(...Object.keys(bindings), `${compiled}\nreturn showDeletionConfirmation;`)(...Object.values(bindings));
  open("user-a");
  alerts[0][2].find(button => button.text === "탈퇴하기").onPress();
  const confirm = alerts[1][2].find(button => button.text === "탈퇴 확인").onPress;
  return { calls, alerts, routes, signOuts, mounted, confirm, changeUser,
    setResponse: fn => { respond = fn; }, setBeforeSignOut: fn => { beforeSignOut = fn; } };
}

test("mobile deletion pins the owner from the first confirmation through the request", async () => {
  const state = harness(); await state.confirm();
  assert.equal(state.calls.length, 1);
  assert.equal(state.calls[0][0], "user-a");
  assert.equal(state.calls[0][1], "/api/auth/delete");
  assert.deepEqual(JSON.parse(state.calls[0][2].body), { reason: "mobile_request", expectedOwnerId: "user-a" });
  assert.deepEqual(state.signOuts, ["user-a"]);
  assert.deepEqual(state.routes, ["/(auth)/login"]);
});

test("mobile deletion ignores a confirmation after account switch or unmount", async () => {
  for (const kind of ["account", "unmounted"]) {
    const state = harness();
    if (kind === "account") state.changeUser("user-b"); else state.mounted.current = false;
    await state.confirm();
    assert.equal(state.calls.length, 0);
    assert.equal(state.alerts.length, 2);
    assert.equal(state.signOuts.length, 0);
  }
});

test("mobile deletion suppresses duplicate submissions before asynchronous session checks", async () => {
  const state = harness();
  await Promise.all([state.confirm(), state.confirm()]);
  await state.confirm();
  assert.equal(state.calls.length, 1);
});

test("mobile deletion ignores delayed success, pending and failure after account switch", async () => {
  for (const [body, status] of [[{ success: true }, 200], [{ pending: true }, 202], [{ error: "retry" }, 503]]) {
    const state = harness(); let resolve;
    state.setResponse(() => new Promise(done => { resolve = done; }));
    const pending = state.confirm();
    await new Promise(done => setImmediate(done));
    assert.equal(state.calls.length, 1);
    state.changeUser("user-b");
    resolve(new Response(JSON.stringify(body), { status }));
    await pending;
    assert.equal(state.signOuts.length, 0);
    assert.equal(state.routes.length, 0);
    assert.equal(state.alerts.length, 2);
  }
});

test("mobile deletion pending notice cannot sign out a newly selected account", async () => {
  const state = harness();
  state.setResponse(async () => new Response(JSON.stringify({ pending: true }), { status: 202 }));
  await state.confirm();
  state.changeUser("user-b");
  state.alerts[2][2][0].onPress();
  await new Promise(done => setImmediate(done));
  assert.equal(state.signOuts.length, 0);
  assert.equal(state.routes.length, 0);
});

test("mobile deletion stops sign-out if the owner changes during cleanup", async () => {
  const state = harness();
  state.setBeforeSignOut(async () => { state.changeUser("user-b"); });
  await state.confirm();
  assert.equal(state.signOuts.length, 0);
  assert.equal(state.routes.length, 0);
  assert.equal(state.alerts.length, 2);
});
