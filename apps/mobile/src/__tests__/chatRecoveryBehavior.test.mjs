import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import test from "node:test";
import ts from "typescript";
import { getAmoraVisibleText } from "@hanbang/shared/amora-visible-text";

// Native transport boundary only is synthetic. Execute the current screen's real functions.
const sourcePath = new URL("../../app/(tabs)/chat.tsx", import.meta.url);
const source = readFileSync(sourcePath, "utf8");
const tree = ts.createSourceFile("chat.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function loadFunctions(names, bindings) {
  const declarations = [];
  const visit = node => {
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name && names.includes(node.name.text)) declarations.push(node.getText(tree));
    ts.forEachChild(node, visit);
  };
  visit(tree);
  assert.equal(declarations.length, names.length);
  const compiled = ts.transpileModule(declarations.join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function("bindings", `with (bindings) { ${compiled}; return {${names.join(",")}}; }`)(bindings);
}
const event = value => `data: ${JSON.stringify(value)}\n\n`;
const parserFunctions = [
  "nonEmptyString", "isRecord", "asToolExecutionResult", "mergeToolResults", "asChatMessageMetadata",
  "isPlaceSearchPlaceholder", "asChatStreamEvent", "applyChatEvent", "cleanAiText", "createChatStreamParser",
  "parseChatHttpFailure", "streamChatWithXhr", "ChatTransportError", "canRetrySameChatRequest",
];
function transportHarness(replies) {
  const requests = [];
  class FakeXhr {
    status = 200;
    responseText = "";
    open() {}
    setRequestHeader() {}
    abort() { this.onabort?.(); }
    send(body) {
      requests.push(JSON.parse(body));
      this.responseText = replies.shift();
      this.onprogress?.();
      this.onload?.();
    }
  }
  const functions = loadFunctions(parserFunctions, {
    XMLHttpRequest: FakeXhr, getAmoraVisibleText, API_BASE: "https://example.invalid",
    CHAT_REQUEST_TIMEOUT_MS: 180000, MOBILE_RENDERED_TOOLS: [],
  });
  return { ...functions, requests };
}

test("HTTP 200 with a partial SSE but no done remains an incomplete, same-request-retryable answer", async () => {
  const h = transportHarness([event({ type: "text_delta", content: "예산을 비교하면 첫째는" })]);
  const updates = [];
  await assert.rejects(h.streamChatWithXhr(
    { clientRequestId: "existing-request", userMessageId: "persisted-question" },
    "synthetic-token", new globalThis.AbortController().signal, text => updates.push(text), () => {}, () => {},
  ), error => {
    assert.equal(error.code, "INCOMPLETE");
    assert.equal(h.canRetrySameChatRequest(error), true);
    return true;
  });
  assert.equal(updates.at(-1), "예산을 비교하면 첫째는");
});

test("an incomplete answer stays visibly unfinished and retry uses the same saved question without another user insert", async () => {
  const partial = event({ type: "text_delta", content: "비교 중인 내용" });
  const h = transportHarness([partial, partial]);
  const question = { id: "question", sender_type: "bride", content: "우리 예산을 비교해 주세요" };
  const state = { messages: [question], failure: null, streaming: false };
  const request = { lane: "shared_ai", tempId: "temp_request", serverRequestKey: "chat:owner:request", sessionGeneration: 1,
    body: { clientRequestId: "request", userMessageId: "question", coupleId: "couple", visibility: "shared", messages: [{ role: "user", content: question.content }] } };
  const bindings = {
    ...h, getAmoraVisibleText, isCurrentChatSession: () => true,
    persistedAiRequestKeysRef: { current: new Set() }, activeControllerRef: { current: null }, sessionUserIdRef: { current: "owner" },
    CHAT_REQUEST_TIMEOUT_MS: 180000, NEW_CHAT_MESSAGE_REQUIRED_NOTICE: "새 메시지 필요",
    setLaneFailure: (_lane, failure) => { state.failure = failure; }, setStreaming: value => { state.streaming = value; },
    setMessages: update => { state.messages = update(state.messages); }, setQuotaRemaining() {}, setQuotaPeriod() {}, setFollowUpSuggestions() {}, scrollToLatest() {},
    requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    requestChatStream: (body, signal, update, quota, done) => h.streamChatWithXhr(body, "synthetic", signal, update, quota, done),
    get activeSendFailure() { return state.failure; }, activeLane: "shared_ai", get streaming() { return state.streaming; }, sendingRef: { current: false },
  };
  const screen = loadFunctions(["streamAiRequest", "handleRetry", "getAiFailureMessage", "getServerCodeFailureMessage", "messageRequestKey", "mergeToolResults", "mergePersistedMessageWithLocal", "applyChatStreamUpdate", "reconcileChatStreamUpdate"], bindings);
  await screen.streamAiRequest(request);
  assert.equal(state.streaming, false);
  assert.equal(state.failure.canRetry, true);
  assert.equal(state.failure.request, request);
  assert.match(state.failure.message, /완료되지|중간/);
  const unfinished = state.messages.find(message => message.id === request.tempId);
  assert.equal(unfinished?.content, "비교 중인 내용");
  assert.equal(unfinished?.metadata?.stream_incomplete, true);
  assert.equal(unfinished?.metadata?.toolResults, undefined);
  await screen.handleRetry();
  assert.deepEqual(h.requests, [request.body, request.body]);
  assert.equal(state.messages.filter(message => message.id === "question").length, 1);
});

