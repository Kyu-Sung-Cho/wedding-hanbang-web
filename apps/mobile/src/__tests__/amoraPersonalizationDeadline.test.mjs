import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import ts from "typescript";
import * as sessionModule from "../lib/amoraPersonalizationSession.mjs";
import { DEFAULT_AMORA_PERSONALIZATION } from "@hanbang/shared/amora-personalization";
import { AMORA_STYLE_COPY, createAmoraPersonalizationSession, viewAmoraPersonalization } from "../lib/amoraPersonalizationSession.mjs";

const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const response = body => new globalThis.Response(JSON.stringify(body));
const profile = (toneStyle = "adaptive", revision = 1) => ({
  preferences: { ...DEFAULT_AMORA_PERSONALIZATION, toneStyle }, revision,
  confirmedAt: "2026-09-19T00:00:00.000Z", updatedAt: "2026-09-19T00:00:00.000Z",
});
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
async function bounded(promise) {
  const sentinel = Symbol("still pending");
  const result = await Promise.race([promise, delay(100).then(() => sentinel)]);
  assert.notEqual(result, sentinel, "the operation must leave its loading state by the configured deadline");
  return result;
}

test("a personalization load stalled in the request/auth boundary becomes retryable and ignores a late response", async () => {
  const pending = deferred();
  let signal;
  const session = createAmoraPersonalizationSession(async (_owner, _path, init) => {
    signal = init.signal;
    return pending.promise;
  }, { initialOwnerId: owner, timeoutMs: 10 });
  assert.equal(await bounded(session.load()), false);
  assert.equal(session.getState().status, "error");
  assert.equal(session.getState().pending, null);
  assert.equal(session.getState().error, AMORA_STYLE_COPY.loadFailed);
  assert.equal(signal.aborted, true);
  pending.resolve(response({ profile: profile("warm") }));
  await delay(0);
  assert.equal(session.getState().status, "error");
  assert.equal(session.getState().profile, null);
});

test("a committed save with a stalled response body is unknown until reload confirms the server value, without a second write", async () => {
  const body = deferred();
  const calls = [];
  let saved = profile();
  const session = createAmoraPersonalizationSession(async (_owner, _path, init) => {
    calls.push(init);
    if (init.method === "PUT") {
      saved = profile("warm", 2);
      return { ok: true, status: 200, json: () => body.promise };
    }
    return response({ profile: saved });
  }, { initialOwnerId: owner, timeoutMs: 10, readSessionOwner: async () => owner });
  assert.equal(await session.load(), true);
  session.select("toneStyle", "warm");
  assert.equal(await bounded(session.save()), false);
  assert.equal(session.getState().status, "error");
  assert.equal(session.getState().pending, null);
  assert.equal(session.getState().error, AMORA_STYLE_COPY.saveUnverified);
  assert.equal(session.getState().notice, null);
  assert.equal(viewAmoraPersonalization(session.getState()).canSave, false);
  body.resolve({ profile: saved });
  await delay(0);
  assert.equal(session.getState().notice, null, "a late acknowledgement must not silently turn into success");
  assert.equal(await session.load(), true);
  assert.deepEqual(session.getState().profile, saved);
  assert.equal(session.getState().draft, null);
  assert.deepEqual(calls.map(call => call.method), ["GET", "PUT", "GET"]);
});

test("reset completion waiting on the final auth check expires as unknown and reload reconciles deletion", async () => {
  const auth = deferred();
  let stallAuth = false;
  let saved = profile();
  const session = createAmoraPersonalizationSession(async (_owner, _path, init) => {
    if (init.method === "DELETE") {
      saved = null;
      return response({ deleted: true, profile: null });
    }
    return response({ profile: saved });
  }, { initialOwnerId: owner, timeoutMs: 10, readSessionOwner: () => stallAuth ? auth.promise : Promise.resolve(owner) });
  await session.load();
  stallAuth = true;
  assert.equal(await bounded(session.reset()), false);
  assert.equal(session.getState().status, "error");
  assert.equal(session.getState().pending, null);
  assert.equal(session.getState().error, AMORA_STYLE_COPY.resetUnverified);
  assert.equal(session.getState().notice, null);
  stallAuth = false;
  await session.load();
  auth.resolve(owner);
  await delay(0);
  assert.equal(session.getState().status, "ready");
  assert.equal(session.getState().profile, null);
  assert.equal(session.getState().notice, null);
});

