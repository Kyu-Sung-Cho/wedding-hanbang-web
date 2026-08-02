import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

const sourcePath = fileURLToPath(new URL("../lib/supabase.ts", import.meta.url));

function loadStorage(secureStore, platform = { OS: "ios" }, asyncStorage = {
  getItem: async () => "installed",
  setItem: async () => undefined,
  removeItem: async () => undefined,
}) {
  const sourceText = readFileSync(sourcePath, "utf8");
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const names = new Set([
    "SECURE_CHUNK_SIZE",
    "MAX_SECURE_SESSION_BYTES",
    "MAX_SECURE_CHUNKS",
    "memorySessionCache",
    "SECURE_STORE_WRITE_OPTIONS",
    "INSTALLATION_SENTINEL_KEY",
    "INSTALLATION_SENTINEL_VALUE",
    "legacyAsyncStorageCleanupByKey",
    "installationBoundaryByKey",
    "isTransientSecureStoreError",
    "secureStoreKey",
    "chunkMetaKey",
    "chunkKey",
    "utf8ByteLength",
    "splitSecureStoreChunks",
    "parseChunkCount",
    "chunkKeys",
    "deleteSecureStoreKeys",
    "deleteSessionData",
    "ensureLegacyAsyncStorageSessionRemoved",
    "ensureCurrentInstallation",
    "LargeSecureStore",
  ]);
  const declarations = sourceFile.statements
    .filter((statement) => {
      if (ts.isFunctionDeclaration(statement)) return names.has(statement.name?.text ?? "");
      if (!ts.isVariableStatement(statement)) return false;
      return statement.declarationList.declarations.some(
        (declaration) => ts.isIdentifier(declaration.name) && names.has(declaration.name.text),
      );
    })
    .map((statement) => statement.getFullText(sourceFile).replace(/\bexport\s+/g, ""))
    .join("\n");
  const compiled = ts.transpileModule(declarations, {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
  });
  return new Function(
    "SecureStore",
    "Platform",
    "AsyncStorage",
    `${compiled.outputText}\nreturn { LargeSecureStore, memorySessionCache, MAX_SECURE_SESSION_BYTES, MAX_SECURE_CHUNKS };`,
  )(secureStore, platform, asyncStorage);
}

function createSecureStoreMock() {
  const values = new Map();
  const deleteCalls = [];
  const deleteFailures = new Set();
  const setFailures = new Set();
  const setCalls = [];
  const asyncValues = new Map([["hanbang.secure-session.installation.v1", "installed"]]);
  const asyncSetCalls = [];
  const asyncRemoveCalls = [];
  const asyncRemoveFailures = new Set();
  let readFailure = null;

  return {
    values,
    deleteCalls,
    deleteFailures,
    setFailures,
    setCalls,
    asyncValues,
    asyncSetCalls,
    asyncRemoveCalls,
    asyncRemoveFailures,
    setReadFailure(error) {
      readFailure = error;
    },
    api: {
      WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6,
      async getItemAsync(key) {
        if (readFailure) throw readFailure;
        return values.get(key) ?? null;
      },
      async setItemAsync(key, value, options) {
        if (setFailures.has(key)) throw new Error(`set failed: ${key}`);
        setCalls.push({ key, options });
        values.set(key, value);
      },
      async deleteItemAsync(key) {
        deleteCalls.push(key);
        if (deleteFailures.has(key)) throw new Error(`delete failed: ${key}`);
        values.delete(key);
      },
    },
    asyncStorage: {
      async getItem(key) {
        return asyncValues.get(key) ?? null;
      },
      async setItem(key, value) {
        asyncSetCalls.push({ key, value });
        asyncValues.set(key, value);
      },
      async removeItem(key) {
        asyncRemoveCalls.push(key);
        if (asyncRemoveFailures.has(key)) {
          throw new Error(`async remove failed: ${key}`);
        }
        asyncValues.delete(key);
      },
    },
  };
}

