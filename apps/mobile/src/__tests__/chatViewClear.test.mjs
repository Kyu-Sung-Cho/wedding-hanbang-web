import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

/* global Response, setTimeout, clearTimeout */

/**
 * 「대화 화면 정리」와 비공개 대화 삭제 — 앱 쪽 계약 (2026-09-18).
 *
 * 앱에는 `DELETE /api/chat/messages` 를 부르는 곳이 없었다. 개인정보처리방침은 비공개 대화 삭제를 약속하는데
 * 그 길이 웹에만 있었다. 앱이 웹 창과 **같은 단계·같은 문구**로 그 길을 낸다.
 *
 * 지키는 것:
 * - 창 문구는 웹 `ChatContent.tsx` 의 창과 글자 그대로 같다(웹 파일을 읽어 JSX 가 실제로 그리는 글자로 대조한다).
 * - 앱이 보내는 모드는 서버(`messages/route.ts`)가 받는 모드 안에 있고, `delete_shared` 는 앱 어디에서도 보내지 않는다.
 * - 서버가 확인해 준 것만 성공이다. 실패는 상태 코드별 앱 문구이고 서버 문장은 그리지 않는다.
 * - 정리 뒤 세션을 다시 불러와도 같은 사람·커플이면 있던 범위와 초안을 되돌린다 — 실시간 이벤트가 응답보다
 *   먼저 와서 세션을 리셋해도 그렇다. 계정·커플이 바뀌었으면 되돌리지 않는다.
 */
function compile(relative, deps = {}) {
  const path = fileURLToPath(new URL(relative, import.meta.url));
  const compiled = ts.transpileModule(readFileSync(path, "utf8"), {
    fileName: "module.ts",
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  });
  const module = { exports: {} };
  new Function("exports", "module", "require", compiled.outputText)(module.exports, module, (specifier) => {
    if (Object.hasOwn(deps, specifier)) return deps[specifier];
    throw new Error(`unmocked dependency: ${specifier}`);
  });
  return module.exports;
}
const read = (relative) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const timestamp = compile("../../../../packages/shared/src/utils/chatTimestamp.ts");
const clearRequest = compile("../lib/chatClearRequest.ts");
const lib = compile("../lib/chatViewClear.ts", {
  "@hanbang/shared": timestamp,
  "@/lib/chatClearRequest": clearRequest,
});
const COPY = lib.CHAT_VIEW_CLEAR_COPY;

const webChat = read("../../../web/src/components/app/chat/ChatContent.tsx");
const messagesRoute = read("../../../web/src/app/api/chat/messages/route.ts");
const clearRequestRoute = read("../../../web/src/app/api/chat/clear-request/route.ts");

