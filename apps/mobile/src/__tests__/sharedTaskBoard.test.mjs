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
    "react-native": { Pressable: "Pressable", Text: "Text", View: "View", StyleSheet: { create: value => value } },
    "@/components/ui/AppText": { Text: "Text" },
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
    identity, responses, calls, navigation,
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
