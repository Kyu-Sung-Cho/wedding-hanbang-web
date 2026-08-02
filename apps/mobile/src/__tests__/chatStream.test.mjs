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
  "parseChatHttpFailure",
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

test("quota events report only non-negative integer remaining turns", () => {
  const quotas = [];
  const parser = createChatStreamParser(() => {}, (remaining) => quotas.push(remaining));
  parser.push("data: {\"type\":\"quota\",\"remaining\":5}\n\n");
  parser.push("data: {\"type\":\"quota\",\"remaining\":-1}\n\n");
  parser.push("data: {\"type\":\"quota\",\"remaining\":2.5}\n\n");
  parser.push("data: {\"type\":\"quota\",\"remaining\":\"4\"}\n\n");
  parser.push("data: {\"type\":\"done\",\"fullContent\":\"완료\"}\n\n");

  assert.deepEqual(quotas, [5]);
  assert.equal(parser.finish(), "완료");
});

test("stream error clears a visible draft and hides server details", () => {
  const updates = [];
  const parser = createChatStreamParser((text) => updates.push(text));
  parser.push("data: {\"type\":\"text_delta\",\"content\":\"확정되지 않은 초안\"}\n\n");
  parser.push("data: {\"type\":\"error\",\"message\":\"private stack details\"}\n\n");

  assert.throws(
    () => parser.finish(),
    (error) => error instanceof ChatTransportError && error.code === "STREAM",
  );
  assert.deepEqual(updates, ["확정되지 않은 초안", ""]);
});

test("stream error preserves the explicit immutable retry contract without exposing its message", () => {
  const parser = createChatStreamParser(() => {});
  parser.push(`data: ${JSON.stringify({
    type: "error",
    code: "PRIVACY_CONTEXT_CHANGED",
    message: "private server detail",
    retryable: false,
    retryPolicy: "new_message",
  })}\n\n`);

  assert.throws(
    () => parser.finish(),
    (error) => {
      assert.ok(error instanceof ChatTransportError);
      assert.equal(error.code, "STREAM");
      assert.equal(error.serverCode, "PRIVACY_CONTEXT_CHANGED");
      assert.equal(error.retryable, false);
      assert.equal(error.retryPolicy, "new_message");
      assert.equal(error.message.includes("private server detail"), false);
      return true;
    },
  );
});

