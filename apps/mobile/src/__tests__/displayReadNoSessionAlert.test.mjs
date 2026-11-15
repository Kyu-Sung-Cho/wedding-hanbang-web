import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";
import * as bridge from "../lib/mobileWebApiBridge.mjs";

/**
 * 표시용 조회는 401 에서 전역 「세션 만료」 알림과 로그아웃 흐름을 띄우지 않는다.
 *
 * 2026-09-15 리뷰: 채팅 말풍선 색·상대 사진(`/api/auth/me`)과 내 정보 탭 아바타
 * (`/api/profile/avatar`)는 색·그림을 칠하려는 부가 조회다. 이 라우트는 Auth 가 잠깐 흔들려도
 * 401 을 낸다. `apiFetchForExpectedUser` 는 토큰 갱신을 한 번도 시도하지 않고 바로 알림을 띄우고,
 * 확인을 누르면 로그아웃한다. 표시용 조회는 소유자 확인과 1회 갱신·재시도만 하고 조용히 실패한다.
 */

const readSource = (relative) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

function apiHarness({ responses, refreshed = { id: "owner-a", token: "token-a2" } }) {
  let owner = "owner-a";
  let token = "token-a";
  const alerts = [];
  const signOuts = [];
  const navigation = [];
  const fetches = [];
  const refreshes = [];
  const modules = {
    "react-native": { Alert: { alert: (...args) => alerts.push(args) } },
    "expo-router": { router: { replace: (route) => navigation.push(route) } },
    "expo/fetch": { fetch: () => { throw new Error("Unexpected optional read"); } },
    "./supabase": {
      supabase: {
        auth: {
          getSession: async () => ({ data: { session: owner ? { user: { id: owner }, access_token: token } : null } }),
          refreshSession: async () => {
            refreshes.push(owner);
            if (!refreshed) return { data: { session: null }, error: new Error("refresh failed") };
            token = refreshed.token;
            owner = refreshed.id;
            return { data: { session: { user: { id: refreshed.id }, access_token: refreshed.token } }, error: null };
          },
          onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        },
      },
    },
    "./auth": { signOut: async () => { signOuts.push(owner); owner = null; } },
    "./mobileWebApiBridge.mjs": bridge,
  };
  const code = ts.transpileModule(readSource("../lib/api.ts"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const queue = [...responses];
  new Function("exports", "require", "fetch", code)(
    module.exports,
    (name) => { assert.ok(modules[name], name); return modules[name]; },
    async (url, init) => {
      fetches.push({ url, authorization: init.headers.Authorization, method: init.method });
      const next = queue.shift();
      assert.ok(next, "예상보다 요청이 많다");
      return new globalThis.Response(JSON.stringify(next.body ?? {}), { status: next.status });
    },
  );
  return { api: module.exports, alerts, signOuts, navigation, fetches, refreshes };
}

test("a display read that gets 401 refreshes once, retries, and never opens the session-expired alert", async () => {
  const h = apiHarness({ responses: [{ status: 401 }, { status: 200, body: { ok: true } }] });
  assert.equal(typeof h.api.apiFetchForExpectedUserQuiet, "function");
  const response = await h.api.apiFetchForExpectedUserQuiet("owner-a", "/api/auth/me");
  assert.equal(response.status, 200);
  assert.deepEqual(h.fetches.map((call) => call.authorization), ["Bearer token-a", "Bearer token-a2"]);
  assert.deepEqual(h.refreshes, ["owner-a"]);
  assert.deepEqual(h.alerts, []);
  assert.deepEqual(h.signOuts, []);
  assert.deepEqual(h.navigation, []);
});

test("a second 401 is returned to the caller quietly instead of logging out", async () => {
  const h = apiHarness({ responses: [{ status: 401 }, { status: 401 }] });
  const response = await h.api.apiFetchForExpectedUserQuiet("owner-a", "/api/profile/avatar", { method: "GET" });
  assert.equal(response.status, 401);
  assert.equal(h.fetches.length, 2, "한 번만 갱신·재시도한다");
  assert.deepEqual(h.alerts, []);
  assert.deepEqual(h.signOuts, []);
});

test("a failed refresh does not retry and stays quiet", async () => {
  const h = apiHarness({ responses: [{ status: 401 }], refreshed: null });
  const response = await h.api.apiFetchForExpectedUserQuiet("owner-a", "/api/auth/me");
  assert.equal(response.status, 401);
  assert.equal(h.fetches.length, 1);
  assert.deepEqual(h.alerts, []);
});

test("the quiet read still refuses to send anything for a different account", async () => {
  const h = apiHarness({ responses: [] });
  await assert.rejects(h.api.apiFetchForExpectedUserQuiet("owner-b", "/api/auth/me"), /API_SESSION_OWNER_MISMATCH/u);
  assert.equal(h.fetches.length, 0);
  // 갱신 뒤 소유자가 바뀌면 새 계정 토큰으로 다시 보내지 않는다.
  const switched = apiHarness({ responses: [{ status: 401 }], refreshed: { id: "owner-b", token: "token-b" } });
  const response = await switched.api.apiFetchForExpectedUserQuiet("owner-a", "/api/auth/me");
  assert.equal(response.status, 401);
  assert.deepEqual(switched.fetches.map((call) => call.authorization), ["Bearer token-a"]);
  assert.deepEqual(switched.alerts, []);
});

test("mutations and screens that need the login gate keep the session-expired alert", async () => {
  // 과한 수정 방지: 기존 헬퍼는 그대로 알림을 띄운다.
  const h = apiHarness({ responses: [{ status: 401 }] });
  await assert.rejects(h.api.apiFetchForExpectedUser("owner-a", "/api/journey"), /세션이 만료되었습니다/u);
  assert.equal(h.alerts.length, 1);
  assert.equal(h.alerts[0][0], "세션 만료");
});

test("display-only reads in chat and the profile tab use the quiet helper", () => {
  const chat = readSource("../../app/(tabs)/chat.tsx");
  assert.match(chat, /apiFetchForExpectedUserQuiet\(userId, "\/api\/auth\/me"\)/u);
  assert.doesNotMatch(chat, /apiFetchForExpectedUser\(userId, "\/api\/auth\/me"/u);

  const profile = readSource("../../app/profile.tsx");
  assert.match(profile, /apiFetchForExpectedUserQuiet\(user\.id, "\/api\/profile\/avatar", \{ method: "GET", signal \}\)/u);
  assert.doesNotMatch(profile, /apiFetchForExpectedUser\(user\.id, "\/api\/profile\/avatar"/u);
});