// ── 웹 창이 실제로 그리는 글자 ────────────────────────────────────────
// JSX 는 줄바꿈과 들여쓰기를 한 칸으로 접는다(Babel `cleanJSXElementLiteralChild` 와 같은 규칙).
// 소스 글자를 그대로 비교하면 줄을 어디서 끊었는지에 따라 거짓으로 갈린다.
function jsxText(raw) {
  const lines = raw.split(/\r\n|\n|\r/);
  let lastNonEmpty = 0;
  lines.forEach((line, index) => { if (/[^ \t]/.test(line)) lastNonEmpty = index; });
  let out = "";
  lines.forEach((line, index) => {
    let trimmed = line.replace(/\t/g, " ");
    if (index !== 0) trimmed = trimmed.replace(/^[ ]+/, "");
    if (index !== lines.length - 1) trimmed = trimmed.replace(/[ ]+$/, "");
    if (!trimmed) return;
    out += index === lastNonEmpty ? trimmed : `${trimmed} `;
  });
  return out;
}
function renderedText(node) {
  if (ts.isJsxText(node)) return jsxText(node.text);
  if (ts.isJsxSelfClosingElement(node)) return node.tagName.getText() === "br" ? "\n" : "";
  if (ts.isJsxExpression(node)) return node.expression && ts.isStringLiteral(node.expression) ? node.expression.text : "";
  if (ts.isJsxElement(node) || ts.isJsxFragment(node)) return node.children.map(renderedText).join("");
  return "";
}
const webDialog = (() => {
  const start = webChat.indexOf('{clearStep !== "closed" && (');
  const end = webChat.indexOf("{/* 채팅 영역", start);
  assert.ok(start > 0 && end > start, "웹 채팅의 화면 정리 창을 찾지 못했다");
  const tree = ts.createSourceFile("ChatContent.tsx", webChat, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const texts = new Set();
  (function visit(node) {
    if (ts.isJsxElement(node) && node.getStart(tree) >= start && node.end <= end) texts.add(renderedText(node).trim());
    ts.forEachChild(node, visit);
  })(tree);
  return { texts, block: webChat.slice(start, end) };
})();

test("함께 대화 창의 제목·소개·두 선택지·취소는 웹 창과 글자 그대로 같다", () => {
  const shared = COPY.shared;
  for (const text of [shared.title, shared.ownTitle, shared.ownDescription, shared.bothTitle, COPY.cancel]) {
    assert.ok(webDialog.texts.has(text), `웹 창에 없는 문구: ${text}`);
  }
  // 소개 문단은 줄바꿈 아래 작은 글씨 한 줄을 단다 — 앱도 두 줄로 나눠 그린다.
  assert.ok(webDialog.texts.has(`${shared.intro}\n${shared.introNote}`), "함께 대화 소개 문단이 웹과 다르다");
  const both = shared.bothDescription;
  assert.ok(webDialog.texts.has(`${both.before}${both.strong}${both.after}`), "「둘 다」 설명이 웹과 다르다");
  assert.ok(webDialog.block.includes(`<strong>${both.strong}</strong>`), "웹이 굵게 쓰는 자리가 앱과 다르다");
});

test("동의 요청 확인 단계는 웹과 같은 제목·설명·버튼을 쓴다", () => {
  const step = COPY.sharedBoth;
  assert.ok(webDialog.texts.has(step.title));
  assert.ok(webDialog.texts.has(`${step.body}\n${step.note}`), "동의 요청 설명이 웹과 다르다");
  assert.ok(webDialog.texts.has(step.back));
  assert.ok(
    webDialog.block.includes(`{clearRequestPending ? "${step.submitting}" : "${step.submit}"}`),
    "보내는 중·보내기 버튼 글자가 웹과 다르다",
  );
  // 웹 창이 요청 실패에 쓰는 문장과 앱의 서버 오류 문구가 같다.
  assert.ok(webChat.includes(`"${lib.SHARED_CHAT_CLEAR_REQUEST_FAILURE.server}"`));
});

test("비공개 상담 창과 삭제 경고는 웹 창과 글자 그대로 같다", () => {
  const privateCopy = COPY.private;
  for (const text of [privateCopy.title, privateCopy.ownTitle, privateCopy.ownDescription, privateCopy.deleteTitle, privateCopy.deleteDescription]) {
    assert.ok(webDialog.texts.has(text), `웹 창에 없는 문구: ${text}`);
  }
  assert.ok(webDialog.texts.has(`${privateCopy.intro}\n${privateCopy.introNote}`), "비공개 소개 문단이 웹과 다르다");
  // 무엇이 지워지고 무엇이 남는지 — 누르기 전에 다 읽혀야 하는 세 가지.
  for (const part of ["아모라가 만든 요약·기억을 삭제", "이 비공개 대화에서 저장한 개인 할 일도 함께 삭제됩니다.", "법적/보안 로그·백업"]) {
    assert.ok(privateCopy.deleteDescription.includes(part), part);
  }
  // 머리 버튼의 읽어 주는 이름도 웹 버튼과 같다.
  assert.ok(webChat.includes(`aria-label="${COPY.entryLabel}"`));
});

test("앱에만 있는 말(대기 중 안내·두 번째 확인·실패 문구)은 모두 해요체로 끝난다", () => {
  const appOnly = [
    COPY.shared.bothPendingReason,
    COPY.deleteConfirm.title,
    COPY.deleteConfirm.message,
    ...Object.values(lib.CHAT_VIEW_CLEAR_FAILURE),
    ...Object.values(lib.SHARED_CHAT_CLEAR_REQUEST_FAILURE),
  ];
  for (const text of appOnly) assert.match(text, /요[.?]$/u, text);
  assert.equal(COPY.deleteConfirm.cancel, "취소");
  assert.equal(COPY.deleteConfirm.confirm, "삭제");
});

// ── 모드: 서버가 받는 것 안에서만, delete_shared 는 없이 ───────────────────
test("앱이 보내는 세 모드는 서버가 받는 모드 안에 있고 delete_shared 는 없다", () => {
  const declaration = messagesRoute.match(/type ClearMode =([\s\S]*?);/)?.[1];
  assert.ok(declaration, "서버의 ClearMode 선언을 찾지 못했다");
  const serverModes = [...declaration.matchAll(/"([a-z_]+)"/g)].map((match) => match[1]);
  assert.ok(serverModes.includes("delete_shared"), "서버 선언을 제대로 읽었는지 — delete_shared 는 서버에 있다");
  assert.deepEqual([...lib.CHAT_VIEW_CLEAR_MODES].sort(), ["delete_private", "view_reset_private", "view_reset_shared"]);
  for (const mode of lib.CHAT_VIEW_CLEAR_MODES) assert.ok(serverModes.includes(mode), `서버가 받지 않는 모드: ${mode}`);
  assert.ok(!lib.CHAT_VIEW_CLEAR_MODES.includes("delete_shared"));
  // 서버가 앱이 기대하는 성공 응답(같은 모드·정리 시점)을 실제로 돌려주는지.
  assert.match(messagesRoute, /mode === "delete_private"[\s\S]*success: true,\s*mode,[\s\S]*clearedAt: data\.cleared_at/);
  assert.match(messagesRoute, /mode === "view_reset_shared" \|\| mode === "view_reset_private"[\s\S]*\{ success: true, mode, clearedAt: data\.clearedAt \}/);
  assert.match(clearRequestRoute, /status: "pending"/);
  assert.match(clearRequestRoute, /NextResponse\.json\(\{ success: true, message: inserted \}\)/);
});

test("앱 소스 어디에도 delete_shared 를 보내는 코드가 없다", () => {
  const mobileRoot = fileURLToPath(new URL("../../", import.meta.url));
  const files = [];
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === "__tests__" || name.startsWith(".")) continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|tsx|mjs|js)$/.test(name)) files.push(path);
    }
  })(join(mobileRoot, "app"));
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      if (name === "__tests__") continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|tsx|mjs|js)$/.test(name)) files.push(path);
    }
  })(join(mobileRoot, "src"));
  assert.ok(files.some((path) => path.endsWith("chatViewClear.ts")), "앱 소스를 제대로 훑었는지");
  const offenders = [];
  for (const path of files) {
    const source = readFileSync(path, "utf8");
    if (!source.includes("delete_shared")) continue;
    // 주석(이유를 적은 기록)은 빼고 코드의 문자열만 본다.
    const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    (function visit(node) {
      if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node))
        && node.text.includes("delete_shared")) offenders.push(path);
      ts.forEachChild(node, visit);
    })(tree);
  }
  assert.deepEqual(offenders, []);
});

