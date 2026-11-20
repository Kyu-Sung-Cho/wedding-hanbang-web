// 직접 보내기(D-83 1단계, 2026-11-18) — 앱 쪽.
//
// 아모라가 쓴 편지를 두 분 폰에서 보내고(복사·공유·문자), 업체에게 받은 답은 붙여 넣으면 이 기기에서만 읽는다.
// 서버 스위치(HALL_INQUIRY_SELF_SEND_ENABLED)가 꺼져 있으면 서버는 새 칸(`selfSend`, `replyPaste`)을 주지 않고
// 앱은 오늘과 똑같이 그린다. 지키는 것:
//   - 경계: 새 칸은 있을 때만 모양을 보고 없으면 꺼진 것으로 읽는다. global_daily_cap 이 편지를 막지 않는다.
//   - 붙여 넣은 답으로 일정에 넣을 때 기기 밖으로 나가는 것은 홀 ID·날짜·시간뿐이다. 짐작한 오전·오후는 묻는다.
//   - 보낼 글의 단추는 복사·공유·문자 가운데 하나만 부르고, 서버 글을 고치지 않고 넘긴다.
//   - 편지 시트의 "이 편지로 할게요"는 저장만 하고 승인하지 않는다.
//   - 스위치가 꺼진 응답에서 편지 시트와 상담 화면이 받는 것은 1단계 전과 같다(더 부르는 요청도 없다).
// 렌더러 없이 지킨다: 화면 파일을 CommonJS 로 옮겨 가짜 모듈·작은 훅 흉내와 함께 돌리고, 나머지는 소스를 읽는다.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { setImmediate } from "node:timers";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

import * as invitationApi from "../lib/invitationApi.mjs";
import * as invitationRoutes from "../lib/invitationRoutes.mjs";
import * as readGate from "../lib/readGate.mjs";

const {
  createInvitationApi,
  isLetterDirty,
  kstTodayYmd,
  letterApprovalNotice,
  letterSaveBody,
  letterSelfSendView,
  letterShareFlags,
  letterStateNotice,
  pastedScheduleBody,
  sameVisibleLetter,
  scheduleTimeParts,
  withMeridiem,
} = invitationApi;

const mobileRoot = fileURLToPath(new URL("../../", import.meta.url));
const read = (relative) => readFileSync(join(mobileRoot, relative), "utf8");
const RACE = { timeout: 10_000 };

/** 기다리는 약속을 여러 번 흘려보낸다(답을 정한 뒤 화면 콜백이 끝까지 돌게). */
async function flush() {
  for (let round = 0; round < 6; round += 1) await new Promise((done) => setImmediate(done));
}

/** 주석을 걷어낸 소스. 왜 그렇게 했는지 적은 주석이 검사에 걸리지 않게 한다. */
function code(relative) {
  return ts.transpileModule(read(relative), {
    fileName: "screen.tsx",
    compilerOptions: { jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ES2022, removeComments: true },
  }).outputText;
}

// ── 화면 파일을 가짜 모듈과 함께 돌리기 ────────────────────────────────────

