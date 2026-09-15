import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { setImmediate } from "node:timers";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";
import * as avatar from "../lib/profileAvatarPresentation.mjs";

/**
 * 내 정보 탭의 표시용 아바타 조회는 화면을 막지 않고, 잠깐 실패해도 보이던 사진·이모지를 지우지 않는다.
 *
 * 2026-09-15 리뷰: `loadProfile`이 타임아웃 없는 GET /api/profile/avatar 를 기다린 뒤에야
 * setProfile 을 불렀다. 응답이 없으면 이름·역할·D-day·「프로필 꾸미기」가 뜨지 않고 당겨서 새로고침
 * 스피너도 계속 돌았다. 탭에 다시 들어올 때 GET 이 한 번 실패하면 저장된 사진이 이름 첫 글자로 바뀌었다.
 */

const OWNER = "11111111-1111-4111-8111-111111111111";
const REVISION = "33333333-3333-4333-8333-333333333333";
const PHOTO = `/api/profile/avatar/image?userId=${OWNER}&version=${REVISION}`;
const profileSource = readFileSync(fileURLToPath(new URL("../../app/(tabs)/profile.tsx", import.meta.url)), "utf8");
const tree = ts.createSourceFile("profile.tsx", profileSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

let loadProfileText;
(function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(tree) === "loadProfile") {
    loadProfileText = node.initializer.arguments[0].getText(tree);
  }
  ts.forEachChild(node, visit);
})(tree);
assert.ok(loadProfileText, "loadProfile useCallback 을 찾지 못했다");
const loadProfileCode = ts.transpileModule(`const loadProfile = ${loadProfileText}`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.Preserve },
}).outputText;

const flush = async () => { for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve)); };
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }

function chain(result) {
  const builder = new Proxy({}, {
    get(_target, key) {
      if (key === "then") return (resolve, reject) => Promise.resolve(result).then(resolve, reject);
      return () => builder;
    },
  });
  return builder;
}

function harness({ avatarResponses }) {
  let sessionUser = OWNER;
  const state = { profile: null, avatar: null, stats: null };
  const avatarCalls = [];
  const queue = [...avatarResponses];
  const setState = (key) => (next) => { state[key] = typeof next === "function" ? next(state[key]) : next; };
  const avatarFetch = async (expected, path, options) => {
    avatarCalls.push({ expected, path, options });
    return queue.shift();
  };
  const bindings = {
    supabase: {
      auth: {
        getUser: async () => ({ data: { user: { id: OWNER, email: "a@example.com" } } }),
        getSession: async () => ({ data: { session: sessionUser ? { user: { id: sessionUser } } : null } }),
      },
      from: (table) => chain(
        table === "profiles" ? { data: { name: "민지", role: "bride", couple_id: null } }
          : table === "community_bookmarks" ? { count: 0 }
            : { data: null },
      ),
    },
    apiFetchForExpectedUser: avatarFetch,
    apiFetchForExpectedUserQuiet: avatarFetch,
    apiJson: async () => ({ profile: null, actualPostCount: 0 }),
    parseProfileAvatarResponse: avatar.parseProfileAvatarResponse,
    // 실제 헬퍼를 쓰되 타임아웃만 짧게 — 응답 없는 요청이 테스트를 15초 붙잡지 않게 한다.
    readProfileAvatarForDisplay: (ownerId, request) => avatar.readProfileAvatarForDisplay(ownerId, request, 100),
    calcDday: () => null,
    setStats: setState("stats"),
    setProfile: setState("profile"),
    setAvatar: setState("avatar"),
    avatarReadSeqRef: { current: 0 },
    console: { warn() {} },
  };
  const loadProfile = new Function("bindings", `with (bindings) { ${loadProfileCode}; return loadProfile; }`)(bindings);
  const displayed = () => (state.profile && state.avatar?.userId === state.profile.userId ? state.avatar.avatarUrl : null);
  return { state, bindings, loadProfile, displayed, avatarCalls, switchAccount: (id) => { sessionUser = id; } };
}

const json = (status, body) => new Response(JSON.stringify(body), { status });

