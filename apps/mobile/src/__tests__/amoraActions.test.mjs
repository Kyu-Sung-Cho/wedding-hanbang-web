import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { setImmediate } from "node:timers";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";
import * as actionModel from "../lib/amoraActions.mjs";

import {
  AMORA_ACTION_VISIBLE_LIMIT,
  buildCompleteActionBody,
  formatAmoraActionDueDate,
  parseAmoraActions,
  selectOpenAmoraActions,
} from "../lib/amoraActions.mjs";

const card = readFileSync(
  fileURLToPath(new URL("../components/lounge/AmoraActionsCard.tsx", import.meta.url)),
  "utf8",
);
const lounge = readFileSync(
  fileURLToPath(new URL("../../app/(tabs)/lounge.tsx", import.meta.url)),
  "utf8",
);
const experience = readFileSync(
  fileURLToPath(new URL("../components/dashboard/WeddingHomeExperience.tsx", import.meta.url)),
  "utf8",
);

const action = (over = {}) => ({
  id: "a1", title: "청첩장 문구 확정하기", status: "open", priority: "medium", dueDate: "", ...over,
});

test("서버 응답에서 그릴 수 있는 줄만 남긴다", () => {
  const parsed = parseAmoraActions({
    actions: [
      { id: "a1", title: "청첩장 문구 확정", status: "open", priority: "high", dueDate: "2026-10-01" },
      { id: "a2", title: "   ", status: "open" },
      { id: "", title: "제목은 있는데 id 가 없음", status: "open" },
      { title: "id 자체가 없음", status: "open" },
      null,
      "문자열",
    ],
  });
  // 제목이나 id 가 없으면 버린다 — 무엇을 완료하는지 모르는 줄에 완료 버튼을 주면
  // 확인하지 않은 변경이 된다.
  assert.equal(parsed.length, 1);
  assert.deepEqual(parsed[0], {
    id: "a1", title: "청첩장 문구 확정", status: "open", priority: "high", dueDate: "2026-10-01",
  });
});

test("응답이 이상해도 던지지 않는다", () => {
  for (const payload of [null, undefined, {}, { actions: null }, { actions: "x" }, []]) {
    assert.deepEqual(parseAmoraActions(payload), []);
  }
});

test("날짜 모양이 아닌 값은 날짜인 척하지 않는다", () => {
  const [row] = parseAmoraActions({
    actions: [{ id: "a1", title: "제목", status: "open", dueDate: "다음 주쯤" }],
  });
  assert.equal(row.dueDate, "");
  assert.equal(formatAmoraActionDueDate("다음 주쯤"), "");
  assert.equal(formatAmoraActionDueDate(undefined), "");
});

test("마감일은 사람이 읽는 말로 나온다", () => {
  assert.equal(formatAmoraActionDueDate("2026-10-01"), "2026년 10월 1일까지");
  // 한 자리 월·일에 0 을 붙이지 않는다.
  assert.equal(formatAmoraActionDueDate("2026-01-05"), "2026년 1월 5일까지");
});

test("끝난 것과 지운 것은 보여주지 않는다", () => {
  const picked = selectOpenAmoraActions([
    action({ id: "a1" }),
    action({ id: "a2", status: "done" }),
    action({ id: "a3", status: "dismissed" }),
  ]);
  assert.deepEqual(picked.visible.map((a) => a.id), ["a1"]);
  assert.equal(picked.openCount, 1);
});

test("마감일이 있는 것을 먼저, 이른 날짜부터 보여준다", () => {
  const picked = selectOpenAmoraActions([
    action({ id: "없음1" }),
    action({ id: "늦은", dueDate: "2026-12-01" }),
    action({ id: "이른", dueDate: "2026-09-01" }),
    action({ id: "없음2" }),
  ]);
  assert.deepEqual(picked.visible.map((a) => a.id), ["이른", "늦은", "없음1"]);
  // 날짜가 없는 것끼리는 서버가 준 순서를 지킨다.
  const noDates = selectOpenAmoraActions([action({ id: "b" }), action({ id: "a" })]);
  assert.deepEqual(noDates.visible.map((a) => a.id), ["b", "a"]);
});

test("넘치는 개수를 숨기지 않고 세어 준다", () => {
  const many = Array.from({ length: 7 }, (_, i) => action({ id: `a${i}` }));
  const picked = selectOpenAmoraActions(many);
  assert.equal(picked.visible.length, AMORA_ACTION_VISIBLE_LIMIT);
  assert.equal(picked.openCount, 7);
  assert.equal(picked.hiddenCount, 7 - AMORA_ACTION_VISIBLE_LIMIT);
});

