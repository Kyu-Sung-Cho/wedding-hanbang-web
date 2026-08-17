import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

import {
  isPersistedFirstUseSourceMessageId,
  validateFirstUsePromotionIngestReceipt,
} from "../lib/amoraFirstUsePromotion.mjs";
import {
  readScheduleCareFollowUpBindingFromMetadata,
  validateScheduleCareFollowUpIngestReceipt,
} from "../lib/scheduleCarePrivateFollowUp.mjs";

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
  "parseChatRetryPolicy",
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

function loadAiMessageIngestContract() {
  const ingestFunctionNames = new Set([
    "normalizeChatVisibility",
    "isRecord",
    "asToolExecutionResult",
    "asChatMessageMetadata",
    "chatMessageFromRealtimeRow",
    "parseAiMessageIngestResult",
    "parseRetryAfterMs",
    "getAiMessageIngestFailureMessage",
    "getEphemeralSafetyPersistencePresentation",
  ]);
  const declarations = sourceFile.statements
    .filter((statement) =>
      (ts.isClassDeclaration(statement) && statement.name?.text === "AiMessageIngestError")
      || (
        ts.isFunctionDeclaration(statement)
        && statement.name
        && ingestFunctionNames.has(statement.name.text)
      )
    )
    .map((statement) => statement.getFullText(sourceFile))
    .join("\n");
  const transpiled = ts.transpileModule(declarations, {
    compilerOptions: {
      module: ts.ModuleKind.None,
      target: ts.ScriptTarget.ES2022,
    },
  });
  return new Function(
    "isPersistedFirstUseSourceMessageId",
    "validateFirstUsePromotionIngestReceipt",
    "validateScheduleCareFollowUpIngestReceipt",
    `${transpiled.outputText}\nreturn { AiMessageIngestError, parseAiMessageIngestResult, parseRetryAfterMs, getAiMessageIngestFailureMessage, getEphemeralSafetyPersistencePresentation };`,
  )(
    isPersistedFirstUseSourceMessageId,
    validateFirstUsePromotionIngestReceipt,
    validateScheduleCareFollowUpIngestReceipt,
  );
}

function loadAiMessageIngestRecoveryContract() {
  const recoveryFunctionNames = new Set([
    "isRecord",
    "parseAiMessageIngestResult",
    "getAiMessageIngestRecovery",
  ]);
  const hasRecoveryFunction = sourceFile.statements.some((statement) =>
    ts.isFunctionDeclaration(statement)
    && statement.name?.text === "getAiMessageIngestRecovery"
  );
  if (!hasRecoveryFunction) return null;
  const declarations = sourceFile.statements
    .filter((statement) =>
      (ts.isClassDeclaration(statement) && statement.name?.text === "AiMessageIngestError")
      || (
        ts.isFunctionDeclaration(statement)
        && statement.name
        && recoveryFunctionNames.has(statement.name.text)
      )
    )
    .map((statement) => statement.getFullText(sourceFile))
    .join("\n");
  const transpiled = ts.transpileModule(declarations, {
    compilerOptions: {
      module: ts.ModuleKind.None,
      target: ts.ScriptTarget.ES2022,
    },
  });
  return new Function(
    "isPersistedFirstUseSourceMessageId",
    "validateFirstUsePromotionIngestReceipt",
    "validateScheduleCareFollowUpIngestReceipt",
    `${transpiled.outputText}\nreturn { AiMessageIngestError, parseAiMessageIngestResult, getAiMessageIngestRecovery };`,
  )(
    isPersistedFirstUseSourceMessageId,
    validateFirstUsePromotionIngestReceipt,
    validateScheduleCareFollowUpIngestReceipt,
  );
}

