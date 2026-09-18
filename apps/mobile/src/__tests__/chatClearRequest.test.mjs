import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

/**
 * 「함께 새로 시작」 동의 카드 (2026-09-18).
 *
 * 상대가 웹에서 함께 대화를 새로 시작하자고 하면 서버는 `metadata.clearRequest` 가 붙은 메시지를
 * 남긴다(`/api/chat/clear-request`). 웹은 그것을 동의·거절 카드로 그리는데, 앱은 그냥 글 한 줄로 그렸다 —
 * 받은 사람은 앱에서 답할 방법이 없었고, 요청한 사람은 기다리는 중인지도 몰랐다.
 *
 * 지키는 것:
 * - 답할 수 있는 사람은 받은 사람뿐이다. 요청한 사람은 기다리는 상태만 본다(서버도 HC403 으로 막는다).
 * - 동의·거절은 서버가 확인해 준 뒤에만 "했어요"로 바뀐다. 동의는 대화를 지우지 않고 두 사람의
 *   공유 화면 경계만 옮긴다 — 문구는 웹 카드와 같다.
 */
function compile(relative, deps = {}, { jsx = false } = {}) {
  const path = fileURLToPath(new URL(relative, import.meta.url));
  const compiled = ts.transpileModule(readFileSync(path, "utf8"), {
    fileName: jsx ? "module.tsx" : "module.ts",
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      ...(jsx ? { jsx: ts.JsxEmit.ReactJSX } : {}),
    },
  });
  const module = { exports: {} };
  new Function("exports", "module", "require", compiled.outputText)(module.exports, module, (specifier) => {
    if (Object.hasOwn(deps, specifier)) return deps[specifier];
    throw new Error(`unmocked dependency: ${specifier}`);
  });
  return module.exports;
}
const read = (relative) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const lib = compile("../lib/chatClearRequest.ts");
const webBubble = read("../../../web/src/components/app/chat/ChatBubble.tsx");
const chat = read("../../app/(tabs)/chat.tsx");

const requester = "11111111-1111-4111-8111-111111111111";
const recipient = "22222222-2222-4222-8222-222222222222";
const messageId = "33333333-3333-4333-8333-333333333333";
const message = (status = "pending", changes = {}) => ({
  id: messageId,
  sender_id: requester,
  visibility: "shared",
  metadata: {
    clearRequest: { type: "shared", requestedBy: requester, requestedByRole: "bride", requestedAt: "2026-09-18T00:00:00.000Z", status },
  },
  ...changes,
});

test("서버가 남긴 모양 그대로인 요청만 카드로 읽는다", () => {
  assert.deepEqual(lib.readChatClearRequest(message()), { requestedBy: requester, status: "pending" });
  assert.deepEqual(lib.readChatClearRequest(message("accepted")), { requestedBy: requester, status: "accepted" });
  for (const broken of [
    message("pending", { metadata: null }),
    message("pending", { metadata: { clearRequest: "yes" } }),
    message("pending", { visibility: "bride_private" }),
    message("pending", { sender_id: recipient }),
    message("maybe"),
    { ...message(), metadata: { clearRequest: { ...message().metadata.clearRequest, type: "private" } } },
  ]) {
    assert.equal(lib.readChatClearRequest(broken), null, JSON.stringify(broken));
  }
});

test("답할 수 있는 사람은 받은 사람뿐이다", () => {
  const view = lib.readChatClearRequest(message());
  assert.equal(lib.getChatClearRequestRole(view, requester), "requester");
  assert.equal(lib.getChatClearRequestRole(view, recipient), "recipient");
  assert.equal(lib.getChatClearRequestRole(view, null), null);
  assert.equal(lib.describeChatClearRequest("pending", "recipient").canRespond, true);
  assert.equal(lib.describeChatClearRequest("pending", "requester").canRespond, false);
  for (const status of ["accepted", "declined"]) {
    for (const role of ["requester", "recipient"]) assert.equal(lib.describeChatClearRequest(status, role).canRespond, false);
  }
});

