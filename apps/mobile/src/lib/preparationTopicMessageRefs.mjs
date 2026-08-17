/* global AbortController, clearTimeout, setTimeout */

import {
  isAmoraPreparationTopicMessageRefTopicKey,
  parseAmoraPreparationTopicMessageRefMutationRequest,
  validateAmoraPreparationTopicMessageRefCollectionResponse,
  validateAmoraPreparationTopicMessageRefMutationResponse,
  validateAmoraPreparationTopicMessageRefResolveResponse,
  validateAmoraPreparationTopicMessageRefStateResponse,
} from "@hanbang/shared/amora-preparation-topic-message-ref";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MESSAGE_REF_API_PATH = "/api/amora/preparation-topic-message-refs";
const MESSAGE_REF_REQUEST_TIMEOUT_MS = 10_000;
const MAX_MESSAGE_REF_REQUEST_TIMEOUT_MS = 60_000;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isOrdinaryWeddingAnswerMetadata(value) {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (
    Object.hasOwn(value, "pinned_safety_card")
    || Object.hasOwn(value, "mediation")
    || Object.hasOwn(value, "response_origin")
    || keys.some((key) => (
      key.startsWith("safety_")
      || key.startsWith("raw_disclosure")
      || key.startsWith("mediation_")
    ))
    || value.persistence_status === "ephemeral_local_only"
    || value.persistence_status === "local_recovery_only"
    || value.persistence_status === "unconfirmed_ephemeral_fallback"
    || value.kind === "mediation"
    || value.request_kind === "mediation"
    || value.requestKind === "mediation"
  ) return false;
  return (
    value.question_scope === "W0_wedding_core"
    || value.question_scope === "W1_wedding_adjacent"
  ) && (
    value.target === undefined
    || value.target === null
    || value.target === "ai"
  ) && typeof value.in_reply_to_user_message_id === "string"
    && UUID_RE.test(value.in_reply_to_user_message_id);
}

export function isPreparationTopicMessageSaveEligible(message, context) {
  if (!isRecord(message) || !isRecord(context)) return false;
  if (
    (context.viewerRole !== "bride" && context.viewerRole !== "groom")
    || typeof context.coupleId !== "string"
    || !UUID_RE.test(context.coupleId)
  ) return false;
  const ownPrivateVisibility = `${context.viewerRole}_private`;

  return typeof message.id === "string"
    && UUID_RE.test(message.id)
    && message.couple_id === context.coupleId
    && message.role === "assistant"
    && message.sender_type === "ai"
    && typeof message.content === "string"
    && message.content.trim().length > 0
    && (
      message.visibility === "shared"
      || message.visibility === ownPrivateVisibility
    )
    && isOrdinaryWeddingAnswerMetadata(message.metadata);
}

export class PreparationTopicMessageRefError extends Error {
  constructor(code) {
    super(code);
    this.name = "PreparationTopicMessageRefError";
    this.code = code;
  }
}

export function getPreparationTopicMessageReferenceFocusPresentation(error) {
  if (error instanceof PreparationTopicMessageRefError) {
    if (error.code === "source_inaccessible") {
      return Object.freeze({
        message: "이 저장한 대화는 현재 계정에서 볼 수 없어요. 계정과 공개 범위를 확인해 주세요.",
        canRetry: false,
      });
    }
    if (error.code === "source_unavailable" || error.code === "invalid_request") {
      return Object.freeze({
        message: "저장한 대화 원문이 삭제되었거나 더 이상 열 수 없어요.",
        canRetry: false,
      });
    }
  }
  return Object.freeze({
    message: "저장한 대화 원문을 불러오지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요.",
    canRetry: true,
  });
}

function assertCurrent(isCurrent) {
  if (typeof isCurrent !== "function" || !isCurrent()) {
    throw new PreparationTopicMessageRefError("stale_context");
  }
}

function isAbortSignal(value) {
  return value !== null
    && typeof value === "object"
    && typeof value.aborted === "boolean"
    && typeof value.addEventListener === "function"
    && typeof value.removeEventListener === "function";
}

