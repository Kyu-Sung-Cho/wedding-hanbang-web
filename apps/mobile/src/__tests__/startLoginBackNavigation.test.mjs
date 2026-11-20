// 2026-11-20 파운더 결정 7(부모 세션 질문 "앱 업데이트 전 결정 둘(서비스 메뉴 줄, 뒤로 가기)을 권하는 대로 할까요?"에
// 파운더 답 "권하는 대로"): 안드로이드에서 시작하기를 누른 뒤 뒤로 가기를 누르면 시작 화면으로 돌아온다. 로그인을 마치면
// 홈으로 갈아 끼워, 뒤로 가기를 눌러도 로그인 화면(이나 시작 화면)으로 돌아가지 않는다.
//
// React Native 화면은 node --test 로 렌더할 수 없다. 그래서 원문의 호출을 보고, 그 호출이 만드는 동작은 앱이 쓰는
// React Navigation 의 실제 StackRouter 로 돌려 본다(rootStackChatNavigation.test.mjs 와 같은 방법).
//   - router.push(href)       → PUSH
//   - router.dismissTo("/")   → POP_TO index (expo-router global-state/routing.js 의 dismissTo 가 이 이벤트를 쓴다)
//   - <Redirect href=…>       → REPLACE (화면이 다시 보일 때 자기 자리를 바꾼다)
//   - 안드로이드 기기 뒤로, iOS 왼쪽 가장자리 밀기 → GO_BACK(맨 아래면 처리할 곳이 없어 앱이 닫힌다)

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
/** 주석을 걷어낸 원문. 왜 바꿨는지 적은 주석이 검사에 걸리지 않게 한다. */
const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^\s*\/\/.*$/gmu, "");

async function loadStackRouter() {
  const appRequire = createRequire(new URL("../../package.json", import.meta.url));
  const expoRequire = createRequire(appRequire.resolve("expo-router/package.json"));
  const navigationRequire = createRequire(expoRequire.resolve("@react-navigation/native/package.json"));
  const { StackRouter } = await import(pathToFileURL(navigationRequire.resolve("@react-navigation/routers")).href);
  return StackRouter({});
}

const ROOT_ROUTES = ["index", "(auth)", "(tabs)", "onboarding", "example"];
const options = { routeNames: ROOT_ROUTES, routeParamList: {}, routeGetIdList: {} };
const names = (state) => state.routes.map((route) => route.name);
const HOME = { name: "(tabs)", params: { screen: "lounge" } };

test("시작하기는 로그인 화면을 시작 화면 위에 쌓아 연다", () => {
  const index = code("../../app/index.tsx");
  const loginCase = index.slice(index.indexOf('case "login":'), index.indexOf('case "consent":'));
  assert.match(loginCase, /onStart=\{\(\) => router\.push\("\/\(auth\)\/login"\)\}/u);
  assert.doesNotMatch(loginCase, /router\.replace\(/u);
});

test("로그인을 마치면 이메일·소셜 둘 다 아래의 루트 판정으로 내려간다(새 루트를 쌓지 않고, 홈으로 바로 가지 않는다)", () => {
  const login = code("../../app/(auth)/login.tsx");
  assert.equal(login.match(/router\.dismissTo\("\/"\)/gu)?.length, 2);
  assert.doesNotMatch(login, /router\.replace\("\/"\)/u);
  assert.doesNotMatch(login, /router\.(?:replace|push|navigate|dismissTo)\("\/\(tabs\)/u);
});

test("실제 StackRouter: 시작하기 뒤 뒤로 가기는 처음 그 시작 화면으로 돌아온다(예전 replace 는 앱을 닫았다)", async () => {
  const router = await loadStackRouter();
  const start = router.getInitialState(options);
  assert.deepEqual(names(start), ["index"]);

  const replaced = router.getStateForAction(start, { type: "REPLACE", target: start.key, payload: { name: "(auth)" } }, options);
  assert.deepEqual(names(replaced), ["(auth)"]);
  assert.equal(router.getStateForAction(replaced, { type: "GO_BACK", target: replaced.key }, options), null, "예전 전제: 돌아갈 곳이 없다");

  const pushed = router.getStateForAction(start, { type: "PUSH", target: start.key, payload: { name: "(auth)" } }, options);
  assert.deepEqual(names(pushed), ["index", "(auth)"]);
  const back = router.getStateForAction(pushed, { type: "GO_BACK", target: pushed.key }, options);
  assert.deepEqual(names(back), ["index"]);
  assert.equal(back.routes[0].key, start.routes[0].key, "새 시작 화면이 아니라 처음 그 화면이다");
});

test("실제 StackRouter: 로그인을 마치면 홈 하나만 남아 뒤로 가기로 로그인·시작 화면에 가지 않는다", async () => {
  const router = await loadStackRouter();
  const start = router.getInitialState(options);
  const onLogin = router.getStateForAction(start, { type: "PUSH", target: start.key, payload: { name: "(auth)" } }, options);

  const popped = router.getStateForAction(onLogin, { type: "POP_TO", target: onLogin.key, payload: { name: "index" } }, options);
  assert.deepEqual(names(popped), ["index"]);
  assert.equal(popped.routes[0].key, start.routes[0].key, "아래에 있던 루트 판정으로 내려간다");
  const home = router.getStateForAction(popped, { type: "REPLACE", target: popped.key, payload: HOME }, options);
  assert.deepEqual(names(home), ["(tabs)"]);
  assert.equal(router.getStateForAction(home, { type: "GO_BACK", target: home.key }, options), null, "홈에서 뒤로 가기는 앱을 닫는다");

  // 예전 replace("/") 를 그대로 두면 시작 화면이 홈 아래에 남는다(홈에서 뒤로 가면 시작 화면이 잠깐 보였다가 홈으로 튄다).
  const newRoot = router.getStateForAction(onLogin, { type: "REPLACE", target: onLogin.key, payload: { name: "index" } }, options);
  const oldHome = router.getStateForAction(newRoot, { type: "REPLACE", target: newRoot.key, payload: HOME }, options);
  assert.deepEqual(names(oldHome), ["index", "(tabs)"], "replace 전제가 깨졌다");
});

test("실제 StackRouter: 아래에 시작 화면이 없으면(로그아웃 뒤 등) dismissTo 는 예전 replace 와 같다", async () => {
  const router = await loadStackRouter();
  const start = router.getInitialState(options);
  const loginOnly = router.getStateForAction(start, { type: "REPLACE", target: start.key, payload: { name: "(auth)" } }, options);
  const popped = router.getStateForAction(loginOnly, { type: "POP_TO", target: loginOnly.key, payload: { name: "index" } }, options);
  const replaced = router.getStateForAction(loginOnly, { type: "REPLACE", target: loginOnly.key, payload: { name: "index" } }, options);
  assert.deepEqual(names(popped), names(replaced));
  assert.deepEqual(names(popped), ["index"]);
});

test("iOS: 로그인 화면은 왼쪽 가장자리 밀기로 시작 화면에 돌아간다(밀기를 끈 곳이 없다)", () => {
  for (const path of ["../../app/_layout.tsx", "../../app/(auth)/_layout.tsx", "../../app/(auth)/login.tsx"]) {
    assert.doesNotMatch(code(path), /gestureEnabled:\s*false/u, path);
  }
});
