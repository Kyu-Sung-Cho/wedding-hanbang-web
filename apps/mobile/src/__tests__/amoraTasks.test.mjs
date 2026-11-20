/* global Response */
// 아모라가 맡은 일(D-84) 앱 쪽 헬퍼(`src/lib/amoraTasks.mjs`). 가짜 fetcher 로 무엇을 부르고 어떻게 읽는지 본다.
//
// 지키는 것:
//   1. 읽기는 공유 계약이 한다. 꺼졌거나 표가 없으면 홈은 아무것도 그리지 않는다.
//   2. 던지지 않는다. 닿지 않거나 서버가 오류로 답해도 실패로 돌려준다(홈과 대화가 깨지지 않는다).
//   3. 누르기는 POST 한 번이고, 서버 결과 이름을 계약의 문장으로 바꾸는 규칙은 지시서 그대로다.
//   4. 「다음에 할 일」 글은 라운지 「아모라에게 묻기」와 같은 한 칸으로, 고치지 않고 한 번만 건너간다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";
import { AMORA_TASK_COPY } from "@hanbang/shared/amora-tasks";
import {
  AMORA_TASK_ACTIONS,
  AMORA_TASK_DETAIL_POLL_MS,
  AMORA_TASK_HOME_LIMIT,
  AMORA_TASK_HOME_POLL_MS,
  amoraTaskApiPath,
  amoraTaskGateReply,
  amoraTaskOfferPhase,
  amoraTaskOfferPhaseCopyKey,
  amoraTaskStartFailureCopyKey,
  amoraTaskStartOutcome,
  fetchAmoraTaskDetail,
  fetchAmoraTaskList,
  hasWorkingAmoraTask,
  homeAmoraTasks,
  isAmoraTaskWorking,
  postAmoraTaskAction,
} from "../lib/amoraTasks.mjs";

const TASK_A = "3f2b8c1e-5d4a-4b6c-9e8f-1a2b3c4d5e6f";
const TASK_B = "7a1c2e3f-4b5d-4e6f-8a9b-0c1d2e3f4a5b";
const TASK_C = "9b8a7c6d-5e4f-4a3b-a2c1-d0e9f8a7b6c5";

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** 부른 주소와 init 을 적어 두고 준비한 답을 차례로 돌려준다. Error 를 넣으면 그 자리에서 던진다(닿지 않음). */
function fakeFetcher(responses) {
  const calls = [];
  const queue = [...responses];
  const fetcher = async (path, init) => {
    calls.push({ path, init });
    const next = queue.shift();
    if (next instanceof Error) throw next;
    assert.ok(next, `준비하지 않은 요청: ${path}`);
    return next;
  };
  return { fetcher, calls };
}

const summary = (overrides = {}) => ({
  id: TASK_A,
  kind: "hall_candidates",
  title: "성수 웨딩홀 후보 찾기",
  status: "searching",
  reviewReason: null,
  createdAt: "2026-11-20T01:00:00.000Z",
  startedAt: "2026-11-20T01:01:00.000Z",
  finishedAt: null,
  updatedAt: "2026-11-20T01:02:00.000Z",
  ...overrides,
});

const detailBody = (taskOverrides = {}) => ({
  enabled: true,
  available: true,
  task: {
    ...summary({ status: "needs_review", reviewReason: "daily_search_limit" }),
    offerExpiresAt: "2026-11-21T01:00:00.000Z",
    steps: [{ label: "맡았어요", at: "2026-11-20T01:01:00.000Z" }],
    result: {
      summary: "성수 근처 두 곳을 같은 기준으로 모았어요.",
      columns: ["이름", "식대", "확인한 곳"],
      rows: [{ cells: ["가 홀", "업체 확인 필요", "example.com"], sourceIds: ["s1"] }],
      sources: [{ id: "s1", title: "가 홀 안내", url: "https://example.com/a", checkedOn: "2026-11-19" }],
      nextActions: [{ label: "가 홀에 물어보기", prompt: "가 홀에 12월 토요일 점심 상담이 되는지 물어볼 글 써 줘" }],
    },
    ...taskOverrides,
  },
});

/* ─────────────────────────────────────────────
   1. 목록
   ───────────────────────────────────────────── */

