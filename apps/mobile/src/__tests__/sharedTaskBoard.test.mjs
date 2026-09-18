import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { setImmediate } from "node:timers";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";
import * as actionModel from "../lib/amoraActions.mjs";
import * as sharedActions from "@hanbang/shared/amora-shared-actions";

/**
 * 준비 기록 화면의 공유 할 일 보드(`SharedTaskBoard`)를 실제 컴포넌트로 그려 누른다.
 *
 * 예전 보드(AmoraActionsCard presentation="board")의 검사(커서 페이지 중복 제거·커서 인코딩·
 * 커플 변경 뒤 늦은 페이지·상태 전환 중 늦은 페이지·커서 없는 잘림 안내)는 같은 단언으로
 * 옮겼고, 상태 되돌리기·보류·카드 내용·계정 경계 검사를 더했다.
 */

const read = (relative) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
const boardSource = read("../components/preparation/SharedTaskBoard.tsx");
const screenSource = read("../../app/amora-preparation.tsx");

function compile(source, requireFor, fileName = "module.tsx") {
  const code = ts.transpileModule(source, { fileName, compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const module = { exports: {} };
  new Function("exports", "module", "require", code)(module.exports, module, requireFor);
  return module.exports;
}

const strict = (modules) => (name) => { assert.ok(Object.hasOwn(modules, name), `unmocked dependency ${name}`); return modules[name]; };
const planning = compile(read("../../../../packages/shared/src/constants/weddingPlanning.ts"), strict({}), "module.ts");
const checklistParam = compile(read("../lib/checklistCategoryParam.ts"), strict({ "@hanbang/shared/constants": planning }), "module.ts");

const action = (over = {}) => ({
  id: "act1", title: "청첩장 문구 확정하기", status: "open", priority: "medium", dueDate: "", ...over,
});

function boardHarness() {
  const slots = [], effects = [], listeners = new Set(), calls = [];
  let index = 0, dirty = true, tree, authListener;
  const identity = { userId: "viewer", couple_id: "couple-a", role: "bride" };
  const responses = [], navigation = [];
  const requestIds = ["0f8fad5b-d9cb-469f-a165-70867728950e", "7c9e6679-7425-40de-944b-e07fc1f90ae7", "9b2d6f4c-5c1e-4b7a-8d3f-2a6e1c0b9d44"];
  const equal = (a, b) => a?.length === b?.length && a.every((value, i) => Object.is(value, b[i]));
  const hooks = {
    useState(initial) {
      const key = index++;
      slots[key] ??= { value: typeof initial === "function" ? initial() : initial };
      return [slots[key].value, value => {
        const next = typeof value === "function" ? value(slots[key].value) : value;
        if (!Object.is(next, slots[key].value)) { slots[key].value = next; dirty = true; }
      }];
    },
    useRef(value) { const key = index++; slots[key] ??= { current: value }; return slots[key]; },
    useCallback(callback, deps) {
      const key = index++;
      if (!slots[key] || !equal(slots[key].deps, deps)) slots[key] = { callback, deps };
      return slots[key].callback;
    },
    useEffect(callback, deps) {
      const key = index++;
      if (!slots[key] || !equal(slots[key].deps, deps)) {
        const previous = slots[key];
        slots[key] = { deps };
        effects.push(() => { previous?.cleanup?.(); slots[key].cleanup = callback(); });
      }
    },
  };
  const jsx = (type, props) => ({ type, props: props ?? {} });
  const token = new Proxy(() => 1, { get: () => token });
  const icons = new Proxy({}, { get: (_target, name) => String(name) });
  const supabase = {
    auth: {
      getUser: async () => ({ data: { user: identity.userId ? { id: identity.userId } : null }, error: identity.authError ?? null }),
      onAuthStateChange(callback) { authListener = callback; return { data: { subscription: { unsubscribe() {} } } }; },
    },
    from(table) {
      assert.equal(table, "profiles");
      const query = { select() { return query; }, eq() { return query; },
        single: async () => ({ data: { couple_id: identity.couple_id, role: identity.role }, error: null }) };
      return query;
    },
    channel() {
      const channel = { on(_event, _filter, callback) { listeners.add(callback); channel.callback = callback; return channel; }, subscribe() { return channel; } };
      return channel;
    },
    removeChannel(channel) { listeners.delete(channel.callback); },
  };
  const scopeModule = compile(read("../lib/amoraActionScope.ts"), strict({
    "@/lib/supabase": { supabase }, "@/lib/amoraActions.mjs": actionModel, "@hanbang/shared/amora-shared-actions": sharedActions,
  }), "module.ts");
  const modules = {
    react: hooks,
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "react-native": {
      KeyboardAvoidingView: "KeyboardAvoidingView", Modal: "Modal", Platform: { OS: "ios" }, Pressable: "Pressable",
      ScrollView: "ScrollView", Text: "Text", TextInput: "TextInput", View: "View", StyleSheet: { create: value => value },
    },
    "@/components/ui/AppText": { Text: "Text", TextInput: "TextInput" },
    "expo-crypto": { randomUUID: () => requestIds.shift() ?? assert.fail("no request id left") },
    "react-native-safe-area-context": { useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 34, left: 0 }) },
    "expo-router": {
      useFocusEffect: callback => hooks.useEffect(callback, [callback]),
      router: { push: route => navigation.push(["push", route]), dismissTo: route => navigation.push(["dismissTo", route]) },
    },
    "lucide-react-native": icons,
    "@hanbang/design-tokens": { colors: token, spacing: token, radius: token },
    "@hanbang/shared/constants": planning,
    "@hanbang/shared/amora-shared-actions": sharedActions,
    "@/components/ui/AppUI": { appShadow: {} },
    "@/lib/supabase": { supabase },
    "@/lib/amoraActionScope": scopeModule,
    "@/lib/checklistCategoryParam": checklistParam,
    "@/lib/api": { apiFetchForExpectedUser: async (...args) => {
      calls.push(args);
      const response = responses.shift();
      assert.ok(response, `unexpected request ${args[1]}`);
      return typeof response === "function" ? response(...args) : response;
    } },
  };
  const component = compile(boardSource, strict(modules));
  // 함수 컴포넌트(카드)는 훅 없이 props 만으로 그리므로 그 자리에서 펼친다.
  const expand = value => Array.isArray(value) ? value.map(expand)
    : value && typeof value === "object" && typeof value.type === "function" ? expand(value.type(value.props))
      : value && typeof value === "object" && value.props ? { ...value, props: { ...value.props, children: expand(value.props.children) } } : value;
  const nodes = value => !value ? [] : Array.isArray(value) ? value.flatMap(nodes)
    : typeof value === "object" ? [value, ...nodes(value.props?.children)] : [];
  const text = value => value == null || typeof value === "boolean" ? "" : Array.isArray(value) ? value.map(text).join("")
    : typeof value === "object" ? text(value.props?.children) : String(value);
  const find = label => nodes(tree).find(node => node.type === "Pressable" && (node.props.accessibilityLabel === label || text(node) === label));
  return {
    identity, responses, calls, navigation, requestIds,
    async flush() {
      for (let turn = 0; turn < 14; turn++) {
        if (dirty) { dirty = false; index = 0; tree = expand(component.default({})); while (effects.length) effects.shift()(); }
        await new Promise(resolve => setImmediate(resolve));
      }
    },
    /** 다시 그리지 않고 대기 중인 비동기 작업만 끝까지 돌린다(늦은 응답이 그 사이 상태를 바꾸는지 본다). */
    async idle() { for (let turn = 0; turn < 14; turn++) await new Promise(resolve => setImmediate(resolve)); },
    /** 지금 상태로 한 번만 그린다. */
    render() { dirty = false; index = 0; tree = expand(component.default({})); },
    text: () => text(tree),
    button: find,
    field(label) {
      const field = nodes(tree).find(node => node.type === "TextInput" && node.props.accessibilityLabel === label);
      assert.ok(field, `missing field ${label}; rendered: ${text(tree)}`);
      return field;
    },
    input(label, value) {
      const field = this.field(label);
      assert.notEqual(field.props.editable, false, `field is locked: ${label}`);
      field.props.onChangeText(value);
    },
    pressables: () => nodes(tree).filter(node => node.type === "Pressable"),
    radios: () => nodes(tree).filter(node => node.type === "Pressable" && node.props.accessibilityRole === "radio"),
    choose(label) {
      const option = nodes(tree).find(node => node.type === "Pressable" && node.props.accessibilityRole === "radio" && node.props.accessibilityLabel === label);
      assert.ok(option, `missing option ${label}`);
      assert.ok(!option.props.disabled, `option is disabled: ${label}`);
      option.props.onPress();
    },
    posts: () => calls.filter(([, , options]) => options.method === "POST"),
    gets: () => calls.filter(([, , options]) => options.method === "GET"),
    press(label) {
      const button = find(label);
      assert.ok(button, `missing button ${label}; rendered: ${text(tree)}`);
      assert.ok(!button.props.disabled, `button is disabled: ${label}`);
      return button.props.onPress();
    },
    patches: () => calls.filter(([, , options]) => options.method === "PATCH").map(([, path, options]) => [path, JSON.parse(options.body)]),
    profileChanged() { for (const listener of [...listeners]) listener({ new: { couple_id: identity.couple_id, role: identity.role } }); },
    authChanged() { authListener("SIGNED_IN", identity.userId ? { user: { id: identity.userId } } : null); },
  };
}

