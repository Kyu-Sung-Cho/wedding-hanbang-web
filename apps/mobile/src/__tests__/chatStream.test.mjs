import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

const sourcePath = fileURLToPath(new URL("../../app/(tabs)/chat.tsx", import.meta.url));
const sourceText = readFileSync(sourcePath, "utf8");
const sourceFile = ts.createSourceFile(
  sourcePath,
  sourceText,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const functionNames = new Set([
  "nonEmptyString",
  "isRecord",
  "asToolExecutionResult",
  "mergeToolResults",
  "asChatMessageMetadata",
  "asChatStreamEvent",
  "applyChatEvent",
  "cleanAiText",
  "createChatStreamParser",
  "applyChatStreamUpdate",
  "messageRequestKey",
  "mergePersistedMessageWithLocal",
  "mergeRealtimeMessage",
  "reconcileChatStreamUpdate",
  "streamChatWithXhr",
]);
const parserDeclarations = sourceFile.statements
  .filter((statement) =>
    (ts.isClassDeclaration(statement) && statement.name?.text === "ChatTransportError") ||
    (ts.isFunctionDeclaration(statement) && statement.name && functionNames.has(statement.name.text))
  )
  .map((statement) => statement.getFullText(sourceFile))
  .join("\n");
const compiled = ts.transpileModule(parserDeclarations, {
  compilerOptions: {
    module: ts.ModuleKind.None,
    target: ts.ScriptTarget.ES2022,
  },
});
const loadParser = new Function(
  `const API_BASE = "https://hanbang.ai";\nconst CHAT_REQUEST_TIMEOUT_MS = 180000;\n${compiled.outputText}\nreturn { ChatTransportError, createChatStreamParser, applyChatStreamUpdate, mergeRealtimeMessage, reconcileChatStreamUpdate, streamChatWithXhr };`,
);
const {
  ChatTransportError,
  createChatStreamParser,
  applyChatStreamUpdate,
  mergeRealtimeMessage,
  reconcileChatStreamUpdate,
  streamChatWithXhr,
} = loadParser();

function sourceBetween(startMarker, endMarker) {
  const start = sourceText.indexOf(startMarker);
  const end = sourceText.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return sourceText.slice(start, end);
}

test("SSE parser survives arbitrary CRLF and JSON chunk boundaries", () => {
  const updates = [];
  const parser = createChatStreamParser((text) => updates.push(text));
  const chunks = [
    "da",
    "ta: {\"type\":\"text_delta\",\"content\":\"안\"}\r",
    "\n\r",
    "\n",
    "data: {\"type\":\"text_delta\",\"content\":\"녕\"}\n",
    "\n",
    "data: {\"type\":\"done\",\"fullContent\":\"안녕하세요\"}\n\n",
  ];

  chunks.forEach((chunk) => parser.push(chunk));

  assert.deepEqual(updates, ["안", "안녕", "안녕하세요"]);
  assert.equal(parser.finish(), "안녕하세요");
  assert.equal(updates.some((text) => text.includes("data:") || text.includes("text_delta")), false);
});

test("text_clear resets partial output and suggestion markup never reaches chat text", () => {
  const updates = [];
  const parser = createChatStreamParser((text) => updates.push(text));
  parser.push("data: {\"type\":\"text_delta\",\"content\":\"초안\"}\n\n");
  parser.push("data: {\"type\":\"text_clear\"}\n\n");
  parser.push("data: {\"type\":\"content_block_delta\",\"delta\":{\"text\":\"최종\"}}\n\n");
  parser.push("data: {\"type\":\"done\",\"fullContent\":\"최종[suggestions]숨김[/suggestions]\"}\n\n");

  assert.deepEqual(updates, ["초안", "", "최종", "최종"]);
  assert.equal(parser.finish(), "최종");
});

test("stream error hides server details instead of rendering serialized SSE", () => {
  const updates = [];
  const parser = createChatStreamParser((text) => updates.push(text));
  parser.push("data: {\"type\":\"error\",\"message\":\"private stack details\"}\n\n");

  assert.throws(
    () => parser.finish(),
    (error) => error instanceof ChatTransportError && error.code === "STREAM",
  );
  assert.deepEqual(updates, []);
});

test("non-SSE JSON completion remains compatible without exposing JSON", () => {
  const updates = [];
  const parser = createChatStreamParser((text) => updates.push(text));
  parser.push("{\"type\":\"done\",\"fullContent\":\"완료\"}");

  assert.equal(parser.finish(), "완료");
  assert.deepEqual(updates, []);
});

test("finish consumes a final SSE event even when the server omits the last blank line", () => {
  const parser = createChatStreamParser(() => {});
  parser.push("data: {\"type\":\"text_delta\",\"content\":\"마지막\"}\n\n");
  parser.push("data: {\"type\":\"done\",\"fullContent\":\"마지막 응답\"}");

  assert.equal(parser.finish(), "마지막 응답");
});

test("ephemeral place results survive SSE when done metadata omits provider data", () => {
  const streamedResult = {
    toolName: "search_nearby_places",
    toolInput: { query: "강남 상견례 식당" },
    toolOutput: {
      places: [{
        id: "naver-1",
        name: "담소정",
        address: "서울 강남구 테헤란로 1",
        category: "한식",
        imageUrl: "https://search.pstatic.net/place.jpg",
        searchUrl: "https://search.naver.com/search.naver?query=담소정",
        mapsUrl: "https://map.naver.com/p/search/담소정",
        blogSearchUrl: "https://search.naver.com/search.naver?where=blog&query=담소정",
      }],
    },
    success: true,
    displayMessage: "식당 1곳을 찾았어요.",
  };
  const updates = [];
  const parser = createChatStreamParser((text, toolResults) => {
    updates.push({ text, toolResults });
  });

  parser.push(`data: ${JSON.stringify({ type: "tool_result", result: streamedResult })}\n\n`);
  parser.push(`data: ${JSON.stringify({
    type: "done",
    fullContent: "두 분이 이야기하기 좋은 곳이에요.",
    metadata: { serverMessageId: "message-1" },
  })}\n\n`);

  assert.equal(parser.finish(), "두 분이 이야기하기 좋은 곳이에요.");
  assert.deepEqual(parser.getToolResults(), [streamedResult]);
  assert.deepEqual(parser.getMetadata().toolResults, [streamedResult]);
  assert.equal(updates.some((update) => update.toolResults.length === 1), true);
});

test("XHR transport returns tool results even when the assistant text is empty", async () => {
  const failedResult = {
    toolName: "search_nearby_places",
    toolInput: { query: "강남 상견례 식당" },
    toolOutput: {},
    success: false,
    displayMessage: "네이버 장소 검색을 잠시 사용할 수 없어요.",
  };
  const responseText = [
    `data: ${JSON.stringify({ type: "tool_result", result: failedResult })}\n\n`,
    `data: ${JSON.stringify({
      type: "done",
      fullContent: "",
      metadata: { serverMessageId: "message-1" },
    })}\n\n`,
  ].join("");

  class FakeXMLHttpRequest {
    status = 200;
    responseText = "";
    timeout = 0;
    open() {}
    setRequestHeader() {}
    abort() { this.onabort?.(); }
    send() {
      this.responseText = responseText;
      this.onprogress?.();
      this.onload?.();
    }
  }

  const original = globalThis.XMLHttpRequest;
  globalThis.XMLHttpRequest = FakeXMLHttpRequest;
  try {
    const updates = [];
    const completion = await streamChatWithXhr(
      {},
      "access-token",
      {
        aborted: false,
        addEventListener() {},
        removeEventListener() {},
      },
      (text, toolResults) => updates.push({ text, toolResults }),
    );

    assert.equal(completion.text, "");
    assert.deepEqual(completion.toolResults, [failedResult]);
    assert.equal(completion.metadata.serverMessageId, "message-1");
    assert.equal(updates.some((update) => update.toolResults.length === 1), true);
  } finally {
    globalThis.XMLHttpRequest = original;
  }
});

test("stream updates preserve the request id while attaching tool results", () => {
  const result = {
    toolName: "search_nearby_places",
    toolInput: { query: "강남 상견례 식당" },
    toolOutput: { places: [] },
    success: true,
    displayMessage: "검색 결과가 없어요.",
  };
  const updated = applyChatStreamUpdate(
    {
      id: "temp-1",
      role: "assistant",
      sender_type: "ai",
      content: "",
      metadata: { client_request_id: "request-1" },
    },
    {
      text: "검색 결과예요.",
      toolResults: [result],
      metadata: { serverMessageId: "message-1" },
    },
  );

  assert.equal(updated.content, "검색 결과예요.");
  assert.equal(updated.metadata.client_request_id, "request-1");
  assert.equal(updated.metadata.serverMessageId, "message-1");
  assert.deepEqual(updated.metadata.toolResults, [result]);
});

test("Realtime-first reconciliation keeps ephemeral place cards on the server row", () => {
  const requestKey = "chat:user-1:request-1";
  const result = {
    toolName: "search_nearby_places",
    toolInput: { query: "강남 상견례 식당" },
    toolOutput: { places: [{ id: "naver-0", name: "한방정식" }] },
    success: true,
    displayMessage: "검색 결과 1곳을 찾았습니다.",
  };
  const placeholder = {
    id: "temp_request-1",
    role: "assistant",
    sender_type: "ai",
    content: "",
    metadata: { client_request_id: requestKey },
  };
  const persisted = {
    id: "server-message-1",
    role: "assistant",
    sender_type: "ai",
    content: "검색 결과를 카드에 표시했어요.",
    metadata: { client_visible_request_id: requestKey },
  };

  const realtimeFirst = mergeRealtimeMessage([placeholder], persisted, requestKey);
  const afterToolResult = reconcileChatStreamUpdate(
    realtimeFirst,
    placeholder.id,
    requestKey,
    { text: "", toolResults: [result], metadata: null },
  );
  const completed = reconcileChatStreamUpdate(
    afterToolResult,
    placeholder.id,
    requestKey,
    {
      text: "검색 결과를 카드에 표시했어요.",
      toolResults: [result],
      metadata: { serverMessageId: persisted.id },
    },
  );

  assert.equal(completed.length, 1);
  assert.equal(completed[0].id, persisted.id);
  assert.deepEqual(completed[0].metadata.toolResults, [result]);
});

test("SSE-first reconciliation survives a later sanitized Realtime insert", () => {
  const requestKey = "chat:user-1:request-2";
  const result = {
    toolName: "search_nearby_places",
    toolInput: { query: "강남 상견례 식당" },
    toolOutput: { places: [{ id: "naver-0", name: "한방정식" }] },
    success: true,
    displayMessage: "검색 결과 1곳을 찾았습니다.",
  };
  const placeholder = {
    id: "temp_request-2",
    role: "assistant",
    sender_type: "ai",
    content: "",
    metadata: { client_request_id: requestKey },
  };
  const completed = reconcileChatStreamUpdate(
    [placeholder],
    placeholder.id,
    requestKey,
    {
      text: "검색 결과를 카드에 표시했어요.",
      toolResults: [result],
      metadata: { serverMessageId: "server-message-2" },
    },
  );
  const afterRealtime = mergeRealtimeMessage(
    completed,
    {
      id: "server-message-2",
      role: "assistant",
      sender_type: "ai",
      content: "검색 결과를 카드에 표시했어요.",
      metadata: { client_visible_request_id: requestKey },
    },
    requestKey,
  );

  assert.equal(afterRealtime.length, 1);
  assert.equal(afterRealtime[0].id, "server-message-2");
  assert.deepEqual(afterRealtime[0].metadata.toolResults, [result]);
});

test("mobile message rendering connects live place results to PlaceCards", () => {
  const streamAiRequest = sourceBetween(
    "async function streamAiRequest",
    "async function sendAiDraft",
  );
  const renderMessage = sourceBetween(
    "function renderMessage",
    "const isP = target",
  );

  assert.ok(streamAiRequest.includes("reconcileChatStreamUpdate"));
  assert.ok(streamAiRequest.includes("toolResults"));
  assert.ok(streamAiRequest.includes("metadata"));
  assert.ok(renderMessage.includes('result.toolName === "search_nearby_places"'));
  assert.ok(renderMessage.includes("<PlaceCards"));
});

test("AI transport stays behind the durable user-message gate", () => {
  const sendAiDraft = sourceBetween(
    "async function sendAiDraft",
    "async function handleRetry",
  );
  const durableGate = sendAiDraft.indexOf("if (!durableMessage) throw");
  const transportCall = sendAiDraft.indexOf("await streamAiRequest(request)");
  const inputClear = sendAiDraft.indexOf("setInput((current)");

  assert.ok(durableGate >= 0);
  assert.ok(transportCall > durableGate);
  assert.ok(inputClear > durableGate);
  assert.equal(sourceText.includes("apiFetch("), false);
  assert.equal(sourceText.includes("await res.text()"), false);
});

test("manual AI retry reuses the stored request instead of generating a new id", () => {
  const retryHandler = sourceBetween(
    "async function handleRetry",
    "async function handleSend",
  );

  assert.ok(retryHandler.includes("await streamAiRequest(failure.request)"));
  assert.equal(retryHandler.includes("Crypto.randomUUID()"), false);
});
