import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import test from "node:test";
import ts from "typescript";

const { AbortController, Response } = globalThis;

const code = ts.transpileModule(readFileSync(new URL("../lib/signupConsentAccess.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const flush = async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };
const response = () => Response.json({ user: { id: "owner" }, capabilities: { signupConsentAccess: "server_verified" } });

function harness(fetcher) {
  const listeners = new Set();
  const timers = new Map();
  let timerId = 0;
  let receivedSignal;
  let calls = 0;
  const dependencies = {
    "./api": { apiFetchForExpectedUser: (...args) => { calls += 1; receivedSignal = args[2].signal; return fetcher(...args); } },
    "./supabase": { supabase: { auth: {
      onAuthStateChange: listener => {
        listeners.add(listener);
        return { data: { subscription: { unsubscribe: () => listeners.delete(listener) } } };
      },
    } } },
  };
  const exports = {};
  new Function("exports", "require", "setTimeout", "clearTimeout", code)(
    exports,
    name => { if (!Object.hasOwn(dependencies, name)) throw new Error(name); return dependencies[name]; },
    (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    id => timers.delete(id),
  );
  return {
    read: exports.readMobileSignupConsentAccess, timers, listeners,
    get signal() { return receivedSignal; }, get calls() { return calls; },
    expire() { for (const { callback, delay } of [...timers.values()]) { assert.ok(delay > 0 && delay <= 15_000); callback(); } },
    changeOwner(id) { for (const listener of [...listeners]) listener("SIGNED_IN", id ? { user: { id } } : null); },
  };
}

for (const phase of ["fetch", "body"]) {
  test(`동의 ${phase}가 응답하지 않아도 유한 시간 뒤 재시도 가능한 실패로 끝난다`, async () => {
    const never = new Promise(() => {});
    const h = harness(() => phase === "fetch" ? never : Promise.resolve({ ok: true, json: () => never }));
    let outcome;
    void h.read("owner").then(value => { outcome = value; }, error => { outcome = error; });
    await flush();
    h.expire();
    await flush();
    assert.ok(outcome instanceof Error, "미완료 요청이 오류로 종료되지 않았다");
    assert.match(outcome.message, /TIMEOUT/);
    assert.equal(h.signal.aborted, true);
    assert.equal(h.listeners.size, 0);
    assert.equal(h.timers.size, 0);
  });
}

test("이미 취소한 호출은 새 서버 읽기를 시작하지 않는다", async () => {
  const controller = new AbortController();
  controller.abort(new Error("caller cancelled"));
  const h = harness(async () => response());
  await assert.rejects(h.read("owner", controller.signal), /caller cancelled/);
  assert.equal(h.calls, 0);
});

test("호출자 취소는 내부 신호에도 전달되며 fetch가 취소를 무시해도 종료한다", async () => {
  const controller = new AbortController();
  const h = harness(() => new Promise(() => {}));
  let error;
  void h.read("owner", controller.signal).catch(value => { error = value; });
  await flush();
  controller.abort(new Error("caller cancelled"));
  await flush();
  assert.ok(error instanceof Error);
  assert.match(error.message, /caller cancelled/);
  assert.equal(h.signal.aborted, true);
  assert.equal(h.listeners.size, 0);
  assert.equal(h.timers.size, 0);
});

test("A→B→A 계정 교체 뒤 늦은 A 성공도 이전 읽기로 승인하지 않는다", async () => {
  let finish;
  const h = harness(() => new Promise(resolve => { finish = resolve; }));
  const outcome = h.read("owner");
  const rejected = assert.rejects(outcome, /SESSION_CHANGED/);
  await flush();
  h.changeOwner("other");
  h.changeOwner("owner");
  finish(response());
  await rejected;
  assert.equal(h.signal.aborted, true);
  assert.equal(h.listeners.size, 0);
});

test("정상 읽기와 같은 주체 갱신은 성공하며 timer/구독을 정리한다", async () => {
  let finish;
  const h = harness(() => new Promise(resolve => { finish = resolve; }));
  const outcome = h.read("owner");
  await flush();
  h.changeOwner("owner");
  finish(response());
  assert.equal(await outcome, "server_verified");
  assert.equal(h.listeners.size, 0);
  assert.equal(h.timers.size, 0);
});

test("연결 실패 뒤 같은 주체로 다시 읽을 수 있다", async () => {
  let attempts = 0;
  const h = harness(async () => { if (attempts++ === 0) throw new Error("offline"); return response(); });
  await assert.rejects(h.read("owner"), /offline/);
  assert.equal(await h.read("owner"), "server_verified");
  assert.equal(h.calls, 2);
  assert.equal(h.listeners.size, 0);
  assert.equal(h.timers.size, 0);
});