test("the home list asks GET /api/amora/tasks and reads it through the shared contract", async () => {
  const { fetcher, calls } = fakeFetcher([
    json(200, {
      enabled: true,
      available: true,
      tasks: [summary(), summary({ id: TASK_B, status: "queued" }), summary({ id: TASK_C, status: "offered" }), { id: "nope" }],
    }),
  ]);
  const read = await fetchAmoraTaskList(fetcher);
  assert.deepEqual(calls.map((call) => [call.path, call.init.method]), [["/api/amora/tasks", "GET"]]);
  assert.equal(read.ok, true);
  assert.equal(read.list.visible, true);
  // 카드만 나온 일(offered)과 모양이 틀린 줄은 홈에 없다. 대기 중(queued)은 "찾는 중"이다.
  assert.deepEqual(read.list.tasks.map((task) => [task.id, task.stage]), [[TASK_A, "searching"], [TASK_B, "searching"]]);
});

test("a switched-off or not-yet-migrated server makes the home draw nothing", async () => {
  for (const response of [
    json(200, { enabled: false, available: false, tasks: [] }),
    json(200, { enabled: true, available: false, tasks: [] }),
    json(200, { enabled: true, available: true }),
    json(200, null),
    new Response("not json", { status: 200 }),
  ]) {
    const { fetcher } = fakeFetcher([response]);
    const read = await fetchAmoraTaskList(fetcher);
    assert.equal(read.ok, true);
    assert.deepEqual(homeAmoraTasks(read.list), []);
    assert.equal(hasWorkingAmoraTask(read.list), false);
  }
});

test("an unreachable or failing list comes back as a failure instead of throwing", async () => {
  for (const response of [
    new Error("Network request failed"),
    new Error("API_SESSION_OWNER_MISMATCH"),
    json(401, { error: "인증이 필요합니다.", code: "AMORA_TASKS_AUTH_REQUIRED" }),
    json(503, { error: "맡은 일을 불러오지 못했어요.", code: "AMORA_TASKS_LIST_FAILED" }),
    new Response("<html>", { status: 502 }),
  ]) {
    const { fetcher } = fakeFetcher([response]);
    const read = await fetchAmoraTaskList(fetcher);
    assert.equal(read.ok, false);
  }
});

test("the home shows at most three tasks and polls only while one is searching or organizing", () => {
  const tasks = ["searching", "organizing", "needs_review", "done", "searching"].map((stage, index) => ({ id: `${index}`, stage }));
  assert.equal(AMORA_TASK_HOME_LIMIT, 3);
  assert.deepEqual(homeAmoraTasks({ visible: true, tasks }).map((task) => task.id), ["0", "1", "2"]);
  assert.deepEqual(homeAmoraTasks({ visible: false, tasks }), []);

  assert.equal(hasWorkingAmoraTask({ visible: true, tasks: [{ stage: "done" }, { stage: "needs_review" }] }), false);
  assert.equal(hasWorkingAmoraTask({ visible: true, tasks: [{ stage: "done" }, { stage: "organizing" }] }), true);
  // 홈에 안 보이는 넷째 줄이 일하는 중이어도 다시 읽는다. 끝나면 줄 순서가 바뀔 수 있다.
  const fourthWorking = [{ stage: "done" }, { stage: "done" }, { stage: "needs_review" }, { stage: "searching" }];
  assert.equal(hasWorkingAmoraTask({ visible: true, tasks: fourthWorking }), true);
  assert.equal(hasWorkingAmoraTask({ visible: false, tasks: fourthWorking }), false);

  for (const stage of ["searching", "organizing"]) assert.equal(isAmoraTaskWorking(stage), true, stage);
  for (const stage of ["needs_review", "done", "queued", null, undefined]) assert.equal(isAmoraTaskWorking(stage), false, String(stage));
  assert.equal(AMORA_TASK_HOME_POLL_MS, 30_000);
  assert.equal(AMORA_TASK_DETAIL_POLL_MS, 15_000);
});

/* ─────────────────────────────────────────────
   2. 하나
   ───────────────────────────────────────────── */

test("task paths take only a task id and lower-case it", () => {
  assert.equal(amoraTaskApiPath(TASK_A.toUpperCase()), `/api/amora/tasks/${TASK_A}`);
  for (const bad of ["", "../tasks", `${TASK_A}/x`, `${TASK_A}?a=1`, "00000000-0000-0000-0000-000000000000", null, undefined, 42, {}]) {
    assert.equal(amoraTaskApiPath(bad), null, String(bad));
  }
});