// ── 요청과 응답 ─────────────────────────────────────────────────────
const coupleId = "44444444-4444-4444-8444-444444444444";
const requester = "11111111-1111-4111-8111-111111111111";
const partner = "22222222-2222-4222-8222-222222222222";
const clearedAt = "2026-09-18T01:00:00.123456+00:00";

function reply(status, body, calls = []) {
  return async (path, init) => {
    calls.push({ path, init });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  };
}

test("정리는 정해진 주소로 coupleId·mode 만 보내고, 서버가 같은 모드와 정리 시점을 확인해 줘야 성공이다", async () => {
  for (const mode of lib.CHAT_VIEW_CLEAR_MODES) {
    const calls = [];
    const result = await lib.requestChatViewClear(reply(200, { success: true, mode, clearedAt }, calls), coupleId, mode);
    assert.deepEqual(result, { ok: true, mode, clearedAt });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].path, "/api/chat/messages");
    assert.equal(calls[0].init.method, "DELETE");
    assert.deepEqual(JSON.parse(calls[0].init.body), { coupleId, mode });
    assert.ok(calls[0].init.signal, "시간 제한을 걸 수 있게 signal 을 넘긴다");
  }
  // 성공처럼 보여도 확인이 빠지면 실패다 — 시트를 열어 둔다.
  for (const body of [
    { success: true, mode: "view_reset_shared" },
    { success: true, mode: "view_reset_shared", clearedAt: "나중에" },
    { success: true, mode: "view_reset_shared", clearedAt: "2026-09-18" },
    // 시간대가 없으면 기기 현지 시각으로 읽혀 경계가 몇 시간씩 어긋난다.
    { success: true, mode: "view_reset_shared", clearedAt: "2026-09-18T01:00:00" },
    { success: true, mode: "view_reset_private", clearedAt },
    { success: false, mode: "view_reset_shared", clearedAt },
    { success: "true", mode: "view_reset_shared", clearedAt },
    "not json",
  ]) {
    const result = await lib.requestChatViewClear(reply(200, body), coupleId, "view_reset_shared");
    assert.equal(result.ok, false, JSON.stringify(body));
    assert.equal(result.error, lib.CHAT_VIEW_CLEAR_FAILURE.unconfirmed);
  }
  // 비공개 삭제의 성공 응답이 다른 모드를 말하면 삭제로 치지 않는다.
  assert.equal((await lib.requestChatViewClear(reply(200, { success: true, mode: "view_reset_private", clearedAt }), coupleId, "delete_private")).ok, false);
});

