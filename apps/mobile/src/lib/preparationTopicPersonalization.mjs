/* global AbortController, clearTimeout, setTimeout */

import { normalizeAmoraCoreCriterionText } from "@hanbang/shared/amora-core-criterion";
import { parseAmoraCoreCriterionResponse } from "@hanbang/shared/amora-core-criterion";
import { parseAmoraCoupleCriterionResponse } from "@hanbang/shared/amora-couple-criterion";

import { parseAmoraPersonalizationEnvelope } from "./amoraPersonalization.mjs";
import { buildAmoraHomeDraft } from "./amoraEntryPlan.mjs";
import { buildAmoraHomePersonalization } from "./amoraPersonalizationSettings.mjs";
import { parsePreparationTopicChatHandoffBinding } from "./preparationTopicChatRoundTrip.mjs";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const TOPIC_KEY_PATTERN = /^[a-z][a-z0-9_]{1,39}$/u;
const DEFAULT_READ_TIMEOUT_MS = 10_000;
const READ_STATES = Object.freeze([
  "loading",
  "loaded",
  "partial",
  "unavailable",
]);
const TOPIC_EFFECT_LABELS = Object.freeze({
  question: "이 주제의 확인 질문에 연결됨",
  candidate: "이 주제의 후보 비교에 연결됨",
  constraint: "이 주제의 선택 조건에 연결됨",
  action: "이 주제의 다음 행동에 연결됨",
});

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  if (!isRecord(value)) return false;
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length
    && keys.every((key) => actualKeys.includes(key));
}

function isReadState(value) {
  return typeof value === "string" && READ_STATES.includes(value);
}

function normalizeDisplayText(value, maxLength) {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (
    !normalized
    || Array.from(normalized).length > maxLength
    || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(normalized)
  ) return null;
  return normalized;
}

export class PreparationTopicPersonalizationError extends Error {
  constructor(code) {
    super(code);
    this.name = "PreparationTopicPersonalizationError";
    this.code = code;
  }
}

function validateLoaderInput({ ownerId, apiFetch, isCurrent, timeoutMs }) {
  return typeof ownerId === "string"
    && UUID_PATTERN.test(ownerId)
    && typeof apiFetch === "function"
    && typeof isCurrent === "function"
    && Number.isSafeInteger(timeoutMs)
    && timeoutMs >= 1
    && timeoutMs <= 30_000;
}

async function readParsedResource({
  path,
  apiFetch,
  isCurrent,
  signal,
  parse,
  project,
}) {
  if (!isCurrent()) throw new PreparationTopicPersonalizationError("stale_context");
  let response;
  try {
    response = await apiFetch(path, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal,
    });
  } catch {
    if (!isCurrent()) {
      throw new PreparationTopicPersonalizationError("stale_context");
    }
    if (signal.aborted) {
      throw new PreparationTopicPersonalizationError("timeout");
    }
    return Object.freeze({ ok: false, value: null });
  }
  if (!isCurrent()) throw new PreparationTopicPersonalizationError("stale_context");

  const payload = await response.json().catch(() => null);
  if (!isCurrent()) throw new PreparationTopicPersonalizationError("stale_context");
  const parsed = response.ok ? parse(payload) : null;
  return parsed
    ? Object.freeze({ ok: true, value: project(parsed) })
    : Object.freeze({ ok: false, value: null });
}

export async function loadPreparationTopicOwnerContext({
  ownerId,
  apiFetch,
  isCurrent,
  timeoutMs = DEFAULT_READ_TIMEOUT_MS,
}) {
  if (!validateLoaderInput({ ownerId, apiFetch, isCurrent, timeoutMs })) {
    throw new PreparationTopicPersonalizationError("invalid_request");
  }

  const controller = new AbortController();
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new PreparationTopicPersonalizationError("timeout"));
    }, timeoutMs);
  });

  try {
    const reads = Promise.all([
      readParsedResource({
        path: "/api/amora/personalization",
        apiFetch,
        isCurrent,
        signal: controller.signal,
        parse: parseAmoraPersonalizationEnvelope,
        project: (value) => value.profile?.preferences ?? null,
      }),
      readParsedResource({
        path: "/api/amora/criterion",
        apiFetch,
        isCurrent,
        signal: controller.signal,
        parse: parseAmoraCoreCriterionResponse,
        project: (value) => value.criterion?.value ?? null,
      }),
    ]);
    const [personalizationRead, criterionRead] = await Promise.race([reads, timeout]);
    if (!isCurrent()) {
      throw new PreparationTopicPersonalizationError("stale_context");
    }
    if (!personalizationRead.ok && !criterionRead.ok) {
      throw new PreparationTopicPersonalizationError("read_failed");
    }
    return Object.freeze({
      readState: personalizationRead.ok && criterionRead.ok ? "loaded" : "partial",
      preferences: personalizationRead.value,
      coreCriterion: criterionRead.value,
    });
  } finally {
    clearTimeout(timeoutId);
    controller.abort();
  }
}