const listResponse = (actions, extra = {}) => ({ ok: true, json: async () => ({ actions, count: actions.length, open_count: actions.length, truncated: false, ...extra }) });
const failureResponse = { ok: false, status: 403, json: async () => ({ error: "권한이 변경됐어요." }) };
const receipt = (value) => ({ ok: true, json: async () => ({ action: value }) });
const pendingResponse = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { respond: () => promise, resolve: value => resolve(value) }; };

// ── 옮긴 보드 검사 ──────────────────────────────────────────────────────

test("진행 중 항목이 없어도 준비 기록 보드에서 완료 기록을 다시 볼 수 있다", async () => {
  const board = boardHarness(); board.responses.push(listResponse([])); await board.flush();
  board.responses.push(listResponse([action({ status: "done", title: "완료한 기록" })], { open_count: 0 }));
  board.press("완료 기록 보기"); await board.flush();
  assert.match(board.text(), /완료한 기록/u); assert.match(board.calls.at(-1)[1], /status=done&limit=80/u);
  assert.doesNotMatch(board.text(), /진행 중 할 일이 아직 없어요/u);
});

test("준비 기록은 다음 페이지를 읽고 같은 ID를 중복 표시하지 않는다", async () => {
  const h = boardHarness();
  const rows = Array.from({ length: 80 }, (_, index) => action({ id: `act${index}`, title: `할 일 ${index}` }));
  h.responses.push(listResponse(rows, { count: 81, open_count: 81, truncated: true, next_cursor: "cursor /+" })); await h.flush();
  assert.match(h.text(), /81개 중 80개/u); assert.match(h.text(), /할 일 79/u);
  h.responses.push(listResponse([rows[79], action({ id: "act80", title: "마지막 할 일" })], { count: 81, open_count: 81, truncated: true, next_cursor: null }));
  h.press("기록 더 보기"); h.press("기록 더 보기"); await h.flush();
  assert.equal(h.calls.length, 2); assert.match(h.calls[1][1], /cursor=cursor%20%2F%2B/u);
  assert.match(h.text(), /81개 중 81개/u); assert.match(h.text(), /마지막 할 일/u);
  assert.equal(h.text().split("할 일 79").length - 1, 1);
  assert.doesNotMatch(h.text(), /추가 기록을 이어서 읽을 수 없어요|일부 목록/u);
});

test("더 읽기 실패는 현재 기록을 보존하고 재조회 후 다시 이어갈 수 있다", async () => {
  const h = boardHarness();
  const first = () => listResponse([action()], { count: 2, open_count: 2, truncated: true, next_cursor: "page2" });
  h.responses.push(first()); await h.flush(); h.responses.push({ ...failureResponse, status: 503 });
  h.press("기록 더 보기"); await h.flush(); assert.match(h.text(), /청첩장 문구 확정하기/u); assert.match(h.text(), /불러오지 못/u);
  h.responses.push(first()); h.press("다시 불러오기"); await h.flush();
  h.responses.push(listResponse([action({ id: "act2", title: "이어 읽은 기록" })], { count: 2, open_count: 2, next_cursor: null }));
  h.press("기록 더 보기"); await h.flush(); assert.match(h.text(), /2개 중 2개/u); assert.match(h.text(), /이어 읽은 기록/u);
});

test("더 읽는 동안 상태를 바꾸면 예전 진행 중 응답이 완료 목록에 합쳐지지 않는다", async () => {
  const h = boardHarness();
  h.responses.push(listResponse([action()], { count: 2, open_count: 2, truncated: true, next_cursor: "page2" })); await h.flush();
  let resolve; h.responses.push(() => new Promise(done => { resolve = done; })); h.press("기록 더 보기"); await h.flush();
  h.responses.push(listResponse([action({ status: "done", title: "완료한 기록" })], { open_count: 2 })); h.press("완료 기록 보기"); await h.flush();
  resolve(listResponse([action({ id: "act2", title: "예전 페이지" })], { count: 2, open_count: 2, next_cursor: null })); await h.flush();
  assert.match(h.text(), /완료한 기록/u); assert.doesNotMatch(h.text(), /예전 페이지|청첩장 문구 확정하기/u);
});