test("delete_shared 같은 목록 밖 모드는 요청을 보내지 않는다", async () => {
  const calls = [];
  const result = await lib.requestChatViewClear(reply(200, { success: true, mode: "delete_shared", clearedAt }, calls), coupleId, "delete_shared");
  assert.equal(result.ok, false);
  assert.equal(calls.length, 0);
});

test("정리 실패는 상태 코드별 앱 문구로 알리고 서버 문장은 그리지 않는다 — 5xx·연결 실패는 결과를 모르는 것이다", async () => {
  const expected = new Map([
    [401, [lib.CHAT_VIEW_CLEAR_FAILURE.unauthorized, "rejected"]],
    [403, [lib.CHAT_VIEW_CLEAR_FAILURE.forbidden, "rejected"]],
    [429, [lib.CHAT_VIEW_CLEAR_FAILURE.rateLimited, "rejected"]],
    [500, [lib.CHAT_VIEW_CLEAR_FAILURE.server, "unknown"]],
    [503, [lib.CHAT_VIEW_CLEAR_FAILURE.server, "unknown"]],
    [400, [lib.CHAT_VIEW_CLEAR_FAILURE.rejected, "rejected"]],
    [410, [lib.CHAT_VIEW_CLEAR_FAILURE.rejected, "rejected"]],
  ]);
  for (const [status, [error, outcome]] of expected) {
    const result = await lib.requestChatViewClear(reply(status, { error: "INTERNAL_DETAIL rpc stack", code: "X" }), coupleId, "delete_private");
    assert.deepEqual(result, { ok: false, error, outcome }, String(status));
  }
  const offline = await lib.requestChatViewClear(async () => { throw new Error("Network request failed"); }, coupleId, "delete_private");
  assert.deepEqual(offline, { ok: false, error: lib.CHAT_VIEW_CLEAR_FAILURE.network, outcome: "unknown" });
  const unconfirmed = await lib.requestChatViewClear(reply(200, {}), coupleId, "delete_private");
  assert.equal(unconfirmed.outcome, "unknown", "확인할 수 없는 성공 응답은 삭제됐는지 모르는 것이다");
  assert.doesNotMatch(lib.CHAT_VIEW_CLEAR_FAILURE.deleteUnknown, /삭제되지 않았/, "결과를 모를 때 지워지지 않았다고 단정하지 않는다");
});

