import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Buffer } from "node:buffer";
import { URL } from "node:url";
import test from "node:test";
import ts from "typescript";

function loadStorage(secureStore) {
  const load = (name) => {
    const source = readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), "utf8");
    const compiled = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    });
    const exports = {};
    const require = (id) => {
      if (id === "react-native-url-polyfill/auto") return {};
      if (id === "@supabase/supabase-js") return { createClient: (_url, _key, options) => options.auth.storage };
      if (id === "expo-secure-store") return secureStore;
      if (id === "react-native") return { Platform: { OS: "ios" } };
      if (id === "./webAuthStorage.mjs") return { createBrowserAuthStorage: () => ({}) };
      if (id.startsWith("./")) return load(id.slice(2));
      throw new Error(`Unexpected import: ${id}`);
    };
    new Function("exports", "require", "process", compiled.outputText)(exports, require, {
      env: { EXPO_PUBLIC_SUPABASE_URL: "https://example.test", EXPO_PUBLIC_SUPABASE_ANON_KEY: "test" },
    });
    return exports;
  };
  return load("supabase").supabase;
}

function deviceStorage() {
  const values = new Map();
  return {
    values,
    failWrite: null,
    async getItemAsync(key) { return values.get(key) ?? null; },
    async setItemAsync(key, value) {
      if (this.failWrite?.(key, value)) throw new Error("User interaction is not allowed");
      values.set(key, value);
    },
    async deleteItemAsync(key) { values.delete(key); },
  };
}

test("a failed session refresh preserves the previous session after app restart", async () => {
  const device = deviceStorage();
  const storage = loadStorage(device);
  await storage.setItem("session", "original-session");
  device.failWrite = () => true;
  await assert.rejects(storage.setItem("session", "refreshed-session"), /User interaction/);
  device.failWrite = null;
  assert.equal(await loadStorage(device).getItem("session"), "original-session");
});

test("every failed write boundary in a chunked replacement preserves the committed session", async () => {
  const seed = deviceStorage();
  await loadStorage(seed).setItem("session", "old".repeat(1400));
  const original = new Map(seed.values);
  let writeCount = 0;
  seed.failWrite = () => { writeCount += 1; return false; };
  await loadStorage(seed).setItem("session", "new".repeat(1900));

  for (let failure = 1; failure <= writeCount; failure += 1) {
    const device = deviceStorage();
    for (const [key, value] of original) device.values.set(key, value);
    let attempt = 0;
    device.failWrite = () => ++attempt === failure;
    await assert.rejects(loadStorage(device).setItem("session", "new".repeat(1900)), /User interaction/);
    device.failWrite = null;
    const restarted = loadStorage(device);
    assert.equal(await restarted.getItem("session"), "old".repeat(1400), `write ${failure}`);
    await restarted.setItem("session", "retry-session");
    assert.equal(await loadStorage(device).getItem("session"), "retry-session");
  }
});

test("legacy single and chunked sessions survive failed migration and migrate on success", async () => {
  for (const chunked of [false, true]) {
    const device = deviceStorage();
    if (chunked) {
      device.values.set("session.chunks", "2");
      device.values.set("session.chunk.0", "legacy-");
      device.values.set("session.chunk.1", "session");
    } else device.values.set("session", "legacy-session");
    const storage = loadStorage(device);
    assert.equal(await storage.getItem("session"), "legacy-session");
    device.failWrite = () => true;
    await assert.rejects(storage.setItem("session", "new-session"));
    device.failWrite = null;
    assert.equal(await loadStorage(device).getItem("session"), "legacy-session");
    await storage.setItem("session", "new-session");
    assert.equal(await loadStorage(device).getItem("session"), "new-session");
    assert.equal(device.values.has("session"), false);
    assert.equal(device.values.has("session.chunk.0"), false);
  }
});