test("카드 문구는 웹 카드와 같다 — 무엇이 남고 무엇이 정리되는지까지", () => {
  for (const status of ["pending", "accepted", "declined"]) {
    for (const role of ["requester", "recipient"]) {
      const copy = lib.describeChatClearRequest(status, role);
      assert.ok(webBubble.includes(`"${copy.title}"`), `웹에 없는 제목: ${copy.title}`);
      assert.ok(webBubble.includes(`"${copy.body}"`), `웹에 없는 본문: ${copy.body}`);
      assert.equal(copy.footnote === null, status === "declined");
    }
  }
  assert.match(lib.describeChatClearRequest("pending", "requester").body, /^상대방 동의를 기다리는 중이에요/);
  assert.match(lib.describeChatClearRequest("pending", "recipient").body, /^상대방이 함께 새로 시작하자고 제안했어요/);
  // 각주는 웹 문장에서 딱 한 곳만 다르다 — 앱에는 비공개 대화 「화면 정리」가 없어서, 그 길은
  // 웹에 있다고 밝힌다. 앱에 없는 길을 앱에 있는 것처럼 말하지 않는다.
  const webFootnote = webBubble.match(/실제로 지우려면[^<]*/u)?.[0]?.replace(/&lsquo;/gu, "‘").replace(/&rsquo;/gu, "’").trim();
  assert.ok(webFootnote, "웹 각주를 찾지 못했다");
  assert.equal(
    lib.describeChatClearRequest("pending", "recipient").footnote,
    webFootnote.replace("비공개 대화는 비공개 상담의", "비공개 대화는 웹의 비공개 상담"),
  );
  assert.doesNotMatch(chat, /화면 정리 → 비공개 대화/, "앱 채팅에는 그 메뉴가 없다 — 각주가 웹을 가리키는 이유");
});

test("동의·거절은 정해진 주소로 action·messageId 만 보내고, 서버가 확인해 줘야 성공이다", async () => {
  const calls = [];
  const reply = (status, body) => async (path, init) => { calls.push({ path, init }); return new Response(JSON.stringify(body), { status }); };

  const accepted = await lib.respondToChatClearRequest(reply(200, { success: true, action: "accept", clearedAt: "2026-09-18T01:00:00.000Z", idempotent: false }), messageId, "accept");
  assert.deepEqual(accepted, { ok: true, status: "accepted" });
  assert.equal(calls[0].path, "/api/chat/clear-request");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].init.body), { action: "accept", messageId });

  assert.deepEqual(
    await lib.respondToChatClearRequest(reply(200, { success: true, action: "decline", idempotent: true }), messageId, "decline"),
    { ok: true, status: "declined" },
  );
  // 서버가 정리 시점을 돌려주지 않은 동의는 성공으로 치지 않는다.
  assert.equal((await lib.respondToChatClearRequest(reply(200, { success: true, action: "accept" }), messageId, "accept")).ok, false);
  // 다른 행동의 응답을 이 행동의 성공으로 읽지 않는다 — 양쪽 방향 모두.
  assert.equal((await lib.respondToChatClearRequest(reply(200, { success: true, action: "decline" }), messageId, "accept")).ok, false);
  assert.equal((await lib.respondToChatClearRequest(reply(200, { success: true, action: "accept", clearedAt: "2026-09-18T01:00:00.000Z" }), messageId, "decline")).ok, false);
  assert.equal((await lib.respondToChatClearRequest(reply(200, { success: false, action: "decline" }), messageId, "decline")).ok, false);
});

test("실패는 앱의 말로 알리고 서버 원문은 그리지 않는다", async () => {
  const fail = (status) => async () => new Response(JSON.stringify({ error: "INTERNAL_DETAIL stack" }), { status });
  const forbidden = await lib.respondToChatClearRequest(fail(403), messageId, "accept");
  assert.deepEqual(forbidden, { ok: false, error: "상대방만 응답할 수 있어요." });
  for (const status of [400, 401, 404, 409, 429, 500]) {
    const result = await lib.respondToChatClearRequest(fail(status), messageId, "decline");
    assert.equal(result.ok, false);
    assert.doesNotMatch(result.error, /INTERNAL_DETAIL|stack/);
    assert.match(result.error, /요\.$/);
  }
  const offline = await lib.respondToChatClearRequest(async () => { throw new Error("Network request failed"); }, messageId, "accept");
  assert.equal(offline.ok, false);
  assert.doesNotMatch(offline.error, /Network/);
});