async function runBoundedOperation(operation, options) {
  const {
    signal,
    timeoutMs = MESSAGE_REF_REQUEST_TIMEOUT_MS,
    isCurrent,
  } = options ?? {};
  if (
    typeof operation !== "function"
    || (signal !== undefined && !isAbortSignal(signal))
    || !Number.isSafeInteger(timeoutMs)
    || timeoutMs < 1
    || timeoutMs > MAX_MESSAGE_REF_REQUEST_TIMEOUT_MS
  ) {
    throw new PreparationTopicMessageRefError("invalid_request");
  }
  assertCurrent(isCurrent);
  if (signal?.aborted) {
    assertCurrent(isCurrent);
    throw new PreparationTopicMessageRefError("cancelled");
  }

  const controller = new AbortController();
  const timeoutOutcome = Object.freeze({ kind: "timeout" });
  const cancelledOutcome = Object.freeze({ kind: "cancelled" });
  let timeoutHandle;
  const timeoutPromise = new Promise((resolve) => {
    timeoutHandle = setTimeout(() => {
      resolve(timeoutOutcome);
      controller.abort();
    }, timeoutMs);
  });
  let cancelForCaller;
  const cancellationPromise = signal
    ? new Promise((resolve) => {
        cancelForCaller = () => {
          resolve(cancelledOutcome);
          controller.abort();
        };
        signal.addEventListener("abort", cancelForCaller, { once: true });
        if (signal.aborted) cancelForCaller();
      })
    : null;
  let operationPromise;
  try {
    operationPromise = Promise.resolve(operation(controller.signal)).then(
      (value) => ({ kind: "value", value }),
      (error) => ({ kind: "error", error }),
    );
  } catch (error) {
    operationPromise = Promise.resolve({ kind: "error", error });
  }

  try {
    const outcome = await Promise.race([
      operationPromise,
      timeoutPromise,
      ...(cancellationPromise ? [cancellationPromise] : []),
    ]);
    if (outcome === timeoutOutcome) {
      throw new PreparationTopicMessageRefError("timeout");
    }
    if (outcome === cancelledOutcome) {
      assertCurrent(isCurrent);
      throw new PreparationTopicMessageRefError("cancelled");
    }
    assertCurrent(isCurrent);
    if (outcome.kind === "error") throw outcome.error;
    return outcome.value;
  } finally {
    clearTimeout(timeoutHandle);
    if (signal && cancelForCaller) {
      signal.removeEventListener("abort", cancelForCaller);
    }
  }
}

