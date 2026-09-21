import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { act, createLoader, mount, press, deferred } from "./helpers/nativeReact.mjs";

function setup(screen = "my-posts", initialSession = false) {
  let owner = "A", rows = [], error = new Error("offline"), pending = null, authPending = null, listener, focus;
  let reads = 0;
  const auth = { getUser() { return authPending ?? Promise.resolve({ data: { user: owner ? { id: owner } : null }, error: null }); },
    onAuthStateChange(callback) { listener = callback; if (initialSession) globalThis.queueMicrotask(() => callback("INITIAL_SESSION", { user: { id: owner } })); return { data: { subscription: { unsubscribe() {} } } }; } };
  const supabase = { auth, from() { const query = { select() { return query; }, eq() { return query; }, abortSignal() { return query; },
    order() { return query; }, then(resolve, reject) { reads += 1; return (pending ?? Promise.resolve({ data: rows, error })).then(resolve, reject); } }; return query; } };
  const load = createLoader({ "@/lib/supabase": { supabase }, "expo-router": {
    router: { back() {}, push() {} }, useFocusEffect(callback) { focus = callback; React.useEffect(callback, [callback]); },
  } });
  return { Screen: load(`../app/community/${screen}.tsx`).default,
    success(next = []) { rows = next; error = null; pending = null; }, fail() { error = new Error("offline"); },
    pending(value) { pending = value; },
    authPending(value) { authPending = value; }, reads() { return reads; },
    async owner(next) { owner = next; await act(async () => listener?.("SIGNED_OUT", next ? { user: { id: next } } : null)); },
    async focus() { await act(async () => focus?.()); },
  };
}
test("my posts read failure is not empty success and explicit retry can recover", async () => {
  const h = setup(); const ui = await mount(h.Screen);
  try {
    assert.match(ui.container.textContent, /불러오지 못했어요/);
    assert.doesNotMatch(ui.container.textContent, /아직 작성한 글이 없어요/);
    h.success(); await press(ui.container, "다시 불러오기");
    assert.match(ui.container.textContent, /아직 작성한 글이 없어요/);
  } finally { await ui.close(); }
});
test("the initial Supabase session notification does not cancel the first owned list read", async () => {
  const h = setup("my-posts", true); h.success(); const ui = await mount(h.Screen);
  try { assert.match(ui.container.textContent, /아직 작성한 글이 없어요/); } finally { await ui.close(); }
});
test("list timeout covers authentication and a late auth result cannot replace a successful retry", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = setup(); const late = deferred(); h.authPending(late.promise);
  const ui = await mount(h.Screen);
  try {
    await act(async () => t.mock.timers.tick(10_001));
    assert.match(ui.container.textContent, /불러오지 못했어요/);
    assert.ok(!ui.container.querySelector('[role="progressbar"]'));
    h.authPending(null); h.success(); await press(ui.container, "다시 불러오기");
    await act(async () => late.resolve({ data: { user: { id: "STALE" } }, error: null }));
    assert.match(ui.container.textContent, /아직 작성한 글이 없어요/);
    assert.equal(h.reads(), 1);
  } finally { await ui.close(); t.mock.timers.reset(); }
});
test("refresh failures preserve owned rows, stay explicit, and overlapping retries cannot duplicate reads", async () => {
  const h = setup(); h.success([{ id: "p", title: "보존할 글", category: "free", created_at: "2026-09-20" }]);
  const ui = await mount(h.Screen);
  try {
    const late = deferred(); h.pending(late.promise);
    await press(ui.container, "당겨 새로고침"); await press(ui.container, "당겨 새로고침");
    assert.equal(h.reads(), 2);
    await act(async () => late.resolve({ data: null, error: new Error("offline") }));
    assert.match(ui.container.textContent, /보존할 글/);
    assert.match(ui.container.textContent, /불러오지 못했어요/);
  } finally { await ui.close(); }
});
test("mounted my posts clears the old account immediately on logout and ignores its late read", async () => {
  const h = setup(); h.success([{ id: "old", title: "A의 글", category: "free", created_at: "2026-09-20" }]);
  const ui = await mount(h.Screen);
  try {
    assert.match(ui.container.textContent, /A의 글/);
    const late = deferred(); h.pending(late.promise);
    await press(ui.container, "당겨 새로고침");
    await h.owner(null);
    assert.doesNotMatch(ui.container.textContent, /A의 글/);
    await act(async () => late.resolve({ data: [{ id: "old", title: "A의 늦은 글" }], error: null }));
    assert.doesNotMatch(ui.container.textContent, /A의/);
    assert.match(ui.container.textContent, /로그인/);
  } finally { await ui.close(); }
});
test("bookmark read failure is explicit and retry recovers a confirmed empty list", async () => {
  const h = setup("my-bookmarks"); const ui = await mount(h.Screen);
  try {
    assert.match(ui.container.textContent, /불러오지 못했어요/);
    assert.doesNotMatch(ui.container.textContent, /북마크한 글이 없어요/);
    h.success(); await press(ui.container, "다시 불러오기");
    assert.match(ui.container.textContent, /북마크한 글이 없어요/);
  } finally { await ui.close(); }
});
test("returning focus refreshes removed bookmarks without remounting the screen", async () => {
  const h = setup("my-bookmarks"); h.success([{ id: "bm", post: { id: "p", title: "저장한 글", category: "free", created_at: "2026-09-20" } }]);
  const ui = await mount(h.Screen);
  try {
    assert.match(ui.container.textContent, /저장한 글/);
    h.success([]); await h.focus();
    assert.doesNotMatch(ui.container.textContent, /저장한 글/);
    assert.match(ui.container.textContent, /북마크한 글이 없어요/);
  } finally { await ui.close(); }
});
test("A to B to A rejects a previous bookmark read even though the owner string matches again", async () => {
  const h = setup("my-bookmarks"); const late = deferred(); h.pending(late.promise);
  const ui = await mount(h.Screen);
  try {
    await h.owner("B"); await h.owner("A");
    h.success(); await press(ui.container, "다시 불러오기");
    await act(async () => late.resolve({ data: [{ id: "old", post: { id: "old", title: "오래된 결과", created_at: "2026-09-20" } }], error: null }));
    assert.doesNotMatch(ui.container.textContent, /오래된 결과/);
    assert.match(ui.container.textContent, /북마크한 글이 없어요/);
  } finally { await ui.close(); }
});