test("상태를 바꾼 직후 도착한 예전 페이지는 다음 화면을 그리기 전에도 새 상태 자리에 들어가지 않는다", async () => {
  const h = boardHarness();
  h.responses.push(listResponse([action()], { count: 2, open_count: 2, truncated: true, next_cursor: "page2" })); await h.flush();
  let resolve; h.responses.push(() => new Promise(done => { resolve = done; })); h.press("기록 더 보기"); await h.flush();
  h.responses.push(listResponse([action({ status: "done", title: "완료한 기록" })], { open_count: 2 }));
  h.press("완료 기록 보기");
  resolve(listResponse([action({ id: "act2", title: "예전 페이지" })], { count: 2, open_count: 2, next_cursor: null }));
  await h.idle(); h.render();
  assert.doesNotMatch(h.text(), /예전 페이지|청첩장 문구 확정하기/u);
});

test("커플 변경 뒤 예전 페이지를 새 준비 기록에 추가하지 않는다", async () => {
  const h = boardHarness();
  h.responses.push(listResponse([action()], { count: 2, open_count: 2, truncated: true, next_cursor: "page2" })); await h.flush();
  let resolve; h.responses.push(() => new Promise(done => { resolve = done; })); h.press("기록 더 보기"); await h.flush();
  h.identity.couple_id = "new-couple"; h.responses.push(listResponse([action({ title: "새 기록" })])); h.profileChanged(); await h.flush();
  resolve(listResponse([action({ id: "old-page", title: "예전 페이지" })], { count: 2, open_count: 2, next_cursor: null })); await h.flush();
  assert.match(h.text(), /새 기록/u); assert.doesNotMatch(h.text(), /예전 페이지|청첩장/u);
});

test("이전 서버가 다음 커서를 주지 않으면 전체 기록을 다 읽은 척하지 않는다", async () => {
  const h = boardHarness(); h.responses.push(listResponse([action()], { count: 90, open_count: 90, truncated: true }));
  await h.flush(); assert.match(h.text(), /90개 중 1개/u); assert.match(h.text(), /추가 기록을 이어서 읽을 수 없어요/u);
});

test("준비 기록 보조 화면은 기존 4개 탭을 바꾸지 않고 실행 화면으로 연결한다", () => {
  assert.match(screenSource, /<SharedTaskBoard \/>/u);
  assert.doesNotMatch(screenSource, /AmoraActionsCard/u);
  for (const path of ["/budget", "/schedule", "/checklist"]) assert.ok(screenSource.includes(`router.push("${path}")`), path);
  // 루트 Stack 화면에서 채팅 탭으로는 push 가 아니라 dismissTo — push 는 (tabs)를 한 벌 더 쌓는다(rootStackChatNavigation.test.mjs).
  assert.ok(screenSource.includes('router.dismissTo("/(tabs)/chat")'));
  assert.match(screenSource, /router\.canGoBack\(\) \? router\.back\(\) : router\.replace\("\/\(tabs\)\/lounge"\)/u);
  const tabs = read("../../app/(tabs)/_layout.tsx");
  assert.doesNotMatch(tabs, /amora-preparation/u);
});

// ── 이름과 카드 내용 ────────────────────────────────────────────────────

test("보드와 화면 안내는 공유 할 일이라 부르고 아모라가 챙긴 것처럼 적지 않는다", async () => {
  for (const source of [boardSource, screenSource]) assert.doesNotMatch(source, /아모라가 챙기기로 한 것|아모라와 확인해 남긴/u);
  assert.match(screenSource, /공유 할 일/u);
  const h = boardHarness(); h.responses.push(listResponse([])); await h.flush();
  assert.match(h.text(), /^공유 할 일/u);
  // 상태 이름은 웹 보드와 같다.
  for (const label of ["진행 중 기록 보기", "완료 기록 보기", "보류·숨김 기록 보기"]) assert.ok(h.button(label), label);
  assert.match(h.text(), /두 사람의 합의 여부를 뜻하지 않아요/u);
  assert.doesNotMatch(h.text(), /알렸어요|알림을 보냈|알려 드렸/u);
});

test("카드는 분야 칩·설명·예정일 원문·출처를 보여주고, 분야 칩은 그 체크리스트를 연다", async () => {
  const h = boardHarness();
  h.responses.push(listResponse([
    action({ id: "act_venue", title: "예식장 계약서 확인", categoryKey: "venue", description: "위약금 조항을 같이 읽어요.", dueDate: "다음 주 중", source: "manual" }),
    action({ id: "act_general", title: "사회자 부탁하기", categoryKey: "general", dueDate: "2026-10-15", source: "chat" }),
    action({ id: "act_none", title: "분야 없는 할 일", source: "robot" }),
  ]));
  await h.flush();
  const text = h.text();
  assert.match(text, /위약금 조항을 같이 읽어요\./u);
  assert.match(text, /예정일 다음 주 중/u);
  assert.match(text, /예정일 2026-10-15/u);
  assert.doesNotMatch(text, /2026년 10월 15일까지/u, "예정일을 확정 날짜로 바꾸지 않는다");
  assert.match(text, /직접 추가한 할 일/u);
  assert.match(text, /대화에서 추가된 할 일/u);
  // 21개 분야 밖(general)과 분야 없음은 둘 다 확인이 필요하다.
  assert.equal(text.split("분야 확인 필요").length - 1, 2);
  assert.equal(h.button("일반 체크리스트 보기"), undefined);
  h.press("결혼식장 체크리스트 보기");
  assert.deepEqual(h.navigation, [["push", "/checklist?category=venue"]]);
});


// ── 상태 변경 ──────────────────────────────────────────────────────────

const STATUS_NAMES = { open: "진행 중", done: "완료", dismissed: "보류·숨김" };
const STATUS_BUTTONS = { open: ["완료로 표시", "보류·숨김"], done: ["다시 진행"], dismissed: ["다시 꺼내기"] };

async function boardAt(status, rows) {
  const h = boardHarness();
  if (status === "open") { h.responses.push(listResponse(rows)); await h.flush(); return h; }
  h.responses.push(listResponse([])); await h.flush();
  h.responses.push(listResponse(rows, { open_count: 0 })); h.press(`${STATUS_NAMES[status]} 기록 보기`); await h.flush();
  return h;
}

test("상태마다 버튼이 다르다: 진행 중은 완료로 표시·보류·숨김, 완료는 다시 진행, 보류·숨김은 다시 꺼내기", async () => {
  for (const status of ["open", "done", "dismissed"]) {
    const h = await boardAt(status, [action({ status })]);
    for (const label of ["완료로 표시", "보류·숨김", "다시 진행", "다시 꺼내기"]) {
      assert.equal(Boolean(h.button(`청첩장 문구 확정하기 ${label}`)), STATUS_BUTTONS[status].includes(label), `${status}: ${label}`);
    }
  }
});