/** TS·TSX 파일을 CommonJS 로 옮겨 `mocks` 와 함께 돌린다. 가짜가 없는 상대 경로는 같은 방법으로 따라 읽는다. */
function loadTs(absolute, mocks, cache = new Map()) {
  if (cache.has(absolute)) return cache.get(absolute).exports;
  const output = ts.transpileModule(readFileSync(absolute, "utf8"), {
    fileName: absolute,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  cache.set(absolute, module);
  const requireFrom = (specifier) => {
    if (Object.hasOwn(mocks, specifier)) return mocks[specifier];
    if (specifier.startsWith(".")) {
      const base = resolve(dirname(absolute), specifier);
      const found = [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")].find((candidate) => existsSync(candidate));
      assert.ok(found, `${absolute} 에서 ${specifier} 를 찾지 못했다`);
      return loadTs(found, mocks, cache);
    }
    throw new Error(`가짜를 두지 않은 모듈: ${specifier} (${absolute})`);
  };
  new Function("exports", "module", "require", output)(module.exports, module, requireFrom);
  return module.exports;
}

const sharedCache = new Map();
const sharedFile = (name) => join(mobileRoot, "../../packages/shared/src/invitation", name);
/** 공유 문구와 업체 답 읽기는 진짜를 쓴다(화면이 그리는 문장이 공유 모듈의 문장 그대로인지 본다). */
const SHARED = {
  ...loadTs(sharedFile("copy.ts"), {}, sharedCache),
  ...loadTs(sharedFile("copyStates.ts"), {}, sharedCache),
  ...loadTs(sharedFile("vendorReply.ts"), {}, sharedCache),
};
const { CONSULTATION_STATE_COPY, LETTER_COPY, LETTER_STATE_COPY, SELF_SEND_COPY, VENDOR_REPLY_COPY } = SHARED;

const Fragment = Symbol.for("test.fragment");
const element = (type, props = {}) => ({ type, props, key: null });
const jsxRuntime = {
  jsx: (type, props, key) => ({ type, props: props ?? {}, key: key ?? null }),
  jsxs: (type, props, key) => ({ type, props: props ?? {}, key: key ?? null }),
  Fragment,
};

const PALETTE = new Proxy({}, { get: (_, key) => `palette:${String(key)}` });
const TYPO = new Proxy({}, { get: (_, key) => ({ font: String(key) }) });
const STYLE_MOCK = { lineHeight: (size, ratio) => size * ratio, palette: PALETTE, typo: TYPO };
const UI_MOCKS = {
  "@/components/ui/AppText": { Text: "Text", TextInput: "TextInput" },
  "@/components/invitation/InvitationButton": { default: "InvitationButton" },
  "@/components/invitation/invitationStyle": STYLE_MOCK,
};
const StyleSheet = { create: (styles) => styles };

/**
 * 아주 작은 React 흉내. 함수 컴포넌트를 펼치고 훅(useState·useRef·useCallback·useMemo·useEffect)을 자리마다
 * 기억한다. 다시 그리려면 `render` 를 또 부른다. 단추·입력칸 같은 가짜 모듈은 문자열 이름의 칸으로 남는다.
 */
function createHost() {
  const slots = new Map();
  let frame = null;
  let effects = [];
  const changed = (before, after) => !before || !after || before.length !== after.length
    || before.some((value, index) => !Object.is(value, after[index]));
  const slot = (create) => {
    const store = slots.get(frame.path);
    const index = frame.index;
    frame.index += 1;
    if (!(index in store)) store[index] = create();
    return store[index];
  };
  const react = {
    useState(initial) {
      const cell = slot(() => ({ value: typeof initial === "function" ? initial() : initial }));
      cell.set ??= (update) => {
        cell.value = typeof update === "function" ? update(cell.value) : update;
      };
      return [cell.value, cell.set];
    },
    useRef: (initial) => slot(() => ({ current: initial })),
    useCallback(fn, deps) {
      const cell = slot(() => ({}));
      if (changed(cell.deps, deps)) Object.assign(cell, { fn, deps });
      return cell.fn;
    },
    useMemo(make, deps) {
      const cell = slot(() => ({}));
      if (changed(cell.deps, deps)) Object.assign(cell, { value: make(), deps });
      return cell.value;
    },
    useEffect(effect, deps) {
      const cell = slot(() => ({}));
      if (!changed(cell.deps, deps)) return;
      cell.deps = deps;
      effects.push(() => {
        if (typeof cell.cleanup === "function") cell.cleanup();
        cell.cleanup = effect();
      });
    },
  };
  function expand(node, path) {
    if (node === null || node === undefined || typeof node === "boolean") return [];
    if (Array.isArray(node)) {
      return node.flatMap((child, index) => expand(child, `${path}[${child && typeof child === "object" && child.key != null ? child.key : index}]`));
    }
    if (typeof node !== "object") return [String(node)];
    if (node.type === Fragment) return expand(node.props.children, path);
    if (typeof node.type === "function") {
      const own = `${path}/${node.type.name}${node.key == null ? "" : `#${node.key}`}`;
      if (!slots.has(own)) slots.set(own, []);
      const outer = frame;
      frame = { path: own, index: 0 };
      try {
        return expand(node.type(node.props), own);
      } finally {
        frame = outer;
      }
    }
    return [{ type: node.type, props: node.props, children: expand(node.props.children, `${path}/${String(node.type)}`) }];
  }
  return {
    react,
    render(root) {
      effects = [];
      const tree = expand(root, "root");
      const pending = effects;
      effects = [];
      for (const run of pending) run();
      return tree;
    },
    /** 지금 화면 상태(useState·useRef)에 든 값 전부를 글로. 화면이 무엇을 쥐고 있는지 본다. */
    heldState() {
      const held = [...slots.values()].flat().map((cell) => (cell && "value" in cell ? cell.value : cell?.current));
      return JSON.stringify(held, (key, value) => (typeof value === "function" ? undefined : value));
    },
  };
}

const nodesOf = (tree) => tree.flatMap((node) => (typeof node === "string" ? [] : [node, ...nodesOf(node.children)]));
const textOf = (tree) => tree.map((node) => (typeof node === "string" ? node : textOf(node.children))).join("");
const buttonsOf = (tree) => nodesOf(tree).filter((node) => node.type === "InvitationButton");
const visible = (tree) => JSON.stringify(tree, (key, value) => (typeof value === "function" ? undefined : value));

/** 화면 파일의 `const <name> = useCallback(<함수>, …)` 를 떼어 `bindings` 안에서 돌릴 함수로 만든다. */
function callbackSource(relative, name) {
  const tree = ts.createSourceFile(relative, read(relative), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  (function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name && node.initializer
      && ts.isCallExpression(node.initializer) && node.initializer.expression.getText(tree) === "useCallback") {
      found = node.initializer.arguments[0].getText(tree);
    }
    ts.forEachChild(node, visit);
  })(tree);
  assert.ok(found, `${relative} 에서 ${name} 를 찾지 못했다 — 검사가 헛돈다`);
  return found;
}

function extractCallback(relative, name, bindings) {
  const compiled = ts.transpileModule(`const run = ${callbackSource(relative, name)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function("bindings", `with (bindings) { ${compiled} return run; }`)(bindings);
}

/** 부른 순서대로 답을 돌려주는 가짜 fetcher. 부른 경로·방법·본문을 적는다. */
function fakeFetcher(responses) {
  const calls = [];
  const queue = [...responses];
  const fetcher = async (path, init) => {
    calls.push({ path, method: init.method, body: init.body === undefined ? undefined : JSON.parse(init.body) });
    const next = queue.shift();
    if (!next) throw new Error(`unexpected request ${init.method} ${path}`);
    return { ok: next.status >= 200 && next.status < 300, status: next.status, json: async () => next.body };
  };
  return { fetcher, calls };
}

// ── 합성 자료 ───────────────────────────────────────────────────────────────

const HALL = "aaaaaaaa-1111-4111-8111-111111111111";
const HALL_2 = "bbbbbbbb-2222-4222-8222-222222222222";
const VERSION = "cccccccc-3333-4333-8333-333333333333";
const VERSION_2 = "cccccccc-9999-4999-8999-999999999999";
const LETTER_ID = "eeeeeeee-5555-4555-8555-555555555555";
const REPLY = "dddddddd-4444-4444-8444-444444444444";
const FINGERPRINT = "f".repeat(64);
const FINGERPRINT_2 = "a".repeat(64);

const letterModel = {
  recipients: ["합성 홀"],
  dateLabel: "11. 18",
  body: "합성 편지 본문",
  signature: "가와 나 드림",
  shares: [
    { key: "name", label: "이름", value: "가", on: true },
    { key: "phone", label: "휴대폰 번호", value: "", on: false },
    { key: "budget", label: "예산", value: "아직 정하지 않았다고 알려요", on: false },
  ],
  partnerApprovedName: "나",
  backdropPhoto: null,
};
const letterState = {
  letterId: LETTER_ID,
  versionId: VERSION,
  version: 1,
  fingerprint: FINGERPRINT,
  status: "draft",
  approver: { mode: "unset", designatedUserId: null, revision: 1 },
  approvedBy: [],
  waitingFor: ["user-a", "user-b"],
  viewerCanApprove: true,
  viewerIsApprover: true,
  sendingEnabled: false,
  notQueuedReason: null,
  recipients: [{ hallId: HALL, name: "합성 홀" }],
};
const TEXT = "합성 홀께\n\n안녕하세요. 합성 편지 본문\n\n가와 나 드림\n합성 안내 줄";
const selfSend = { versionId: VERSION, fingerprint: FINGERPRINT, messages: [{ hallId: HALL, name: "합성 홀", text: TEXT }], phoneOmitted: false };
const members = [{ id: "user-a", name: "가", isViewer: true }, { id: "user-b", name: "나", isViewer: false }];
const approverView = { setting: letterState.approver, members, pending: null };

// ── API 경계 ────────────────────────────────────────────────────────────────

test("a letter from a switched-off server reads as before; a self-send letter is read only in the right shape", async () => {
  const off = { letter: letterModel, state: letterState, missing: [] };
  const unsaved = { ...off, state: { ...letterState, versionId: null, version: null, fingerprint: null }, selfSend: null };
  const malformed = [
    { ...selfSend, fingerprint: "abc" },
    { ...selfSend, versionId: "v1" },
    { ...selfSend, messages: [{ hallId: HALL, name: "합성 홀", text: "" }] },
    { ...selfSend, messages: [{ hallId: "../x", name: "합성 홀", text: TEXT }] },
    { ...selfSend, phoneOmitted: "no" },
    { ...selfSend, messages: "합성" },
    "on",
  ];
  const { fetcher, calls } = fakeFetcher([
    { status: 200, body: off },
    { status: 200, body: { ...off, selfSend } },
    { status: 200, body: unsaved },
    ...malformed.map((value) => ({ status: 200, body: { ...off, selfSend: value } })),
  ]);
  const api = createInvitationApi(fetcher);
  const offRead = await api.letter();
  assert.deepEqual(offRead, { ok: true, data: off });
  assert.equal("selfSend" in offRead.data, false, "꺼진 서버의 답에 칸을 만들어 넣지 않는다");
  assert.deepEqual((await api.letter()).data.selfSend, selfSend);
  assert.equal((await api.letter()).data.selfSend, null, "켜졌지만 저장한 판이 없다");
  for (const value of malformed) assert.equal((await api.letter()).reason, "invalid", JSON.stringify(value));
  assert.equal(calls.length, 3 + malformed.length);
});

test("a global daily cap no longer stops the letter from loading, and is told like the daily cap", async () => {
  const capped = { ...letterState, status: "approved_not_queued", notQueuedReason: "global_daily_cap" };
  const result = { status: "approved_not_queued", notQueuedReason: "global_daily_cap", queuedCount: 0, duplicateHallIds: [], waitingFor: [] };
  const { fetcher } = fakeFetcher([
    { status: 200, body: { letter: letterModel, state: capped, missing: [] } },
    { status: 200, body: { result, letter: { letter: letterModel, state: capped, missing: [] } } },
    { status: 200, body: { letter: letterModel, state: { ...capped, notQueuedReason: "weekly_cap" }, missing: [] } },
    { status: 200, body: { result: { ...result, notQueuedReason: "weekly_cap" }, letter: null } },
  ]);
  const api = createInvitationApi(fetcher);
  assert.equal((await api.letter()).ok, true, "서비스 전체 상한이 걸린 편지를 불러오지 못했다고 하지 않는다");
  assert.equal((await api.approveLetter({ versionId: VERSION, fingerprint: FINGERPRINT })).ok, true);
  assert.equal((await api.letter()).reason, "invalid", "모르는 까닭은 여전히 그리지 않는다");
  assert.equal((await api.approveLetter({ versionId: VERSION, fingerprint: FINGERPRINT })).reason, "invalid");
  assert.deepEqual(letterApprovalNotice(result), { kind: "dailyCap" });
  assert.deepEqual(letterStateNotice(capped), { kind: "dailyCap" });
});

test("the consultation reads replyPaste only when it is there and well formed", async () => {
  const off = { consultation: null, replyId: null, inCalendar: false, startsAt: null };
  const replyPaste = { halls: [{ hallId: HALL, name: "합성 홀" }, { hallId: HALL_2, name: "다른 홀" }], addedCount: 0 };
  // 붙여 넣은 답으로 넣은 상담 수는 빈 화면의 첫 줄이 그대로 말한다. 0 이상의 정수만 받는다.
  const badCounts = [undefined, -1, 1.5, "2", null, Number.MAX_SAFE_INTEGER + 1];
  const { fetcher } = fakeFetcher([
    { status: 200, body: off },
    { status: 200, body: { ...off, replyPaste } },
    { status: 200, body: { ...off, replyPaste: { halls: [], addedCount: 0 } } },
    { status: 200, body: { ...off, replyPaste: { ...replyPaste, addedCount: 3 } } },
    { status: 200, body: { ...off, replyPaste: null } },
    { status: 200, body: { ...off, replyPaste: { halls: [{ hallId: "x", name: "합성 홀" }], addedCount: 0 } } },
    { status: 200, body: { ...off, replyPaste: { halls: [{ hallId: HALL }], addedCount: 0 } } },
    ...badCounts.map((addedCount) => ({ status: 200, body: { ...off, replyPaste: { halls: replyPaste.halls, addedCount } } })),
  ]);
  const api = createInvitationApi(fetcher);
  const offRead = await api.consultation();
  assert.deepEqual(offRead, { ok: true, data: off });
  assert.equal("replyPaste" in offRead.data, false);
  assert.deepEqual((await api.consultation()).data.replyPaste, replyPaste);
  assert.deepEqual((await api.consultation()).data.replyPaste, { halls: [], addedCount: 0 });
  assert.equal((await api.consultation()).data.replyPaste.addedCount, 3);
  for (let index = 0; index < 3; index += 1) assert.equal((await api.consultation()).reason, "invalid");
  for (const addedCount of badCounts) assert.equal((await api.consultation()).reason, "invalid", `addedCount ${String(addedCount)}`);
});

test("a pasted reply goes into the schedule as hall, date and time only, and nothing malformed leaves the phone", async () => {
  const { fetcher, calls } = fakeFetcher([
    { status: 200, body: { added: true, alreadyInCalendar: false, eventId: "evt-1" } },
    { status: 200, body: { added: false, alreadyInCalendar: true, eventId: "evt-1" } },
    { status: 409, body: { error: "일정이 가득 찼어요.", code: "SCHEDULE_FULL" } },
  ]);
  const api = createInvitationApi(fetcher);
  const added = await api.addPastedConsultationToSchedule({ hallId: HALL.toUpperCase(), date: "2026-11-30", time: "14:00", text: "원문 010-1234-5678", quote: "2시" });
  assert.equal(added.data.added, true);
  assert.deepEqual(calls[0], { path: "/api/invitation/consultation/paste-schedule", method: "POST", body: { hallId: HALL, date: "2026-11-30", time: "14:00" } });
  assert.equal((await api.addPastedConsultationToSchedule({ hallId: HALL, date: "2026-11-30" })).data.alreadyInCalendar, true);
  assert.deepEqual(calls[1].body, { hallId: HALL, date: "2026-11-30" }, "시간이 없으면 시간 칸도 없다");
  const full = await api.addPastedConsultationToSchedule({ hallId: HALL, date: "2026-11-30", time: null });
  assert.deepEqual([full.status, full.code, full.message], [409, "SCHEDULE_FULL", "일정이 가득 찼어요."]);
  assert.deepEqual(calls[2].body, { hallId: HALL, date: "2026-11-30" });
  for (const bad of [
    { hallId: "x", date: "2026-11-30" },
    { hallId: HALL, date: "2026-02-30" },
    { hallId: HALL, date: "2026-1-5" },
    { hallId: HALL, date: "20261130" },
    { hallId: HALL, date: "2026-11-30", time: "2시" },
    { hallId: HALL, date: "2026-11-30", time: "24:00" },
    { hallId: HALL, date: "2026-11-30", time: "14:0" },
    { hallId: HALL, date: "2026-11-30", time: "" },
    null,
    "2026-11-30",
  ]) {
    assert.equal((await api.addPastedConsultationToSchedule(bad)).reason, "input", JSON.stringify(bad));
  }
  assert.equal(calls.length, 3, "틀린 값은 보내지 않는다");
  assert.deepEqual(pastedScheduleBody({ hallId: HALL, date: "2028-02-29" }), { hallId: HALL, date: "2028-02-29" }, "윤년의 2월 29일은 있다");
});

test("the self-send part of the sheet shows texts only for the saved version that is on screen", () => {
  const response = { letter: letterModel, state: letterState, missing: [], selfSend };
  assert.equal(letterSelfSendView({ letter: letterModel, state: letterState, missing: [] }, false), null, "꺼진 서버");
  assert.deepEqual(letterSelfSendView(response, false), { messages: selfSend, saveFirst: false, beforeSave: false, askConditions: null, afterSend: true });
  assert.deepEqual(letterSelfSendView(response, true), { messages: null, saveFirst: true, beforeSave: false, askConditions: null, afterSend: true }, "고치는 중에는 옛 판의 글을 보이지 않는다");
  assert.equal(letterSelfSendView({ ...response, selfSend: { ...selfSend, fingerprint: FINGERPRINT_2 } }, false).messages, null);
  assert.equal(letterSelfSendView({ ...response, selfSend: { ...selfSend, versionId: VERSION_2 } }, false).messages, null);
  assert.equal(letterSelfSendView({ ...response, selfSend: null }, false).beforeSave, false, "저장한 판이 있으면 저장할 것이 없다(대기열에 들어간 판)");
  const draft = { letter: letterModel, state: { ...letterState, letterId: null, versionId: null, version: null, fingerprint: null }, selfSend: null };
  assert.deepEqual(letterSelfSendView({ ...draft, missing: ["month"] }, false), { messages: null, saveFirst: false, beforeSave: true, askConditions: "month", afterSend: false });
  // 담은 웨딩홀이 바뀌어 판이 내려간 편지(편지는 있고 판·지문이 없다)는 저장한 글을 그대로 쓴다. 조건을 알려 줘도
  // 글에 들어가지 않으므로 묻지 않고, 다시 저장하라고만 한다. 앞서 보낸 글의 답은 그 사이에도 오므로 상담 화면 길은 둔다.
  const stale = { letter: letterModel, state: { ...letterState, versionId: null, version: null, fingerprint: null }, selfSend: null };
  assert.ok(stale.state.letterId, "판이 내려간 편지에도 편지 ID 는 남는다");
  assert.deepEqual(letterSelfSendView({ ...stale, missing: ["month", "guests"] }, false), { messages: null, saveFirst: false, beforeSave: true, askConditions: null, afterSend: true });
  assert.equal(letterSelfSendView({ ...stale, missing: [] }, true).afterSend, true, "판이 내려간 편지를 고치는 중에도 상담 화면 길은 둔다");
  assert.equal(letterSelfSendView({ ...draft, missing: [] }, true).beforeSave, false, "고치는 중에는 저장하라는 줄이 따로 있다");
  assert.equal(letterSelfSendView({ ...draft, missing: [] }, true).afterSend, false, "한 번도 저장하지 않은 편지에는 붙여 넣을 답이 없다");
  // 모르는 것만 묻는다. 정한 예식일처럼 이미 알려 준 것을 다시 묻지 않는다.
  assert.equal(letterSelfSendView({ ...draft, missing: ["guests", "region"] }, true).askConditions, "guests");
  assert.equal(letterSelfSendView({ ...draft, missing: ["month", "region"] }, false).askConditions, "month");
  assert.equal(letterSelfSendView({ ...draft, missing: ["guests", "month"] }, false).askConditions, "both");
  assert.equal(letterSelfSendView({ ...draft, missing: ["region"] }, false).askConditions, null, "지역은 편지 글에 들어가지 않는다");
  assert.equal(letterSelfSendView({ ...draft, missing: [] }, false).askConditions, null);
  assert.equal(letterSelfSendView({ ...response, missing: ["month"] }, false).askConditions, null, "저장한 판의 글은 조건이 바뀌어도 다시 만들어지지 않는다");
});

test("a guessed vendor time is turned into the half of the day the couple picks", () => {
  assert.equal(withMeridiem("14:00", "am"), "02:00");
  assert.equal(withMeridiem("14:00", "pm"), "14:00");
  assert.equal(withMeridiem("10:30", "pm"), "22:30");
  assert.equal(withMeridiem("12:15", "am"), "00:15");
  assert.equal(withMeridiem("00:15", "pm"), "12:15");
  assert.equal(withMeridiem("2시", "pm"), null);
  assert.equal(withMeridiem("14:00", "noon"), null);
  assert.deepEqual(scheduleTimeParts("14:05"), { meridiem: "pm", hour12: 2, minute: 5 });
  assert.deepEqual(scheduleTimeParts("00:30"), { meridiem: "am", hour12: 12, minute: 30 });
  assert.deepEqual(scheduleTimeParts("12:00"), { meridiem: "pm", hour12: 12, minute: 0 });
  assert.equal(scheduleTimeParts("25:00"), null);
  // 한국 날짜로 읽는다: 2026-11-30 15:00Z 는 한국 12월 1일 0시다.
  assert.equal(kstTodayYmd(Date.parse("2026-11-30T15:00:00Z")), "2026-12-01");
  assert.equal(kstTodayYmd(Date.parse("2026-11-30T14:59:59Z")), "2026-11-30");
});

// ── 복사·공유·문자 ─────────────────────────────────────────────────────────

/** `src/lib/selfSendActions.ts` 를 가짜 폰 기능과 함께 돌린다. 부른 것은 `calls` 에 쌓인다. */
function loadActions({ os = "ios", setString = async () => true, share = async () => ({ action: "sharedAction" }), openURL = async () => undefined } = {}) {
  const calls = [];
  const natives = {
    "expo-clipboard": { setStringAsync: (text) => { calls.push(["clipboard", text]); return setString(text); } },
    "react-native": {
      Platform: { OS: os },
      Share: {
        sharedAction: "sharedAction",
        dismissedAction: "dismissedAction",
        share: (content, options) => { calls.push(["share", content, options]); return share(content); },
      },
      Linking: {
        openURL: (url) => { calls.push(["openURL", url]); return openURL(url); },
        canOpenURL: async (url) => { calls.push(["canOpenURL", url]); return true; },
      },
    },
  };
  return { actions: loadTs(join(mobileRoot, "src/lib/selfSendActions.ts"), natives), calls };
}

test("copy, share and SMS each open one door on the phone with the server's text, unchanged", async () => {
  const copy = loadActions();
  assert.equal(await copy.actions.copyLetterText(TEXT), "copied");
  assert.deepEqual(copy.calls, [["clipboard", TEXT]]);
  const share = loadActions();
  assert.equal(await share.actions.shareLetterText(TEXT), "shareOpened");
  assert.deepEqual(share.calls, [["share", { message: TEXT }, undefined]]);
  const ios = loadActions({ os: "ios" });
  assert.equal(await ios.actions.openLetterSms(TEXT), "smsOpened");
  assert.deepEqual(ios.calls, [["openURL", `sms:&body=${encodeURIComponent(TEXT)}`]]);
  const android = loadActions({ os: "android" });
  assert.equal(await android.actions.openLetterSms(TEXT), "smsOpened");
  assert.deepEqual(android.calls, [["openURL", `sms:?body=${encodeURIComponent(TEXT)}`]]);
  assert.equal(decodeURIComponent(android.calls[0][1].slice("sms:?body=".length)), TEXT, "줄바꿈과 한글이 그대로 간다");
  const search = loadActions();
  assert.equal(search.actions.hallSearchUrl("더 채플 & 홀"), `https://m.search.naver.com/search.naver?query=${encodeURIComponent("더 채플 & 홀")}`);
  assert.equal(await search.actions.openHallSearch("합성 홀"), "hallSearchOpened");
  assert.deepEqual(search.calls, [["openURL", `https://m.search.naver.com/search.naver?query=${encodeURIComponent("합성 홀")}`]]);
});

test("when a door does not open the phone says so truthfully, and falls back to a copy it can paste", async () => {
  assert.equal(await loadActions({ setString: async () => false }).actions.copyLetterText(TEXT), "copyFailed");
  assert.equal(await loadActions({ setString: async () => { throw new Error("denied"); } }).actions.copyLetterText(TEXT), "copyFailed");
  const dismissed = loadActions({ share: async () => ({ action: "dismissedAction" }) });
  assert.equal(await dismissed.actions.shareLetterText(TEXT), "cancelled", "공유 창을 닫은 사람에게 열렸다고 말하지 않는다");
  assert.equal(dismissed.calls.length, 1);
  // 앱을 못 열어 대신 복사했으면 그냥 복사와 다르게 답한다(누른 앱이 열리지 않았다는 것까지 알린다).
  const shareFails = loadActions({ share: async () => { throw new Error("busy"); } });
  assert.equal(await shareFails.actions.shareLetterText(TEXT), "copiedInstead");
  assert.deepEqual(shareFails.calls, [["share", { message: TEXT }, undefined], ["clipboard", TEXT]]);
  const noSms = loadActions({ os: "android", openURL: async () => { throw new Error("No Activity found to handle Intent"); } });
  assert.equal(await noSms.actions.openLetterSms(TEXT), "copiedInstead");
  assert.deepEqual(noSms.calls.map(([kind]) => kind), ["openURL", "clipboard"]);
  assert.deepEqual(noSms.calls[1], ["clipboard", TEXT], "문자 앱 대신 복사해 두는 것도 서버 글 그대로다");
  const nothing = loadActions({ openURL: async () => { throw new Error("x"); }, setString: async () => false });
  assert.equal(await nothing.actions.openLetterSms(TEXT), "copyFailed");
  assert.equal(await loadActions({ share: async () => { throw new Error("busy"); }, setString: async () => false }).actions.shareLetterText(TEXT), "copyFailed");
  assert.equal(await loadActions({ openURL: async () => { throw new Error("x"); } }).actions.openHallSearch("합성 홀"), "findHallFailed");
  // 열어 보기 전에 묻지 않는다(선언 없이 물으면 열 수 있어도 못 연다고 답한다).
  for (const probe of [dismissed, shareFails, noSms, nothing]) assert.ok(probe.calls.every(([kind]) => kind !== "canOpenURL"));
  assert.doesNotMatch(code("src/lib/selfSendActions.ts"), /canOpenURL/u);
});

// ── 보낼 글 칸 ──────────────────────────────────────────────────────────────

function loadPanel(native) {
  const host = createHost();
  const actions = loadActions(native);
  const module = loadTs(join(mobileRoot, "src/components/invitationLive/SelfSendPanel.tsx"), {
    react: host.react,
    "react/jsx-runtime": jsxRuntime,
    "react-native": { StyleSheet, View: "View" },
    "@hanbang/shared/invitation": SHARED,
    ...UI_MOCKS,
    "@/lib/selfSendActions": actions.actions,
  });
  return { host, calls: actions.calls, Panel: module.default };
}

/** 칸에 넘기는 것(`letterSelfSendView` 의 답 모양). 주지 않은 칸은 보일 것이 없다는 값이다. */
const panelView = (overrides = {}) => ({ messages: null, saveFirst: false, beforeSave: false, askConditions: null, afterSend: false, ...overrides });
/** 보낼 글이 있는 칸. 글이 있으면 저장한 편지라 상담 화면 길도 있다. */
const textsView = (messages) => panelView({ messages, afterSend: true });

/** 제목(받는 곳의 이름)이 든 글 상자. */
function cardOf(tree, title) {
  const card = nodesOf(tree).find((node) => node.type === "View"
    && node.children.some((child) => typeof child !== "string" && child.type === "Text" && textOf([child]) === title));
  assert.ok(card, `${title} 상자가 없다`);
  return [card];
}

/** 그 글 상자의 결과 줄(읽어 주는 알림 줄)에 든 글 그대로. 줄이 없으면 null. 포함이 아니라 같음으로 본다. */
function feedbackOf(tree, title) {
  const line = nodesOf(cardOf(tree, title)).find((node) => node.type === "Text" && node.props.accessibilityLiveRegion === "polite");
  return line ? textOf(line.children) : null;
}

test("each text has copy, share and SMS buttons that call exactly one of them with that very text", RACE, async () => {
  const two = { ...selfSend, messages: [selfSend.messages[0], { hallId: HALL_2, name: "다른 홀", text: `${TEXT}\n다른 글` }], phoneOmitted: true };
  const { host, calls, Panel } = loadPanel({ os: "android" });
  const opened = [];
  const root = element(Panel, { view: textsView(two), onAskConditions: () => {}, onOpenConsultation: () => opened.push("status") });
  let tree = host.render(root);
  for (const message of two.messages) {
    assert.equal(textOf(cardOf(tree, SELF_SEND_COPY.messageFor(message.name))).includes(message.text), true, "서버 글을 그대로 보인다");
  }
  for (const line of [SELF_SEND_COPY.intro, SELF_SEND_COPY.phoneOmitted, SELF_SEND_COPY.afterSend]) assert.ok(textOf(tree).includes(line), line);
  // 저장한 뒤 글이 나오면 그 위 첫 줄을 읽어 준다(안드로이드). 아이폰은 편지 화면이 같은 줄을 읽어 준다.
  const intro = nodesOf(tree).find((node) => node.type === "Text" && textOf(node.children) === SELF_SEND_COPY.intro);
  assert.equal(intro.props.accessibilityLiveRegion, "polite");
  // 읽어 주는 이름에 글을 싣지 않는다(터치 기록에 남지 않게).
  for (const node of nodesOf(tree)) {
    const spoken = node.props.accessibilityLabel;
    if (typeof spoken === "string") assert.ok(!spoken.includes("합성 편지 본문"), spoken);
  }
  const doors = [
    [SELF_SEND_COPY.copy, (message) => ["clipboard", message.text], SELF_SEND_COPY.copied],
    [SELF_SEND_COPY.share, (message) => ["share", { message: message.text }, undefined], SELF_SEND_COPY.shareOpened],
    [SELF_SEND_COPY.sms, (message) => ["openURL", `sms:?body=${encodeURIComponent(message.text)}`], SELF_SEND_COPY.smsOpened],
  ];
  for (const [index, message] of two.messages.entries()) {
    const title = SELF_SEND_COPY.messageFor(message.name);
    const other = SELF_SEND_COPY.messageFor(two.messages[1 - index].name);
    for (const [label, expected, feedback] of doors) {
      calls.length = 0;
      const target = buttonsOf(cardOf(tree, title)).find((node) => node.props.label === label);
      assert.equal(target.props.accessibilityLabel, `${title} ${label}`, "어느 곳의 글인지 읽어 준다");
      target.props.onPress();
      await flush();
      assert.deepEqual(calls, [expected(message)], `${message.name} ${label}: 하나만, 그 글 그대로`);
      tree = host.render(root);
      assert.ok(textOf(cardOf(tree, title)).includes(feedback), `${label} 뒤에 그 글 아래에서 사실대로 말한다`);
      assert.ok(!textOf(cardOf(tree, other)).includes(feedback));
    }
  }
  buttonsOf(tree).find((node) => node.props.label === SELF_SEND_COPY.openConsultation).props.onPress();
  assert.deepEqual(opened, ["status"]);
});

test("the Naver button of each text looks up that hall's public name only, never the letter text", RACE, async () => {
  const two = { ...selfSend, messages: [selfSend.messages[0], { hallId: HALL_2, name: "다른 홀", text: `${TEXT}\n다른 글` }] };
  const { host, calls, Panel } = loadPanel();
  const tree = host.render(element(Panel, { view: textsView(two), onAskConditions: () => {}, onOpenConsultation: () => {} }));
  for (const message of two.messages) {
    calls.length = 0;
    const link = buttonsOf(cardOf(tree, SELF_SEND_COPY.messageFor(message.name))).find((node) => node.props.label === SELF_SEND_COPY.findHall);
    assert.equal(link.props.accessibilityRole, "link");
    link.props.onPress();
    await flush();
    // 검색 주소는 네이버 서버로 간다. 실어도 되는 것은 누구나 아는 홀 이름뿐이다.
    assert.deepEqual(calls, [["openURL", `https://m.search.naver.com/search.naver?query=${encodeURIComponent(message.name)}`]], message.name);
    assert.ok(!decodeURIComponent(calls[0][1]).includes("합성 편지 본문"), "편지 글을 검색 주소에 싣지 않는다");
  }
});

test("a second tap while the share sheet is still opening does not open another", RACE, async () => {
  let release = () => {};
  const { host, calls, Panel } = loadPanel({ share: () => new Promise((done) => { release = () => done({ action: "sharedAction" }); }) });
  const root = element(Panel, { view: textsView(selfSend), onAskConditions: () => {}, onOpenConsultation: () => {} });
  const share = buttonsOf(host.render(root)).find((node) => node.props.label === SELF_SEND_COPY.share);
  share.props.onPress();
  share.props.onPress();
  await flush();
  assert.equal(calls.length, 1, "창이 겹쳐 열렸다");
  release();
  await flush();
  share.props.onPress();
  await flush();
  assert.equal(calls.length, 2, "끝나면 다시 열 수 있다");
});

test("a share sheet or SMS app that does not open is told as copied instead, and a Naver that does not open is told under that hall", RACE, async () => {
  const two = { ...selfSend, messages: [selfSend.messages[0], { hallId: HALL_2, name: "다른 홀", text: `${TEXT}\n다른 글` }] };
  const first = SELF_SEND_COPY.messageFor("합성 홀");
  const second = SELF_SEND_COPY.messageFor("다른 홀");
  const mount = (native) => {
    const panel = loadPanel(native);
    const root = element(panel.Panel, { view: textsView(two), onAskConditions: () => {}, onOpenConsultation: () => {} });
    const tap = async (title, label) => {
      buttonsOf(cardOf(panel.host.render(root), title)).find((node) => node.props.label === label).props.onPress();
      await flush();
      return panel.host.render(root);
    };
    return { calls: panel.calls, tap };
  };
  // 그냥 복사의 말은 대신 복사한 말 안에 들어 있다. 결과 줄은 포함이 아니라 같음으로 본다(`feedbackOf`).
  assert.ok(SELF_SEND_COPY.copiedInstead.includes(SELF_SEND_COPY.copied), "두 말이 갈라졌다 — 같음으로 보는 까닭을 다시 볼 것");

  // 공유 창도 문자 앱도 열리지 않는 폰: 같은 글을 대신 복사하고, 앱을 못 열었다는 것까지 말한다.
  const broken = mount({ share: async () => { throw new Error("busy"); }, openURL: async () => { throw new Error("No Activity found to handle Intent"); } });
  for (const label of [SELF_SEND_COPY.share, SELF_SEND_COPY.sms]) {
    broken.calls.length = 0;
    const tree = await broken.tap(first, label);
    assert.equal(feedbackOf(tree, first), SELF_SEND_COPY.copiedInstead, `${label}: 그냥 복사한 것처럼 말하지 않는다`);
    assert.equal(feedbackOf(tree, second), null);
    assert.deepEqual(broken.calls.at(-1), ["clipboard", TEXT], `${label}: 대신 복사한 것도 서버 글 그대로다`);
  }
  assert.equal(feedbackOf(await broken.tap(first, SELF_SEND_COPY.copy), first), SELF_SEND_COPY.copied, "그냥 복사는 그냥 복사했다고 말한다");

  // 네이버를 못 열면 그 홀의 글 아래에서만 말한다. 다른 글 아래의 앞 줄은 거둔다.
  broken.calls.length = 0;
  const missed = await broken.tap(second, SELF_SEND_COPY.findHall);
  assert.deepEqual(broken.calls, [["openURL", `https://m.search.naver.com/search.naver?query=${encodeURIComponent("다른 홀")}`]]);
  assert.equal(feedbackOf(missed, second), SELF_SEND_COPY.findHallFailed);
  assert.equal(feedbackOf(missed, first), null);

  // 복사도 막힌 폰이면 복사하지 못했다고 말한다. 그 말은 글을 직접 골라 복사하라고 하므로 글은 고를 수 있어야 한다.
  const noClipboard = mount({ share: async () => { throw new Error("busy"); }, setString: async () => false });
  assert.equal(feedbackOf(await noClipboard.tap(first, SELF_SEND_COPY.share), first), SELF_SEND_COPY.copyFailed);
  const copyMissed = await noClipboard.tap(second, SELF_SEND_COPY.copy);
  assert.equal(feedbackOf(copyMissed, second), SELF_SEND_COPY.copyFailed, "그냥 복사가 막혀도 같은 말이다");
  const letterText = nodesOf(cardOf(copyMissed, second)).find((node) => node.type === "Text" && textOf(node.children) === two.messages[1].text);
  assert.equal(letterText.props.selectable, true, "글을 골라 복사할 수 있다");

  // 네이버가 열리면 아무 말도 하지 않는다.
  const fine = mount();
  const opened = await fine.tap(first, SELF_SEND_COPY.findHall);
  assert.deepEqual([feedbackOf(opened, first), feedbackOf(opened, second)], [null, null]);
  assert.equal(fine.calls.length, 1);
});

test("while the letter is edited or not yet saved the panel shows no text to send", () => {
  const { host, Panel } = loadPanel();
  const asked = [];
  const draw = (view) => host.render(element(Panel, { view, onAskConditions: () => asked.push("ask"), onOpenConsultation: () => {} }));
  const editing = draw(panelView({ saveFirst: true }));
  assert.equal(textOf(editing), SELF_SEND_COPY.saveFirst);
  assert.equal(buttonsOf(editing).length, 0);
  const missing = draw(panelView({ askConditions: "both" }));
  assert.equal(textOf(missing), SELF_SEND_COPY.missingConditions);
  buttonsOf(missing).find((node) => node.props.label === SELF_SEND_COPY.missingConditionsAction).props.onPress();
  assert.deepEqual(asked, ["ask"]);
  // 모르는 것만 묻는다. 희망 시기를 알려 준(정한 예식일이 있는) 커플에게 희망 시기를 다시 묻지 않는다.
  for (const [ask, sentence] of [["month", SELF_SEND_COPY.missingMonth], ["guests", SELF_SEND_COPY.missingGuests]]) {
    const asking = draw(panelView({ askConditions: ask }));
    assert.equal(textOf(asking), sentence, ask);
    assert.deepEqual(buttonsOf(asking).map((node) => node.props.label), [SELF_SEND_COPY.missingConditionsAction]);
  }
  const unsavedDraft = draw(panelView({ beforeSave: true, askConditions: "both" }));
  assert.equal(textOf(unsavedDraft), `${SELF_SEND_COPY.missingConditions}${SELF_SEND_COPY.beforeSave}`, "조건을 먼저 묻고, 저장하면 글이 나온다고 이어 말한다");
  assert.deepEqual(draw(panelView()), [], "할 말이 없으면 칸도 없다");
  assert.ok(!textOf(draw(textsView(selfSend))).includes(SELF_SEND_COPY.phoneOmitted));
});

test("a letter saved once keeps the way to the consultation screen while it is edited or must be saved again", () => {
  const { host, Panel } = loadPanel();
  const opened = [];
  const draw = (view) => host.render(element(Panel, { view, onAskConditions: () => {}, onOpenConsultation: () => opened.push("status") }));
  // 앞서 보낸 글의 답은 고치는 중에도, 담은 웨딩홀이 바뀌어 다시 저장해야 할 때도 온다. 붙여 넣을 곳으로 가는 길을 둔다.
  for (const [view, first] of [
    [panelView({ saveFirst: true, afterSend: true }), SELF_SEND_COPY.saveFirst],
    [panelView({ beforeSave: true, afterSend: true }), SELF_SEND_COPY.beforeSave],
    [panelView({ afterSend: true }), ""],
  ]) {
    opened.length = 0;
    const tree = draw(view);
    assert.equal(textOf(tree), `${first}${SELF_SEND_COPY.afterSend}`, first || "글 없이 저장한 편지");
    assert.deepEqual(buttonsOf(tree).map((node) => node.props.label), [SELF_SEND_COPY.openConsultation]);
    buttonsOf(tree)[0].props.onPress();
    assert.deepEqual(opened, ["status"]);
  }
  // 보낼 글이 있으면 글 아래에 한 번만 둔다.
  const texts = draw(textsView(selfSend));
  assert.equal(nodesOf(texts).filter((node) => node.type === "Text" && textOf(node.children) === SELF_SEND_COPY.afterSend).length, 1);
  assert.ok(textOf(texts).endsWith(SELF_SEND_COPY.afterSend), "글과 그 아래 줄 다음에 온다");
  assert.equal(buttonsOf(texts).filter((node) => node.props.label === SELF_SEND_COPY.openConsultation).length, 1);
  // 한 번도 저장하지 않은 편지에는 붙여 넣을 답이 없다.
  assert.ok(!textOf(draw(panelView({ saveFirst: true }))).includes(SELF_SEND_COPY.afterSend));
  assert.ok(!textOf(draw(panelView({ beforeSave: true, askConditions: "month" }))).includes(SELF_SEND_COPY.afterSend));
});

// ── 편지 시트 ───────────────────────────────────────────────────────────────

function sheetTree(props) {
  const host = createHost();
  const module = loadTs(join(mobileRoot, "src/components/invitation/InvitationLetterSheet.tsx"), {
    react: host.react,
    "react/jsx-runtime": jsxRuntime,
    "react-native": { Image: "Image", Pressable: "Pressable", ScrollView: "ScrollView", StyleSheet, View: "View" },
    "react-native-safe-area-context": { useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) },
    "@hanbang/shared/invitation": SHARED,
    "@/components/ui/AppText": { Text: "Text", TextInput: "TextInput" },
    "@/components/ui/AmoraOrb": { default: "AmoraOrb" },
    "./InvitationButton": { default: "InvitationButton" },
    "./invitationPhotos": { invitationPhotoSource: () => null },
    "./invitationStyle": { ...STYLE_MOCK, hitSlopFor: () => ({}), photoFill: {}, shadow: {} },
  });
  return host.render(element(module.default, props));
}

test("the sheet draws today's send button unless a main action is given, and the new slots only when given", () => {
  const base = { model: letterModel, onToggleShare: () => {}, onNavigate: () => {}, onSend: () => {}, notice: null };
  const today = sheetTree(base);
  assert.equal(visible(sheetTree({ ...base, title: undefined, hidePartnerRead: false, selfSend: undefined, mainAction: undefined })), visible(today), "주지 않은 칸은 오늘 시트와 같다");
  assert.ok(buttonsOf(today).some((node) => node.props.label === LETTER_COPY.send));
  assert.ok(textOf(today).includes(LETTER_COPY.title(1)));
  assert.ok(textOf(today).includes(LETTER_COPY.partnerRead("나")));

  const pressed = [];
  const own = sheetTree({
    ...base,
    title: SELF_SEND_COPY.title(1),
    hidePartnerRead: true,
    mainAction: { label: SELF_SEND_COPY.save, onPress: () => pressed.push("save") },
    selfSend: element("SelfSendPanel"),
  });
  const labels = buttonsOf(own).map((node) => node.props.label);
  assert.ok(!labels.includes(LETTER_COPY.send), "보내기(승인) 단추를 그리지 않는다");
  assert.ok(textOf(own).includes(SELF_SEND_COPY.title(1)));
  assert.ok(!textOf(own).includes(LETTER_COPY.title(1)));
  assert.ok(!textOf(own).includes(LETTER_COPY.partnerRead("나")), "두 번 보내지 않는다는 약속을 하지 않는다");
  assert.ok(nodesOf(own).some((node) => node.type === "SelfSendPanel"));
  buttonsOf(own).find((node) => node.props.label === SELF_SEND_COPY.save).props.onPress();
  assert.deepEqual(pressed, ["save"]);
  const idle = sheetTree({ ...base, mainAction: { label: SELF_SEND_COPY.save } });
  assert.equal(buttonsOf(idle).find((node) => node.props.label === SELF_SEND_COPY.save).props.onPress, undefined, "저장할 것이 없으면 눌리지 않는다");
});

// ── 편지 화면 ───────────────────────────────────────────────────────────────

/** 편지 화면을 돌린다. `answer` 를 주면 제안의 확인·거절은 그 답(기다리게 할 약속도 된다)을 돌려준다. */
function letterScreen({ letter, saveResults = [], approver = approverView, os = "ios", answer }) {
  const host = createHost();
  const calls = [];
  const events = [];
  // 화면 읽기에 읽어 준 말(아이폰의 announceForAccessibility).
  const announced = [];
  const answered = { ok: true, data: { ...approver, pending: null } };
  const respond = () => (answer ? answer() : answered);
  const api = {
    letter: async () => { calls.push(["letter"]); return { ok: true, data: letter }; },
    approver: async () => { calls.push(["approver"]); return { ok: true, data: approver }; },
    saveLetter: async (body) => { calls.push(["saveLetter", body]); return saveResults.shift(); },
    approveLetter: async (version) => { calls.push(["approveLetter", version]); return { ok: false, reason: "http", status: 409, code: "SELF_SEND_MODE", message: null }; },
    confirmApprover: async (proposalId) => { calls.push(["confirmApprover", proposalId]); return respond(); },
    declineApprover: async (proposalId) => { calls.push(["declineApprover", proposalId]); return respond(); },
  };
  const owner = { status: "ready", ownerId: "user-a", api };
  const router = {
    canGoBack: () => false,
    back: () => events.push(["back"]),
    dismissTo: (href) => events.push(["dismissTo", href]),
    push: (href) => events.push(["push", href]),
    navigate: (href) => events.push(["navigate", href]),
  };
  const module = loadTs(join(mobileRoot, "app/halls/letter.tsx"), {
    react: host.react,
    "react/jsx-runtime": jsxRuntime,
    "react-native": {
      AccessibilityInfo: { announceForAccessibility: (text) => announced.push(text) },
      Platform: { OS: os },
    },
    "expo-router": { router },
    "@hanbang/shared/invitation": SHARED,
    "@/components/invitation/InvitationApproverPicker": { default: "InvitationApproverPicker", InvitationProposalAnswer: "InvitationProposalAnswer" },
    "@/components/invitation/InvitationLetterSheet": { default: "InvitationLetterSheet" },
    "@/components/invitation/InvitationStateScreen": { default: "InvitationStateScreen" },
    "@/components/invitationLive/SelfSendPanel": { default: "SelfSendPanel" },
    "@/lib/invitationApi.mjs": invitationApi,
    "@/lib/invitationLive": { useLiveOwner: () => owner },
    "@/lib/invitationRoutes.mjs": invitationRoutes,
  });
  const root = element(module.default);
  return {
    calls,
    events,
    announced,
    async open() {
      host.render(root);
      await flush();
    },
    sheet() {
      const found = nodesOf(host.render(root)).find((node) => node.type === "InvitationLetterSheet");
      assert.ok(found, "편지 시트가 그려지지 않았다");
      return found.props;
    },
  };
}

const TODAY_SHEET_PROPS = ["approver", "model", "notice", "onChangeBody", "onLater", "onNavigate", "onSend", "onToggleShare", "sendBusy"];

test("with the switch off the letter sheet receives exactly what it did before stage 1", async () => {
  const paused = { letter: letterModel, state: { ...letterState, status: "approved_not_queued", notQueuedReason: "sending_disabled" }, missing: [] };
  const screen = letterScreen({ letter: paused });
  await screen.open();
  const props = screen.sheet();
  assert.deepEqual(Object.keys(props).sort(), TODAY_SHEET_PROPS);
  assert.equal(props.notice, LETTER_STATE_COPY.approvedNotSent);
  assert.equal(props.approver.type, "InvitationApproverPicker");
  assert.deepEqual(screen.calls.map(([name]) => name), ["letter", "approver"], "더 부르는 것이 없다");
});

test("with the switch on the sheet saves without approving and shows the texts of the saved version", RACE, async () => {
  const on = { letter: letterModel, state: { ...letterState, status: "approved_not_queued", notQueuedReason: "sending_disabled" }, missing: [], selfSend };
  const savedSelfSend = { ...selfSend, versionId: VERSION_2, fingerprint: FINGERPRINT_2, messages: [{ ...selfSend.messages[0], text: `${TEXT} 고침` }] };
  const saved = {
    ok: true,
    data: {
      letter: { ...letterModel, body: "고친 본문" },
      state: { ...letterState, versionId: VERSION_2, version: 2, fingerprint: FINGERPRINT_2 },
      missing: [],
      selfSend: savedSelfSend,
    },
  };
  const screen = letterScreen({ letter: on, saveResults: [saved] });
  await screen.open();
  let props = screen.sheet();
  assert.equal(props.title, SELF_SEND_COPY.title(1));
  assert.equal(props.hidePartnerRead, true);
  assert.equal(props.approver, null, "직접 보내기에는 승인 칸이 없다");
  assert.equal(props.notice, null, "승인 흐름의 말(승인만 저장됨)을 하지 않는다");
  assert.equal(props.mainAction.label, SELF_SEND_COPY.save);
  assert.equal(props.mainAction.onPress, undefined, "저장할 것이 없으면 눌리지 않는다");
  assert.equal(props.selfSend.type, "SelfSendPanel");
  assert.deepEqual(props.selfSend.props.view, { messages: selfSend, saveFirst: false, beforeSave: false, askConditions: null, afterSend: true });
  props.selfSend.props.onOpenConsultation();
  props.selfSend.props.onAskConditions();
  assert.deepEqual(screen.events, [["dismissTo", "/(tabs)/schedule"], ["dismissTo", "/(tabs)/lounge?conditions=1"]]);
  assert.deepEqual(screen.announced, [], "열었을 때 이미 있던 글은 따로 읽어 주지 않는다");

  props.onChangeBody("고친 본문");
  props = screen.sheet();
  assert.deepEqual(props.selfSend.props.view, { messages: null, saveFirst: true, beforeSave: false, askConditions: null, afterSend: true }, "고치는 중에는 옛 판의 글을 보이지 않는다(상담 화면 길은 둔다)");
  props.mainAction.onPress();
  props = screen.sheet();
  assert.equal(props.mainAction.label, SELF_SEND_COPY.saving);
  assert.equal(props.mainAction.onPress, undefined, "저장하는 동안 다시 누를 수 없다");
  await flush();
  props = screen.sheet();
  const saves = screen.calls.filter(([name]) => name === "saveLetter");
  assert.equal(saves.length, 1);
  assert.equal(saves[0][1].body, "고친 본문");
  assert.equal(screen.calls.some(([name]) => name === "approveLetter"), false, "승인하지 않는다");
  assert.deepEqual(props.selfSend.props.view.messages, savedSelfSend, "저장한 판의 글을 보인다");
  assert.deepEqual(screen.announced, [SELF_SEND_COPY.intro], "저장해서 나온 글은 아이폰에서 읽어 준다");
  assert.equal(props.notice, null);
  assert.equal(props.mainAction.onPress, undefined);
});

test("a draft without the wedding month asks for it first, can still be saved, and a refused save is said as it is", RACE, async () => {
  const draft = { letter: letterModel, state: { ...letterState, letterId: null, versionId: null, version: null, fingerprint: null }, missing: ["month"], selfSend: null };
  const screen = letterScreen({ letter: draft, saveResults: [{ ok: false, reason: "http", status: 409, code: "RECIPIENTS_UNAVAILABLE", message: "받는 홀이 바뀌었어요." }] });
  await screen.open();
  let props = screen.sheet();
  assert.deepEqual(props.selfSend.props.view, { messages: null, saveFirst: false, beforeSave: true, askConditions: "month", afterSend: false });
  assert.equal(typeof props.mainAction.onPress, "function", "아직 저장한 판이 없으면 저장할 수 있다");
  props.mainAction.onPress();
  await flush();
  props = screen.sheet();
  assert.equal(props.notice, "받는 홀이 바뀌었어요.");
  await flush();
  assert.equal(screen.calls.filter(([name]) => name === "letter").length, 2, "409 면 편지를 다시 읽는다");
  assert.equal(screen.calls.some(([name]) => name === "approveLetter"), false);
  assert.deepEqual(screen.announced, [], "글이 나오지 않았으면 나왔다고 읽어 주지 않는다");
});

test("with no saved version the panel says saving brings the texts, also after the shortlist changed, and that save goes out", RACE, async () => {
  const panel = loadPanel();
  // 시트에 넘긴 직접 보내기 칸을 진짜 칸으로 그린다(시트 시험은 칸을 가짜로 둔다).
  const drawPanel = (props) => panel.host.render(element(panel.Panel, props.selfSend.props));

  // 처음 쓰는 초안: 편지도 판도 없다.
  const draftState = { ...letterState, letterId: null, versionId: null, version: null, fingerprint: null };
  const fresh = letterScreen({ letter: { letter: letterModel, state: draftState, missing: [], selfSend: null } });
  await fresh.open();
  let props = fresh.sheet();
  assert.deepEqual(props.selfSend.props.view, { messages: null, saveFirst: false, beforeSave: true, askConditions: null, afterSend: false });
  assert.equal(textOf(drawPanel(props)), SELF_SEND_COPY.beforeSave);
  assert.equal(buttonsOf(drawPanel(props)).length, 0, "저장 단추는 시트 아래의 하나뿐이다");
  assert.equal(typeof props.mainAction.onPress, "function", "저장할 수 있을 때만 이 줄을 둔다");
  props.onChangeBody("고친 본문");
  props = fresh.sheet();
  assert.equal(textOf(drawPanel(props)), SELF_SEND_COPY.saveFirst, "고치는 중에는 고친 것을 저장하라는 줄 하나만");

  // 담은 웨딩홀이 바뀌었다: 서버가 판을 내리고(편지 ID 는 남는다) 받는 곳을 지금 담은 홀로 보인다. 보낼 글은 없다.
  const shortlist = [{ hallId: HALL, name: "합성 홀" }, { hallId: HALL_2, name: "다른 홀" }];
  const stale = {
    letter: { ...letterModel, recipients: shortlist.map((hall) => hall.name), shares: letterModel.shares.filter((share) => share.key !== "phone") },
    state: { ...letterState, versionId: null, version: null, fingerprint: null, recipients: shortlist },
    missing: [],
    selfSend: null,
  };
  const texts = { versionId: VERSION_2, fingerprint: FINGERPRINT_2, messages: shortlist.map((hall) => ({ ...hall, text: `${hall.name} ${TEXT}` })), phoneOmitted: false };
  const resaved = { ok: true, data: { ...stale, state: { ...stale.state, versionId: VERSION_2, version: 2, fingerprint: FINGERPRINT_2 }, selfSend: texts } };
  const screen = letterScreen({ letter: stale, saveResults: [resaved] });
  await screen.open();
  props = screen.sheet();
  assert.equal(props.title, SELF_SEND_COPY.title(2), "지금 담은 홀 수로 말한다");
  assert.deepEqual(props.selfSend.props.view, { messages: null, saveFirst: false, beforeSave: true, askConditions: null, afterSend: true });
  // 앞서 보낸 글의 답은 다시 저장하기 전에도 온다. 저장하라는 줄 아래에 상담 화면 길을 둔다.
  assert.equal(textOf(drawPanel(props)), `${SELF_SEND_COPY.beforeSave}${SELF_SEND_COPY.afterSend}`);
  assert.deepEqual(buttonsOf(drawPanel(props)).map((node) => node.props.label), [SELF_SEND_COPY.openConsultation]);
  assert.equal(props.mainAction.label, SELF_SEND_COPY.save);
  props.mainAction.onPress();
  await flush();
  const saves = screen.calls.filter(([name]) => name === "saveLetter");
  assert.equal(saves.length, 1, "고친 것이 없어도 판이 없으면 저장한다");
  assert.equal(saves[0][1].letterId, LETTER_ID, "같은 편지에 새 판을 단다");
  assert.deepEqual(saves[0][1].recipientHallIds, [HALL, HALL_2], "지금 담은 홀로 저장한다");
  assert.equal(screen.calls.some(([name]) => name === "approveLetter"), false);
  props = screen.sheet();
  assert.deepEqual(props.selfSend.props.view, { messages: texts, saveFirst: false, beforeSave: false, askConditions: null, afterSend: true }, "저장하면 그 판의 글이 나온다");
  assert.ok(!textOf(drawPanel(props)).includes(SELF_SEND_COPY.beforeSave));
  assert.equal(props.notice, null);
  assert.equal(props.mainAction.onPress, undefined, "저장할 것이 없으면 눌리지 않는다");

  // 꺼진 서버에는 직접 보내기 칸이 없어 이 줄도 없다.
  const off = letterScreen({ letter: { letter: letterModel, state: draftState, missing: [] } });
  await off.open();
  const offProps = off.sheet();
  assert.deepEqual(Object.keys(offProps).sort(), TODAY_SHEET_PROPS);
  assert.ok(!visible(offProps).includes(SELF_SEND_COPY.beforeSave));
});

test("a self-send letter without a phone row draws no phone switch, and its save sends the phone off", RACE, async () => {
  // 직접 보내기의 글에는 번호가 들어가지 않아 서버가 알려줄 정보에서 번호 칸을 뺀다.
  const shares = letterModel.shares.filter((share) => share.key !== "phone");
  const on = { letter: { ...letterModel, shares }, state: letterState, missing: [], selfSend };
  const saved = {
    ok: true,
    data: { ...on, state: { ...letterState, versionId: VERSION_2, version: 2, fingerprint: FINGERPRINT_2 }, selfSend: { ...selfSend, versionId: VERSION_2, fingerprint: FINGERPRINT_2 } },
  };
  const screen = letterScreen({ letter: on, saveResults: [saved] });
  await screen.open();
  // 시트를 진짜로 그려 스위치를 센다.
  const switches = (props) => nodesOf(sheetTree(props))
    .filter((node) => node.props.accessibilityRole === "switch")
    .map((node) => node.props.accessibilityLabel);
  const expected = shares.map((share) => LETTER_COPY.switchLabel(share.label));
  let props = screen.sheet();
  assert.deepEqual(props.model.shares.map((share) => share.key), ["name", "budget"], "서버가 뺀 번호 칸을 화면이 만들지 않는다");
  assert.deepEqual(switches(props), expected);
  props.onToggleShare("budget");
  props = screen.sheet();
  assert.deepEqual(switches(props), expected, "다른 칸을 바꿔도 번호 칸은 생기지 않는다");
  props.mainAction.onPress();
  await flush();
  const saves = screen.calls.filter(([name]) => name === "saveLetter");
  assert.equal(saves.length, 1);
  assert.deepEqual(saves[0][1].shares, { name: { on: true, value: "가" }, phone: { on: false, value: null }, budget: { on: true } });
});

test("texts that appear after a save are announced once on iOS, and left to the live region on Android", RACE, async () => {
  const draft = { letter: letterModel, state: { ...letterState, letterId: null, versionId: null, version: null, fingerprint: null }, missing: [], selfSend: null };
  const saved = { ok: true, data: { letter: letterModel, state: letterState, missing: [], selfSend } };
  for (const [os, expected] of [["ios", [SELF_SEND_COPY.intro]], ["android", []]]) {
    const screen = letterScreen({ letter: draft, saveResults: [saved], os });
    await screen.open();
    screen.sheet().mainAction.onPress();
    await flush();
    assert.deepEqual(screen.sheet().selfSend.props.view.messages, selfSend, `${os}: 저장하면 글이 나온다`);
    assert.deepEqual(screen.announced, expected, os);
  }
  // 저장했지만 서버가 보낼 글을 주지 않은 판(대기열에 들어간 옛 판 같은)은 글이 나왔다고 읽어 주지 않는다.
  const noTexts = letterScreen({ letter: draft, saveResults: [{ ok: true, data: { ...saved.data, selfSend: null } }] });
  await noTexts.open();
  noTexts.sheet().mainAction.onPress();
  await flush();
  assert.equal(noTexts.sheet().selfSend.props.view.messages, null);
  assert.deepEqual(noTexts.announced, []);
});

const PROPOSAL = {
  proposalId: "ffffffff-6666-4666-8666-666666666666",
  mode: "designated",
  designatedUserId: "user-b",
  proposedBy: "user-b",
  proposedAt: "2026-11-17T03:00:00.000Z",
  viewerCanRespond: true,
};

test("in self-send mode a proposal from the other member can still be confirmed or declined, and nothing else of the approver choice is drawn", RACE, async () => {
  const on = { letter: letterModel, state: letterState, missing: [], selfSend };
  const pendingView = { ...approverView, pending: PROPOSAL };
  const screen = letterScreen({ letter: on, approver: pendingView });
  await screen.open();
  const props = screen.sheet();
  assert.equal(props.approver.type, "InvitationProposalAnswer", "고르는 칸 대신 답하는 칸만 둔다");
  assert.deepEqual(props.approver.props.pending, PROPOSAL);
  assert.deepEqual(props.approver.props.members, members);
  assert.equal(props.approver.props.busy, false);
  props.approver.props.onRespond(true);
  await flush();
  screen.sheet();
  await flush();
  assert.deepEqual(screen.calls.filter(([name]) => name === "confirmApprover"), [["confirmApprover", PROPOSAL.proposalId]]);
  assert.equal(screen.calls.filter(([name]) => name === "letter").length, 2, "확인하면 편지를 다시 읽는다");

  const declined = letterScreen({ letter: on, approver: pendingView });
  await declined.open();
  declined.sheet().approver.props.onRespond(false);
  await flush();
  assert.deepEqual(declined.calls.filter(([name]) => name === "declineApprover"), [["declineApprover", PROPOSAL.proposalId]]);
  assert.equal(declined.sheet().approver, null, "답하고 나면 답할 것이 없다");
  for (const probe of [screen, declined]) assert.equal(probe.calls.some(([name]) => name === "approveLetter" || name === "saveApprover"), false);

  // 내가 낸 제안이나 답할 수 없는 제안은 그리지 않는다(직접 보내기에서는 승인 방식을 바꾸지 않는다).
  const mine = letterScreen({ letter: on, approver: { ...approverView, pending: { ...PROPOSAL, proposedBy: "user-a", viewerCanRespond: false } } });
  await mine.open();
  assert.equal(mine.sheet().approver, null);
  // 꺼진 서버는 같은 제안을 오늘처럼 승인 칸 전체에 싣는다.
  const off = letterScreen({ letter: { letter: letterModel, state: letterState, missing: [] }, approver: pendingView });
  await off.open();
  const offProps = off.sheet();
  assert.deepEqual(Object.keys(offProps).sort(), TODAY_SHEET_PROPS);
  assert.equal(offProps.approver.type, "InvitationApproverPicker");
  assert.deepEqual(offProps.approver.props.pending, PROPOSAL);
});

test("in self-send mode saving the letter and answering the proposal never overlap; each waits for the other", RACE, async () => {
  // 담은 웨딩홀이 바뀌어 판이 내려간 편지다. 고친 것이 없어도 저장할 수 있다.
  const stale = { letter: letterModel, state: { ...letterState, versionId: null, version: null, fingerprint: null }, missing: [], selfSend: null };
  const pendingView = { ...approverView, pending: PROPOSAL };
  const saved = { ok: true, data: { letter: letterModel, state: letterState, missing: [], selfSend } };

  // 답하는 동안에는 저장 단추가 기다리고, 앞 그림에서 누른 저장도 나가지 않는다(쓰기는 한 번에 하나, 웹과 같다).
  let answer = () => {};
  const answering = letterScreen({ letter: stale, approver: pendingView, saveResults: [saved], answer: () => new Promise((done) => { answer = done; }) });
  await answering.open();
  let props = answering.sheet();
  const earlierSave = props.mainAction.onPress;
  assert.equal(typeof earlierSave, "function", "판이 내려간 편지는 저장할 수 있다");
  props.approver.props.onRespond(false);
  props = answering.sheet();
  assert.equal(props.approver.props.busy, true);
  assert.equal(props.mainAction.onPress, undefined, "답하는 동안 저장 단추는 눌리지 않는다");
  assert.equal(props.mainAction.label, SELF_SEND_COPY.save, "저장하는 중이라고 말하지 않는다");
  earlierSave();
  await flush();
  assert.equal(answering.calls.some(([name]) => name === "saveLetter"), false, "답과 저장이 엇갈려 나갔다");
  answer({ ok: true, data: { ...pendingView, pending: null } });
  await flush();
  props = answering.sheet();
  assert.equal(props.approver, null, "답한 제안은 다시 그리지 않는다");
  props.mainAction.onPress();
  await flush();
  assert.equal(answering.calls.filter(([name]) => name === "saveLetter").length, 1, "답이 끝나면 저장할 수 있다");
  assert.equal(answering.sheet().approver, null, "저장한 답이 이미 답한 제안을 되살리지 않는다");

  // 거꾸로, 저장하는 동안에는 답하는 단추가 눌리지 않는다.
  let finishSave = () => {};
  const saving = letterScreen({ letter: stale, approver: pendingView, saveResults: [new Promise((done) => { finishSave = done; })] });
  await saving.open();
  saving.sheet().mainAction.onPress();
  assert.equal(saving.sheet().approver.props.busy, true, "저장하는 동안 답하지 않는다");
  finishSave(saved);
  await flush();
  assert.equal(saving.sheet().approver.props.busy, false);
  for (const probe of [answering, saving]) assert.equal(probe.calls.some(([name]) => name === "approveLetter"), false);
});

/** 승인 방식 파일의 컴포넌트 하나(`default` 는 승인 칸 전체)를 그린다. */
function pickerTree(name, props) {
  const host = createHost();
  const module = loadTs(join(mobileRoot, "src/components/invitation/InvitationApproverPicker.tsx"), {
    react: host.react,
    "react/jsx-runtime": jsxRuntime,
    "react-native": { Pressable: "Pressable", StyleSheet, View: "View" },
    "@hanbang/shared/invitation": SHARED,
    "@/components/ui/AppText": { Text: "Text" },
    "./InvitationButton": { default: "InvitationButton" },
    "./invitationStyle": { ...STYLE_MOCK, hitSlopFor: () => ({}) },
  });
  return host.render(element(module[name], props));
}

test("the answer part draws the proposal sentence with confirm and decline only, the same as inside the full approver choice", () => {
  const responded = [];
  const props = { pending: PROPOSAL, members, busy: false, onRespond: (accept) => responded.push(accept) };
  const sentence = LETTER_STATE_COPY.approverProposedBy("나", LETTER_STATE_COPY.approverPerson("나"));
  const answer = pickerTree("InvitationProposalAnswer", props);
  assert.equal(textOf(answer), sentence);
  assert.deepEqual(buttonsOf(answer).map((node) => node.props.label), [LETTER_STATE_COPY.approverConfirm, LETTER_STATE_COPY.approverDecline]);
  assert.equal(nodesOf(answer).some((node) => node.type === "Pressable"), false, "승인할 사람을 고르는 칩은 없다");
  for (const node of buttonsOf(answer)) node.props.onPress();
  assert.deepEqual(responded, [true, false]);
  assert.ok(buttonsOf(pickerTree("InvitationProposalAnswer", { ...props, busy: true })).every((node) => node.props.onPress === undefined), "답하는 동안 다시 누르지 못한다");
  // 답할 것이 없거나 누가 무엇을 제안했는지 말할 수 없으면 그리지 않는다.
  assert.deepEqual(pickerTree("InvitationProposalAnswer", { ...props, pending: null }), []);
  assert.deepEqual(pickerTree("InvitationProposalAnswer", { ...props, pending: { ...PROPOSAL, viewerCanRespond: false } }), []);
  assert.deepEqual(pickerTree("InvitationProposalAnswer", { ...props, members: [members[0], { ...members[1], name: " " }] }), []);
  // 승인 칸 전체(꺼진 서버)가 그리는 같은 부분과 모양이 같다.
  const full = pickerTree("default", { mode: "unset", designatedUserId: null, members, onChoose: () => {}, pending: PROPOSAL, onRespond: () => {} });
  const part = nodesOf(full).filter((node) => node.type === "View" && textOf([node]) === sentence);
  assert.equal(part.length, 1);
  assert.equal(visible(part), visible(answer));
  assert.ok(textOf(full).includes(LETTER_STATE_COPY.approverHeading), "승인 칸 전체에는 고르는 칸도 있다");
});

function prepareHarness({ body, flags, state = letterState, saveLetter }) {
  const cells = { notice: [], state: [], sending: [], announced: [] };
  const run = extractCallback("app/halls/letter.tsx", "prepare", {
    announceSelfSendTexts: (response) => cells.announced.push(response),
    liveOwner: { status: "ready", api: { saveLetter, approveLetter: () => { throw new Error("prepare 가 승인을 불렀다"); } } },
    state: { status: "ready", letter: { letter: letterModel, state, missing: [], selfSend }, approver: null },
    server: letterModel,
    letterState: state,
    shown: { ...letterModel, body },
    sendingRef: { current: false },
    approverSavingRef: { current: false },
    body,
    flags,
    reload: () => {},
    setSending: (value) => cells.sending.push(value),
    setActionNotice: (value) => cells.notice.push(value),
    setState: (value) => cells.state.push(value),
    setEditedBody: () => {},
    setEditedFlags: () => {},
    isLetterDirty,
    letterSaveBody,
    sameVisibleLetter,
    LETTER_STATE_COPY,
  });
  return { run, cells };
}

test("이 편지로 할게요 saves once on two quick taps, does nothing for a clean saved letter, and never approves", RACE, async () => {
  const saves = [];
  let release = () => {};
  const quick = prepareHarness({
    body: "고친 본문",
    flags: letterShareFlags(letterModel),
    saveLetter: (payload) => {
      saves.push(payload);
      return new Promise((done) => { release = () => done({ ok: true, data: { letter: { ...letterModel, body: "고친 본문", signature: "합성 맺음말" }, state: letterState, missing: [] } }); });
    },
  });
  const first = quick.run();
  const second = quick.run();
  release();
  await Promise.all([first, second]);
  assert.equal(saves.length, 1, "같은 순간 두 번 눌러 새 판을 두 번 만들었다");
  assert.deepEqual(quick.cells.sending, [true, false]);
  assert.equal(quick.cells.notice.at(-1), LETTER_STATE_COPY.versionChanged, "저장된 판이 보던 편지와 다르면 다시 보게 한다");
  assert.equal(quick.cells.announced.length, 1, "저장한 답으로 한 번만 읽어 줄지 본다");

  const clean = prepareHarness({ body: letterModel.body, flags: letterShareFlags(letterModel), saveLetter: async (payload) => { saves.push(payload); } });
  await clean.run();
  assert.equal(saves.length, 1, "고친 것이 없는 저장한 판은 다시 저장하지 않는다");

  const prepare = callbackSource("app/halls/letter.tsx", "prepare");
  assert.doesNotMatch(prepare, /approveLetter/u);
  assert.match(prepare, /\.saveLetter\(letterSaveBody\(letterState, server, body, flags\)\)/u);
  const letter = code("app/halls/letter.tsx");
  assert.equal((letter.match(/\.approveLetter\(/gu) ?? []).length, 1, "승인 길은 send 하나뿐이다");
  assert.match(letter, /const approver = selfSendView \? null : state\.approver;/u);
  assert.match(letter, /const stateNotice = selfSendView \? null : letterStateNotice\(letterState\);/u);
  assert.match(letter, /\{\.\.\.selfSendProps\}/u);
});

// ── 상담 화면 ───────────────────────────────────────────────────────────────

const ADDED = { ok: true, data: { added: true, alreadyInCalendar: false, eventId: "evt-1" } };

/**
 * 상담 화면을 돌린다. 읽기는 `response` 다음 `reads` 를 차례로 돌려주고 마지막 것을 되풀이한다. 붙여 넣은 답을 넣으면
 * `pasted` 를 돌려준다. 옮겨 간 주소는 `events` 에 쌓인다.
 */
function consultationScreen(response, { reads = [], pasted = ADDED, from = "tabs" } = {}) {
  const host = createHost();
  const calls = [];
  const events = [];
  const answers = [response, ...reads];
  const api = {
    consultation: async () => { calls.push(["consultation"]); return { ok: true, data: answers.length > 1 ? answers.shift() : answers[0] }; },
    addConsultationToSchedule: async (replyId) => { calls.push(["addConsultationToSchedule", replyId]); return ADDED; },
    addPastedConsultationToSchedule: async (input) => { calls.push(["addPastedConsultationToSchedule", input]); return pasted; },
  };
  const owner = { status: "ready", ownerId: "user-a", api };
  const router = {
    canGoBack: () => false,
    back: () => events.push(["back"]),
    push: (href) => events.push(["push", href]),
    navigate: (href) => events.push(["navigate", href]),
    dismissTo: (href) => events.push(["dismissTo", href]),
  };
  const module = loadTs(join(mobileRoot, "src/components/invitationLive/LiveConsultation.tsx"), {
    react: host.react,
    "react/jsx-runtime": jsxRuntime,
    "react-native": { RefreshControl: "RefreshControl", StyleSheet, View: "View" },
    "expo-router": {
      router,
      useFocusEffect: (callback) => host.react.useEffect(callback, [callback]),
    },
    "@hanbang/shared/invitation": SHARED,
    ...UI_MOCKS,
    "@/components/invitation/InvitationConsultation": { default: "InvitationConsultation" },
    "@/components/invitation/InvitationStateScreen": { default: "InvitationStateScreen" },
    "@/components/invitationLive/VendorReplyPaste": { default: "VendorReplyPaste" },
    "@/lib/invitationLive": { useLiveOwner: () => owner },
    "@/lib/invitationRoutes.mjs": invitationRoutes,
    "@/lib/readGate.mjs": readGate,
  });
  const root = element(module.default, { from });
  const find = (type) => {
    const found = nodesOf(host.render(root)).find((node) => node.type === type);
    assert.ok(found, `${type} 가 그려지지 않았다`);
    return found.props;
  };
  return {
    calls,
    events,
    find,
    async open(type) {
      host.render(root);
      await flush();
      return find(type);
    },
  };
}

const emptyConsultation = { consultation: null, replyId: null, inCalendar: false, startsAt: null };
const confirmedConsultation = {
  consultation: { dateLabel: "11. 30", timeLabel: "합성 시각", venue: "합성 홀", place: "", partnerName: null, photo: null, update: null, updateActions: [], questions: [] },
  replyId: REPLY,
  inCalendar: false,
  startsAt: "2026-11-30T05:00:00.000Z",
};
const replyPaste = { halls: [{ hallId: HALL, name: "합성 홀" }], addedCount: 0 };

test("the consultation screen adds the paste only when the server gives replyPaste; switched off it reads nothing more", RACE, async () => {
  const off = consultationScreen(emptyConsultation);
  const offProps = await off.open("InvitationStateScreen");
  assert.equal(offProps.title, CONSULTATION_STATE_COPY.none);
  assert.equal(offProps.footer, undefined, "꺼진 서버면 아무것도 더 그리지 않는다");
  assert.deepEqual(off.calls, [["consultation"]]);

  const on = consultationScreen({ ...emptyConsultation, replyPaste });
  const footer = (await on.open("InvitationStateScreen")).footer;
  assert.equal(footer.type, "VendorReplyPaste");
  assert.deepEqual(footer.props.halls, replyPaste.halls);
  const input = { hallId: HALL, date: "2026-11-30", time: "14:00" };
  assert.equal((await footer.props.onAdd(input)).ok, true);
  assert.deepEqual(on.calls, [["consultation"], ["addPastedConsultationToSchedule", input], ["consultation"]], "새로 넣었으면 넣은 수를 다시 읽는다");

  const confirmedOff = consultationScreen(confirmedConsultation);
  const offChildren = (await confirmedOff.open("InvitationConsultation")).footer.props.children;
  assert.equal(offChildren.filter(Boolean).length, 1, "전체 일정 단추만 있다");
  const confirmedOn = consultationScreen({ ...confirmedConsultation, replyPaste });
  const onChildren = (await confirmedOn.open("InvitationConsultation")).footer.props.children;
  assert.ok(onChildren.some((child) => child?.type === "VendorReplyPaste"));

  const source = code("src/components/invitationLive/LiveConsultation.tsx");
  assert.equal((source.match(/\.addPastedConsultationToSchedule\(/gu) ?? []).length, 1);
  assert.match(source, /footer=\{pasteReply\}/u);
});

test("with the paste the empty consultation says the reply goes below it; with the switch off the line is today's", RACE, async () => {
  const off = consultationScreen(emptyConsultation);
  const offProps = await off.open("InvitationStateScreen");
  assert.equal(offProps.sub, CONSULTATION_STATE_COPY.noneSub);
  assert.deepEqual(Object.keys(offProps).sort(), ["actions", "back", "footer", "refreshControl", "sub", "title", "withTabBar"], "꺼진 서버면 칸이 늘지 않는다");
  assert.ok(textOf(stateScreenTree(offProps)).includes(CONSULTATION_STATE_COPY.noneSub));

  const on = consultationScreen({ ...emptyConsultation, replyPaste });
  const onProps = await on.open("InvitationStateScreen");
  assert.equal(onProps.title, CONSULTATION_STATE_COPY.none);
  assert.equal(onProps.sub, VENDOR_REPLY_COPY.emptySub, "업체 답은 두 분 폰으로 온다. 아래에 붙여 넣으라고 한다");
  const drawn = textOf(stateScreenTree(onProps));
  assert.ok(drawn.includes(VENDOR_REPLY_COPY.emptySub));
  assert.ok(!drawn.includes(CONSULTATION_STATE_COPY.noneSub), "답장이 오면 보여 준다는 옛 줄은 두지 않는다");
  assert.deepEqual(on.calls, [["consultation"]]);
});

function stateScreenTree(props) {
  const host = createHost();
  const module = loadTs(join(mobileRoot, "src/components/invitation/InvitationStateScreen.tsx"), {
    react: host.react,
    "react/jsx-runtime": jsxRuntime,
    "react-native": { ScrollView: "ScrollView", StyleSheet, View: "View" },
    "react-native-safe-area-context": { useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) },
    "@/components/ui/AppText": { Text: "Text" },
    "@/components/ui/AmoraOrb": { default: "AmoraOrb" },
    "./InvitationBackButton": { default: "InvitationBackButton" },
    "./InvitationButton": { default: "InvitationButton" },
    "./InvitationTabBar": { invitationTabBarClearance: () => 0 },
    "./invitationStyle": { ...STYLE_MOCK, opaqueScroll: {}, paragraph17: {} },
  });
  return host.render(element(module.default, props));
}

test("the empty-state screen draws a footer only when given, and only then meets the keyboard differently", () => {
  const base = {
    title: CONSULTATION_STATE_COPY.none,
    sub: CONSULTATION_STATE_COPY.noneSub,
    actions: [{ label: CONSULTATION_STATE_COPY.fullSchedule, onPress: () => {}, tone: "outline" }],
  };
  const today = stateScreenTree(base);
  assert.equal(visible(stateScreenTree({ ...base, footer: undefined })), visible(today));
  const scroll = nodesOf(today).find((node) => node.type === "ScrollView");
  assert.equal(scroll.props.keyboardShouldPersistTaps, undefined);
  assert.equal(scroll.props.automaticallyAdjustKeyboardInsets, undefined);
  const withFooter = stateScreenTree({ ...base, footer: element("VendorReplyPaste") });
  assert.ok(nodesOf(withFooter).some((node) => node.type === "VendorReplyPaste"));
  const views = (tree) => nodesOf(tree).filter((node) => node.type === "View").length;
  assert.equal(views(withFooter), views(today) + 1, "아래 칸 하나만 더 그린다");
  const footerScroll = nodesOf(withFooter).find((node) => node.type === "ScrollView");
  assert.equal(footerScroll.props.keyboardShouldPersistTaps, "handled", "키보드가 떠 있어도 단추가 한 번에 눌린다");
  assert.equal(footerScroll.props.automaticallyAdjustKeyboardInsets, true);
});

test("consultations added from pasted replies are counted on the empty screen, which still opens the full schedule", RACE, async () => {
  const counted = consultationScreen({ ...emptyConsultation, replyPaste: { ...replyPaste, addedCount: 2 } });
  const props = await counted.open("InvitationStateScreen");
  // 붙여 넣은 답으로 넣은 상담은 상담 모델에 나오지 않는다. 그래도 "아직 잡힌 상담이 없어요"라고 하지 않는다.
  assert.equal(props.title, VENDOR_REPLY_COPY.addedSoFar(2));
  assert.equal(props.sub, VENDOR_REPLY_COPY.emptySub);
  const drawn = textOf(stateScreenTree(props));
  assert.ok(drawn.includes(VENDOR_REPLY_COPY.addedSoFar(2)));
  assert.ok(!drawn.includes(CONSULTATION_STATE_COPY.none));
  // 그 상담들은 전체 일정에 있다. 앱이 쓰는 전체 일정 화면으로 간다.
  assert.deepEqual(props.actions.map((action) => action.label), [CONSULTATION_STATE_COPY.fullSchedule]);
  props.actions[0].onPress();
  assert.deepEqual(counted.events, [["push", "/schedule"]]);
  assert.equal(props.footer.type, "VendorReplyPaste", "더 붙여 넣을 수 있다");
  // 넣은 것이 없으면 오늘 줄 그대로다.
  assert.equal((await consultationScreen({ ...emptyConsultation, replyPaste }).open("InvitationStateScreen")).title, CONSULTATION_STATE_COPY.none);
});

test("adding a pasted consultation reads the count again; one that was already there or was refused reads nothing", RACE, async () => {
  const input = { hallId: HALL, date: "2026-11-30", time: "14:00" };
  const screen = consultationScreen({ ...emptyConsultation, replyPaste }, { reads: [{ ...emptyConsultation, replyPaste: { ...replyPaste, addedCount: 1 } }] });
  const before = await screen.open("InvitationStateScreen");
  assert.equal(before.title, CONSULTATION_STATE_COPY.none);
  assert.deepEqual(await before.footer.props.onAdd(input), ADDED, "받은 답을 그대로 붙여 넣기 칸에 돌려준다");
  await flush();
  assert.deepEqual(screen.calls, [["consultation"], ["addPastedConsultationToSchedule", input], ["consultation"]]);
  const after = screen.find("InvitationStateScreen");
  assert.equal(after.title, VENDOR_REPLY_COPY.addedSoFar(1), "넣은 뒤 다시 읽은 수를 말한다");
  assert.equal(after.footer.type, "VendorReplyPaste", "붙여 넣기는 그 자리에 남는다");

  for (const pasted of [
    { ok: true, data: { added: false, alreadyInCalendar: true, eventId: "evt-1" } },
    { ok: false, reason: "http", status: 409, code: "SCHEDULE_FULL", message: "일정이 가득 찼어요." },
    { ok: false, reason: "network", status: 0, code: null, message: null },
  ]) {
    const quiet = consultationScreen({ ...emptyConsultation, replyPaste }, { pasted });
    const footer = (await quiet.open("InvitationStateScreen")).footer;
    assert.deepEqual(await footer.props.onAdd(input), pasted, "받은 답을 그대로 돌려준다");
    await flush();
    assert.deepEqual(quiet.calls.map(([name]) => name), ["consultation", "addPastedConsultationToSchedule"], JSON.stringify(pasted));
  }

  // 확정된 상담 화면 아래의 붙여 넣기도 같다.
  const confirmed = consultationScreen({ ...confirmedConsultation, replyPaste });
  const paste = (await confirmed.open("InvitationConsultation")).footer.props.children.find((child) => child?.type === "VendorReplyPaste");
  await paste.props.onAdd(input);
  await flush();
  assert.deepEqual(confirmed.calls.map(([name]) => name), ["consultation", "addPastedConsultationToSchedule", "consultation"]);
});

test("with no hall to choose, the paste opens the hall compare screen the app already has", RACE, async () => {
  const noHalls = { ...emptyConsultation, replyPaste: { halls: [], addedCount: 0 } };
  const tabs = consultationScreen(noHalls);
  (await tabs.open("InvitationStateScreen")).footer.props.onOpenHalls();
  assert.deepEqual(tabs.events, [["push", "/halls"]], "일정 탭에서는 웨딩홀 비교를 쌓는다");
  const stack = consultationScreen(noHalls, { from: "stack" });
  (await stack.open("InvitationStateScreen")).footer.props.onOpenHalls();
  assert.deepEqual(stack.events, [["dismissTo", "/halls"]], "웨딩홀 스택 안에서는 아래의 비교로 돌아간다");
  const confirmed = consultationScreen({ ...confirmedConsultation, replyPaste: noHalls.replyPaste });
  const paste = (await confirmed.open("InvitationConsultation")).footer.props.children.find((child) => child?.type === "VendorReplyPaste");
  paste.props.onOpenHalls();
  assert.deepEqual(confirmed.events, [["push", "/halls"]]);
});

/** 확정된 상담 화면(`InvitationConsultation`)을 그린다. */
function consultationTree(props) {
  const host = createHost();
  const module = loadTs(join(mobileRoot, "src/components/invitation/InvitationConsultation.tsx"), {
    react: host.react,
    "react/jsx-runtime": jsxRuntime,
    "react-native": { Image: "Image", ScrollView: "ScrollView", StyleSheet, View: "View" },
    "react-native-safe-area-context": { useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) },
    "@hanbang/shared/invitation": SHARED,
    "@/components/ui/AppText": { Text: "Text" },
    "@/components/ui/AmoraOrb": { default: "AmoraOrb" },
    "./InvitationBackButton": { default: "InvitationBackButton" },
    "./InvitationButton": { default: "InvitationButton" },
    "./InvitationTabBar": { invitationTabBarClearance: () => 0 },
    "./invitationPhotos": { invitationPhotoSource: () => null },
    "./invitationStyle": { ...STYLE_MOCK, BROWSER_BUTTON_TEXT: "#000000", em: (size, ratio) => size * ratio, paragraph17: {}, photoFill: {}, shadow: {} },
  });
  return host.render(element(module.default, props));
}

test("the confirmed consultation meets the keyboard like the empty screen only when the paste is there", RACE, async () => {
  const offProps = await consultationScreen(confirmedConsultation).open("InvitationConsultation");
  assert.equal("keyboardAware" in offProps, false, "꺼진 서버면 칸이 늘지 않는다");
  const onProps = await consultationScreen({ ...confirmedConsultation, replyPaste }).open("InvitationConsultation");
  assert.equal(onProps.keyboardAware, true);
  const scrollOf = (props) => nodesOf(consultationTree(props)).find((node) => node.type === "ScrollView");
  const today = scrollOf(offProps);
  assert.equal(today.props.keyboardShouldPersistTaps, undefined);
  assert.equal(today.props.automaticallyAdjustKeyboardInsets, undefined);
  const aware = scrollOf(onProps);
  assert.equal(aware.props.keyboardShouldPersistTaps, "handled", "키보드가 떠 있어도 단추가 한 번에 눌린다");
  assert.equal(aware.props.automaticallyAdjustKeyboardInsets, true);
  // 키보드 말고는 같은 칸을 받는다.
  const given = (props) => Object.keys(props).filter((key) => props[key] !== undefined).sort();
  assert.deepEqual(given(aware.props).filter((key) => !["automaticallyAdjustKeyboardInsets", "keyboardShouldPersistTaps"].includes(key)), given(today.props));
});

// ── 받은 답 붙여 넣기 ──────────────────────────────────────────────────────

/** 붙여 넣기 칸을 돌린다. `onAdd` 가 받은 것은 `added` 에, 웨딩홀 비교로 가는 단추를 누른 것은 `opened` 에 쌓인다. */
function pasteHarness({ halls, results = [], onAdd } = {}) {
  const host = createHost();
  const reads = [];
  const added = [];
  const opened = [];
  const keyboard = { dismissed: 0 };
  const module = loadTs(join(mobileRoot, "src/components/invitationLive/VendorReplyPaste.tsx"), {
    react: host.react,
    "react/jsx-runtime": jsxRuntime,
    "react-native": { Keyboard: { dismiss: () => { keyboard.dismissed += 1; } }, StyleSheet, View: "View" },
    "@hanbang/shared/invitation": { ...SHARED, readVendorReply: (raw, options) => { reads.push(raw); return SHARED.readVendorReply(raw, options); } },
    ...UI_MOCKS,
    "@/lib/invitationApi.mjs": invitationApi,
  });
  const add = onAdd ?? ((input) => {
    added.push(input);
    return Promise.resolve(results.length > 0 ? results.shift() : { ok: true, data: { added: true, alreadyInCalendar: false, eventId: "evt-1" } });
  });
  const root = element(module.default, { halls, onAdd: add, onOpenHalls: () => opened.push("compare") });
  const harness = {
    reads,
    added,
    opened,
    keyboard,
    host,
    tree: host.render(root),
    rerender() {
      harness.tree = host.render(root);
      return harness.tree;
    },
    button(label) {
      const found = buttonsOf(harness.tree).filter((node) => node.props.label === label);
      assert.equal(found.length, 1, `${label} 단추가 ${found.length}개다`);
      return found[0];
    },
    press(label) {
      const target = harness.button(label);
      assert.equal(typeof target.props.onPress, "function", `${label} 가 눌리지 않는다`);
      target.props.onPress();
      return harness.rerender();
    },
    input(label) {
      const found = nodesOf(harness.tree).find((node) => node.type === "TextInput" && node.props.accessibilityLabel === label);
      assert.ok(found, `${label} 입력칸이 없다`);
      return found;
    },
    type(label, text) {
      harness.input(label).props.onChangeText(text);
      return harness.rerender();
    },
    async settle() {
      await flush();
      return harness.rerender();
    },
    text: () => textOf(harness.tree),
  };
  return harness;
}

const HALLS = [{ hallId: HALL, name: "합성 홀" }, { hallId: HALL_2, name: "다른 홀" }];
// 해를 적은 글이다. 해가 없으면 오늘에 따라 고르는 해가 바뀌어 시험이 날짜에 묶인다.
const RAW = "안녕하세요 합성웨딩입니다.\n2026년 11월 30일 2시 상담 가능합니다.\n대관료 300만원, 보증인원 200명입니다.\n문의는 010-1234-5678 로 주세요.";

test("a pasted reply is read on the phone and masked, and only hall, date and time leave it", RACE, async () => {
  const h = pasteHarness({ halls: HALLS });
  assert.deepEqual(buttonsOf(h.tree).map((node) => node.props.label), [VENDOR_REPLY_COPY.open], "처음에는 여는 단추 하나뿐이다");
  h.press(VENDOR_REPLY_COPY.open);
  assert.equal(h.button(VENDOR_REPLY_COPY.read).props.onPress, undefined, "빈 칸은 읽지 않는다");
  h.type(VENDOR_REPLY_COPY.inputLabel, RAW);
  h.press(VENDOR_REPLY_COPY.read);
  assert.deepEqual(h.reads, [RAW], "이 기기에서 한 번 읽는다");
  assert.equal(h.keyboard.dismissed, 1);
  // 원문은 비웠다. 화면에도 화면 상태에도 가린 글만 남는다.
  assert.equal(nodesOf(h.tree).some((node) => node.type === "TextInput" && node.props.value === RAW), false);
  for (const secret of ["010-1234-5678", "1234-5678"]) {
    assert.ok(!visible(h.tree).includes(secret), `${secret} 가 화면에 남았다`);
    assert.ok(!h.host.heldState().includes(secret), `${secret} 가 화면 상태에 남았다`);
  }
  assert.ok(h.text().includes(VENDOR_REPLY_COPY.maskLabels.phone));
  assert.ok(h.text().includes(VENDOR_REPLY_COPY.masked(1)));
  const reading = SHARED.readVendorReply(RAW);
  const datetime = reading.chips.find((chip) => chip.kind === "datetime");
  assert.ok(datetime?.meridiemGuessed, "시험 글은 오전·오후 없이 쓴 시간이어야 한다 — 검사가 헛돈다");
  // 금액·보증 인원은 업체가 적은 값을 옮겨 보여 줄 뿐 누르지 않는다. 업체가 쓴 말은 따온 그대로다.
  for (const chip of reading.chips.filter((one) => one.kind === "price" || one.kind === "count")) {
    assert.ok(h.text().includes(chip.label), chip.label);
    assert.equal(buttonsOf(h.tree).some((node) => node.props.label === chip.label), false);
  }
  assert.ok(h.text().includes(VENDOR_REPLY_COPY.quoteLabel));

  h.press(datetime.label);
  assert.ok(h.text().includes(VENDOR_REPLY_COPY.meridiemQuestion));
  h.press(VENDOR_REPLY_COPY.add);
  await h.settle();
  assert.deepEqual(h.added, [], "홀을 고르기 전에는 넣지 않는다");
  assert.ok(h.text().includes(VENDOR_REPLY_COPY.pickHall));
  h.press("다른 홀");
  h.press(VENDOR_REPLY_COPY.add);
  await h.settle();
  assert.deepEqual(h.added, [], "오전·오후를 고르기 전에는 짐작한 시간을 넣지 않는다");
  h.press(VENDOR_REPLY_COPY.timeChip(VENDOR_REPLY_COPY.pm, 2, 0));
  assert.ok(!h.text().includes(VENDOR_REPLY_COPY.meridiemQuestion));
  h.press(VENDOR_REPLY_COPY.add);
  await h.settle();
  assert.deepEqual(h.added, [{ hallId: HALL_2, date: "2026-11-30", time: "14:00" }]);
  assert.ok(h.text().includes(VENDOR_REPLY_COPY.added));
  assert.ok(!JSON.stringify(h.added).includes("합성웨딩"), "붙여 넣은 글은 어디에도 실리지 않는다");
});

test("the paste box keeps the pasted original out of the phone's autofill services", () => {
  const h = pasteHarness({ halls: HALLS });
  h.press(VENDOR_REPLY_COPY.open);
  const box = h.input(VENDOR_REPLY_COPY.inputLabel);
  // 안드로이드는 이 값이 "no" 가 아니면 칸의 글을 자동 완성 서비스(다른 회사의 앱일 수 있다)에 넘기는 화면 구조에 실을 수 있다.
  assert.equal(box.props.importantForAutofill, "no");
  assert.equal(box.props.autoCorrect, false);
});

test("오전 is taken as said, 시간 없이 넣기 drops the time, and every answer is said as it is", RACE, async () => {
  const h = pasteHarness({
    halls: [HALLS[0]],
    results: [
      { ok: true, data: { added: true, alreadyInCalendar: false, eventId: "evt-1" } },
      { ok: true, data: { added: false, alreadyInCalendar: true, eventId: "evt-1" } },
      { ok: false, reason: "http", status: 409, code: "SCHEDULE_FULL", message: "일정이 가득 찼어요." },
      { ok: false, reason: "network", status: 0, code: null, message: null },
      null,
    ],
  });
  h.press(VENDOR_REPLY_COPY.open);
  h.type(VENDOR_REPLY_COPY.inputLabel, RAW);
  h.press(VENDOR_REPLY_COPY.read);
  h.press(SHARED.readVendorReply(RAW).chips.find((chip) => chip.kind === "datetime").label);
  h.press(VENDOR_REPLY_COPY.timeChip(VENDOR_REPLY_COPY.am, 2, 0));
  h.press(VENDOR_REPLY_COPY.add);
  await h.settle();
  assert.deepEqual(h.added, [{ hallId: HALL, date: "2026-11-30", time: "02:00" }], "홀이 하나면 그 홀로 둔다");
  h.press(VENDOR_REPLY_COPY.noTime);
  for (const expected of [VENDOR_REPLY_COPY.alreadyAdded, "일정이 가득 찼어요.", VENDOR_REPLY_COPY.failed, VENDOR_REPLY_COPY.failed]) {
    h.press(VENDOR_REPLY_COPY.add);
    await h.settle();
    assert.ok(h.text().includes(expected), expected);
  }
  assert.deepEqual(h.added.slice(1), Array(4).fill({ hallId: HALL, date: "2026-11-30" }), "시간 없이 넣으면 시간 칸이 없다");

  const said = pasteHarness({ halls: [HALLS[0]] });
  said.press(VENDOR_REPLY_COPY.open);
  const exact = "2026년 12월 5일 오후 3시 30분에 뵐게요.";
  said.type(VENDOR_REPLY_COPY.inputLabel, exact);
  said.press(VENDOR_REPLY_COPY.read);
  said.press(SHARED.readVendorReply(exact).chips.find((chip) => chip.kind === "datetime").label);
  assert.ok(!said.text().includes(VENDOR_REPLY_COPY.meridiemQuestion), "오후라고 쓴 시간은 묻지 않는다");
  said.press(VENDOR_REPLY_COPY.add);
  await said.settle();
  assert.deepEqual(said.added, [{ hallId: HALL, date: "2026-12-05", time: "15:30" }]);
});

test("without a date in the reply a typed date goes in only when it is a real day", RACE, async () => {
  const h = pasteHarness({ halls: [HALLS[0]] });
  h.press(VENDOR_REPLY_COPY.open);
  h.type(VENDOR_REPLY_COPY.inputLabel, "다음 주에 한번 오세요.");
  h.press(VENDOR_REPLY_COPY.read);
  assert.ok(h.text().includes(VENDOR_REPLY_COPY.none));
  h.type(VENDOR_REPLY_COPY.dateLabel, "2026-02-30");
  h.press(VENDOR_REPLY_COPY.add);
  await h.settle();
  assert.deepEqual(h.added, []);
  assert.ok(h.text().includes(VENDOR_REPLY_COPY.pickDate));
  h.type(VENDOR_REPLY_COPY.dateLabel, " 2026-12-05 ");
  h.press(VENDOR_REPLY_COPY.add);
  await h.settle();
  assert.deepEqual(h.added, [{ hallId: HALL, date: "2026-12-05" }]);
});

test("two quick taps on 이 날짜로 일정에 넣기 add once", RACE, async () => {
  let release = () => {};
  const added = [];
  const h = pasteHarness({
    halls: [HALLS[0]],
    onAdd: (input) => {
      added.push(input);
      return new Promise((done) => { release = () => done({ ok: true, data: { added: true, alreadyInCalendar: false, eventId: "evt-1" } }); });
    },
  });
  h.press(VENDOR_REPLY_COPY.open);
  h.type(VENDOR_REPLY_COPY.inputLabel, "2026년 12월 5일 오후 3시 30분에 뵐게요.");
  h.press(VENDOR_REPLY_COPY.read);
  h.press(SHARED.readVendorReply("2026년 12월 5일 오후 3시 30분에 뵐게요.").chips[0].label);
  const add = h.button(VENDOR_REPLY_COPY.add).props.onPress;
  add();
  add();
  await flush();
  assert.equal(added.length, 1, "같은 순간 두 번 눌러 일정을 두 번 넣었다");
  assert.equal(h.rerender() && h.button(VENDOR_REPLY_COPY.adding).props.onPress, undefined);
  release();
  await h.settle();
  assert.ok(h.text().includes(VENDOR_REPLY_COPY.added));
});

test("a weekday the vendor wrote that is not the calendar's is pointed out once, in the same style as the other notes", () => {
  // 2026년 11월 30일은 월요일, 12월 1일은 화요일이다. 업체는 둘 다 다른 요일을 적었다. 해를 적어 오늘에 묶이지 않는다.
  const mismatched = "2026년 11월 30일 (토) 오후 2시, 2026년 12월 1일 (일) 상담 가능합니다. 문의는 010-1234-5678 로 주세요.";
  const wrong = SHARED.readVendorReply(mismatched).chips.filter((chip) => chip.weekdayMismatch);
  assert.deepEqual(wrong.map((chip) => chip.kind).sort(), ["date", "datetime"], "시험 글은 두 꼴의 칩이 모두 어긋나야 한다 — 검사가 헛돈다");
  const h = pasteHarness({ halls: [HALLS[0]] });
  const lines = (text) => nodesOf(h.tree).filter((node) => node.type === "Text" && textOf(node.children) === text);
  h.press(VENDOR_REPLY_COPY.open);
  h.type(VENDOR_REPLY_COPY.inputLabel, mismatched);
  h.press(VENDOR_REPLY_COPY.read);
  assert.equal(lines(VENDOR_REPLY_COPY.weekdayMismatch).length, 1, "어긋난 날짜가 여럿이어도 한 줄이다");
  assert.deepEqual(lines(VENDOR_REPLY_COPY.weekdayMismatch)[0].props.style, lines(VENDOR_REPLY_COPY.masked(1))[0].props.style, "가린 곳·잘린 글 줄과 같은 모양이다");
  const readAgain = (text) => {
    h.press(VENDOR_REPLY_COPY.again);
    h.type(VENDOR_REPLY_COPY.inputLabel, text);
    h.press(VENDOR_REPLY_COPY.read);
    return lines(VENDOR_REPLY_COPY.weekdayMismatch).length;
  };
  // 날짜만 적힌 칩이든 날짜와 시간이 함께 적힌 칩이든, 하나만 어긋나도 알린다.
  for (const [text, kind] of [["2026년 12월 1일 (일) 상담 가능합니다.", "date"], ["2026년 11월 30일 (토) 오후 2시 가능합니다.", "datetime"]]) {
    assert.deepEqual(SHARED.readVendorReply(text).chips.filter((chip) => chip.weekdayMismatch).map((chip) => chip.kind), [kind], `${text} — 검사가 헛돈다`);
    assert.equal(readAgain(text), 1, kind);
  }
  for (const matched of ["2026년 11월 30일 (월) 오후 2시 상담 가능합니다.", "2026년 11월 30일 오후 2시 상담 가능합니다."]) {
    assert.equal(readAgain(matched), 0, matched);
  }
});

test("the time is typed like the date: 24-hour HH:MM goes in as typed, a time chip fills it, and a bad time is not sent", RACE, async () => {
  const dateOnly = "2026년 12월 5일 상담 가능합니다.";
  const h = pasteHarness({ halls: [HALLS[0]] });
  h.press(VENDOR_REPLY_COPY.open);
  h.type(VENDOR_REPLY_COPY.inputLabel, dateOnly);
  h.press(VENDOR_REPLY_COPY.read);
  // 자판과 읽어 주는 이름은 날짜 칸을 따른다.
  const dateBox = h.input(VENDOR_REPLY_COPY.dateLabel).props;
  const timeBox = h.input(VENDOR_REPLY_COPY.timeLabel).props;
  for (const prop of ["keyboardType", "autoCorrect", "placeholderTextColor", "style"]) assert.deepEqual(timeBox[prop], dateBox[prop], `${prop}: 날짜 칸과 같다`);
  assert.equal(timeBox.maxLength, 5);
  assert.ok(VENDOR_REPLY_COPY.timeInvalid.includes(timeBox.placeholder), "보기 값은 틀렸을 때 말하는 보기와 같다");
  assert.equal(timeBox.value, "", "업체 답에 시간이 없으면 칸은 비어 있다");
  h.press(SHARED.readVendorReply(dateOnly).chips.find((chip) => chip.kind === "date").label);
  for (const bad of ["25:00", "9:3", "14:0", "14시", "9:60"]) {
    h.type(VENDOR_REPLY_COPY.timeLabel, bad);
    h.press(VENDOR_REPLY_COPY.add);
    await h.settle();
    assert.ok(h.text().includes(VENDOR_REPLY_COPY.timeInvalid), bad);
  }
  assert.deepEqual(h.added, [], "틀린 시간은 보내지 않는다");
  // 한 자리 시는 앞에 0 을 붙여 읽는다(웹의 시간 칸과 같은 꼴로 보낸다).
  h.type(VENDOR_REPLY_COPY.timeLabel, "9:30");
  h.press(VENDOR_REPLY_COPY.add);
  await h.settle();
  assert.ok(!h.text().includes(VENDOR_REPLY_COPY.timeInvalid), "9:30 은 틀린 시간이 아니다");
  assert.deepEqual(h.added, [{ hallId: HALL, date: "2026-12-05", time: "09:30" }]);
  h.added.length = 0;
  h.type(VENDOR_REPLY_COPY.timeLabel, " 15:30 ");
  assert.equal(h.input(VENDOR_REPLY_COPY.timeLabel).props.value, "15:30");
  assert.ok(!h.text().includes(VENDOR_REPLY_COPY.timeInvalid), "고쳐 적으면 앞 줄은 내린다");
  assert.ok(!h.text().includes(VENDOR_REPLY_COPY.meridiemQuestion), "적은 시간은 짐작이 아니라 오전·오후를 묻지 않는다");
  h.press(VENDOR_REPLY_COPY.add);
  await h.settle();
  assert.deepEqual(h.added, [{ hallId: HALL, date: "2026-12-05", time: "15:30" }]);
  assert.deepEqual(Object.keys(h.added[0]), ["hallId", "date", "time"], "보내는 칸은 셋뿐이다");

  // 짐작한 시간 칩은 칸을 채우고 여전히 오전·오후를 묻는다. 사람이 고쳐 적으면 묻지 않는다. 시간 없이 넣기는 칸을 비운다.
  const guessedReply = "2026년 12월 5일 2시 상담 가능합니다.";
  const guessed = SHARED.readVendorReply(guessedReply).chips.find((chip) => chip.kind === "datetime");
  assert.ok(guessed?.meridiemGuessed, "시험 글은 오전·오후 없이 쓴 시간이어야 한다 — 검사가 헛돈다");
  const g = pasteHarness({ halls: [HALLS[0]] });
  g.press(VENDOR_REPLY_COPY.open);
  g.type(VENDOR_REPLY_COPY.inputLabel, guessedReply);
  g.press(VENDOR_REPLY_COPY.read);
  g.press(guessed.label);
  assert.equal(g.input(VENDOR_REPLY_COPY.timeLabel).props.value, "14:00", "칩이 시간 칸을 채운다");
  assert.ok(g.text().includes(VENDOR_REPLY_COPY.meridiemQuestion));
  g.press(VENDOR_REPLY_COPY.add);
  await g.settle();
  assert.deepEqual(g.added, [], "짐작한 시간은 오전·오후를 고르기 전에 넣지 않는다");
  g.type(VENDOR_REPLY_COPY.timeLabel, "16:00");
  assert.ok(!g.text().includes(VENDOR_REPLY_COPY.meridiemQuestion), "사람이 고쳐 적은 시간은 묻지 않는다");
  g.press(VENDOR_REPLY_COPY.add);
  await g.settle();
  assert.deepEqual(g.added, [{ hallId: HALL, date: "2026-12-05", time: "16:00" }]);
  g.press(guessed.label);
  g.press(VENDOR_REPLY_COPY.noTime);
  assert.equal(g.input(VENDOR_REPLY_COPY.timeLabel).props.value, "", "시간 없이 넣기는 칸을 비운다");
  g.press(VENDOR_REPLY_COPY.add);
  await g.settle();
  assert.deepEqual(g.added.at(-1), { hallId: HALL, date: "2026-12-05" });

  // 시간만 적힌 답의 칩도 칸을 채운다. 오후라고 적었으니 묻지 않는다.
  const timeOnly = "오후 3시 30분에 오실 수 있어요.";
  const chip = SHARED.readVendorReply(timeOnly).chips.find((one) => one.kind === "time");
  assert.equal(chip?.meridiemGuessed, false, "시험 글은 오후라고 적은 시간이어야 한다 — 검사가 헛돈다");
  const t = pasteHarness({ halls: [HALLS[0]] });
  t.press(VENDOR_REPLY_COPY.open);
  t.type(VENDOR_REPLY_COPY.inputLabel, timeOnly);
  t.press(VENDOR_REPLY_COPY.read);
  t.press(chip.label);
  assert.equal(t.input(VENDOR_REPLY_COPY.timeLabel).props.value, "15:30");
  assert.ok(!t.text().includes(VENDOR_REPLY_COPY.meridiemQuestion));
});

test("a date the server refuses is told in the server's own sentence, and only hall and date were sent", RACE, async () => {
  const { fetcher, calls } = fakeFetcher([
    { status: 400, body: { error: VENDOR_REPLY_COPY.dateOutOfRange, code: "PASTE_SCHEDULE_INVALID" } },
  ]);
  const api = createInvitationApi(fetcher);
  // 화면이 쓰는 진짜 경계(`addPastedConsultationToSchedule`)로 보낸다.
  const h = pasteHarness({ halls: [HALLS[0]], onAdd: (input) => api.addPastedConsultationToSchedule(input) });
  h.press(VENDOR_REPLY_COPY.open);
  h.type(VENDOR_REPLY_COPY.inputLabel, "다음 주에 한번 오세요.");
  h.press(VENDOR_REPLY_COPY.read);
  h.type(VENDOR_REPLY_COPY.dateLabel, "2031-01-05");
  h.press(VENDOR_REPLY_COPY.add);
  await h.settle();
  assert.ok(h.text().includes(VENDOR_REPLY_COPY.dateOutOfRange), "서버가 쓴 말 그대로 보인다");
  assert.ok(!h.text().includes(VENDOR_REPLY_COPY.failed), "다시 눌러 달라고 하지 않는다(다시 눌러도 같다)");
  assert.deepEqual(calls, [{ path: "/api/invitation/consultation/paste-schedule", method: "POST", body: { hallId: HALL, date: "2031-01-05" } }]);
});

test("nothing from the pasted reply rides in a spoken label, the held state or the request; only hall, date and time leave", RACE, async () => {
  const h = pasteHarness({ halls: HALLS });
  h.press(VENDOR_REPLY_COPY.open);
  h.type(VENDOR_REPLY_COPY.inputLabel, RAW);
  h.press(VENDOR_REPLY_COPY.read);
  h.press(SHARED.readVendorReply(RAW).chips.find((chip) => chip.kind === "datetime").label);
  h.press("합성 홀");
  h.type(VENDOR_REPLY_COPY.timeLabel, "15:00");
  h.press(VENDOR_REPLY_COPY.add);
  await h.settle();
  assert.deepEqual(h.added, [{ hallId: HALL, date: "2026-11-30", time: "15:00" }]);
  // 읽어 주는 이름은 터치 기록에 실린다. 정해진 칸 이름만 둔다. 칩·업체가 쓴 말·가린 글은 화면 글자로만 둔다.
  const spoken = nodesOf(h.tree).map((node) => node.props.accessibilityLabel).filter((label) => label !== undefined);
  assert.deepEqual(spoken, [VENDOR_REPLY_COPY.dateLabel, VENDOR_REPLY_COPY.timeLabel]);
  // 붙여 넣은 원문은 화면 상태에 남지 않는다(가린 글만 남는다).
  const held = h.host.heldState();
  assert.ok(!held.includes(JSON.stringify(RAW).slice(1, -1)));
  assert.ok(!held.includes("010-1234-5678"));
  assert.ok(!JSON.stringify(h.added).includes("합성웨딩"));
});

test("money talk gets the caution line, and again or close forget what was pasted", () => {
  const h = pasteHarness({ halls: HALLS });
  h.press(VENDOR_REPLY_COPY.open);
  h.type(VENDOR_REPLY_COPY.inputLabel, "계좌 110-123-456789 로 예약금 입금 부탁드려요.");
  h.press(VENDOR_REPLY_COPY.read);
  assert.ok(h.text().includes(VENDOR_REPLY_COPY.caution));
  assert.ok(!visible(h.tree).includes("110-123-456789"));
  h.press(VENDOR_REPLY_COPY.again);
  assert.equal(h.input(VENDOR_REPLY_COPY.inputLabel).props.value, "");
  h.type(VENDOR_REPLY_COPY.inputLabel, "아직 읽지 않은 글");
  h.press(VENDOR_REPLY_COPY.close);
  assert.deepEqual(buttonsOf(h.tree).map((node) => node.props.label), [VENDOR_REPLY_COPY.open]);
  h.press(VENDOR_REPLY_COPY.open);
  assert.equal(h.input(VENDOR_REPLY_COPY.inputLabel).props.value, "", "닫으면 붙여 넣은 글을 잊는다");

  const noHalls = pasteHarness({ halls: [] });
  noHalls.press(VENDOR_REPLY_COPY.open);
  noHalls.type(VENDOR_REPLY_COPY.inputLabel, RAW);
  noHalls.press(VENDOR_REPLY_COPY.read);
  assert.ok(noHalls.text().includes(VENDOR_REPLY_COPY.noHalls));
  assert.equal(buttonsOf(noHalls.tree).some((node) => node.props.label === VENDOR_REPLY_COPY.add), false);
});

test("with no hall to choose, a reply with nothing found says only that, and a button opens the hall compare screen", () => {
  const lines = (h) => nodesOf(h.tree).filter((node) => node.type === "Text").map((node) => textOf(node.children));
  const h = pasteHarness({ halls: [] });
  h.press(VENDOR_REPLY_COPY.open);
  h.type(VENDOR_REPLY_COPY.inputLabel, "다음 주에 한번 오세요.");
  h.press(VENDOR_REPLY_COPY.read);
  // 고를 웨딩홀이 없으면 날짜 칸도 단추도 없다. 직접 골라 넣을 수 있다고 하지 않는다.
  assert.equal(nodesOf(h.tree).some((node) => node.type === "TextInput"), false, "날짜·시간 칸이 없다");
  assert.ok(lines(h).includes(VENDOR_REPLY_COPY.noneOnly));
  assert.ok(!h.text().includes(VENDOR_REPLY_COPY.none));
  assert.ok(lines(h).includes(VENDOR_REPLY_COPY.noHalls));
  h.press(VENDOR_REPLY_COPY.noHallsAction);
  assert.deepEqual(h.opened, ["compare"], "웨딩홀을 담는 비교 화면을 연다");
  assert.deepEqual(h.added, []);

  // 날짜를 찾은 답에도 같은 단추가 있다.
  const found = pasteHarness({ halls: [] });
  found.press(VENDOR_REPLY_COPY.open);
  found.type(VENDOR_REPLY_COPY.inputLabel, RAW);
  found.press(VENDOR_REPLY_COPY.read);
  assert.ok(!lines(found).includes(VENDOR_REPLY_COPY.noneOnly));
  found.press(VENDOR_REPLY_COPY.noHallsAction);
  assert.deepEqual(found.opened, ["compare"]);

  // 고를 웨딩홀이 있으면 오늘 줄 그대로다(날짜를 직접 골라 넣을 수 있다). 비교로 가는 단추는 없다.
  const withHall = pasteHarness({ halls: [HALLS[0]] });
  withHall.press(VENDOR_REPLY_COPY.open);
  withHall.type(VENDOR_REPLY_COPY.inputLabel, "다음 주에 한번 오세요.");
  withHall.press(VENDOR_REPLY_COPY.read);
  assert.ok(lines(withHall).includes(VENDOR_REPLY_COPY.none));
  assert.ok(!lines(withHall).includes(VENDOR_REPLY_COPY.noHalls));
  assert.equal(buttonsOf(withHall.tree).some((node) => node.props.label === VENDOR_REPLY_COPY.noHallsAction), false);
});

test("the pasted text and the letter text stay in screen state: no storage, network or logging", () => {
  for (const file of [
    "src/components/invitationLive/VendorReplyPaste.tsx",
    "src/components/invitationLive/SelfSendPanel.tsx",
    "src/lib/selfSendActions.ts",
  ]) {
    assert.doesNotMatch(code(file), /AsyncStorage|SecureStore|expo-file-system|fetch\(|XMLHttpRequest|console\.|Sentry|setParams|prefill/u, file);
  }
  // 앱의 쓰기 길은 경계 한 곳뿐이다. 화면은 붙여 넣은 글을 그 길에 넘기지 않는다.
  assert.doesNotMatch(code("src/components/invitationLive/VendorReplyPaste.tsx"), /onAdd\([^)]*raw/u);
});
