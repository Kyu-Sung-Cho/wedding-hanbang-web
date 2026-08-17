import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";

import {
  PreparationTopicMessageRefError,
  loadPreparationTopicMessageReferences,
  loadPreparationTopicMessageReferenceState,
  mergePreparationTopicResolvedConversation,
  mutatePreparationTopicMessageReference,
  resolvePreparationTopicMessageReference,
  isPreparationTopicMessageSaveEligible,
  getPreparationTopicMessageReferenceFocusPresentation,
} from "../lib/preparationTopicMessageRefs.mjs";
import {
  buildPreparationTopicPresentation,
} from "../lib/preparationTopicPresentation.mjs";

const AI_MESSAGE_ID = "10000000-0000-4000-8000-000000000001";
const COUPLE_ID = "20000000-0000-4000-8000-000000000002";
const USER_MESSAGE_ID = "30000000-0000-4000-8000-000000000003";
const REF_IDS = [
  "50000000-0000-4000-8000-000000000005",
  "60000000-0000-4000-8000-000000000006",
  "70000000-0000-4000-8000-000000000007",
];
const chatSource = await readFile(
  new URL("../../app/(tabs)/chat.tsx", import.meta.url),
  "utf8",
);

function aiMessage(overrides = {}) {
  return {
    id: AI_MESSAGE_ID,
    couple_id: COUPLE_ID,
    sender_id: null,
    role: "assistant",
    sender_type: "ai",
    content: "두 분의 예산 기준을 먼저 맞춰 보세요.",
    metadata: {
      question_scope: "W0_wedding_core",
      memory_eligible: true,
      in_reply_to_user_message_id: USER_MESSAGE_ID,
    },
    created_at: "2026-08-16T00:00:00.000Z",
    visibility: "shared",
    ...overrides,
  };
}

test("a persisted ordinary W0/W1 AI answer in the current couple and visible lane can be saved", () => {
  const context = { coupleId: COUPLE_ID, viewerRole: "bride" };

  assert.equal(
    isPreparationTopicMessageSaveEligible(aiMessage(), context),
    true,
  );
  assert.equal(
    isPreparationTopicMessageSaveEligible(aiMessage({
      metadata: {
        question_scope: "W1_wedding_adjacent",
        memory_eligible: true,
        in_reply_to_user_message_id: USER_MESSAGE_ID,
      },
      visibility: "bride_private",
    }), context),
    true,
  );
});

test("save eligibility requires the exact persisted user-message reply binding", () => {
  const context = { coupleId: COUPLE_ID, viewerRole: "bride" };

  assert.equal(
    isPreparationTopicMessageSaveEligible(aiMessage({
      metadata: {
        question_scope: "W0_wedding_core",
        memory_eligible: true,
      },
    }), context),
    false,
  );
  assert.equal(
    isPreparationTopicMessageSaveEligible(aiMessage({
      metadata: {
        question_scope: "W0_wedding_core",
        memory_eligible: true,
        in_reply_to_user_message_id: "not-a-uuid",
      },
    }), context),
    false,
  );
});

test("temporary, hidden, non-wedding, and special AI rows never expose the save control", () => {
  const context = { coupleId: COUPLE_ID, viewerRole: "bride" };
  const specialMetadata = [
    { pinned_safety_card: true },
    { safety_classification: "high_risk" },
    { mediation: { kind: "offer" } },
    { mediation_offer_key: "offer" },
    { response_origin: "server_authoritative_safety_privacy_route" },
    { raw_disclosure_shared: false },
    { persistence_status: "ephemeral_local_only" },
    { persistence_status: "local_recovery_only" },
    { persistence_status: "unconfirmed_ephemeral_fallback" },
  ];
  const invalidMessages = [
    aiMessage({ id: "temp_answer" }),
    aiMessage({ couple_id: "40000000-0000-4000-8000-000000000004" }),
    aiMessage({ visibility: "groom_private" }),
    aiMessage({ content: "   " }),
    aiMessage({ role: "user" }),
    aiMessage({ sender_type: "bride" }),
    aiMessage({ metadata: { ...aiMessage().metadata, target: "partner" } }),
    aiMessage({ metadata: { ...aiMessage().metadata, target: "unknown" } }),
    aiMessage({ metadata: { ...aiMessage().metadata, kind: "mediation" } }),
    aiMessage({ metadata: { ...aiMessage().metadata, request_kind: "mediation" } }),
    aiMessage({ metadata: { ...aiMessage().metadata, requestKind: "mediation" } }),
    aiMessage({ metadata: {
      ...aiMessage().metadata,
      question_scope: "W2_high_risk_adjacent",
      memory_eligible: false,
    } }),
    ...specialMetadata.map((metadata) => aiMessage({
      metadata: { ...aiMessage().metadata, ...metadata },
    })),
  ];

  for (const message of invalidMessages) {
    assert.equal(
      isPreparationTopicMessageSaveEligible(message, context),
      false,
      JSON.stringify(message),
    );
  }
});