test("상태 버튼은 PATCH {status} 하나만 보내고, 같은 id·상태 영수증일 때만 카드를 옮기고 개수를 고친다", async () => {
  for (const [status, label, next, message] of [
    ["open", "완료로 표시", "done", "완료로 표시했어요."],
    ["open", "보류·숨김", "dismissed", "보류·숨김으로 옮겼어요."],
    ["done", "다시 진행", "open", "진행 중으로 다시 꺼냈어요."],
    ["dismissed", "다시 꺼내기", "open", "진행 중으로 다시 꺼냈어요."],
  ]) {
    const rows = [action({ status }), action({ id: "act2", title: "다음 할 일", status })];
    const h = await boardAt(status, rows);
    assert.match(h.text(), new RegExp(`${STATUS_NAMES[status]} 2개 중 2개`, "u"));
    const reply = pendingResponse(); h.responses.push(reply.respond);
    h.press(`청첩장 문구 확정하기 ${label}`); await h.flush();
    // 변경은 한 번에 하나: 진행 중에는 다른 카드 버튼·상태 전환·새로고침을 막는다.
    assert.equal(h.button(`다음 할 일 ${STATUS_BUTTONS[status][0]}`).props.disabled, true, "other card");
    for (const name of Object.values(STATUS_NAMES)) assert.equal(h.button(`${name} 기록 보기`).props.disabled, true, name);
    assert.equal(h.button("공유 할 일 새로고침").props.disabled, true);
    const refetch = pendingResponse();
    h.responses.push(refetch.respond);
    reply.resolve(receipt(action({ status: next }))); await h.flush();
    // 영수증이 맞으면 재조회를 기다리지 않고 카드가 빠지고 개수가 준다.
    assert.equal(h.button(`청첩장 문구 확정하기 ${STATUS_BUTTONS[status][0]}`), undefined);
    assert.match(h.text(), new RegExp(`${STATUS_NAMES[status]} 1개 중 1개`, "u"));
    assert.match(h.text(), new RegExp(`청첩장 문구 확정하기 — ${message}`, "u"));
    refetch.resolve(listResponse([rows[1]], { open_count: status === "open" ? 1 : 0 })); await h.flush();
    assert.deepEqual(h.patches(), [["/api/amora/actions/act1", { status: next }]]);
    assert.match(h.text(), /다음 할 일/u);
  }
});

test("HTTP 200이어도 다른 항목·다른 상태·빈 영수증이면 카드와 오류를 남기고 재조회하지 않는다", async () => {
  for (const payload of [{}, { action: action({ id: "different", status: "done" }) }, { action: action() }, { action: action({ status: "dismissed" }) }]) {
    const h = boardHarness(); h.responses.push(listResponse([action()])); await h.flush();
    h.responses.push({ ok: true, json: async () => payload });
    h.press("청첩장 문구 확정하기 완료로 표시"); await h.flush();
    assert.match(h.text(), /청첩장 문구 확정하기/u);
    assert.match(h.text(), /변경을 저장하지 못했거나 결과를 확인할 수 없어요/u);
    assert.equal(h.calls.length, 2, "an invalid receipt must not trigger a successful refresh");
    assert.doesNotMatch(h.text(), /완료로 표시했어요/u);
    assert.equal(h.button("청첩장 문구 확정하기 완료로 표시").props.disabled, false, "the card stays usable after a failed change");
  }
});

test("상태 변경은 성공하고 재조회만 실패하면 되돌리거나 다시 보내지 않고 다시 불러오기를 준다", async () => {
  const h = boardHarness(); h.responses.push(listResponse([action(), action({ id: "act2", title: "다음 할 일" })])); await h.flush();
  h.responses.push(receipt(action({ status: "done" })), { ...failureResponse, status: 503 });
  h.press("청첩장 문구 확정하기 완료로 표시"); h.press("청첩장 문구 확정하기 완료로 표시"); await h.flush();
  assert.equal(h.button("청첩장 문구 확정하기 완료로 표시"), undefined);
  assert.doesNotMatch(h.text(), /변경을 저장하지 못했거나/u);
  assert.match(h.text(), /다음 할 일/u); assert.match(h.text(), /불러오지 못/u);
  h.responses.push(listResponse([action({ id: "act2", title: "다음 할 일" })])); h.press("다시 불러오기"); await h.flush();
  assert.equal(h.patches().length, 1);
  assert.doesNotMatch(h.text(), /불러오지 못/u);
});

test("새로고침 버튼은 알 수 없는 결과 안내 뒤에도 목록을 다시 읽는다", async () => {
  const h = boardHarness(); h.responses.push(listResponse([action()])); await h.flush();
  h.responses.push(() => { throw new Error("network down"); });
  h.press("청첩장 문구 확정하기 완료로 표시"); await h.flush();
  assert.match(h.text(), /변경을 저장하지 못했거나/u);
  h.responses.push(listResponse([action({ status: "open", title: "다시 읽은 할 일" })]));
  h.press("공유 할 일 새로고침"); await h.flush();
  assert.match(h.text(), /다시 읽은 할 일/u);
  assert.equal(h.patches().length, 1);
});

// ── 계정·커플 경계 ─────────────────────────────────────────────────────

test("조회 중 같은 계정의 커플이 바뀌면 늦은 예전 응답을 표시하지 않는다", async () => {
  const h = boardHarness(); let resolve;
  h.responses.push(() => new Promise(done => { resolve = done; })); await h.flush();
  h.identity.couple_id = "couple-b";
  h.responses.push(listResponse([action({ title: "새 커플의 할 일" })])); h.profileChanged();
  resolve(listResponse([action({ title: "예전 커플의 할 일" })])); await h.flush();
  assert.doesNotMatch(h.text(), /예전 커플/u); assert.match(h.text(), /새 커플/u);
});

test("상태 변경 직전 커플 변경을 발견하면 예전 항목 PATCH를 보내지 않고 보드를 비운다", async () => {
  const h = boardHarness(); h.responses.push(listResponse([action()])); await h.flush();
  h.identity.couple_id = "couple-b"; h.responses.push(listResponse([]));
  h.press("청첩장 문구 확정하기 보류·숨김"); await h.flush();
  assert.equal(h.patches().length, 0);
  assert.doesNotMatch(h.text(), /청첩장 문구 확정하기/u);
});

test("상태 변경 중 계정이 바뀌면 늦은 예전 결과를 새 보드에 덧씌우지 않는다", async () => {
  for (const late of [failureResponse, receipt(action({ status: "done" }))]) {
    const h = boardHarness(); h.responses.push(listResponse([action()])); await h.flush();
    const reply = pendingResponse(); h.responses.push(reply.respond);
    h.press("청첩장 문구 확정하기 완료로 표시"); await h.flush();
    h.identity.userId = "other-viewer"; h.identity.couple_id = "couple-b";
    h.responses.push(listResponse([action({ id: "act_new", title: "새 계정의 할 일" })])); h.authChanged(); await h.flush();
    reply.resolve(late); await h.flush();
    assert.match(h.text(), /새 계정의 할 일/u);
    assert.doesNotMatch(h.text(), /청첩장|변경을 저장하지 못했거나|완료로 표시했어요/u);
    assert.equal(h.calls.length, 3, "the stale receipt must not trigger a refresh for the new account");
  }
});