test("stream retry parsing permits only explicit same-request replay and fails closed for legacy terminals", () => {
  const retryableParser = createChatStreamParser(() => {});
  retryableParser.push(`data: ${JSON.stringify({
    type: "error",
    code: "MEMORY_ENQUEUE_REPAIR_PENDING",
    message: "safe retry",
    retryable: true,
    retryPolicy: "same_request",
  })}\n\n`);
  assert.throws(
    () => retryableParser.finish(),
    (error) => error.retryable === true && error.retryPolicy === "same_request",
  );

  const legacyParser = createChatStreamParser(() => {});
  legacyParser.push("data: {\"type\":\"error\",\"message\":\"legacy\"}\n\n");
  assert.throws(
    () => legacyParser.finish(),
    (error) => error.retryable === false && error.retryPolicy === null,
  );
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

test("done metadata is forwarded separately so an explicit action card does not wait for realtime", () => {
  const metadataUpdates = [];
  const parser = createChatStreamParser(
    () => {},
    () => {},
    (metadata) => metadataUpdates.push(metadata),
  );
  const pending = {
    version: 1,
    actionId: "44444444-4444-4444-8444-444444444444",
    tool: "update_budget",
    input: { total_budget: 30_000_000 },
    confirmation: "총 결혼 예산 변경 · 총 예산: 3,000만 원",
    issuedAt: 1_784_246_400_000,
    expiresAt: 1_784_247_000_000,
  };
  parser.push(`data: ${JSON.stringify({
    type: "done",
    fullContent: "변경 내용을 확인해 주세요.",
    metadata: { pending_amora_action: pending },
  })}\n\n`);

  assert.equal(parser.finish(), "변경 내용을 확인해 주세요.");
  assert.deepEqual(metadataUpdates, [{ pending_amora_action: pending }]);
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

test("XHR HTTP errors preserve an explicit same-request retry contract without exposing server detail", async () => {
  class FakeXMLHttpRequest {
    status = 503;
    responseText = JSON.stringify({
      error: "private memory reconciliation detail",
      code: "AMORA_MEMORY_ENQUEUE_RETRY_REQUIRED",
      retryable: false,
      retryPolicy: "same_request",
    });
    timeout = 0;
    open() {}
    setRequestHeader() {}
    abort() { this.onabort?.(); }
    send() { this.onload?.(); }
  }

  const original = globalThis.XMLHttpRequest;
  globalThis.XMLHttpRequest = FakeXMLHttpRequest;
  try {
    await assert.rejects(
      streamChatWithXhr(
        {},
        "access-token",
        {
          aborted: false,
          addEventListener() {},
          removeEventListener() {},
        },
        () => {},
        () => {},
        () => {},
      ),
      (error) => {
        assert.ok(error instanceof ChatTransportError);
        assert.equal(error.code, "HTTP");
        assert.equal(error.status, 503);
        assert.equal(error.serverCode, "AMORA_MEMORY_ENQUEUE_RETRY_REQUIRED");
        assert.equal(error.retryable, true);
        assert.equal(error.retryPolicy, "same_request");
        assert.equal(error.message.includes("private memory reconciliation detail"), false);
        return true;
      },
    );
  } finally {
    globalThis.XMLHttpRequest = original;
  }
});

test("XHR HTTP errors fail closed for privacy, legacy, and malformed envelopes", async () => {
  const original = globalThis.XMLHttpRequest;
  const signal = {
    aborted: false,
    addEventListener() {},
    removeEventListener() {},
  };

  async function readFailure(responseText) {
    class FakeXMLHttpRequest {
      status = 503;
      responseText = responseText;
      timeout = 0;
      open() {}
      setRequestHeader() {}
      abort() { this.onabort?.(); }
      send() { this.onload?.(); }
    }
    globalThis.XMLHttpRequest = FakeXMLHttpRequest;
    try {
      await streamChatWithXhr({}, "access-token", signal, () => {}, () => {}, () => {});
      assert.fail("expected HTTP transport failure");
    } catch (error) {
      assert.ok(error instanceof ChatTransportError);
      return error;
    }
  }

  try {
    const privacy = await readFailure(JSON.stringify({
      error: "private privacy epoch detail",
      code: "AMORA_PRIVACY_CONTEXT_CHANGED",
      retryable: true,
      retryPolicy: "new_message",
    }));
    assert.equal(privacy.serverCode, "AMORA_PRIVACY_CONTEXT_CHANGED");
    assert.equal(privacy.retryable, false);
    assert.equal(privacy.retryPolicy, "new_message");
    assert.equal(privacy.message.includes("private privacy epoch detail"), false);

    for (const legacyOrMalformed of [
      JSON.stringify({ code: "LEGACY_HTTP_503", retryable: "true" }),
      "not-json",
    ]) {
      const failure = await readFailure(legacyOrMalformed);
      assert.equal(failure.retryable, false);
      assert.equal(failure.retryPolicy, null);
    }
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
    "const isP = activeScope",
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
  const inputClear = sendAiDraft.indexOf("setInputByLane((current)");

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

test("mobile hides same-request retry after a non-retryable terminal and gives a privacy-free new-message path", () => {
  const sendFailureType = sourceBetween(
    "type SendFailure",
    "type PartnerRecipientVerification",
  );
  const streamAiRequest = sourceBetween(
    "async function streamAiRequest",
    "async function sendAiDraft",
  );
  const retryHandler = sourceBetween(
    "async function handleRetry",
    "async function handleSend",
  );

  assert.match(sendFailureType, /kind: "ai_response"[\s\S]*canRetry: boolean[\s\S]*unavailableReason: string \| null/);
  assert.match(streamAiRequest, /const canRetry = canRetrySameChatRequest\(error, timedOut\)/);
  assert.match(retryHandler, /failure\.kind === "ai_response" && !failure\.canRetry/);
  assert.match(sourceText, /activeSendFailure\.kind !== "ai_response" \|\| activeSendFailure\.canRetry/);
  assert.match(sourceText, /새 메시지로 보내주세요\./);
  assert.doesNotMatch(sourceText, /activeSendFailure\.request\.body\.messages[\s\S]*새 메시지로 보내주세요/);
});

test("mobile transport forwards parsed quota updates to visible screen state", () => {
  const xhrTransport = sourceBetween(
    "function streamChatWithXhr",
    "function waitForUnlessAborted",
  );
  const requestTransport = sourceBetween(
    "async function requestChatStream",
    "function getAiFailureMessage",
  );

  assert.match(xhrTransport, /createChatStreamParser\(onUpdate,\s*onQuota,\s*onDoneMetadata\)/);
  assert.match(requestTransport, /streamChatWithXhr\([\s\S]*?onUpdate,\s*onQuota,\s*onDoneMetadata/);
  assert.match(sourceText, /const \[quotaRemaining, setQuotaRemaining\] = useState<number \| null>\(null\)/);
  assert.match(sourceText, /requestChatStream\([\s\S]*?setQuotaRemaining/);
  assert.match(sourceText, /quotaRemaining !== null/);
});

test("mobile send path preserves the selected visibility through persistence, provider, and retry", () => {
  const requestBodyType = sourceBetween(
    "interface ChatRequestBody",
    "interface AiDraft",
  );
  const aiDraftType = sourceBetween(
    "interface AiDraft",
    "interface AiRequest",
  );
  const partnerDraftType = sourceBetween(
    "interface PartnerDraft",
    "type SendFailure",
  );
  const durableLookup = sourceBetween(
    "async function findDurableUserMessage",
    "async function sendPartnerDraft",
  );
  const partnerSend = sourceBetween(
    "async function sendPartnerDraft",
    "async function streamAiRequest",
  );
  const aiStream = sourceBetween(
    "async function streamAiRequest",
    "async function sendAiDraft",
  );
  const aiSend = sourceBetween(
    "async function sendAiDraft",
    "async function handleRetry",
  );
  const sendHandler = sourceBetween(
    "async function handleSend",
    "function handleInputChange",
  );

  assert.match(requestBodyType, /visibility: ChatMessageVisibility/);
  assert.match(aiDraftType, /visibility: ChatMessageVisibility/);
  assert.match(aiDraftType, /clientRequestId: string/);
  assert.match(partnerDraftType, /visibility: "shared"/);
  assert.match(partnerDraftType, /clientRequestId: string/);
  assert.match(partnerDraftType, /partnerRecipientId: string/);
  assert.match(durableLookup, /\.eq\("visibility", draft\.visibility\)/);
  assert.match(durableLookup, /client_request_id: draft\.clientRequestId/);
  assert.doesNotMatch(durableLookup, /\.eq\("content", draft\.text\)/);
  assert.doesNotMatch(durableLookup, /draft\.startedAt/);
  assert.match(partnerSend, /visibility: draft\.visibility/);
  assert.match(partnerSend, /metadata: \{[\s\S]*target: "partner",[\s\S]*client_request_id: draft\.clientRequestId,[\s\S]*partner_recipient_id: draft\.partnerRecipientId,[\s\S]*\}/);
  assert.match(aiSend, /visibility: draft\.visibility/);
  assert.match(aiSend, /client_request_id: draft\.clientRequestId/);
  assert.match(aiSend, /body:[\s\S]*visibility: draft\.visibility/);
  assert.match(aiStream, /visibility: request\.body\.visibility/);
  assert.match(sendHandler, /chatVisibilityForScope\(activeScope, userRole\)/);
  assert.match(sendHandler, /visibility: activeVisibility/);
  assert.match(sendHandler, /partnerRecipientId/);
  assert.match(sendHandler, /const clientRequestId = Crypto\.randomUUID\(\)/);
  assert.equal((sendHandler.match(/Crypto\.randomUUID\(\)/g) ?? []).length, 1);
});

test("mobile UI exposes accessible shared/private scopes and renders only the selected scope", () => {
  assert.match(
    sourceText,
    /const \[activeScope, setActiveScope\] = useState<ChatScope>\("shared"\)/,
  );
  assert.match(sourceText, /const activeLane = resolveAmoraChatLane\(activeScope, target, hasLinkedPartner\)/);
  assert.match(sourceText, /const input = activeLane \? inputByLane\[activeLane\] : ""/);
  assert.match(sourceText, /isMessageInChatScope\(message\.visibility, activeScope, userRole\)/);
  assert.match(sourceText, /const visibleMessages = useMemo\(\(\) => \[\.\.\.scopedMessages\]\.reverse\(\)/);
  assert.match(sourceText, /function handleScopeChange\(nextScope: ChatScope\)/);
  assert.match(sourceText, /selectChatScope\([\s\S]*nextScope,[\s\S]*userRole/);
  assert.match(sourceText, /accessibilityLabel="상담 공개 범위"/);
  assert.match(sourceText, /accessibilityRole="tab"/);
  assert.match(sourceText, /accessibilityState=\{\{ selected: activeScope === "shared"/);
  assert.match(sourceText, />함께 대화<\/Text>/);
  assert.match(sourceText, />나만 \(상담\)<\/Text>/);
  assert.match(sourceText, /현재 범위 · 함께 대화 — 파트너에게 보여요/);
  assert.match(sourceText, /현재 범위 · 나만 \(상담\) — 서비스에 저장되며 상대방에게는 보이지 않아요/);
  assert.match(sourceText, /activeScope === "shared" && \(/);
});

test("mobile composer keeps shared AI, partner, and private AI state in separate lanes", () => {
  assert.match(sourceText, /from "@hanbang\/shared\/chat-lane"/);
  assert.match(sourceText, /useState<AmoraChatLaneRecord<string>>/);
  assert.match(sourceText, /resolveAmoraChatLane\(activeScope, target, hasLinkedPartner\)/);
  assert.match(sourceText, /updateAmoraChatLaneRecord\(currentDrafts, lane, resolvedInput\)/);
  assert.match(sourceText, /const activeSendFailure = activeLane \? sendFailuresByLane\[activeLane\] : null/);
});

test("partner delivery is fail-closed and AI suggestions never overwrite the partner lane", () => {
  const targetHandler = sourceBetween(
    "function handleTargetChange",
    "function handleAiSuggestion",
  );
  const suggestionHandler = sourceBetween(
    "function handleAiSuggestion",
    "async function handleApplyPendingAction",
  );
  const partnerSend = sourceBetween(
    "async function sendPartnerDraft",
    "async function streamAiRequest",
  );
  const sendHandler = sourceBetween(
    "async function handleSend",
    "function handleInputChange",
  );

  assert.match(targetHandler, /nextTarget === "partner" && !hasLinkedPartner/);
  assert.match(partnerSend, /!hasLinkedPartnerRef\.current/);
  assert.match(sourceText, /select\("bride_id, groom_id"\)/);
  assert.match(sourceText, /select\("id, name"\)/);
  assert.match(sourceText, /expectedSelfId === user\.id/);
  assert.match(sourceText, /const linkedPartnerIdRef = useRef<string \| null>\(null\)/);
  assert.match(sourceText, /updateAmoraChatLaneRecord\(current, "shared_partner", ""\)/);
  assert.match(sourceText, /hasLinkedPartner && \(/);
  assert.match(sourceText, /!isP && \([\s\S]*st\.suggestions/);
  assert.match(suggestionHandler, /"shared_ai"/);
  assert.doesNotMatch(suggestionHandler, /handleInputChange/);

  const verificationCallIndex = partnerSend.indexOf("await verifyPartnerDraftRecipient(draft)");
  const insertIndex = partnerSend.indexOf('.insert({');
  assert.ok(verificationCallIndex >= 0, "partner recipient must be reverified before delivery");
  assert.ok(insertIndex > verificationCallIndex, "recipient verification must finish before insert");
  assert.match(partnerSend, /draft\.partnerRecipientId/);
  assert.ok(
    (partnerSend.match(/setPartnerSafetyNotice\(PARTNER_CONNECTION_CHANGED_NOTICE\)/g) ?? []).length >= 2,
    "both stale-ref and authoritative-unlinked branches must explain the discarded draft",
  );
  assert.match(sourceText, /const PARTNER_CONNECTION_CHANGED_NOTICE =\s*"상대방 연결 상태가 바뀌어 메시지를 보내지 않았어요\. 잘못 전달되지 않도록 작성 중인 초안은 삭제했어요\."/);
  assert.match(sourceText, /partnerSafetyNotice && \(/);
  assert.match(sourceText, /onPress=\{\(\) => setPartnerSafetyNotice\(null\)\}/);
  assert.match(sendHandler, /setPartnerSafetyNotice\(PARTNER_CONNECTION_CHANGED_NOTICE\)/);
});

test("identity changes reset private session state and gate late async/realtime writes", () => {
  const reloadScheduler = sourceBetween(
    "function scheduleChatSessionReload",
    "async function loadChatSession",
  );

  assert.match(sourceText, /createChatSessionGenerationGuard/);
  assert.match(sourceText, /const resetChatSessionState = useCallback/);
  assert.match(sourceText, /setMessages\(\[\]\)/);
  assert.match(sourceText, /setInputByLane\(createEmptyAmoraChatLaneRecord/);
  assert.match(sourceText, /setSendFailuresByLane\(createEmptyAmoraChatLaneRecord/);
  assert.match(sourceText, /setQuotaRemaining\(null\)/);
  assert.match(sourceText, /setDismissedPendingActionIds\(new Set\(\)\)/);
  assert.match(sourceText, /isCurrentChatSession\(generation\)/);
  assert.match(sourceText, /onAuthStateChange/);
  assert.match(sourceText, /if \(nextAuthUserId === observedAuthUserId\) return/);
  assert.match(sourceText, /chat-identity:/);
  assert.match(sourceText, /nextProfile\.couple_id !== profile\?\.couple_id/);
  assert.match(sourceText, /nextCouple\.bride_id !== couple\.bride_id/);
  const invalidateIndex = reloadScheduler.indexOf("chatSessionGenerationRef.current.invalidate()");
  const resetIndex = reloadScheduler.indexOf("resetChatSessionState()");
  const timerIndex = reloadScheduler.indexOf("setTimeout");
  assert.ok(invalidateIndex >= 0, "identity events must invalidate the old generation immediately");
  assert.ok(resetIndex >= 0, "identity events must clear sensitive state immediately");
  assert.ok(timerIndex > invalidateIndex, "generation invalidation must happen before deferred reload");
  assert.ok(timerIndex > resetIndex, "sensitive state reset must happen before deferred reload");
});

test("mobile rebuilds and reconciles the shared crisis card behind the current owner/couple session fence", () => {
  const recoveryAdapter = sourceBetween(
    "function reconcileMobileAmoraCrisisRecovery",
    "function applyChatEvent",
  );
  const loadSession = sourceBetween(
    "async function loadChatSession",
    "async function findDurableUserMessage",
  );
  const streamAiRequest = sourceBetween(
    "async function streamAiRequest",
    "async function sendAiDraft",
  );

  assert.match(sourceText, /from "@hanbang\/shared\/amora-crisis-recovery"/);
  assert.match(recoveryAdapter, /message\.couple_id/);
  assert.match(recoveryAdapter, /message\.sender_id/);
  assert.match(recoveryAdapter, /in_reply_to_user_message_id/);
  assert.match(loadSession, /expectedSelfId === user\.id/);
  assert.match(loadSession, /setMessages\(reconcileMobileAmoraCrisisRecovery\([\s\S]*user\.id,[\s\S]*profile\.couple_id,[\s\S]*viewerRole/);
  assert.match(loadSession, /reconcileMobileAmoraCrisisRecovery\([\s\S]*mergeRealtimeMessage\([\s\S]*incomingRequestKey \?\? null[\s\S]*user\.id,[\s\S]*profile\.couple_id,[\s\S]*viewerRole/);
  assert.match(streamAiRequest, /response_origin === "deterministic_crisis_safety"[\s\S]*in_reply_to_user_message_id: request\.body\.userMessageId/);
  assert.match(streamAiRequest, /reconcileMobileAmoraCrisisRecovery\([\s\S]*request\.body\.coupleId/);
  assert.doesNotMatch(recoveryAdapter, /console\.|metadata:[\s\S]*message\.content/);
});

test("mobile presents recovered crisis guidance as a dedicated accessible safety card", () => {
  const renderMessage = sourceBetween(
    "function renderMessage",
    "const isP = activeScope",
  );

  assert.match(renderMessage, /const isPinnedSafetyCard = item\.metadata\?\.pinned_safety_card === true/);
  assert.match(renderMessage, /accessibilityRole="alert"/);
  assert.match(renderMessage, /accessibilityLiveRegion="assertive"/);
  assert.match(renderMessage, /st\.safetyCard/);
  assert.match(renderMessage, /st\.safetyCardText/);
});
