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
  "asChatStreamEvent",
  "applyChatEvent",
  "cleanAiText",
  "createChatStreamParser",
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
  `${compiled.outputText}\nreturn { ChatTransportError, createChatStreamParser };`,
);
const { ChatTransportError, createChatStreamParser } = loadParser();

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

test("AI transport stays behind the durable user-message gate", () => {
  const sendAiDraft = sourceBetween(
    "async function sendAiDraft",
    "async function handleRetry",
  );
  const durableGate = sendAiDraft.indexOf("if (!durableMessage) throw");
  const transportCall = sendAiDraft.indexOf("await streamAiRequest(request)");
  const inputClear = sendAiDraft.indexOf("setActiveInput((current)");

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

test("mobile transport forwards parsed quota updates to visible screen state", () => {
  const xhrTransport = sourceBetween(
    "function streamChatWithXhr",
    "function waitForUnlessAborted",
  );
  const requestTransport = sourceBetween(
    "async function requestChatStream",
    "function getAiFailureMessage",
  );

  assert.match(xhrTransport, /createChatStreamParser\(onText,\s*onQuota,\s*onDoneMetadata\)/);
  assert.match(requestTransport, /streamChatWithXhr\([\s\S]*?onText,\s*onQuota,\s*onDoneMetadata/);
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
  assert.match(partnerDraftType, /visibility: "shared"/);
  assert.match(durableLookup, /\.eq\("visibility", draft\.visibility\)/);
  assert.match(partnerSend, /visibility: draft\.visibility/);
  assert.match(aiSend, /visibility: draft\.visibility/);
  assert.match(aiSend, /body:[\s\S]*visibility: draft\.visibility/);
  assert.match(aiStream, /visibility: request\.body\.visibility/);
  assert.match(sendHandler, /chatVisibilityForScope\(activeScope, userRole\)/);
  assert.match(sendHandler, /visibility: activeVisibility/);
});

test("mobile UI exposes accessible shared/private scopes and renders only the selected scope", () => {
  assert.match(
    sourceText,
    /const \[activeScope, setActiveScope\] = useState<ChatScope>\("shared"\)/,
  );
  assert.match(sourceText, /const \[inputByScope, setInputByScope\] = useState<ChatScopeDrafts>/);
  assert.match(sourceText, /const input = inputByScope\[activeScope\]/);
  assert.match(sourceText, /updateChatScopeDraft\(currentDrafts, activeScope, resolvedInput\)/);
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
  assert.match(sourceText, /현재 범위 · 나만 \(상담\) — 상대방에게 보이지 않아요/);
  assert.match(sourceText, /activeScope === "shared" && \(/);
});