test("a late canonical answer replaces the incomplete display instead of keeping its partial text", () => {
  const h = loadFunctions(["messageRequestKey", "mergeToolResults", "mergePersistedMessageWithLocal", "mergeRealtimeMessage"], {});
  const local = { id: "temp_request", sender_type: "ai", content: "비교 중", metadata: { client_request_id: "request", stream_incomplete: true } };
  const canonical = { id: "saved-answer", sender_type: "ai", content: "비교를 마쳤어요. 두 선택지의 차이는 다음과 같아요.", metadata: { client_request_id: "request" } };
  assert.deepEqual(h.mergeRealtimeMessage([local], canonical, "request"), [canonical]);
});

test("a new question does not use an incomplete local answer as conversation evidence", async () => {
  const draft = { userId: "owner", coupleId: "couple", clientRequestId: "next", sourceLane: "shared_ai", text: "다음 질문",
    visibility: "shared", requestedVisibility: "shared", sessionGeneration: 1 };
  const question = { id: "next-question", role: "user", content: draft.text, visibility: "shared", metadata: { client_request_id: "next" } };
  const history = [
    { id: "saved", role: "assistant", content: "확인된 답변", visibility: "shared" },
    { id: "temp_partial", role: "assistant", content: "중간에 끊긴 추측", visibility: "shared", metadata: { stream_incomplete: true } },
  ];
  const requests = [];
  const h = loadFunctions(["sendAiDraft", "aiLaneForVisibility"], {
    isCurrentChatSession: () => true, requestAiMessageIngest: async () => ({ outcome: "persisted", message: question, safetyPrivacyRedirected: false }),
    isMessageInAiContext: () => true, messages: history, setStreaming() {}, setLaneFailure() {}, setMessages() {}, setInputByLane() {},
    streamAiRequest: async request => { requests.push(request); },
  });
  await h.sendAiDraft(draft, false);
  assert.deepEqual(requests[0].body.messages, [{ role: "assistant", content: "확인된 답변" }, { role: "user", content: "다음 질문" }]);
});

function suggestionHarness(scope, draft) {
  const state = { drafts: { shared_ai: "", private_ai: "", shared_partner: "상대에게 쓴 초안", ...draft }, notice: null, target: "ai" };
  const inputByLaneRef = { current: state.drafts };
  const h = loadFunctions(["handleAiSuggestion"], {
    streaming: false, sendingRef: { current: false }, safetyHoldLockRef: { current: false }, activeScope: scope, inputByLaneRef,
    updateAmoraChatLaneRecord: (record, lane, value) => ({ ...record, [lane]: value }),
    setTarget: value => { state.target = value; }, setPreparationNotice: value => { state.notice = value; },
    setInputByLane: update => { state.drafts = update(state.drafts); }, setSendFailuresByLane() {},
  });
  return { ...h, state, inputByLaneRef };
}

test("starter suggestions preserve a typed Korean draft in both AI lanes and explain why they did not replace it", () => {
  for (const [scope, lane] of [["shared", "shared_ai"], ["private", "private_ai"]]) {
    const h = suggestionHarness(scope, { [lane]: "양가 일정에 관해 아직 쓰는 중이에요\n두 번째 줄" });
    const before = { ...h.state.drafts };
    h.handleAiSuggestion("예산부터 정리해 주세요");
    assert.deepEqual(h.state.drafts, before);
    assert.match(h.state.notice, /작성 중|입력/);
  }
});

