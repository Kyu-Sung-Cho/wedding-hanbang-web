import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { URL } from "node:url";

import {
  buildAmoraMediationRequestBody,
  createAmoraMediationDismissalRecord,
  normalizeAmoraMediationSummary,
  parseAmoraMediationDismissalRecord,
} from "../lib/amoraMediationRequest.mjs";

test("mediation summary is trimmed, bounded, and never silently truncated", () => {
  assert.deepEqual(normalizeAmoraMediationSummary("  예산 상한선을 두고 의견이 달라요.  "), {
    ok: true,
    summary: "예산 상한선을 두고 의견이 달라요.",
  });
  assert.deepEqual(normalizeAmoraMediationSummary(" 세 글 "), {
    ok: false,
    reason: "too_short",
  });
  assert.deepEqual(normalizeAmoraMediationSummary("가".repeat(601)), {
    ok: false,
    reason: "too_long",
  });
});

test("the consent sheet accepts only text the requester types into that sheet", () => {
  const source = readFileSync(
    new URL("../components/chat/AmoraMediationConsentModal.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /normalizeAmoraMediationSummary\(summary\)/);
  assert.match(source, /maxLength=\{600\}/);
  assert.match(source, /onConfirm\(normalized\.summary\)/);
  assert.match(source, /초안은 먼저 나만 보고, 직접 보내기 전에는 상대에게 보이지 않아요/);
  assert.doesNotMatch(source, /messages\s*:/);
  assert.doesNotMatch(source, /conversation|history|rawMessages/);
});

test("mediation request contains only the requester's explicit summary", () => {
  const body = buildAmoraMediationRequestBody({
    summary: "예산 상한선을 두고 의견이 달라요.",
    senderRole: "bride",
    senderName: "지민",
    coupleId: "11111111-1111-4111-8111-111111111111",
    clientRequestId: "22222222-2222-4222-8222-222222222222",
  });

  assert.deepEqual(body, {
    messages: [{
      role: "user",
      content: "[신부] [MEDIATION_REQUEST] 내가 직접 작성한 조율 요청 요약: 예산 상한선을 두고 의견이 달라요.",
    }],
    coupleId: "11111111-1111-4111-8111-111111111111",
    senderName: "지민",
    clientRequestId: "22222222-2222-4222-8222-222222222222",
    requestKind: "mediation",
    conflictContext: "예산 상한선을 두고 의견이 달라요.",
    visibility: "bride_private",
  });
  assert.equal("userMessageId" in body, false);
  assert.equal(JSON.stringify(body).includes("rawMessages"), false);
});

test("mediation draft lane is derived from the initiating member role", () => {
  const groom = buildAmoraMediationRequestBody({
    summary: "일정 우선순위를 함께 정하고 싶어요.",
    senderRole: "groom",
    senderName: "민수",
    coupleId: "11111111-1111-4111-8111-111111111111",
    clientRequestId: "22222222-2222-4222-8222-222222222222",
  });

  assert.equal(groom.visibility, "groom_private");
});

test("neutral preparation spaces label the requester without exposing compatibility roles", () => {
  const body = buildAmoraMediationRequestBody({
    summary: "준비 우선순위를 함께 정하고 싶어요.",
    senderRole: "bride",
    senderName: "민지",
    memberModelVersion: 2,
    coupleId: "30000000-0000-4000-8000-000000000003",
    clientRequestId: "40000000-0000-4000-8000-000000000004",
  });

  assert.equal(
    body.messages[0]?.content,
    "[사용자] [MEDIATION_REQUEST] 내가 직접 작성한 조율 요청 요약: 준비 우선순위를 함께 정하고 싶어요.",
  );
  assert.doesNotMatch(body.messages[0]?.content ?? "", /신부|신랑/u);
});

test("mobile mediation checks safety and the initiating account before any shared request", () => {
  const source = readFileSync(
    new URL("../../app/(tabs)/chat.tsx", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("async function handleConfirmMediationRequest");
  const end = source.indexOf("async function handleColdStartAiRecovery", start);
  assert.ok(start >= 0 && end > start, "mobile mediation submit handler is missing");
  const handler = source.slice(start, end);

  const identityFence = handler.indexOf("sessionUserIdRef.current !== requestOwner.userId");
  const safetyPlan = handler.indexOf("planAmoraCrisisDelivery");
  const operation = handler.indexOf("beginChatSendOperation");
  const network = handler.indexOf("streamAiRequest");
  assert.ok(identityFence >= 0, "the initiating account is not frozen");
  assert.ok(safetyPlan > identityFence, "safety must follow the owner fence");
  assert.ok(operation > safetyPlan, "no sending state may start before safety resolves");
  assert.ok(network > operation, "the shared request must happen last");
  assert.doesNotMatch(handler, /requestAiMessageIngest|sendAiDraft|rawMessages/);
  assert.match(
    handler,
    /externalSafetySignal:\s*hasMediationSafetySignal\(normalized\.summary\)/,
  );
  assert.match(handler, /lane:\s*"private_ai"/);
  assert.match(handler, /setActiveScope\("private"\)/);
  assert.match(handler, /requestKind:\s*"mediation"/);
  assert.match(handler, /conflictContext:/);
  assert.match(source, /<AmoraMediationConsentModal/);
});

test("mobile explains a stopped or interrupted mediation without claiming the summary was saved", () => {
  const source = readFileSync(
    new URL("../../app/(tabs)/chat.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /case "MEDIATION_SAFETY_PREFLIGHT_REQUIRED"/);
  assert.match(source, /requestKind === "mediation"/);
  assert.match(source, /같은 요약으로 다시 시도할 수 있어요/);
  assert.doesNotMatch(
    source.match(/function getAiFailureMessage[\s\S]*?\n\}/)?.[0] ?? "",
    /중재[\s\S]*저장되어/,
  );
});

test("mobile offers optional help for the current conflict event and dismisses only that event", () => {
  const source = readFileSync(
    new URL("../../app/(tabs)/chat.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /assessMediationOffer/);
  assert.match(source, /mediationOffer\.offerKey/);
  assert.match(source, /dismissedMediationOfferKeys\.has\(mediationOffer\.offerKey\)/);
  assert.match(source, /function rememberMediationOfferDismissal/);
  assert.match(source, /setDismissedMediationOfferKeys\(next\)/);
  assert.match(source, /handleOpenMediationRequest\(mediationOffer\.offerKey\)/);
  assert.match(source, /두 분이 모두 확인해야 공동 결정/);
  assert.doesNotMatch(source, /자동 중재|갈등으로 판정/);
});

test("mobile suppresses automatic and manual mediation while this actor has an unresolved private safety hold", () => {
  const source = readFileSync(
    new URL("../../app/(tabs)/chat.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /const hasLocalPrivateMediationSafetyHold = useMemo/);
  assert.match(
    source,
    /hasUnresolvedPrivateMediationSafetyHold\(\s*localCoupleMessages,\s*userRole\s*\)/,
  );
  assert.match(
    source,
    /messages\.filter\(\(message\) => message\.couple_id === coupleId\)/,
  );
  assert.doesNotMatch(source, /latestPrivateMessage/);
  assert.match(
    source,
    /shouldShowMediationOffer[\s\S]{0,260}!hasLocalPrivateMediationSafetyHold/,
  );
  assert.match(
    source,
    /function handleOpenMediationRequest[\s\S]{0,420}hasLocalPrivateMediationSafetyHold/,
  );
  assert.match(
    source,
    /hasLinkedPartner && !hasActiveW5SafetyCard[\s\S]{0,100}!hasLocalPrivateMediationSafetyHold/,
  );
});

test("a device safety hold survives restart and is rechecked before mediation only", () => {
  const source = readFileSync(
    new URL("../../app/(tabs)/chat.tsx", import.meta.url),
    "utf8",
  );
  const openStart = source.indexOf("async function handleOpenMediationRequest");
  const openEnd = source.indexOf("function rememberMediationOfferDismissal", openStart);
  const confirmStart = source.indexOf("async function handleConfirmMediationRequest");
  const confirmEnd = source.indexOf("async function handleColdStartAiRecovery", confirmStart);
  const sendStart = source.indexOf("async function handleSend");
  const sendEnd = source.indexOf("function handleInputChange", sendStart);
  const open = source.slice(openStart, openEnd);
  const confirm = source.slice(confirmStart, confirmEnd);
  const ordinarySend = source.slice(sendStart, sendEnd);

  assert.match(source, /hasPrivateMediationSafetyHold/);
  assert.match(source, /useState\(true\)/);
  assert.match(
    source,
    /loadAmoraMediationOfferDismissals[\s\S]{0,500}hasPrivateMediationSafetyHold\(\{[\s\S]{0,180}ownerUserId:\s*user\.id[\s\S]{0,180}coupleId:\s*profile\.couple_id/,
  );
  assert.match(source, /setHasDevicePrivateMediationSafetyHold\(deviceSafetyHold\)/);
  assert.match(source, /hasMediationSafetyFence[\s\S]{0,160}hasDevicePrivateMediationSafetyHold/);
  assert.match(open, /await hasPrivateMediationSafetyHold\(/);
  assert.match(confirm, /await hasPrivateMediationSafetyHold\(/);
  assert.match(open, /applyMediationSafetyFence\(\)/);
  assert.match(confirm, /applyMediationSafetyFence\(\)/);
  assert.doesNotMatch(ordinarySend, /await hasPrivateMediationSafetyHold\(/);
});

test("mobile closes every mediation entry and an already-open consent sheet when a shared safety card is visible", () => {
  const source = readFileSync(
    new URL("../../app/(tabs)/chat.tsx", import.meta.url),
    "utf8",
  );
  const openStart = source.indexOf("function handleOpenMediationRequest");
  const openEnd = source.indexOf("function rememberMediationOfferDismissal", openStart);
  const confirmStart = source.indexOf("async function handleConfirmMediationRequest");
  const confirmEnd = source.indexOf("async function handleColdStartAiRecovery", confirmStart);
  const openHandler = source.slice(openStart, openEnd);
  const confirmHandler = source.slice(confirmStart, confirmEnd);

  assert.match(source, /const hasVisibleSharedMediationSafetyCard = useMemo/);
  assert.match(
    source,
    /message\.visibility === "shared"[\s\S]{0,240}message\.sender_type === "ai"[\s\S]{0,240}pinned_safety_card[\s\S]{0,240}safety_classification/,
  );
  assert.match(
    source,
    /shouldShowMediationOffer[\s\S]{0,320}!hasVisibleSharedMediationSafetyCard/,
  );
  assert.match(openHandler, /hasVisibleSharedMediationSafetyCard/);
  assert.match(confirmHandler, /hasVisibleSharedMediationSafetyCard/);
  assert.match(
    source,
    /visible=\{mediationRequestOwner !== null[\s\S]{0,260}!hasVisibleSharedMediationSafetyCard/,
  );
  assert.match(
    source,
    /useEffect\(\(\) => \{\s*if \(!hasMediationSafetyFence\) return;[\s\S]{0,180}applyMediationSafetyFence\(\)[\s\S]{0,180}hasMediationSafetyFence/,
  );
  assert.match(
    source,
    /hasLinkedPartner && !hasActiveW5SafetyCard && !hasVisibleSharedMediationSafetyCard && !hasLocalPrivateMediationSafetyHold && !hasDevicePrivateMediationSafetyHold/,
  );
  assert.match(
    source,
    /activeScope === "shared" && hasLinkedPartner && !hasVisibleSharedMediationSafetyCard && !hasLocalPrivateMediationSafetyHold && !hasDevicePrivateMediationSafetyHold && shouldShowMediationOffer/,
  );
});

test("an in-flight mobile mediation is fenced from late output when a safety hold arrives", () => {
  const source = readFileSync(
    new URL("../../app/(tabs)/chat.tsx", import.meta.url),
    "utf8",
  );
  const streamStart = source.indexOf("async function streamAiRequest");
  const streamEnd = source.indexOf("async function sendAiDraft", streamStart);
  const stream = source.slice(streamStart, streamEnd);
  const fenceStart = source.indexOf("const applyMediationSafetyFence");
  const fenceEnd = source.indexOf("const resetChatSessionState", fenceStart);
  const fence = source.slice(fenceStart, fenceEnd);

  assert.ok(streamStart >= 0 && streamEnd > streamStart, "AI stream path is missing");
  assert.ok(fenceStart >= 0 && fenceEnd > fenceStart, "mediation safety fence is missing");
  assert.match(source, /mediationSafetyEpoch\??:\s*number/);
  assert.match(source, /requestKind:\s*"chat"\s*\|\s*"mediation"/);
  assert.match(stream, /isCurrentAiRequest\(request, operation\)/);
  assert.match(fence, /stopActive\("safety"\)/);
  assert.match(fence, /message\.id !== activeMediationTempId/);
  assert.match(fence, /failure\?\.kind === "ai_response"[\s\S]*request\.body\.requestKind === "mediation"/);
});

test("a safety hold discards the exact mediation retry before retransmission but leaves ordinary chat eligible", () => {
  const source = readFileSync(
    new URL("../../app/(tabs)/chat.tsx", import.meta.url),
    "utf8",
  );
  const retryStart = source.indexOf("async function handleRetry");
  const retryEnd = source.indexOf("async function handleSend", retryStart);
  const retry = source.slice(retryStart, retryEnd);
  const retryFence = retry.indexOf('failure.request.body.requestKind === "mediation"');
  const clearRetry = retry.indexOf('setLaneFailure("shared_ai", null)', retryFence);
  const beginOperation = retry.indexOf("beginChatSendOperation", retryFence);
  const retransmit = retry.indexOf("streamAiRequest(failure.request", retryFence);

  assert.ok(retryFence >= 0, "mediation retry must be identified");
  assert.ok(clearRetry > retryFence, "the retained mediation retry must be discarded");
  assert.ok(beginOperation > clearRetry, "no operation may start before the safety return");
  assert.ok(retransmit > beginOperation, "the network replay must remain after the safety return");
  assert.match(retry, /mediationSafetyBlockedRef\.current/);
  assert.match(
    source,
    /request\.body\.requestKind !== "mediation"[\s\S]{0,260}mediationSafetyBlockedRef\.current/,
  );
  assert.match(
    source,
    /activeSendFailure[\s\S]{0,180}!\(hasMediationSafetyFence && activeSendFailureIsMediation\)/,
  );
});

test("realtime safety delivery aborts mediation before React can render the incoming card", () => {
  const source = readFileSync(
    new URL("../../app/(tabs)/chat.tsx", import.meta.url),
    "utf8",
  );
  const insertStart = source.indexOf('.on("postgres_changes", { event: "INSERT"');
  const insertEnd = source.indexOf('.on("postgres_changes", { event: "UPDATE"', insertStart);
  const insert = source.slice(insertStart, insertEnd);
  const safetyCheck = insert.indexOf("isMediationSafetyFenceMessage(incoming, viewerRole)");
  const abortFence = insert.indexOf("applyMediationSafetyFence()", safetyCheck);
  const merge = insert.indexOf("mergeRealtimeMessage", safetyCheck);

  assert.ok(safetyCheck >= 0, "realtime safety rows must be identified");
  assert.ok(abortFence > safetyCheck, "the active mediation must be aborted immediately");
  assert.ok(merge > abortFence, "the abort must precede the React state merge");
});

test("dismissed conflict events are device-persistent only for the exact account and couple", () => {
  const nowMs = Date.parse("2026-08-12T12:00:00.000Z");
  const userId = "11111111-1111-4111-8111-111111111111";
  const coupleId = "22222222-2222-4222-8222-222222222222";
  const offerKey = "mediation-offer:v1:message-1:2026-08-12T11:59:00.000Z";
  const record = createAmoraMediationDismissalRecord({
    userId,
    coupleId,
    offerKeys: [offerKey],
    nowMs,
  });

  assert.deepEqual(parseAmoraMediationDismissalRecord(record, {
    userId,
    coupleId,
    nowMs,
  }), [offerKey]);
  assert.deepEqual(parseAmoraMediationDismissalRecord(record, {
    userId: "33333333-3333-4333-8333-333333333333",
    coupleId,
    nowMs,
  }), []);
  assert.deepEqual(parseAmoraMediationDismissalRecord(record, {
    userId,
    coupleId,
    nowMs: nowMs + (25 * 60 * 60 * 1000),
  }), []);
});

test("the mobile screen restores and writes only owner-bound dismissed offer keys", () => {
  const source = readFileSync(
    new URL("../../app/(tabs)/chat.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /loadAmoraMediationOfferDismissals\(user\.id, profile\.couple_id\)/);
  assert.match(source, /saveAmoraMediationOfferDismissals\(/);
  assert.match(source, /amoraMediationOfferDismissalKey\(userId, coupleId\)/);
  assert.match(source, /parseAmoraMediationDismissalRecord/);
  assert.match(source, /createAmoraMediationDismissalRecord/);
});
