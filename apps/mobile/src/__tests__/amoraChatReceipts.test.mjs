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

function loadReceiptPresentationContract() {
  const functionNames = new Set([
    "containsInternalToolIdentifier",
    "getMobileToolReceiptTitle",
    "getUserFacingToolDisplayMessage",
    "getMobileChatMessagePresentation",
    "mergeToolResults",
  ]);
  const declarations = sourceFile.statements
    .filter((statement) =>
      ts.isFunctionDeclaration(statement)
      && statement.name
      && functionNames.has(statement.name.text)
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
    `${transpiled.outputText}\nreturn { getMobileChatMessagePresentation };`,
  )();
}

function loadReceiptAccessibilityContract() {
  const declaration = sourceFile.statements
    .find((statement) =>
      ts.isFunctionDeclaration(statement)
      && statement.name?.text === "getMobileToolReceiptStatusLabel"
    );
  const transpiled = ts.transpileModule(declaration?.getFullText(sourceFile) ?? "", {
    compilerOptions: {
      module: ts.ModuleKind.None,
      target: ts.ScriptTarget.ES2022,
    },
  });
  return new Function(
    `${transpiled.outputText}\nreturn { getMobileToolReceiptStatusLabel };`,
  )();
}

test("an empty persisted assistant message still presents its canonical budget receipt", () => {
  const { getMobileChatMessagePresentation } = loadReceiptPresentationContract();
  const presentation = getMobileChatMessagePresentation({
    id: "assistant-1",
    sender_type: "ai",
    content: "",
    metadata: {
      toolResults: [{
        toolName: "update_budget",
        toolInput: { total_budget: 30_000_000 },
        toolOutput: { total_budget: 30_000_000 },
        success: true,
        displayMessage: "총예산을 3,000만원으로 변경했어요.",
      }],
    },
  }, false);

  assert.equal(presentation.shouldRenderBubble, false);
  assert.equal(presentation.isThinking, false);
  assert.deepEqual(presentation.receipts, [{
    toolName: "update_budget",
    title: "예산 변경",
    success: true,
    message: "총예산을 3,000만원으로 변경했어요.",
  }]);
});

test("the native message renderer mounts receipts independently of the text bubble", () => {
  const renderStart = sourceText.indexOf("function renderMessage");
  const renderEnd = sourceText.indexOf("const isP = activeScope", renderStart);
  assert.notEqual(renderStart, -1);
  assert.notEqual(renderEnd, -1);
  const renderMessage = sourceText.slice(renderStart, renderEnd);
  const bubbleGate = renderMessage.indexOf("{shouldRenderBubble && (");
  const receiptMount = renderMessage.indexOf("{receipts.map(");

  assert.ok(bubbleGate >= 0);
  assert.ok(receiptMount > bubbleGate);
  assert.match(renderMessage.slice(receiptMount), /<MobileToolReceiptCard/u);
});

test("a persisted schedule failure keeps the canonical failure receipt", () => {
  const { getMobileChatMessagePresentation } = loadReceiptPresentationContract();
  const presentation = getMobileChatMessagePresentation({
    id: "assistant-2",
    sender_type: "ai",
    content: "일정을 확인해볼게요.",
    metadata: {
      toolResults: [{
        toolName: "update_schedule_event",
        toolInput: {},
        toolOutput: { error: "schedule_target_changed" },
        success: false,
        displayMessage: "선택한 일정이 달라져 반영하지 않았어요. 현재 일정을 다시 확인해 주세요.",
      }],
    },
  }, false);

  assert.deepEqual(presentation.receipts, [{
    toolName: "update_schedule_event",
    title: "일정 변경",
    success: false,
    message: "선택한 일정이 달라져 반영하지 않았어요. 현재 일정을 다시 확인해 주세요.",
  }]);
});

test("a persisted Amora action mutation is presented as an action receipt", () => {
  const { getMobileChatMessagePresentation } = loadReceiptPresentationContract();
  const presentation = getMobileChatMessagePresentation({
    id: "assistant-3",
    sender_type: "ai",
    content: "",
    metadata: {
      toolResults: [{
        toolName: "add_amora_action",
        toolInput: { title: "스튜디오 계약서 확인" },
        toolOutput: { action: { title: "스튜디오 계약서 확인" } },
        success: true,
        displayMessage: "스튜디오 계약서 확인을 아모라 행동 카드로 저장했어요.",
      }],
    },
  }, false);

  assert.deepEqual(presentation.receipts, [{
    toolName: "add_amora_action",
    title: "아모라 행동 저장",
    success: true,
    message: "스튜디오 계약서 확인을 아모라 행동 카드로 저장했어요.",
  }]);
});

