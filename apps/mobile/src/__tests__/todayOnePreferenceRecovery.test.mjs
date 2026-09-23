import assert from "node:assert/strict";
import test from "node:test";
import { act, createLoader, mount, press, deferred } from "./helpers/nativeReact.mjs";

const OFF = { available: true, preference: { enabled: false, optedInAt: null, pausedUntil: null, dailyLimit: 1 } };
const ON = { available: true, preference: { enabled: true, optedInAt: "2026-09-20T00:00:00Z", pausedUntil: null, dailyLimit: 1 } };
const response = (payload, ok = true) => ({ ok, json: async () => payload });
function setup() {
  let owner = "A", listener, get = async () => response(OFF), put = async () => { throw Error("lost receipt"); };
  let verify = async () => ({ data: { user: owner ? { id: owner } : null }, error: null });
  const calls = [];
  const load = createLoader({
    "@/lib/supabase": { supabase: { auth: {
      getUser: () => verify(),
      onAuthStateChange(fn) { listener = fn; return { data: { subscription: { unsubscribe() {} } } }; },
    } } },
    "@/lib/api": { apiFetchForExpectedUser: async (id, path, options) => {
      calls.push({ id, method: options.method, body: options.body }); return options.method === "PUT" ? put() : get();
    } },
  });
  return { Component: load("components/settings/TodayOnePreferenceControl.tsx").default, calls,
    read(fn) { get = fn; }, write(fn) { put = fn; },
    verify(fn) { verify = fn; },
    async owner(id) { owner = id; await act(async () => listener?.("SIGNED_IN", id ? { user: { id } } : null)); },
  };
}
test("today-one reads back a lost commit receipt without claiming the setting is unchanged", async () => {
  const h = setup(); const ui = await mount(h.Component);
  try {
    h.read(async () => response(ON));
    await press(ui.container, "아모라 오늘의 한 가지 인앱 켜기");
    assert.equal(ui.container.querySelector('[role="switch"]')?.getAttribute("aria-checked"), "true");
    assert.doesNotMatch(ui.container.textContent, /기존 설정은 그대로/);
    assert.equal(h.calls.filter(call => call.method === "PUT").length, 1);
    assert.deepEqual(JSON.parse(h.calls.find(call => call.method === "PUT").body), { mode: "enable", expectedOwnerId: "A" });
  } finally { await ui.close(); }
});

test("today-one failed read stays visible and retryable, not rollout unavailable", async () => {
  const h = setup(); h.read(async () => response({ available: false }, false));
  const ui = await mount(h.Component);
  try {
    assert.match(ui.container.textContent, /불러오지 못했어요/);
    h.read(async () => response(OFF)); await press(ui.container, "다시 불러오기");
    assert.ok(ui.container.querySelector('[role="switch"]'));
  } finally { await ui.close(); }
});
test("today-one authentication failure is not presented as unavailable", async () => {
  const h = setup(); h.verify(async () => ({ data: { user: null }, error: Error("offline") }));
  const ui = await mount(h.Component);
  try { assert.match(ui.container.textContent, /불러오지 못했어요/); }
  finally { await ui.close(); }
});
test("today-one response body deadline releases the control and only reads back", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = setup(); const ui = await mount(h.Component);
  try {
    h.write(async () => ({ ok: true, json: () => new Promise(() => {}) }));
    h.read(async () => { throw Error("offline"); });
    await press(ui.container, "아모라 오늘의 한 가지 인앱 켜기");
    await act(async () => t.mock.timers.tick(16_000));
    assert.match(ui.container.textContent, /변경 결과를 확인하지 못했어요/);
    assert.equal(h.calls.filter(call => call.method === "PUT").length, 1);
    assert.equal(ui.container.querySelector('[role="switch"]'), null);
  } finally { await ui.close(); t.mock.timers.reset(); }
});
test("today-one late save cannot override the new account", async () => {
  const h = setup(); const ui = await mount(h.Component); const late = deferred();
  try {
    h.write(() => late.promise);
    await press(ui.container, "아모라 오늘의 한 가지 인앱 켜기");
    await h.owner("B");
    await act(async () => late.resolve(response(ON)));
    assert.equal(ui.container.querySelector('[role="switch"]')?.getAttribute("aria-checked"), "false");
    assert.equal(h.calls.filter(call => call.method === "PUT").length, 1);
  } finally { await ui.close(); }
});

