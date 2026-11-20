// 청첩장 디자인(2026-11-17 파운더 디자인 아티팩트, 원문: 이 디자인 완전 같아야해) 2단계 — 로그인한 커플의 실제 화면.
//
// 하단 메뉴 넷(홈·아모라와 대화·준비 순서·일정)과 웨딩홀 흐름(비교 → 편지 시트 → 상담)이 아티팩트 컴포넌트에 실제
// 데이터(`/api/invitation/*`)를 넣는다. 렌더러 없이 지킨다: 화면 파일에서 실제 콜백을 떼어 가짜 API 와 함께 돌리고,
// 나머지는 소스를 읽는다.
//   - 화면 이름 → 앱 주소 표와 이동 방법(탭 안은 navigate, 루트 스택에서 탭으로는 dismissTo).
//   - 쓰기는 사람이 누른 단추에서만: 조건 저장, 준비 순서 빼기·넣기, 하트, 편지 저장·승인, 상담을 일정에 넣기.
//   - 실패하면 되돌리고 사실대로 말한다. 편지 판이 바뀌면(409) 승인하지 않고 다시 보여 준다.
//   - 보내기 스위치가 꺼져 있으면 "승인만 저장됐고 업체에 가지 않았다"고 말한다.
//   - 새 화면의 글자는 `@hanbang/shared/invitation` 에서만 온다. 새 네이티브 모듈이 없다(OTA).
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { setImmediate } from "node:timers";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

import {
  INVITATION_LIVE_ROUTES,
  INVITATION_TAB_SCREENS,
  invitationLiveHref,
  invitationTabKeyForScreen,
  isInvitationRouteKey,
  navigateInvitationRoute,
} from "../lib/invitationRoutes.mjs";
import {
  firstChatConditionsPatch,
  isLetterDirty,
  isLetterVersionChanged,
  journeyWithPlan,
  letterApprovalNotice,
  letterSaveBody,
  sameVisibleLetter,
  toggledJourneyPlan,
} from "../lib/invitationApi.mjs";
import {
  FIRST_CHAT_SKIP_KEY_PREFIX,
  firstChatSkipKey,
  hasSkippedFirstChat,
  rememberFirstChatSkip,
} from "../lib/firstChatSkip.mjs";
import { createReadGate } from "../lib/readGate.mjs";

const mobileRoot = fileURLToPath(new URL("../../", import.meta.url));
const read = (relative) => readFileSync(join(mobileRoot, relative), "utf8");

/** 주석을 걷어낸 소스. 왜 그렇게 했는지 적은 주석이 검사에 걸리지 않게 한다. */
function code(relative) {
  return ts.transpileModule(read(relative), {
    fileName: "screen.tsx",
    compilerOptions: { jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ES2022, removeComments: true },
  }).outputText;
}

