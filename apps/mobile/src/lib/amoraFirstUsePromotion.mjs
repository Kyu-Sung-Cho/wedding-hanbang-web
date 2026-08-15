/* global AbortController, clearTimeout, setTimeout */

import {
  buildAmoraFirstUseSharedDraft,
  validateAmoraFirstUsePromotionPreviewResponse,
} from "@hanbang/shared/amora-first-use-promotion";

export const AMORA_FIRST_USE_PROMOTION_PREVIEW_TIMEOUT_MS = 8_000;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const FIRST_USE_REGENERATION_CODES = new Set([
  "AMORA_FIRST_USE_PROMOTION_REQUIRED",
  "AMORA_FIRST_USE_PROMOTION_STALE",
  "AMORA_FIRST_USE_PROMOTION_MISMATCH",
  "AMORA_FIRST_USE_PROMOTION_CRITERION_STALE",
  "AMORA_FIRST_USE_PROMOTION_IDENTITY_CHANGED",
  "AMORA_FIRST_USE_PROMOTION_CURRENTNESS_CHANGED",
  "FIRST_USE_PROMOTION_REQUIRED",
  "FIRST_USE_PROMOTION_STALE",
  "FIRST_USE_PROMOTION_CRITERION_STALE",
  "FIRST_USE_PROMOTION_IDENTITY_CHANGED",
  "FIRST_USE_PROMOTION_CURRENTNESS_CHANGED",
]);
const FIRST_USE_SEND_RECOVERY = Object.freeze({
  message: "이 행동을 우리 준비에 추가하거나 적용하지 않았어요. 최신 준비 상태와 다시 맞추려면 나만 상담에서 한 가지 제안을 다시 확인해 주세요.",
  actionLabel: "나만 상담에서 다시 만들기",
  recovery: "regenerate_first_use_action",
});

export function getFirstUsePromotionSendRecovery(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return value.retryPolicy === "regenerate_first_use_action"
    || FIRST_USE_REGENERATION_CODES.has(value.serverCode)
    ? FIRST_USE_SEND_RECOVERY
    : null;
}

export function createFirstUsePromotionOperationGuard() {
  let activeOperation = null;

  return Object.freeze({
    start(sourceMessageId, sessionGeneration) {
      if (
        !isPersistedFirstUseSourceMessageId(sourceMessageId)
        || !Number.isSafeInteger(sessionGeneration)
        || sessionGeneration < 0
      ) return null;

      if (activeOperation) activeOperation.controller.abort();
      const operation = Object.freeze({
        sourceMessageId,
        sessionGeneration,
        controller: new AbortController(),
      });
      activeOperation = operation;
      return operation;
    },
    cancel(sourceMessageId) {
      if (activeOperation?.sourceMessageId !== sourceMessageId) return false;
      const operation = activeOperation;
      activeOperation = null;
      operation.controller.abort();
      return true;
    },
    isCurrent(operation) {
      return activeOperation === operation && operation?.controller?.signal?.aborted === false;
    },
    finish(operation) {
      if (activeOperation !== operation) return false;
      activeOperation = null;
      return true;
    },
    current() {
      return activeOperation;
    },
  });
}

const PROMOTION_PRESENTATIONS = Object.freeze({
  checking: Object.freeze({
    message: "최신 준비 상태를 확인하고 있어요.",
    actionLabel: "확인 중",
    recovery: "none",
  }),
  source_pending: Object.freeze({
    message: "아모라 답변을 저장하고 있어요. 저장이 끝나면 다시 확인할 수 있어요.",
    actionLabel: "저장 확인 중",
    recovery: "none",
  }),
  timeout: Object.freeze({
    message: "확인이 조금 오래 걸렸어요. 아무것도 보내거나 저장하지 않았어요.",
    actionLabel: "다시 확인",
    recovery: "retry",
  }),
  unavailable: Object.freeze({
    message: "지금 최신 상태를 확인하지 못했어요. 아무것도 보내거나 저장하지 않았어요.",
    actionLabel: "다시 확인",
    recovery: "retry",
  }),
  identity_changed: Object.freeze({
    message: "계정이나 커플 연결이 바뀌었어요. 현재 상태를 다시 불러와 주세요.",
    actionLabel: "다시 불러오기",
    recovery: "reload",
  }),
  stale: Object.freeze({
    message: "준비 상태가 달라져 이 행동을 우리 준비로 가져오지 않았어요.",
    actionLabel: "최신 내용으로 다시 맞추기",
    recovery: "correct",
  }),
  criterion_stale: Object.freeze({
    message: "둘의 준비 기준이 달라져 이 행동을 우리 준비로 가져오지 않았어요.",
    actionLabel: "최신 기준으로 다시 맞추기",
    recovery: "correct",
  }),
  already_shared: Object.freeze({
    message: "이미 함께 대화에 공유한 행동이에요.",
    actionLabel: "함께 대화에서 보기",
    recovery: "open_shared",
  }),
});