function loadAiMessageIngestRequest({ fetchImpl }) {
  const requestDeclarations = sourceFile.statements
    .filter((statement) =>
      (ts.isClassDeclaration(statement) && statement.name?.text === "AiMessageIngestError")
      || (
        ts.isFunctionDeclaration(statement)
        && (
          statement.name?.text === "requestAiMessageIngest"
          || statement.name?.text === "getAiMessageIngestRecovery"
        )
      )
    )
    .map((statement) => statement.getFullText(sourceFile))
    .join("\n");
  const transpiled = ts.transpileModule(requestDeclarations, {
    compilerOptions: {
      module: ts.ModuleKind.None,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const supabase = {
    auth: {
      getSession: async () => ({
        data: {
          session: {
            access_token: "access-token",
            user: { id: "22222222-2222-4222-8222-222222222222" },
          },
        },
        error: null,
      }),
    },
  };
  const runtime = new Function(
    "supabase",
    "fetch",
    "assertAmoraRequestActor",
    "parseAiMessageIngestResult",
    "parseRetryAfterMs",
    `const API_BASE = "https://hanbang.ai";\nconst CHAT_INGEST_TIMEOUT_MS = 30000;\n${transpiled.outputText}\nreturn { requestAiMessageIngest, getAiMessageIngestRecovery };`,
  )(
    supabase,
    fetchImpl,
    (expected, actual) => assert.equal(actual, expected),
    (_status, _payload, expected) => ({
      outcome: "persisted",
      reused: false,
      effectiveVisibility: "shared",
      safetyPrivacyRedirected: false,
      message: {
        id: "44444444-4444-4444-8444-444444444444",
        couple_id: expected.coupleId,
        sender_id: expected.userId,
        role: "user",
        sender_type: expected.senderType,
        content: expected.text,
        metadata: { client_request_id: expected.clientRequestId },
        created_at: "2026-08-12T00:00:00.000Z",
        visibility: "shared",
      },
    }),
    () => null,
  );
  return Object.assign(runtime.requestAiMessageIngest, {
    getRecovery: runtime.getAiMessageIngestRecovery,
  });
}

function loadChatSendOperationGuard() {
  const declaration = sourceFile.statements.find((statement) =>
    ts.isFunctionDeclaration(statement)
    && statement.name?.text === "createChatSendOperationGuard"
  );
  if (!declaration) return null;
  const transpiled = ts.transpileModule(declaration.getFullText(sourceFile), {
    compilerOptions: {
      module: ts.ModuleKind.None,
      target: ts.ScriptTarget.ES2022,
    },
  });
  return new Function(
    `${transpiled.outputText}\nreturn createChatSendOperationGuard;`,
  )();
}

function loadColdStartAiRecoveryContract() {
  const recoveryFunctionNames = new Set([
    "isRecord",
    "mergeColdStartRecoveryHistory",
    "findColdStartAiRecovery",
  ]);
  const declarations = sourceFile.statements
    .filter((statement) =>
      ts.isFunctionDeclaration(statement)
      && statement.name
      && recoveryFunctionNames.has(statement.name.text)
    )
    .map((statement) => statement.getFullText(sourceFile))
    .join("\n");
  const transpiled = ts.transpileModule(declarations, {
    compilerOptions: {
      module: ts.ModuleKind.None,
      target: ts.ScriptTarget.ES2022,
    },
  });
  return new Function(
    "readScheduleCareFollowUpBindingFromMetadata",
    `${transpiled.outputText}\nreturn { mergeColdStartRecoveryHistory, findColdStartAiRecovery };`,
  )(readScheduleCareFollowUpBindingFromMetadata);
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

test("a completed safety SSE preserves guidance while reporting an unconfirmed durable fence", () => {
  const metadata = [];
  const parser = createChatStreamParser(
    () => {},
    () => {},
    (value) => metadata.push(value),
  );
  parser.push(`data: ${JSON.stringify({
    type: "done",
    fullContent: "지금은 안전한 곳으로 이동하고 112에 도움을 요청해 주세요.",
    metadata: {
      response_origin: "deterministic_crisis_safety",
      durable_safety_fence_confirmed: false,
      persistence_status: "unconfirmed_ephemeral_fallback",
    },
  })}\n\n`);

  assert.equal(
    parser.finish(),
    "지금은 안전한 곳으로 이동하고 112에 도움을 요청해 주세요.",
  );
  assert.deepEqual(metadata, [{
    response_origin: "deterministic_crisis_safety",
    durable_safety_fence_confirmed: false,
    persistence_status: "unconfirmed_ephemeral_fallback",
  }]);
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

test("stream error preserves the explicit first-use regeneration policy", () => {
  const parser = createChatStreamParser(() => {});
  parser.push(`data: ${JSON.stringify({
    type: "error",
    code: "AMORA_FIRST_USE_PROMOTION_STALE",
    message: "private currentness detail",
    retryable: false,
    retryPolicy: "regenerate_first_use_action",
  })}\n\n`);

  assert.throws(
    () => parser.finish(),
    (error) => {
      assert.ok(error instanceof ChatTransportError);
      assert.equal(error.serverCode, "AMORA_FIRST_USE_PROMOTION_STALE");
      assert.equal(error.retryable, false);
      assert.equal(error.retryPolicy, "regenerate_first_use_action");
      assert.equal(error.message.includes("private currentness detail"), false);
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

test("XHR chat transport binds the immutable operation owner with the generic mutation headers", async () => {
  const requestHeaders = new Map();
  class FakeXMLHttpRequest {
    status = 200;
    responseText = "data: {\"type\":\"done\",\"fullContent\":\"완료\"}\n\n";
    timeout = 0;
    open() {}
    setRequestHeader(name, value) { requestHeaders.set(name, value); }
    abort() { this.onabort?.(); }
    send() { this.onload?.(); }
  }

  const original = globalThis.XMLHttpRequest;
  globalThis.XMLHttpRequest = FakeXMLHttpRequest;
  try {
    await streamChatWithXhr(
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
      "22222222-2222-4222-8222-222222222222",
    );

    assert.equal(requestHeaders.get("X-Hanbang-Mutation-Contract-Version"), "2");
    assert.equal(
      requestHeaders.get("X-Hanbang-Expected-Actor-User-Id"),
      "22222222-2222-4222-8222-222222222222",
    );
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

test("XHR first-use refusal preserves regeneration instead of becoming a generic dead end", async () => {
  class FakeXMLHttpRequest {
    status = 409;
    responseText = JSON.stringify({
      error: "private promotion currentness detail",
      code: "AMORA_FIRST_USE_PROMOTION_REQUIRED",
      retryable: false,
      retryPolicy: "regenerate_first_use_action",
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
        assert.equal(error.status, 409);
        assert.equal(error.serverCode, "AMORA_FIRST_USE_PROMOTION_REQUIRED");
        assert.equal(error.retryable, false);
        assert.equal(error.retryPolicy, "regenerate_first_use_action");
        assert.equal(error.message.includes("private promotion currentness detail"), false);
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
  const messagePresentation = sourceBetween(
    "function getMobileChatMessagePresentation",
    "function asChatMessageMetadata",
  );

  assert.ok(streamAiRequest.includes("reconcileChatStreamUpdate"));
  assert.ok(streamAiRequest.includes("toolResults"));
  assert.ok(streamAiRequest.includes("metadata"));
  assert.ok(messagePresentation.includes('result.toolName === "search_nearby_places"'));
  assert.ok(renderMessage.includes("getMobileChatMessagePresentation"));
  assert.ok(renderMessage.includes("<PlaceCards"));
});

test("AI transport stays behind the durable user-message gate", () => {
  const sendAiDraft = sourceBetween(
    "async function sendAiDraft",
    "async function handleRetry",
  );
  const ingestGate = sendAiDraft.search(
    /await requestAiMessageIngest\(\s*draft,\s*operation\.controller\.signal/u,
  );
  const durableGate = sendAiDraft.indexOf("durableMessage = ingestResult.message");
  const transportCall = sendAiDraft.indexOf("await streamAiRequest(request, operation)");
  const inputClear = sendAiDraft.indexOf("setInputByLane((current)");
  const ephemeralBranch = sendAiDraft.slice(
    sendAiDraft.indexOf('if (ingestResult.outcome === "ephemeral_safety")'),
    durableGate,
  );

  assert.ok(ingestGate >= 0);
  assert.ok(durableGate > ingestGate);
  assert.ok(transportCall > durableGate);
  assert.ok(inputClear > ingestGate);
  assert.match(ephemeralBranch, /setMessages\(/);
  assert.match(ephemeralBranch, /return;/);
  assert.doesNotMatch(ephemeralBranch, /streamAiRequest|requestChatStream/);
  assert.equal(sourceText.includes("apiFetch("), false);
});

test("manual AI retry reuses the stored request instead of generating a new id", () => {
  const retryHandler = sourceBetween(
    "async function handleRetry",
    "async function handleSend",
  );

  assert.ok(retryHandler.includes("await streamAiRequest(failure.request, operation)"));
  assert.equal(retryHandler.includes("Crypto.randomUUID()"), false);
});

test("AI retry continues from an existing canonical user row without re-ingesting it", () => {
  const aiSend = sourceBetween(
    "async function sendAiDraft",
    "async function handleRetry",
  );
  const durableLookup = aiSend.indexOf('await findDurableUserMessage(draft, "ai")');
  const missingDurableGate = aiSend.indexOf("if (!durableMessage) {");
  const ingestCall = aiSend.search(
    /await requestAiMessageIngest\(\s*draft,\s*operation\.controller\.signal/u,
  );
  const providerCall = aiSend.indexOf("await streamAiRequest(request, operation)");

  assert.ok(durableLookup >= 0);
  assert.ok(missingDurableGate > durableLookup);
  assert.ok(ingestCall > missingDurableGate);
  assert.ok(providerCall > ingestCall);
  assert.match(aiSend, /const effectiveVisibility = durableMessage\.visibility/);
  assert.doesNotMatch(
    aiSend.slice(durableLookup, missingDurableGate),
    /requestAiMessageIngest/,
  );
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

  assert.match(sendFailureType, /kind: "ai_insert"[\s\S]*canRetry: boolean[\s\S]*unavailableReason: string \| null/);
  assert.match(sendFailureType, /kind: "ai_response"[\s\S]*canRetry: boolean[\s\S]*unavailableReason: string \| null/);
  assert.match(streamAiRequest, /const canRetry = canRetrySameChatRequest\(error, timedOut\)/);
  assert.match(retryHandler, /if \(!failure\.canRetry\) return/);
  assert.match(sourceText, /activeSendFailure\.canRetry && \(/);
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

test("AI message ingest accepts a canonical W0/W1 persisted row", () => {
  const { AiMessageIngestError, parseAiMessageIngestResult } =
    loadAiMessageIngestContract();
  const expected = {
    coupleId: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    senderType: "bride",
    text: "예식장 비교 기준을 정리해줘",
    clientRequestId: "33333333-3333-4333-8333-333333333333",
    target: "ai",
    providerAttachmentCount: 0,
  };
  const message = {
    id: "44444444-4444-4444-8444-444444444444",
    couple_id: expected.coupleId,
    sender_id: expected.userId,
    role: "user",
    sender_type: expected.senderType,
    content: expected.text,
    metadata: {
      client_request_id: expected.clientRequestId,
      amora_ingest_contract_version: 1,
      ai_response_requested: true,
      provider_attachment_state: "none",
      provider_attachment_count: 0,
    },
    created_at: "2026-08-03T00:00:00.000Z",
    visibility: "shared",
  };

  const result = parseAiMessageIngestResult(201, {
    outcome: "persisted",
    reused: false,
    effectiveVisibility: "shared",
    safetyPrivacyRedirected: false,
    message,
  }, expected);

  assert.deepEqual(result, {
    outcome: "persisted",
    reused: false,
    effectiveVisibility: "shared",
    safetyPrivacyRedirected: false,
    safetyResolution: null,
    message,
  });
  const attachmentExpected = { ...expected, providerAttachmentCount: 2 };
  assert.equal(parseAiMessageIngestResult(201, {
    outcome: "persisted",
    reused: false,
    effectiveVisibility: "shared",
    safetyPrivacyRedirected: false,
    message: {
      ...message,
      metadata: {
        ...message.metadata,
        provider_attachment_state: "present",
        provider_attachment_count: 2,
      },
    },
  }, attachmentExpected).message.id, message.id);
  assert.throws(
    () => parseAiMessageIngestResult(201, {
      outcome: "persisted",
      reused: false,
      effectiveVisibility: "shared",
      safetyPrivacyRedirected: false,
      message: {
        ...message,
        metadata: {
          ...message.metadata,
          amora_ingest_contract_version: 0,
        },
      },
    }, expected),
    (error) => error instanceof AiMessageIngestError,
  );
  assert.throws(
    () => parseAiMessageIngestResult(201, {
      outcome: "persisted",
      reused: false,
      effectiveVisibility: "shared",
      safetyPrivacyRedirected: false,
      message: {
        ...message,
        metadata: { ...message.metadata, target: "unexpected" },
      },
    }, expected),
    (error) => error instanceof AiMessageIngestError,
  );
});

test("partner message ingest binds the canonical row to the exact target and recipient", () => {
  const { AiMessageIngestError, parseAiMessageIngestResult } = loadAiMessageIngestContract();
  const expected = {
    coupleId: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    senderType: "bride",
    text: "파트너에게만 전달할 메시지",
    clientRequestId: "33333333-3333-4333-8333-333333333333",
    target: "partner",
    providerAttachmentCount: 0,
    partnerRecipientId: "55555555-5555-4555-8555-555555555555",
  };
  const payload = {
    outcome: "persisted",
    reused: false,
    effectiveVisibility: "shared",
    safetyPrivacyRedirected: false,
    message: {
      id: "44444444-4444-4444-8444-444444444444",
      couple_id: expected.coupleId,
      sender_id: expected.userId,
      role: "user",
      sender_type: expected.senderType,
      content: expected.text,
      metadata: {
        target: "partner",
        client_request_id: expected.clientRequestId,
        partner_recipient_id: expected.partnerRecipientId,
        amora_ingest_contract_version: 1,
        ai_response_requested: false,
        provider_attachment_state: "none",
        provider_attachment_count: 0,
      },
      created_at: "2026-08-04T00:00:00.000Z",
      visibility: "shared",
    },
  };

  assert.equal(
    parseAiMessageIngestResult(201, payload, expected).message.id,
    payload.message.id,
  );
  for (const metadata of [
    { ...payload.message.metadata, target: "ai" },
    {
      ...payload.message.metadata,
      partner_recipient_id: "66666666-6666-4666-8666-666666666666",
    },
    { ...payload.message.metadata, ai_response_requested: true },
  ]) {
    assert.throws(
      () => parseAiMessageIngestResult(201, {
        ...payload,
        message: { ...payload.message, metadata },
      }, expected),
      (error) => error instanceof AiMessageIngestError,
    );
  }
});

test("AI message ingest accepts only the sender's canonical W2 private row", () => {
  const { AiMessageIngestError, parseAiMessageIngestResult } = loadAiMessageIngestContract();
  const expected = {
    coupleId: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    senderType: "bride",
    text: "상대가 무섭게 느껴져",
    clientRequestId: "33333333-3333-4333-8333-333333333333",
    target: "ai",
    providerAttachmentCount: 2,
  };
  const payload = {
    outcome: "persisted",
    reused: false,
    effectiveVisibility: "bride_private",
    safetyPrivacyRedirected: true,
    safetyResolution: "non_immediate_safety",
    message: {
      id: "44444444-4444-4444-8444-444444444444",
      couple_id: expected.coupleId,
      sender_id: expected.userId,
      role: "user",
      sender_type: expected.senderType,
      content: expected.text,
      metadata: {
        client_request_id: expected.clientRequestId,
        amora_ingest_contract_version: 1,
        ai_response_requested: true,
        provider_attachment_state: "discarded_by_safety_policy",
        provider_attachment_count: 0,
      },
      created_at: "2026-08-03T00:00:00.000Z",
      visibility: "bride_private",
    },
  };

  const result = parseAiMessageIngestResult(201, payload, expected);
  assert.equal(result.effectiveVisibility, "bride_private");
  assert.equal(result.safetyPrivacyRedirected, true);
  assert.equal(result.safetyResolution, "non_immediate_safety");

  const noAttachmentExpected = { ...expected, providerAttachmentCount: 0 };
  assert.equal(parseAiMessageIngestResult(201, {
    ...payload,
    message: {
      ...payload.message,
      metadata: {
        ...payload.message.metadata,
        provider_attachment_state: "none",
      },
    },
  }, noAttachmentExpected).message.id, payload.message.id);

  assert.throws(
    () => parseAiMessageIngestResult(201, {
      ...payload,
      safetyResolution: undefined,
    }, expected),
    (error) => error instanceof AiMessageIngestError,
  );

  assert.throws(
    () => parseAiMessageIngestResult(201, {
      ...payload,
      effectiveVisibility: "groom_private",
      message: { ...payload.message, visibility: "groom_private" },
    }, expected),
    (error) => error instanceof AiMessageIngestError
      && error.retryPolicy === "same_request",
  );
});

test("AI message ingest recognizes a server W5 ephemeral fallback without a durable row", () => {
  const { AiMessageIngestError, parseAiMessageIngestResult } = loadAiMessageIngestContract();
  const expected = {
    coupleId: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    senderType: "bride",
    text: "서버에서만 잡힌 고위험 입력",
    clientRequestId: "33333333-3333-4333-8333-333333333333",
    target: "ai",
  };
  const payload = {
    outcome: "ephemeral_safety",
    effectiveVisibility: "bride_private",
    safetyPrivacyRedirected: true,
    partnerDeliveryHeld: false,
    safetyResolution: "immediate_crisis",
    classification: "interpersonal_danger",
    response: "즉시 안전 안내",
    rawDisclosurePersisted: false,
    durableSafetyFenceConfirmed: true,
  };

  assert.deepEqual(parseAiMessageIngestResult(200, payload, expected), {
    ...payload,
    rawDisclosureVisibility: null,
  });
  assert.deepEqual(
    parseAiMessageIngestResult(200, {
      ...payload,
      safetyPrivacyRedirected: false,
    }, expected),
    {
      ...payload,
      safetyPrivacyRedirected: false,
      rawDisclosureVisibility: null,
    },
  );
  assert.throws(
    () => parseAiMessageIngestResult(200, {
      ...payload,
      rawDisclosurePersisted: "unknown",
    }, expected),
    (error) => error instanceof AiMessageIngestError,
  );
});

test("partner ingest accepts server-authoritative W2 and W5 holds without persistence", () => {
  const { AiMessageIngestError, parseAiMessageIngestResult } = loadAiMessageIngestContract();
  const expected = {
    coupleId: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    senderType: "bride",
    text: "서버의 최신 안전 분류가 잡은 파트너 메시지",
    clientRequestId: "33333333-3333-4333-8333-333333333333",
    target: "partner",
    partnerRecipientId: "55555555-5555-4555-8555-555555555555",
  };
  const basePayload = {
    outcome: "ephemeral_safety",
    effectiveVisibility: "bride_private",
    safetyPrivacyRedirected: true,
    partnerDeliveryHeld: true,
    classification: null,
    response: "상대방에게 보내지 않고 안전 안내를 보여드려요.",
    rawDisclosurePersisted: false,
    durableSafetyFenceConfirmed: true,
  };

  for (const safetyResolution of ["non_immediate_safety", "immediate_crisis"]) {
    const payload = { ...basePayload, safetyResolution };
    assert.deepEqual(parseAiMessageIngestResult(200, payload, expected), {
      ...payload,
      rawDisclosureVisibility: null,
    });
  }
  assert.throws(
    () => parseAiMessageIngestResult(200, {
      ...basePayload,
      safetyResolution: "non_immediate_safety",
      partnerDeliveryHeld: false,
    }, expected),
    (error) => error instanceof AiMessageIngestError,
  );
});

test("mobile safety sealing is bounded and ordinary chat uses the shared web threshold", () => {
  assert.match(sourceText, /MOBILE_DURABLE_SAFETY_SEAL_TIMEOUT_MS\s*=\s*4_000/u);
  const helper = sourceText.slice(
    sourceText.indexOf("async function sealDurableMediationPrivateSafetyHold"),
    sourceText.indexOf("const PARTNER_CONNECTION_CHANGED_NOTICE"),
  );
  assert.match(helper, /new AbortController\(\)/u);
  assert.match(helper, /signal:\s*timeoutController\.signal/u);
  assert.match(helper, /clearTimeout\(timeoutId\)/u);
  assert.match(sourceText, /externalSafetySignal:\s*hasAmoraChatSafetySignal\(text\)/u);
});

test("mobile deterministic safety guidance is committed before waiting for remote seal", () => {
  const mediation = sourceText.slice(
    sourceText.indexOf('if (mediationSafetyPlan.disposition === "local_safety_hold")'),
    sourceText.indexOf("const clientRequestId = Crypto.randomUUID()", sourceText.indexOf('if (mediationSafetyPlan.disposition === "local_safety_hold")')),
  );
  assert.ok(mediation.indexOf("setMessages") < mediation.indexOf("await sealDurableMediationPrivateSafetyHold"));
  assert.match(mediation, /durable_safety_fence_confirmed:\s*false/u);

  const ordinary = sourceText.slice(
    sourceText.indexOf("async function handleSend()"),
    sourceText.indexOf("async function handleConfirmSharedSend()"),
  );
  assert.ok(ordinary.indexOf("setMessages") < ordinary.indexOf("await sealDurableMediationPrivateSafetyHold"));
  assert.match(ordinary, /durable_safety_fence_confirmed:\s*false/u);
});

test("ephemeral safety validates prior-persistence visibility without inventing scope", () => {
  const { AiMessageIngestError, parseAiMessageIngestResult } = loadAiMessageIngestContract();
  const expected = {
    coupleId: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    senderType: "bride",
    text: "정책 변경 전 저장됐을 수 있는 안전 메시지",
    clientRequestId: "33333333-3333-4333-8333-333333333333",
    target: "partner",
    partnerRecipientId: "55555555-5555-4555-8555-555555555555",
  };
  const basePayload = {
    outcome: "ephemeral_safety",
    effectiveVisibility: "bride_private",
    safetyPrivacyRedirected: true,
    partnerDeliveryHeld: true,
    safetyResolution: "immediate_crisis",
    classification: "interpersonal_danger",
    durableSafetyFenceConfirmed: true,
    response: "즉시 안전 안내",
  };

  for (const rawDisclosureVisibility of ["shared", "bride_private"]) {
    const payload = {
      ...basePayload,
      rawDisclosurePersisted: true,
      rawDisclosureVisibility,
    };
    assert.deepEqual(parseAiMessageIngestResult(200, payload, expected), payload);
  }

  for (const rawDisclosurePersisted of [true, null]) {
    const payload = { ...basePayload, rawDisclosurePersisted };
    assert.deepEqual(parseAiMessageIngestResult(200, payload, expected), {
      ...payload,
      rawDisclosureVisibility: null,
    });
  }

  assert.throws(
    () => parseAiMessageIngestResult(200, {
      ...basePayload,
      rawDisclosurePersisted: true,
      rawDisclosureVisibility: "public",
    }, expected),
    (error) => error instanceof AiMessageIngestError,
  );
  assert.throws(
    () => parseAiMessageIngestResult(200, {
      ...basePayload,
      rawDisclosurePersisted: false,
      rawDisclosureVisibility: "shared",
    }, expected),
    (error) => error instanceof AiMessageIngestError,
  );
});

test("ephemeral safety derives truthful none, shared, private, and unknown presentation", () => {
  const { getEphemeralSafetyPersistencePresentation } = loadAiMessageIngestContract();
  const notStored = getEphemeralSafetyPersistencePresentation(false, null, true);
  const partnerShared = getEphemeralSafetyPersistencePresentation(true, null, true);
  const aiShared = getEphemeralSafetyPersistencePresentation(true, "shared", false);
  const privateOnly = getEphemeralSafetyPersistencePresentation(
    true,
    "bride_private",
    false,
  );
  const persistedUnknown = getEphemeralSafetyPersistencePresentation(true, null, false);
  const persistenceUnknown = getEphemeralSafetyPersistencePresentation(null, null, false);

  assert.equal(notStored.persistence, "none");
  assert.equal(notStored.rawDisclosureShared, false);
  assert.match(notStored.notice, /저장하지 않았어요/);

  for (const shared of [partnerShared, aiShared]) {
    assert.equal(shared.persistence, "shared");
    assert.equal(shared.rawDisclosureShared, true);
    assert.match(shared.notice, /상대방에게 전달·저장/);
    assert.doesNotMatch(shared.notice, /저장하지 않았어요/);
  }

  assert.equal(privateOnly.persistence, "private_only");
  assert.equal(privateOnly.rawDisclosureShared, false);
  assert.match(privateOnly.notice, /비공개 대화에 이미 저장/);

  assert.equal(persistedUnknown.persistence, "unknown");
  assert.equal(persistedUnknown.rawDisclosureShared, null);
  assert.match(persistedUnknown.notice, /이미 저장됐지만 저장 범위/);
  assert.doesNotMatch(persistedUnknown.notice, /저장하지 않았어요/);

  assert.equal(persistenceUnknown.persistence, "unknown");
  assert.equal(persistenceUnknown.rawDisclosureShared, null);
  assert.match(persistenceUnknown.notice, /이전 저장·전달 여부를 지금 확인하지 못했어요/);
  assert.doesNotMatch(persistenceUnknown.notice, /저장하지 않았어요/);
});

test("first-use ingest accepts only an opaque promotion receipt and source-bound reuse", () => {
  const { AiMessageIngestError, parseAiMessageIngestResult } = loadAiMessageIngestContract();
  const expected = {
    coupleId: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    senderType: "bride",
    text: "서버가 확정한 공동 실행 초안",
    clientRequestId: "33333333-3333-4333-8333-333333333333",
    target: "ai",
    providerAttachmentCount: 0,
    firstUseSourceMessageId: "44444444-4444-4444-8444-444444444444",
  };
  const message = {
    id: "55555555-5555-4555-8555-555555555555",
    couple_id: expected.coupleId,
    sender_id: expected.userId,
    role: "user",
    sender_type: expected.senderType,
    content: expected.text,
    metadata: {
      client_request_id: expected.clientRequestId,
      amora_ingest_contract_version: 1,
      ai_response_requested: true,
      provider_attachment_state: "none",
      provider_attachment_count: 0,
      amora_first_use_promotion_id: "66666666-6666-4666-8666-666666666666",
    },
    created_at: "2026-08-15T00:00:00.000Z",
    visibility: "shared",
  };

  assert.equal(parseAiMessageIngestResult(201, {
    outcome: "persisted",
    reused: false,
    effectiveVisibility: "shared",
    safetyPrivacyRedirected: false,
    message,
  }, expected).message.id, message.id);

  const sourceReused = {
    outcome: "persisted",
    reused: true,
    reusedBy: "first_use_source",
    effectiveVisibility: "shared",
    safetyPrivacyRedirected: false,
    message: {
      ...message,
      metadata: {
        ...message.metadata,
        client_request_id: "77777777-7777-4777-8777-777777777777",
      },
    },
  };
  assert.equal(
    parseAiMessageIngestResult(200, sourceReused, expected).message.id,
    message.id,
  );
  assert.throws(
    () => parseAiMessageIngestResult(200, {
      ...sourceReused,
      reusedBy: undefined,
    }, expected),
    (error) => error instanceof AiMessageIngestError,
  );
  assert.throws(
    () => parseAiMessageIngestResult(201, {
      outcome: "persisted",
      reused: false,
      effectiveVisibility: "shared",
      safetyPrivacyRedirected: false,
      message: {
        ...message,
        metadata: {
          ...message.metadata,
          amora_first_use_promotion_id: expected.firstUseSourceMessageId,
        },
      },
    }, expected),
    (error) => error instanceof AiMessageIngestError,
  );
});

test("AI message ingest accepts a reconciled 23505 row only as a reused 200 result", () => {
  const { AiMessageIngestError, parseAiMessageIngestResult } = loadAiMessageIngestContract();
  const expected = {
    coupleId: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    senderType: "bride",
    text: "같은 요청으로 저장 결과를 확인해줘",
    clientRequestId: "33333333-3333-4333-8333-333333333333",
    target: "ai",
    providerAttachmentCount: 0,
  };
  const payload = {
    outcome: "persisted",
    reused: true,
    effectiveVisibility: "shared",
    safetyPrivacyRedirected: false,
    message: {
      id: "44444444-4444-4444-8444-444444444444",
      couple_id: expected.coupleId,
      sender_id: expected.userId,
      role: "user",
      sender_type: expected.senderType,
      content: expected.text,
      metadata: {
        client_request_id: expected.clientRequestId,
        amora_ingest_contract_version: 1,
        ai_response_requested: true,
        provider_attachment_state: "none",
        provider_attachment_count: 0,
      },
      created_at: "2026-08-03T00:00:00.000Z",
      visibility: "shared",
    },
  };

  assert.equal(parseAiMessageIngestResult(200, payload, expected).reused, true);
  assert.throws(
    () => parseAiMessageIngestResult(201, payload, expected),
    (error) => error instanceof AiMessageIngestError,
  );
});

test("aborting a mobile send aborts the durable message ingest request", async () => {
  let capturedSignal;
  let releaseFetch;
  const fetchResponse = new Promise((resolve) => {
    releaseFetch = resolve;
  });
  const requestAiMessageIngest = loadAiMessageIngestRequest({
    fetchImpl: async (_url, init) => {
      capturedSignal = init.signal;
      return fetchResponse;
    },
  });
  const sendController = new globalThis.AbortController();
  const request = requestAiMessageIngest({
    coupleId: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    senderType: "bride",
    text: "이 전송을 중단해줘",
    clientRequestId: "33333333-3333-4333-8333-333333333333",
    target: "ai",
    requestedVisibility: "shared",
    visibility: "shared",
    providerAttachmentCount: 0,
    sessionGeneration: 1,
  }, sendController.signal);

  await Promise.resolve();
  await Promise.resolve();
  assert.ok(capturedSignal);
  sendController.abort();
  const ingestWasAborted = capturedSignal.aborted;
  releaseFetch({
    status: 201,
    json: async () => ({}),
    headers: { get: () => null },
  });
  await request;

  assert.equal(ingestWasAborted, true);
});

test("mobile ingest sends a private first-use source id only on the bound draft", async () => {
  const capturedBodies = [];
  const requestAiMessageIngest = loadAiMessageIngestRequest({
    fetchImpl: async (_url, init) => {
      capturedBodies.push(JSON.parse(init.body));
      return {
        status: 201,
        json: async () => ({}),
        headers: { get: () => null },
      };
    },
  });
  const baseDraft = {
    coupleId: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    senderType: "bride",
    text: "서버가 확정한 공동 실행 초안",
    clientRequestId: "33333333-3333-4333-8333-333333333333",
    target: "ai",
    requestedVisibility: "shared",
    visibility: "shared",
    providerAttachmentCount: 0,
    sessionGeneration: 1,
  };
  const sourceMessageId = "44444444-4444-4444-8444-444444444444";

  await requestAiMessageIngest({
    ...baseDraft,
    firstUseSourceMessageId: sourceMessageId,
  });
  await requestAiMessageIngest({
    ...baseDraft,
    clientRequestId: "55555555-5555-4555-8555-555555555555",
  });

  assert.equal(capturedBodies[0].firstUseSourceMessageId, sourceMessageId);
  assert.equal("firstUseSourceMessageId" in capturedBodies[1], false);
});

test("v2 mobile actor binding remains body-compatible with the legacy ingest server", async () => {
  let capturedInit;
  const requestAiMessageIngest = loadAiMessageIngestRequest({
    fetchImpl: async (_url, init) => {
      capturedInit = init;
      return {
        status: 201,
        json: async () => ({}),
        headers: { get: () => null },
      };
    },
  });
  await requestAiMessageIngest({
    coupleId: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    senderType: "bride",
    text: "계정 전환 없이 안전하게 보내줘",
    clientRequestId: "33333333-3333-4333-8333-333333333333",
    target: "ai",
    requestedVisibility: "shared",
    visibility: "shared",
    providerAttachmentCount: 0,
    sessionGeneration: 1,
  });

  assert.equal(capturedInit.headers["X-Amora-Ingest-Contract-Version"], "2");
  assert.equal(
    capturedInit.headers["X-Amora-Expected-Actor-User-Id"],
    "22222222-2222-4222-8222-222222222222",
  );
  assert.equal(capturedInit.headers["X-Hanbang-Mutation-Contract-Version"], "2");
  assert.equal(
    capturedInit.headers["X-Hanbang-Expected-Actor-User-Id"],
    "22222222-2222-4222-8222-222222222222",
  );
  const body = JSON.parse(capturedInit.body);
  assert.equal("expectedActorUserId" in body, false);
  assert.deepEqual(Object.keys(body).sort(), [
    "clientRequestId",
    "content",
    "coupleId",
    "providerAttachmentCount",
    "requestedVisibility",
    "target",
  ]);
});

test("a stopped send cannot finish over a newer mobile chat operation", () => {
  const createChatSendOperationGuard = loadChatSendOperationGuard();
  assert.equal(typeof createChatSendOperationGuard, "function");
  const guard = createChatSendOperationGuard();
  const stoppedOperation = guard.start(7);

  assert.equal(guard.stopActive("user"), stoppedOperation);
  assert.equal(stoppedOperation.controller.signal.aborted, true);
  assert.equal(stoppedOperation.stopReason, "user");
  assert.equal(
    guard.current(),
    stoppedOperation,
    "the stopped operation must own the lock until its async work settles",
  );

  const currentOperation = guard.start(7);
  assert.equal(guard.finish(stoppedOperation), false);
  assert.equal(guard.current(), currentOperation);
  assert.equal(currentOperation.controller.signal.aborted, false);
  assert.equal(guard.finish(currentOperation), true);
  assert.equal(guard.current(), null);
});

test("an ingest stop stays locked while abort settlement is deliberately delayed", async () => {
  const createChatSendOperationGuard = loadChatSendOperationGuard();
  const guard = createChatSendOperationGuard();
  const operation = guard.start(11);
  operation.phase = "ingest";
  let releaseSettlement;
  const delayedSettlement = new Promise((resolve) => {
    releaseSettlement = resolve;
  });
  const finishAfterSettlement = delayedSettlement.then(() => guard.finish(operation));

  guard.stopActive("user");
  assert.equal(operation.controller.signal.aborted, true);
  assert.equal(guard.current(), operation);
  let finished = false;
  void finishAfterSettlement.then(() => {
    finished = true;
  });
  await Promise.resolve();
  assert.equal(finished, false);
  assert.equal(guard.current(), operation);

  releaseSettlement();
  assert.equal(await finishAfterSettlement, true);
  assert.equal(guard.current(), null);
});

test("first-use correction and skip invalidate the exact pending preview before it can stage a draft", () => {
  const choiceHandlers = sourceBetween(
    "function handleCorrectFirstUseAction",
    "function handleRestoreFirstUseAction",
  );
  const continueHandler = sourceBetween(
    "async function handleContinueFirstUseAction",
    "function renderMessage",
  );

  assert.match(
    choiceHandlers,
    /handleCorrectFirstUseAction\(sourceMessageId: string\)[\s\S]*firstUsePromotionOperationGuardRef\.current\.cancel\(sourceMessageId\)/u,
  );
  assert.match(
    choiceHandlers,
    /handleSkipFirstUseAction\(sourceMessageId: string\)[\s\S]*firstUsePromotionOperationGuardRef\.current\.cancel\(sourceMessageId\)/u,
  );
  assert.match(continueHandler, /signal: operation\.controller\.signal/u);
  assert.match(
    continueHandler,
    /!firstUsePromotionOperationGuardRef\.current\.isCurrent\(operation\)[\s\S]*return/u,
  );
  assert.doesNotMatch(choiceHandlers, /setActiveScope\("shared"\)|setTarget\("partner"\)/u);
});

test("first-use refusal offers an explicit private regeneration CTA without automatic writes", () => {
  const streamHandler = sourceBetween(
    "async function streamAiRequest",
    "async function sendAiDraft",
  );
  const ingestHandler = sourceBetween(
    "async function sendAiDraft",
    "async function handleOpenMediationRequest",
  );
  const recoveryHandler = sourceBetween(
    "function handleRegenerateFirstUseAction",
    "async function handleSend",
  );
  const failureSurface = sourceBetween(
    "{!hasActiveW5SafetyCard && activeSendFailure",
    "<View style={[st.inputBar",
  );

  assert.match(streamHandler, /getFirstUsePromotionSendRecovery\(\{/u);
  assert.match(streamHandler, /firstUseRecovery,/u);
  assert.match(ingestHandler, /getFirstUsePromotionSendRecovery\(\{/u);
  assert.match(ingestHandler, /firstUseRecovery,/u);
  assert.match(recoveryHandler, /firstUseComposerBindingRef\.current = null/u);
  assert.match(recoveryHandler, /setPromotedFirstUseMessageId\(null\)/u);
  assert.match(recoveryHandler, /setActiveScope\("private"\)/u);
  assert.match(recoveryHandler, /setTarget\("ai"\)/u);
  assert.doesNotMatch(
    recoveryHandler,
    /handleSend|sendAiDraft|requestAiMessageIngest|fetch\(|supabase|setActiveScope\("shared"\)/u,
  );
  assert.match(failureSurface, /activeFirstUseSendRecovery\.actionLabel/u);
  assert.match(failureSurface, /onPress=\{handleRegenerateFirstUseAction\}/u);
  assert.match(failureSurface, /나만 상담에서 첫 실행 제안 다시 만들기/u);
  assert.match(failureSurface, /자동으로 보내거나 저장하지 않고 개인 상담의 확인 카드로 돌아갑니다/u);
});

test("mobile Stop owns the current send from durable ingest through AI streaming", () => {
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
    "async function handleColdStartAiRecovery",
  );
  const stopHandler = sourceBetween(
    "function handleStop",
    "function handleInputChange",
  );
  const composer = sourceBetween(
    "<View style={[st.inputBar",
    "</KeyboardAvoidingView>",
  );

  assert.match(sourceText, /useRef\(createChatSendOperationGuard\(\)\)/u);
  assert.match(partnerSend, /requestAiMessageIngest\(\s*draft,\s*operation\.controller\.signal/u);
  assert.match(aiSend, /requestAiMessageIngest\(\s*draft,\s*operation\.controller\.signal/u);
  assert.match(aiSend, /streamAiRequest\(request, operation\)/u);
  assert.match(aiStream, /requestChatStream\([\s\S]*operation\.controller\.signal/u);
  assert.match(stopHandler, /stopActive\("user"\)/u);
  assert.match(stopHandler, /stoppedOperation\.phase === "ingest"[\s\S]*return/u);
  assert.match(stopHandler, /finishChatSendOperation\(stoppedOperation\)/u);
  assert.doesNotMatch(stopHandler, /setStreaming\(false\)|sendingRef\.current = false/u);
  assert.match(composer, /streaming \? \(/u);
  assert.match(composer, /onPress=\{handleStop\}/u);
  assert.match(composer, /accessibilityRole="button"/u);
  assert.match(composer, /accessibilityLabel="현재 메시지 전송 중단"/u);
  assert.match(composer, />중단<\/Text>/u);
});

test("Stop during durable ingest keeps the immutable request until persistence is reconciled", () => {
  const sendFailureType = sourceBetween(
    "type SendFailure",
    "type PartnerRecipientVerification",
  );
  const partnerSend = sourceBetween(
    "async function sendPartnerDraft",
    "async function streamAiRequest",
  );
  const aiSend = sourceBetween(
    "async function sendAiDraft",
    "async function handleColdStartAiRecovery",
  );
  const sendHandler = sourceBetween(
    "async function handleSend",
    "function handleStop",
  );
  const inputHandler = sourceBetween(
    "function handleInputChange",
    "function handleTargetChange",
  );
  const retryHandler = sourceBetween(
    "async function handleRetry",
    "async function handleSend",
  );

  assert.match(sendFailureType, /requiresReconciliation: boolean/u);
  for (const sender of [partnerSend, aiSend]) {
    assert.match(sender, /operation\.phase = "ingest"/u);
    assert.match(sender, /operation\.stopReason === "user"[\s\S]*requiresReconciliation: true/u);
    assert.match(sender, /draft,[\s\S]*canRetry: true/u);
    assert.doesNotMatch(sender, /보내지 않았/u);
  }
  assert.match(sendHandler, /pendingIngestReconciliation/u);
  assert.match(inputHandler, /failure\?\.requiresReconciliation/u);
  assert.match(retryHandler, /failure\.draft/u);
  assert.doesNotMatch(retryHandler, /Crypto\.randomUUID/u);
  assert.match(sourceText, /저장 여부를 확인하고 이어가기/u);
});

test("stopping a reconciliation retry cannot clear its immutable-request fence early", () => {
  const partnerSend = sourceBetween(
    "async function sendPartnerDraft",
    "async function streamAiRequest",
  );
  const aiSend = sourceBetween(
    "async function sendAiDraft",
    "async function handleColdStartAiRecovery",
  );
  const durableLookup = aiSend.indexOf('await findDurableUserMessage(draft, "ai")');
  const firstAiFailureClear = aiSend.indexOf("setLaneFailure(draftLane, null)");

  assert.ok(durableLookup >= 0);
  assert.ok(
    firstAiFailureClear > durableLookup,
    "the reconciliation fence must survive until the canonical lookup is known",
  );
  assert.doesNotMatch(
    partnerSend,
    /setLaneFailure\(lane, null\);\s*try \{\s*const recipientVerification/u,
  );
  assert.match(
    partnerSend,
    /const durableMessage = ingestResult\.message;[\s\S]*setLaneFailure\(lane, null\)/u,
  );
});

test("AI message ingest binds a shared confirmed action to the canonical metadata", () => {
  const { AiMessageIngestError, parseAiMessageIngestResult } = loadAiMessageIngestContract();
  const expected = {
    coupleId: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    senderType: "bride",
    text: "제안한 변경을 적용해줘",
    clientRequestId: "33333333-3333-4333-8333-333333333333",
    target: "ai",
    providerAttachmentCount: 0,
    confirmedActionId: "55555555-5555-4555-8555-555555555555",
  };
  const baseMessage = {
    id: "44444444-4444-4444-8444-444444444444",
    couple_id: expected.coupleId,
    sender_id: expected.userId,
    role: "user",
    sender_type: expected.senderType,
    content: expected.text,
    metadata: {
      client_request_id: expected.clientRequestId,
      confirmed_amora_action_id: expected.confirmedActionId,
      amora_ingest_contract_version: 1,
      ai_response_requested: true,
      provider_attachment_state: "none",
      provider_attachment_count: 0,
    },
    created_at: "2026-08-03T00:00:00.000Z",
    visibility: "shared",
  };
  const payload = {
    outcome: "persisted",
    reused: false,
    effectiveVisibility: "shared",
    safetyPrivacyRedirected: false,
    message: baseMessage,
  };

  assert.equal(
    parseAiMessageIngestResult(201, payload, expected)
      .message.metadata.confirmed_amora_action_id,
    expected.confirmedActionId,
  );
  assert.throws(
    () => parseAiMessageIngestResult(201, {
      ...payload,
      message: {
        ...baseMessage,
        metadata: {
          ...baseMessage.metadata,
          confirmed_amora_action_id: "66666666-6666-4666-8666-666666666666",
        },
      },
    }, expected),
    (error) => error instanceof AiMessageIngestError,
  );
});

test("AI message ingest marks a 409 idempotency conflict as new-message-only", () => {
  const { AiMessageIngestError, parseAiMessageIngestResult } = loadAiMessageIngestContract();
  const expected = {
    coupleId: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    senderType: "bride",
    text: "충돌한 요청",
    clientRequestId: "33333333-3333-4333-8333-333333333333",
    target: "ai",
  };

  assert.throws(
    () => parseAiMessageIngestResult(409, {
      error: "같은 요청 식별자가 다른 메시지에 이미 사용되었어요.",
      code: "USER_MESSAGE_REQUEST_CONFLICT",
      retryable: false,
      retryPolicy: "new_message",
    }, expected),
    (error) => {
      assert.ok(error instanceof AiMessageIngestError);
      assert.equal(error.status, 409);
      assert.equal(error.serverCode, "USER_MESSAGE_REQUEST_CONFLICT");
      assert.equal(error.retryable, false);
      assert.equal(error.retryPolicy, "new_message");
      return true;
    },
  );
});

test("AI message ingest preserves the exact request after an explicit 503 same-request result", () => {
  const { AiMessageIngestError, parseAiMessageIngestResult } = loadAiMessageIngestContract();
  const expected = {
    coupleId: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    senderType: "bride",
    text: "저장 결과가 불확실한 요청",
    clientRequestId: "33333333-3333-4333-8333-333333333333",
    target: "ai",
  };

  assert.throws(
    () => parseAiMessageIngestResult(503, {
      error: "저장 결과를 확인하지 못했어요.",
      code: "USER_MESSAGE_PERSISTENCE_UNKNOWN",
      retryable: false,
      retryPolicy: "same_request",
    }, expected),
    (error) => {
      assert.ok(error instanceof AiMessageIngestError);
      assert.equal(error.status, 503);
      assert.equal(error.serverCode, "USER_MESSAGE_PERSISTENCE_UNKNOWN");
      assert.equal(error.retryable, true);
      assert.equal(error.retryPolicy, "same_request");
      return true;
    },
  );
});

test("AI message ingest maps first-use stale and currentness refusals to private regeneration", () => {
  const { AiMessageIngestError, parseAiMessageIngestResult } = loadAiMessageIngestContract();
  const expected = {
    coupleId: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    senderType: "bride",
    text: "검토한 공동 초안",
    clientRequestId: "33333333-3333-4333-8333-333333333333",
    target: "ai",
  };

  for (const [status, code, retryPolicy] of [
    [409, "FIRST_USE_PROMOTION_STALE", undefined],
    [409, "FIRST_USE_PROMOTION_CRITERION_STALE", undefined],
    [403, "FIRST_USE_PROMOTION_IDENTITY_CHANGED", undefined],
    [409, "AMORA_FIRST_USE_PROMOTION_REQUIRED", "regenerate_first_use_action"],
  ]) {
    assert.throws(
      () => parseAiMessageIngestResult(status, {
        code,
        ...(retryPolicy ? { retryPolicy } : {}),
      }, expected),
      (error) => {
        assert.ok(error instanceof AiMessageIngestError);
        assert.equal(error.serverCode, code);
        assert.equal(error.retryable, false);
        assert.equal(error.retryPolicy, "regenerate_first_use_action");
        return true;
      },
    );
  }
});

test("AI message ingest explains first-use regeneration without suggesting a blind resend", () => {
  const {
    AiMessageIngestError,
    getAiMessageIngestFailureMessage,
    parseAiMessageIngestResult,
  } = loadAiMessageIngestContract();
  const expected = {
    coupleId: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    senderType: "bride",
    text: "수정한 공동 초안",
    clientRequestId: "33333333-3333-4333-8333-333333333333",
    target: "ai",
  };

  assert.throws(
    () => parseAiMessageIngestResult(409, {
      code: "FIRST_USE_PROMOTION_STALE",
    }, expected),
    (error) => {
      assert.ok(error instanceof AiMessageIngestError);
      assert.equal(
        getAiMessageIngestFailureMessage(error, false),
        "이 행동을 우리 준비에 추가하거나 적용하지 않았어요. 최신 준비 상태와 다시 맞추려면 나만 상담에서 한 가지 제안을 다시 확인해 주세요.",
      );
      return true;
    },
  );
});

test("an ambiguous 504 ingest requires reconciliation of the same immutable request", () => {
  const contract = loadAiMessageIngestRecoveryContract();
  assert.ok(contract);
  const expected = {
    coupleId: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    senderType: "bride",
    text: "응답 전에 게이트웨이가 끊긴 요청",
    clientRequestId: "33333333-3333-4333-8333-333333333333",
    target: "ai",
  };

  let ingestError;
  try {
    contract.parseAiMessageIngestResult(504, { code: "EDGE_TIMEOUT" }, expected);
    assert.fail("expected the uncertain 504 result to fail");
  } catch (error) {
    ingestError = error;
  }

  assert.deepEqual(contract.getAiMessageIngestRecovery(ingestError, false), {
    canRetry: true,
    requiresReconciliation: true,
  });
});

test("partner and AI ingest failures persist the reconciliation requirement", () => {
  const partnerSend = sourceBetween(
    "async function sendPartnerDraft",
    "async function streamAiRequest",
  );
  const aiSend = sourceBetween(
    "async function sendAiDraft",
    "async function handleColdStartAiRecovery",
  );

  for (const sender of [partnerSend, aiSend]) {
    assert.match(
      sender,
      /const recovery = getAiMessageIngestRecovery\(error, (?:true|false)\)/u,
    );
    assert.match(sender, /canRetry: recovery\.canRetry/u);
    assert.match(
      sender,
      /requiresReconciliation: recovery\.requiresReconciliation/u,
    );
  }
});

test("an unresolved ingest reconciliation locks every new-request composer path", () => {
  const stateSetup = sourceBetween(
    "const [sendFailuresByLane",
    "const [quotaRemaining",
  );
  const retryHandler = sourceBetween(
    "async function handleRetry",
    "async function handleSend",
  );
  const sendHandler = sourceBetween(
    "async function handleSend",
    "async function handleConfirmSharedSend",
  );
  const inputHandler = sourceBetween(
    "function handleInputChange",
    "function handleTargetChange",
  );
  const moveToPrivateHandler = sourceBetween(
    "function handleMoveSharedSendToPrivate",
    "function handleStop",
  );
  const targetHandler = sourceBetween(
    "function handleTargetChange",
    "function handleAiSuggestion",
  );
  const suggestionHandler = sourceBetween(
    "function handleAiSuggestion",
    "async function handleApplyPendingAction",
  );
  const applyHandler = sourceBetween(
    "async function handleApplyPendingAction",
    "async function handleWithdrawPendingAction",
  );
  const scopeHandler = sourceBetween(
    "function handleScopeChange",
    "function renderMessage",
  );
  const composer = sourceBetween(
    "<View style={[st.inputBar",
    "</KeyboardAvoidingView>",
  );

  assert.match(
    stateSetup,
    /const pendingIngestReconciliation = Object\.values\(sendFailuresByLane\)[\s\S]*requiresReconciliation/u,
  );
  for (const handler of [
    sendHandler,
    inputHandler,
    moveToPrivateHandler,
    targetHandler,
    suggestionHandler,
    applyHandler,
    scopeHandler,
  ]) {
    assert.match(handler, /pendingIngestReconciliation/u);
  }
  assert.match(composer, /editable=\{!streaming && !pendingIngestReconciliation\}/u);
  assert.match(composer, /disabled=\{!input\.trim\(\) \|\| pendingIngestReconciliation\}/u);
  assert.match(retryHandler, /sendPartnerDraft\(failure\.draft, operation\)/u);
  assert.match(retryHandler, /sendAiDraft\(failure\.draft, true, operation\)/u);
  assert.doesNotMatch(retryHandler, /Crypto\.randomUUID/u);
});

test("a network-unknown ingest retry sends the exact same client request id", async () => {
  const requestIds = [];
  let attempt = 0;
  const requestAiMessageIngest = loadAiMessageIngestRequest({
    fetchImpl: async (_url, init) => {
      requestIds.push(JSON.parse(init.body).clientRequestId);
      attempt += 1;
      if (attempt === 1) throw new Error("socket closed after write");
      return {
        status: 201,
        json: async () => ({}),
        headers: { get: () => null },
      };
    },
  });
  const draft = {
    coupleId: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    senderType: "bride",
    text: "네트워크가 끊긴 요청",
    clientRequestId: "33333333-3333-4333-8333-333333333333",
    target: "ai",
    requestedVisibility: "shared",
    visibility: "shared",
    providerAttachmentCount: 0,
    sessionGeneration: 1,
  };

  await assert.rejects(
    requestAiMessageIngest(draft),
    (error) => {
      assert.deepEqual(requestAiMessageIngest.getRecovery(error, false), {
        canRetry: true,
        requiresReconciliation: true,
      });
      return true;
    },
  );
  await requestAiMessageIngest(draft);

  assert.deepEqual(requestIds, [draft.clientRequestId, draft.clientRequestId]);
});

test("a definite new-message ingest failure does not enter reconciliation mode", () => {
  const contract = loadAiMessageIngestRecoveryContract();
  assert.ok(contract);
  const expected = {
    coupleId: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    senderType: "bride",
    text: "충돌이 확인된 요청",
    clientRequestId: "33333333-3333-4333-8333-333333333333",
    target: "ai",
  };

  assert.throws(
    () => contract.parseAiMessageIngestResult(409, {
      code: "USER_MESSAGE_REQUEST_CONFLICT",
      retryPolicy: "new_message",
    }, expected),
    (error) => {
      assert.deepEqual(contract.getAiMessageIngestRecovery(error, false), {
        canRetry: false,
        requiresReconciliation: false,
      });
      return true;
    },
  );
});

test("AI message ingest preserves the exact request across uncertain edge 5xx responses", () => {
  const { AiMessageIngestError, parseAiMessageIngestResult } = loadAiMessageIngestContract();
  const expected = {
    coupleId: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    senderType: "bride",
    text: "엣지 응답 뒤 저장 여부가 불확실한 요청",
    clientRequestId: "33333333-3333-4333-8333-333333333333",
    target: "ai",
  };

  for (const status of [500, 502, 504]) {
    assert.throws(
      () => parseAiMessageIngestResult(status, { code: "EDGE_FAILURE" }, expected),
      (error) => error instanceof AiMessageIngestError
        && error.retryable === true
        && error.retryPolicy === "same_request",
    );
  }
});

test("AI message ingest retries a pre-write 429 with the same idempotency key", () => {
  const { AiMessageIngestError, parseAiMessageIngestResult } = loadAiMessageIngestContract();
  const expected = {
    coupleId: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    senderType: "bride",
    text: "요청이 몰린 동안 보낸 메시지",
    clientRequestId: "33333333-3333-4333-8333-333333333333",
    target: "ai",
  };

  assert.throws(
    () => parseAiMessageIngestResult(429, { code: "RATE_LIMITED" }, expected),
    (error) => error instanceof AiMessageIngestError
      && error.retryable === true
      && error.retryPolicy === "same_request",
  );
});

test("AI message ingest gives 401, 403, and 429 distinct safe recovery copy", () => {
  const {
    AiMessageIngestError,
    getAiMessageIngestFailureMessage,
    parseAiMessageIngestResult,
  } = loadAiMessageIngestContract();
  const expected = {
    coupleId: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    senderType: "bride",
    text: "실패 뒤에도 보존할 질문",
    clientRequestId: "33333333-3333-4333-8333-333333333333",
    target: "ai",
  };

  const readFailure = (status, retryAfterMs = null) => {
    try {
      parseAiMessageIngestResult(status, null, expected, retryAfterMs);
      assert.fail(`expected ${status} to fail`);
    } catch (error) {
      assert.ok(error instanceof AiMessageIngestError);
      return error;
    }
  };
  const auth = readFailure(401);
  const forbidden = readFailure(403);
  const limited = readFailure(429, 12_000);

  assert.equal(auth.retryable, false);
  assert.match(getAiMessageIngestFailureMessage(auth, false), /로그인이 만료/);
  assert.equal(forbidden.retryable, false);
  assert.match(getAiMessageIngestFailureMessage(forbidden, false), /대화 권한/);
  assert.equal(limited.retryable, true);
  assert.equal(limited.retryAfterMs, 12_000);
  assert.match(getAiMessageIngestFailureMessage(limited, false), /12초 후/);
});

test("mobile honors bounded Retry-After seconds and HTTP dates from ingest", () => {
  const { parseRetryAfterMs } = loadAiMessageIngestContract();
  const nowMs = Date.parse("2026-08-04T00:00:00.000Z");

  assert.equal(parseRetryAfterMs("12", nowMs), 12_000);
  assert.equal(
    parseRetryAfterMs("Tue, 04 Aug 2026 00:00:45 GMT", nowMs),
    45_000,
  );
  assert.equal(parseRetryAfterMs("999999", nowMs), 300_000);
  assert.equal(parseRetryAfterMs("not-a-date", nowMs), null);
  assert.equal(parseRetryAfterMs(null, nowMs), null);

  const ingestRequest = sourceBetween(
    "async function requestAiMessageIngest",
    "async function requestChatStream",
  );
  assert.match(
    ingestRequest,
    /parseRetryAfterMs\(response\.headers\.get\("Retry-After"\)\)/,
  );
});

test("AI message ingest treats a malformed successful envelope as an unknown committed outcome", () => {
  const contract = loadAiMessageIngestRecoveryContract();
  assert.ok(contract);
  const {
    AiMessageIngestError,
    getAiMessageIngestRecovery,
    parseAiMessageIngestResult,
  } = contract;
  const expected = {
    coupleId: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    senderType: "bride",
    text: "응답이 잘린 요청",
    clientRequestId: "33333333-3333-4333-8333-333333333333",
    target: "ai",
  };

  assert.throws(
    () => parseAiMessageIngestResult(201, null, expected),
    (error) => {
      assert.ok(error instanceof AiMessageIngestError);
      assert.equal(error.retryable, true);
      assert.equal(error.retryPolicy, "same_request");
      assert.deepEqual(getAiMessageIngestRecovery(error, false), {
        canRetry: true,
        requiresReconciliation: true,
      });
      return true;
    },
  );
});

test("cold-start offers a click-only resume for the latest unanswered v1 text request", () => {
  const { findColdStartAiRecovery } = loadColdStartAiRecoveryContract();
  const userMessage = {
    id: "44444444-4444-4444-8444-444444444444",
    couple_id: "11111111-1111-4111-8111-111111111111",
    sender_id: "22222222-2222-4222-8222-222222222222",
    role: "user",
    sender_type: "bride",
    content: "답변이 오기 전에 앱이 종료된 질문",
    metadata: {
      client_request_id: "33333333-3333-4333-8333-333333333333",
      amora_ingest_contract_version: 1,
      ai_response_requested: true,
      provider_attachment_state: "none",
      provider_attachment_count: 0,
    },
    created_at: "2026-08-04T00:00:00.000Z",
    visibility: "shared",
  };

  assert.deepEqual(
    findColdStartAiRecovery([userMessage], {
      coupleId: userMessage.couple_id,
      userId: userMessage.sender_id,
      senderType: "bride",
      visibility: "shared",
    }),
    {
      disposition: "resumable",
      lane: "shared_ai",
      userMessageId: userMessage.id,
      clientRequestId: userMessage.metadata.client_request_id,
      content: userMessage.content,
      visibility: "shared",
      providerAttachmentState: "none",
      providerAttachmentCount: 0,
    },
  );
});

test("cold-start can resume a v1 request whose attachments were discarded by safety policy", () => {
  const { findColdStartAiRecovery } = loadColdStartAiRecoveryContract();
  const userMessage = {
    id: "44444444-4444-4444-8444-444444444444",
    couple_id: "11111111-1111-4111-8111-111111111111",
    sender_id: "22222222-2222-4222-8222-222222222222",
    role: "user",
    sender_type: "bride",
    content: "안전 정책으로 첨부가 제외된 질문",
    metadata: {
      client_request_id: "33333333-3333-4333-8333-333333333333",
      amora_ingest_contract_version: 1,
      ai_response_requested: true,
      provider_attachment_state: "discarded_by_safety_policy",
      provider_attachment_count: 0,
    },
    created_at: "2026-08-04T00:00:00.000Z",
    visibility: "bride_private",
  };

  assert.deepEqual(
    findColdStartAiRecovery([userMessage], {
      coupleId: userMessage.couple_id,
      userId: userMessage.sender_id,
      senderType: "bride",
      visibility: "bride_private",
    }),
    {
      disposition: "resumable",
      lane: "private_ai",
      userMessageId: userMessage.id,
      clientRequestId: userMessage.metadata.client_request_id,
      content: userMessage.content,
      visibility: "bride_private",
      providerAttachmentState: "discarded_by_safety_policy",
      providerAttachmentCount: 0,
    },
  );
});

test("cold-start exposes a canonical v2 attachment turn as reattach-only", () => {
  const { findColdStartAiRecovery } = loadColdStartAiRecoveryContract();
  const userMessage = {
    id: "44444444-4444-4444-8444-444444444444",
    couple_id: "11111111-1111-4111-8111-111111111111",
    sender_id: "22222222-2222-4222-8222-222222222222",
    role: "user",
    sender_type: "bride",
    content: "Please continue after I reattach the image.",
    metadata: {
      client_request_id: "33333333-3333-4333-8333-333333333333",
      amora_ingest_contract_version: 2,
      ai_response_requested: true,
      provider_attachment_state: "present",
      provider_attachment_count: 1,
      provider_attachment_manifest: [{
        media_type: "image/png",
        byte_length: 5,
        sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
      }],
    },
    created_at: "2026-08-04T00:00:00.000Z",
    visibility: "shared",
  };

  assert.deepEqual(
    findColdStartAiRecovery([userMessage], {
      coupleId: userMessage.couple_id,
      userId: userMessage.sender_id,
      senderType: "bride",
      visibility: "shared",
    }),
    {
      disposition: "reattach_required",
      lane: "shared_ai",
      userMessageId: userMessage.id,
      clientRequestId: userMessage.metadata.client_request_id,
      content: userMessage.content,
      visibility: "shared",
      providerAttachmentState: "present",
      providerAttachmentCount: 1,
    },
  );

  const resumeHandler = sourceBetween(
    "async function handleColdStartAiRecovery",
    "async function handleRetry",
  );
  assert.match(resumeHandler, /recovery\.disposition !== "resumable"/);
});

test("cold-start rejects a malformed v2 attachment manifest", () => {
  const { findColdStartAiRecovery } = loadColdStartAiRecoveryContract();
  const userMessage = {
    id: "44444444-4444-4444-8444-444444444444",
    couple_id: "11111111-1111-4111-8111-111111111111",
    sender_id: "22222222-2222-4222-8222-222222222222",
    role: "user",
    sender_type: "bride",
    content: "This row must not create a recovery action.",
    metadata: {
      client_request_id: "33333333-3333-4333-8333-333333333333",
      amora_ingest_contract_version: 2,
      ai_response_requested: true,
      provider_attachment_state: "present",
      provider_attachment_count: 1,
      provider_attachment_manifest: [{
        media_type: "image/png",
        byte_length: 5,
        sha256: "NOT-A-CANONICAL-DIGEST",
      }],
    },
    created_at: "2026-08-04T00:00:00.000Z",
    visibility: "shared",
  };

  assert.equal(findColdStartAiRecovery([userMessage], {
    coupleId: userMessage.couple_id,
    userId: userMessage.sender_id,
    senderType: "bride",
    visibility: "shared",
  }), null);
});

test("cold-start requires reattachment for present or unknown provider attachment state", () => {
  const { findColdStartAiRecovery } = loadColdStartAiRecoveryContract();
  const baseMessage = {
    id: "44444444-4444-4444-8444-444444444444",
    couple_id: "11111111-1111-4111-8111-111111111111",
    sender_id: "22222222-2222-4222-8222-222222222222",
    role: "user",
    sender_type: "bride",
    content: "첨부파일이 있었던 질문",
    created_at: "2026-08-04T00:00:00.000Z",
    visibility: "shared",
  };
  const context = {
    coupleId: baseMessage.couple_id,
    userId: baseMessage.sender_id,
    senderType: "bride",
    visibility: "shared",
  };

  for (const attachmentMetadata of [
    { provider_attachment_state: "present", provider_attachment_count: 2 },
    { provider_attachment_count: 0 },
  ]) {
    const message = {
      ...baseMessage,
      metadata: {
        client_request_id: "33333333-3333-4333-8333-333333333333",
        amora_ingest_contract_version: 1,
        ai_response_requested: true,
        ...attachmentMetadata,
      },
    };
    const recovery = findColdStartAiRecovery([message], context);
    assert.equal(recovery?.disposition, "reattach_required");
    assert.equal(recovery?.userMessageId, message.id);
    assert.equal(recovery?.clientRequestId, message.metadata.client_request_id);
    assert.equal(
      recovery?.providerAttachmentState,
      attachmentMetadata.provider_attachment_state ?? "unknown",
    );
    assert.equal(
      recovery?.providerAttachmentCount,
      attachmentMetadata.provider_attachment_count,
    );
  }
});

test("cold-start never offers recovery after a correlated assistant reply exists", () => {
  const { findColdStartAiRecovery } = loadColdStartAiRecoveryContract();
  const userMessage = {
    id: "44444444-4444-4444-8444-444444444444",
    couple_id: "11111111-1111-4111-8111-111111111111",
    sender_id: "22222222-2222-4222-8222-222222222222",
    role: "user",
    sender_type: "bride",
    content: "이미 답변된 질문",
    metadata: {
      client_request_id: "33333333-3333-4333-8333-333333333333",
      amora_ingest_contract_version: 1,
      ai_response_requested: true,
      provider_attachment_state: "none",
      provider_attachment_count: 0,
    },
    created_at: "2026-08-04T00:00:00.000Z",
    visibility: "shared",
  };
  const assistantMessage = {
    id: "55555555-5555-4555-8555-555555555555",
    couple_id: userMessage.couple_id,
    sender_id: null,
    role: "assistant",
    sender_type: "ai",
    content: "완료된 답변",
    metadata: { in_reply_to_user_message_id: userMessage.id },
    created_at: "2026-08-04T00:00:01.000Z",
    visibility: "shared",
  };

  assert.equal(findColdStartAiRecovery([userMessage, assistantMessage], {
    coupleId: userMessage.couple_id,
    userId: userMessage.sender_id,
    senderType: "bride",
    visibility: "shared",
  }), null);
});

test("cold-start leaves confirmed actions to the existing higher-priority recovery flow", () => {
  const { findColdStartAiRecovery } = loadColdStartAiRecoveryContract();
  const userMessage = {
    id: "44444444-4444-4444-8444-444444444444",
    couple_id: "11111111-1111-4111-8111-111111111111",
    sender_id: "22222222-2222-4222-8222-222222222222",
    role: "user",
    sender_type: "bride",
    content: "확인한 변경을 적용해줘",
    metadata: {
      client_request_id: "33333333-3333-4333-8333-333333333333",
      confirmed_amora_action_id: "55555555-5555-4555-8555-555555555555",
      amora_ingest_contract_version: 1,
      ai_response_requested: true,
      provider_attachment_state: "none",
      provider_attachment_count: 0,
    },
    created_at: "2026-08-04T00:00:00.000Z",
    visibility: "shared",
  };

  assert.equal(findColdStartAiRecovery([userMessage], {
    coupleId: userMessage.couple_id,
    userId: userMessage.sender_id,
    senderType: "bride",
    visibility: "shared",
  }), null);
});

test("cold-start recovery fails closed for partner, other-owner, private intrusion, and legacy rows", () => {
  const { findColdStartAiRecovery } = loadColdStartAiRecoveryContract();
  const baseMessage = {
    id: "44444444-4444-4444-8444-444444444444",
    couple_id: "11111111-1111-4111-8111-111111111111",
    sender_id: "22222222-2222-4222-8222-222222222222",
    role: "user",
    sender_type: "bride",
    content: "복구 후보 질문",
    metadata: {
      client_request_id: "33333333-3333-4333-8333-333333333333",
      amora_ingest_contract_version: 1,
      ai_response_requested: true,
      provider_attachment_state: "none",
      provider_attachment_count: 0,
    },
    created_at: "2026-08-04T00:00:00.000Z",
    visibility: "shared",
  };
  const context = {
    coupleId: baseMessage.couple_id,
    userId: baseMessage.sender_id,
    senderType: "bride",
    visibility: "shared",
  };

  for (const message of [
    { ...baseMessage, metadata: { ...baseMessage.metadata, target: "partner" } },
    { ...baseMessage, sender_id: "66666666-6666-4666-8666-666666666666" },
    {
      ...baseMessage,
      metadata: {
        ...baseMessage.metadata,
        amora_ingest_contract_version: undefined,
      },
    },
  ]) {
    assert.equal(findColdStartAiRecovery([message], context), null);
  }

  assert.equal(findColdStartAiRecovery([
    baseMessage,
    {
      ...baseMessage,
      id: "77777777-7777-4777-8777-777777777777",
      created_at: "2026-08-04T00:00:01.000Z",
      metadata: { client_request_id: "88888888-8888-4888-8888-888888888888" },
    },
  ], context), null);
  assert.equal(findColdStartAiRecovery([{
    ...baseMessage,
    visibility: "groom_private",
  }], {
    ...context,
    visibility: "groom_private",
  }), null);
});

test("cold-start recovery rejects malformed canonical request and user-row identifiers", () => {
  const { findColdStartAiRecovery } = loadColdStartAiRecoveryContract();
  const baseMessage = {
    id: "44444444-4444-4444-8444-444444444444",
    couple_id: "11111111-1111-4111-8111-111111111111",
    sender_id: "22222222-2222-4222-8222-222222222222",
    role: "user",
    sender_type: "bride",
    content: "식별자가 변조된 질문",
    metadata: {
      client_request_id: "33333333-3333-4333-8333-333333333333",
      amora_ingest_contract_version: 1,
      ai_response_requested: true,
      provider_attachment_state: "none",
      provider_attachment_count: 0,
    },
    created_at: "2026-08-04T00:00:00.000Z",
    visibility: "shared",
  };
  const context = {
    coupleId: baseMessage.couple_id,
    userId: baseMessage.sender_id,
    senderType: "bride",
    visibility: "shared",
  };

  assert.equal(findColdStartAiRecovery([{
    ...baseMessage,
    id: "not-a-uuid",
  }], context), null);
  assert.equal(findColdStartAiRecovery([{
    ...baseMessage,
    metadata: { ...baseMessage.metadata, client_request_id: "not-a-uuid" },
  }], context), null);
});

test("cold-start merges the latest private canonical turn beyond the 200-row history bound", () => {
  const {
    mergeColdStartRecoveryHistory,
    findColdStartAiRecovery,
  } = loadColdStartAiRecoveryContract();
  const privateUserMessage = {
    id: "44444444-4444-4444-8444-444444444444",
    couple_id: "11111111-1111-4111-8111-111111111111",
    sender_id: "22222222-2222-4222-8222-222222222222",
    role: "user",
    sender_type: "bride",
    content: "아주 긴 대화 뒤에도 이어받아야 하는 비공개 질문",
    metadata: {
      client_request_id: "33333333-3333-4333-8333-333333333333",
      amora_ingest_contract_version: 1,
      ai_response_requested: true,
      provider_attachment_state: "none",
      provider_attachment_count: 0,
    },
    created_at: "2026-08-03T00:00:00.000Z",
    visibility: "bride_private",
  };
  const boundedSharedHistory = Array.from({ length: 200 }, (_, index) => ({
    id: `shared-filler-${index}`,
    couple_id: privateUserMessage.couple_id,
    sender_id: null,
    role: "assistant",
    sender_type: "ai",
    content: `공유 기록 ${index}`,
    metadata: {},
    created_at: new Date(Date.parse("2026-08-04T00:00:00.000Z") + index).toISOString(),
    visibility: "shared",
  }));
  const context = {
    coupleId: privateUserMessage.couple_id,
    userId: privateUserMessage.sender_id,
    senderType: "bride",
    visibility: "bride_private",
  };

  const merged = mergeColdStartRecoveryHistory(
    boundedSharedHistory,
    [privateUserMessage],
  );
  assert.equal(merged.length, 201);
  assert.equal(
    findColdStartAiRecovery(merged, context)?.userMessageId,
    privateUserMessage.id,
  );

  const privateAssistantReply = {
    id: "55555555-5555-4555-8555-555555555555",
    couple_id: privateUserMessage.couple_id,
    sender_id: null,
    role: "assistant",
    sender_type: "ai",
    content: "이미 완료된 비공개 답변",
    metadata: { in_reply_to_user_message_id: privateUserMessage.id },
    created_at: "2026-08-03T00:00:01.000Z",
    visibility: "bride_private",
  };
  assert.equal(findColdStartAiRecovery(
    mergeColdStartRecoveryHistory(
      boundedSharedHistory,
      [privateUserMessage, privateAssistantReply],
    ),
    context,
  ), null);
});

test("cold-start supplements the latest owned shared AI request beyond the 200-row history bound", () => {
  const {
    mergeColdStartRecoveryHistory,
    findColdStartAiRecovery,
  } = loadColdStartAiRecoveryContract();
  const sharedUserMessage = {
    id: "44444444-4444-4444-8444-444444444444",
    couple_id: "11111111-1111-4111-8111-111111111111",
    sender_id: "22222222-2222-4222-8222-222222222222",
    role: "user",
    sender_type: "bride",
    content: "Resume the latest shared AI turn.",
    metadata: {
      client_request_id: "33333333-3333-4333-8333-333333333333",
      amora_ingest_contract_version: 1,
      ai_response_requested: true,
      provider_attachment_state: "none",
      provider_attachment_count: 0,
    },
    created_at: "2026-08-03T00:00:00.000Z",
    visibility: "shared",
  };
  const boundedPrivateHistory = Array.from({ length: 200 }, (_, index) => ({
    id: `private-filler-${index}`,
    couple_id: sharedUserMessage.couple_id,
    sender_id: null,
    role: "assistant",
    sender_type: "ai",
    content: `private filler ${index}`,
    metadata: {},
    created_at: new Date(Date.parse("2026-08-04T00:00:00.000Z") + index).toISOString(),
    visibility: "bride_private",
  }));

  const merged = mergeColdStartRecoveryHistory(
    boundedPrivateHistory,
    [sharedUserMessage, sharedUserMessage],
  );
  assert.equal(merged.length, 201);
  assert.equal(findColdStartAiRecovery(merged, {
    coupleId: sharedUserMessage.couple_id,
    userId: sharedUserMessage.sender_id,
    senderType: "bride",
    visibility: "shared",
  })?.userMessageId, sharedUserMessage.id);

  const loadSession = sourceBetween(
    "async function loadChatSession",
    "void loadChatSession();",
  );
  assert.match(
    loadSession,
    /const latestOwnSharedAiUserRequest = viewerRole[\s\S]*\.eq\("couple_id", profile\.couple_id\)[\s\S]*\.eq\("sender_id", user\.id\)[\s\S]*\.eq\("sender_type", viewerRole\)[\s\S]*\.eq\("role", "user"\)[\s\S]*\.eq\("visibility", "shared"\)[\s\S]*\.limit\(1\)/,
  );
  assert.match(
    loadSession,
    /error: latestSharedCanonicalError[\s\S]*data: latestOwnSharedAiUser[\s\S]*error: latestOwnSharedAiUserError/,
  );
  assert.match(
    loadSession,
    /const sharedSupplementalCanonicalTurns =[\s\S]*latestSharedCanonicalError \|\| latestOwnSharedAiUserError[\s\S]*latestSharedCanonical[\s\S]*latestOwnSharedAiUser[\s\S]*const supplementalCanonicalTurns = \[[\s\S]*sharedSupplementalCanonicalTurns/,
  );
});

test("cold-start suppresses a stale CTA after a newer canonical row in the same AI lane", () => {
  const { findColdStartAiRecovery } = loadColdStartAiRecoveryContract();
  const ownedRequest = {
    id: "44444444-4444-4444-8444-444444444444",
    couple_id: "11111111-1111-4111-8111-111111111111",
    sender_id: "22222222-2222-4222-8222-222222222222",
    role: "user",
    sender_type: "bride",
    content: "This interrupted request is no longer the lane tail.",
    metadata: {
      client_request_id: "33333333-3333-4333-8333-333333333333",
      amora_ingest_contract_version: 1,
      ai_response_requested: true,
      provider_attachment_state: "none",
      provider_attachment_count: 0,
    },
    created_at: "2026-08-04T00:00:00.000Z",
    visibility: "shared",
  };
  const newerPartnerAiRequest = {
    id: "55555555-5555-4555-8555-555555555555",
    couple_id: ownedRequest.couple_id,
    sender_id: "66666666-6666-4666-8666-666666666666",
    role: "user",
    sender_type: "groom",
    content: "This is now the latest shared AI request.",
    metadata: {
      target: "ai",
      client_request_id: "77777777-7777-4777-8777-777777777777",
      amora_ingest_contract_version: 1,
      ai_response_requested: true,
      provider_attachment_state: "none",
      provider_attachment_count: 0,
    },
    created_at: "2026-08-04T00:00:01.000Z",
    visibility: "shared",
  };

  assert.equal(findColdStartAiRecovery(
    [ownedRequest, newerPartnerAiRequest],
    {
      coupleId: ownedRequest.couple_id,
      userId: ownedRequest.sender_id,
      senderType: "bride",
      visibility: "shared",
    },
  ), null);
});

test("mobile cold-start stages a neutral CTA and resumes only after the user's click", () => {
  const loadSession = sourceBetween(
    "async function loadChatSession",
    "void loadChatSession();",
  );
  const resumeHandler = sourceBetween(
    "async function handleColdStartAiRecovery",
    "async function handleRetry",
  );

  assert.match(sourceText, /const \[coldStartAiRecoveryByLane, setColdStartAiRecoveryByLane\]/);
  assert.match(loadSession, /findColdStartAiRecovery\(historyMessages/);
  assert.match(loadSession, /const latestPrivateCanonicalRequest = privateVisibility/);
  assert.match(loadSession, /const latestOwnPrivateAiUserRequest = privateVisibility/);
  assert.match(
    loadSession,
    /latestOwnPrivateAiUserRequest[\s\S]*\.eq\("couple_id", profile\.couple_id\)[\s\S]*\.eq\("sender_id", user\.id\)[\s\S]*\.eq\("sender_type", viewerRole\)[\s\S]*\.eq\("role", "user"\)[\s\S]*\.eq\("visibility", privateVisibility\)[\s\S]*\.limit\(1\)/,
  );
  assert.match(
    loadSession,
    /const privateSupplementalCanonicalTurns =[\s\S]*latestPrivateCanonical[\s\S]*latestOwnPrivateAiUser[\s\S]*const supplementalCanonicalTurns = \[[\s\S]*sharedSupplementalCanonicalTurns[\s\S]*privateSupplementalCanonicalTurns[\s\S]*mergeColdStartRecoveryHistory\([\s\S]*supplementalCanonicalTurns/,
  );
  assert.match(
    loadSession,
    /error: latestPrivateCanonicalError[\s\S]*error: latestOwnPrivateAiUserError[\s\S]*latestPrivateCanonicalError \|\| latestOwnPrivateAiUserError[\s\S]*\? \[\]/,
  );
  assert.match(loadSession, /if \([\s\S]*durableConfirmation[\s\S]*setLaneFailure\("shared_ai"[\s\S]*else if \(viewerRole\)[\s\S]*setColdStartAiRecoveryByLane/);
  assert.doesNotMatch(loadSession, /streamAiRequest\(|requestChatStream\(/);

  assert.match(resumeHandler, /disposition !== "resumable"/);
  assert.match(resumeHandler, /clientRequestId: recovery\.clientRequestId/);
  assert.match(resumeHandler, /durableUserMessageId: recovery\.userMessageId/);
  assert.match(resumeHandler, /providerAttachmentCount: 0/);
  assert.match(resumeHandler, /recoveredProviderAttachmentState: recovery\.providerAttachmentState/);
  assert.match(resumeHandler, /await sendAiDraft\(draft, true, operation\)/);
  assert.doesNotMatch(resumeHandler, /requestAiMessageIngest|streamAiRequest/);

  assert.match(sourceText, /onPress=\{handleColdStartAiRecovery\}/);
  assert.match(sourceText, /답변 이어받기/);
  assert.match(sourceText, /이 질문은 첨부파일이 있어 모바일에서 이어받을 수 없어요\. 웹에서 첨부파일을 다시 선택해 새 메시지로 보내 주세요\./);
  assert.match(sourceText, /첨부 상태를 확인할 수 없어 모바일에서 이어받지 않았어요\. 웹에서 첨부파일을 다시 선택해 새 메시지로 보내 주세요\./);
  assert.doesNotMatch(sourceText, /expo-image-picker|ImagePicker/);
});

test("cold-start resume revalidates the exact durable row and safe attachment state", () => {
  const durableLookup = sourceBetween(
    "async function findDurableUserMessage",
    "async function sendPartnerDraft",
  );
  const aiSend = sourceBetween(
    "async function sendAiDraft",
    "async function handleColdStartAiRecovery",
  );

  assert.match(durableLookup, /draft\.durableUserMessageId[\s\S]*\.eq\("id", draft\.durableUserMessageId\)/);
  assert.match(durableLookup, /durableMessage\.id !== draft\.durableUserMessageId/);
  assert.match(durableLookup, /amora_ingest_contract_version === 1/);
  assert.match(durableLookup, /ai_response_requested === true/);
  assert.match(durableLookup, /provider_attachment_count === draft\.providerAttachmentCount/);
  assert.match(durableLookup, /recoveredProviderAttachmentState[\s\S]*provider_attachment_state/);
  assert.match(
    durableLookup,
    /draft\.durableUserMessageId[\s\S]*in_reply_to_user_message_id[\s\S]*client_visible_request_id[\s\S]*sender_type", "ai"[\s\S]*role", "assistant"/,
  );
  assert.match(
    durableLookup,
    /answerLookupError \|\| \(answerRows \?\? \[\]\)\.length > 0[\s\S]*return null/,
  );

  assert.match(aiSend, /draft\.durableUserMessageId[\s\S]*draft\.providerAttachmentCount !== 0/);
  assert.match(aiSend, /recoveredProviderAttachmentState !== "none"[\s\S]*"discarded_by_safety_policy"/);
  assert.match(
    aiSend,
    /if \(draft\.durableUserMessageId && !durableMessage\)[\s\S]*return;/,
  );
  const durableRecoveryGuard = aiSend.slice(
    aiSend.indexOf("if (draft.durableUserMessageId && !durableMessage)"),
    aiSend.indexOf("if (!durableMessage)", aiSend.indexOf("if (draft.durableUserMessageId && !durableMessage)") + 1),
  );
  assert.doesNotMatch(durableRecoveryGuard, /requestAiMessageIngest/);
});

test("a correlated Realtime assistant insert removes the cold-start CTA", () => {
  const loadSession = sourceBetween(
    "async function loadChatSession",
    "void loadChatSession();",
  );
  const realtimeInsert = loadSession.slice(
    loadSession.indexOf('const ch = supabase.channel(`chat:'),
    loadSession.indexOf('.on("postgres_changes", { event: "UPDATE"',
      loadSession.indexOf('const ch = supabase.channel(`chat:')),
  );

  assert.match(realtimeInsert, /setColdStartAiRecoveryByLane/);
  assert.match(realtimeInsert, /in_reply_to_user_message_id === recovery\.userMessageId/);
  assert.match(realtimeInsert, /`chat:\$\{user\.id\}:\$\{recovery\.clientRequestId\}`/);
  assert.match(realtimeInsert, /updateAmoraChatLaneRecord\(current, lane, null\)/);
});

test("a newer Realtime canonical lane row removes a stale cold-start CTA", () => {
  const loadSession = sourceBetween(
    "async function loadChatSession",
    "void loadChatSession();",
  );
  const realtimeInsert = loadSession.slice(
    loadSession.indexOf('const ch = supabase.channel(`chat:'),
    loadSession.indexOf('.on("postgres_changes", { event: "UPDATE"',
      loadSession.indexOf('const ch = supabase.channel(`chat:')),
  );

  assert.match(realtimeInsert, /const supersedesRecovery =/);
  assert.match(
    realtimeInsert,
    /incoming\.id !== recovery\.userMessageId[\s\S]*incomingMetadata\?\.target !== "partner"/,
  );
  assert.match(
    realtimeInsert,
    /answersRecovery[\s\S]*\|\| supersedesRecovery[\s\S]*updateAmoraChatLaneRecord\(current, lane, null\)/,
  );
});

test("mobile posts both AI and partner user rows through the Bearer ingest boundary", () => {
  const ingestRequest = sourceBetween(
    "async function requestAiMessageIngest",
    "async function requestChatStream",
  );
  const aiSend = sourceBetween(
    "async function sendAiDraft",
    "async function handleRetry",
  );
  const partnerSend = sourceBetween(
    "async function sendPartnerDraft",
    "async function streamAiRequest",
  );

  assert.match(ingestRequest, /supabase\.auth\.getSession\(\)/);
  assert.match(ingestRequest, /fetch\(`\$\{API_BASE\}\/api\/chat\/messages`/);
  assert.match(ingestRequest, /Authorization: `Bearer \$\{accessToken\}`/);
  assert.match(ingestRequest, /coupleId: draft\.coupleId/);
  assert.match(ingestRequest, /content: draft\.text/);
  assert.match(ingestRequest, /clientRequestId: draft\.clientRequestId/);
  assert.match(ingestRequest, /requestedVisibility: draft\.requestedVisibility/);
  assert.match(ingestRequest, /target: draft\.target/);
  assert.match(
    ingestRequest,
    /providerAttachmentCount: draft\.target === "partner"[\s\S]*\? 0[\s\S]*: draft\.providerAttachmentCount/,
  );
  assert.doesNotMatch(ingestRequest, /imagePaths|attachments/);

  assert.match(aiSend, /await requestAiMessageIngest\(\s*draft,\s*operation\.controller\.signal/u);
  assert.doesNotMatch(aiSend, /\.from\("chat_messages"\)[\s\S]*?\.insert\(/);
  assert.match(aiSend, /durableMessage = ingestResult\.message/);
  assert.match(partnerSend, /await requestAiMessageIngest\(\s*draft,\s*operation\.controller\.signal/u);
  assert.doesNotMatch(partnerSend, /\.from\("chat_messages"\)|\.insert\(/);
  assert.doesNotMatch(partnerSend, /streamAiRequest|requestChatStream/);
});

test("partner ingest exposes retry only for safe same-request failures", () => {
  const sendFailureType = sourceBetween(
    "type SendFailure",
    "type PartnerRecipientVerification",
  );
  const partnerSend = sourceBetween(
    "async function sendPartnerDraft",
    "async function streamAiRequest",
  );
  const retryHandler = sourceBetween(
    "async function handleRetry",
    "async function handleSend",
  );

  assert.match(sendFailureType, /kind: "partner_ingest"[\s\S]*canRetry: boolean[\s\S]*unavailableReason: string \| null/);
  assert.match(partnerSend, /catch \(error\)/);
  assert.match(partnerSend, /getAiMessageIngestFailureMessage\(error, false\)/);
  assert.match(partnerSend, /getAiMessageIngestRecovery\(error, true\)/);
  assert.match(partnerSend, /canRetry: recovery\.canRetry/);
  assert.match(retryHandler, /if \(!failure\.canRetry\) return/);
  assert.match(sourceText, /activeSendFailure\.canRetry && \(/);
});

test("a server W5 fallback creates one local card and never reaches the provider", () => {
  const aiSend = sourceBetween(
    "async function sendAiDraft",
    "async function handleRetry",
  );
  const start = aiSend.indexOf('if (ingestResult.outcome === "ephemeral_safety")');
  const end = aiSend.indexOf("const safetyPrivacyCard", start);
  const fallbackBranch = aiSend.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(
    fallbackBranch,
    /`amora-server-crisis-preflight:\$\{draft\.userId\}:\$\{draft\.clientRequestId\}`/,
  );
  assert.match(fallbackBranch, /previous\.some\(\(message\) => message\.id === safetyCardId\)/);
  assert.match(fallbackBranch, /getEphemeralSafetyPersistencePresentation/);
  assert.match(fallbackBranch, /ingestResult\.rawDisclosureVisibility/);
  assert.match(fallbackBranch, /rawDisclosurePersisted === null[\s\S]*raw_disclosure_persisted/);
  assert.match(fallbackBranch, /raw_disclosure_shared: safetyPersistence\.rawDisclosureShared/);
  assert.match(fallbackBranch, /raw_disclosure_persistence: safetyPersistence\.persistence/);
  assert.match(fallbackBranch, /setActiveScope\("private"\)/);
  assert.match(fallbackBranch, /setTarget\("ai"\)/);
  assert.match(fallbackBranch, /return;/);
  assert.doesNotMatch(
    fallbackBranch,
    /streamAiRequest|requestChatStream|\.from\("chat_messages"\)|\.insert\(/,
  );
});

test("a server partner W2 or W5 hold becomes one private local safety card", () => {
  const partnerSend = sourceBetween(
    "async function sendPartnerDraft",
    "async function streamAiRequest",
  );
  const start = partnerSend.indexOf('if (ingestResult.outcome === "ephemeral_safety")');
  const end = partnerSend.indexOf("const durableMessage", start);
  const safetyBranch = partnerSend.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(safetyBranch, /ingestResult\.partnerDeliveryHeld/);
  assert.match(safetyBranch, /getEphemeralSafetyPersistencePresentation/);
  assert.match(safetyBranch, /ingestResult\.rawDisclosureVisibility/);
  assert.match(safetyBranch, /raw_disclosure_persistence: safetyPersistence\.persistence/);
  assert.match(safetyBranch, /safetyResolution === "immediate_crisis"[\s\S]*"W5_safety_override"[\s\S]*"W2_high_risk_adjacent"/);
  assert.match(safetyBranch, /setActiveScope\("private"\)/);
  assert.match(safetyBranch, /setTarget\("ai"\)/);
  assert.match(safetyBranch, /return;/);
  assert.doesNotMatch(partnerSend, /streamAiRequest|requestChatStream/);
});

test("mobile send path preserves the safety-effective visibility through persistence, provider, and retry", () => {
  const requestBodyType = sourceBetween(
    "interface ChatRequestBase",
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
  assert.match(requestBodyType, /type ChatRequestBody\s*=/);
  assert.match(requestBodyType, /requestKind: "mediation"/);
  assert.match(requestBodyType, /conflictContext: string/);
  assert.match(aiDraftType, /requestedVisibility: ChatMessageVisibility/);
  assert.match(aiDraftType, /visibility: ChatMessageVisibility/);
  assert.match(aiDraftType, /target: "ai"/);
  assert.match(aiDraftType, /clientRequestId: string/);
  assert.match(partnerDraftType, /target: "partner"/);
  assert.match(partnerDraftType, /requestedVisibility: "shared"/);
  assert.match(partnerDraftType, /visibility: "shared"/);
  assert.match(partnerDraftType, /clientRequestId: string/);
  assert.match(partnerDraftType, /partnerRecipientId: string/);
  assert.match(durableLookup, /\.eq\("visibility", draft\.visibility\)/);
  assert.match(durableLookup, /client_request_id: draft\.clientRequestId/);
  assert.doesNotMatch(durableLookup, /\.eq\("content", draft\.text\)/);
  assert.match(durableLookup, /durableMessage\.content !== draft\.text/);
  assert.doesNotMatch(durableLookup, /draft\.startedAt/);
  assert.match(partnerSend, /await requestAiMessageIngest\(\s*draft,\s*operation\.controller\.signal/u);
  assert.doesNotMatch(partnerSend, /\.from\("chat_messages"\)|\.insert\(/);
  assert.match(aiSend, /const ingestResult = await requestAiMessageIngest\(\s*draft,\s*operation\.controller\.signal/u);
  assert.match(aiSend, /durableMessage = ingestResult\.message/);
  assert.match(aiSend, /coupleId: canonicalUserMessage\.couple_id/);
  assert.match(aiSend, /clientRequestId: canonicalClientRequestId/);
  assert.match(aiSend, /userMessageId: canonicalUserMessage\.id/);
  assert.match(aiSend, /visibility: effectiveVisibility/);
  assert.doesNotMatch(aiSend, /body:[\s\S]*visibility: draft\.visibility/);
  assert.match(aiStream, /visibility: request\.body\.visibility/);
  assert.match(sendHandler, /chatVisibilityForScope\(activeScope, userRole\)/);
  assert.match(sendHandler, /const effectiveVisibility = crisisPreflight\.effectiveVisibility/);
  assert.match(sendHandler, /requestedVisibility: activeVisibility/);
  assert.match(sendHandler, /visibility: effectiveVisibility/);
  assert.match(sendHandler, /target: "ai"/);
  assert.match(sendHandler, /target: "partner"/);
  assert.match(sendHandler, /partnerRecipientId/);
  assert.match(sendHandler, /const clientRequestId = Crypto\.randomUUID\(\)/);
  assert.equal((sendHandler.match(/Crypto\.randomUUID\(\)/g) ?? []).length, 1);
});

test("mobile crisis preflight holds every target locally before persistence or transport", () => {
  const sendHandler = sourceBetween(
    "async function handleSend",
    "function handleInputChange",
  );
  const preflightIndex = sendHandler.indexOf("const crisisPreflight = planAmoraCrisisDelivery");
  const holdIndex = sendHandler.indexOf('crisisPreflight.disposition === "local_safety_hold"');
  const normalPathIndex = sendHandler.indexOf("const partnerRecipientId");

  assert.ok(preflightIndex >= 0);
  assert.ok(holdIndex > preflightIndex);
  assert.ok(normalPathIndex > holdIndex);
  assert.match(
    sendHandler,
    /planAmoraCrisisDelivery\(\{[\s\S]*userText: text,[\s\S]*requestedVisibility: activeVisibility,[\s\S]*target,[\s\S]*senderRole: userRole/,
  );

  const holdBranch = sendHandler.slice(holdIndex, normalPathIndex);
  assert.match(holdBranch, /content: `\$\{privacyNotice\}\\n\\n\$\{crisisPreflight\.response\}`/);
  assert.match(holdBranch, /visibility: crisisPreflight\.effectiveVisibility/);
  assert.match(
    holdBranch,
    /response_origin: crisisPreflight\.safetyResolution === "immediate_crisis"[\s\S]*"client_deterministic_crisis_preflight"[\s\S]*"client_deterministic_safety_privacy_preflight"/,
  );
  assert.match(holdBranch, /raw_disclosure_persisted: false/);
  assert.match(holdBranch, /setMessages\(/);
  assert.match(holdBranch, /setActiveScope\("private"\)/);
  assert.match(holdBranch, /setTarget\("ai"\)/);
  assert.match(
    holdBranch,
    /current\[activeLane\]\.trim\(\) === text[\s\S]*updateAmoraChatLaneRecord\(current, activeLane, ""\)/,
  );
  assert.match(holdBranch, /return;/);
  assert.doesNotMatch(
    holdBranch,
    /supabase|fetch\(|requestChatStream|streamAiRequest|sendPartnerDraft|sendAiDraft|\.upload\(|\.storage\b|captureEvent/,
  );
  assert.doesNotMatch(
    holdBranch,
    /content:\s*text|\b(?:rawText|summary|reason|disclosure|userText)\s*:\s*text\b/,
  );
});

test("mobile routes non-immediate shared AI safety text through the private lane end to end", () => {
  const aiDraftType = sourceBetween(
    "interface AiDraft",
    "interface AiRequest",
  );
  const aiSend = sourceBetween(
    "async function sendAiDraft",
    "async function handleRetry",
  );
  const privacyCardBranch = aiSend.slice(
    aiSend.indexOf("const safetyPrivacyCard"),
    aiSend.indexOf("const serverRequestKey"),
  );
  const retryHandler = sourceBetween(
    "async function handleRetry",
    "async function handleSend",
  );
  const sendHandler = sourceBetween(
    "async function handleSend",
    "function handleInputChange",
  );

  assert.match(aiDraftType, /sourceLane: AmoraChatLane/);
  assert.match(aiDraftType, /requestedVisibility: ChatMessageVisibility/);
  assert.doesNotMatch(aiDraftType, /safetyPrivacyRedirected\?: boolean/);
  assert.match(sendHandler, /const effectiveVisibility = crisisPreflight\.effectiveVisibility/);
  assert.match(sendHandler, /const effectiveLane = aiLaneForVisibility\(effectiveVisibility\)/);
  assert.match(sendHandler, /crisisPreflight\.disposition === "private_safety_route"/);
  assert.match(sendHandler, /crisisPreflight\.safetyPrivacyRedirected/);
  assert.match(sendHandler, /setActiveScope\("private"\)/);
  assert.match(sendHandler, /setTarget\("ai"\)/);
  assert.match(sendHandler, /sourceLane: activeLane/);
  assert.match(sendHandler, /requestedVisibility: activeVisibility/);
  assert.match(sendHandler, /visibility: effectiveVisibility/);
  assert.doesNotMatch(
    sendHandler,
    /private_safety_route[\s\S]{0,1200}updateAmoraChatLaneRecord\([^\n]*"private_ai"[^\n]*text/,
  );

  assert.match(aiSend, /isMessageInAiContext\([\s\S]*message\.visibility,[\s\S]*effectiveVisibility/);
  assert.match(aiSend, /ingestResult\.safetyPrivacyRedirected/);
  assert.match(aiSend, /visibility: effectiveVisibility/);
  assert.doesNotMatch(aiSend, /body:[\s\S]*visibility: draft\.visibility/);
  assert.match(
    aiSend,
    /const canonicalClientRequestId = canonicalUserMessage\.metadata!\.client_request_id!;/,
  );
  assert.match(
    aiSend,
    /const serverRequestKey = `chat:\$\{draft\.userId\}:\$\{canonicalClientRequestId\}`;/,
  );
  assert.match(aiSend, /clientRequestId: canonicalClientRequestId/);
  assert.match(privacyCardBranch, /response_origin: "server_authoritative_safety_privacy_route"/);
  assert.match(privacyCardBranch, /question_scope: "W2_high_risk_adjacent"/);
  assert.match(privacyCardBranch, /pinned_safety_card: true/);
  assert.match(privacyCardBranch, /raw_disclosure_persisted: true/);
  assert.match(privacyCardBranch, /raw_disclosure_shared: false/);
  assert.match(privacyCardBranch, /raw_disclosure_persistence: "private_only"/);
  assert.doesNotMatch(privacyCardBranch, /raw_disclosure_persisted: false/);
  assert.ok(
    aiSend.indexOf("const safetyPrivacyCard")
      > aiSend.indexOf("durableMessage = ingestResult.message"),
    "the truthful private-only notice must be created only after durable persistence",
  );
  assert.match(
    aiSend,
    /current\[draft\.sourceLane\]\.trim\(\) === draft\.text[\s\S]*updateAmoraChatLaneRecord\(current, draft\.sourceLane, ""\)/,
  );
  assert.match(
    retryHandler,
    /updateAmoraChatLaneRecord\([\s\S]*current,[\s\S]*failure\.draft\.sourceLane,[\s\S]*failure\.draft\.text/,
  );
});

test("mobile W5 safety cards suppress stale chrome and preserve persistence truth", () => {
  assert.match(
    sourceText,
    /const activeW5PersistenceState = useMemo[\s\S]*pinned_safety_card !== true[\s\S]*question_scope !== "W5_safety_override"/,
  );
  assert.match(
    sourceText,
    /const latestMessage = scopedMessages\[scopedMessages\.length - 1\]/,
  );
  assert.match(
    sourceText,
    /activeW5PersistenceState\.persistence === "none"[\s\S]*입력 내용은 저장되지 않았어요[\s\S]*persistence === "shared"[\s\S]*상대방에게 전달·저장됐어요[\s\S]*persistence === "private_only"[\s\S]*비공개 대화에 저장됐어요[\s\S]*rawDisclosurePersisted === true[\s\S]*저장됐지만 저장 범위는 확인하지 못했어요[\s\S]*이전 저장·전달 여부를 확인하지 못했어요/,
  );
  assert.match(sourceText, /!hasActiveW5SafetyCard && quotaRemaining !== null/);
  assert.match(sourceText, /!hasActiveW5SafetyCard && activeSendFailure/);
});

test("mobile local safety hold is synchronously deduplicated until the draft changes", () => {
  const resetSession = sourceBetween(
    "const resetChatSessionState",
    "useEffect(() => {",
  );
  const sendHandler = sourceBetween(
    "async function handleSend",
    "function handleInputChange",
  );
  const inputHandler = sourceBetween(
    "function handleInputChange",
    "function handleTargetChange",
  );
  const holdIndex = sendHandler.indexOf('crisisPreflight.disposition === "local_safety_hold"');
  const normalPathIndex = sendHandler.indexOf("const partnerRecipientId");
  const holdBranch = sendHandler.slice(holdIndex, normalPathIndex);

  assert.match(sourceText, /const safetyHoldLockRef = useRef\(false\)/);
  assert.match(sendHandler, /safetyHoldWasLocked = safetyHoldLockRef\.current/);
  assert.match(sendHandler, /safetyHoldLockRef\.current = true/);
  assert.match(holdBranch, /if \(safetyHoldWasLocked\) return/);
  assert.match(
    holdBranch,
    /previous\.some\(\(message\) => message\.id === safetyCard\.id\)[\s\S]*previous[\s\S]*\[\.\.\.previous, safetyCard\]/,
  );
  assert.match(inputHandler, /safetyHoldLockRef\.current = false/);
  assert.match(resetSession, /safetyHoldLockRef\.current = false/);
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
  assert.match(sourceText, /accessibilityState=\{\{[\s\S]*selected: activeScope === "shared"/);
  assert.match(sourceText, />함께 대화<\/Text>/);
  assert.match(sourceText, />나만 \(상담\)<\/Text>/);
  assert.match(sourceText, /현재 범위 · 함께 대화 — 지금 저장되며, 연결된 파트너에게 보여요/);
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
  assert.match(sourceText, /!isP \? \([\s\S]*<AmoraStarterCard/);
  assert.match(sourceText, /<AmoraStarterCard[\s\S]*onSelect=\{handleAiSuggestion\}/);
  assert.doesNotMatch(sourceText, /!isP && \([\s\S]*st\.suggestions/);
  assert.match(suggestionHandler, /"shared_ai"/);
  assert.doesNotMatch(suggestionHandler, /handleInputChange/);

  const verificationCallIndex = partnerSend.indexOf("await verifyPartnerDraftRecipient(draft)");
  const ingestIndex = partnerSend.search(
    /await requestAiMessageIngest\(\s*draft,\s*operation\.controller\.signal/u,
  );
  assert.ok(verificationCallIndex >= 0, "partner recipient must be reverified before delivery");
  assert.ok(ingestIndex > verificationCallIndex, "recipient verification must finish before server ingest");
  assert.doesNotMatch(partnerSend, /\.insert\(/);
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

test("same-owner first-use reloads retain private scope without overriding explicit shared or identity changes", () => {
  const resetSession = sourceBetween(
    "const resetChatSessionState",
    "useEffect(() => {",
  );
  const sessionEffect = sourceBetween(
    "function scheduleChatSessionReload",
    "async function findDurableUserMessage",
  );
  const firstUseEffectStart = sourceText.indexOf('firstUseEntry !== "first_use"');
  const firstUseEffectEnd = sourceText.indexOf("]);", firstUseEffectStart);
  const firstUseEffect = sourceText.slice(firstUseEffectStart, firstUseEffectEnd);
  const scopeHandler = sourceBetween(
    "function handleScopeChange",
    "function handleCorrectFirstUseAction",
  );

  assert.match(sourceText, /resolveAmoraFirstUseSessionResetScope/);
  assert.match(sourceText, /const activeScopeRef = useRef<ChatScope>\("shared"\)/);
  assert.match(resetSession, /const nextScope = sessionReloadScopeRef\.current/);
  assert.match(resetSession, /activeScopeRef\.current = nextScope[\s\S]*setActiveScope\(nextScope\)/);
  assert.match(firstUseEffect, /activeScopeRef\.current = "private"[\s\S]*setActiveScope\("private"\)/);
  assert.match(scopeHandler, /activeScopeRef\.current = nextSelection\.scope[\s\S]*setActiveScope\(nextSelection\.scope\)/);
  assert.match(sourceText, /const retainedReloadScope = resolveAmoraFirstUseSessionResetScope/);
  assert.match(sourceText, /sessionReloadScopeRef\.current = retainedReloadScope[\s\S]*void loadChatSession\(\)/);
  assert.match(
    sessionEffect,
    /reloadWhenCoupleRosterChanges[\s\S]*resolveAmoraFirstUseSessionResetScope[\s\S]*scheduleChatSessionReload\(nextScope\)/,
  );
  assert.match(sessionEffect, /const reloadIdentity = \(\) => \{[\s\S]*scheduleChatSessionReload\("shared"\)/);
  assert.match(sessionEffect, /onAuthStateChange[\s\S]*scheduleChatSessionReload\("shared"\)/);
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