test("a canonical reply arriving before incomplete EOF cannot be overwritten by partial stream text", async () => {
  const h = transportHarness([]);
  const state = { messages: [], failure: null, frame: null };
  const keys = { current: new Set() };
  const request = { lane: "shared_ai", tempId: "temp_request", serverRequestKey: "chat:owner:request", sessionGeneration: 1,
    body: { clientRequestId: "request", userMessageId: "question", coupleId: "couple", visibility: "shared" } };
  const canonical = { id: "canonical", role: "assistant", sender_type: "ai", content: "서버에서 저장한 완성 답변", metadata: { client_request_id: request.serverRequestKey } };
  let screen;
  const bindings = {
    ...h, isCurrentChatSession: () => true, persistedAiRequestKeysRef: keys, activeControllerRef: { current: null }, sessionUserIdRef: { current: "owner" },
    CHAT_REQUEST_TIMEOUT_MS: 180000, NEW_CHAT_MESSAGE_REQUIRED_NOTICE: "새 메시지 필요",
    setLaneFailure: (_lane, failure) => { state.failure = failure; }, setStreaming() {},
    setMessages: update => { state.messages = update(state.messages); }, setQuotaRemaining() {}, setQuotaPeriod() {}, setFollowUpSuggestions() {}, scrollToLatest() {},
    requestAnimationFrame: fn => { state.frame = fn; return 1; }, cancelAnimationFrame() {},
    requestChatStream: async (_body, _signal, update) => {
      update("서버에서", [], null);
      state.frame?.();
      keys.current.add(request.serverRequestKey);
      state.messages = screen.mergeRealtimeMessage(state.messages, canonical, request.serverRequestKey);
      update("서버에서 저장한", [], null);
      state.frame?.();
      throw new h.ChatTransportError("INCOMPLETE");
    },
  };
  screen = loadFunctions(["streamAiRequest", "getAiFailureMessage", "getServerCodeFailureMessage", "messageRequestKey", "mergeToolResults", "mergePersistedMessageWithLocal", "mergeRealtimeMessage", "applyChatStreamUpdate", "reconcileChatStreamUpdate"], bindings);
  await screen.streamAiRequest(request);
  assert.equal(state.messages.length, 1);
  assert.equal(state.messages[0].id, canonical.id);
  assert.equal(state.messages[0].content, canonical.content);
  assert.equal(state.messages[0].metadata.stream_incomplete, undefined);
  assert.equal(state.failure, null, "a canonical persisted answer already recovered this request");
});

test("malformed done cannot confirm a partial stream or expose its action metadata", async () => {
  const h = transportHarness([event({ type: "text_delta", content: "아직 작성 중" })
    + event({ type: "done", fullContent: 42, metadata: { pending_amora_action: { id: "unverified" } } })]);
  const confirmations = [];
  await assert.rejects(h.streamChatWithXhr({}, "synthetic", new globalThis.AbortController().signal, () => {}, () => {}, metadata => confirmations.push(metadata)), error => error.code === "INCOMPLETE");
  assert.deepEqual(confirmations, []);
});

test("a valid SSE done still returns the complete answer and legacy non-SSE completion stays supported", async () => {
  for (const reply of [
    event({ type: "text_delta", content: "초안" }) + event({ type: "done", fullContent: "완성 답변" }),
    JSON.stringify({ type: "done", fullContent: "완성 답변" }),
  ]) {
    const h = transportHarness([reply]);
    const result = await h.streamChatWithXhr({}, "synthetic", new globalThis.AbortController().signal, () => {}, () => {}, () => {});
    assert.equal(result.text, "완성 답변");
  }
});

test("a starter can fill a blank AI lane once without touching partner or private drafts", () => {
  const h = suggestionHarness("shared", { shared_ai: "  \n", private_ai: "나만 상담 초안" });
  h.handleAiSuggestion("첫 시작 질문");
  h.handleAiSuggestion("두 번째 시작 질문");
  assert.deepEqual(h.state.drafts, { shared_ai: "첫 시작 질문", private_ai: "나만 상담 초안", shared_partner: "상대에게 쓴 초안" });
  assert.equal(h.inputByLaneRef.current.shared_ai, "첫 시작 질문");
});
