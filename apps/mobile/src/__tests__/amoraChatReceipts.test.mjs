import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";
import {
  QUOTE_ANALYSIS_REOPEN_FALLBACK,
  getQuoteAnalysisExpectedItemIds,
  getQuoteAnalysisMessagePresentation,
} from "@hanbang/shared/quote-analysis-presentation";
import {
  resolvePlanningFoundationFirstValue,
} from "@hanbang/shared/amora-planning-foundation";
import {
  buildFirstUseSharedActionDraft,
  buildPlanningFoundationPrivateDraft,
  getFirstUsePendingActionPresentation,
  parseFirstUseSharedActionDraft,
} from "../lib/amoraEntryPlan.mjs";
import {
  resolveActionReceiptHomeHandoff,
  stageActionReceiptHomeHandoff,
} from "../lib/actionReceiptHomeHandoff.mjs";

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
    "isRecord",
    "containsInternalToolIdentifier",
    "getMobileToolReceiptActionId",
    "getMobileToolReceiptTitle",
    "getUserFacingToolDisplayMessage",
    "getMobileChatMessagePresentation",
    "mergeToolResults",
  ]);
  const declarations = sourceFile.statements
    .filter((statement) => {
      if (
        ts.isFunctionDeclaration(statement)
        && statement.name
        && functionNames.has(statement.name.text)
      ) return true;
      return ts.isVariableStatement(statement)
        && statement.declarationList.declarations.some((declaration) =>
          ts.isIdentifier(declaration.name)
          && declaration.name.text === "MOBILE_AMORA_ACTION_ID_PATTERN"
        );
    })
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