test("조회나 변경 전 인증 확인 실패를 빈 목록으로 숨기거나 예전 항목 수정으로 잇지 않는다", async () => {
  const initial = boardHarness(); initial.identity.authError = new Error("temporary offline"); await initial.flush();
  assert.match(initial.text(), /불러오지 못/u); assert.equal(initial.calls.length, 0);
  const h = boardHarness(); h.responses.push(listResponse([action()])); await h.flush();
  h.identity.authError = new Error("temporary offline"); h.press("청첩장 문구 확정하기 완료로 표시"); await h.flush();
  assert.match(h.text(), /불러오지 못/u); assert.doesNotMatch(h.text(), /청첩장 문구 확정하기/u);
  assert.equal(h.calls.length, 1);
});

test("요청은 시작 시점 사용자에게 묶인 인증 요청으로만 보낸다", () => {
  // apiFetchForExpectedUser 는 Authorization: Bearer 를 붙이고, 시작 시점 계정과 다르면 보내지 않는다.
  assert.match(boardSource, /import \{ apiFetchForExpectedUser \} from "@\/lib\/api";/u);
  assert.doesNotMatch(boardSource, /\bfetch\(/u);
});

// ── 추가 ────────────────────────────────────────────────────────────────

const COUPLE = "11111111-1111-4111-8111-111111111111";
const FIRST_REQUEST = "0f8fad5b-d9cb-469f-a165-70867728950e";
const SECOND_REQUEST = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const CREATE_UNKNOWN = "저장 결과를 확인하지 못했어요. 같은 요청을 다시 확인하거나 목록을 확인해 주세요. 이미 저장됐을 수 있어요.";
const CANCEL_CONFIRM = "이미 저장된 할 일은 취소해도 삭제되지 않아요. 목록에서 기존 항목을 확인했으며, 다음 작성은 별도의 새 할 일로 시작할까요?";
const UPDATE_ERROR = "변경을 저장하지 못했거나 결과를 확인할 수 없어요. 새로고침으로 확인한 뒤 다시 시도해 주세요.";

async function coupleBoard(rows = []) {
  const h = boardHarness(); h.identity.couple_id = COUPLE;
  h.responses.push(listResponse(rows)); await h.flush();
  return h;
}

const savedManual = (over = {}) => action({ id: "amora_manual_0001", title: "식전 영상 확인", source: "manual", ...over });
const createReceipt = (value, requestId = FIRST_REQUEST, replayed = false) => ({ ok: true, status: 201, json: async () => ({ action: value, requestId, replayed }) });

async function fillCreate(h, { title = "식전 영상 확인", category, description, dueDate } = {}) {
  h.press("공유 할 일 추가"); await h.flush();
  h.input("할 일 제목", title);
  if (category) h.choose(category);
  if (description !== undefined) h.input("설명", description);
  if (dueDate !== undefined) h.input("예정일", dueDate);
  await h.flush();
}

test("추가 창은 제목·분야(나중에 정하기와 21개 분야)·설명·예정일과 웹의 공개 범위 안내를 보여준다", async () => {
  const h = await coupleBoard();
  h.press("공유 할 일 추가"); await h.flush();
  const radios = h.radios();
  assert.deepEqual(radios.map(node => node.props.accessibilityLabel), ["나중에 정하기", ...planning.CATEGORY_CHECKLISTS.map(category => category.label)]);
  assert.equal(planning.CATEGORY_CHECKLISTS.length, 21);
  assert.equal(radios[0].props.accessibilityState.checked, true);
  assert.equal(h.field("할 일 제목").props.maxLength, 120);
  assert.equal(h.field("설명").props.maxLength, 500);
  assert.equal(h.field("예정일").props.maxLength, 40);
  const text = h.text();
  assert.match(text, /날짜나 예정 시기를 40자 이내로 적을 수 있어요\./u);
  assert.match(text, /함께 준비하는 사람에게도 보이는 할 일이에요\. 저장은 두 사람의 합의나 실제 수행 완료를 뜻하지 않아요\./u);
  assert.doesNotMatch(text, /알렸어요|알림을 보냈|알려 드렸|알림이 가요/u);
  // 제목이 비었거나 공백뿐이면 저장할 수 없다.
  assert.equal(h.button("할 일 저장").props.disabled, true);
  h.input("할 일 제목", "   "); await h.flush();
  assert.equal(h.button("할 일 저장").props.disabled, true);
});

test("저장을 빠르게 두 번 눌러도 인증 POST 는 하나이고 몸통은 웹과 같다", async () => {
  const h = await coupleBoard();
  await fillCreate(h, { title: "  식전 영상 확인  ", category: "결혼식장", description: "길이\n확인", dueDate: "다음 주 중" });
  const reply = pendingResponse(); h.responses.push(reply.respond);
  h.press("할 일 저장"); h.press("할 일 저장"); await h.flush();
  assert.equal(h.posts().length, 1);
  const [userId, path, options] = h.posts()[0];
  assert.equal(userId, "viewer"); assert.equal(path, "/api/amora/actions");
  assert.deepEqual(JSON.parse(options.body), {
    title: "식전 영상 확인", category_key: "venue", description: "길이\n확인", due_date: "다음 주 중",
    status: "open", priority: "medium", source: "manual", requestId: FIRST_REQUEST, expectedOwnerId: "viewer", expectedCoupleId: COUPLE,
  });
  assert.deepEqual(Object.keys(JSON.parse(options.body)), ["title", "category_key", "description", "due_date", "status", "priority", "source", "requestId", "expectedOwnerId", "expectedCoupleId"]);
  // 결과를 기다리는 동안 칸을 고칠 수 없다.
  for (const label of ["할 일 제목", "설명", "예정일"]) assert.equal(h.field(label).props.editable, false, label);
  assert.match(h.text(), /추가하는 중…/u);
});

test("결과를 모르면 초안을 잠그고, 다시 확인은 같은 몸통·같은 요청번호를 보내며 replayed:true 도 성공이다", async () => {
  for (const [name, first] of [
    ["network", () => { throw new Error("network down"); }],
    ["5xx", { ok: false, status: 503, json: async () => ({ error: "잠시 후 다시 시도해 주세요." }) }],
    ["receipt mismatch", createReceipt(savedManual({ title: "다른 제목" }))],
  ]) {
    const h = await coupleBoard();
    await fillCreate(h, { description: "첫 줄\n둘째 줄" });
    h.responses.push(first); h.press("할 일 저장"); await h.flush();
    assert.match(h.text(), new RegExp(CREATE_UNKNOWN.replace(/[.]/gu, "\\."), "u"), name);
    assert.equal(h.field("할 일 제목").props.value, "식전 영상 확인", name);
    assert.equal(h.field("할 일 제목").props.editable, false, name);
    assert.equal(h.field("설명").props.editable, false, name);
    assert.equal(h.radios().every(node => node.props.disabled), true, name);
    h.responses.push(createReceipt(savedManual({ description: "첫 줄 둘째 줄" }), FIRST_REQUEST, true), listResponse([savedManual({ description: "첫 줄 둘째 줄" })]));
    h.press("같은 요청 다시 확인"); await h.flush();
    const bodies = h.posts().map(([, , options]) => options.body);
    assert.equal(bodies.length, 2, name);
    assert.equal(bodies[1], bodies[0], `${name}: the retry must resend the identical body`);
    assert.equal(JSON.parse(bodies[1]).requestId, FIRST_REQUEST);
    assert.equal(h.requestIds.length, 2, `${name}: no new request id is minted for the retry`);
    assert.match(h.text(), /공유 할 일을 추가했어요\./u, name);
    assert.throws(() => h.field("할 일 제목"), /missing field/u, `${name}: the sheet closes after the confirmed save`);
    assert.match(h.text(), /첫 줄 둘째 줄/u, name);
  }
});

test("409 AMORA_ACTION_CREATE_CONFLICT 는 서버 문구를 보여주고 초안을 남긴다", async () => {
  const h = await coupleBoard();
  await fillCreate(h);
  h.responses.push({ ok: false, status: 409, json: async () => ({ error: "기존 저장 내용이 달라졌어요. 목록을 확인해 주세요.", code: "AMORA_ACTION_CREATE_CONFLICT" }) });
  h.press("할 일 저장"); await h.flush();
  assert.match(h.text(), /기존 저장 내용이 달라졌어요\. 목록을 확인해 주세요\./u);
  assert.doesNotMatch(h.text(), /저장 결과를 확인하지 못했어요/u);
  assert.equal(h.field("할 일 제목").props.value, "식전 영상 확인");
  assert.doesNotMatch(h.text(), /공유 할 일을 추가했어요/u);
});

test("결과를 모르는 동안 작성 취소는 웹의 확인 문구를 먼저 보여주고, 확인해야만 초안과 요청번호를 버린다", async () => {
  const h = await coupleBoard();
  await fillCreate(h);
  h.responses.push({ ok: false, status: 503, json: async () => ({}) }); h.press("할 일 저장"); await h.flush();
  h.press("작성 취소"); await h.flush();
  assert.match(h.text(), new RegExp(CANCEL_CONFIRM.replace(/[.?]/gu, (c) => `\\${c}`), "u"));
  assert.equal(h.field("할 일 제목").props.value, "식전 영상 확인");
  h.press("같은 요청 유지"); await h.flush();
  assert.doesNotMatch(h.text(), /다음 작성은 별도의 새 할 일로 시작할까요/u);
  assert.equal(h.field("할 일 제목").props.editable, false);
  h.press("작성 취소"); await h.flush();
  h.press("확인했어요 · 새 작성으로 전환"); await h.flush();
  assert.throws(() => h.field("할 일 제목"), /missing field/u);
  h.press("공유 할 일 추가"); await h.flush();
  assert.equal(h.field("할 일 제목").props.value, "");
  h.input("할 일 제목", "새 할 일"); await h.flush();
  h.responses.push(pendingResponse().respond); h.press("할 일 저장"); await h.flush();
  assert.equal(JSON.parse(h.posts()[1][2].body).requestId, SECOND_REQUEST, "a new draft gets a new request id");
});

test("추가 창을 닫아도 결과를 모르는 요청은 남고, 새로고침으로 목록을 확인한 뒤 같은 요청을 다시 확인할 수 있다", async () => {
  const h = await coupleBoard();
  await fillCreate(h);
  h.responses.push({ ok: false, status: 500, json: async () => ({}) }); h.press("할 일 저장"); await h.flush();
  h.press("추가 창 닫기"); await h.flush();
  assert.match(h.text(), /저장 여부는 목록을 새로고쳐 확인해 주세요\./u);
  h.responses.push(listResponse([])); h.press("공유 할 일 새로고침"); await h.flush();
  h.press("공유 할 일 추가"); await h.flush();
  assert.equal(h.field("할 일 제목").props.value, "식전 영상 확인");
  h.responses.push(createReceipt(savedManual()), listResponse([savedManual()]));
  h.press("같은 요청 다시 확인"); await h.flush();
  assert.deepEqual(h.posts().map(([, , options]) => JSON.parse(options.body).requestId), [FIRST_REQUEST, FIRST_REQUEST]);
  assert.match(h.text(), /공유 할 일을 추가했어요\./u);
});

test("확인된 추가 뒤 목록 조회는 한 번이고, 실패하면 다시 불러오기를 주며 POST 는 한 번뿐이다", async () => {
  const h = await coupleBoard();
  await fillCreate(h);
  h.responses.push(createReceipt(savedManual()), { ...failureResponse, status: 503 });
  h.press("할 일 저장"); await h.flush();
  assert.equal(h.gets().length, 2, "initial list + exactly one refresh after the confirmed create");
  assert.match(h.text(), /불러오지 못/u);
  assert.match(h.text(), /공유 할 일을 추가했어요\./u);
  h.responses.push(listResponse([savedManual()])); h.press("다시 불러오기"); await h.flush();
  assert.equal(h.posts().length, 1);
  assert.match(h.text(), /식전 영상 확인/u);
});

test("완료 목록을 보다가 추가하면 진행 중으로 옮겨 그 목록을 한 번 읽는다", async () => {
  const h = await coupleBoard();
  h.responses.push(listResponse([], { open_count: 0 })); h.press("완료 기록 보기"); await h.flush();
  await fillCreate(h);
  h.responses.push(createReceipt(savedManual()), listResponse([savedManual()]));
  h.press("할 일 저장"); await h.flush();
  const gets = h.gets().map(([, path]) => path);
  assert.equal(gets.length, 3);
  assert.match(gets[2], /status=open&limit=80/u);
  assert.equal(h.button("진행 중 기록 보기").props.accessibilityState.selected, true);
  assert.match(h.text(), /식전 영상 확인/u);
});

// ── 수정 ────────────────────────────────────────────────────────────────

const editable = (over = {}) => action({ categoryKey: "venue", description: "위약금 조항 확인", dueDate: "다음 주 중", source: "manual", ...over });

test("수정 창은 카드 값(예정일 원문 포함)으로 채워지고, 바뀐 칸만 보내며 비운 칸은 빈 문자열이다", async () => {
  const h = await coupleBoard([editable()]);
  h.press("청첩장 문구 확정하기 수정"); await h.flush();
  assert.equal(h.field("할 일 제목").props.value, "청첩장 문구 확정하기");
  assert.equal(h.field("설명").props.value, "위약금 조항 확인");
  assert.equal(h.field("예정일").props.value, "다음 주 중");
  assert.equal(h.radios().find(node => node.props.accessibilityLabel === "결혼식장").props.accessibilityState.checked, true);
  assert.match(h.text(), /함께 준비하는 사람에게도 보이는 기록이에요\./u);
  h.input("설명", ""); h.input("예정일", ""); await h.flush();
  h.responses.push(receipt(editable({ description: undefined, dueDate: undefined })));
  h.press("수정 저장"); await h.flush();
  assert.deepEqual(h.patches(), [["/api/amora/actions/act1", { description: "", due_date: "" }]]);
  assert.throws(() => h.field("할 일 제목"), /missing field/u);
  assert.doesNotMatch(h.text(), /위약금 조항 확인|예정일 다음 주 중/u);
  assert.match(h.text(), /수정한 내용을 저장했어요/u);
  h.press("청첩장 문구 확정하기 수정"); await h.flush();
  h.input("할 일 제목", "  청첩장 문구 최종 확정  "); await h.flush();
  h.responses.push(receipt(editable({ title: "청첩장 문구 최종 확정", description: undefined, dueDate: undefined })));
  h.press("수정 저장"); await h.flush();
  assert.deepEqual(h.patches()[1], ["/api/amora/actions/act1", { title: "청첩장 문구 최종 확정" }]);
  assert.match(h.text(), /청첩장 문구 최종 확정/u);
});

test("수정 창에서 제목을 비우면 저장할 수 없다", async () => {
  const h = await coupleBoard([editable()]);
  h.press("청첩장 문구 확정하기 수정"); await h.flush();
  h.input("할 일 제목", "   "); await h.flush();
  assert.equal(h.button("수정 저장").props.disabled, true);
  assert.equal(h.patches().length, 0);
});

test("21개 밖의 분야 키는 '기존 분야 유지'를 고른 채로 열리고, 그대로 두면 분야를 보내지 않는다", async () => {
  const h = await coupleBoard([editable({ categoryKey: "general" })]);
  h.press("청첩장 문구 확정하기 수정"); await h.flush();
  const labels = h.radios().map(node => node.props.accessibilityLabel);
  assert.deepEqual(labels.slice(0, 2), ["분야 미지정", "기존 분야 유지"]);
  assert.equal(h.radios().find(node => node.props.accessibilityLabel === "기존 분야 유지").props.accessibilityState.checked, true);
  h.input("할 일 제목", "사회자 부탁하기"); await h.flush();
  h.responses.push(receipt(editable({ categoryKey: "general", title: "사회자 부탁하기" })));
  h.press("수정 저장"); await h.flush();
  assert.deepEqual(h.patches()[0][1], { title: "사회자 부탁하기" });
  h.press("사회자 부탁하기 수정"); await h.flush();
  h.choose("분야 미지정"); await h.flush();
  h.responses.push(receipt(editable({ categoryKey: undefined, title: "사회자 부탁하기" })));
  h.press("수정 저장"); await h.flush();
  assert.deepEqual(h.patches()[1][1], { category_key: "" });
  // 분야가 정해진 카드에는 "기존 분야 유지"가 없다.
  const known = await coupleBoard([editable()]);
  known.press("청첩장 문구 확정하기 수정"); await known.flush();
  assert.ok(!known.radios().some(node => node.props.accessibilityLabel === "기존 분야 유지"));
});

test("수정 영수증이 바꾼 칸과 다르면 오류를 보이고 초안을 남긴다", async () => {
  for (const saved of [editable({ title: "다른 제목" }), editable({ id: "act_other", title: "새 제목" }), null]) {
    const h = await coupleBoard([editable()]);
    h.press("청첩장 문구 확정하기 수정"); await h.flush();
    h.input("할 일 제목", "새 제목"); await h.flush();
    h.responses.push(saved ? receipt(saved) : { ok: false, status: 500, json: async () => ({}) });
    h.press("수정 저장"); await h.flush();
    assert.match(h.text(), new RegExp(UPDATE_ERROR.replace(/[.]/gu, "\\."), "u"));
    assert.equal(h.field("할 일 제목").props.value, "새 제목");
    assert.equal(h.field("할 일 제목").props.editable, true, "the draft stays editable for another attempt");
    assert.doesNotMatch(h.text(), /수정한 내용을 저장했어요/u);
  }
});

// ── 분야 지정 ────────────────────────────────────────────────────────────

test("'어느 분야에 넣을까요?'는 21개 분야 중 하나를 PATCH {category_key} 로 보내고, 맞는 영수증이면 칩을 보여준다", async () => {
  const h = await coupleBoard([action({ categoryKey: "general" })]);
  assert.match(h.text(), /어느 분야에 넣을까요\?/u);
  h.press("청첩장 문구 확정하기 분야 선택"); await h.flush();
  assert.deepEqual(h.radios().map(node => node.props.accessibilityLabel), planning.CATEGORY_CHECKLISTS.map(category => category.label));
  assert.equal(h.button("청첩장 문구 확정하기 분야 저장").props.disabled, true);
  h.choose("종이·모바일 초대장"); await h.flush();
  h.responses.push(receipt(action({ categoryKey: "invitation" })));
  h.press("청첩장 문구 확정하기 분야 저장"); await h.flush();
  assert.deepEqual(h.patches(), [["/api/amora/actions/act1", { category_key: "invitation" }]]);
  assert.ok(h.button("종이·모바일 초대장 체크리스트 보기"));
  assert.doesNotMatch(h.text(), /분야 확인 필요|어느 분야에 넣을까요/u);
});

test("분야 영수증이 다르면 분야 확인 필요로 남기고 오류를 보인다", async () => {
  const h = await coupleBoard([action()]);
  h.press("청첩장 문구 확정하기 분야 선택"); await h.flush();
  h.choose("결혼식장"); await h.flush();
  h.responses.push(receipt(action({ categoryKey: "dress" })));
  h.press("청첩장 문구 확정하기 분야 저장"); await h.flush();
  assert.match(h.text(), /분야 확인 필요/u);
  assert.match(h.text(), new RegExp(UPDATE_ERROR.replace(/[.]/gu, "\\."), "u"));
});

// ── 한 번에 하나 ────────────────────────────────────────────────────────

test("추가·수정·분야·상태 중 하나가 진행 중이면 다른 변경 버튼과 상태 전환·새로고침을 막는다", async () => {
  const controls = (h) => [
    h.button("다음 할 일 완료로 표시"), h.button("다음 할 일 보류·숨김"), h.button("다음 할 일 수정"),
    h.button("다음 할 일 분야 선택"), h.button("공유 할 일 추가"), h.button("공유 할 일 새로고침"),
    ...["진행 중", "완료", "보류·숨김"].map(name => h.button(`${name} 기록 보기`)),
  ];
  const rows = () => [editable(), action({ id: "act2", title: "다음 할 일" })];
  const starts = {
    create: async (h) => { await fillCreate(h); h.press("할 일 저장"); },
    edit: async (h) => { h.press("청첩장 문구 확정하기 수정"); await h.flush(); h.input("할 일 제목", "바꾼 제목"); await h.flush(); h.press("수정 저장"); },
    category: async (h) => { h.press("다음 할 일 분야 선택"); await h.flush(); h.choose("결혼식장"); await h.flush(); h.press("다음 할 일 분야 저장"); },
    status: async (h) => { h.press("청첩장 문구 확정하기 보류·숨김"); },
  };
  for (const [name, start] of Object.entries(starts)) {
    const h = await coupleBoard(rows());
    h.responses.push(pendingResponse().respond);
    await start(h); await h.flush();
    for (const control of controls(h)) {
      if (!control) continue;
      assert.equal(control.props.disabled, true, `${name}: ${control.props.accessibilityLabel}`);
    }
    assert.equal(h.calls.filter(([, , options]) => options.method !== "GET").length, 1, name);
  }
});

// ── 계정·커플 경계(추가·수정) ────────────────────────────────────────────

test("추가 직전 계정이 바뀌면 예전 계정으로 POST 하지 않고 창·초안을 비운다", async () => {
  const h = await coupleBoard();
  await fillCreate(h);
  h.identity.userId = "other-viewer"; h.responses.push(listResponse([action({ title: "새 계정의 할 일" })]));
  h.press("할 일 저장"); await h.flush();
  assert.equal(h.posts().length, 0);
  assert.throws(() => h.field("할 일 제목"), /missing field/u);
  assert.match(h.text(), /새 계정의 할 일/u);
  h.press("공유 할 일 추가"); await h.flush();
  assert.equal(h.field("할 일 제목").props.value, "", "the previous account's draft must not survive");
});

test("추가 중 커플이 바뀌면 늦은 영수증을 새 보드에 반영하지 않고 새 커플 목록을 다시 읽지 않는다", async () => {
  const h = await coupleBoard();
  await fillCreate(h);
  const reply = pendingResponse(); h.responses.push(reply.respond);
  h.press("할 일 저장"); await h.flush();
  h.identity.couple_id = "22222222-2222-4222-8222-222222222222";
  h.responses.push(listResponse([action({ id: "act_b", title: "새 커플의 할 일" })])); h.profileChanged(); await h.flush();
  reply.resolve(createReceipt(savedManual())); await h.flush();
  assert.match(h.text(), /새 커플의 할 일/u);
  assert.doesNotMatch(h.text(), /공유 할 일을 추가했어요|저장 결과를 확인하지 못했어요|식전 영상 확인/u);
  assert.equal(h.gets().length, 2, "no refresh is sent on behalf of the old couple");
  h.press("공유 할 일 추가"); await h.flush();
  assert.equal(h.field("할 일 제목").props.value, "");
});

test("수정 중 계정이 바뀌면 늦은 영수증이나 오류를 새 보드에 덧씌우지 않는다", async () => {
  for (const late of [receipt(editable({ title: "바꾼 제목" })), failureResponse]) {
    const h = await coupleBoard([editable()]);
    h.press("청첩장 문구 확정하기 수정"); await h.flush();
    h.input("할 일 제목", "바꾼 제목"); await h.flush();
    const reply = pendingResponse(); h.responses.push(reply.respond);
    h.press("수정 저장"); await h.flush();
    h.identity.userId = "other-viewer";
    h.responses.push(listResponse([action({ id: "act_new", title: "새 계정의 할 일" })])); h.authChanged(); await h.flush();
    reply.resolve(late); await h.flush();
    assert.match(h.text(), /새 계정의 할 일/u);
    assert.doesNotMatch(h.text(), /바꾼 제목|청첩장|변경을 저장하지 못했거나/u);
    assert.throws(() => h.field("할 일 제목"), /missing field/u);
  }
});

// ── 누르는 자리 ─────────────────────────────────────────────────────────

test("보드·카드·추가 창·수정 창의 누르는 자리는 모두 44pt 이상이다", async () => {
  const flatten = (style) => {
    const resolved = typeof style === "function" ? style({ pressed: false }) : style;
    return Array.isArray(resolved) ? Object.assign({}, ...resolved.map(flatten)) : resolved && typeof resolved === "object" ? resolved : {};
  };
  const check = (h, where) => {
    const pressables = h.pressables();
    assert.ok(pressables.length > 0, where);
    for (const node of pressables) {
      const style = flatten(node.props.style);
      assert.ok(style.minHeight >= 44, `${where}: ${node.props.accessibilityLabel} minHeight ${style.minHeight}`);
    }
  };
  const h = await coupleBoard([editable(), action({ id: "act2", title: "분야 없는 할 일" })]);
  h.press("분야 없는 할 일 분야 선택"); await h.flush();
  check(h, "board");
  h.press("공유 할 일 추가"); await h.flush();
  check(h, "create sheet");
  h.press("추가 창 닫기"); await h.flush();
  h.press("청첩장 문구 확정하기 수정"); await h.flush();
  check(h, "edit sheet");
  for (const status of ["done", "dismissed"]) check(await boardAt(status, [action({ status })]), status);
});

test("같은 순간 두 카드의 상태 버튼을 눌러도 먼저 누른 변경 하나만 보낸다", async () => {
  const h = await coupleBoard([action(), action({ id: "act2", title: "다음 할 일" })]);
  h.responses.push(pendingResponse().respond);
  h.press("청첩장 문구 확정하기 완료로 표시"); h.press("다음 할 일 보류·숨김"); await h.flush();
  assert.deepEqual(h.patches(), [["/api/amora/actions/act1", { status: "done" }]]);
});

test("추가 결과를 받은 뒤 계정 확인이 실패하면 초안을 잠근 채 남기고, 같은 계정으로 다시 읽으면 같은 요청으로 이어서 확인한다", async () => {
  const h = await coupleBoard();
  await fillCreate(h);
  const reply = pendingResponse(); h.responses.push(reply.respond);
  h.press("할 일 저장"); await h.flush();
  h.identity.authError = new Error("temporary offline");
  reply.resolve(createReceipt(savedManual())); await h.flush();
  assert.match(h.text(), /불러오지 못/u);
  assert.match(h.text(), /저장 결과를 확인하지 못했어요/u);
  assert.equal(h.field("할 일 제목").props.value, "식전 영상 확인");
  assert.equal(h.field("할 일 제목").props.editable, false);
  h.identity.authError = null;
  h.press("추가 창 닫기"); await h.flush();
  h.responses.push(listResponse([])); h.press("다시 불러오기"); await h.flush();
  h.press("공유 할 일 추가"); await h.flush();
  assert.equal(h.field("할 일 제목").props.value, "식전 영상 확인", "the same account keeps the unknown-outcome draft");
  h.responses.push(createReceipt(savedManual(), FIRST_REQUEST, true), listResponse([savedManual()]));
  h.press("같은 요청 다시 확인"); await h.flush();
  assert.deepEqual(h.posts().map(([, , options]) => JSON.parse(options.body).requestId), [FIRST_REQUEST, FIRST_REQUEST]);
  assert.match(h.text(), /공유 할 일을 추가했어요\./u);
});