function renderCard({ status, role, onRespond = async () => ({ ok: true, status: "accepted" }) }) {
  const jsx = (type, props) => ({ type, props: props ?? {} });
  const setters = [];
  const component = compile("../components/chat/ChatClearRequestCard.tsx", {
    react: { useState: (initial) => [initial, (value) => setters.push(value)], useRef: (initial) => ({ current: initial }) },
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "react-native": { ActivityIndicator: "ActivityIndicator", Pressable: "Pressable", View: "View", StyleSheet: { create: (value) => value } },
    "@/components/ui/AppText": { Text: "Text" },
    "lucide-react-native": { RefreshCw: "RefreshCw" },
    "@hanbang/design-tokens": { colors: new Proxy({}, { get: () => new Proxy({}, { get: () => "#000000" }) }) },
    "@/lib/chatClearRequest": lib,
  }, { jsx: true });
  const tree = component.ChatClearRequestCard({ request: { requestedBy: requester, status }, role, onRespond });
  const pressables = [];
  const texts = [];
  (function walk(node) {
    if (Array.isArray(node)) return node.forEach(walk);
    if (typeof node === "string") return void texts.push(node);
    if (!node || typeof node !== "object") return;
    if (node.type === "Pressable") pressables.push(node);
    walk(node.props.children);
  })(tree);
  return { pressables, text: texts.join(" "), setters };
}

test("받은 사람은 동의·거절을 누를 수 있고, 요청한 사람은 기다리는 상태만 본다", () => {
  const received = renderCard({ status: "pending", role: "recipient" });
  assert.deepEqual(received.pressables.map((node) => node.props.accessibilityLabel), ["함께 새로 시작에 동의", "함께 새로 시작 거절"]);
  for (const node of received.pressables) assert.equal(node.props.accessibilityRole, "button");
  assert.match(received.text, /상대방이 함께 새로 시작하자고 제안했어요/);

  const sent = renderCard({ status: "pending", role: "requester" });
  assert.equal(sent.pressables.length, 0, "요청한 사람에게는 버튼이 없다");
  assert.match(sent.text, /상대방 동의를 기다리는 중이에요/);

  for (const status of ["accepted", "declined"]) {
    assert.equal(renderCard({ status, role: "recipient" }).pressables.length, 0, status);
  }
  assert.match(renderCard({ status: "accepted", role: "requester" }).text, /함께 새로 시작했어요/);
});

test("동의는 서버가 확인해 준 뒤에만 동의한 상태가 되고, 실패하면 그 이유를 카드에 남긴다", async () => {
  const actions = [];
  const ok = renderCard({ status: "pending", role: "recipient", onRespond: async (action) => { actions.push(action); return { ok: true, status: "accepted" }; } });
  await ok.pressables[0].props.onPress();
  assert.deepEqual(actions, ["accept"]);
  assert.ok(ok.setters.includes("accepted"), "서버가 확인한 결과로 바뀐다");

  const failed = renderCard({ status: "pending", role: "recipient", onRespond: async () => ({ ok: false, error: "상대방만 응답할 수 있어요." }) });
  await failed.pressables[1].props.onPress();
  assert.ok(!failed.setters.includes("declined"), "실패를 거절한 것으로 그리지 않는다");
  assert.ok(failed.setters.includes("상대방만 응답할 수 있어요."));
});

test("채팅 화면이 요청 메시지를 카드로 그리고 앱의 인증 요청으로 답한다", () => {
  assert.match(chat, /renderItem=\{renderChatRow\}/);
  const row = chat.slice(chat.indexOf("function renderChatRow"), chat.indexOf("const isP = activeScope"));
  assert.match(row, /readChatClearRequest\(item\)/);
  assert.match(row, /getChatClearRequestRole\(clearRequest, userId\)/);
  assert.match(row, /<ChatClearRequestCard/);
  assert.match(row, /return renderMessage\(\{ item \}\)/);
  const respond = chat.slice(chat.indexOf("async function handleClearRequestResponse"), chat.indexOf("function renderChatRow"));
  assert.match(respond, /apiFetchForExpectedUser\(actorId, path, init\)/);
  // 동의는 두 사람의 공유 화면 경계를 옮긴다 — 기존 범위 재확인 경로가 그것을 보고 다시 불러온다.
  assert.match(respond, /action === "accept"[\s\S]*refreshChatSessionRef\.current\?\.\(\)/);
});