test("the profile renders even when the avatar request never answers", async () => {
  const h = harness({ avatarResponses: [new Promise(() => {})] });
  const loading = h.loadProfile();
  await flush();
  assert.equal(h.state.profile?.name, "민지", "이름·역할·꾸미기 버튼이 아바타 응답을 기다리지 않는다");
  assert.equal(h.state.profile?.userId, OWNER);
  // 당겨서 새로고침은 loadProfile 이 끝나야 멈춘다.
  const settled = await Promise.race([loading.then(() => "done"), new Promise((resolve) => setTimeout(() => resolve("hung"), 200))]);
  assert.equal(settled, "done");
  assert.equal(h.displayed(), null, "처음 여는 화면은 받은 값이 없으니 이름 첫 글자다");
});

test("a failed refresh keeps the photo that was already showing", async () => {
  const h = harness({ avatarResponses: [json(200, { avatar_url: PHOTO, revision: REVISION }), json(503, { code: "PROFILE_AVATAR_UNAVAILABLE" })] });
  await h.loadProfile();
  await flush();
  assert.equal(h.displayed(), PHOTO);
  await h.loadProfile();
  await flush();
  assert.equal(h.displayed(), PHOTO, "일시적인 실패로 사진을 글자로 되돌리지 않는다");
  assert.equal(h.state.profile?.name, "민지");
});

test("a successful empty avatar still switches back to the initial", async () => {
  // 과한 수정 방지: 성공한 null 은 사용자가 기본 글자로 바꾼 결과다.
  const h = harness({ avatarResponses: [json(200, { avatar_url: "🐶", revision: REVISION }), json(200, { avatar_url: null, revision: REVISION })] });
  await h.loadProfile();
  await flush();
  assert.equal(h.displayed(), "🐶");
  await h.loadProfile();
  await flush();
  assert.equal(h.displayed(), null);
});

test("an older avatar response cannot overwrite a newer read or an editor save", async () => {
  const slow = deferred();
  const h = harness({ avatarResponses: [slow.promise, json(200, { avatar_url: "🐱", revision: REVISION })] });
  await h.loadProfile();
  await h.loadProfile();
  await flush();
  assert.equal(h.displayed(), "🐱");
  slow.resolve(json(200, { avatar_url: "🐶", revision: REVISION }));
  await flush();
  assert.equal(h.displayed(), "🐱", "먼저 보낸 느린 응답이 나중 값을 덮지 않는다");

  const pending = deferred();
  const saved = harness({ avatarResponses: [pending.promise] });
  await saved.loadProfile();
  // 편집기 저장이 끝났다(onClose): 순번을 올리고 저장 값을 반영한다.
  saved.bindings.avatarReadSeqRef.current += 1;
  saved.bindings.setAvatar({ userId: OWNER, avatarUrl: "🐰" });
  pending.resolve(json(200, { avatar_url: null, revision: null }));
  await flush();
  assert.equal(saved.displayed(), "🐰");
});

test("an avatar that arrives after an account switch is not applied", async () => {
  const pending = deferred();
  const h = harness({ avatarResponses: [pending.promise] });
  await h.loadProfile();
  h.switchAccount("22222222-2222-4222-8222-222222222222");
  pending.resolve(json(200, { avatar_url: "🐶", revision: REVISION }));
  await flush();
  assert.equal(h.state.avatar, null);
});

test("the profile tab reads the avatar quietly with a timeout and bumps the read sequence on editor changes", () => {
  assert.match(profileSource, /readProfileAvatarForDisplay\(user\.id, \(signal\) => apiFetchForExpectedUserQuiet\(user\.id, "\/api\/profile\/avatar", \{ method: "GET", signal \}\)\)/u);
  assert.doesNotMatch(profileSource, /await avatarRequest/u, "아바타를 기다린 뒤에 프로필을 그리지 않는다");
  const sheet = /<ProfileAvatarEditorSheet[\s\S]*?\/>/u.exec(profileSource)?.[0] ?? "";
  assert.match(sheet, /onClose=\{\(saved\) => \{[\s\S]*?avatarReadSeqRef\.current \+= 1;[\s\S]*?setAvatar\(\{ userId: profile\.userId, avatarUrl: saved\.avatarUrl \}\)/u);
  assert.match(sheet, /onAvatarChanged=\{\(avatarUrl\) => \{[\s\S]*?avatarReadSeqRef\.current \+= 1;[\s\S]*?setAvatar\(\{ userId: profile\.userId, avatarUrl \}\)/u);
});