test("ordinary W0/W1 display eligibility does not borrow the separate memory-queue flag", () => {
  const context = { coupleId: COUPLE_ID, viewerRole: "bride" };

  assert.equal(isPreparationTopicMessageSaveEligible(aiMessage({
    metadata: {
      question_scope: "W0_wedding_core",
      memory_eligible: false,
      in_reply_to_user_message_id: USER_MESSAGE_ID,
    },
  }), context), true);
  assert.equal(isPreparationTopicMessageSaveEligible(aiMessage({
    metadata: {
      question_scope: "W0_wedding_core",
      in_reply_to_user_message_id: USER_MESSAGE_ID,
      target: "ai",
    },
  }), context), true);
});

test("shared answers stay read-only while the viewer role is unresolved", () => {
  assert.equal(isPreparationTopicMessageSaveEligible(aiMessage(), {
    coupleId: COUPLE_ID,
    viewerRole: null,
  }), false);
  assert.equal(isPreparationTopicMessageSaveEligible(aiMessage({
    couple_id: "not-a-couple",
  }), {
    coupleId: "not-a-couple",
    viewerRole: "bride",
  }), false);
});

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

test("topic mutation reads exact state, CAS-writes, and retries one stale revision without optimistic success", async () => {
  const requestId = "a0000000-0000-4000-8000-00000000000a";
  const calls = [];
  const responses = [
    jsonResponse(200, {
      version: 1, state: "ready", recipientUserId: USER_MESSAGE_ID, coupleId: COUPLE_ID,
      reference: {
        topicKey: "meeting", messageId: AI_MESSAGE_ID, refId: null,
        audience: "couple_shared", savedState: "removed", revision: 3,
      },
    }),
    jsonResponse(409, { error: "STALE_REVISION" }),
    jsonResponse(200, {
      version: 1, state: "ready", recipientUserId: USER_MESSAGE_ID, coupleId: COUPLE_ID,
      reference: {
        topicKey: "meeting", messageId: AI_MESSAGE_ID, refId: null,
        audience: "couple_shared", savedState: "removed", revision: 4,
      },
    }),
    jsonResponse(200, {
      version: 1, state: "ready", recipientUserId: USER_MESSAGE_ID, coupleId: COUPLE_ID,
      reference: {
        topicKey: "meeting", messageId: AI_MESSAGE_ID, refId: REF_IDS[0],
        audience: "couple_shared", savedState: "saved", revision: 5,
      },
      reused: false,
    }),
  ];
  const result = await mutatePreparationTopicMessageReference({
    apiFetch: async (path, options) => {
      calls.push({ path, options });
      return responses.shift();
    },
    ownerId: USER_MESSAGE_ID,
    coupleId: COUPLE_ID,
    topicKey: "meeting",
    messageId: AI_MESSAGE_ID,
    desiredState: "saved",
    requestId,
    isCurrent: () => true,
  });

  assert.equal(result.reference.savedState, "saved");
  assert.equal(calls.length, 4);
  assert.match(calls[0].path, /^\/api\/amora\/preparation-topic-message-refs\?topicKey=meeting&messageId=/u);
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    topicKey: "meeting",
    messageId: AI_MESSAGE_ID,
    desiredState: "saved",
    expectedRevision: 3,
    requestId,
  });
  assert.deepEqual(JSON.parse(calls[3].options.body), {
    topicKey: "meeting",
    messageId: AI_MESSAGE_ID,
    desiredState: "saved",
    expectedRevision: 4,
    requestId,
  });
});