test("응답이 오지 않으면 정해진 시간 뒤 연결 실패로 끝낸다", async () => {
  const hanging = (_path, init) => new Promise((resolve, reject) => {
    // 시간 제한이 동작하지 않으면 늦게라도 성공 응답이 와서 이 검사가 실패한다(멈춰 버리지 않는다).
    const late = setTimeout(() => resolve(new Response(JSON.stringify({ success: true, mode: "delete_private", clearedAt }), { status: 200 })), 1_000);
    init.signal?.addEventListener("abort", () => { clearTimeout(late); reject(new Error("aborted")); });
  });
  const result = await lib.requestChatViewClear(hanging, coupleId, "delete_private", { timeoutMs: 5 });
  assert.deepEqual(result, { ok: false, error: lib.CHAT_VIEW_CLEAR_FAILURE.network, outcome: "unknown" });
  const request = await lib.requestSharedChatClear(hanging, coupleId, requester, { timeoutMs: 5 });
  assert.deepEqual(request, { ok: false, error: lib.SHARED_CHAT_CLEAR_REQUEST_FAILURE.network });
});

const pendingCard = (overrides = {}) => ({
  id: "55555555-5555-4555-8555-555555555555",
  couple_id: coupleId,
  sender_id: requester,
  sender_type: "bride",
  role: "user",
  content: "함께 대화를 새로 시작하자고 제안했어요. 동의하면 양쪽 화면이 깨끗하게 정리돼요.",
  visibility: "shared",
  created_at: "2026-09-18T01:00:00.000000+00:00",
  metadata: { clearRequest: { type: "shared", requestedBy: requester, requestedByRole: "bride", requestedAt: "2026-09-18T01:00:00.000Z", status: "pending" } },
  ...overrides,
});

test("동의 요청은 action·coupleId 만 보내고, 돌려받은 메시지가 내가 보낸 대기 카드일 때만 성공이다", async () => {
  const calls = [];
  const message = pendingCard();
  const result = await lib.requestSharedChatClear(reply(200, { success: true, message }, calls), coupleId, requester);
  assert.deepEqual(result, { ok: true, message });
  assert.equal(calls[0].path, "/api/chat/clear-request");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].init.body), { action: "request", coupleId });

  for (const body of [
    { success: true },
    { success: false, message },
    { success: true, message: pendingCard({ metadata: { clearRequest: { ...message.metadata.clearRequest, status: "accepted" } } }) },
    { success: true, message: pendingCard({ metadata: null }) },
    { success: true, message: pendingCard({ couple_id: "66666666-6666-4666-8666-666666666666" }) },
    { success: true, message: pendingCard({ sender_id: partner, metadata: { clearRequest: { ...message.metadata.clearRequest, requestedBy: partner } } }) },
    { success: true, message: pendingCard({ visibility: "bride_private" }) },
  ]) {
    const failed = await lib.requestSharedChatClear(reply(200, body), coupleId, requester);
    assert.deepEqual(failed, { ok: false, error: lib.SHARED_CHAT_CLEAR_REQUEST_FAILURE.server }, JSON.stringify(body));
  }
});

test("동의 요청 실패도 상태 코드별 앱 문구다", async () => {
  const copy = lib.SHARED_CHAT_CLEAR_REQUEST_FAILURE;
  for (const [status, error] of [[401, copy.unauthorized], [403, copy.forbidden], [429, copy.rateLimited], [500, copy.server], [409, copy.rejected], [400, copy.rejected]]) {
    const result = await lib.requestSharedChatClear(reply(status, { error: "private-token@example.test" }), coupleId, requester);
    assert.deepEqual(result, { ok: false, error }, String(status));
  }
  const offline = await lib.requestSharedChatClear(async () => { throw new Error("Network request failed"); }, coupleId, requester);
  assert.deepEqual(offline, { ok: false, error: copy.network });
});

test("대기 카드 판정 — 어느 쪽이 보냈든 답이 없는 공유 요청이면 막는다", () => {
  assert.equal(lib.hasPendingSharedChatClearRequest([]), false);
  assert.equal(lib.hasPendingSharedChatClearRequest([pendingCard()]), true);
  const fromPartner = pendingCard({ sender_id: partner, metadata: { clearRequest: { ...pendingCard().metadata.clearRequest, requestedBy: partner } } });
  assert.equal(lib.hasPendingSharedChatClearRequest([fromPartner]), true);
  for (const status of ["accepted", "declined"]) {
    assert.equal(lib.hasPendingSharedChatClearRequest([pendingCard({ metadata: { clearRequest: { ...pendingCard().metadata.clearRequest, status } } })]), false, status);
  }
  assert.equal(lib.hasPendingSharedChatClearRequest([pendingCard({ visibility: "groom_private" })]), false);
  assert.equal(lib.hasPendingSharedChatClearRequest([{ sender_id: requester, visibility: "shared", metadata: null }]), false);
});