export async function loadPreparationTopicCoupleContext({
  ownerId,
  coupleId,
  apiFetch,
  isCurrent,
  timeoutMs = DEFAULT_READ_TIMEOUT_MS,
}) {
  if (
    !validateLoaderInput({ ownerId, apiFetch, isCurrent, timeoutMs })
    || typeof coupleId !== "string"
    || !UUID_PATTERN.test(coupleId)
  ) {
    throw new PreparationTopicPersonalizationError("invalid_request");
  }

  const controller = new AbortController();
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new PreparationTopicPersonalizationError("timeout"));
    }, timeoutMs);
  });

  try {
    const read = readParsedResource({
      path: "/api/amora/couple-criterion",
      apiFetch,
      isCurrent,
      signal: controller.signal,
      parse: parseAmoraCoupleCriterionResponse,
      project: (value) => value,
    });
    const result = await Promise.race([read, timeout]);
    if (!isCurrent()) {
      throw new PreparationTopicPersonalizationError("stale_context");
    }
    if (!result.ok || result.value.coupleId !== coupleId.toLowerCase()) {
      throw new PreparationTopicPersonalizationError("read_failed");
    }
    return Object.freeze({
      readState: "loaded",
      confirmedCriterion: result.value.current?.value ?? null,
    });
  } finally {
    clearTimeout(timeoutId);
    controller.abort();
  }
}

export function buildPreparationTopicAmoraHandoff(value) {
  if (
    !hasExactKeys(value, [
      "topicKey",
      "topicLabel",
      "journeyRevision",
      "actionRef",
      "statusLabel",
      "progressLabel",
      "nextAction",
      "privateCriterion",
      "useCoupleCriterion",
    ])
    || !hasExactKeys(value.nextAction, [
      "title",
      "reason",
      "completionCriterion",
    ])
    || typeof value.useCoupleCriterion !== "boolean"
  ) return null;

  const topicLabel = normalizeDisplayText(value.topicLabel, 120);
  const statusLabel = normalizeDisplayText(value.statusLabel, 40);
  const progressLabel = normalizeDisplayText(value.progressLabel, 80);
  const actionTitle = normalizeDisplayText(value.nextAction.title, 320);
  const actionReason = normalizeDisplayText(value.nextAction.reason, 180);
  const completionCriterion = normalizeDisplayText(
    value.nextAction.completionCriterion,
    180,
  );
  const privateCriterion = value.privateCriterion === null
    ? null
    : normalizeAmoraCoreCriterionText(value.privateCriterion);
  if (
    !topicLabel
    || !statusLabel
    || !progressLabel
    || !actionTitle
    || !actionReason
    || !completionCriterion
    || (value.privateCriterion !== null && privateCriterion !== value.privateCriterion)
  ) return null;
  const preparationTopic = parsePreparationTopicChatHandoffBinding({
    topicKey: value.topicKey,
    topicLabel,
    journeyRevision: value.journeyRevision,
    actionRef: value.actionRef,
  });
  if (!preparationTopic) return null;

  const prompt = buildAmoraHomeDraft({
    intent: "focus",
    priorityTitle: `${topicLabel} · ${actionTitle}`,
    whyNow:
      `${statusLabel} · ${progressLabel}. ${actionReason} 끝나는 기준은 ${completionCriterion}`,
    evidenceLabel: "준비 주제 화면",
    coreCriterion: privateCriterion,
    useCoupleCriterion: value.useCoupleCriterion,
  });
  if (!prompt) return null;

  return Object.freeze({
    title: "아모라와 이 준비 이어보기",
    description: "현재 상태와 기준을 가져가서 질문 한 가지부터 시작해요.",
    prompt,
    preparationTopic,
  });
}