test("an exact state already at the desired value recovers a committed write without another PUT", async () => {
  const calls = [];
  const result = await mutatePreparationTopicMessageReference({
    apiFetch: async (path, options) => {
      calls.push({ path, options });
      return jsonResponse(200, {
        version: 1, state: "ready", recipientUserId: USER_MESSAGE_ID, coupleId: COUPLE_ID,
        reference: {
          topicKey: "meeting", messageId: AI_MESSAGE_ID, refId: REF_IDS[0],
          audience: "couple_shared", savedState: "saved", revision: 5,
        },
      });
    },
    ownerId: USER_MESSAGE_ID,
    coupleId: COUPLE_ID,
    topicKey: "meeting",
    messageId: AI_MESSAGE_ID,
    desiredState: "saved",
    requestId: "a0000000-0000-4000-8000-00000000000a",
    isCurrent: () => true,
  });

  assert.equal(calls.length, 1);
  assert.equal(result.reused, true);
  assert.equal(result.reference.revision, 5);
});

test("a mutation deadline settles even when the mobile transport ignores abort", async () => {
  let receivedSignal = null;
  const outcome = await Promise.race([
    mutatePreparationTopicMessageReference({
      apiFetch: async (_path, options) => {
        receivedSignal = options?.signal ?? null;
        return new Promise(() => {});
      },
      ownerId: USER_MESSAGE_ID,
      coupleId: COUPLE_ID,
      topicKey: "meeting",
      messageId: AI_MESSAGE_ID,
      desiredState: "saved",
      requestId: "a0000000-0000-4000-8000-00000000000a",
      timeoutMs: 10,
      isCurrent: () => true,
    }).then(
      () => ({ status: "unexpected_success" }),
      (error) => ({ status: "error", code: error?.code }),
    ),
    new Promise((resolve) => globalThis.setTimeout(
      () => resolve({ status: "test_transport_hung" }),
      100,
    )),
  ]);

  assert.deepEqual(outcome, { status: "error", code: "timeout" });
  assert.equal(receivedSignal?.aborted, true);
});

test("an external session abort settles an ignored transport and fences the late mutation", async () => {
  const controller = new globalThis.AbortController();
  let current = true;
  let receivedSignal = null;
  const mutation = mutatePreparationTopicMessageReference({
    apiFetch: async (_path, options) => {
      receivedSignal = options?.signal ?? null;
      return new Promise(() => {});
    },
    ownerId: USER_MESSAGE_ID,
    coupleId: COUPLE_ID,
    topicKey: "meeting",
    messageId: AI_MESSAGE_ID,
    desiredState: "saved",
    requestId: "a0000000-0000-4000-8000-00000000000a",
    signal: controller.signal,
    timeoutMs: 1_000,
    isCurrent: () => current,
  });

  current = false;
  controller.abort();
  const outcome = await Promise.race([
    mutation.then(
      () => ({ status: "unexpected_success" }),
      (error) => ({
        status: error instanceof PreparationTopicMessageRefError ? "error" : "unknown_error",
        code: error?.code,
      }),
    ),
    new Promise((resolve) => globalThis.setTimeout(
      () => resolve({ status: "test_transport_hung" }),
      100,
    )),
  ]);

  assert.deepEqual(outcome, { status: "error", code: "stale_context" });
  assert.equal(receivedSignal?.aborted, true);
});

test("collection loading accepts only the bound owner/couple envelope and discards a late identity result", async () => {
  const collection = {
    version: 1,
    state: "ready",
    recipientUserId: USER_MESSAGE_ID,
    coupleId: COUPLE_ID,
    references: [{
      refId: REF_IDS[0], topicKey: "meeting", messageId: AI_MESSAGE_ID,
      audience: "couple_shared", revision: 1,
      savedAt: "2026-08-16T00:00:00.000Z", sourceCreatedAt: "2026-08-15T00:00:00.000Z",
      excerpt: "저장한 답변", canRemove: true, canOpenOriginal: true,
    }],
    partial: false,
  };
  const loaded = await loadPreparationTopicMessageReferences({
    apiFetch: async () => jsonResponse(200, collection),
    ownerId: USER_MESSAGE_ID,
    coupleId: COUPLE_ID,
    isCurrent: () => true,
  });
  assert.equal(loaded.references[0].refId, REF_IDS[0]);

  let fenceChecks = 0;
  await assert.rejects(
    loadPreparationTopicMessageReferences({
      apiFetch: async () => jsonResponse(200, collection),
      ownerId: USER_MESSAGE_ID,
      coupleId: COUPLE_ID,
      isCurrent: () => {
        fenceChecks += 1;
        return fenceChecks < 3;
      },
    }),
    (error) => error?.code === "stale_context",
  );
});