test("legacy plaintext session is purged without deleting the current SecureStore session", async () => {
  const mock = createSecureStoreMock();
  mock.asyncValues.set("session", "legacy-plaintext-session");
  mock.values.set("session", "current-secure-session");
  const { LargeSecureStore } = loadStorage(
    mock.api,
    { OS: "android" },
    mock.asyncStorage,
  );

  assert.equal(await LargeSecureStore.getItem("session"), "current-secure-session");
  assert.equal(mock.asyncValues.has("session"), false);
  assert.equal(mock.values.get("session"), "current-secure-session");
  assert.deepEqual(mock.asyncRemoveCalls, ["session"]);

  assert.equal(await LargeSecureStore.getItem("session"), "current-secure-session");
  assert.deepEqual(mock.asyncRemoveCalls, ["session"]);
});

test("legacy plaintext cleanup failure blocks auth reads and remains retryable", async () => {
  const mock = createSecureStoreMock();
  mock.asyncValues.set("session", "legacy-plaintext-session");
  mock.values.set("session", "current-secure-session");
  mock.asyncRemoveFailures.add("session");
  const { LargeSecureStore } = loadStorage(
    mock.api,
    { OS: "android" },
    mock.asyncStorage,
  );

  await assert.rejects(
    () => LargeSecureStore.getItem("session"),
    /async remove failed/,
  );
  assert.equal(mock.asyncValues.get("session"), "legacy-plaintext-session");
  assert.equal(mock.values.get("session"), "current-secure-session");

  mock.asyncRemoveFailures.clear();
  assert.equal(await LargeSecureStore.getItem("session"), "current-secure-session");
  assert.equal(mock.asyncValues.has("session"), false);
  assert.deepEqual(mock.asyncRemoveCalls, ["session", "session"]);
});

test("SecureStore deletion failure rejects sign-out and clears the in-memory session fallback", async () => {
  const mock = createSecureStoreMock();
  const { LargeSecureStore } = loadStorage(mock.api);
  await LargeSecureStore.setItem("session", "secret-session");
  mock.deleteFailures.add("session");

  await assert.rejects(() => LargeSecureStore.removeItem("session"), /delete failed/);

  mock.setReadFailure(new Error("User interaction is not allowed"));
  assert.equal(await LargeSecureStore.getItem("session"), null);
});