function loadReceiptContinuationContract() {
  const declarations = sourceFile.statements
    .filter((statement) =>
      (
        ts.isFunctionDeclaration(statement)
        && statement.name?.text === "getMobileToolReceiptContinuation"
      )
      || (
        ts.isVariableStatement(statement)
        && statement.declarationList.declarations.some((declaration) =>
          ts.isIdentifier(declaration.name)
          && declaration.name.text === "MOBILE_AMORA_ACTION_ID_PATTERN"
        )
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
    `${transpiled.outputText}\nreturn { getMobileToolReceiptContinuation };`,
  )();
}

function loadDoneOnlyApplicationContract() {
  const functionNames = new Set([
    "nonEmptyString",
    "isRecord",
    "asToolExecutionResult",
    "mergeToolResults",
    "asChatMessageMetadata",
    "asChatStreamEvent",
    "parseChatRetryPolicy",
    "applyChatEvent",
    "cleanAiText",
    "createChatStreamParser",
    "applyChatStreamUpdate",
    "messageRequestKey",
    "mergePersistedMessageWithLocal",
    "reconcileChatStreamUpdate",
  ]);
  const declarations = sourceFile.statements
    .filter((statement) =>
      (
        ts.isClassDeclaration(statement)
        && statement.name?.text === "ChatTransportError"
      )
      || (
        ts.isFunctionDeclaration(statement)
        && statement.name
        && functionNames.has(statement.name.text)
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
    `${transpiled.outputText}\nreturn { createChatStreamParser, reconcileChatStreamUpdate };`,
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

test("the native message renderer suppresses unverified mediation prose without suppressing receipts", () => {
  const renderStart = sourceText.indexOf("function renderMessage");
  const renderEnd = sourceText.indexOf("const isP = activeScope", renderStart);
  assert.notEqual(renderStart, -1);
  assert.notEqual(renderEnd, -1);
  const renderMessage = sourceText.slice(renderStart, renderEnd);
  const bubbleGate = renderMessage.indexOf(
    "{shouldRenderBubble && mediationBlock === null && (",
  );
  const receiptMount = renderMessage.indexOf("{receipts.map(");

  assert.ok(bubbleGate >= 0);
  assert.ok(receiptMount > bubbleGate);
  assert.match(
    renderMessage.slice(bubbleGate, receiptMount),
    /shouldRenderBubble && mediationBlock === null/u,
  );
  assert.match(renderMessage.slice(receiptMount), /<MobileToolReceiptCard/u);
});

test("the native message renderer never offers topic-save for a withheld mediation message", () => {
  const renderStart = sourceText.indexOf("function renderMessage");
  const renderEnd = sourceText.indexOf("const isP = activeScope", renderStart);
  assert.notEqual(renderStart, -1);
  assert.notEqual(renderEnd, -1);
  const renderMessage = sourceText.slice(renderStart, renderEnd);

  assert.match(
    renderMessage,
    /const canSaveToPreparationTopic = mediationBlock === null\s*&& \(isResolvedTopicSource/u,
  );
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
        toolOutput: {
          action: {
            id: "act_first_use_1",
            title: "스튜디오 계약서 확인",
            status: "open",
          },
        },
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
    actionId: "act_first_use_1",
  }]);
});

test("one personalized first action reaches a canonical receipt and the same home action", async () => {
  const { createChatStreamParser, reconcileChatStreamUpdate } =
    loadDoneOnlyApplicationContract();
  const { getMobileChatMessagePresentation } = loadReceiptPresentationContract();
  const { getMobileToolReceiptContinuation } = loadReceiptContinuationContract();
  const serverMessageId = "90000000-0000-4000-8000-000000000009";
  const ownerUserId = "20000000-0000-4000-8000-000000000002";
  const coupleId = "30000000-0000-4000-8000-000000000003";
  const handoffId = "10000000-0000-4000-8000-000000000001";
  const confirmationRequestId = "40000000-0000-4000-8000-000000000004";
  const operationKey = "b".repeat(64);
  const requestKey = `chat:${ownerUserId}:${confirmationRequestId}`;
  const actionId = `act_${confirmationRequestId.replaceAll("-", "")}_${operationKey.slice(0, 24)}`;
  const firstValue = resolvePlanningFoundationFirstValue({
    preparationOverview: {
      version: 1,
      coverage: {
        version: 1,
        stage: "partial",
        connectedTopicCount: 19,
        journeyAxisCount: 10,
        gapCount: 7,
        issueCount: 0,
      },
      summary: {
        totalTopics: 19,
        unknownTopics: 19,
        notStartedTopics: 0,
        inProgressTopics: 0,
        completedTopics: 0,
        notApplicableTopics: 0,
        needsReviewTopics: 0,
        completedItems: 0,
        totalItems: 95,
        percent: 0,
      },
      topics: [],
      attentionTopics: [],
    },
    selfReportedStage: "starting",
  });
  assert.equal(firstValue.kind, "action");
  const privateDraft = buildPlanningFoundationPrivateDraft("starting");
  assert.match(privateDraft ?? "", /자동|저장하지 말/u);
  const sharedDraft = buildFirstUseSharedActionDraft({
    action: firstValue.title,
    reason: firstValue.reason,
    completionCriterion: firstValue.completionCriterion,
  });
  assert.deepEqual(parseFirstUseSharedActionDraft(sharedDraft), {
    action: firstValue.title,
    reason: firstValue.reason,
    completionCriterion: firstValue.completionCriterion,
  });

  const pendingActionId = "70000000-0000-4000-8000-000000000007";
  const pendingAction = {
    version: 2,
    actionId: pendingActionId,
    tool: "add_amora_action",
    input: {
      title: firstValue.title,
      description: `이유: ${firstValue.reason} 완료 기준: ${firstValue.completionCriterion}`,
      category_key: "general",
      priority: "medium",
      source: "chat",
    },
  };
  assert.equal(getFirstUsePendingActionPresentation({
    pendingAction,
    metadata: {
      client_request_id: "proposal-request",
      client_visible_request_id: "proposal-visible-request",
      in_reply_to_user_message_id: "80000000-0000-4000-8000-000000000008",
      question_scope: "W0_wedding_core",
      memory_eligible: false,
      memory_enqueue_requested: false,
      amora_wedding_context_revision: 1,
      pending_amora_action_journey_revision: 1,
      amora_first_use_promotion_id: "60000000-0000-4000-8000-000000000006",
      response_origin: "server_authoritative_first_use_promotion",
      provider_call_count: 0,
      pending_amora_action: pendingAction,
    },
  })?.applyLabel, "확인하고 준비에 추가");

  const actionTitle = firstValue.title;
  const actionDescription = pendingAction.input.description;
  const displayMessage = `"${actionTitle}"을 아모라 행동 카드로 저장했어요.`;
  const toolResult = {
    toolName: "add_amora_action",
    toolInput: {
      title: actionTitle,
      description: actionDescription,
      category_key: "general",
      priority: "medium",
      source: "chat",
    },
    toolOutput: {
      action: {
        id: actionId,
        title: actionTitle,
        description: actionDescription,
        dueDate: null,
        categoryKey: null,
        priority: "medium",
        status: "open",
        source: "chat",
        href: "/wedding/lounge",
      },
    },
    success: true,
    displayMessage,
  };
  const updates = [];
  const parser = createChatStreamParser((text, toolResults, metadata) => {
    updates.push({ text, toolResults, metadata });
  });

  parser.push(`data: ${JSON.stringify({
    type: "done",
    fullContent: displayMessage,
    metadata: {
      serverMessageId,
      response_origin: "server_authoritative_first_use_action_application",
      provider_call_count: 0,
      toolResults: [toolResult],
    },
  })}\n\n`);

  const completion = {
    text: parser.finish(),
    toolResults: parser.getToolResults(),
    metadata: parser.getMetadata(),
  };
  assert.equal(updates.length, 1, "the done event alone must publish the canonical receipt");
  assert.equal(completion.metadata?.response_origin,
    "server_authoritative_first_use_action_application");
  assert.equal(completion.metadata?.provider_call_count, 0);
  assert.deepEqual(completion.toolResults, [toolResult]);

  const [message] = reconcileChatStreamUpdate(
    [{
      id: "temp_first-use-application-request",
      role: "assistant",
      sender_type: "ai",
      content: "",
      metadata: { client_request_id: requestKey },
    }],
    "temp_first-use-application-request",
    requestKey,
    completion,
  );
  assert.equal(message.id, serverMessageId);

  const presentation = getMobileChatMessagePresentation(message, false);
  assert.deepEqual(presentation.receipts, [{
    toolName: "add_amora_action",
    title: "아모라 행동 저장",
    success: true,
    message: displayMessage,
    actionId,
  }]);
  const continuation = getMobileToolReceiptContinuation(presentation.receipts[0]);
  assert.equal(continuation?.actionId, actionId);

  assert.equal(stageActionReceiptHomeHandoff({
    handoffId,
    ownerUserId,
    coupleId,
    actionId: continuation?.actionId,
    nowMs: 1_000,
  }), handoffId);
  const homeResolution = await resolveActionReceiptHomeHandoff({
    handoffId,
    expectedOwnerUserId: ownerUserId,
    expectedCoupleId: coupleId,
    nowMs: 1_001,
    isResolutionCurrent: () => true,
    readCurrentOpenAction: async ({ actionId: requestedActionId, coupleId: requestedCoupleId }) => ({
      ok: true,
      value: {
        id: requestedActionId,
        couple_id: requestedCoupleId,
        title: actionTitle,
        description: actionDescription,
        due_date: null,
        category_key: null,
        priority: "medium",
        status: "open",
        source: "chat",
        follow_up_revision: null,
        created_at: "2026-08-17T12:00:00.000Z",
      },
    }),
  });
  assert.equal(homeResolution.state, "focused");
  assert.equal(homeResolution.action?.id, actionId);
  assert.equal(homeResolution.action?.title, firstValue.title);

  const closedPresentation = getMobileChatMessagePresentation({
    ...message,
    metadata: {
      ...message.metadata,
      toolResults: [{
        ...toolResult,
        toolOutput: { action: { ...toolResult.toolOutput.action, status: "done" } },
      }],
    },
  }, false);
  assert.equal(
    getMobileToolReceiptContinuation(closedPresentation.receipts[0]),
    null,
    "a non-open action must not create a home continuation",
  );
});

test("a successful Amora action receipt offers one explicit continuation to the personalized home", () => {
  const { getMobileToolReceiptContinuation } = loadReceiptContinuationContract();

  assert.deepEqual(getMobileToolReceiptContinuation({
    toolName: "add_amora_action",
    title: "아모라 행동 저장",
    success: true,
    message: "스튜디오 계약서 확인을 아모라 행동 카드로 저장했어요.",
    actionId: "act_first_use_1",
  }), {
    actionId: "act_first_use_1",
    label: "홈에서 다음 한 가지 보기",
    description: "방금 저장한 행동의 이유와 완료 기준을 확인하고, 결과를 남기면 다음 준비로 이어져요.",
  });
});

test("failed or unrelated receipts never imply that a personalized home action is ready", () => {
  const { getMobileToolReceiptContinuation } = loadReceiptContinuationContract();
  const actionReceipt = {
    toolName: "add_amora_action",
    title: "아모라 행동 저장",
    success: true,
    message: "행동 카드로 저장했어요.",
    actionId: "act_first_use_1",
  };

  assert.equal(getMobileToolReceiptContinuation({ ...actionReceipt, success: false }), null);
  assert.equal(getMobileToolReceiptContinuation({ ...actionReceipt, toolName: "update_budget" }), null);
  assert.equal(getMobileToolReceiptContinuation({ ...actionReceipt, toolName: "create_booking" }), null);
  assert.equal(getMobileToolReceiptContinuation({ ...actionReceipt, actionId: undefined }), null);
});

test("the receipt continuation stays user-triggered and independently accessible", () => {
  const componentStart = sourceText.indexOf("function MobileToolReceiptCard");
  const componentEnd = sourceText.indexOf("function MobileQuoteCheckCard", componentStart);
  const component = sourceText.slice(componentStart, componentEnd);
  const continuationButtonStyle = sourceText.match(
    /toolReceiptContinuationButton:\s*\{([^}]+)\}/u,
  )?.[1] ?? "";

  assert.ok(componentStart >= 0 && componentEnd > componentStart);
  assert.match(component, /const continuation = getMobileToolReceiptContinuation\(receipt\)/u);
  assert.match(component, /continuation && \([\s\S]*<Pressable/u);
  assert.match(component, /onPress=\{\(\) => onOpenHome\(continuation\.actionId\)\}/u);
  assert.match(component, /accessibilityRole="button"/u);
  assert.match(component, /accessibilityLabel=\{continuation\.label\}/u);
  assert.match(component, /accessibilityHint="개인화된 다음 행동과 그 이유를 확인합니다"/u);
  assert.doesNotMatch(component, /useEffect[\s\S]*router\.(?:push|replace)/u);
  assert.match(continuationButtonStyle, /minHeight:\s*48/u);
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

test("mobile quote analysis opens the canonical interactive checker instead of a dead receipt", () => {
  const { getMobileChatMessagePresentation } = loadReceiptPresentationContract();
  const presentation = getMobileChatMessagePresentation({
    id: "assistant-quote",
    sender_type: "ai",
    content: "견적 항목을 확인해볼게요.",
    metadata: {
      toolResults: [{
        toolName: "analyze_quote",
        toolInput: { category: "studio" },
        toolOutput: { state: "needs_checklist" },
        success: true,
        displayMessage: "포함 항목 체크리스트를 확인해 주세요.",
      }],
    },
  }, false);

  assert.deepEqual(presentation.receipts, []);
  assert.equal(presentation.hasQuoteCheck, true);
  assert.match(sourceText, /onOpenQuoteCheck=\{\(\) => router\.push\("\/quote-check"\)\}/u);
  assert.match(sourceText, /견적 체크 열기/u);
});

test("mobile uses the shared strict presentation contract for v2, legacy, and malformed messages", () => {
  const ids = getQuoteAnalysisExpectedItemIds("studio");
  const valid = `견적 체크: 테스트 스튜디오 · 사진 촬영 · 서울 · 300만원\n[quote_analysis_v2]\n${JSON.stringify({ version: 2, category: "studio", region: "seoul", quotePriceManwon: 300, vendorName: "테스트 스튜디오", states: { included: [], notNeeded: [], unknown: ids } })}\n[/quote_analysis_v2]`;
  assert.deepEqual(getQuoteAnalysisMessagePresentation(valid), {
    kind: "valid_v2",
    text: "견적 체크: 테스트 스튜디오 · 사진 촬영 · 서울 · 300만원",
  });
  const malformed = `안내\n[quote_analysis_v2]\n{"private":"raw-json"}`;
  const visible = getQuoteAnalysisMessagePresentation(malformed).text;
  assert.equal(visible, QUOTE_ANALYSIS_REOPEN_FALLBACK);
  assert.doesNotMatch(visible, /raw-json|private/u);
  const legacy = `[quote_analysis] 견적 300만원 (테스트) 항목 상태:\n포함: 야외 촬영`;
  assert.equal(getQuoteAnalysisMessagePresentation(legacy).text, QUOTE_ANALYSIS_REOPEN_FALLBACK);
  const forged = valid.replace(ids[0], "forged_item");
  assert.equal(getQuoteAnalysisMessagePresentation(forged).text, QUOTE_ANALYSIS_REOPEN_FALLBACK);
  assert.match(
    sourceText,
    /getQuoteAnalysisMessagePresentation\(visibleBubbleContent \?\? ""\)\.text/u,
  );
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

test("the mobile Amora header uses the canonical AI wedding companion identity", () => {
  const headerStart = sourceText.indexOf("<View style={st.header}>");
  const headerEnd = sourceText.indexOf("<View style={st.scopeSection}", headerStart);
  assert.notEqual(headerStart, -1);
  assert.notEqual(headerEnd, -1);
  const header = sourceText.slice(headerStart, headerEnd);

  assert.match(header, />AI 결혼 준비 동반자</u);
  assert.doesNotMatch(header, />AI 파트너</u);
  assert.doesNotMatch(header, /AI 웨딩 플래너/u);
});

test("the Amora and partner target toggle exposes tab labels and selected state", () => {
  const targetStart = sourceText.indexOf("<View style={st.targetRow}>");
  const targetEnd = sourceText.indexOf("<KeyboardAvoidingView", targetStart);
  assert.notEqual(targetStart, -1);
  assert.notEqual(targetEnd, -1);
  const targetToggle = sourceText.slice(targetStart, targetEnd);

  assert.equal(targetToggle.match(/accessibilityRole="tab"/gu)?.length, 2);
  assert.match(targetToggle, /accessibilityLabel="AI 결혼 준비 동반자 아모라와 대화"/u);
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
