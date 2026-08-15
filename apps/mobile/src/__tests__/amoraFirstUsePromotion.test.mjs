import assert from "node:assert/strict";
import test from "node:test";

import {
  createFirstUsePromotionOperationGuard,
  createFirstUseComposerBinding,
  getFirstUsePromotionSendRecovery,
  getFirstUsePromotionPresentation,
  loadAmoraFirstUsePromotionPreview,
  reconcileFirstUseComposerBinding,
  resolveFirstUseSourceMessageIdForSend,
  validateFirstUsePromotionIngestReceipt,
} from "../lib/amoraFirstUsePromotion.mjs";

const OWNER = "11111111-1111-4111-8111-111111111111";
const COUPLE = "22222222-2222-4222-8222-222222222222";
const SOURCE = "33333333-3333-4333-8333-333333333333";

function readyEnvelope() {
  return {
    version: 1,
    state: "ready",
    ownerUserId: OWNER,
    coupleId: COUPLE,
    sourceMessageId: SOURCE,
    sourceRevision: 7,
    criterionDecisionId: null,
    canonicalDraft: {
      action: "이번 주에 둘이 예식 기준 하나 정하기",
      reason: "장소를 보기 전에 공통 기준이 필요해요.",
      completionCriterion: "각자 꼭 지킬 기준을 하나씩 적으면 끝나요.",
      sharedText: [
        "나만 상담에서 정리한 이 한 가지를 둘이 볼 실행 카드로 제안해줘.",
        "지금 할 한 가지: 이번 주에 둘이 예식 기준 하나 정하기",
        "이유: 장소를 보기 전에 공통 기준이 필요해요.",
        "완료 기준: 각자 꼭 지킬 기준을 하나씩 적으면 끝나요.",
        "저장 전에는 확인 카드만 보여줘.",
      ].join("\n"),
    },
  };
}

test("reviewing a persisted private action returns only the server-canonical shared draft", async () => {
  const calls = [];
  const result = await loadAmoraFirstUsePromotionPreview({
    expectedOwnerUserId: OWNER,
    expectedCoupleId: COUPLE,
    sourceMessageId: SOURCE,
    fetchForExpectedUser: async (expectedUserId, path, options) => {
      calls.push({ expectedUserId, path, options });
      return {
        ok: true,
        status: 200,
        async json() { return readyEnvelope(); },
      };
    },
  });

  assert.deepEqual(calls, [{
    expectedUserId: OWNER,
    path: `/api/amora/first-use-action-promotions/${SOURCE}`,
    options: {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: calls[0]?.options.signal,
    },
  }]);
  assert.equal(calls[0]?.options.signal instanceof globalThis.AbortSignal, true);
  assert.equal(result.status, "ready");
  assert.deepEqual(result.draft, readyEnvelope().canonicalDraft);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.draft), true);
});

test("a temporary chat row never reaches the promotion endpoint", async () => {
  let fetchCount = 0;
  const result = await loadAmoraFirstUsePromotionPreview({
    expectedOwnerUserId: OWNER,
    expectedCoupleId: COUPLE,
    sourceMessageId: `temp-${Date.now()}`,
    fetchForExpectedUser: async () => {
      fetchCount += 1;
      throw new Error("must not fetch an unpersisted source");
    },
  });

  assert.equal(fetchCount, 0);
  assert.deepEqual(result, { status: "source_pending" });
});

test("reopening after a successful share returns the durable shared message instead of another draft", async () => {
  const sharedMessageId = "44444444-4444-4444-8444-444444444444";
  const result = await loadAmoraFirstUsePromotionPreview({
    expectedOwnerUserId: OWNER,
    expectedCoupleId: COUPLE,
    sourceMessageId: SOURCE,
    fetchForExpectedUser: async () => ({
      ok: true,
      status: 200,
      async json() {
        return {
          version: 1,
          state: "already_shared",
          ownerUserId: OWNER,
          coupleId: COUPLE,
          sourceMessageId: SOURCE,
          sharedMessageId,
        };
      },
    }),
  });

  assert.deepEqual(result, {
    status: "already_shared",
    ownerUserId: OWNER,
    coupleId: COUPLE,
    sourceMessageId: SOURCE,
    sharedMessageId,
  });
  assert.equal(Object.isFrozen(result), true);
});