test("정리 직후 그 범위에서 정리 시점까지의 메시지만 곧바로 뺀다", () => {
  const rows = [
    { id: "old-shared", visibility: "shared", created_at: "2026-09-18T00:59:59.000Z" },
    { id: "same-microsecond", visibility: "shared", created_at: clearedAt },
    { id: "new-shared", visibility: "shared", created_at: "2026-09-18T01:00:00.123457+00:00" },
    { id: "private", visibility: "bride_private", created_at: "2026-09-18T00:00:00.000Z" },
    { id: "unsaved-shared", visibility: "shared" },
  ];
  assert.deepEqual(lib.removeMessagesClearedFromView(rows, "shared", clearedAt).map((row) => row.id), ["new-shared", "private"]);
  assert.deepEqual(lib.removeMessagesClearedFromView(rows, "bride_private", clearedAt).map((row) => row.id), ["old-shared", "same-microsecond", "new-shared", "unsaved-shared"]);
  assert.deepEqual(lib.removeMessagesClearedFromView(rows, null, clearedAt).map((row) => row.id), rows.map((row) => row.id));
});

// ── 이어받기(carry) ──────────────────────────────────────────────────
const drafts = { shared_ai: "함께 쓰던 질문", private_ai: "나만 쓰던 상담", shared_partner: "상대에게 쓰던 말" };
const loaded = (overrides = {}) => ({
  userId: requester,
  coupleId,
  cursors: { shared: null, private: null },
  canUsePrivate: true,
  hasLinkedPartner: true,
  ...overrides,
});
const arm = (overrides = {}) => lib.armChatViewClearCarry({ requestId: 7, userId: requester, coupleId, scope: "private", target: "ai", drafts, ...overrides });

test("응답보다 실시간 리셋이 먼저 와도 같은 범위·초안으로 돌아오고, 응답 뒤에는 붙잡지 않는다", () => {
  let carry = arm();
  // 실시간 프로필 UPDATE 가 먼저 세션을 리셋했다 — 새 경계를 읽은 불러오기가 끝난다.
  const first = lib.takeChatViewClearCarry(carry, loaded({ cursors: { shared: null, private: clearedAt } }));
  assert.deepEqual(first.restore, { scope: "private", target: "ai", drafts });
  assert.ok(first.keep, "응답이 오기 전에는 아직 붙잡는다");
  carry = first.keep;
  // 그다음 도착한 성공 응답: 이미 그 경계를 반영했으니 끝이다.
  assert.equal(lib.settleChatViewClearCarry(carry, 7, { clearedAt }), null);
});

test("성공 응답이 먼저면 경계를 반영한 불러오기가 올 때까지 붙잡고, 그 불러오기가 한 번 쓰고 비운다", () => {
  let carry = lib.settleChatViewClearCarry(arm(), 7, { clearedAt });
  assert.equal(carry.outcome, "confirmed");
  // 범위 재확인과 실시간 이벤트가 겹쳐 경계를 반영하기 전의 불러오기가 한 번 더 끝나도 잃지 않는다.
  const stale = lib.takeChatViewClearCarry(carry, loaded({ cursors: { shared: null, private: "2026-09-18T00:00:00.000Z" } }));
  assert.deepEqual(stale.restore, { scope: "private", target: "ai", drafts });
  assert.ok(stale.keep);
  carry = stale.keep;
  const fresh = lib.takeChatViewClearCarry(carry, loaded({ cursors: { shared: null, private: clearedAt } }));
  assert.deepEqual(fresh.restore, { scope: "private", target: "ai", drafts });
  assert.equal(fresh.keep, null);
  assert.deepEqual(lib.takeChatViewClearCarry(fresh.keep, loaded()), { restore: null, keep: null });
});

