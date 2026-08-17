import { isAmoraPreparationTopicMessageRefTopicKey } from "@hanbang/shared/amora-preparation-topic-message-ref";

import { buildChecklistDeepLinkParams } from "./scheduleChecklistNavigation.mjs";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const ACTION_ID_PATTERN = /^[0-9A-Za-z_-]{1,200}$/u;
const UNSAFE_INLINE_PATTERN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const UNSAFE_MULTILINE_PATTERN =
  // eslint-disable-next-line no-control-regex -- Rejects hidden multiline controls at the handoff boundary.
  /[\p{Cf}\p{Zl}\p{Zp}\u0000-\u0009\u000B-\u001F\u007F-\u009F]/u;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, expected) {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return keys.length === expected.length
    && expected.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function normalizeUuid(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return UUID_PATTERN.test(normalized) ? normalized : null;
}

function normalizeInlineText(value, maxLength) {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (
    !normalized
    || normalized !== value
    || Array.from(normalized).length > maxLength
    || UNSAFE_INLINE_PATTERN.test(normalized)
  ) return null;
  return normalized;
}

function normalizePrompt(value) {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\r\n?/gu, "\n").trim();
  if (
    !normalized
    || normalized !== value
    || Array.from(normalized).length > 2400
    || UNSAFE_MULTILINE_PATTERN.test(normalized)
  ) return null;
  return normalized;
}

function parseActionRef(value) {
  if (value === null) return null;
  if (
    !hasExactKeys(value, ["id", "revision"])
    || typeof value.id !== "string"
    || !ACTION_ID_PATTERN.test(value.id)
    || (
      value.revision !== null
      && (
        !Number.isSafeInteger(value.revision)
        || value.revision < 1
      )
    )
  ) return undefined;
  return Object.freeze({ id: value.id, revision: value.revision });
}

export function parsePreparationTopicChatHandoffBinding(value) {
  if (
    !hasExactKeys(value, [
      "topicKey",
      "topicLabel",
      "journeyRevision",
      "actionRef",
    ])
    || !isAmoraPreparationTopicMessageRefTopicKey(value.topicKey)
    || !Number.isSafeInteger(value.journeyRevision)
    || value.journeyRevision < 0
  ) return null;

  const topicLabel = normalizeInlineText(value.topicLabel, 120);
  const actionRef = parseActionRef(value.actionRef);
  if (!topicLabel || actionRef === undefined) return null;
  return Object.freeze({
    topicKey: value.topicKey,
    topicLabel,
    journeyRevision: value.journeyRevision,
    actionRef,
  });
}

function parseComposerBinding(value) {
  if (!hasExactKeys(value, [
    "ownerUserId",
    "coupleId",
    "prompt",
    "preparationTopic",
  ])) return null;
  const ownerUserId = normalizeUuid(value.ownerUserId);
  const coupleId = normalizeUuid(value.coupleId);
  const prompt = normalizePrompt(value.prompt);
  const preparationTopic = parsePreparationTopicChatHandoffBinding(value.preparationTopic);
  if (!ownerUserId || !coupleId || !prompt || !preparationTopic) return null;
  return Object.freeze({
    ownerUserId,
    coupleId,
    prompt,
    preparationTopic,
  });
}

export function createPreparationTopicChatComposerBinding(value) {
  return parseComposerBinding(value);
}

export function reconcilePreparationTopicChatComposerBinding(binding, context) {
  const parsed = parseComposerBinding(binding);
  if (
    !parsed
    || !hasExactKeys(context, [
      "ownerUserId",
      "coupleId",
      "lane",
      "privateText",
    ])
    || normalizeUuid(context.ownerUserId) !== parsed.ownerUserId
    || normalizeUuid(context.coupleId) !== parsed.coupleId
    || context.lane !== "private_ai"
    || context.privateText !== parsed.prompt
  ) return null;
  return binding;
}

export function resolvePreparationTopicChatBindingForSend(binding, context) {
  return reconcilePreparationTopicChatComposerBinding(binding, context);
}

function parseReturnReceipt(value) {
  if (!hasExactKeys(value, [
    "ownerUserId",
    "coupleId",
    "assistantMessageId",
    "serverRequestKey",
    "preparationTopic",
  ])) return null;
  const ownerUserId = normalizeUuid(value.ownerUserId);
  const coupleId = normalizeUuid(value.coupleId);
  const assistantMessageId = normalizeUuid(value.assistantMessageId);
  const preparationTopic = parsePreparationTopicChatHandoffBinding(value.preparationTopic);
  if (
    !ownerUserId
    || !coupleId
    || !assistantMessageId
    || !preparationTopic
    || typeof value.serverRequestKey !== "string"
    || value.serverRequestKey !== `chat:${ownerUserId}:${value.serverRequestKey.split(":")[2] ?? ""}`
  ) return null;
  const requestKeyParts = value.serverRequestKey.split(":");
  if (
    requestKeyParts.length !== 3
    || requestKeyParts[0] !== "chat"
    || normalizeUuid(requestKeyParts[1]) !== ownerUserId
    || normalizeUuid(requestKeyParts[2]) !== requestKeyParts[2]
  ) return null;
  return Object.freeze({
    ownerUserId,
    coupleId,
    assistantMessageId,
    serverRequestKey: value.serverRequestKey,
    preparationTopic,
  });
}

export function createPreparationTopicChatReturnReceipt(value) {
  if (
    !hasExactKeys(value, [
      "binding",
      "ownerUserId",
      "coupleId",
      "lane",
      "visibility",
      "requestText",
      "responseText",
      "serverMessageId",
      "serverRequestKey",
    ])
  ) return null;
  const binding = reconcilePreparationTopicChatComposerBinding(value.binding, {
    ownerUserId: value.ownerUserId,
    coupleId: value.coupleId,
    lane: value.lane,
    privateText: value.requestText,
  });
  const responseText = typeof value.responseText === "string"
    ? value.responseText.trim()
    : "";
  if (
    !binding
    || (value.visibility !== "bride_private" && value.visibility !== "groom_private")
    || !responseText
  ) return null;
  return parseReturnReceipt({
    ownerUserId: binding.ownerUserId,
    coupleId: binding.coupleId,
    assistantMessageId: value.serverMessageId,
    serverRequestKey: value.serverRequestKey,
    preparationTopic: binding.preparationTopic,
  });
}

export function buildPreparationTopicChatReturnDestination(receipt, identity) {
  const parsed = parseReturnReceipt(receipt);
  if (
    !parsed
    || !hasExactKeys(identity, ["ownerUserId", "coupleId"])
    || normalizeUuid(identity.ownerUserId) !== parsed.ownerUserId
    || normalizeUuid(identity.coupleId) !== parsed.coupleId
  ) return null;
  const actionRef = parsed.preparationTopic.actionRef;
  const params = buildChecklistDeepLinkParams({
    categoryKey: parsed.preparationTopic.topicKey,
    ...(actionRef
      ? { actionId: actionRef.id, actionRevision: actionRef.revision }
      : {}),
  });
  if (!params) return null;
  return Object.freeze({ pathname: "/checklist", params });
}
