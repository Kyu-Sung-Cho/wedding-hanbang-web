import { buildAmoraHomeDraft } from "./amoraEntryPlan.mjs";
import { validateAmoraScheduleCareFollowUpBinding } from "@hanbang/shared/amora-schedule-care-follow-up";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

let pendingHandoff = null;
const HANDOFF_TTL_MS = 10 * 60 * 1000;
const EXTENDED_PICTOGRAPHIC_PATTERN = /^\p{Extended_Pictographic}$/u;

function isEmojiAdornment(character) {
  const codePoint = character?.codePointAt(0);
  return character === "\ufe0e"
    || character === "\ufe0f"
    || (codePoint != null && codePoint >= 0x1f3fb && codePoint <= 0x1f3ff);
}

function hasUnsafeFormatting(value, allowLineFeed = false) {
  const characters = Array.from(value);
  return characters.some((character, index) => {
    if (character === "\n" && allowLineFeed) return false;
    if (character === "\u200d") {
      let previousIndex = index - 1;
      while (previousIndex >= 0 && isEmojiAdornment(characters[previousIndex])) {
        previousIndex -= 1;
      }
      let nextIndex = index + 1;
      while (nextIndex < characters.length && isEmojiAdornment(characters[nextIndex])) {
        nextIndex += 1;
      }
      return previousIndex < 0
        || nextIndex >= characters.length
        || !EXTENDED_PICTOGRAPHIC_PATTERN.test(characters[previousIndex])
        || !EXTENDED_PICTOGRAPHIC_PATTERN.test(characters[nextIndex]);
    }
    return /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(character);
  });
}

function normalizeUuid(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return UUID_PATTERN.test(normalized) ? normalized : null;
}

function normalizeBriefText(value, maxLength) {
  if (typeof value !== "string") return "";
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (
    !normalized
    || Array.from(normalized).length > maxLength
    || hasUnsafeFormatting(normalized)
  ) return "";
  return normalized;
}

function normalizePromptText(value, maxLength) {
  if (typeof value !== "string") return "";
  const normalized = value.replace(/\r\n?/gu, "\n").trim();
  if (
    !normalized
    || Array.from(normalized).length > maxLength
    || hasUnsafeFormatting(normalized, true)
  ) return "";
  return normalized;
}

export function readPrivateChatHandoffPromptFromUrl(value, expectedSiteOrigin) {
  if (
    typeof value !== "string"
    || value.length > 8192
    || typeof expectedSiteOrigin !== "string"
  ) return null;
  try {
    const expected = new globalThis.URL(expectedSiteOrigin);
    const parsed = new globalThis.URL(value);
    const keys = [...parsed.searchParams.keys()];
    if (
      expected.origin !== expectedSiteOrigin
      || expected.pathname !== "/"
      || expected.search
      || expected.hash
      || parsed.origin !== expected.origin
      || parsed.pathname !== "/wedding/chat"
      || parsed.hash
      || keys.length !== 1
      || keys[0] !== "prefill"
      || parsed.searchParams.getAll("prefill").length !== 1
    ) return null;
    return normalizePromptText(parsed.searchParams.get("prefill"), 2400) || null;
  } catch {
    return null;
  }
}

export function stagePrivateChatHandoff({
  handoffId,
  ownerUserId,
  coupleId,
  prompt,
  scheduleCareFollowUp,
}) {
  const normalizedHandoffId = normalizeUuid(handoffId);
  const normalizedOwnerUserId = normalizeUuid(ownerUserId);
  const normalizedCoupleId = normalizeUuid(coupleId);
  const normalizedPrompt = normalizePromptText(prompt, 2400);
  const scheduleBindingValidation = scheduleCareFollowUp === undefined
    ? null
    : validateAmoraScheduleCareFollowUpBinding(scheduleCareFollowUp);
  if (
    !normalizedHandoffId
    || !normalizedOwnerUserId
    || !normalizedCoupleId
    || !normalizedPrompt
    || (scheduleBindingValidation !== null && !scheduleBindingValidation.ok)
  ) {
    pendingHandoff = null;
    return null;
  }

  pendingHandoff = {
    handoffId: normalizedHandoffId,
    ownerUserId: normalizedOwnerUserId,
    coupleId: normalizedCoupleId,
    expiresAtMs: Date.now() + HANDOFF_TTL_MS,
    prompt: normalizedPrompt,
    ...(scheduleBindingValidation?.ok
      ? { scheduleCareFollowUp: scheduleBindingValidation.value }
      : {}),
  };
  return normalizedHandoffId;
}

export function stageCompanionChatHandoff({
  handoffId,
  ownerUserId,
  coupleId,
  brief,
}) {
  const normalizedHandoffId = normalizeUuid(handoffId);
  const normalizedOwnerUserId = normalizeUuid(ownerUserId);
  const normalizedCoupleId = normalizeUuid(coupleId);
  const priorityTitle = normalizeBriefText(brief?.priorityTitle, 500);
  const whyNow = normalizeBriefText(brief?.whyNow, 320);
  const evidenceLabel = normalizeBriefText(brief?.evidenceLabel, 120);
  const coreCriterion = brief?.coreCriterion == null
    ? null
    : normalizeBriefText(brief.coreCriterion, 120);
  if (
    !normalizedHandoffId
    || !normalizedOwnerUserId
    || !normalizedCoupleId
    || !priorityTitle
    || !whyNow
    || !evidenceLabel
    || (brief?.coreCriterion != null && !coreCriterion)
  ) {
    pendingHandoff = null;
    return null;
  }

  const prompt = buildAmoraHomeDraft({
    intent: brief?.chatIntent,
    priorityTitle,
    whyNow,
    evidenceLabel,
    coreCriterion,
    useCoupleCriterion: Boolean(brief?.coupleCriterion),
  });
  if (!prompt) {
    pendingHandoff = null;
    return null;
  }

  return stagePrivateChatHandoff({
    handoffId: normalizedHandoffId,
    ownerUserId: normalizedOwnerUserId,
    coupleId: normalizedCoupleId,
    prompt,
  });
}

export function consumeCompanionChatHandoff(
  handoffId,
  expectedOwnerUserId,
  expectedCoupleId,
) {
  const normalizedHandoffId = normalizeUuid(handoffId);
  const normalizedOwnerUserId = normalizeUuid(expectedOwnerUserId);
  const normalizedCoupleId = normalizeUuid(expectedCoupleId);
  if (!normalizedHandoffId || !normalizedOwnerUserId || !normalizedCoupleId) return null;
  if (!pendingHandoff || pendingHandoff.handoffId !== normalizedHandoffId) {
    return null;
  }

  const handoff = pendingHandoff;
  pendingHandoff = null;
  if (handoff.ownerUserId !== normalizedOwnerUserId) return null;
  if (handoff.expiresAtMs <= Date.now()) return null;
  if (handoff.coupleId !== normalizedCoupleId) return null;
  return {
    prompt: handoff.prompt,
    ...(handoff.scheduleCareFollowUp
      ? { scheduleCareFollowUp: handoff.scheduleCareFollowUp }
      : {}),
  };
}