async function readPayload(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function loadPreparationTopicMessageReferences(options) {
  const {
    apiFetch,
    ownerId,
    coupleId,
    isCurrent,
    signal,
    timeoutMs,
  } = options ?? {};
  if (typeof apiFetch !== "function") {
    throw new PreparationTopicMessageRefError("invalid_request");
  }
  return runBoundedOperation(async (requestSignal) => {
    assertCurrent(isCurrent);
    const response = await apiFetch(MESSAGE_REF_API_PATH, {
      method: "GET",
      signal: requestSignal,
    });
    assertCurrent(isCurrent);
    const payload = await readPayload(response);
    assertCurrent(isCurrent);
    if (!response?.ok) throw new PreparationTopicMessageRefError("read_failed");
    const collection = validateAmoraPreparationTopicMessageRefCollectionResponse(
      payload,
      ownerId,
      coupleId,
    );
    if (!collection.ok) {
      throw new PreparationTopicMessageRefError("invalid_response");
    }
    return collection.value;
  }, { signal, timeoutMs, isCurrent });
}

export async function loadPreparationTopicMessageReferenceState(options) {
  const {
    apiFetch,
    ownerId,
    coupleId,
    topicKey,
    messageId,
    isCurrent,
    signal,
    timeoutMs,
  } = options ?? {};
  if (
    typeof apiFetch !== "function"
    || !isAmoraPreparationTopicMessageRefTopicKey(topicKey)
    || typeof messageId !== "string"
    || !UUID_RE.test(messageId)
  ) {
    throw new PreparationTopicMessageRefError("invalid_request");
  }
  return runBoundedOperation(async (requestSignal) => {
    assertCurrent(isCurrent);
    const response = await apiFetch(exactStatePath(topicKey, messageId), {
      method: "GET",
      signal: requestSignal,
    });
    assertCurrent(isCurrent);
    const payload = await readPayload(response);
    assertCurrent(isCurrent);
    if (!response?.ok) {
      throw new PreparationTopicMessageRefError("read_failed");
    }
    const state = validateAmoraPreparationTopicMessageRefStateResponse(
      payload,
      ownerId,
      coupleId,
      topicKey,
      messageId,
    );
    if (!state.ok) {
      throw new PreparationTopicMessageRefError("invalid_response");
    }
    return state.value;
  }, { signal, timeoutMs, isCurrent });
}

export async function resolvePreparationTopicMessageReference(options) {
  const {
    apiFetch,
    ownerId,
    coupleId,
    refId,
    isCurrent,
    signal,
    timeoutMs,
  } = options ?? {};
  if (typeof apiFetch !== "function" || typeof refId !== "string" || !UUID_RE.test(refId)) {
    throw new PreparationTopicMessageRefError("invalid_request");
  }
  return runBoundedOperation(async (requestSignal) => {
    assertCurrent(isCurrent);
    const response = await apiFetch(
      `${MESSAGE_REF_API_PATH}/${encodeURIComponent(refId)}`,
      { method: "GET", signal: requestSignal },
    );
    assertCurrent(isCurrent);
    const payload = await readPayload(response);
    assertCurrent(isCurrent);
    if (!response?.ok) {
      if (response?.status === 403) {
        throw new PreparationTopicMessageRefError("source_inaccessible");
      }
      if (response?.status === 404 || response?.status === 410) {
        throw new PreparationTopicMessageRefError("source_unavailable");
      }
      throw new PreparationTopicMessageRefError("read_failed");
    }
    const resolved = validateAmoraPreparationTopicMessageRefResolveResponse(
      payload,
      ownerId,
      coupleId,
      refId,
    );
    if (!resolved.ok) {
      throw new PreparationTopicMessageRefError("invalid_response");
    }
    return resolved.value;
  }, { signal, timeoutMs, isCurrent });
}

function resolvedMessageVisibility(lane, viewerRole) {
  if (lane === "shared") return "shared";
  if (viewerRole === "bride" || viewerRole === "groom") {
    return `${viewerRole}_private`;
  }
  throw new PreparationTopicMessageRefError("invalid_request");
}

export function mergePreparationTopicResolvedConversation(
  currentMessages,
  resolved,
  viewerRole,
) {
  if (!Array.isArray(currentMessages) || !isRecord(resolved)) {
    throw new PreparationTopicMessageRefError("invalid_request");
  }
  const visibility = resolvedMessageVisibility(resolved.target?.lane, viewerRole);
  const messagesById = new Map();
  for (const message of currentMessages) {
    if (isRecord(message) && typeof message.id === "string") {
      messagesById.set(message.id, message);
    }
  }

  const priorTarget = messagesById.get(resolved.target.messageId);
  messagesById.set(resolved.target.messageId, {
    id: resolved.target.messageId,
    couple_id: resolved.coupleId,
    sender_id: null,
    role: "assistant",
    sender_type: "ai",
    content: resolved.target.content,
    ...(isRecord(priorTarget?.metadata) ? { metadata: priorTarget.metadata } : {}),
    created_at: resolved.target.createdAt,
    visibility,
  });

  if (resolved.question) {
    const priorQuestion = messagesById.get(resolved.question.messageId);
    messagesById.set(resolved.question.messageId, {
      id: resolved.question.messageId,
      couple_id: resolved.coupleId,
      sender_id: resolved.question.senderType === viewerRole
        ? resolved.recipientUserId
        : null,
      role: "user",
      sender_type: resolved.question.senderType,
      content: resolved.question.content,
      ...(isRecord(priorQuestion?.metadata) ? { metadata: priorQuestion.metadata } : {}),
      created_at: resolved.question.createdAt,
      visibility,
    });
  }

  return [...messagesById.values()].sort((left, right) => {
    const byCreatedAt = Date.parse(left.created_at ?? "") - Date.parse(right.created_at ?? "");
    return (Number.isFinite(byCreatedAt) ? byCreatedAt : 0)
      || left.id.localeCompare(right.id);
  });
}

function exactStatePath(topicKey, messageId) {
  return `${MESSAGE_REF_API_PATH}?topicKey=${encodeURIComponent(topicKey)}&messageId=${encodeURIComponent(messageId)}`;
}

export async function mutatePreparationTopicMessageReference(options) {
  const {
    apiFetch,
    ownerId,
    coupleId,
    topicKey,
    messageId,
    desiredState,
    requestId,
    isCurrent,
    signal,
    timeoutMs,
  } = options ?? {};
  if (typeof apiFetch !== "function") {
    throw new PreparationTopicMessageRefError("invalid_request");
  }

  return runBoundedOperation(async (operationSignal) => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const state = await loadPreparationTopicMessageReferenceState({
        apiFetch,
        ownerId,
        coupleId,
        topicKey,
        messageId,
        isCurrent,
        signal: operationSignal,
        timeoutMs,
      });
      if (state.reference.savedState === desiredState) {
        return Object.freeze({ ...state, reused: true });
      }

      const body = parseAmoraPreparationTopicMessageRefMutationRequest({
        topicKey,
        messageId,
        desiredState,
        expectedRevision: state.reference.revision,
        requestId,
      });
      if (!body) throw new PreparationTopicMessageRefError("invalid_request");

      assertCurrent(isCurrent);
      const mutationResponse = await apiFetch(MESSAGE_REF_API_PATH, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: operationSignal,
      });
      assertCurrent(isCurrent);
      const mutationPayload = await readPayload(mutationResponse);
      assertCurrent(isCurrent);
      if (mutationResponse?.status === 409 && attempt === 0) continue;
      if (!mutationResponse?.ok) {
        throw new PreparationTopicMessageRefError(
          mutationResponse?.status === 409 ? "stale_revision" : "write_failed",
        );
      }
      const mutation = validateAmoraPreparationTopicMessageRefMutationResponse(
        mutationPayload,
        ownerId,
        coupleId,
        topicKey,
        messageId,
        desiredState,
      );
      if (!mutation.ok || mutation.value.reference.savedState !== desiredState) {
        throw new PreparationTopicMessageRefError("invalid_response");
      }
      return mutation.value;
    }

    throw new PreparationTopicMessageRefError("stale_revision");
  }, { signal, timeoutMs, isCurrent });
}