export function getFirstUsePromotionPresentation(status) {
  return PROMOTION_PRESENTATIONS[status] ?? null;
}

export function isPersistedFirstUseSourceMessageId(value) {
  return typeof value === "string" && UUID_RE.test(value);
}

export function createFirstUseComposerBinding(preview) {
  if (
    preview === null
    || typeof preview !== "object"
    || Array.isArray(preview)
    || preview.status !== "ready"
    || !isPersistedFirstUseSourceMessageId(preview.ownerUserId)
    || !isPersistedFirstUseSourceMessageId(preview.coupleId)
    || !isPersistedFirstUseSourceMessageId(preview.sourceMessageId)
    || preview.draft === null
    || typeof preview.draft !== "object"
    || Array.isArray(preview.draft)
  ) return null;

  const sharedText = buildAmoraFirstUseSharedDraft(preview.draft);
  if (sharedText === null || preview.draft.sharedText !== sharedText) return null;

  return Object.freeze({
    ownerUserId: preview.ownerUserId,
    coupleId: preview.coupleId,
    sourceMessageId: preview.sourceMessageId,
    sharedText,
  });
}

export function resolveFirstUseSourceMessageIdForSend(binding, context) {
  if (
    binding === null
    || typeof binding !== "object"
    || Array.isArray(binding)
    || context === null
    || typeof context !== "object"
    || Array.isArray(context)
    || !isPersistedFirstUseSourceMessageId(binding.ownerUserId)
    || !isPersistedFirstUseSourceMessageId(binding.coupleId)
    || !isPersistedFirstUseSourceMessageId(binding.sourceMessageId)
    || binding.ownerUserId !== context.ownerUserId
    || binding.coupleId !== context.coupleId
    || binding.sharedText !== context.sharedText
  ) return null;

  return binding.sourceMessageId;
}

export function reconcileFirstUseComposerBinding(binding, context) {
  return resolveFirstUseSourceMessageIdForSend(binding, context) === null
    ? null
    : binding;
}

export function validateFirstUsePromotionIngestReceipt({
  requestedSourceMessageId,
  responseStatus,
  reused,
  reusedBy,
  messageMetadata,
}) {
  const metadata = messageMetadata !== null
    && typeof messageMetadata === "object"
    && !Array.isArray(messageMetadata)
    ? messageMetadata
    : {};
  const promotionId = metadata.amora_first_use_promotion_id;
  if (requestedSourceMessageId == null) {
    return promotionId === undefined && reusedBy !== "first_use_source";
  }
  if (
    !isPersistedFirstUseSourceMessageId(requestedSourceMessageId)
    || !isPersistedFirstUseSourceMessageId(promotionId)
    || promotionId === requestedSourceMessageId
    || metadata.amora_first_use_source_message_id !== undefined
    || metadata.firstUseSourceMessageId !== undefined
  ) return false;

  return reused === true
    ? responseStatus === 200 && reusedBy === "first_use_source"
    : reused === false
      && responseStatus === 201
      && (reusedBy === null || reusedBy === undefined);
}

function unavailablePreview() {
  return Object.freeze({ status: "unavailable" });
}

function failedPreview(responseStatus, payload) {
  const code = payload !== null && typeof payload === "object" && !Array.isArray(payload)
    ? payload.code
    : null;
  if (responseStatus === 403 && code === "FIRST_USE_PROMOTION_IDENTITY_CHANGED") {
    return Object.freeze({ status: "identity_changed" });
  }
  if (responseStatus === 409 && code === "FIRST_USE_PROMOTION_CRITERION_STALE") {
    return Object.freeze({ status: "criterion_stale" });
  }
  if (responseStatus === 409 && code === "FIRST_USE_PROMOTION_STALE") {
    return Object.freeze({ status: "stale" });
  }
  return unavailablePreview();
}

