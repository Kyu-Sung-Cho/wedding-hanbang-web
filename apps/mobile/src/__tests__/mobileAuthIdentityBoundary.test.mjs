import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

const identityPath = fileURLToPath(new URL("../lib/mobileAuthIdentity.ts", import.meta.url));

function read(relativePath) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

function loadIdentityBoundary() {
  const source = readFileSync(identityPath, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const module = { exports: {} };
  new Function("module", "exports", compiled.outputText)(module, module.exports);
  return module.exports;
}

function loadAuthListener(identity, overrides = {}) {
  const source = read("../lib/authListener.ts");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const timers = [];
  const cacheOwners = [];
  const redirects = [];
  let authCallback = null;
  const auth = {
    startAutoRefresh() {},
    stopAutoRefresh() {},
    onAuthStateChange(callback) {
      authCallback = callback;
      return { data: { subscription: { unsubscribe() {} } } };
    },
    getSession: () => new Promise(() => {}),
    getUser: async () => ({ data: { user: null }, error: null }),
    ...overrides.auth,
  };
  const require = (specifier) => {
    if (specifier === "./supabase") return { supabase: { auth } };
    if (specifier === "expo-router") return { router: { replace: (path) => redirects.push(path) } };
    if (specifier === "react-native") {
      return {
        AppState: {
          currentState: "active",
          addEventListener: () => ({ remove() {} }),
        },
      };
    }
    if (specifier === "./communityPostCache") {
      return { setCommunityCacheOwner: (owner) => cacheOwners.push(owner) };
    }
    if (specifier === "./mobileAuthIdentity") return identity;
    throw new Error(`Unexpected auth-listener dependency: ${specifier}`);
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", "setTimeout", "__DEV__", compiled.outputText)(
    require,
    module,
    module.exports,
    (callback) => {
      timers.push(callback);
      return timers.length;
    },
    true,
  );
  return {
    auth,
    cacheOwners,
    redirects,
    emit(event, userId) {
      assert.ok(authCallback, "auth listener must be initialized before events are emitted");
      authCallback(event, userId ? { user: { id: userId } } : null);
    },
    async flushTimers() {
      while (timers.length > 0) timers.shift()();
      await Promise.resolve();
      await Promise.resolve();
    },
    listener: module.exports,
  };
}

test("A to B transition invalidates A synchronously and rejects stale verification", () => {
  const identity = loadIdentityBoundary();
  const first = identity.beginMobileAuthIdentityTransition("user-a");
  assert.equal(first.changed, true);
  assert.equal(identity.completeMobileAuthIdentityTransition(first.generation, "user-a"), true);

  const expectedA = identity.captureMobileAuthIdentityExpectation("user-a");
  assert.ok(expectedA);
  assert.equal(identity.isCurrentMobileAuthIdentity(expectedA), true);

  const second = identity.beginMobileAuthIdentityTransition("user-b");
  assert.equal(second.changed, true);
  assert.equal(identity.getMobileAuthIdentitySnapshot().status, "verifying");
  assert.equal(identity.isCurrentMobileAuthIdentity(expectedA), false);
  assert.equal(
    identity.completeMobileAuthIdentityTransition(first.generation, "user-a"),
    false,
  );
  assert.equal(identity.completeMobileAuthIdentityTransition(second.generation, "user-b"), true);
  assert.deepEqual(identity.captureMobileAuthIdentityExpectation("user-b"), {
    userId: "user-b",
    generation: second.generation,
  });
});

test("same-user token events preserve the navigator generation while sign-out remounts it", () => {
  const identity = loadIdentityBoundary();
  const signedIn = identity.beginMobileAuthIdentityTransition("user-a");
  identity.completeMobileAuthIdentityTransition(signedIn.generation, "user-a");
  const authenticated = identity.getMobileAuthIdentitySnapshot();
  const authenticatedKey = identity.mobileAuthNavigationKey(authenticated);

  const refreshed = identity.beginMobileAuthIdentityTransition("user-a");
  assert.equal(refreshed.changed, false);
  assert.equal(identity.mobileAuthNavigationKey(identity.getMobileAuthIdentitySnapshot()), authenticatedKey);

  const signedOut = identity.beginMobileAuthIdentityTransition(null);
  assert.equal(signedOut.changed, true);
  assert.equal(identity.completeMobileAuthIdentityTransition(signedOut.generation, null), true);
  const anonymous = identity.getMobileAuthIdentitySnapshot();
  assert.equal(anonymous.status, "anonymous");
  assert.notEqual(identity.mobileAuthNavigationKey(anonymous), authenticatedKey);
});

test("auth listener gates A to B synchronously and stale verification cannot restore A", async () => {
  const identity = loadIdentityBoundary();
  let verifiedUserId = "user-a";
  const harness = loadAuthListener(identity, {
    auth: {
      getUser: async () => ({ data: { user: { id: verifiedUserId } }, error: null }),
    },
  });
  harness.listener.initAuthListener();

  harness.emit("SIGNED_IN", "user-a");
  assert.equal(identity.getMobileAuthIdentitySnapshot().status, "verifying");
  await harness.flushTimers();
  const expectedA = identity.captureMobileAuthIdentityExpectation("user-a");
  assert.ok(expectedA);

  harness.emit("SIGNED_IN", "user-b");
  assert.equal(identity.getMobileAuthIdentitySnapshot().status, "verifying");
  assert.equal(identity.isCurrentMobileAuthIdentity(expectedA), false);

  // A second transition wins even if B's queued verifier later observes C.
  harness.emit("SIGNED_IN", "user-c");
  verifiedUserId = "user-c";
  await harness.flushTimers();
  assert.deepEqual(identity.captureMobileAuthIdentityExpectation("user-c"), {
    userId: "user-c",
    generation: identity.getMobileAuthIdentitySnapshot().generation,
  });
  assert.deepEqual(harness.cacheOwners, ["user-a", "user-b", "user-c"]);

  harness.emit("SIGNED_OUT", null);
  assert.equal(identity.getMobileAuthIdentitySnapshot().status, "anonymous");
  assert.equal(identity.isCurrentMobileAuthIdentity(expectedA), false);
  assert.deepEqual(harness.redirects, ["/(auth)/login"]);
  harness.listener.disposeAuthListener();
});

test("root navigation and core screens retain the account-switch privacy fences", () => {
  const rootLayout = read("../../app/_layout.tsx");
  const authListener = read("../lib/authListener.ts");
  const dashboard = read("../../app/(tabs)/dashboard.tsx");
  const profile = read("../../app/(tabs)/profile.tsx");
  const chat = read("../../app/(tabs)/chat.tsx");

  assert.match(rootLayout, /useSyncExternalStore\([\s\S]*subscribeMobileAuthIdentity/);
  assert.match(rootLayout, /mobileIdentity\.status !== "authenticated"[\s\S]*mobileIdentity\.status !== "anonymous"/);
  assert.match(rootLayout, /<Stack\s+key=\{navigationIdentityKey\}/);

  const beginIndex = authListener.indexOf("beginMobileAuthIdentityTransition(candidateUserId)");
  const verifyIndex = authListener.indexOf("supabase.auth.getUser()");
  assert.ok(beginIndex >= 0 && verifyIndex > beginIndex);
  assert.match(authListener, /completeMobileAuthIdentityTransition/);
  assert.match(authListener, /failMobileAuthIdentityTransition/);
  assert.match(authListener, /setCommunityCacheOwner\(candidateUserId\)/);

  for (const screen of [dashboard, profile, chat]) {
    assert.match(screen, /captureMobileAuthIdentityExpectation\(\)/);
    assert.match(screen, /isCurrentMobileAuthIdentity/);
    assert.match(screen, /user\.id !== expectation\.userId/);
  }

  assert.match(dashboard, /postgres_changes[\s\S]*isCurrentMobileAuthIdentity\(result\.expectation\)/);
  assert.match(chat, /sessionData\.session\?\.user\.id !== expectedUserId/);
  assert.match(chat, /refreshed\.session\?\.user\.id !== expectedUserId/);
  assert.match(chat, /postgres_changes[\s\S]*isActiveChatIdentity\(user\.id\)/);
});