test("today-one bounds authentication and never dispatches a write after its deadline", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = setup(); const ui = await mount(h.Component); const late = deferred();
  try {
    h.verify(() => late.promise);
    await press(ui.container, "아모라 오늘의 한 가지 인앱 켜기");
    await act(async () => t.mock.timers.tick(16_000));
    await act(async () => t.mock.timers.tick(16_000));
    assert.match(ui.container.textContent, /변경 결과를 확인하지 못했어요/);
    await act(async () => late.resolve({ data: { user: { id: "A" } }, error: null }));
    assert.equal(h.calls.filter(call => call.method === "PUT").length, 0);
  } finally { await ui.close(); t.mock.timers.reset(); }
});
test("today-one successful GET after timeout is informational until the pending pause settles", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = setup(); h.read(async () => response(ON));
  const ui = await mount(h.Component); const late = deferred();
  try {
    h.write(() => late.promise);
    await press(ui.container, "24시간 쉬기");
    await act(async () => t.mock.timers.tick(16_000));
    assert.ok(!ui.container.querySelector('[role="switch"]'), "pending pause must not allow an inverse disable write");
    assert.match(ui.container.textContent, /조회 시점 설정/);
    await press(ui.container, "다시 불러오기");
    assert.ok(!ui.container.querySelector('[role="switch"]'));
    assert.equal(h.calls.filter(call => call.method === "PUT").length, 1);
    await act(async () => late.resolve(response(ON)));
    assert.equal(ui.container.querySelector('[role="switch"]')?.getAttribute("aria-checked"), "true");
  } finally { await ui.close(); t.mock.timers.reset(); }
});
for (const rejected of [false, true]) test(`today-one late body settlement reloads canonical state, rejected=${rejected}`, async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = setup(); h.read(async () => response(ON));
  const ui = await mount(h.Component); const body = deferred();
  try {
    h.write(async () => ({ ok: true, json: () => body.promise }));
    await press(ui.container, "아모라 오늘의 한 가지 인앱 켜기");
    await act(async () => t.mock.timers.tick(16_000));
    assert.ok(!ui.container.querySelector('[role="switch"]'));
    h.read(async () => response(OFF));
    await act(async () => { if (rejected) body.reject(Error("lost body")); else body.resolve(ON); });
    assert.equal(ui.container.querySelector('[role="switch"]')?.getAttribute("aria-checked"), "false");
  } finally { await ui.close(); t.mock.timers.reset(); }
});
test("late body after timed-out save cannot reload or publish across A to B to A", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = setup(); const ui = await mount(h.Component); const body = deferred();
  try {
    h.write(async () => ({ ok: true, json: () => body.promise }));
    await press(ui.container, "아모라 오늘의 한 가지 인앱 켜기");
    await act(async () => t.mock.timers.tick(16_000));
    await h.owner("B"); await h.owner("A");
    const before = h.calls.length;
    await act(async () => body.resolve(ON));
    assert.equal(h.calls.length, before);
    assert.equal(ui.container.querySelector('[role="switch"]')?.getAttribute("aria-checked"), "false");
  } finally { await ui.close(); t.mock.timers.reset(); }
});
test("settlement during the recovery GET invalidates its old snapshot and requests a fresh current value", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = setup(); const ui = await mount(h.Component); const write = deferred(); const oldRead = deferred();
  try {
    h.write(() => write.promise); h.read(() => oldRead.promise);
    await press(ui.container, "아모라 오늘의 한 가지 인앱 켜기");
    await act(async () => t.mock.timers.tick(16_000));
    h.read(async () => response(ON));
    await act(async () => write.resolve(response(ON)));
    await act(async () => oldRead.resolve(response(OFF)));
    assert.equal(ui.container.querySelector('[role="switch"]')?.getAttribute("aria-checked"), "true");
  } finally { await ui.close(); t.mock.timers.reset(); }
});