test("the result screen reads one task and tells ready, off, missing and failed apart", async () => {
  const ready = fakeFetcher([json(200, detailBody())]);
  const read = await fetchAmoraTaskDetail(ready.fetcher, TASK_A.toUpperCase());
  assert.deepEqual(ready.calls.map((call) => [call.path, call.init.method]), [[`/api/amora/tasks/${TASK_A}`, "GET"]]);
  assert.equal(read.kind, "ready");
  assert.equal(read.detail.stage, "needs_review");
  assert.equal(read.detail.resumable, true);
  assert.equal(read.detail.cancellable, true);
  assert.deepEqual(read.detail.result.rows, [{ cells: ["가 홀", "업체 확인 필요", "example.com"], sourceIds: ["s1"] }]);
  assert.deepEqual(read.detail.result.nextActions, [
    { label: "가 홀에 물어보기", prompt: "가 홀에 12월 토요일 점심 상담이 되는지 물어볼 글 써 줘" },
  ]);

  for (const body of [{ enabled: false, available: false, tasks: [] }, { enabled: true, available: false, tasks: [] }]) {
    const off = fakeFetcher([json(200, body)]);
    assert.deepEqual(await fetchAmoraTaskDetail(off.fetcher, TASK_A), { kind: "off" });
  }

  const missing = fakeFetcher([json(404, { error: "맡은 일을 찾지 못했어요.", code: "AMORA_TASK_NOT_FOUND" })]);
  assert.deepEqual(await fetchAmoraTaskDetail(missing.fetcher, TASK_A), { kind: "not_found" });

  for (const response of [
    new Error("Network request failed"),
    json(401, { error: "인증이 필요합니다.", code: "AMORA_TASKS_AUTH_REQUIRED" }),
    json(503, { error: "맡은 일을 불러오지 못했어요.", code: "AMORA_TASK_READ_FAILED" }),
    json(200, { enabled: true, available: true, task: { id: TASK_A } }),
    // 다른 일의 답은 그리지 않는다.
    json(200, detailBody({ id: TASK_B })),
  ]) {
    const failing = fakeFetcher([response]);
    assert.equal((await fetchAmoraTaskDetail(failing.fetcher, TASK_A)).kind, "failed");
  }

  // 모양이 틀린 번호는 보내지 않는다.
  const unsent = fakeFetcher([]);
  assert.deepEqual(await fetchAmoraTaskDetail(unsent.fetcher, "../tasks"), { kind: "not_found" });
  assert.equal(unsent.calls.length, 0);
});

/* ─────────────────────────────────────────────
   3. 누르기
   ───────────────────────────────────────────── */

test("a button sends exactly one POST with its action and reads the server's result", async () => {
  const started = fakeFetcher([json(200, { ok: true, code: "started", status: "queued" })]);
  const result = await postAmoraTaskAction(started.fetcher, TASK_A.toUpperCase(), "start");
  assert.equal(started.calls.length, 1);
  assert.equal(started.calls[0].path, `/api/amora/tasks/${TASK_A}`);
  assert.equal(started.calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(started.calls[0].init.body), { action: "start" });
  assert.deepEqual(result, { ok: true, off: false, code: "started", status: "queued", reply: null, httpStatus: 200 });

  const cases = [
    [json(429, { ok: false, code: "daily_task_limit" }), { ok: false, off: false, code: "daily_task_limit", status: null, reply: null, httpStatus: 429 }],
    [json(409, { ok: false, code: "offer_expired", status: "expired" }), { ok: false, off: false, code: "offer_expired", status: "expired", reply: null, httpStatus: 409 }],
    // 문지기 문장은 받은 그대로 싣는다. 보일지는 amoraTaskGateReply 가 정한다.
    [json(409, { ok: false, code: "gate_blocked", reply: "서버 문장" }), { ok: false, off: false, code: "gate_blocked", status: null, reply: "서버 문장", httpStatus: 409 }],
    [json(409, { ok: false, code: "gate_blocked", reply: 42 }), { ok: false, off: false, code: "gate_blocked", status: null, reply: null, httpStatus: 409 }],
    // 라우트 오류 이름(대문자)은 결과 이름으로 읽지 않는다.
    [json(503, { error: "지금은 처리하지 못했어요.", code: "AMORA_TASK_ACTION_FAILED" }), { ok: false, off: false, code: null, status: null, reply: null, httpStatus: 503 }],
    // 서버가 모르는 상태를 먼저 보내도 받지 않는다.
    [json(200, { ok: true, code: "cancelled", status: "paused" }), { ok: true, off: false, code: "cancelled", status: null, reply: null, httpStatus: 200 }],
    [json(200, { enabled: false, available: false, tasks: [] }), { ok: false, off: true, code: null, status: null, reply: null, httpStatus: 200 }],
    [new Error("Network request failed"), { ok: false, off: false, code: null, status: null, reply: null, httpStatus: 0 }],
  ];
  for (const [response, expected] of cases) {
    const { fetcher } = fakeFetcher([response]);
    assert.deepEqual(await postAmoraTaskAction(fetcher, TASK_A, "cancel"), expected);
  }

  // 정해진 세 가지 밖의 누르기와 모양이 틀린 번호는 보내지 않는다.
  assert.deepEqual(AMORA_TASK_ACTIONS, ["start", "cancel", "resume"]);
  const unsent = fakeFetcher([]);
  for (const [taskId, action] of [[TASK_A, "delete"], [TASK_A, ""], [TASK_A, null], ["nope", "start"]]) {
    assert.equal((await postAmoraTaskAction(unsent.fetcher, taskId, action)).ok, false);
  }
  assert.equal(unsent.calls.length, 0);
});