test("concurrent refreshes and reads return complete sessions in invocation order", async () => {
  const device = deviceStorage();
  const storage = loadStorage(device);
  const first = "first".repeat(1600);
  const second = "second".repeat(1700);
  const results = await Promise.all([
    storage.setItem("session", first),
    storage.getItem("session"),
    storage.setItem("session", second),
    storage.getItem("session"),
  ]);
  assert.equal(results[1], first);
  assert.equal(results[3], second);
  assert.equal(await loadStorage(device).getItem("session"), second);
});

test("one failed refresh does not poison a newer queued refresh", async () => {
  const device = deviceStorage();
  const storage = loadStorage(device);
  await storage.setItem("session", "original-session");
  let writes = 0;
  device.failWrite = () => ++writes === 2;
  const results = await Promise.allSettled([
    storage.setItem("session", "failed-session"),
    storage.setItem("session", "newest-session"),
  ]);
  assert.equal(results[0].status, "rejected");
  assert.equal(results[1].status, "fulfilled");
  assert.equal(await loadStorage(device).getItem("session"), "newest-session");
});

test("logout ordered after refresh cannot be undone by unfinished writes or cleanup failure", async () => {
  const device = deviceStorage();
  device.values.set("session", "legacy-session");
  device.deleteItemAsync = async () => { throw new Error("device cleanup unavailable"); };
  const storage = loadStorage(device);
  await Promise.all([storage.setItem("session", "new".repeat(900)), storage.removeItem("session")]);
  assert.equal(await storage.getItem("session"), null);
  assert.equal(await loadStorage(device).getItem("session"), null);
  await storage.setItem("session", "signed-in-again");
  assert.equal(await loadStorage(device).getItem("session"), "signed-in-again");
});

test("failed logout is reported and the durable session remains readable", async () => {
  const device = deviceStorage();
  const storage = loadStorage(device);
  await storage.setItem("session", "original-session");
  device.failWrite = () => true;
  await assert.rejects(storage.removeItem("session"), /User interaction/);
  device.failWrite = null;
  assert.equal(await loadStorage(device).getItem("session"), "original-session");
});

test("a native error after a successful commit never deletes the new session chunks", async () => {
  const device = deviceStorage();
  const storage = loadStorage(device);
  await storage.setItem("session", "old-session");
  const write = device.setItemAsync.bind(device);
  device.setItemAsync = async (key, value) => {
    await write(key, value);
    if (key === "session.v2") throw new Error("native response interrupted");
  };
  await assert.rejects(storage.setItem("session", "new".repeat(1000)), /interrupted/);
  assert.equal(await loadStorage(device).getItem("session"), "new".repeat(1000));
});

test("UTF-8 chunk limits preserve Unicode, newlines, and empty values exactly", async () => {
  const device = deviceStorage();
  const write = device.setItemAsync.bind(device);
  device.setItemAsync = async (key, value) => {
    assert.ok(Buffer.byteLength(value, "utf8") <= 1800, key);
    await write(key, value);
  };
  const storage = loadStorage(device);
  for (const value of ["한글💒\n".repeat(1500), "\n".repeat(2000), ""]) {
    await storage.setItem("session", value);
    assert.equal(await loadStorage(device).getItem("session"), value);
  }
});

test("transient device reads use only the last committed memory value", async () => {
  const device = deviceStorage();
  const storage = loadStorage(device);
  await storage.setItem("session", "old-session");
  device.failWrite = () => true;
  await assert.rejects(storage.setItem("session", "failed-session"));
  device.getItemAsync = async () => { throw new Error("User interaction is not allowed"); };
  assert.equal(await storage.getItem("session"), "old-session");
  assert.equal(await loadStorage(device).getItem("session"), null);
});

test("invalid or incomplete new storage never revives an older legacy session", async () => {
  for (const manifest of ["invalid-json", '{"slot":0,"count":999999999}', '{"slot":0,"count":2}']) {
    const device = deviceStorage();
    device.values.set("session", "legacy-session");
    device.values.set("session.v2", manifest);
    await assert.rejects(loadStorage(device).getItem("session"));
    assert.equal(device.values.get("session"), "legacy-session");
  }
});