test("server refusal states stay distinct so the card can offer the right recovery", async () => {
  const loadError = (status, code) => loadAmoraFirstUsePromotionPreview({
    expectedOwnerUserId: OWNER,
    expectedCoupleId: COUPLE,
    sourceMessageId: SOURCE,
    fetchForExpectedUser: async () => ({
      ok: false,
      status,
      async json() { return { error: "preview refused", code }; },
    }),
  });

  assert.equal(
    (await loadError(403, "FIRST_USE_PROMOTION_IDENTITY_CHANGED")).status,
    "identity_changed",
  );
  assert.equal(
    (await loadError(409, "FIRST_USE_PROMOTION_CRITERION_STALE")).status,
    "criterion_stale",
  );
  assert.equal(
    (await loadError(409, "FIRST_USE_PROMOTION_STALE")).status,
    "stale",
  );
  assert.equal(
    (await loadError(404, "FIRST_USE_PROMOTION_NOT_FOUND")).status,
    "unavailable",
  );
  assert.equal(
    (await loadError(503, "FIRST_USE_PROMOTION_UNAVAILABLE")).status,
    "unavailable",
  );
});

test("a mobile session-owner fence failure becomes visible identity recovery", async () => {
  const result = await loadAmoraFirstUsePromotionPreview({
    expectedOwnerUserId: OWNER,
    expectedCoupleId: COUPLE,
    sourceMessageId: SOURCE,
    fetchForExpectedUser: async () => {
      throw new Error("API_SESSION_OWNER_MISMATCH");
    },
  });

  assert.deepEqual(result, { status: "identity_changed" });
});

test("a preview that exceeds the client deadline becomes a retryable timeout", async () => {
  let receivedSignal = null;
  const result = await loadAmoraFirstUsePromotionPreview({
    expectedOwnerUserId: OWNER,
    expectedCoupleId: COUPLE,
    sourceMessageId: SOURCE,
    timeoutMs: 10,
    fetchForExpectedUser: async (_expectedUserId, _path, options) => {
      receivedSignal = options.signal;
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => {
          reject(new globalThis.DOMException("timed out", "AbortError"));
        }, { once: true });
      });
    },
  });

  assert.equal(receivedSignal?.aborted, true);
  assert.deepEqual(result, { status: "timeout" });
});

test("the deadline still settles when the mobile transport ignores abort", async () => {
  const result = await Promise.race([
    loadAmoraFirstUsePromotionPreview({
      expectedOwnerUserId: OWNER,
      expectedCoupleId: COUPLE,
      sourceMessageId: SOURCE,
      timeoutMs: 10,
      fetchForExpectedUser: async () => new Promise(() => {}),
    }),
    new Promise((resolve) => globalThis.setTimeout(
      () => resolve({ status: "test_transport_hung" }),
      100,
    )),
  ]);

  assert.deepEqual(result, { status: "timeout" });
});

test("an explicit correction abort settles preview checking even when transport ignores abort", async () => {
  const controller = new globalThis.AbortController();
  let receivedSignal = null;
  const preview = loadAmoraFirstUsePromotionPreview({
    expectedOwnerUserId: OWNER,
    expectedCoupleId: COUPLE,
    sourceMessageId: SOURCE,
    signal: controller.signal,
    fetchForExpectedUser: async (_expectedUserId, _path, options) => {
      receivedSignal = options.signal;
      return new Promise(() => {});
    },
  });

  controller.abort();
  const result = await Promise.race([
    preview,
    new Promise((resolve) => globalThis.setTimeout(
      () => resolve({ status: "test_transport_hung" }),
      100,
    )),
  ]);

  assert.equal(receivedSignal?.aborted, true);
  assert.deepEqual(result, { status: "unavailable" });
});