test("start failures map to the contract's sentences exactly as the spec says", () => {
  assert.equal(amoraTaskStartFailureCopyKey("daily_task_limit"), "dailyTaskLimit");
  assert.equal(amoraTaskStartFailureCopyKey("offer_expired"), "offerExpired");
  assert.equal(amoraTaskStartFailureCopyKey("offer_closed"), "offerExpired");
  assert.equal(amoraTaskStartFailureCopyKey("gate_blocked"), "offerUnavailable");
  for (const other of ["not_found", "deletion_pending", "AMORA_TASK_ACTION_FAILED", null, undefined]) {
    assert.equal(amoraTaskStartFailureCopyKey(other), "startFailed", String(other));
  }
  for (const key of ["dailyTaskLimit", "offerExpired", "offerUnavailable", "startFailed"]) {
    assert.equal(typeof AMORA_TASK_COPY[key], "string", key);
  }
});

test("after 맡기기 the card shows progress or a closed card, and keeps the button only for a retryable failure", () => {
  const result = (overrides) => ({ ok: false, off: false, code: null, status: null, httpStatus: 0, ...overrides });
  assert.deepEqual(amoraTaskStartOutcome(result({ ok: true, code: "started", status: "queued", httpStatus: 200 })), { phase: "started", retry: false });
  // 두 사람 중 한 사람이 먼저 눌렀다.
  assert.deepEqual(amoraTaskStartOutcome(result({ ok: true, code: "already_started", status: "searching", httpStatus: 200 })), { phase: "started", retry: false });
  assert.deepEqual(amoraTaskStartOutcome(result({ code: "daily_task_limit", httpStatus: 429 })), { phase: "limit", retry: false });
  assert.deepEqual(amoraTaskStartOutcome(result({ code: "offer_expired", httpStatus: 409 })), { phase: "expired", retry: false });
  assert.deepEqual(amoraTaskStartOutcome(result({ code: "offer_closed", httpStatus: 409 })), { phase: "expired", retry: false });
  assert.deepEqual(amoraTaskStartOutcome(result({ code: "gate_blocked", httpStatus: 409 })), { phase: "unavailable", retry: false });
  assert.deepEqual(amoraTaskStartOutcome(result({ code: "not_found", httpStatus: 404 })), { phase: "open", retry: true });
  assert.deepEqual(amoraTaskStartOutcome(result({})), { phase: "open", retry: true });
  assert.deepEqual(amoraTaskStartOutcome(result({ off: true, httpStatus: 200 })), { phase: "off", retry: false });
});

// 문지기 담당 규칙: verdict 가 allow 가 아니면 맡은 일을 만들지 않고 reply 를 그대로 보인다.
const GATE_SENTENCE = "결혼 준비와 관련된 일만 맡을 수 있어요. 결혼 준비 이야기라면 언제든 불러 주세요.";
// 보이지 않거나 줄·글 방향을 바꾸는 문자. 소스에 그대로 적지 않고 번호로 만든다.
const NEWLINE = String.fromCodePoint(0x0a); // Cc
const NUL = String.fromCodePoint(0x00); // Cc
const ZERO_WIDTH_SPACE = String.fromCodePoint(0x200b); // Cf
const RIGHT_TO_LEFT_OVERRIDE = String.fromCodePoint(0x202e); // Cf
const LINE_SEPARATOR = String.fromCodePoint(0x2028); // Zl
const PARAGRAPH_SEPARATOR = String.fromCodePoint(0x2029); // Zp

