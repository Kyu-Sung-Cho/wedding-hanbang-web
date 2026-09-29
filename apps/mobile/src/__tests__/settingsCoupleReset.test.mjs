/* global URL, Response, setImmediate */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../../app/settings/index.tsx", import.meta.url), "utf8");
const syntax = ts.createSourceFile("settings.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let declaration;
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "handleStartNewCouple") declaration = node.getText(syntax);
  ts.forEachChild(node, visit);
}
visit(syntax);
assert.ok(declaration, "실제 설정의 초기화 핸들러를 실행한다");
const compiled = ts.transpileModule(declaration, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function harness() {
  const snapshot = { userId: "user-a", coupleId: "couple-a" };
  const snapshotRef = { current: snapshot };
  const mountedRef = { current: true };
  const calls = [], alerts = [], changes = [], routes = [];
  let currentUser = snapshot.userId;
  let respond = async () => new Response(JSON.stringify({ success: true }));
  const bindings = {
    settingsSnapshot: snapshot, settingsSnapshotRef: snapshotRef, settingsMountedRef: mountedRef,
    resettingCouple: false, resetInFlightRef: { current: false },
    supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: currentUser } } }, error: null }) } },
    Alert: { alert: (...args) => alerts.push(args) },
    apiFetchForExpectedUser: async (...args) => { calls.push(args); return respond(); },
    setResettingCouple: () => {}, clearCommunityCaches: () => changes.push("clear"),
    setPartnerName: () => changes.push("partner"), setCoupleConnection: () => changes.push("couple"),
    resolveCoupleConnectionState: () => ({}), setData: () => changes.push("data"), setInitialData: () => changes.push("initial"),
    router: { replace: path => routes.push(path) }, toKoreanErrorMessage: (_error, fallback) => fallback,
  };
  const run = new Function(...Object.keys(bindings), `${compiled}\nreturn handleStartNewCouple;`)(...Object.values(bindings));
  run();
  const confirm = alerts[0][2].find(button => button.text === "계속").onPress;
  return { calls, changes, routes, alerts, snapshotRef, mountedRef, confirm,
    setUser: id => { currentUser = id; }, setResponse: fn => { respond = fn; } };
}

test("mobile reset submits the confirmation snapshot and applies a verified success", async () => {
  const state = harness(); await state.confirm();
  assert.equal(state.calls.length, 1);
  assert.equal(state.calls[0][0], "user-a");
  assert.equal(state.calls[0][1], "/api/couple/reset");
  assert.deepEqual(JSON.parse(state.calls[0][2].body), { confirmText: "초기화합니다", expectedUserId: "user-a", expectedCoupleId: "couple-a" });
  assert.deepEqual(state.routes, ["/onboarding"]);
});

test("mobile reset ignores confirmation after account or couple changes", async () => {
  for (const kind of ["account", "couple", "unmounted"]) {
    const state = harness();
    if (kind === "account") state.setUser("user-b");
    if (kind === "couple") state.snapshotRef.current = { userId: "user-a", coupleId: "couple-b" };
    if (kind === "unmounted") state.mountedRef.current = false;
    await state.confirm();
    assert.equal(state.calls.length, 0);
    assert.equal(state.changes.length, 0);
  }
});

test("mobile reset ignores a delayed response after account or couple changes", async () => {
  for (const kind of ["account", "couple", "unmounted"]) {
    const state = harness();
    let resolve;
    state.setResponse(() => new Promise(done => { resolve = done; }));
    const pending = state.confirm();
    await new Promise(done => setImmediate(done));
    assert.equal(state.calls.length, 1);
    if (kind === "account") state.setUser("user-b");
    if (kind === "couple") state.snapshotRef.current = { userId: "user-a", coupleId: "couple-b" };
    if (kind === "unmounted") state.mountedRef.current = false;
    resolve(new Response(JSON.stringify({ success: true })));
    await pending;
    assert.equal(state.changes.length, 0);
    assert.equal(state.routes.length, 0);
    assert.equal(state.alerts.length, 1);
  }
});

test("mobile reset takes the in-flight guard before asynchronous session checks", async () => {
  const state = harness();
  await Promise.all([state.confirm(), state.confirm()]);
  assert.equal(state.calls.length, 1);
});

test("mobile reset preserves the old preparation state when the server refuses the snapshot", async () => {
  const state = harness();
  state.setResponse(async () => new Response(JSON.stringify({ error: "연결이 바뀌었어요" }), { status: 409 }));
  await state.confirm();
  assert.equal(state.changes.length, 0);
  assert.equal(state.routes.length, 0);
  assert.equal(state.alerts.length, 2);
});

test("mobile deletion sends the account confirmed immediately before submission", () => {
  assert.match(source, /reason: "mobile_request", expectedOwnerId: deletionOwnerId/);
});
