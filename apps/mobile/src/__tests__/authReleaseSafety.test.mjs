import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import { setImmediate } from "node:timers";
import ts from "typescript";

function readSource(relativePath) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

test("web logout runs without depending on the native Alert callback", () => {
  const logoutScreens = [
    readSource("../../app/(tabs)/profile.tsx"),
    readSource("../../app/settings/index.tsx"),
  ];

  for (const source of logoutScreens) {
    assert.match(source, /Platform\.OS\s*===\s*["']web["']/);
    assert.match(source, /void\s+performLogout\(\)/);
    assert.match(source, /await\s+signOut\(\)/);
    assert.match(source, /setLogoutError\(/);
  }
});

test("social login exposes only configured native providers", () => {
  const authSource = readSource("../lib/auth.ts");
  const loginSource = readSource("../../app/(auth)/login.tsx");

  assert.match(authSource, /Platform\.OS\s*===\s*["']web["']\)\s*return false/);
  assert.match(authSource, /EXPO_PUBLIC_KAKAO_OAUTH_ENABLED\s*===\s*["']true["']/);
  assert.match(authSource, /EXPO_PUBLIC_APPLE_OAUTH_ENABLED\s*!==\s*["']false["']/);
  assert.match(loginSource, /isOAuthProviderEnabled\(["']kakao["']\)/);
  assert.match(loginSource, /isOAuthProviderEnabled\(["']apple["']\)/);
  assert.match(loginSource, /소셜 로그인은 설치한 앱에서 이용할 수 있어요/);
  assert.match(loginSource, /name=["']logo-apple["']/);
  assert.doesNotMatch(loginSource, /\\uF8FF/);
});

test("the root gate keeps auth and profile failures in a retryable error state", () => {
  const indexSource = readSource("../../app/index.tsx");

  assert.match(indexSource, /error:\s*sessionError/);
  assert.match(indexSource, /if\s*\(sessionError\)\s*throw sessionError/);
  assert.match(indexSource, /error:\s*profileError/);
  assert.match(indexSource, /if\s*\(profileError\)\s*throw profileError/);
  assert.match(indexSource, /setStatus\(["']error["']\)/);
  assert.match(indexSource, /setLoadAttempt\(\(attempt\)\s*=>\s*attempt\s*\+\s*1\)/);
  assert.match(indexSource, /다시 시도/);
});

test("the tab guard protects planning tabs while preserving the public community feed", () => {
  const layoutSource = readSource("../../app/(tabs)/_layout.tsx");

  assert.match(layoutSource, /isPublicCommunity\s*=\s*pathname\s*===\s*["']\/community["']/);
  assert.match(layoutSource, /supabase\.auth\.getSession\(\)/);
  assert.match(layoutSource, /onAuthStateChange/);
  assert.match(
    layoutSource,
    /authStatus\s*===\s*["']guest["']\s*&&\s*!isPublicCommunity/,
  );
  assert.match(layoutSource, /<Redirect\s+href=["']\/\(auth\)\/login["']/);
  assert.match(layoutSource, /href:\s*protectedTabHref/);
  assert.match(layoutSource, /name=["']community["']/);
});

function apiHarness() {
  let owner = "owner-a", token = "token-a", listener;
  const alerts = [], signOuts = [], navigation = [], fetches = [];
  let resolve;
  const response = new Promise(done => { resolve = done; });
  const modules = {
    "react-native": { Alert: { alert: (...args) => alerts.push(args) } }, "expo-router": { router: { replace: route => navigation.push(route) } }, "expo/fetch": { fetch: () => { throw new Error("Unexpected optional read"); } },
    "./supabase": { supabase: { auth: {
      getSession: async () => ({ data: { session: owner ? { user: { id: owner }, access_token: token } : null } }),
      onAuthStateChange: callback => { listener = callback; return { data: { subscription: { unsubscribe() {} } } }; },
    } } },
    "./auth": { signOut: async () => { signOuts.push(owner); owner = null; listener?.("SIGNED_OUT", null); } },
    "./mobileWebApiBridge.mjs": { createMobileWebApiSessionRefreshGate: () => ({}), fetchMobileWebApiWithSession: () => { throw new Error("Unexpected bridge"); } },
  };
  const code = ts.transpileModule(readSource("../lib/api.ts"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function("exports", "require", "fetch", code)(module.exports, name => { assert.ok(modules[name], name); return modules[name]; }, (...args) => { fetches.push(args); return response; });
  return {
    api: module.exports, alerts, signOuts, navigation, fetches,
    change(nextOwner, nextToken = `token-${nextOwner}`) { owner = nextOwner; token = nextToken; listener?.(owner ? "SIGNED_IN" : "SIGNED_OUT", owner ? { user: { id: owner }, access_token: token } : null); },
    resolve: () => resolve({ status: 401 }),
  };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test("late old-account 401 never opens a logout alert for a newly signed-in account", async () => {
  const h = apiHarness(); const work = h.api.apiFetchForExpectedUser("owner-a", "/api/amora/personal-actions").catch(error => error);
  await tick(); h.change("owner-b"); h.resolve(); await work;
  assert.equal(h.alerts.length, 0); assert.deepEqual(h.signOuts, []);
});

test("an existing expired-session alert cannot sign out an account that changed before confirmation", async () => {
  const h = apiHarness(); const work = h.api.apiFetchForExpectedUser("owner-a", "/api/journey").catch(error => error);
  await tick(); h.resolve(); await work; assert.equal(h.alerts.length, 1);
  h.change("owner-b"); h.alerts[0][2][0].onPress(); await tick();
  assert.deepEqual(h.signOuts, []); assert.deepEqual(h.navigation, []);
});

test("expired-session alert rejects A-B-A even if a restored A uses the original access token", async () => {
  const h = apiHarness(); const work = h.api.apiFetchForExpectedUser("owner-a", "/api/journey").catch(error => error);
  await tick(); h.resolve(); await work; assert.equal(h.alerts.length, 1);
  h.change("owner-b"); h.change("owner-a", "token-a"); h.alerts[0][2][0].onPress(); await tick();
  assert.deepEqual(h.signOuts, []); assert.deepEqual(h.navigation, []);
});

test("a current expired session can still sign out safely through the existing cleanup helper", async () => {
  const h = apiHarness(); const work = h.api.apiFetchForExpectedUser("owner-a", "/api/journey").catch(error => error);
  await tick(); h.resolve(); await work; h.alerts[0][2][0].onPress(); await tick();
  assert.deepEqual(h.signOuts, ["owner-a"]); assert.deepEqual(h.navigation, ["/(auth)/login"]);
});

function sourceFunction(relativePath, name) {
  const source = readSource(relativePath); const parsed = ts.createSourceFile('source.ts', source, ts.ScriptTarget.Latest, true);
  return parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(parsed);
}
function cleanupHarness(blockAt) {
  let epoch = 0, release; const calls = [];
  const pending = new Promise(resolve => { release = resolve; });
  const modules = {
    './communityDecisionPending': { purgeCommunityDecisionPendingForOwnerWithRetry: async () => { calls.push('purge'); if (blockAt === 'purge') await pending; } },
    './notifications': { releasePushNotificationsForCurrentSession: async guard => { calls.push('notifications'); if (blockAt === 'notifications') await pending; if (guard && !guard()) throw new Error('API_SESSION_OWNER_MISMATCH'); } },
  };
  const code = ts.transpileModule(sourceFunction('../lib/auth.ts', 'signOut'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {}; new Function('exports', 'require', 'supabase', 'Platform', code)(exports, name => modules[name], { auth: {
    getSession: async () => ({ data: { session: { user: { id: 'owner-a' } } } }), signOut: async () => { calls.push('signOut'); return { error: null }; },
  } }, { OS: 'ios' });
  return { calls, change: () => { epoch += 1; }, release: () => release(), run: () => exports.signOut({ isCurrentSession: () => epoch === 0 }) };
}

test('expired-session cleanup stops before notification release after account switch or ABA during local purge', async () => {
  for (const changes of [1, 2]) {
    const h = cleanupHarness('purge'); const work = h.run().catch(error => error); await tick();
    for (let i = 0; i < changes; i++) h.change(); h.release();
    assert.match((await work).message ?? '', /API_SESSION_OWNER_MISMATCH/); assert.deepEqual(h.calls, ['purge']);
  }
});

test('expired-session cleanup cannot sign out a new account after notification teardown awaits', async () => {
  const h = cleanupHarness('notifications'); const work = h.run().catch(error => error); await tick(); h.change(); h.release();
  assert.match((await work).message ?? '', /API_SESSION_OWNER_MISMATCH/); assert.deepEqual(h.calls, ['purge', 'notifications']);
});

test('current expired-session cleanup still purges notifications and locally signs out', async () => {
  const h = cleanupHarness('none'); assert.equal((await h.run()).decisionDataPurged, true); assert.deepEqual(h.calls, ['purge', 'notifications', 'signOut']);
});

test('notification release checks owner generation after its user lookup before touching device or token cache', async () => {
  let current = true, resolve; const calls = [];
  const user = new Promise(done => { resolve = done; });
  const code = ts.transpileModule(sourceFunction('../lib/notifications.ts', 'releasePushNotificationsForCurrentSession'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  new Function('exports', 'invalidateCommunityPushNavigationForAuthChange', 'supabase', 'SecureStore', 'PUSH_BOUND_TOKEN_KEY', 'PUSH_INSTALLATION_ID_KEY', 'releasePushDeliveryOwnership', 'UUID_PATTERN', 'Notifications', 'clearCachedNotificationState', code)(exports,
    () => calls.push('invalidate'), { auth: { getUser: () => user }, rpc: async () => { calls.push('rpc'); return { error: null }; } },
    { getItemAsync: async () => { calls.push('read-token'); return null; }, deleteItemAsync: async () => { calls.push('delete-token'); } }, 'token', 'installation',
    async deps => { await deps.releaseServerToken(); await deps.unregisterDeviceToken(); await deps.clearCachedNotifications(); return {}; }, /./,
    { unregisterForNotificationsAsync: async () => { calls.push('unregister'); } }, async () => { calls.push('clear-cache'); });
  const work = exports.releasePushNotificationsForCurrentSession(() => current).catch(error => error);
  await tick(); current = false; resolve({ data: { user: { id: 'owner-a' } }, error: null });
  assert.match((await work).message ?? '', /API_SESSION_OWNER_MISMATCH/); assert.deepEqual(calls, ['invalidate']);
});