/** 맡기기를 눌렀더니 문지기가 막았다(409 `gate_blocked`). `reply` 가 undefined 면 본문에 그 칸을 두지 않는다. */
async function startBlockedByGate(reply) {
  const body = reply === undefined ? { ok: false, code: "gate_blocked" } : { ok: false, code: "gate_blocked", reply };
  const { fetcher, calls } = fakeFetcher([json(409, body)]);
  const result = await postAmoraTaskAction(fetcher, TASK_A, "start");
  assert.equal(calls.length, 1);
  // 맡지 않았고, 카드는 단추 없이 맡을 수 없는 모습이다.
  assert.deepEqual(amoraTaskStartOutcome(result), { phase: "unavailable", retry: false });
  return result;
}

test("a gate-blocked start shows the gate's sentence exactly as the server sent it", async () => {
  for (const reply of [GATE_SENTENCE, `  ${GATE_SENTENCE}  `, "가".repeat(300)]) {
    assert.equal(amoraTaskGateReply(await startBlockedByGate(reply)), reply, reply.slice(0, 20));
  }
});

test("a gate-blocked start without a usable sentence falls back to offerUnavailable", async () => {
  for (const reply of [null, undefined, "", "   ", 42, { text: GATE_SENTENCE }, [GATE_SENTENCE]]) {
    const result = await startBlockedByGate(reply);
    assert.equal(amoraTaskGateReply(result), null, String(JSON.stringify(reply)));
    // 그때 카드가 쓰는 한 줄은 계약 문장이다.
    assert.equal(amoraTaskOfferPhaseCopyKey(amoraTaskStartOutcome(result).phase), "offerUnavailable");
  }
});

test("a gate sentence over 300 characters or with control or format characters is not shown", async () => {
  for (const [name, reply] of [
    ["301 characters", "가".repeat(301)],
    ["newline (Cc)", `${GATE_SENTENCE}${NEWLINE}${GATE_SENTENCE}`],
    ["NUL (Cc)", `${GATE_SENTENCE}${NUL}`],
    ["zero-width space (Cf)", `결혼${ZERO_WIDTH_SPACE}준비 밖의 일이에요.`],
    ["right-to-left override (Cf)", `${RIGHT_TO_LEFT_OVERRIDE}${GATE_SENTENCE}`],
    ["line separator (Zl)", `${GATE_SENTENCE}${LINE_SEPARATOR}`],
    ["paragraph separator (Zp)", `${GATE_SENTENCE}${PARAGRAPH_SEPARATOR}`],
  ]) {
    assert.equal(amoraTaskGateReply(await startBlockedByGate(reply)), null, name);
  }
});

test("only a gate-blocked result hands a sentence to the card", () => {
  for (const code of ["started", "already_started", "daily_task_limit", "offer_expired", "offer_closed", "not_found", null]) {
    assert.equal(amoraTaskGateReply({ code, reply: GATE_SENTENCE }), null, String(code));
  }
  assert.equal(amoraTaskGateReply({ code: "gate_blocked", reply: GATE_SENTENCE }), GATE_SENTENCE);
});

test("the chat card shows the task's current state when drawn and falls back to the card's own deadline", () => {
  const now = Date.parse("2026-11-20T03:00:00.000Z");
  const open = { offerExpiresAt: "2026-11-21T03:00:00.000Z" };
  const lapsed = { offerExpiresAt: "2026-11-20T02:59:59.000Z" };
  const ready = (status) => ({ kind: "ready", detail: { status } });

  assert.equal(amoraTaskOfferPhase(open, ready("offered"), now), "open");
  assert.equal(amoraTaskOfferPhase(lapsed, ready("offered"), now), "expired");
  for (const status of ["queued", "searching", "organizing", "needs_review", "done"]) {
    assert.equal(amoraTaskOfferPhase(open, ready(status), now), "started", status);
  }
  assert.equal(amoraTaskOfferPhase(open, ready("cancelled"), now), "cancelled");
  assert.equal(amoraTaskOfferPhase(open, ready("expired"), now), "expired");
  assert.equal(amoraTaskOfferPhase(open, { kind: "off" }, now), "off");
  assert.equal(amoraTaskOfferPhase(open, { kind: "not_found" }, now), "unavailable");
  // 못 읽었으면 카드에 적힌 마감 시각만 본다. 단추를 눌러도 서버가 지금 상태로 답한다.
  assert.equal(amoraTaskOfferPhase(open, { kind: "failed", status: 0 }, now), "open");
  assert.equal(amoraTaskOfferPhase(lapsed, { kind: "failed", status: 503 }, now), "expired");
  assert.equal(amoraTaskOfferPhase({ offerExpiresAt: null }, { kind: "failed", status: 0 }, now), "open");
});