function parseOwnerContext(value) {
  if (
    !hasExactKeys(value, ["readState", "preferences", "coreCriterion"])
    || !isReadState(value.readState)
    || (
      (value.readState === "loading" || value.readState === "unavailable")
      && (value.preferences !== null || value.coreCriterion !== null)
    )
  ) return null;

  if (
    value.preferences !== null
    && !buildAmoraHomePersonalization(value.preferences, "focus")
  ) return null;

  const coreCriterion = value.coreCriterion === null
    ? null
    : normalizeAmoraCoreCriterionText(value.coreCriterion);
  if (value.coreCriterion !== null && coreCriterion !== value.coreCriterion) return null;

  return Object.freeze({
    readState: value.readState,
    coreCriterion,
  });
}

function parseCoupleContext(value) {
  if (
    !hasExactKeys(value, ["readState", "confirmedCriterion"])
    || !isReadState(value.readState)
    || value.readState === "partial"
    || (
      (value.readState === "loading" || value.readState === "unavailable")
      && value.confirmedCriterion !== null
    )
  ) return null;

  const confirmedCriterion = value.confirmedCriterion === null
    ? null
    : normalizeAmoraCoreCriterionText(value.confirmedCriterion);
  if (
    value.confirmedCriterion !== null
    && confirmedCriterion !== value.confirmedCriterion
  ) return null;

  return Object.freeze({
    readState: value.readState,
    confirmedCriterion,
  });
}

function freezeItem(key, title, detail, scopeLabel) {
  return Object.freeze({
    key,
    title,
    detail,
    scopeLabel,
    accessibilityLabel: `${title}, ${detail.replace(/ · /gu, ", ")}, ${scopeLabel}`,
  });
}

function parseAppliedEffect(value, expectedTopicKey) {
  if (value === null) return null;
  if (
    !hasExactKeys(value, ["topicKey", "criterion", "affects"])
    || value.topicKey !== expectedTopicKey
    || !Object.hasOwn(TOPIC_EFFECT_LABELS, value.affects)
  ) return undefined;

  const criterion = normalizeAmoraCoreCriterionText(value.criterion);
  if (criterion !== value.criterion) return undefined;
  return Object.freeze({
    criterion,
    effectLabel: TOPIC_EFFECT_LABELS[value.affects],
  });
}

export function buildPreparationTopicPersonalization({
  topicKey,
  ownerContext,
  coupleContext,
  appliedEffects,
}) {
  if (
    typeof topicKey !== "string"
    || !TOPIC_KEY_PATTERN.test(topicKey)
  ) return null;
  const owner = parseOwnerContext(ownerContext);
  const couple = parseCoupleContext(coupleContext);
  if (!owner || !couple) return null;
  if (appliedEffects === null) return null;
  if (!hasExactKeys(appliedEffects, ["ownerCriterion", "coupleCriterion"])) {
    return null;
  }

  const ownerEffect = parseAppliedEffect(
    appliedEffects.ownerCriterion,
    topicKey,
  );
  const coupleEffect = parseAppliedEffect(
    appliedEffects.coupleCriterion,
    topicKey,
  );
  if (ownerEffect === undefined || coupleEffect === undefined) return null;

  const items = [];
  const notices = [];
  if (ownerEffect && owner.coreCriterion) {
    if (ownerEffect.criterion !== owner.coreCriterion) return null;
    items.push(freezeItem(
      "owner-criterion",
      "내 기준",
      `${owner.coreCriterion} · ${ownerEffect.effectLabel}`,
      "나만 보기",
    ));
  } else if (ownerEffect && ["partial", "unavailable"].includes(owner.readState)) {
    notices.push("이 주제에 연결된 내 기준을 지금 확인하지 못했어요.");
  } else if (ownerEffect) {
    return null;
  }
  if (coupleEffect && couple.confirmedCriterion) {
    if (coupleEffect.criterion !== couple.confirmedCriterion) return null;
    items.push(freezeItem(
      "couple-criterion",
      "우리 기준",
      `${couple.confirmedCriterion} · ${coupleEffect.effectLabel}`,
      "둘이 확인",
    ));
  } else if (coupleEffect && couple.readState === "unavailable") {
    notices.push("이 주제에 연결된 우리 기준을 지금 확인하지 못했어요.");
  } else if (coupleEffect) {
    return null;
  }

  if (items.length === 0 && notices.length === 0) return null;

  return Object.freeze({
    title: "우리 상황",
    items: Object.freeze(items),
    notices: Object.freeze(notices),
    note: items.length > 0
      ? "현재 주제의 질문·후보·조건·행동에 실제 연결된 기준만 보여줘요."
      : null,
  });
}