test("an optional collection read times out without blocking on a transport that ignores abort", async () => {
  let receivedSignal = null;
  const outcome = await Promise.race([
    loadPreparationTopicMessageReferences({
      apiFetch: async (_path, options) => {
        receivedSignal = options?.signal ?? null;
        return new Promise(() => {});
      },
      ownerId: USER_MESSAGE_ID,
      coupleId: COUPLE_ID,
      timeoutMs: 10,
      isCurrent: () => true,
    }).then(
      () => ({ status: "unexpected_success" }),
      (error) => ({ status: "error", code: error?.code }),
    ),
    new Promise((resolve) => globalThis.setTimeout(
      () => resolve({ status: "test_transport_hung" }),
      100,
    )),
  ]);

  assert.deepEqual(outcome, { status: "error", code: "timeout" });
  assert.equal(receivedSignal?.aborted, true);
});

test("an exact selected-topic read recovers a saved reference omitted from a partial collection", async () => {
  const partialCollection = await loadPreparationTopicMessageReferences({
    apiFetch: async () => jsonResponse(200, {
      version: 1,
      state: "ready",
      recipientUserId: USER_MESSAGE_ID,
      coupleId: COUPLE_ID,
      references: [],
      partial: true,
    }),
    ownerId: USER_MESSAGE_ID,
    coupleId: COUPLE_ID,
    isCurrent: () => true,
  });
  assert.equal(partialCollection.references.length, 0);
  assert.equal(partialCollection.partial, true);

  const exactState = await loadPreparationTopicMessageReferenceState({
    apiFetch: async () => jsonResponse(200, {
      version: 1,
      state: "ready",
      recipientUserId: USER_MESSAGE_ID,
      coupleId: COUPLE_ID,
      reference: {
        topicKey: "meeting",
        messageId: AI_MESSAGE_ID,
        refId: REF_IDS[0],
        audience: "couple_shared",
        savedState: "saved",
        revision: 9,
      },
    }),
    ownerId: USER_MESSAGE_ID,
    coupleId: COUPLE_ID,
    topicKey: "meeting",
    messageId: AI_MESSAGE_ID,
    isCurrent: () => true,
  });
  assert.equal(exactState.reference.savedState, "saved");
  assert.equal(exactState.reference.refId, REF_IDS[0]);
});

test("strict resolver loads an old exact pair and merges the canonical sender and lane without invented metadata", async () => {
  const oldQuestionId = "b0000000-0000-4000-8000-00000000000b";
  const resolvedPayload = {
    version: 1,
    state: "ready",
    recipientUserId: USER_MESSAGE_ID,
    coupleId: COUPLE_ID,
    reference: {
      refId: REF_IDS[0], topicKey: "meeting", messageId: AI_MESSAGE_ID,
      audience: "couple_shared", revision: 2, savedAt: "2026-08-16T00:00:00.000Z",
    },
    target: {
      messageId: AI_MESSAGE_ID,
      lane: "shared",
      content: "검증된 과거 답변",
      createdAt: "2026-08-14T00:01:00.000Z",
    },
    question: {
      messageId: oldQuestionId,
      lane: "shared",
      senderType: "groom",
      content: "검증된 과거 질문",
      createdAt: "2026-08-14T00:00:00.000Z",
    },
  };
  const calls = [];
  const resolved = await resolvePreparationTopicMessageReference({
    apiFetch: async (path, options) => {
      calls.push({ path, options });
      return jsonResponse(200, resolvedPayload);
    },
    ownerId: USER_MESSAGE_ID,
    coupleId: COUPLE_ID,
    refId: REF_IDS[0],
    isCurrent: () => true,
  });
  const merged = mergePreparationTopicResolvedConversation([], resolved, "bride");

  assert.equal(calls[0].path, `/api/amora/preparation-topic-message-refs/${REF_IDS[0]}`);
  assert.deepEqual(merged.map((message) => ({
    id: message.id,
    senderType: message.sender_type,
    role: message.role,
    content: message.content,
    visibility: message.visibility,
    metadata: message.metadata,
  })), [
    {
      id: oldQuestionId, senderType: "groom", role: "user",
      content: "검증된 과거 질문", visibility: "shared", metadata: undefined,
    },
    {
      id: AI_MESSAGE_ID, senderType: "ai", role: "assistant",
      content: "검증된 과거 답변", visibility: "shared", metadata: undefined,
    },
  ]);
});