// Compile the actual screen and exercise its mount/auth/retry callbacks with only native/React boundaries replaced.
function mountScreen(readOwner, request) {
  const source = readFileSync(new URL("../../app/settings/amora-style.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const holder = { session: null, effects: [], authListener: null };
  const tokens = new Proxy(() => tokens, { get: () => tokens });
  const jsx = (type, props) => ({ type, props });
  const dependencies = {
    react: { useState: init => [holder.session ??= init(), () => {}], useSyncExternalStore: (_s, get) => get(), useEffect: effect => holder.effects.push(effect) },
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "react-native": { Alert: { alert() {} }, Pressable: "Pressable", ScrollView: "ScrollView", View: "View", StyleSheet: { create: x => x } },
    "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
    "expo-router": { router: { back() {} } },
    "lucide-react-native": { Check: "Check", RotateCcw: "RotateCcw", ShieldCheck: "ShieldCheck", SlidersHorizontal: "SlidersHorizontal" },
    "@hanbang/design-tokens": { colors: tokens, spacing: tokens, radius: tokens },
    "@/components/ui/AppUI": Object.fromEntries(["AppHeader", "AppText", "LoadingState", "PrimaryButton", "Surface"].map(name => [name, name])),
    "@/lib/api": { apiFetchForExpectedUser: request },
    "@/lib/supabase": { supabase: { auth: {
      getSession: async () => { const id = await readOwner(); return { data: { session: id ? { user: { id } } : null } }; },
      onAuthStateChange: listener => { holder.authListener = listener; return { data: { subscription: { unsubscribe() {} } } }; },
    } } },
    "@/lib/amoraPersonalizationSession.mjs": { ...sessionModule, createAmoraPersonalizationSession: (fn, options) => createAmoraPersonalizationSession(fn, { ...options, timeoutMs: 10 }) },
  };
  const module = { exports: {} };
  new Function("exports", "require", compiled)(module.exports, specifier => {
    assert.ok(Object.hasOwn(dependencies, specifier), specifier);
    return dependencies[specifier];
  });
  const render = module.exports.default;
  render();
  const cleanup = holder.effects.splice(0).map(effect => effect());
  return { holder, render, dispose: () => cleanup.forEach(fn => fn?.()) };
}

test("opening settings with a stalled initial auth read leaves loading and offers reload without dispatching a request", async () => {
  const auth = deferred();
  const calls = [];
  const screen = mountScreen(() => auth.promise, async (...args) => { calls.push(args); return response({ profile: null }); });
  await delay(35);
  assert.equal(screen.holder.session.getState().status, "error");
  assert.equal(screen.holder.session.getState().error, AMORA_STYLE_COPY.loadFailed);
  assert.equal(calls.length, 0);
  auth.resolve(owner);
  await delay(0);
  assert.equal(screen.holder.session.getState().status, "error");
  assert.equal(calls.length, 0, "expired authentication must not later dispatch a request");
  screen.dispose();
});

test("after an unconfirmed save reload keeps unsaved choices if the server still has the old revision", async () => {
  const put = deferred();
  const calls = [];
  const saved = profile();
  const session = createAmoraPersonalizationSession(async (_owner, _path, init) => {
    calls.push(init.method);
    return init.method === "PUT" ? put.promise : response({ profile: saved });
  }, { initialOwnerId: owner, timeoutMs: 10 });
  await session.load();
  session.select("toneStyle", "warm");
  await bounded(session.save());
  await session.load();
  assert.deepEqual(session.getState().profile, saved, "only the readback revision is confirmed");
  assert.equal(viewAmoraPersonalization(session.getState()).selected.toneStyle, "warm", "the user's unconfirmed choice survives reconciliation");
  assert.equal(viewAmoraPersonalization(session.getState()).canSave, true);
  assert.equal(session.getState().notice, null);
  assert.equal(session.getState().error, AMORA_STYLE_COPY.saveUnverified);
  assert.deepEqual(calls, ["GET", "PUT", "GET"], "no write is automatically retried");
  put.resolve(response({ profile: profile("warm", 2) }));
  await delay(0);
  assert.deepEqual(session.getState().profile, saved, "late data cannot overwrite the newer readback");
});

test("account switch cancels the old request immediately and a late result cannot restore its choices", async () => {
  const old = deferred();
  let oldSignal;
  const session = createAmoraPersonalizationSession(async (expectedOwner, _path, init) => {
    if (expectedOwner === owner) { oldSignal = init.signal; return old.promise; }
    return response({ profile: profile("calm_clear", 4) });
  }, { initialOwnerId: owner, timeoutMs: 1000 });
  const previousLoad = session.load();
  session.setOwner(other);
  assert.equal(oldSignal.aborted, true);
  assert.equal(await bounded(previousLoad), false);
  await session.load();
  const current = session.getState();
  old.resolve(response({ profile: profile("warm", 9) }));
  await delay(0);
  assert.deepEqual(session.getState(), current);
  assert.equal(current.ownerId, other);
  assert.equal(current.status, "ready");
  assert.equal(current.profile.preferences.toneStyle, "calm_clear");
  assert.equal(current.draft, null);
});

test("a network error after a committed write is unverified, never reported as a confirmed failed save", async () => {
  let saved = profile();
  const session = createAmoraPersonalizationSession(async (_owner, _path, init) => {
    if (init.method === "PUT") { saved = profile("warm", 2); throw new Error("connection lost after commit"); }
    return response({ profile: saved });
  }, { initialOwnerId: owner, timeoutMs: 10 });
  await session.load();
  session.select("toneStyle", "warm");
  assert.equal(await session.save(), false);
  assert.equal(session.getState().error, AMORA_STYLE_COPY.saveUnverified);
  assert.equal(session.getState().status, "error");
  assert.equal(await session.load(), true);
  assert.deepEqual(session.getState().profile, saved);
  assert.equal(session.getState().draft, null);
});

test("a lost reset acknowledgement requires reload instead of claiming deletion failed", async () => {
  let saved = profile();
  const session = createAmoraPersonalizationSession(async (_owner, _path, init) => {
    if (init.method === "DELETE") { saved = null; throw new Error("lost acknowledgement"); }
    return response({ profile: saved });
  }, { initialOwnerId: owner, timeoutMs: 10 });
  await session.load();
  assert.equal(await session.reset(), false);
  assert.equal(session.getState().status, "error");
  assert.equal(session.getState().error, AMORA_STYLE_COPY.resetUnverified);
  assert.equal(await session.load(), true);
  assert.equal(session.getState().profile, null);
});

test("GET body and final owner verification use the same bounded loading lifecycle", async () => {
  for (const phase of ["body", "owner"]) {
    const pending = deferred();
    const session = createAmoraPersonalizationSession(async () => phase === "body"
      ? { ok: true, status: 200, json: () => pending.promise } : response({ profile: profile() }),
    { initialOwnerId: owner, timeoutMs: 10, readSessionOwner: () => phase === "owner" ? pending.promise : Promise.resolve(owner) });
    assert.equal(await bounded(session.load()), false, phase);
    assert.equal(session.getState().status, "error", phase);
    pending.resolve(phase === "body" ? { profile: profile("warm") } : owner);
    await delay(0);
    assert.equal(session.getState().profile, null, phase);
  }
});

test("timeout recovery choices never cross an A to B to A account switch", async () => {
  const pending = deferred();
  const session = createAmoraPersonalizationSession(async (_owner, _path, init) => init.method === "PUT"
    ? pending.promise : response({ profile: profile() }), { initialOwnerId: owner, timeoutMs: 10 });
  await session.load();
  session.select("toneStyle", "warm");
  await bounded(session.save());
  session.setOwner(other);
  await session.load();
  session.setOwner(owner);
  await session.load();
  assert.equal(session.getState().draft, null);
  assert.equal(viewAmoraPersonalization(session.getState()).selected.toneStyle, "adaptive");
  pending.resolve(response({ profile: profile("warm", 2) }));
  await delay(0);
  assert.equal(session.getState().profile.revision, 1);
  session.dispose();
});