test("완료 요청은 상태만 바꾼다", () => {
  // 제목·마감일을 함께 보내면 앱이 서버 문구를 덮어쓸 수 있다.
  assert.deepEqual(buildCompleteActionBody(), { status: "done" });
});

// 화면이 이 로직을 실제로 부르지 않으면 위 검사는 아무것도 지키지 않는다.
test("카드가 라운지에 실제로 걸려 있다", () => {
  assert.match(lounge, /import AmoraActionsCard from "@\/components\/lounge\/AmoraActionsCard";/u);
  assert.match(lounge, /amoraActions=\{<AmoraActionsCard refreshVersion=\{careRefreshVersion\} \/>\}/u);
  assert.match(experience, /amoraActions\?: ReactNode;/u);
  assert.match(experience, /\{amoraActions \? \(/u);
});

test("요청을 시작 시점 사용자에게 묶는다", () => {
  // 계정을 바꾼 뒤 늦게 도착한 응답이 다른 사람의 할 일을 그리면 안 된다.
  assert.match(card, /apiFetchForExpectedUser\(/u);
  assert.doesNotMatch(card, /(?<!apiFetchForExpectedUser\([^)]{0,200})\bfetch\(\s*["'`]http/u);
});

test("콜드 스타트에서 목록이 뜨도록 authGeneration 을 올린다", () => {
  // 이 줄이 없으면 구독 직후 첫 이벤트가 최초 적재를 끊고 끝난다 —
  // 앱을 켜고 라운지에 머무는 사람은 목록을 한 번도 못 본다(PR #163 에서 겪음).
  assert.match(card, /onAuthStateChange/u);
  assert.match(card, /setAuthGeneration\(\(generation\) => generation \+ 1\);/u);
  assert.match(card, /\[authGeneration, load, refreshVersion\]/u);
});

test("완료 성공은 요청한 항목의 서버 영수증으로 확인한다", () => {
  assert.match(card, /payload\.action\.id !== action\.id/u);
  assert.match(card, /payload\.action\.status !== "done"/u);
});

function cardHarness(props = {}) {
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
  const jsx = (type, props) => ({ type, props });
  const token = new Proxy(() => 1, { get: () => token });
  const supabase = {
    auth: {
      getUser: async () => ({ data: { user: identity.userId ? { id: identity.userId } : null }, error: identity.authError ?? null }),
      onAuthStateChange(callback) { authListener = callback; return { data: { subscription: { unsubscribe() {} } } }; },
    },
    from(table) {
      assert.equal(table, "profiles");
      const query = { select() { return query; }, eq() { return query; },
        single: async () => ({ data: { ...identity }, error: null }) };
      return query;
    },
    channel() {
      const channel = { on(_event, _filter, callback) { listeners.add(callback); channel.callback = callback; return channel; }, subscribe() { return channel; } };
      return channel;
    },
    removeChannel(channel) { listeners.delete(channel.callback); },
  };
  const modules = {
    react: hooks,
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-native": { Pressable: "Pressable", Text: "Text", View: "View", StyleSheet: { create: value => value } },
    "expo-router": { useFocusEffect: callback => hooks.useEffect(callback, [callback]), router: { push: route => navigation.push(route) } },
    "lucide-react-native": { Check: "Check", ListChecks: "ListChecks" },
    "@hanbang/design-tokens": { colors: token, spacing: token, radius: token },
    "@/components/ui/AppUI": { appShadow: {} },
    "@/lib/amoraActions.mjs": actionModel,
    "@/lib/supabase": { supabase },
    "@/lib/api": { apiFetchForExpectedUser: async (...args) => {
      calls.push(args);
      const response = responses.shift();
      assert.ok(response, `unexpected request ${args[1]}`);
      return typeof response === "function" ? response(...args) : response;
    } },
  };
  const code = ts.transpileModule(card, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const module = { exports: {} };
  new Function("exports", "module", "require", code)(module.exports, module, name => {
    assert.ok(modules[name], `unmocked dependency ${name}`); return modules[name];
  });
  const nodes = value => !value ? [] : Array.isArray(value) ? value.flatMap(nodes)
    : typeof value === "object" ? [value, ...nodes(value.props?.children)] : [];
  const text = value => value == null || typeof value === "boolean" ? "" : Array.isArray(value) ? value.map(text).join("")
    : typeof value === "object" ? text(value.props?.children) : String(value);
  const harness = {
    identity, responses, calls, navigation,
    async flush() {
      for (let turn = 0; turn < 12; turn++) {
        if (dirty) { dirty = false; index = 0; tree = module.exports.default(props); while (effects.length) effects.shift()(); }
        await new Promise(resolve => setImmediate(resolve));
      }
    },
    text: () => text(tree),
    press(label) {
      const button = nodes(tree).find(node => node.type === "Pressable" && (node.props.accessibilityLabel === label || text(node) === label));
      assert.ok(button, `missing button ${label}; rendered: ${text(tree)}`);
      assert.ok(!button.props.disabled, `button is disabled: ${label}`);
      return button.props.onPress();
    },
    profileChanged() { for (const listener of [...listeners]) listener({ new: { ...identity } }); },
    authChanged() { authListener("SIGNED_IN", { user: { id: identity.userId } }); },
  };
  return harness;
}

const listResponse = (actions, extra = {}) => ({ ok: true, json: async () => ({ actions, count: actions.length, open_count: actions.length, truncated: false, ...extra }) });
const failureResponse = { ok: false, status: 403, json: async () => ({ error: "권한이 변경됐어요." }) };

test("실제 카드는 조회 오류와 빈 목록을 구분하고 버튼으로 다시 불러온다", async () => {
  const h = cardHarness(); h.responses.push(failureResponse); await h.flush();
  assert.match(h.text(), /불러오지 못/u);
  h.responses.push(listResponse([action()])); h.press("다시 불러오기"); await h.flush();
  assert.match(h.text(), /청첩장 문구 확정하기/u); assert.doesNotMatch(h.text(), /불러오지 못/u);
});

test("실제 완료 실패는 원래 줄과 오류를 남기고 재시도 성공 후에만 반영한다", async () => {
  const h = cardHarness(); h.responses.push(listResponse([action()])); await h.flush();
  h.responses.push(failureResponse); h.press("청첩장 문구 확정하기 완료로 표시"); await h.flush();
  assert.match(h.text(), /청첩장 문구 확정하기/u); assert.match(h.text(), /완료 여부를 확인하지 못/u);
  h.responses.push({ ok: true, json: async () => ({ action: action({ status: "done" }) }) }, listResponse([]));
  h.press("완료 다시 시도"); await h.flush();
  assert.doesNotMatch(h.text(), /청첩장 문구 확정하기/u);
  assert.deepEqual(h.calls.filter(([, , options]) => options.method === "PATCH").map(([, , options]) => JSON.parse(options.body)), [{ status: "done" }, { status: "done" }]);
});

test("실제 카드의 더 있는 개수는 제한된 배열이 아니라 서버 전체 미완료 수를 쓴다", async () => {
  const h = cardHarness(); h.responses.push(listResponse(Array.from({ length: 20 }, (_, i) => action({ id: `a${i}` })), { count: 37, open_count: 37, truncated: true }));
  await h.flush(); assert.match(h.text(), /37개 중 3개/u); assert.match(h.text(), /34개가 더/u);
});

test("실제 카드의 잘못된 응답은 저장된 할 일이 없는 것처럼 숨겨지지 않는다", async () => {
  const h = cardHarness(); h.responses.push({ ok: true, json: async () => ({ error: "invalid payload" }) });
  await h.flush(); assert.match(h.text(), /불러오지 못/u);
});

test("조회 중 같은 계정의 커플이 바뀌면 늦은 예전 응답을 표시하지 않는다", async () => {
  const h = cardHarness(); let resolve;
  h.responses.push(() => new Promise(done => { resolve = done; })); await h.flush();
  h.identity.couple_id = "couple-b";
  h.responses.push(listResponse([action({ title: "새 커플의 할 일" })])); h.profileChanged();
  resolve(listResponse([action({ title: "예전 커플의 할 일" })])); await h.flush();
  assert.doesNotMatch(h.text(), /예전 커플/u); assert.match(h.text(), /새 커플/u);
});

test("완료 직전 커플 변경을 발견하면 예전 항목 PATCH를 보내지 않는다", async () => {
  const h = cardHarness(); h.responses.push(listResponse([action()])); await h.flush();
  h.identity.couple_id = "couple-b"; h.responses.push(listResponse([]));
  h.press("청첩장 문구 확정하기 완료로 표시"); await h.flush();
  assert.equal(h.calls.filter(([, , options]) => options.method === "PATCH").length, 0);
  assert.doesNotMatch(h.text(), /청첩장 문구 확정하기/u);
});

test("계정 전환 후 예전 완료 실패는 새 목록에 오류나 행을 덧씌우지 않는다", async () => {
  const h = cardHarness(); h.responses.push(listResponse([action()])); await h.flush();
  let resolve; h.responses.push(() => new Promise(done => { resolve = done; }));
  h.press("청첩장 문구 확정하기 완료로 표시"); await h.flush();
  h.identity.userId = "other-viewer"; h.identity.couple_id = "couple-b";
  h.responses.push(listResponse([action({ title: "새 계정의 할 일" })])); h.authChanged(); await h.flush();
  resolve(failureResponse); await h.flush();
  assert.match(h.text(), /새 계정의 할 일/u); assert.doesNotMatch(h.text(), /청첩장|완료 여부를 확인하지 못/u);
});

test("HTTP 200이어도 다른 항목이나 미완료 영수증이면 기존 줄과 재시도를 남긴다", async () => {
  for (const payload of [{}, { action: action({ id: "different", status: "done" }) }, { action: action() }]) {
    const h = cardHarness(); h.responses.push(listResponse([action()])); await h.flush();
    h.responses.push({ ok: true, json: async () => payload });
    h.press("청첩장 문구 확정하기 완료로 표시"); await h.flush();
    assert.match(h.text(), /청첩장 문구 확정하기/u); assert.match(h.text(), /완료 여부를 확인하지 못/u);
    assert.equal(h.calls.length, 2, "an invalid receipt must not trigger a successful refresh");
  }
});

test("완료는 성공하고 재조회만 실패하면 완료를 되돌리거나 다시 보내지 않는다", async () => {
  const h = cardHarness(); h.responses.push(listResponse([action(), action({ id: "a2", title: "다음 할 일" })])); await h.flush();
  h.responses.push({ ok: true, json: async () => ({ action: action({ status: "done" }) }) }, { ...failureResponse, status: 503 });
  h.press("청첩장 문구 확정하기 완료로 표시"); h.press("청첩장 문구 확정하기 완료로 표시"); await h.flush();
  assert.doesNotMatch(h.text(), /청첩장 문구 확정하기|완료 여부를 확인하지 못/u);
  assert.match(h.text(), /다음 할 일/u); assert.match(h.text(), /불러오지 못/u);
  h.responses.push(listResponse([action({ id: "a2", title: "다음 할 일" })])); h.press("다시 불러오기"); await h.flush();
  assert.equal(h.calls.filter(([, , options]) => options.method === "PATCH").length, 1);
});

test("조회나 완료 전 인증 확인 실패를 빈 목록으로 숨기거나 예전 항목 수정으로 잇지 않는다", async () => {
  const initial = cardHarness(); initial.identity.authError = new Error("temporary offline"); await initial.flush();
  assert.match(initial.text(), /불러오지 못/u); assert.equal(initial.calls.length, 0);
  const h = cardHarness(); h.responses.push(listResponse([action()])); await h.flush();
  h.identity.authError = new Error("temporary offline"); h.press("청첩장 문구 확정하기 완료로 표시"); await h.flush();
  assert.match(h.text(), /불러오지 못/u); assert.doesNotMatch(h.text(), /청첩장 문구 확정하기/u);
  assert.equal(h.calls.length, 1);
});

test("진행 중 항목이 없어도 준비 기록으로 들어가 완료 기록을 다시 볼 수 있다", async () => {
  const h = cardHarness(); h.responses.push(listResponse([])); await h.flush();
  h.press("준비 기록 보기"); assert.deepEqual(h.navigation, ["/amora-preparation"]);
  const board = cardHarness({ presentation: "board" }); board.responses.push(listResponse([])); await board.flush();
  board.responses.push(listResponse([action({ status: "done", title: "완료한 기록" })], { open_count: 0 }));
  board.press("완료 기록 보기"); await board.flush();
  assert.match(board.text(), /완료한 기록/u); assert.match(board.calls.at(-1)[1], /status=done&limit=80/u);
  assert.doesNotMatch(board.text(), /진행 중 기록이 아직 없어요/u);
});

test("준비 기록은 다음 페이지를 읽고 같은 ID를 중복 표시하지 않는다", async () => {
  const h = cardHarness({ presentation: "board" });
  const rows = Array.from({ length: 80 }, (_, index) => action({ id: `a${index}`, title: `할 일 ${index}` }));
  h.responses.push(listResponse(rows, { count: 81, open_count: 81, truncated: true, next_cursor: "cursor /+" })); await h.flush();
  assert.match(h.text(), /81개 중 80개/u); assert.match(h.text(), /할 일 79/u);
  h.responses.push(listResponse([rows[79], action({ id: "a80", title: "마지막 할 일" })], { count: 81, open_count: 81, truncated: true, next_cursor: null }));
  h.press("기록 더 보기"); h.press("기록 더 보기"); await h.flush();
  assert.equal(h.calls.length, 2); assert.match(h.calls[1][1], /cursor=cursor%20%2F%2B/u);
  assert.match(h.text(), /81개 중 81개/u); assert.match(h.text(), /마지막 할 일/u);
  assert.equal(h.text().split("할 일 79").length - 1, 1);
  assert.doesNotMatch(h.text(), /추가 기록을 이어서 읽을 수 없어요|일부 목록/u);
});

test("더 읽기 실패는 현재 기록을 보존하고 재조회 후 다시 이어갈 수 있다", async () => {
  const h = cardHarness({ presentation: "board" });
  const first = () => listResponse([action()], { count: 2, open_count: 2, truncated: true, next_cursor: "page2" });
  h.responses.push(first()); await h.flush(); h.responses.push({ ...failureResponse, status: 503 });
  h.press("기록 더 보기"); await h.flush(); assert.match(h.text(), /청첩장 문구 확정하기/u); assert.match(h.text(), /불러오지 못/u);
  h.responses.push(first()); h.press("다시 불러오기"); await h.flush();
  h.responses.push(listResponse([action({ id: "a2", title: "이어 읽은 기록" })], { count: 2, open_count: 2, next_cursor: null }));
  h.press("기록 더 보기"); await h.flush(); assert.match(h.text(), /2개 중 2개/u); assert.match(h.text(), /이어 읽은 기록/u);
});

test("더 읽는 동안 상태를 바꾸면 예전 진행 중 응답이 완료 목록에 합쳐지지 않는다", async () => {
  const h = cardHarness({ presentation: "board" });
  h.responses.push(listResponse([action()], { count: 2, open_count: 2, truncated: true, next_cursor: "page2" })); await h.flush();
  let resolve; h.responses.push(() => new Promise(done => { resolve = done; })); h.press("기록 더 보기"); await h.flush();
  h.responses.push(listResponse([action({ status: "done", title: "완료한 기록" })], { open_count: 2 })); h.press("완료 기록 보기"); await h.flush();
  resolve(listResponse([action({ id: "a2", title: "예전 페이지" })], { count: 2, open_count: 2, next_cursor: null })); await h.flush();
  assert.match(h.text(), /완료한 기록/u); assert.doesNotMatch(h.text(), /예전 페이지|청첩장 문구 확정하기/u);
});

test("커플 변경 뒤 예전 페이지를 새 준비 기록에 추가하지 않는다", async () => {
  const h = cardHarness({ presentation: "board" });
  h.responses.push(listResponse([action()], { count: 2, open_count: 2, truncated: true, next_cursor: "page2" })); await h.flush();
  let resolve; h.responses.push(() => new Promise(done => { resolve = done; })); h.press("기록 더 보기"); await h.flush();
  h.identity.couple_id = "new-couple"; h.responses.push(listResponse([action({ title: "새 기록" })])); h.profileChanged(); await h.flush();
  resolve(listResponse([action({ id: "old-page", title: "예전 페이지" })], { count: 2, open_count: 2, next_cursor: null })); await h.flush();
  assert.match(h.text(), /새 기록/u); assert.doesNotMatch(h.text(), /예전 페이지|청첩장/u);
});

test("이전 서버가 다음 커서를 주지 않으면 전체 기록을 다 읽은 척하지 않는다", async () => {
  const h = cardHarness({ presentation: "board" }); h.responses.push(listResponse([action()], { count: 90, open_count: 90, truncated: true }));
  await h.flush(); assert.match(h.text(), /90개 중 1개/u); assert.match(h.text(), /추가 기록을 이어서 읽을 수 없어요/u);
});

test("준비 기록 보조 화면은 기존 4개 탭을 바꾸지 않고 실행 화면으로 연결한다", () => {
  const route = readFileSync(new URL("../../app/amora-preparation.tsx", import.meta.url), "utf8");
  assert.match(route, /<AmoraActionsCard presentation="board"/u);
  for (const path of ["/budget", "/schedule", "/checklist", "/(tabs)/chat"]) assert.ok(route.includes(`router.push("${path}")`), path);
  assert.match(route, /router\.canGoBack\(\) \? router\.back\(\) : router\.replace\("\/\(tabs\)\/lounge"\)/u);
  const tabs = readFileSync(new URL("../../app/(tabs)/_layout.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(tabs, /amora-preparation/u);
});