test("계정이나 커플이 바뀐 뒤의 불러오기는 되돌리지 않고 버린다", () => {
  const carry = lib.settleChatViewClearCarry(arm(), 7, { clearedAt });
  assert.deepEqual(lib.takeChatViewClearCarry(carry, loaded({ userId: partner })), { restore: null, keep: null });
  assert.deepEqual(lib.takeChatViewClearCarry(carry, loaded({ coupleId: "66666666-6666-4666-8666-666666666666" })), { restore: null, keep: null });
});

test("거절된 정리는 붙잡지 않고, 다른 요청의 결과는 이 carry 를 바꾸지 않는다", () => {
  assert.equal(lib.settleChatViewClearCarry(arm(), 7, "rejected"), null);
  const carry = arm();
  assert.equal(lib.settleChatViewClearCarry(carry, 8, "rejected"), carry);
  assert.equal(lib.settleChatViewClearCarry(null, 7, { clearedAt }), null);
});

test("결과를 모르는 정리는 다음 불러오기 한 번에만, 정해진 시간 안에만 쓴다", () => {
  const unknown = lib.settleChatViewClearCarry(arm(), 7, "unknown", 1_000);
  assert.equal(unknown.outcome, "unknown");
  const next = lib.takeChatViewClearCarry(unknown, loaded(), 1_000 + 5_000);
  assert.deepEqual(next.restore, { scope: "private", target: "ai", drafts });
  assert.equal(next.keep, null);
  const late = lib.takeChatViewClearCarry(unknown, loaded(), 1_000 + lib.CHAT_VIEW_CLEAR_UNKNOWN_CARRY_TTL_MS + 1);
  assert.deepEqual(late, { restore: null, keep: null });
  // 이미 적용한 불러오기가 있었으면 결과를 몰라도 더 붙잡지 않는다.
  const applied = lib.takeChatViewClearCarry(arm(), loaded()).keep;
  assert.equal(lib.settleChatViewClearCarry(applied, 7, "unknown"), null);
});

test("되돌릴 수 없는 자리로는 되돌리지 않는다 — 역할이 없으면 함께 대화, 상대 연결이 끊겼으면 아모라", () => {
  const privateCarry = arm();
  assert.equal(lib.takeChatViewClearCarry(privateCarry, loaded({ canUsePrivate: false })).restore.scope, "shared");
  const partnerCarry = arm({ scope: "shared", target: "partner" });
  assert.deepEqual(lib.takeChatViewClearCarry(partnerCarry, loaded()).restore, { scope: "shared", target: "partner", drafts });
  const unlinked = lib.takeChatViewClearCarry(partnerCarry, loaded({ hasLinkedPartner: false })).restore;
  assert.equal(unlinked.target, "ai");
  assert.equal(unlinked.drafts.shared_partner, "");
  assert.equal(unlinked.drafts.shared_ai, drafts.shared_ai);
  // 담을 때 초안을 복사한다 — 나중에 화면이 초안을 바꿔도 carry 는 그때의 것이다.
  const source = { ...drafts };
  const carry = lib.armChatViewClearCarry({ requestId: 1, userId: requester, coupleId, scope: "shared", target: "ai", drafts: source });
  source.shared_ai = "바뀐 글";
  assert.equal(carry.drafts.shared_ai, drafts.shared_ai);
});

test("열리는 첫 단계와 모드별 범위는 웹과 같다", () => {
  assert.equal(lib.openingChatViewClearStep("shared"), "shared_choose");
  assert.equal(lib.openingChatViewClearStep("private"), "private_confirm");
  assert.equal(lib.chatViewClearScope("view_reset_shared"), "shared");
  assert.equal(lib.chatViewClearScope("view_reset_private"), "private");
  assert.equal(lib.chatViewClearScope("delete_private"), "private");
  assert.ok(lib.isChatViewClearedAt(clearedAt));
  assert.ok(lib.isChatViewClearedAt("2026-09-18T01:00:00Z"));
  for (const bad of [null, "", "2026-09-18", "2026-09-18T01:00:00", "2026-02-30T01:00:00Z x", 1726621200000]) assert.equal(lib.isChatViewClearedAt(bad), false, String(bad));
});