test("a persisted booking mutation keeps its non-confirmation receipt copy", () => {
  const { getMobileChatMessagePresentation } = loadReceiptPresentationContract();
  const displayMessage = "아모라 안에 예약 요청을 기록했어요. 업체에 전달되거나 확정된 상태는 아니에요.";
  const presentation = getMobileChatMessagePresentation({
    id: "assistant-4",
    sender_type: "ai",
    content: "",
    metadata: {
      toolResults: [{
        toolName: "create_booking",
        toolInput: {},
        toolOutput: { status: "pending", vendorDeliveryStatus: "not_sent" },
        success: true,
        displayMessage,
      }],
    },
  }, false);

  assert.deepEqual(presentation.receipts, [{
    toolName: "create_booking",
    title: "아모라 예약 요청 기록",
    success: true,
    message: displayMessage,
  }]);
});

test("a booking success is announced as a request record rather than a confirmed booking", () => {
  const { getMobileToolReceiptStatusLabel } = loadReceiptAccessibilityContract();
  const label = getMobileToolReceiptStatusLabel({
    toolName: "create_booking",
    title: "아모라 예약 요청 기록",
    success: true,
    message: "업체에 전달되거나 확정된 상태는 아니에요.",
  });

  assert.equal(label, "예약 요청 기록 완료");
  assert.doesNotMatch(label, /예약 확정/u);
});

test("a cold-start message presents an identical persisted receipt only once", () => {
  const { getMobileChatMessagePresentation } = loadReceiptPresentationContract();
  const result = {
    toolName: "update_budget",
    toolInput: { total_budget: 30_000_000 },
    toolOutput: { total_budget: 30_000_000 },
    success: true,
    displayMessage: "총예산을 3,000만원으로 변경했어요.",
  };
  const presentation = getMobileChatMessagePresentation({
    id: "assistant-duplicate",
    sender_type: "ai",
    content: "",
    metadata: { toolResults: [result, { ...result }] },
  }, false);

  assert.equal(presentation.receipts.length, 1);
  assert.equal(presentation.receipts[0]?.message, result.displayMessage);
});

test("a persisted failure receipt does not expose an internal schedule identifier", () => {
  const { getMobileChatMessagePresentation } = loadReceiptPresentationContract();
  const eventId = "5af85321-a883-4c4e-9ef2-f323f8944631";
  const presentation = getMobileChatMessagePresentation({
    id: "assistant-5",
    sender_type: "ai",
    content: "",
    metadata: {
      toolResults: [{
        toolName: "update_schedule_event",
        toolInput: { event_id: eventId },
        toolOutput: { error: "schedule_event_not_found" },
        success: false,
        displayMessage: `일정을 찾을 수 없습니다 (ID: ${eventId})`,
      }],
    },
  }, false);

  assert.equal(
    presentation.receipts[0]?.message,
    "수정할 일정을 찾지 못했어요. 일정 목록을 새로 불러온 뒤 다시 선택해 주세요.",
  );
  assert.doesNotMatch(presentation.receipts[0]?.message ?? "", /5af85321/u);
});

test("the mobile Amora header uses the approved AI partner identity", () => {
  const headerStart = sourceText.indexOf("<View style={st.header}>");
  const headerEnd = sourceText.indexOf("<View style={st.scopeSection}", headerStart);
  assert.notEqual(headerStart, -1);
  assert.notEqual(headerEnd, -1);
  const header = sourceText.slice(headerStart, headerEnd);

  assert.match(header, />AI 파트너</u);
  assert.doesNotMatch(header, /AI 웨딩 플래너/u);
});

test("the Amora and partner target toggle exposes tab labels and selected state", () => {
  const targetStart = sourceText.indexOf("<View style={st.targetRow}>");
  const targetEnd = sourceText.indexOf("<KeyboardAvoidingView", targetStart);
  assert.notEqual(targetStart, -1);
  assert.notEqual(targetEnd, -1);
  const targetToggle = sourceText.slice(targetStart, targetEnd);

  assert.equal(targetToggle.match(/accessibilityRole="tab"/gu)?.length, 2);
  assert.match(targetToggle, /accessibilityLabel="아모라 AI 파트너와 대화"/u);
  assert.match(
    targetToggle,
    /accessibilityState=\{\{[\s\S]*?selected: !isP,[\s\S]*?disabled: streaming \|\| pendingIngestReconciliation,[\s\S]*?\}\}/u,
  );
  assert.match(targetToggle, /accessibilityLabel=\{`\$\{partnerName \?\? "파트너"\}와 대화`\}/u);
  assert.match(
    targetToggle,
    /accessibilityState=\{\{[\s\S]*?selected: isP,[\s\S]*?disabled: streaming \|\| pendingIngestReconciliation,[\s\S]*?\}\}/u,
  );
});