test("provenance crosses send only while owner, couple, and canonical text remain exact", async () => {
  const preview = await loadAmoraFirstUsePromotionPreview({
    expectedOwnerUserId: OWNER,
    expectedCoupleId: COUPLE,
    sourceMessageId: SOURCE,
    fetchForExpectedUser: async () => ({
      ok: true,
      status: 200,
      async json() { return readyEnvelope(); },
    }),
  });
  const binding = createFirstUseComposerBinding(preview);

  assert.deepEqual(binding, {
    ownerUserId: OWNER,
    coupleId: COUPLE,
    sourceMessageId: SOURCE,
    sharedText: readyEnvelope().canonicalDraft.sharedText,
  });
  assert.equal(Object.isFrozen(binding), true);
  assert.equal(resolveFirstUseSourceMessageIdForSend(binding, {
    ownerUserId: OWNER,
    coupleId: COUPLE,
    sharedText: readyEnvelope().canonicalDraft.sharedText,
  }), SOURCE);
  assert.equal(resolveFirstUseSourceMessageIdForSend(binding, {
    ownerUserId: "55555555-5555-4555-8555-555555555555",
    coupleId: COUPLE,
    sharedText: readyEnvelope().canonicalDraft.sharedText,
  }), null);
  assert.equal(resolveFirstUseSourceMessageIdForSend(binding, {
    ownerUserId: OWNER,
    coupleId: "66666666-6666-4666-8666-666666666666",
    sharedText: readyEnvelope().canonicalDraft.sharedText,
  }), null);
  assert.equal(resolveFirstUseSourceMessageIdForSend(binding, {
    ownerUserId: OWNER,
    coupleId: COUPLE,
    sharedText: `${readyEnvelope().canonicalDraft.sharedText} `,
  }), null);
});

test("editing the staged shared draft immediately drops its provenance sidecar", () => {
  const preview = Object.freeze({
    status: "ready",
    ownerUserId: OWNER,
    coupleId: COUPLE,
    sourceMessageId: SOURCE,
    draft: Object.freeze({ ...readyEnvelope().canonicalDraft }),
  });
  const binding = createFirstUseComposerBinding(preview);

  assert.equal(reconcileFirstUseComposerBinding(binding, {
    ownerUserId: OWNER,
    coupleId: COUPLE,
    sharedText: readyEnvelope().canonicalDraft.sharedText,
  }), binding);
  assert.equal(reconcileFirstUseComposerBinding(binding, {
    ownerUserId: OWNER,
    coupleId: COUPLE,
    sharedText: readyEnvelope().canonicalDraft.sharedText.replace("이번 주", "다음 주"),
  }), null);
});

test("correcting while preview checking cancels that exact operation and ignores its late draft", async () => {
  const guard = createFirstUsePromotionOperationGuard();
  const operation = guard.start(SOURCE, 7);
  assert.ok(operation);

  let releasePreview;
  const delayedPreview = new Promise((resolve) => {
    releasePreview = resolve;
  });
  const appliedDrafts = [];
  const previewSettlement = delayedPreview.then((draft) => {
    if (!guard.isCurrent(operation)) return "ignored";
    appliedDrafts.push(draft);
    return "applied";
  });

  assert.equal(
    guard.cancel("44444444-4444-4444-8444-444444444444"),
    false,
    "a different card must not cancel the active preview",
  );
  assert.equal(guard.isCurrent(operation), true);
  assert.equal(guard.cancel(SOURCE), true);
  assert.equal(operation.controller.signal.aborted, true);
  assert.equal(guard.current(), null);

  releasePreview(readyEnvelope().canonicalDraft);
  assert.equal(await previewSettlement, "ignored");
  assert.deepEqual(appliedDrafts, []);
  assert.equal(guard.finish(operation), false);
});

test("each blocked preview state gives the customer a visible, truthful recovery", () => {
  assert.deepEqual(getFirstUsePromotionPresentation("source_pending"), {
    message: "아모라 답변을 저장하고 있어요. 저장이 끝나면 다시 확인할 수 있어요.",
    actionLabel: "저장 확인 중",
    recovery: "none",
  });
  assert.deepEqual(getFirstUsePromotionPresentation("timeout"), {
    message: "확인이 조금 오래 걸렸어요. 아무것도 보내거나 저장하지 않았어요.",
    actionLabel: "다시 확인",
    recovery: "retry",
  });
  assert.deepEqual(getFirstUsePromotionPresentation("unavailable"), {
    message: "지금 최신 상태를 확인하지 못했어요. 아무것도 보내거나 저장하지 않았어요.",
    actionLabel: "다시 확인",
    recovery: "retry",
  });
  assert.deepEqual(getFirstUsePromotionPresentation("identity_changed"), {
    message: "계정이나 커플 연결이 바뀌었어요. 현재 상태를 다시 불러와 주세요.",
    actionLabel: "다시 불러오기",
    recovery: "reload",
  });
  assert.deepEqual(getFirstUsePromotionPresentation("stale"), {
    message: "준비 상태가 달라져 이 행동을 우리 준비로 가져오지 않았어요.",
    actionLabel: "최신 내용으로 다시 맞추기",
    recovery: "correct",
  });
  assert.deepEqual(getFirstUsePromotionPresentation("criterion_stale"), {
    message: "둘의 준비 기준이 달라져 이 행동을 우리 준비로 가져오지 않았어요.",
    actionLabel: "최신 기준으로 다시 맞추기",
    recovery: "correct",
  });
  assert.deepEqual(getFirstUsePromotionPresentation("already_shared"), {
    message: "이미 함께 대화에 공유한 행동이에요.",
    actionLabel: "함께 대화에서 보기",
    recovery: "open_shared",
  });
  assert.equal(Object.isFrozen(getFirstUsePromotionPresentation("timeout")), true);
});