test("every persisted session fragment is device-bound and only readable while unlocked", async () => {
  const single = createSecureStoreMock();
  const singleStorage = loadStorage(single.api);
  await singleStorage.LargeSecureStore.setItem("session", "secret-session");

  assert.deepEqual(single.setCalls, [
    {
      key: "session",
      options: { keychainAccessible: single.api.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
    },
  ]);

  const chunked = createSecureStoreMock();
  const chunkedStorage = loadStorage(chunked.api);
  await chunkedStorage.LargeSecureStore.setItem("session", "x".repeat(4_000));

  assert.equal(chunked.setCalls.length > 2, true);
  assert.equal(
    chunked.setCalls.every(
      (call) => call.options?.keychainAccessible === chunked.api.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    ),
    true,
  );
});

test("iOS clears a surviving Keychain session before first read after reinstall", async () => {
  const mock = createSecureStoreMock();
  mock.asyncValues.clear();
  mock.values.set("session", "surviving-old-session");
  mock.values.set("session.chunk.0", "surviving-fragment");
  mock.values.set("session.chunks", "1");
  const { LargeSecureStore } = loadStorage(mock.api, { OS: "ios" }, mock.asyncStorage);

  assert.equal(await LargeSecureStore.getItem("session"), null);
  assert.deepEqual([...mock.values.keys()], []);
  assert.deepEqual(mock.asyncSetCalls, [
    {
      key: "hanbang.secure-session.installation.v1",
      value: "installed",
    },
  ]);
});

test("chunked session removal attempts every key and never reports partial deletion as success", async () => {
  const mock = createSecureStoreMock();
  const { LargeSecureStore, MAX_SECURE_CHUNKS } = loadStorage(mock.api);
  await LargeSecureStore.setItem("session", "x".repeat(4_000));
  mock.deleteCalls.length = 0;
  mock.deleteFailures.add("session.chunk.1");

  await assert.rejects(() => LargeSecureStore.removeItem("session"), /delete failed/);

  assert.equal(mock.deleteCalls.includes("session"), true);
  assert.equal(mock.deleteCalls.includes("session.chunk.1"), true);
  assert.equal(mock.deleteCalls.includes(`session.chunk.${MAX_SECURE_CHUNKS - 1}`), true);
  assert.equal(mock.deleteCalls.includes("session.chunks"), false);
  assert.equal(mock.values.has("session.chunk.1"), true);
  assert.equal(mock.values.has("session.chunks"), true);

  mock.deleteFailures.clear();
  await LargeSecureStore.removeItem("session");

  assert.deepEqual([...mock.values.keys()], []);
});

test("successful session removal deletes primary, chunks, and metadata", async () => {
  const mock = createSecureStoreMock();
  const { LargeSecureStore } = loadStorage(mock.api);
  await LargeSecureStore.setItem("session", "x".repeat(4_000));

  await LargeSecureStore.removeItem("session");

  assert.deepEqual([...mock.values.keys()], []);
  assert.equal(await LargeSecureStore.getItem("session"), null);
});

test("partial chunk writes are swept before the failed persistence call returns", async () => {
  const mock = createSecureStoreMock();
  const { LargeSecureStore } = loadStorage(mock.api);
  mock.setFailures.add("session.chunk.1");

  await assert.rejects(
    () => LargeSecureStore.setItem("session", "x".repeat(4_000)),
    /set failed/,
  );

  assert.deepEqual([...mock.values.keys()], []);

  const manifestFailure = createSecureStoreMock();
  const manifestStorage = loadStorage(manifestFailure.api);
  manifestFailure.setFailures.add("session.chunks");

  await assert.rejects(
    () => manifestStorage.LargeSecureStore.setItem("session", "x".repeat(4_000)),
    /set failed/,
  );
  assert.deepEqual([...manifestFailure.values.keys()], []);
});

test("missing or corrupt chunk metadata triggers a bounded deterministic sweep", async () => {
  const missingMetadata = createSecureStoreMock();
  const missingStorage = loadStorage(missingMetadata.api);
  missingMetadata.values.set(
    `session.chunk.${missingStorage.MAX_SECURE_CHUNKS - 1}`,
    "orphaned-secret-fragment",
  );

  assert.equal(await missingStorage.LargeSecureStore.getItem("session"), null);
  assert.deepEqual([...missingMetadata.values.keys()], []);

  const corruptMetadata = createSecureStoreMock();
  const corruptStorage = loadStorage(corruptMetadata.api);
  corruptMetadata.values.set("session", "legacy-secret");
  corruptMetadata.values.set("session.chunk.0", "orphaned-secret-fragment");
  corruptMetadata.values.set("session.chunks", String(corruptStorage.MAX_SECURE_CHUNKS + 1));

  assert.equal(await corruptStorage.LargeSecureStore.getItem("session"), null);
  assert.deepEqual([...corruptMetadata.values.keys()], []);
});

test("session size is byte-bounded and UTF-8 chunks round-trip without splitting characters", async () => {
  const mock = createSecureStoreMock();
  const { LargeSecureStore, MAX_SECURE_SESSION_BYTES } = loadStorage(mock.api);
  const multibyteSession = "한".repeat(1_000);

  await LargeSecureStore.setItem("session", multibyteSession);
  assert.equal(Number(mock.values.get("session.chunks")) > 1, true);
  assert.equal(await LargeSecureStore.getItem("session"), multibyteSession);

  await assert.rejects(
    () => LargeSecureStore.setItem("session", "x".repeat(MAX_SECURE_SESSION_BYTES + 1)),
    /size limit/,
  );
  assert.deepEqual([...mock.values.keys()], []);
});