test("an unavailable or inaccessible saved original is terminal while a transient read can retry", () => {
  assert.deepEqual(
    getPreparationTopicMessageReferenceFocusPresentation(
      new PreparationTopicMessageRefError("source_unavailable"),
    ),
    {
      message: "저장한 대화 원문이 삭제되었거나 더 이상 열 수 없어요.",
      canRetry: false,
    },
  );
  assert.deepEqual(
    getPreparationTopicMessageReferenceFocusPresentation(
      new PreparationTopicMessageRefError("source_inaccessible"),
    ),
    {
      message: "이 저장한 대화는 현재 계정에서 볼 수 없어요. 계정과 공개 범위를 확인해 주세요.",
      canRetry: false,
    },
  );
  assert.deepEqual(
    getPreparationTopicMessageReferenceFocusPresentation(
      new PreparationTopicMessageRefError("read_failed"),
    ),
    {
      message: "저장한 대화 원문을 불러오지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요.",
      canRetry: true,
    },
  );
});

test("chat exposes an explicit topic picker only for eligible or strictly resolved AI answers", () => {
  assert.match(chatSource, /isPreparationTopicMessageSaveEligible\(item,/);
  assert.match(chatSource, /resolvedTopicMessageFocus\?\.targetMessageId === item\.id/);
  assert.match(chatSource, />준비에 저장</);
  assert.match(chatSource, /<Modal[\s\S]{0,1800}<ScrollView/);
  assert.match(chatSource, /minHeight:\s*48/);
  assert.match(chatSource, /선택한 준비에 저장/);
  assert.match(chatSource, /이 준비에서 빼기/);
  assert.match(chatSource, /두 분 모두 볼 수 있어요/);
  assert.match(chatSource, /상대방에게 보이지 않아요/);
  assert.match(chatSource, /mutatePreparationTopicMessageReference\(\{/);
});

test("chat derives save versus removal from the selected topic's exact state, not the bounded collection", () => {
  assert.match(chatSource, /loadPreparationTopicMessageReferenceState\(\{/);
  assert.match(chatSource, /selectedTopicSavedState === "saved"\s*\? "removed"\s*:\s*"saved"/);
  assert.doesNotMatch(chatSource, /const existingReference = dialog\.references\.find/);
});

test("chat can close and abort a pending topic mutation without accepting its late result", () => {
  assert.match(chatSource, /topicMessageSaveAbortControllerRef/);
  assert.match(chatSource, /topicMessageSaveAbortControllerRef\.current\?\.abort\(\)/);
  assert.match(chatSource, /mutatePreparationTopicMessageReference\(\{[\s\S]{0,700}signal:\s*operationController\.signal/);
  const closeHandler = chatSource.slice(
    chatSource.indexOf("const closeTopicMessageSaveDialog"),
    chatSource.indexOf("async function handleOpenTopicMessageSaveDialog"),
  );
  assert.doesNotMatch(closeHandler, /saving\) return/);
  assert.match(closeHandler, /\.abort\(\)/);
});

test("chat resolves opaque old-message focus with a visible retry and no latest-scroll fallback", () => {
  assert.match(chatSource, /topicMessageRefId\?: string \| string\[\]/);
  assert.match(chatSource, /resolvePreparationTopicMessageReference\(\{/);
  assert.match(chatSource, /mergePreparationTopicResolvedConversation/);
  assert.match(chatSource, /setActiveScope\(resolved\.target\.lane === "shared" \? "shared" : "private"\)/);
  assert.match(chatSource, /scrollToIndex\(\{[\s\S]{0,120}targetMessageId/);
  assert.match(chatSource, /onScrollToIndexFailed/);
  assert.match(chatSource, /AccessibilityInfo\.announceForAccessibility\("저장한 원문으로 이동했어요"\)/);
  assert.match(chatSource, />\s*저장한 원문\s*</);
  assert.match(chatSource, /getPreparationTopicMessageReferenceFocusPresentation\(error\)/);
  assert.match(chatSource, /topicMessageFocusState\.canRetry\s*&&/);
  assert.match(chatSource, /원문 다시 불러오기/);
  assert.match(chatSource, /if \(topicMessageRefIdParam\) return;/);
});

function topicView() {
  return {
    version: 1,
    topicKey: "meeting",
    label: "부모님 첫 만남",
    applicability: "applicable",
    status: "in_progress",
    progress: { completed: 1, total: 2, percent: 50 },
    facts: [{ key: "checklist:1", label: "목적 확인 완료", source: "saved_checklist" }],
    unknowns: [{ key: "checklist:2", label: "날짜 확인", source: "unfinished_checklist" }],
    nextAction: {
      title: "날짜 확인",
      reason: "아직 정하지 않았어요.",
      completionCriterion: "날짜를 저장하면 끝나요.",
      source: "saved_checklist",
    },
    guideModules: [],
    relatedMessageRefs: [],
    linkedScheduleIds: [],
    linkedBudgetCategoryKeys: [],
    linkedActionIds: [],
    conflicts: [],
  };
}

test("topic presentation keeps saved conversations informational, newest-first, and initially bounded to two", () => {
  const before = buildPreparationTopicPresentation(topicView());
  const references = [
    {
      refId: REF_IDS[0], topicKey: "meeting", messageId: AI_MESSAGE_ID,
      audience: "couple_shared", revision: 1,
      savedAt: "2026-08-14T00:00:00.000Z", sourceCreatedAt: "2026-08-13T00:00:00.000Z",
      excerpt: "첫 번째 대화", canRemove: true, canOpenOriginal: true,
    },
    {
      refId: REF_IDS[1], topicKey: "meeting", messageId: "80000000-0000-4000-8000-000000000008",
      audience: "owner_private", revision: 2,
      savedAt: "2026-08-16T00:00:00.000Z", sourceCreatedAt: "2026-08-15T00:00:00.000Z",
      excerpt: "가장 최근 대화", canRemove: true, canOpenOriginal: true,
    },
    {
      refId: REF_IDS[2], topicKey: "meeting", messageId: "90000000-0000-4000-8000-000000000009",
      audience: "couple_shared", revision: 1,
      savedAt: "2026-08-15T00:00:00.000Z", sourceCreatedAt: "2026-08-14T00:00:00.000Z",
      excerpt: "두 번째 대화", canRemove: true, canOpenOriginal: true,
    },
  ];
  const after = buildPreparationTopicPresentation(topicView(), {
    state: "loaded",
    references,
  });

  assert.equal(after?.savedConversationSection?.title, "아모라와 저장한 대화");
  assert.deepEqual(
    after?.savedConversationSection?.items.map(({ refId, meta, canOpenOriginal }) => ({
      refId, meta, canOpenOriginal,
    })),
    [
      { refId: REF_IDS[1], meta: "나만 보는 대화 · 8월 16일 저장", canOpenOriginal: true },
      { refId: REF_IDS[2], meta: "함께 보는 대화 · 8월 15일 저장", canOpenOriginal: true },
      { refId: REF_IDS[0], meta: "함께 보는 대화 · 8월 14일 저장", canOpenOriginal: true },
    ],
  );
  assert.equal(after?.savedConversationSection?.initialVisibleCount, 2);
  assert.equal(after?.progressLabel, before?.progressLabel);
  assert.deepEqual(after?.nextAction, before?.nextAction);
});

test("topic presentation distinguishes an unavailable or partial reference read from no saved conversations", () => {
  const unavailable = buildPreparationTopicPresentation(topicView(), {
    state: "unavailable",
  });
  assert.equal(unavailable?.savedConversationSection?.items.length, 0);
  assert.match(unavailable?.savedConversationSection?.notice ?? "", /불러오지 못했어요/);

  const partial = buildPreparationTopicPresentation(topicView(), {
    state: "partial",
    references: [{
      refId: REF_IDS[0], topicKey: "meeting", messageId: AI_MESSAGE_ID,
      audience: "couple_shared", revision: 1,
      savedAt: "2026-08-16T00:00:00.000Z", sourceCreatedAt: "2026-08-15T00:00:00.000Z",
      excerpt: "일부만 확인된 저장 대화", canRemove: true, canOpenOriginal: true,
    }],
  });
  assert.equal(partial?.savedConversationSection?.items.length, 1);
  assert.match(partial?.savedConversationSection?.notice ?? "", /일부 저장한 대화만/);
  assert.equal(partial?.progressLabel, unavailable?.progressLabel);
  assert.deepEqual(partial?.nextAction, unavailable?.nextAction);
});