function isIdentityFenceError(error) {
  return error instanceof Error
    && (
      error.message === "API_SESSION_OWNER_MISMATCH"
      || error.message === "MOBILE_WEB_API_SESSION_OWNER_MISMATCH"
    );
}

export async function loadAmoraFirstUsePromotionPreview({
  expectedOwnerUserId,
  expectedCoupleId,
  sourceMessageId,
  fetchForExpectedUser,
  signal,
  timeoutMs = AMORA_FIRST_USE_PROMOTION_PREVIEW_TIMEOUT_MS,
}) {
  if (!isPersistedFirstUseSourceMessageId(sourceMessageId)) {
    return Object.freeze({ status: "source_pending" });
  }
  if (
    !isPersistedFirstUseSourceMessageId(expectedOwnerUserId)
    || !isPersistedFirstUseSourceMessageId(expectedCoupleId)
    || typeof fetchForExpectedUser !== "function"
    || (
      signal !== undefined
      && (
        signal === null
        || typeof signal !== "object"
        || typeof signal.addEventListener !== "function"
        || typeof signal.removeEventListener !== "function"
        || typeof signal.aborted !== "boolean"
      )
    )
    || !Number.isSafeInteger(timeoutMs)
    || timeoutMs < 1
  ) return unavailablePreview();
  if (signal?.aborted) return unavailablePreview();

  const controller = new AbortController();
  let didTimeout = false;
  let timeoutHandle;
  const timeoutResult = Object.freeze({ status: "timeout" });
  const timeoutPromise = new Promise((resolve) => {
    timeoutHandle = setTimeout(() => {
      didTimeout = true;
      resolve(timeoutResult);
      controller.abort();
    }, timeoutMs);
  });
  let cancelled = false;
  let cancelForCaller;
  const cancellationPromise = signal
    ? new Promise((resolve) => {
        cancelForCaller = () => {
          if (cancelled) return;
          cancelled = true;
          controller.abort();
          resolve(unavailablePreview());
        };
        signal.addEventListener("abort", cancelForCaller, { once: true });
        if (signal.aborted) cancelForCaller();
      })
    : null;
  const requestPromise = (async () => {
    try {
      const response = await fetchForExpectedUser(
        expectedOwnerUserId,
        `/api/amora/first-use-action-promotions/${encodeURIComponent(sourceMessageId)}`,
        {
          method: "GET",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) return failedPreview(response.status, payload);

      const validated = validateAmoraFirstUsePromotionPreviewResponse(
        payload,
        expectedOwnerUserId,
        expectedCoupleId,
        sourceMessageId,
      );
      if (!validated.ok) {
        return unavailablePreview();
      }
      if (validated.value.state === "already_shared") {
        return Object.freeze({
          status: "already_shared",
          ownerUserId: validated.value.ownerUserId,
          coupleId: validated.value.coupleId,
          sourceMessageId: validated.value.sourceMessageId,
          sharedMessageId: validated.value.sharedMessageId,
        });
      }

      return Object.freeze({
        status: "ready",
        ownerUserId: validated.value.ownerUserId,
        coupleId: validated.value.coupleId,
        sourceMessageId: validated.value.sourceMessageId,
        sourceRevision: validated.value.sourceRevision,
        criterionDecisionId: validated.value.criterionDecisionId,
        draft: Object.freeze({ ...validated.value.canonicalDraft }),
      });
    } catch (error) {
      if (didTimeout) return timeoutResult;
      return isIdentityFenceError(error)
        ? Object.freeze({ status: "identity_changed" })
        : unavailablePreview();
    }
  })();

  try {
    return await Promise.race([
      requestPromise,
      timeoutPromise,
      ...(cancellationPromise ? [cancellationPromise] : []),
    ]);
  } finally {
    clearTimeout(timeoutHandle);
    if (signal && cancelForCaller) {
      signal.removeEventListener("abort", cancelForCaller);
    }
  }
}
