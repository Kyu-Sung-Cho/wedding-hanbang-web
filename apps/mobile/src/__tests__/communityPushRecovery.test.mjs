import assert from "node:assert/strict";
import test from "node:test";
import { act, createLoader, mount, press, deferred } from "./helpers/nativeReact.mjs";
function setup(initialSession = false) {
  let owner = "A", enabled = true, readError = true, saveMode = "ok", authPending = null, savePending = null, readPending = null, listener, token = "test-token", dispatchOwner = null;
  const writes = [];
  const supabase = { auth: {
    getUser(token) { const id = token ? token.slice(6) : owner; return authPending ?? Promise.resolve({ data: { user: id ? { id } : null }, error: null }); },
    async getSession() { return { data: { session: owner ? { user: { id: owner }, access_token: `token-${owner}` } : null }, error: null }; },
    onAuthStateChange(callback) { listener = callback; if (initialSession) globalThis.queueMicrotask(() => callback("INITIAL_SESSION", { user: { id: owner } })); return { data: { subscription: { unsubscribe() {} } } }; },
  }, rpc(name, args) {
    let authorization;
    const task = async () => {
      if (name === "community_get_reply_push_preference") return readPending ?? { data: enabled, error: readError ? new Error("offline") : null };
      if (dispatchOwner) owner = dispatchOwner;
      writes.push({ owner: authorization ? authorization.slice(13) : owner, enabled: args.p_enabled }); enabled = args.p_enabled;
      if (savePending) return savePending;
      if (saveMode === "lost") throw new Error("response lost");
      return { data: enabled, error: null };
    };
    const query = { abortSignal() { return query; }, setHeader(_name, value) { authorization = value; return query; }, then(resolve, reject) { return task().then(resolve, reject); } }; return query;
  } };
  const load = createLoader({ "@/lib/supabase": { supabase }, "@/lib/notifications": { registerForPushNotifications: async () => token } });
  return { Screen: load("components/settings/CommunityReplyPushPreferenceControl.tsx").default, writes,
    readable() { readError = false; }, lost() { saveMode = "lost"; },
    initial(value) { enabled = value; }, token(value) { token = value; },
    dispatchOwner(value) { dispatchOwner = value; },
    authPending(value) { authPending = value; }, savePending(value) { savePending = value; },
    readPending(value) { readPending = value; },
    async owner(next, notify = true) { owner = next; if (notify) await act(async () => listener?.("SIGNED_OUT", next ? { user: { id: next } } : null)); },
  };
}
test("a failed push preference read stays visible and has an explicit recoverable retry", async () => {
  const h = setup(); const ui = await mount(h.Screen);
  try {
    assert.match(ui.container.textContent, /확인하지 못했어요/);
    h.readable(); await press(ui.container, "설정 다시 확인하기");
    assert.equal(ui.container.querySelector('[role="switch"]')?.getAttribute("aria-checked"), "true");
  } finally { await ui.close(); }
});
test("the preference RPC cannot be written under a replacement session token at dispatch", async () => {
  const h = setup(); h.readable(); const ui = await mount(h.Screen);
  try {
    h.dispatchOwner("B");
    await press(ui.container, "커뮤니티 답글 외부 푸시 켜기");
    assert.equal(h.writes.length, 1);
    assert.equal(h.writes[0].owner, "A", "an action reviewed as A was sent using B credentials");
  } finally { await ui.close(); }
});
test("a changed owner detected after the RPC ends loading with recovery even before the auth notification", async () => {
  const h = setup(); const late = deferred(); h.readPending(late.promise);
  const ui = await mount(h.Screen);
  try {
    await h.owner("B", false);
    await act(async () => late.resolve({ data: true, error: null }));
    assert.ok(!ui.container.querySelector('[role="progressbar"]'), "ownership rejection must not leave loading forever");
    assert.ok(!ui.container.querySelector('[role="switch"]'));
    assert.match(ui.container.textContent, /로그인/);
  } finally { await ui.close(); }
});
test("initial auth notification still allows the first verified push preference to load", async () => {
  const h = setup(true); h.readable(); const ui = await mount(h.Screen);
  try { assert.ok(ui.container.querySelector('[role="switch"]'), "initial auth event cancelled the first read"); }
  finally { await ui.close(); }
});
test("device permission refusal explains why enabling stopped without a preference write", async () => {
  const h = setup(); h.readable(); h.initial(false); h.token(null); const ui = await mount(h.Screen);
  try {
    await press(ui.container, "커뮤니티 답글 외부 푸시 켜기");
    assert.match(ui.container.textContent, /휴대폰 알림을 허용/);
    assert.equal(ui.container.querySelector('[role="switch"]')?.getAttribute("aria-checked"), "false");
    assert.equal(h.writes.length, 0);
  } finally { await ui.close(); }
});
test("lost write response reconciles the server preference rather than claiming the old value survived", async () => {
  const h = setup(); h.readable(); h.lost(); const ui = await mount(h.Screen);
  try {
    await press(ui.container, "커뮤니티 답글 외부 푸시 켜기");
    assert.equal(ui.container.querySelector('[role="switch"]')?.getAttribute("aria-checked"), "false");
    assert.doesNotMatch(ui.container.textContent, /기존 설정은 그대로|휴대폰 알림을 허용한/);
    assert.equal(h.writes.length, 1);
  } finally { await ui.close(); }
});
test("a hung authentication read has a whole-operation deadline and cannot later replace the retry", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = setup(); const late = deferred(); h.authPending(late.promise);
  const ui = await mount(h.Screen);
  try {
    await act(async () => t.mock.timers.tick(10_001));
    assert.match(ui.container.textContent, /확인하지 못했어요/);
    assert.ok(!ui.container.querySelector('[role="progressbar"]'));
    h.authPending(null); h.readable(); await press(ui.container, "설정 다시 확인하기");
    await act(async () => late.resolve({ data: { user: { id: "OLD" } }, error: null }));
    assert.equal(ui.container.querySelector('[role="switch"]')?.getAttribute("aria-checked"), "true");
    assert.equal(h.writes.length, 0);
  } finally { await ui.close(); t.mock.timers.reset(); }
});
test("logout while a save is pending removes the old toggle and rejects the late result", async () => {
  const h = setup(); h.readable(); const ui = await mount(h.Screen);
  try {
    const late = deferred(); h.savePending(late.promise);
    await press(ui.container, "커뮤니티 답글 외부 푸시 켜기");
    await h.owner(null);
    assert.ok(!ui.container.querySelector('[role="progressbar"]'), "old save is still displayed after logout");
    assert.equal(ui.container.querySelector('[role="switch"]'), null);
    await act(async () => late.resolve({ data: false, error: null }));
    assert.equal(ui.container.querySelector('[role="switch"]'), null);
    assert.match(ui.container.textContent, /로그인/);
  } finally { await ui.close(); }
});
test("a timed-out write remains unknown until it settles and reconciliation reads the saved value", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = setup(); h.readable(); const ui = await mount(h.Screen);
  try {
    const late = deferred(); h.savePending(late.promise);
    await press(ui.container, "커뮤니티 답글 외부 푸시 켜기");
    await act(async () => t.mock.timers.tick(10_001));
    assert.ok(!ui.container.querySelector('[role="progressbar"]'), "save must stop appearing busy after its deadline");
    assert.match(ui.container.textContent, /저장 여부를 확인하지 못했어요/);
    await press(ui.container, "설정 다시 확인하기");
    assert.ok(!ui.container.querySelector('[role="switch"]'), "a read before the pending write settles is not a final save receipt");
    await act(async () => late.resolve({ data: false, error: null }));
    assert.equal(ui.container.querySelector('[role="switch"]')?.getAttribute("aria-checked"), "false");
    assert.equal(h.writes.length, 1);
  } finally { await ui.close(); t.mock.timers.reset(); }
});
test("A to B to A cannot publish a late preference result from the old generation", async () => {
  const h = setup(); h.readable(); const ui = await mount(h.Screen);
  try {
    const late = deferred(); h.savePending(late.promise);
    await press(ui.container, "커뮤니티 답글 외부 푸시 켜기");
    await h.owner("B"); await h.owner("A");
    h.initial(true); await press(ui.container, "설정 다시 확인하기");
    await act(async () => late.resolve({ data: false, error: null }));
    assert.equal(ui.container.querySelector('[role="switch"]')?.getAttribute("aria-checked"), "true");
  } finally { await ui.close(); }
});