test("each closed card shape says one contract sentence, and the open card says none of them", () => {
  assert.equal(amoraTaskOfferPhaseCopyKey("open"), null);
  assert.equal(amoraTaskOfferPhaseCopyKey("off"), null);
  const expected = {
    started: "offerStarted",
    cancelled: "cancelled",
    expired: "offerExpired",
    unavailable: "offerUnavailable",
    limit: "dailyTaskLimit",
  };
  for (const [phase, key] of Object.entries(expected)) {
    assert.equal(amoraTaskOfferPhaseCopyKey(phase), key, phase);
    assert.equal(typeof AMORA_TASK_COPY[key], "string", key);
  }
});

/* ─────────────────────────────────────────────
   4. 「다음에 할 일」 글 건네기(라운지 「아모라에게 묻기」와 같은 한 칸)
   ───────────────────────────────────────────── */

const readLib = (relative) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

function compile(source, modules = {}) {
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const module = { exports: {} };
  new Function("exports", "module", "require", outputText)(module.exports, module, (specifier) => {
    if (Object.hasOwn(modules, specifier)) return modules[specifier];
    throw new Error(`unexpected dependency ${specifier}`);
  });
  return module.exports;
}

const entry = compile(readLib("../lib/amoraChatEntry.ts"));
// 모듈 안에 건넬 글 한 칸이 있어서, 시험마다 새로 올려 서로 섞이지 않게 한다.
const freshAsk = () => compile(readLib("../lib/loungeAmoraAsk.ts"), { "./amoraChatEntry": entry });

test("a next step's text reaches the chat input unchanged, once, for the same person, by number only", () => {
  const ask = freshAsk();
  const prompt = "가 홀에 12월 토요일 점심 상담이 되는지 물어볼 글 써 줘";
  const id = ask.stageLoungeAmoraAskText({ ownerId: "user-a", text: `  ${prompt}  ` });
  assert.equal(typeof id, "number");
  // 주소에는 번호와 진입구 이름만 실린다(서버가 쓴 글이 이동 기록에 남지 않는다).
  const href = ask.buildLoungeAmoraAskHref(id);
  assert.match(href, /^\/\(tabs\)\/chat\?entry=lounge_task&ask=[1-9]\d*$/u);
  assert.equal(ask.takeLoungeAmoraAsk({ ownerId: "user-a", id }), prompt);
  assert.equal(ask.takeLoungeAmoraAsk({ ownerId: "user-a", id }), null, "두 번 받지 않는다");

  const other = ask.stageLoungeAmoraAskText({ ownerId: "user-a", text: prompt });
  assert.equal(ask.takeLoungeAmoraAsk({ ownerId: "user-b", id: other }), null, "다른 사람의 입력칸에 들어가지 않는다");

  for (const bad of [{ ownerId: "", text: prompt }, { ownerId: "user-a", text: "   " }, { ownerId: "user-a", text: 42 }]) {
    assert.equal(ask.stageLoungeAmoraAskText(bad), null, JSON.stringify(bad));
  }
  const long = ask.stageLoungeAmoraAskText({ ownerId: "user-a", text: "가".repeat(3000) });
  assert.equal(ask.takeLoungeAmoraAsk({ ownerId: "user-a", id: long }).length, ask.LOUNGE_AMORA_ASK_MAX_LENGTH);

  // 라운지 할 일 질문과 같은 한 칸이다. 연달아 건네면 마지막 것만 남는다.
  const first = ask.stageLoungeAmoraAskText({ ownerId: "user-a", text: prompt });
  const second = ask.stageLoungeAmoraAsk({ ownerId: "user-a", task: { kind: "checklist", categoryLabel: "웨딩홀" } });
  assert.ok(second > first);
  assert.equal(ask.takeLoungeAmoraAsk({ ownerId: "user-a", id: first }), null);
  assert.equal(ask.takeLoungeAmoraAsk({ ownerId: "user-a", id: second }), "웨딩홀 준비, 지금 뭐부터 하면 될까?");
});