/** 화면 파일의 `const <name> = useCallback(<함수>, …)` 를 떼어 `bindings` 안에서 돌릴 함수로 만든다. */
function extractCallback(relative, name, bindings) {
  const source = read(relative);
  const tree = ts.createSourceFile(relative, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  (function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name && node.initializer
      && ts.isCallExpression(node.initializer) && node.initializer.expression.getText(tree) === "useCallback") {
      found = node.initializer.arguments[0].getText(tree);
    }
    ts.forEachChild(node, visit);
  })(tree);
  assert.ok(found, `${relative} 에서 ${name} 를 찾지 못했다 — 검사가 헛돈다`);
  const compiled = ts.transpileModule(`const run = ${found};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function("bindings", `with (bindings) { ${compiled} return run; }`)(bindings);
}

/** 화면 파일의 맨 위 함수 선언을 떼어 돌린다. */
function extractFunction(relative, name, bindings = {}) {
  const source = read(relative);
  const tree = ts.createSourceFile(relative, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const node = tree.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === name);
  assert.ok(node, `${relative} 에서 ${name} 를 찾지 못했다`);
  const compiled = ts.transpileModule(node.getText(tree), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function("bindings", `with (bindings) { ${compiled} return ${name}; }`)(bindings);
}

/** setState 처럼 값이나 갱신 함수를 받아 기록한다. */
function stateCell(initial) {
  const cell = { value: initial, history: [] };
  cell.set = (update) => {
    cell.value = typeof update === "function" ? update(cell.value) : update;
    cell.history.push(cell.value);
  };
  return cell;
}

const recordingRouter = (events) => ({
  navigate: (href) => events.push(["navigate", href]),
  push: (href) => events.push(["push", href]),
  dismissTo: (href) => events.push(["dismissTo", href]),
});

/** 기다리는 약속을 모두 흘려보낸다(답을 정한 뒤 화면 콜백이 끝까지 돌게). */
const flush = () => new Promise((resolve) => setImmediate(resolve));

// 가짜 요청은 시험이 답할 때까지 끝나지 않는다. 위반을 심었을 때 시험이 멈춰 버리지 않고 실패하도록 시간을 둔다.
const RACE = { timeout: 10_000 };

/** 부른 순서대로 쌓이고 시험이 고른 순서로 답하는 가짜 요청. */
function deferredCalls() {
  const calls = [];
  const fn = (...args) => new Promise((resolve) => calls.push({ args, resolve }));
  return { fn, calls };
}

// ── 화면 이름 → 앱 주소 ─────────────────────────────────────────────────────

test("every invitation screen name maps to a real signed-in route", () => {
  assert.deepEqual({ ...INVITATION_LIVE_ROUTES }, {
    home: "/(tabs)/lounge",
    chat: "/(tabs)/chat",
    journey: "/(tabs)/journey",
    compare: "/halls",
    letter: "/halls/letter",
    status: "/(tabs)/schedule",
  });
  // 공유 계약의 이름을 빠짐없이 옮긴다.
  const types = read("../../packages/shared/src/invitation/types.ts");
  const union = /export type InvitationRouteKey = ([^;]+);/u.exec(types)?.[1] ?? "";
  const keys = [...union.matchAll(/"([a-z]+)"/gu)].map((match) => match[1]);
  assert.deepEqual(keys.sort(), Object.keys(INVITATION_LIVE_ROUTES).sort());
  // 주소마다 실제 화면 파일이 있다.
  for (const href of Object.values(INVITATION_LIVE_ROUTES)) {
    const base = join(mobileRoot, "app", href);
    assert.ok(existsSync(`${base}.tsx`) || existsSync(join(base, "index.tsx")), `${href} 화면이 없다`);
  }
  assert.equal(isInvitationRouteKey("settings"), false);
  assert.throws(() => invitationLiveHref("settings"));
  assert.equal(invitationTabKeyForScreen("schedule"), "status");
  assert.equal(invitationTabKeyForScreen("lounge"), "home");
  assert.equal(invitationTabKeyForScreen("halls"), null);
  assert.deepEqual(Object.keys(INVITATION_TAB_SCREENS), ["home", "chat", "journey", "status"]);
});

test("tabs switch in place, root-stack screens go back to the tabs, and the hall flow stacks", () => {
  const fromTabs = [];
  for (const key of ["home", "chat", "journey", "status", "compare", "letter"]) navigateInvitationRoute(recordingRouter(fromTabs), key, "tabs");
  assert.deepEqual(fromTabs, [
    ["navigate", "/(tabs)/lounge"],
    ["navigate", "/(tabs)/chat"],
    ["navigate", "/(tabs)/journey"],
    ["navigate", "/(tabs)/schedule"],
    ["push", "/halls"],
    ["push", "/halls/letter"],
  ]);
  // 웨딩홀 스택(루트 스택 화면)에서 탭으로 갈 때 push 하면 (tabs) 가 한 벌 더 쌓인다(rootStackChatNavigation).
  const fromStack = [];
  for (const key of ["home", "status", "compare", "letter"]) navigateInvitationRoute(recordingRouter(fromStack), key, "stack");
  assert.deepEqual(fromStack, [
    ["dismissTo", "/(tabs)/lounge"],
    ["dismissTo", "/(tabs)/schedule"],
    ["dismissTo", "/halls"],
    ["push", "/halls/letter"],
  ]);
  // 예시 스택의 표와 이름이 같다(주소만 다르다).
  const example = read("src/components/invitation/ExampleCouple.tsx");
  for (const key of Object.keys(INVITATION_LIVE_ROUTES)) assert.match(example, new RegExp(`\\n  ${key}: \\{ name: `, "u"));
});

test("the hall flow is a root-stack group with the letter as a full-screen sheet", () => {
  assert.match(read("app/_layout.tsx"), /<Stack\.Screen name="halls" options=\{\{ headerShown: false \}\} \/>/u);
  const layout = code("app/halls/_layout.tsx");
  assert.match(layout, /<Stack\.Screen name="index"\s*\/>/u);
  assert.match(layout, /<Stack\.Screen name="letter" options=\{\{ presentation: "fullScreenModal", animation: "slide_from_bottom" \}\}\s*\/>/u);
  assert.match(layout, /<Stack\.Screen name="consultation"\s*\/>/u);
  assert.deepEqual(readdirSync(join(mobileRoot, "app/halls")).sort(), ["_layout.tsx", "consultation.tsx", "index.tsx", "letter.tsx"]);
});

// ── 떠 있는 하단 메뉴 ───────────────────────────────────────────────────────

test("the floating bar steps aside only for the keyboard, and nothing sits under it", () => {
  const bar = code("src/components/invitationLive/InvitationTabsBar.tsx");
  assert.match(bar, /if \(keyboardShown\)\s*return null;/u);
  const keyboard = code("src/lib/useKeyboardShown.ts");
  assert.match(keyboard, /Platform\.OS === "ios" \? "keyboardWillShow" : "keyboardDidShow"/u);
  // 어떤 화면도 메뉴를 숨기지 못한다. 첫 대화가 유일한 길이 되면 이미 쓰던 커플이 그 안에 갇힌다(2026-11-17).
  assert.doesNotMatch(bar, /hiddenByScreen|display === "none"/u);
  assert.doesNotMatch(code("app/(tabs)/_layout.tsx"), /tabBarStyle|hiddenByScreen/u);
  assert.doesNotMatch(code("app/(tabs)/lounge.tsx"), /tabBarStyle|<Tabs\.Screen/u);
  // 첫 대화의 아래 단추 묶음은 메뉴 위에서 끝난다.
  assert.match(code("app/(tabs)/lounge.tsx"), /<InvitationFirstChat[^>]*\bwithTabBar\b/u);
  assert.match(code("src/components/invitation/InvitationFirstChat.tsx"), /const footerBottom = withTabBar \? invitationTabBarClearance\(insets\) \+ 12 : Math\.max\(26, insets\.bottom\);/u);
  // 대화 입력칸은 메뉴(안전 영역 포함) 위에 있다. 키보드가 뜨면 메뉴가 숨으니 여백도 거둔다.
  const chat = code("app/(tabs)/chat.tsx");
  assert.match(chat, /const composerTabBarInset = keyboardShown \? 0 : invitationTabBarClearance\(safeAreaInsets\) \+ 8;/u);
  assert.match(chat, /<SafeAreaView style=\{\[st\.container, \{ paddingBottom: composerTabBarInset \}\]\} edges=\{\["top"\]\}>/u);
  // 탭 화면의 마지막 줄·단추는 메뉴 위에서 끝난다.
  assert.match(code("app/(tabs)/lounge.tsx"), /<InvitationHome[^>]*\bwithTabBar\b/u);
  assert.match(code("app/(tabs)/journey.tsx"), /withTabBar\s*notice=\{notice\}/u);
  assert.match(code("src/components/invitationLive/LiveConsultation.tsx"), /withTabBar=\{withTabBar\}/u);
  assert.match(code("src/components/invitation/InvitationJourney.tsx"), /withTabBar \? invitationTabBarClearance\(insets\) \+ 12 : Math\.max\(26, insets\.bottom\)/u);
  assert.match(code("src/components/invitation/InvitationConsultation.tsx"), /withTabBar \? invitationTabBarClearance\(insets\) \+ 24 : Math\.max\(24, insets\.bottom\)/u);
});

// ── 홈과 첫 대화 ────────────────────────────────────────────────────────────

function firstChatHarness({ answers, saveResult, wedding = null }) {
  const calls = [];
  const dismissed = stateCell(false);
  const saving = stateCell(false);
  const failed = stateCell(false);
  const invitation = stateCell({ status: "ready", home: {}, conditions: { missing: ["region", "guests"] } });
  const version = stateCell(0);
  const run = extractCallback("app/(tabs)/lounge.tsx", "confirmFirstChat", {
    liveOwner: { status: "ready", api: { saveConditions: async (patch) => { calls.push(patch); return saveResult; } } },
    conditions: { missing: ["region", "guests"], weddingDate: null },
    firstChatSaving: false,
    firstChatConditionsPatch,
    answers,
    firstChatYear: 2027,
    wedding,
    setFirstChatDismissed: dismissed.set,
    setFirstChatSaving: saving.set,
    setFirstChatFailed: failed.set,
    setInvitation: invitation.set,
    setInvitationVersion: version.set,
  });
  return { run, calls, dismissed, saving, failed, invitation, version };
}

test("the first chat saves only the picked answers, and only when the couple confirms", async () => {
  const saved = { conditions: { region: null }, summary: null, missing: ["region"], weddingDate: null };
  const ok = firstChatHarness({
    answers: { stage: "start", month: 5, monthChosen: true, region: null, guests: 200 },
    saveResult: { ok: true, data: saved },
  });
  await ok.run();
  assert.deepEqual(ok.calls, [{ startStage: "start", hopedYear: 2027, hopedMonth: 5, guestCount: 200 }]);
  assert.equal(ok.dismissed.value, true, "답한 사람에게 같은 질문을 다시 띄우지 않는다(이번 실행)");
  assert.equal(ok.failed.value, false);
  assert.equal(ok.version.value, 1, "저장한 조건으로 홈을 다시 읽는다");
  assert.deepEqual(ok.invitation.value.conditions, saved);
  assert.deepEqual(ok.saving.history, [true, false]);

  const failed = firstChatHarness({
    answers: { stage: null, month: 5, monthChosen: true, region: null, guests: 150 },
    saveResult: { ok: false, reason: "http", status: 400, code: "CONDITIONS_INVALID", message: "희망 시기는 이번 달부터 5년 안에서 골라 주세요." },
  });
  await failed.run();
  assert.equal(failed.failed.value, true);
  assert.equal(failed.dismissed.value, false, "저장하지 못했으면 첫 대화에 남는다");
  assert.equal(failed.version.value, 0);

  const nothing = firstChatHarness({ answers: { stage: null, month: null, monthChosen: false, region: null, guests: null }, saveResult: null });
  await nothing.run();
  assert.deepEqual(nothing.calls, [], "고른 것이 없으면 아무것도 보내지 않는다");
  assert.equal(nothing.dismissed.value, true);

  // 저장은 이 콜백 한 곳에서만 일어난다. 칩을 누르는 것은 화면 상태만 바꾼다.
  const lounge = code("app/(tabs)/lounge.tsx");
  assert.equal((lounge.match(/\.saveConditions\(/gu) ?? []).length, 1);
  assert.match(lounge, /onConfirm: \(\) => \{\s*void confirmFirstChat\(\);\s*\}/u);
  assert.match(lounge, /onStage: \(stage\) => setAnswers\(\(current\) => \(\{ \.\.\.current, stage \}\)\)/u);
});

test("the first chat shows only after onboarding, while conditions are missing, and never blocks the way home", () => {
  const lounge = code("app/(tabs)/lounge.tsx");
  assert.match(lounge, /const showFirstChat = data\.onboardingCompleted\s*&& conditionsMissing\s*&& !firstChatDismissed\s*&& \(firstChatRequested \|\| firstChatSkip === "not_skipped"\);/u);
  // "나중에 할게요"와 뒤로 가기는 같은 길이다: 홈을 열고 이 사람이 넘겼다는 것을 기억한다.
  assert.match(lounge, /onBack=\{skipFirstChat\}/u);
  assert.match(lounge, /onLater: skipFirstChat,/u);
  // 건너뛴 기록은 사람마다 읽고, 읽는 동안에는 첫 대화도 홈도 그리지 않는다(첫 대화가 번쩍이지 않게).
  assert.match(lounge, /void hasSkippedFirstChat\(AsyncStorage, liveOwner\.ownerId\)\.then\(\(skipped\) => \{\s*if \(active\)\s*setFirstChatSkip\(skipped \? "skipped" : "not_skipped"\);/u);
  assert.match(lounge, /\}, \[liveOwner\]\);/u);
  assert.match(lounge, /if \(loading \|\| !data \|\| invitation\.status !== "ready" \|\| firstChatSkip === "checking"\) \{\s*return <InvitationStateScreen busy\s*\/>;/u);
  // 조건이 비어 있는 동안 홈의 "두 분이 정할 것" 맨 앞 한 줄(함께)이 첫 대화를 다시 연다.
  assert.match(lounge, /leadDecision=\{conditionsMissing \? \{\s*id: "ask-conditions",\s*title: ASK_CONDITIONS_COPY\.title,\s*sub: ASK_CONDITIONS_COPY\.sub,\s*owner: \{ kind: "together" \},\s*onPress: openFirstChat,\s*\} : undefined\}/u);
  // 그 줄이 있으면 "정할 것이 없어요"는 빼고, 못 읽었다는 말은 남긴다.
  assert.match(lounge, /decisionsNote=\{home\.degraded\.includes\("decisions"\)\s*\? HOME_STATE_COPY\.decisionsUnavailable\s*: conditionsMissing \? null : HOME_STATE_COPY\.noDecisions\}/u);
  const home = code("src/components/invitation/InvitationHome.tsx");
  assert.match(home, /\.\.\.\(leadDecision \? \[\{ item: leadDecision, onPress: leadDecision\.onPress \}\] : \[\]\),\s*\.\.\.model\.decisions\.map/u);
  assert.match(home, /const showDecisionsNote = model\.decisions\.length === 0 && Boolean\(decisionsNote\);/u);
  // 웨딩홀 비교의 "조건 알려 주기"는 건너뛴 사람에게도 다시 연다.
  assert.match(lounge, /if \(!askConditions\)\s*return;\s*setFirstChatDismissed\(false\);\s*setFirstChatRequested\(true\);/u);
  assert.match(lounge, /const askConditions = routeParams\.conditions === "1";/u);
  assert.match(code("app/halls/index.tsx"), /const ASK_CONDITIONS_HREF = "\/\(tabs\)\/lounge\?conditions=1";/u);
  // 지역은 공유 지역 목록에서만 고른다. 목록이 아직 없으면 지역 칩을 그리지 않고 지역 없이도 저장할 수 있다.
  assert.match(lounge, /regions: FIRST_CHAT_REGIONS,/u);
  assert.match(lounge, /\(FIRST_CHAT_REGIONS\.length === 0 \|\| answers\.region !== null\)/u);
  const firstChat = code("src/components/invitation/InvitationFirstChat.tsx");
  assert.match(firstChat, /live\.regions\.length > 0 \?/u);
  assert.match(firstChat, /FIRST_CHAT_INPUT_COPY\.guestChoices\.map/u);
  // 고른 답은 아티팩트의 사람 말풍선 자리에 들어간다. 고르기 전에는 말풍선이 없다.
  assert.match(firstChat, /\{answer \? \(/u);
  assert.match(firstChat, /\{current \? \(/u);
});

function skipHarness(liveOwner) {
  const requested = stateCell(true);
  const dismissed = stateCell(false);
  const skip = stateCell("not_skipped");
  const remembered = [];
  const storage = { tag: "async-storage" };
  const bindings = {
    liveOwner,
    AsyncStorage: storage,
    rememberFirstChatSkip: (target, ownerId) => {
      remembered.push([target, ownerId]);
      return Promise.resolve(true);
    },
    setFirstChatRequested: requested.set,
    setFirstChatDismissed: dismissed.set,
    setFirstChatSkip: skip.set,
  };
  return {
    skipFirstChat: extractCallback("app/(tabs)/lounge.tsx", "skipFirstChat", bindings),
    openFirstChat: extractCallback("app/(tabs)/lounge.tsx", "openFirstChat", bindings),
    requested,
    dismissed,
    skip,
    remembered,
    storage,
  };
}

test("나중에 할게요 opens the home at once, remembers the skip for this person, and the home row reopens the first chat", () => {
  const ready = skipHarness({ status: "ready", ownerId: "0b6f6c55-7d39-4a39-9d3c-5f0e7a0f9c11" });
  ready.skipFirstChat();
  assert.equal(ready.dismissed.value, true, "홈이 바로 열린다");
  assert.equal(ready.requested.value, false);
  assert.equal(ready.skip.value, "skipped", "저장소를 기다리지 않는다(못 적어도 이번 실행 동안은 홈이다)");
  assert.deepEqual(ready.remembered, [[ready.storage, "0b6f6c55-7d39-4a39-9d3c-5f0e7a0f9c11"]]);

  // 홈의 맨 앞 줄을 누르면 건너뛴 기록보다 앞서 첫 대화가 열린다.
  ready.openFirstChat();
  assert.equal(ready.dismissed.value, false);
  assert.equal(ready.requested.value, true);

  // 누구인지 모르면 기록하지 않는다. 그래도 홈은 연다.
  const unknown = skipHarness({ status: "checking", ownerId: null });
  unknown.skipFirstChat();
  assert.equal(unknown.dismissed.value, true);
  assert.deepEqual(unknown.remembered, []);
});

function memoryStorage({ failGet = false, failSet = false } = {}) {
  const items = new Map();
  return {
    items,
    getItem: async (key) => {
      if (failGet) throw new Error("storage unavailable");
      return items.has(key) ? items.get(key) : null;
    },
    setItem: async (key, value) => {
      if (failSet) throw new Error("storage full");
      items.set(key, value);
    },
  };
}

test("the first-chat skip is kept per person and fails open to the home", async () => {
  const ownerA = "0B6F6C55-7D39-4A39-9D3C-5F0E7A0F9C11";
  const ownerB = "6a1d2c3b-0000-4000-8000-00000000000b";
  assert.equal(firstChatSkipKey(ownerA), `${FIRST_CHAT_SKIP_KEY_PREFIX}${ownerA.toLowerCase()}`);
  for (const bad of [null, undefined, "", "a b", "../x", "x".repeat(65), 42]) assert.equal(firstChatSkipKey(bad), null);

  const storage = memoryStorage();
  assert.equal(await hasSkippedFirstChat(storage, ownerA), false, "기록이 없으면 첫 대화를 보인다");
  assert.equal(await rememberFirstChatSkip(storage, ownerA, Date.UTC(2026, 10, 17, 3)), true);
  assert.equal(await hasSkippedFirstChat(storage, ownerA), true);
  assert.equal(await hasSkippedFirstChat(storage, ownerA.toLowerCase()), true, "대소문자가 달라도 같은 사람이다");
  assert.equal(await hasSkippedFirstChat(storage, ownerB), false, "다른 사람이 건너뛴 기록을 이 사람에게 쓰지 않는다");
  // 적는 값은 건너뛴 시각뿐이다.
  assert.deepEqual([...storage.items.values()], ["2026-11-17T03:00:00.000Z"]);

  // 저장소를 못 읽으면 홈을 연다(갇히는 쪽으로 실패하지 않는다). 누구인지 모를 때도 묻지 않는다.
  assert.equal(await hasSkippedFirstChat(memoryStorage({ failGet: true }), ownerA), true);
  assert.equal(await hasSkippedFirstChat(storage, null), true);
  // 못 적으면 false 를 돌려줄 뿐 던지지 않는다.
  assert.equal(await rememberFirstChatSkip(memoryStorage({ failSet: true }), ownerA), false);
  assert.equal(await rememberFirstChatSkip(storage, "not an id"), false);
});

test("the home keeps the product and safety slots, quietly, and opens 내 정보 from the people chips", () => {
  const lounge = code("app/(tabs)/lounge.tsx");
  assert.match(lounge, /<InvitationHome\s+model=\{home\.home\}/u);
  for (const slot of [
    /partnerChanges=\{<PartnerChangeNotice refreshVersion=\{careRefreshVersion\}\s*\/>\}/u,
    /<JoinedPlanHandoff\s+view=\{joinedPlanHandoffView\}/u,
    /todayOneCare=\{<TodayOneCareCard refreshVersion=\{careRefreshVersion\}\s*\/>\}/u,
    /<LoungeFirstArrival view=\{firstArrivalView\}\s*\/>/u,
    /records=\{data\.hasBookingRecords \? <LoungeRecordsEntry\s*\/> : null\}/u,
    /<FirstRunCoachMarks onClose=\{handleFirstRunTutorialClose\}\s*\/>/u,
  ]) {
    assert.match(lounge, slot);
  }
  // 아모라 버튼은 먼저 건넨 말이 있거나 안내가 가리킬 때만 뜬다.
  assert.match(lounge, /\{showAmoraFab \? \(\s*<AmoraFab/u);
  // 알림 자리는 청첩장 카드 아래, 아모라 소식 위다.
  const home = code("src/components/invitation/InvitationHome.tsx");
  assert.ok(home.indexOf("{notices}") > home.indexOf("styles.hero") && home.indexOf("{notices}") < home.indexOf("<UpdateSection"));
  // 할 일을 못 읽었으면 빈 목록 대신 그렇다고 말한다(조건을 묻는 맨 앞 줄이 있어도).
  assert.match(lounge, /decisionsNote=\{home\.degraded\.includes\("decisions"\)\s*\? HOME_STATE_COPY\.decisionsUnavailable\s*:/u);
  // "무엇을 했나요?" 줄마다 누가 했는지 붙인다(담당자의 일이 아모라의 일로 읽히지 않게). 글이 어긋난 줄은 비운다.
  assert.match(lounge, /updateSteps\[index\]\?\.text === step \? ACTIVITY_COPY\.actorLabel\[updateSteps\[index\]\.actor\] : null/u);
  assert.match(lounge, /stepActors=\{stepActors\}/u);
  assert.match(home, /\{stepActors\?\.\[index\] \? <Text style=\{styles\.stepActor\}>/u);
  // 지역은 공유 지역 목록에서만 고른다.
  assert.match(lounge, /const FIRST_CHAT_REGIONS = INVITATION_REGIONS;/u);
});

// ── 준비 순서 ───────────────────────────────────────────────────────────────

function journeyFixture() {
  return {
    journey: {
      rows: [
        { key: "conditions", number: "01", title: "조건", sub: "", state: "done", optional: false, off: false },
        { key: "families", number: "04", title: "첫인사", sub: "", state: "next", optional: true, off: false },
      ],
      addOns: [{ key: "rings", button: "넣기", added: false }],
    },
    plan: { off: [], addOns: [] },
  };
}

function journeyHarness(saveResults) {
  const confirmed = journeyFixture();
  const state = stateCell({ status: "ready", value: confirmed });
  const notice = stateCell(null);
  const sent = [];
  const pending = [];
  const bindings = {
    liveOwner: {
      status: "ready",
      api: {
        saveJourneyPlan: (plan) => {
          sent.push(plan);
          // 답은 요청한 순서대로 정해지고, 도착 순서는 시험이 정한다.
          const response = saveResults.shift();
          return new Promise((resolve) => pending.push(() => resolve(response)));
        },
      },
    },
    get state() { return state.value; },
    toggledJourneyPlan,
    journeyWithPlan,
    setNotice: notice.set,
    setState: state.set,
    saveSequenceRef: { current: 0 },
    confirmedSequenceRef: { current: 0 },
    gateRef: { current: createReadGate() },
    load: async () => {},
    confirmedRef: { current: confirmed },
    JOURNEY_STATE_COPY: { saveFailed: "저장하지 못했어요. 다시 눌러 주세요." },
  };
  return { run: extractCallback("app/(tabs)/journey.tsx", "save", bindings), state, notice, sent, pending, bindings };
}

test("journey toggles draw at once, keep the server's answer, and roll back with a true sentence on failure", async () => {
  const serverAfter = journeyFixture();
  serverAfter.plan = { off: ["families"], addOns: [] };
  serverAfter.journey.rows[1] = { ...serverAfter.journey.rows[1], off: true };
  const ok = journeyHarness([{ ok: true, data: serverAfter }]);
  const saving = ok.run("stage", "families");
  // 기다리지 않고 바로 그린다.
  assert.equal(ok.state.value.value.journey.rows[1].off, true);
  assert.deepEqual(ok.sent, [{ off: ["families"], addOns: [] }]);
  ok.pending.shift()();
  await saving;
  assert.equal(ok.state.value.value, serverAfter, "서버가 확인해 준 계획으로 바꾼다");
  assert.equal(ok.notice.value, null);

  const failing = journeyHarness([{ ok: false, reason: "http", status: 409, code: "PLAN_CHANGED", message: null }]);
  const before = failing.state.value.value;
  const attempt = failing.run("addOn", "rings");
  assert.equal(failing.state.value.value.journey.addOns[0].added, true);
  failing.pending.shift()();
  await attempt;
  assert.equal(failing.state.value.value, before, "마지막으로 확인된 계획으로 되돌린다");
  assert.equal(failing.notice.value, "저장하지 못했어요. 다시 눌러 주세요.");
});

test("a late answer to an earlier toggle cannot overwrite a later one", async () => {
  const first = journeyFixture();
  first.plan = { off: ["families"], addOns: [] };
  const second = journeyFixture();
  second.plan = { off: [], addOns: [] };
  const h = journeyHarness([{ ok: true, data: first }, { ok: true, data: second }]);
  const a = h.run("stage", "families");
  const b = h.run("stage", "families");
  // 두 번째 답이 먼저 온다.
  const [resolveFirst, resolveSecond] = h.pending;
  resolveSecond();
  await Promise.resolve();
  resolveFirst();
  await Promise.all([a, b]);
  assert.equal(h.state.value.value.plan.off.length, 0, "늦게 온 앞 요청의 답이 뒤 요청의 화면을 덮었다");
  // 되돌릴 자리도 늦게 온 앞 답으로 바뀌지 않는다.
  assert.equal(h.bindings.confirmedRef.current, second);
});

test("a journey read that left before a save cannot undo it, and the tab reads once per visit", RACE, async () => {
  const before = journeyFixture();
  const after = journeyFixture();
  after.plan = { off: ["families"], addOns: [] };
  const reads = deferredCalls();
  const h = journeyHarness([{ ok: true, data: after }]);
  h.bindings.liveOwner.api.journey = reads.fn;
  h.bindings.setRefreshing = () => {};
  const load = extractCallback("app/(tabs)/journey.tsx", "load", h.bindings);
  h.bindings.load = load;
  // 탭에 돌아와 읽기가 떠난 뒤 사람이 단계를 뺀다.
  const reading = load();
  const saving = h.run("stage", "families");
  h.pending[0]();
  await saving;
  assert.deepEqual(h.state.value.value.plan.off, ["families"]);
  // 저장 전에 떠난 읽기가 옛 계획을 들고 늦게 온다. 그리지 않고 다시 읽는다.
  reads.calls[0].resolve({ ok: true, data: before });
  await flush();
  assert.deepEqual(h.state.value.value.plan.off, ["families"], "옛 읽기가 방금 뺀 단계를 되살렸다");
  assert.equal(reads.calls.length, 2);
  reads.calls[1].resolve({ ok: true, data: after });
  await flush();
  assert.deepEqual(h.state.value.value.plan.off, ["families"]);
  void reading;

  // 처음 열 때 한 번만 읽는다(읽기는 탭에 올 때와 새로 고침에서만).
  const journey = code("app/(tabs)/journey.tsx");
  assert.doesNotMatch(journey, /useEffect\(/u);
  assert.equal((journey.match(/\.journey\(\)/gu) ?? []).length, 1);
  assert.match(journey, /useFocusEffect\(useCallback\(\(\) => \{\s*void load\(\);\s*\}, \[load\]\)\);/u);
});

// ── 일정(상담) ──────────────────────────────────────────────────────────────

test("a consultation goes into the schedule only on the couple's tap, and says so truthfully", async () => {
  const consultationFile = "src/components/invitationLive/LiveConsultation.tsx";
  const run = (state, result) => {
    const calls = [];
    const cells = { state: stateCell(state), notice: stateCell(null), adding: stateCell(false), added: stateCell(false) };
    const fn = extractCallback(consultationFile, "addToSchedule", {
      liveOwner: { status: "ready", api: { addConsultationToSchedule: async (replyId) => { calls.push(replyId); return result; } } },
      state,
      adding: false,
      setAdding: cells.adding.set,
      setNotice: cells.notice.set,
      setJustAdded: cells.added.set,
      setState: cells.state.set,
      gateRef: { current: createReadGate() },
      load: async () => { calls.push("load"); },
      COMMON_STATE_COPY: { saveFailed: "저장하지 못했어요. 다시 눌러 주세요." },
    });
    return { fn, calls, cells };
  };
  const ready = { status: "ready", value: { consultation: {}, replyId: "dddddddd-4444-4444-8444-444444444444", inCalendar: false, startsAt: null } };
  const ok = run(ready, { ok: true, data: { added: true, alreadyInCalendar: false, eventId: "e" } });
  await ok.fn();
  assert.deepEqual(ok.calls, [ready.value.replyId]);
  assert.equal(ok.cells.state.value.value.inCalendar, true);
  assert.equal(ok.cells.added.value, true);
  const failed = run(ready, { ok: false, reason: "http", status: 409, code: "REPLY_NOT_CONFIRMED", message: "확정된 상담 시간만 일정에 넣을 수 있어요." });
  await failed.fn();
  assert.equal(failed.cells.notice.value, "확정된 상담 시간만 일정에 넣을 수 있어요.");
  assert.equal(failed.cells.state.history.length, 0, "실패하면 일정에 있다고 말하지 않는다");
  const noReply = run({ status: "ready", value: { ...ready.value, replyId: null } }, null);
  await noReply.fn();
  assert.deepEqual(noReply.calls, []);

  const source = code(consultationFile);
  assert.equal((source.match(/\.addConsultationToSchedule\(/gu) ?? []).length, 1);
  // 일정에 없으면 단추는 "일정에 넣기", 있으면 "캘린더에 있어요"로 전체 일정을 연다.
  assert.match(source, /onOpenCalendar=\{inCalendar \? openFullSchedule : adding \? undefined : \(\) => void addToSchedule\(\)\}/u);
  assert.match(source, /: CONSULTATION_STATE_COPY\.addToCalendar;/u);
  assert.match(source, /const FULL_SCHEDULE = "\/schedule";/u);
  // 확정된 상담이 없으면 그렇다고 말하고 전체 일정으로 가는 길을 둔다.
  assert.match(source, /title=\{CONSULTATION_STATE_COPY\.none\}\s*sub=\{CONSULTATION_STATE_COPY\.noneSub\}/u);
  assert.match(source, /actions=\{\[\{ label: CONSULTATION_STATE_COPY\.fullSchedule, onPress: openFullSchedule, tone: "outline" \}\]\}/u);
  // 처음 열 때 한 번만 읽고, "일정에 넣기"와 엇갈린 읽기는 버린 뒤 다시 읽는다.
  assert.doesNotMatch(source, /useEffect\(/u);
  assert.equal((source.match(/\.consultation\(\)/gu) ?? []).length, 1);
  assert.match(source, /useFocusEffect\(useCallback\(\(\) => \{\s*void load\(\);\s*\}, \[load\]\)\);/u);
  assert.match(source, /gateRef\.current\.beginWrite\(\);\s*const result = await liveOwner\.api\.addConsultationToSchedule\(replyId\);\s*const readNow = gateRef\.current\.endWrite\(\);/u);
  // 그 일을 할 API 가 없는 단추(상대와 공유, 다른 홀이 제안한 시간에 답하기)는 그리지 않는다.
  assert.match(source, /model=\{\{ \.\.\.consultation, partnerName: null, updateActions: \[\] \}\}/u);
  // 일정 탭은 그룹을 붙인 주소로 간다. 그룹 없는 `/schedule` 은 전체 일정 화면이다.
  assert.equal(INVITATION_LIVE_ROUTES.status, "/(tabs)/schedule");
  assert.ok(existsSync(join(mobileRoot, "app/schedule/index.tsx")));
});

// ── 웨딩홀 비교 ─────────────────────────────────────────────────────────────

const HALL_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const hallsValue = (picked, sort = "total") => ({
  compare: { guests: 200, month: 5, halls: [{ id: HALL_ID, picked }], sourceDateLabel: null },
  missing: [],
  sort,
  pickedCount: picked ? 1 : 0,
  sources: [],
});
const COMPARE_STATE_COPY_FAKE = { loadFailed: "compare:loadFailed" };

/** 웨딩홀 비교 화면의 읽기·하트·정렬 콜백을 같은 상태 위에서 돌린다. */
function hallsHarness({ shown = hallsValue(false) } = {}) {
  const reads = deferredCalls();
  const writes = deferredCalls();
  const state = stateCell(shown ? { status: "ready", value: shown } : { status: "loading" });
  const notice = stateCell(null);
  const requested = stateCell(null);
  const bindings = {
    liveOwner: { status: "ready", api: { halls: reads.fn, setHallPicked: writes.fn } },
    get state() { return state.value; },
    pendingRef: { current: new Set() },
    gateRef: { current: createReadGate() },
    wantedSortRef: { current: shown?.sort ?? "total" },
    shownSortRef: { current: shown?.sort ?? null },
    setState: state.set,
    setNotice: notice.set,
    setRequestedSort: requested.set,
    withPicked: extractFunction("app/halls/index.tsx", "withPicked"),
    COMPARE_STATE_COPY: COMPARE_STATE_COPY_FAKE,
    COMMON_STATE_COPY: { saveFailed: "저장하지 못했어요. 다시 눌러 주세요." },
  };
  bindings.load = extractCallback("app/halls/index.tsx", "load", bindings);
  const togglePick = extractCallback("app/halls/index.tsx", "togglePick", bindings);
  const changeSort = extractCallback("app/halls/index.tsx", "changeSort", bindings);
  return { bindings, load: bindings.load, togglePick, changeSort, reads, writes, state, notice, requested };
}

const pickedNow = (h) => h.state.value.value.compare.halls[0].picked;

test("a heart flips at once, and rolls back with the server's sentence when the shortlist refuses", RACE, async () => {
  const full = hallsHarness();
  const tap = full.togglePick(HALL_ID);
  assert.equal(pickedNow(full), true, "바로 그린다");
  full.writes.calls[0].resolve({ ok: false, reason: "http", status: 409, code: "SHORTLIST_FULL", message: "상담 후보는 10곳까지 담을 수 있어요." });
  await tap;
  assert.deepEqual(full.state.history.map((entry) => entry.value.compare.halls[0].picked), [true, false], "바로 그리고 되돌린다");
  assert.equal(full.notice.value, "상담 후보는 10곳까지 담을 수 있어요.");
  assert.equal(full.bindings.pendingRef.current.size, 0);
  assert.deepEqual(full.writes.calls.map((call) => call.args), [[HALL_ID, true]]);

  const ok = hallsHarness();
  const saved = ok.togglePick(HALL_ID);
  // 같은 하트를 기다리는 동안 다시 눌러도 요청은 하나다.
  void ok.togglePick(HALL_ID);
  await flush();
  assert.equal(ok.writes.calls.length, 1, "같은 하트를 기다리는 동안 다시 눌렀더니 요청이 둘 나갔다");
  ok.writes.calls[0].resolve({ ok: true, data: { hallId: HALL_ID, picked: true, pickedCount: 1 } });
  await saved;
  assert.equal(pickedNow(ok), true);
  assert.equal(ok.state.value.value.pickedCount, 1);
});

test("a hall read that left before a heart was saved cannot show the hall as unpicked", RACE, async () => {
  const h = hallsHarness();
  // 화면에 돌아와 읽기가 떠난 뒤 하트를 누르고, 저장이 먼저 끝난다.
  const reading = h.load();
  const tap = h.togglePick(HALL_ID);
  h.writes.calls[0].resolve({ ok: true, data: { hallId: HALL_ID, picked: true, pickedCount: 1 } });
  await tap;
  const afterSave = h.state.history.length;
  // 저장 전에 떠난 읽기가 하트 없는 옛 답을 들고 늦게 온다. 그리지 않고 다시 읽는다.
  h.reads.calls[0].resolve({ ok: true, data: hallsValue(false) });
  await flush();
  assert.ok(h.state.history.slice(afterSave).every((entry) => entry.value.compare.halls[0].picked), "옛 읽기가 담은 하트를 뺐다");
  assert.equal(h.reads.calls.length, 2, "저장 뒤에 다시 읽는다");
  h.reads.calls[1].resolve({ ok: true, data: hallsValue(true) });
  await flush();
  assert.equal(pickedNow(h), true);
  void reading;

  // 하트를 기다리는 동안에는 읽지 않고, 저장이 끝나면 한 번 읽는다.
  const waiting = hallsHarness();
  const pick = waiting.togglePick(HALL_ID);
  void waiting.load();
  await flush();
  assert.equal(waiting.reads.calls.length, 0, "저장 중에 읽으면 저장 전 값을 받을 수 있다");
  waiting.writes.calls[0].resolve({ ok: true, data: { hallId: HALL_ID, picked: true, pickedCount: 1 } });
  await pick;
  assert.equal(waiting.reads.calls.length, 1);
  waiting.reads.calls[0].resolve({ ok: true, data: hallsValue(true) });
  await flush();
  assert.equal(pickedNow(waiting), true);
});

test("a re-sort that fails puts the chip back on the cards shown and says so", RACE, async () => {
  const h = hallsHarness();
  const sorting = h.changeSort("transit");
  assert.equal(h.requested.value, "transit", "칩은 누르는 대로 옮긴다");
  assert.deepEqual(h.reads.calls.map((call) => call.args), [["transit"]]);
  h.reads.calls[0].resolve({ ok: false, reason: "network", status: 0, code: null, message: null });
  await sorting;
  assert.equal(h.requested.value, null, "칩을 보이는 카드의 정렬로 되돌린다");
  assert.equal(h.notice.value, COMPARE_STATE_COPY_FAKE.loadFailed);
  assert.equal(h.state.value.value.sort, "total", "보이는 카드는 그대로다");
  assert.equal(h.bindings.wantedSortRef.current, "total", "다음 읽기도 보이는 정렬로 한다");

  // 받으면 그 정렬의 카드와 칩이 함께 바뀐다.
  const next = h.changeSort("minimum");
  h.reads.calls[1].resolve({ ok: true, data: hallsValue(false, "minimum") });
  await next;
  assert.equal(h.state.value.value.sort, "minimum");
  assert.equal(h.requested.value, null);

  // 같은 정렬을 다시 읽다 실패하면 보이는 카드를 그대로 두고 말을 보태지 않는다.
  const quiet = hallsHarness();
  const refresh = quiet.load();
  quiet.reads.calls[0].resolve({ ok: false, reason: "network", status: 0, code: null, message: null });
  await refresh;
  assert.equal(quiet.notice.value, null);
  assert.equal(quiet.state.history.length, 0);
  // 처음 읽기가 실패하면 불러오지 못했다는 화면이다.
  const first = hallsHarness({ shown: null });
  const opening = first.load();
  first.reads.calls[0].resolve({ ok: false, reason: "network", status: 0, code: null, message: null });
  await opening;
  assert.deepEqual(first.state.value, { status: "failed" });

  const halls = code("app/halls/index.tsx");
  assert.match(halls, /sort=\{requestedSort \?\? state\.value\.sort\}/u);
  assert.match(halls, /onSortChange=\{changeSort\}/u);
});

test("the comparison reads once when it opens, not twice", () => {
  const halls = code("app/halls/index.tsx");
  assert.doesNotMatch(halls, /useEffect\(/u);
  assert.equal((halls.match(/\.halls\(/gu) ?? []).length, 1);
  assert.match(halls, /useFocusEffect\(useCallback\(\(\) => \{\s*void load\(\);\s*\}, \[load\]\)\);/u);
});

test("the comparison's real empty states come from COMPARE_STATE_COPY", () => {
  const halls = code("app/halls/index.tsx");
  assert.match(halls, /title=\{COMPARE_STATE_COPY\.needConditions\}/u);
  assert.match(halls, /label: COMPARE_STATE_COPY\.needConditionsAction, onPress: \(\) => router\.dismissTo\(ASK_CONDITIONS_HREF\)/u);
  assert.match(halls, /title=\{COMPARE_STATE_COPY\.noHalls\} sub=\{COMPARE_STATE_COPY\.noHallsSub\}/u);
  assert.match(halls, /title=\{COMPARE_STATE_COPY\.loadFailed\}/u);
  assert.match(halls, /pickedCount === 0 \? COMPARE_STATE_COPY\.pickFirst : null/u);
  // 사진은 https 주소와 예시 사진 이름을 모두 받는다.
  const photos = code("src/components/invitation/invitationPhotos.ts");
  assert.match(photos, /\/\^https:\\\/\\\/\/u\.test\(photo\)/u);
});

// ── 편지 확인 시트 ──────────────────────────────────────────────────────────

const LETTER_COPY_FAKE = {
  queued: (count) => `queued:${count}`,
  alreadySent: "alreadySent",
  approvedNotSent: "approvedNotSent",
  dailyCap: "dailyCap",
  approverHeading: "approverHeading",
  approverUnavailable: "approverUnavailable",
  waitingFor: (name) => `waitingFor:${name}`,
  approverNeedsBoth: "approverNeedsBoth",
  versionChanged: "versionChanged",
  saveFailed: "saveFailed",
};

const letterModel = {
  recipients: ["합성 홀"],
  dateLabel: "11. 17",
  body: "합성 본문",
  signature: "가와 나 드림",
  shares: [
    { key: "name", label: "이름", value: "가", on: true },
    { key: "phone", label: "휴대폰 번호", value: "", on: false },
    { key: "budget", label: "예산", value: "아직", on: false },
  ],
  partnerApprovedName: null,
  backdropPhoto: null,
};
const letterState = {
  letterId: "eeeeeeee-5555-4555-8555-555555555555",
  versionId: "cccccccc-3333-4333-8333-333333333333",
  version: 1,
  fingerprint: "f".repeat(64),
  status: "draft",
  approver: { mode: "both", designatedUserId: null, revision: 1 },
  approvedBy: [],
  waitingFor: ["user-a", "user-b"],
  viewerCanApprove: true,
  viewerIsApprover: true,
  sendingEnabled: false,
  notQueuedReason: null,
  recipients: [{ hallId: "aaaaaaaa-1111-4111-8111-111111111111", name: "합성 홀" }],
};
const members = [{ id: "user-a", name: "가", isViewer: true }, { id: "user-b", name: "나", isViewer: false }];

function letterHarness({ body = letterModel.body, flags = { name: true, phone: false, budget: false }, saveResult, approveResult, server = letterModel, state = letterState }) {
  const calls = { save: [], approve: [], reload: 0 };
  const cells = { notice: stateCell(null), sending: stateCell(false), state: stateCell(null), body: stateCell(body), flags: stateCell(flags) };
  const shown = { ...server, body, shares: server.shares.map((share) => ({ ...share, on: flags[share.key] })) };
  const noticeText = extractFunction("app/halls/letter.tsx", "noticeText", { LETTER_STATE_COPY: LETTER_COPY_FAKE });
  const run = extractCallback("app/halls/letter.tsx", "send", {
    liveOwner: {
      status: "ready",
      api: {
        saveLetter: async (payload) => { calls.save.push(payload); return saveResult; },
        approveLetter: async (version) => { calls.approve.push(version); return approveResult; },
      },
    },
    state: { status: "ready", letter: { letter: server, state, missing: [] }, approver: { setting: state.approver, members } },
    server,
    letterState: state,
    shown,
    sendingRef: { current: false },
    body,
    flags,
    reload: () => { calls.reload += 1; },
    members,
    setSending: cells.sending.set,
    setActionNotice: cells.notice.set,
    setState: cells.state.set,
    setEditedBody: cells.body.set,
    setEditedFlags: cells.flags.set,
    isLetterDirty,
    letterSaveBody,
    sameVisibleLetter,
    isLetterVersionChanged,
    letterApprovalNotice,
    noticeText,
    LETTER_STATE_COPY: LETTER_COPY_FAKE,
  });
  return { run, calls, cells };
}

const approvedNotSent = {
  ok: true,
  data: { result: { status: "approved_not_queued", notQueuedReason: "sending_disabled", queuedCount: 0, duplicateHallIds: [], waitingFor: [] }, letter: null },
};

test("an unchanged letter is approved by its version and fingerprint, and a switched-off sender is told the truth", async () => {
  const h = letterHarness({ approveResult: approvedNotSent });
  await h.run();
  assert.deepEqual(h.calls.save, [], "고친 것이 없으면 새 판을 만들지 않는다");
  assert.deepEqual(h.calls.approve, [{ versionId: letterState.versionId, fingerprint: letterState.fingerprint }]);
  assert.equal(h.cells.notice.value, "approvedNotSent");
  assert.deepEqual(h.cells.sending.history, [true, false]);
});

test("an edited letter is saved first, and approved only when the saved version reads like what was on screen", async () => {
  const savedSame = { ok: true, data: { letter: { ...letterModel, body: "고친 본문" }, state: { ...letterState, versionId: "cccccccc-9999-4999-8999-999999999999", fingerprint: "a".repeat(64) }, missing: [] } };
  const same = letterHarness({ body: "고친 본문", saveResult: savedSame, approveResult: { ok: true, data: { result: { status: "awaiting_approval", notQueuedReason: null, queuedCount: 0, duplicateHallIds: [], waitingFor: ["user-b"] }, letter: null } } });
  await same.run();
  assert.equal(same.calls.save.length, 1);
  assert.equal(same.calls.save[0].body, "고친 본문");
  assert.deepEqual(same.calls.approve, [{ versionId: "cccccccc-9999-4999-8999-999999999999", fingerprint: "a".repeat(64) }], "방금 저장한 판으로 승인한다");
  assert.equal(same.cells.notice.value, "waitingFor:나", "기다리는 사람 이름만 말하고, 보는 사람은 빼고 센다");

  // 맺음말처럼 사람이 보지 못한 것이 저장된 판에서 바뀌었으면 승인하지 않는다.
  const savedDifferent = { ok: true, data: { letter: { ...letterModel, body: "고친 본문", signature: "합성 맺음말" }, state: letterState, missing: [] } };
  const different = letterHarness({ body: "고친 본문", saveResult: savedDifferent, approveResult: approvedNotSent });
  await different.run();
  assert.deepEqual(different.calls.approve, []);
  assert.equal(different.cells.notice.value, "versionChanged");
  assert.equal(different.cells.body.value, null, "저장한 뒤에는 서버 판을 보여 준다");
});

test("a version changed under the couple is never approved; the sheet reloads and asks to check again", async () => {
  const changed = letterHarness({ approveResult: { ok: false, reason: "http", status: 409, code: "LETTER_VERSION_CHANGED", message: "편지 내용이 바뀌었어요." } });
  await changed.run();
  assert.equal(changed.calls.reload, 1);
  assert.equal(changed.cells.notice.value, "versionChanged");
  // 저장이 거절되면(예: 휴대폰 번호 없이 켬) 서버 문장을 그대로 말하고 승인하지 않는다.
  const refused = letterHarness({
    flags: { name: true, phone: true, budget: false },
    saveResult: { ok: false, reason: "http", status: 400, code: "LETTER_SHARES_INVALID", message: "알려줄 휴대폰 번호를 적어 주세요." },
    approveResult: approvedNotSent,
  });
  await refused.run();
  assert.deepEqual(refused.calls.approve, []);
  assert.equal(refused.cells.notice.value, "알려줄 휴대폰 번호를 적어 주세요.");
  assert.equal(refused.calls.save[0].shares.phone.value, null, "가린 번호를 다시 보내지 않는다");
  // 보낼 준비를 마친 편지(LETTER_LOCKED)처럼 서버 쪽이 바뀌면 새로 불러온다.
  const locked = letterHarness({ body: "고친 본문", saveResult: { ok: false, reason: "http", status: 409, code: "LETTER_LOCKED", message: null }, approveResult: approvedNotSent });
  await locked.run();
  assert.equal(locked.calls.reload, 1);
  assert.equal(locked.cells.notice.value, "saveFailed");
});

test("two quick taps on send save and approve once", RACE, async () => {
  const h = letterHarness({ body: "고친 본문", saveResult: { ok: true, data: { letter: { ...letterModel, body: "고친 본문" }, state: letterState, missing: [] } }, approveResult: approvedNotSent });
  // 두 번째 누름은 첫 번째가 `sending` 을 그리기 전에 온다.
  await Promise.all([h.run(), h.run()]);
  assert.equal(h.calls.save.length, 1, "같은 순간 두 번 눌러 새 판을 두 번 만들었다");
  assert.equal(h.calls.approve.length, 1, "같은 순간 두 번 눌러 두 번 승인했다");
  assert.deepEqual(h.cells.sending.history, [true, false]);
  // 끝나면 다시 누를 수 있다(실패한 길에서도 풀린다).
  const failed = letterHarness({ approveResult: { ok: false, reason: "network", status: 0, code: null, message: null } });
  await failed.run();
  await failed.run();
  assert.equal(failed.calls.approve.length, 2);
});

test("two quick taps on an approver chip save the choice once", RACE, async () => {
  const saves = [];
  const state = stateCell({ status: "ready", letter: {}, approver: null });
  const run = extractCallback("app/halls/letter.tsx", "chooseApprover", {
    liveOwner: { status: "ready", api: { saveApprover: async (choice) => { saves.push(choice); return { ok: true, data: { setting: letterState.approver, members, pending: null } }; } } },
    state: state.value,
    approverSavingRef: { current: false },
    sendingRef: { current: false },
    setApproverSaving: () => {},
    setActionNotice: () => {},
    setState: state.set,
    reload: () => {},
    LETTER_STATE_COPY: LETTER_COPY_FAKE,
    COMMON_STATE_COPY: { saveFailed: "common:saveFailed" },
  });
  await Promise.all([run({ mode: "both" }), run({ mode: "both" })]);
  assert.deepEqual(saves, [{ mode: "both" }]);
  // 보내는 동안에는 승인 방식을 바꾸지 않는다.
  const sendingNow = extractCallback("app/halls/letter.tsx", "chooseApprover", {
    liveOwner: { status: "ready", api: { saveApprover: async (choice) => { saves.push(choice); return { ok: false }; } } },
    state: state.value,
    approverSavingRef: { current: false },
    sendingRef: { current: true },
    setApproverSaving: () => {},
    setActionNotice: () => {},
    setState: state.set,
    reload: () => {},
    LETTER_STATE_COPY: LETTER_COPY_FAKE,
  });
  await sendingNow({ mode: "both" });
  assert.equal(saves.length, 1);
});

// ── 승인 방식 제안(상대가 확인해야 바뀐다) ──────────────────────────────────

const PROPOSAL_ID = "eeeeeeee-5555-4555-8555-555555555555";
const PROPOSAL_COPY_FAKE = {
  ...LETTER_COPY_FAKE,
  approverBoth: "both",
  approverPerson: (name) => `person:${name}`,
  approverProposedBy: (name, choice) => `proposedBy:${name}:${choice}`,
};
const proposalOf = (overrides) => ({
  proposalId: PROPOSAL_ID,
  mode: "designated",
  designatedUserId: "user-b",
  proposedBy: "user-b",
  proposedAt: "2026-11-17T03:00:00.000Z",
  viewerCanRespond: true,
  ...overrides,
});

test("a pending approver proposal is told to the proposer and put to the other member, never guessed", () => {
  const pickerFile = "src/components/invitation/InvitationApproverPicker.tsx";
  const choiceKey = extractFunction(pickerFile, "choiceKey");
  const view = extractFunction(pickerFile, "approverProposalView", { LETTER_STATE_COPY: PROPOSAL_COPY_FAKE, choiceKey });
  assert.deepEqual(view(null, members), { role: "none" });
  // 내가 낸 제안: 상대가 확인하면 바뀐다고만 말하고, 제안한 칩을 점선으로 둔다.
  assert.deepEqual(view(proposalOf({ proposedBy: "user-a", viewerCanRespond: false, mode: "both", designatedUserId: null }), members), { role: "proposer", proposedKey: "both" });
  // 답할 수 없는데 내가 낸 것도 아니면 아무것도 말하지 않는다.
  assert.deepEqual(view(proposalOf({ viewerCanRespond: false }), members), { role: "none" });
  // 상대가 낸 제안: 누가 무엇을 제안했는지 승인 방식 칸이 준 이름으로 말한다.
  assert.deepEqual(view(proposalOf({}), members), { role: "responder", proposedKey: "user-b", sentence: "proposedBy:나:person:나" });
  assert.equal(view(proposalOf({ mode: "both", designatedUserId: null }), members).sentence, "proposedBy:나:both");
  // 이름을 모르면(또는 "정하지 않음" 제안처럼 이름이 없는 방식이면) 확인·거절을 두지 않는다.
  const unnamed = [{ id: "user-a", name: "가", isViewer: true }, { id: "user-b", name: " ", isViewer: false }];
  assert.equal(view(proposalOf({}), unnamed).sentence, null);
  assert.equal(view(proposalOf({ mode: "unset", designatedUserId: null }), members).sentence, null);

  const picker = code(pickerFile);
  // 내가 낸 제안이 기다리는 동안에는 지금 방식 칩을 다시 눌러 거둘 수 있다. 그 밖에는 고른 칩을 누를 수 없다.
  assert.match(picker, /const withdrawable = proposal\.role === "proposer";/u);
  assert.match(picker, /pressable=\{!on \|\| withdrawable\}/u);
  assert.match(picker, /pressable=\{mode !== "both" \|\| withdrawable\}/u);
  assert.match(picker, /onPress=\{pressable && !disabled \? onPress : undefined\}/u);
  assert.match(picker, /proposed=\{proposedKey === member\.id\}/u);
  assert.match(picker, /\{proposal\.role === "proposer" \? \(\s*<Text[^>]*>\{LETTER_STATE_COPY\.approverPending\}<\/Text>/u);
  assert.match(picker, /\{proposal\.role === "responder" && proposal\.sentence \? \(/u);
  assert.match(picker, /label=\{LETTER_STATE_COPY\.approverConfirm\}\s*onPress=\{busy \? undefined : \(\) => onRespond\?\.\(true\)\}/u);
  assert.match(picker, /label=\{LETTER_STATE_COPY\.approverDecline\}\s*onPress=\{busy \? undefined : \(\) => onRespond\?\.\(false\)\}/u);
  const letter = code("app/halls/letter.tsx");
  assert.match(letter, /pending=\{approver\.pending \?\? null\}/u);
  assert.match(letter, /onRespond=\{\(accept\) => \{\s*void respondApprover\(accept\);\s*\}\}/u);
});

function respondHarness({ pending = proposalOf({}), result, sending = false }) {
  const calls = { confirm: [], decline: [], reload: 0 };
  const notice = stateCell(null);
  const saving = stateCell(false);
  const ready = { status: "ready", letter: {}, approver: { setting: { mode: "unset", designatedUserId: null, revision: 1 }, members, pending } };
  const state = stateCell(ready);
  const run = extractCallback("app/halls/letter.tsx", "respondApprover", {
    liveOwner: {
      status: "ready",
      api: {
        confirmApprover: async (id) => { calls.confirm.push(id); return result; },
        declineApprover: async (id) => { calls.decline.push(id); return result; },
      },
    },
    state: ready,
    approverSavingRef: { current: false },
    sendingRef: { current: sending },
    setApproverSaving: saving.set,
    setActionNotice: notice.set,
    setState: state.set,
    reload: () => { calls.reload += 1; },
    COMMON_STATE_COPY: { saveFailed: "common:saveFailed" },
  });
  return { run, calls, notice, saving, state };
}

test("the other member confirms or declines the proposal by its id; a stale proposal reloads the setting", RACE, async () => {
  const applied = { ok: true, data: { setting: { mode: "designated", designatedUserId: "user-b", revision: 2 }, members, pending: null, outcome: "confirmed" } };
  const confirm = respondHarness({ result: applied });
  await confirm.run(true);
  assert.deepEqual(confirm.calls.confirm, [PROPOSAL_ID]);
  assert.deepEqual(confirm.calls.decline, []);
  assert.equal(confirm.state.value.approver, applied.data);
  assert.equal(confirm.calls.reload, 1, "확인하면 판이 바뀌어 편지 상태를 다시 읽는다");
  assert.deepEqual(confirm.saving.history, [true, false]);

  const kept = { ok: true, data: { setting: { mode: "unset", designatedUserId: null, revision: 1 }, members, pending: null, outcome: "declined" } };
  const decline = respondHarness({ result: kept });
  await decline.run(false);
  assert.deepEqual(decline.calls.decline, [PROPOSAL_ID]);
  assert.equal(decline.state.value.approver.pending, null);
  assert.equal(decline.calls.reload, 0, "거절하면 지금 방식이 그대로다");

  // 그 사이 제안이 바뀌었거나 거둬졌다: 지금 방식을 다시 읽고 서버 문장을 그대로 말한다.
  const stale = respondHarness({ result: { ok: false, reason: "http", status: 409, code: "APPROVER_PROPOSAL_CHANGED", message: "승인 방식 제안이 바뀌었어요. 다시 확인해 주세요." } });
  await stale.run(true);
  assert.equal(stale.calls.reload, 1);
  assert.equal(stale.notice.value, "승인 방식 제안이 바뀌었어요. 다시 확인해 주세요.");
  assert.equal(stale.state.history.length, 0, "실패하면 바뀌었다고 그리지 않는다");
  const offline = respondHarness({ result: { ok: false, reason: "network", status: 0, code: null, message: null } });
  await offline.run(false);
  assert.equal(offline.calls.reload, 0);
  assert.equal(offline.notice.value, "common:saveFailed");

  // 답할 수 없는 사람(제안한 사람)·제안이 없을 때·보내는 중에는 아무것도 보내지 않는다. 두 번 눌러도 한 번이다.
  for (const h of [
    respondHarness({ pending: proposalOf({ proposedBy: "user-a", viewerCanRespond: false }), result: applied }),
    respondHarness({ pending: null, result: applied }),
    respondHarness({ result: applied, sending: true }),
  ]) {
    await h.run(true);
    assert.deepEqual([h.calls.confirm.length, h.calls.decline.length], [0, 0]);
  }
  const twice = respondHarness({ result: applied });
  await Promise.all([twice.run(true), twice.run(true)]);
  assert.equal(twice.calls.confirm.length, 1);
});

test("the proposer withdraws by picking the setting that is in use again", RACE, async () => {
  const saves = [];
  const state = stateCell(null);
  let reloads = 0;
  const withdrawn = { setting: { mode: "both", designatedUserId: null, revision: 3 }, members, pending: null, outcome: "withdrawn" };
  const run = extractCallback("app/halls/letter.tsx", "chooseApprover", {
    liveOwner: { status: "ready", api: { saveApprover: async (choice) => { saves.push(choice); return { ok: true, data: withdrawn }; } } },
    state: { status: "ready", letter: {}, approver: { setting: withdrawn.setting, members, pending: proposalOf({ proposedBy: "user-a", viewerCanRespond: false }) } },
    approverSavingRef: { current: false },
    sendingRef: { current: false },
    setApproverSaving: () => {},
    setActionNotice: () => {},
    setState: (update) => { state.value = typeof update === "function" ? update({ status: "ready", letter: {}, approver: null }) : update; },
    reload: () => { reloads += 1; },
    COMMON_STATE_COPY: { saveFailed: "common:saveFailed" },
  });
  await run({ mode: "both" });
  assert.deepEqual(saves, [{ mode: "both" }], "지금 방식을 그대로 보낸다(서버가 내 제안을 거둔다)");
  assert.equal(state.value.approver.pending, null);
  assert.equal(reloads, 1);
});

test("the approval sentence covers every outcome the server can give", () => {
  const noticeText = extractFunction("app/halls/letter.tsx", "noticeText", { LETTER_STATE_COPY: LETTER_COPY_FAKE });
  assert.equal(noticeText({ kind: "queued", count: 2 }, members, "unset"), "queued:2");
  assert.equal(noticeText({ kind: "alreadySent" }, members, "unset"), "alreadySent");
  assert.equal(noticeText({ kind: "approvedNotSent" }, members, "unset"), "approvedNotSent");
  assert.equal(noticeText({ kind: "dailyCap" }, members, "unset"), "dailyCap");
  assert.equal(noticeText({ kind: "approverUnavailable" }, members, "designated"), "approverUnavailable");
  assert.equal(noticeText({ kind: "waiting", userIds: ["user-a"] }, members, "both"), "approverNeedsBoth", "내 차례만 남았으면 이름을 말하지 않는다");
  assert.equal(noticeText({ kind: "waiting", userIds: ["user-a"] }, members, "designated"), null);
});

test("the sheet carries the approver choice, sends only from the send button, and never sends twice at once", () => {
  const letter = code("app/halls/letter.tsx");
  assert.match(letter, /onSend=\{\(\) => \{\s*void send\(\);\s*\}\}/u);
  assert.equal((letter.match(/\.approveLetter\(/gu) ?? []).length, 1);
  assert.match(letter, /sendBusy=\{sending\}/u);
  assert.match(letter, /<InvitationApproverPicker\b/u);
  assert.match(letter, /choice\.mode === "designated" \? \{ mode: "designated", designatedUserId: choice\.userId \} : \{ mode: "both" \}/u);
  const sheet = code("src/components/invitation/InvitationLetterSheet.tsx");
  assert.match(sheet, /onPress=\{count > 0 && !sendBusy \? \(onSend \?\? \(\(\) => onNavigate\("status"\)\)\) : undefined\}/u);
  assert.match(sheet, /\{approver\}/u);
  const picker = code("src/components/invitation/InvitationApproverPicker.tsx");
  assert.match(picker, /LETTER_STATE_COPY\.approverHeading/u);
  assert.match(picker, /members\.length >= 2 \?/u, "두 사람이 모이기 전에는 '두 사람 모두'를 고를 수 없다");
  assert.match(picker, /hitSlop=\{hitSlopFor\(38\)\}/u);
  assert.match(picker, /accessibilityState=\{\{ selected: on, disabled \}\}/u);
});

// ── 글자·모듈 ──────────────────────────────────────────────────────────────

const LIVE_FILES = [
  "app/(tabs)/journey.tsx",
  "app/(tabs)/schedule.tsx",
  "app/halls/_layout.tsx",
  "app/halls/index.tsx",
  "app/halls/letter.tsx",
  "app/halls/consultation.tsx",
  ...readdirSync(join(mobileRoot, "src/components/invitationLive")).map((name) => `src/components/invitationLive/${name}`),
];

test("the new live screens take every word from the shared invitation copy", () => {
  assert.ok(LIVE_FILES.length >= 9, `훑을 파일을 못 찾았다: ${LIVE_FILES.length}`);
  for (const file of LIVE_FILES) {
    const hangul = code(file).match(/[ㄱ-ㆎ가-힣]+/gu) ?? [];
    assert.deepEqual(hangul, [], `${file}: 화면 글자를 직접 적었다 — @hanbang/shared/invitation 에서 읽을 것`);
  }
});

test("the new live screens add no native module, so they ship over the air", () => {
  // `amoraTasks` 는 홈의 「아모라가 맡은 일」 카드(2026-11-20). JS 만 쓴다(amoraTasksScreens.test.mjs 가 그 안의 가져오기를 본다).
  const allowed = /^(react|react-native|react-native-safe-area-context|expo-router|@hanbang\/shared\/invitation|@hanbang\/design-tokens|@\/components\/((invitation|invitationLive|ui|lounge|dashboard|amoraTasks)\/)?[A-Za-z]+|@\/lib\/[A-Za-z.]+)$/u;
  for (const file of [...LIVE_FILES, "app/(tabs)/_layout.tsx", "app/(tabs)/lounge.tsx", "src/lib/invitationLive.ts", "src/lib/useKeyboardShown.ts"]) {
    const tree = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    for (const statement of tree.statements.filter(ts.isImportDeclaration)) {
      const from = statement.moduleSpecifier.text;
      if (file === "app/(tabs)/lounge.tsx" && ["@react-native-async-storage/async-storage", "@hanbang/shared", "@/constants/checklists"].includes(from)) continue;
      assert.match(from, allowed, `${file}: ${from}`);
    }
  }
  const pkg = JSON.parse(read("package.json"));
  for (const banned of ["expo-blur", "expo-linear-gradient", "expo-image", "@react-navigation/bottom-tabs"]) {
    assert.equal({ ...pkg.dependencies, ...pkg.devDependencies }[banned], undefined, banned);
  }
});

test("pills under 44pt widen their touch area and every new control says what it is", () => {
  assert.match(code("src/components/invitation/InvitationFirstChat.tsx"), /accessibilityLabel=\{`\$\{label\} \$\{choice\.label\}`\}[\s\S]{0,120}hitSlop=\{hitSlopFor\(42\)\}/u);
  assert.match(code("src/components/invitation/InvitationHome.tsx"), /hitSlop=\{\{ \.\.\.hitSlopFor\(34\), left: 6, right: 6 \}\}/u);
  assert.match(code("src/components/invitationLive/LoungeRecordsEntry.tsx"), /row: \{ minHeight: 44,/u);
  assert.match(code("src/components/invitationLive/LoungeRecordsEntry.tsx"), /accessibilityRole="button"/u);
  const state = code("src/components/invitation/InvitationStateScreen.tsx");
  assert.match(state, /height=\{46\}/u);
  assert.match(state, /accessibilityLiveRegion="polite"/u);
});