test("first-use currentness failures map to one explicit private regeneration action", () => {
  const expected = {
    message: "이 행동을 우리 준비에 추가하거나 적용하지 않았어요. 최신 준비 상태와 다시 맞추려면 나만 상담에서 한 가지 제안을 다시 확인해 주세요.",
    actionLabel: "나만 상담에서 다시 만들기",
    recovery: "regenerate_first_use_action",
  };

  for (const serverCode of [
    "AMORA_FIRST_USE_PROMOTION_REQUIRED",
    "AMORA_FIRST_USE_PROMOTION_STALE",
    "AMORA_FIRST_USE_PROMOTION_MISMATCH",
    "FIRST_USE_PROMOTION_STALE",
    "FIRST_USE_PROMOTION_CRITERION_STALE",
    "FIRST_USE_PROMOTION_IDENTITY_CHANGED",
  ]) {
    assert.deepEqual(getFirstUsePromotionSendRecovery({
      serverCode,
      retryPolicy: "regenerate_first_use_action",
    }), expected);
  }

  assert.deepEqual(getFirstUsePromotionSendRecovery({
    serverCode: null,
    retryPolicy: "regenerate_first_use_action",
  }), expected);
  assert.equal(Object.isFrozen(getFirstUsePromotionSendRecovery({
    serverCode: "AMORA_FIRST_USE_PROMOTION_REQUIRED",
    retryPolicy: "regenerate_first_use_action",
  })), true);
  assert.equal(getFirstUsePromotionSendRecovery({
    serverCode: "USER_MESSAGE_REQUEST_CONFLICT",
    retryPolicy: "new_message",
  }), null);
});

test("ingest success requires an opaque promotion receipt and exact source-reuse semantics", () => {
  const promotionId = "77777777-7777-4777-8777-777777777777";
  const metadata = { amora_first_use_promotion_id: promotionId };

  assert.equal(validateFirstUsePromotionIngestReceipt({
    requestedSourceMessageId: SOURCE,
    responseStatus: 201,
    reused: false,
    reusedBy: null,
    messageMetadata: metadata,
  }), true);
  assert.equal(validateFirstUsePromotionIngestReceipt({
    requestedSourceMessageId: SOURCE,
    responseStatus: 200,
    reused: true,
    reusedBy: "first_use_source",
    messageMetadata: metadata,
  }), true);
  assert.equal(validateFirstUsePromotionIngestReceipt({
    requestedSourceMessageId: SOURCE,
    responseStatus: 200,
    reused: true,
    reusedBy: null,
    messageMetadata: metadata,
  }), false);
  assert.equal(validateFirstUsePromotionIngestReceipt({
    requestedSourceMessageId: SOURCE,
    responseStatus: 201,
    reused: false,
    reusedBy: null,
    messageMetadata: {},
  }), false);
  assert.equal(validateFirstUsePromotionIngestReceipt({
    requestedSourceMessageId: SOURCE,
    responseStatus: 201,
    reused: false,
    reusedBy: null,
    messageMetadata: { amora_first_use_promotion_id: SOURCE },
  }), false);
  assert.equal(validateFirstUsePromotionIngestReceipt({
    requestedSourceMessageId: null,
    responseStatus: 201,
    reused: false,
    reusedBy: null,
    messageMetadata: {},
  }), true);
  assert.equal(validateFirstUsePromotionIngestReceipt({
    requestedSourceMessageId: null,
    responseStatus: 201,
    reused: false,
    reusedBy: null,
    messageMetadata: metadata,
  }), false);
});
