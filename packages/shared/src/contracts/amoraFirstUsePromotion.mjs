export const AMORA_FIRST_USE_PROMOTION_CONTRACT_VERSION = 1;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UNSAFE_DISPLAY_RE =
  /[\p{Cc}\p{Zl}\p{Zp}\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069\u2060-\u2064\u206A-\u206F\uFEFF]/u;
const UNSAFE_FORMAT_EXCEPT_ZWJ_RE = /(?!\u200D)\p{Cf}/u;
const BARE_ZWJ_RE =
  /(?:^|[^\p{Extended_Pictographic}])\u200D|\u200D(?:$|[^\p{Extended_Pictographic}])/u;
const UNSAFE_MULTILINE_RE =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u061C\u200E\u200F\u2028\u2029\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF]/u;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, expectedKeys) {
  return Object.keys(value).sort().join(",") === [...expectedKeys].sort().join(",");
}

function isUuid(value) {
  return typeof value === "string" && UUID_RE.test(value);
}

function isSafeVisibleText(value, maxLength) {
  return typeof value === "string"
    && value === value.trim()
    && value.length > 0
    && Array.from(value).length <= maxLength
    && !/[\r\n]/u.test(value)
    && !UNSAFE_DISPLAY_RE.test(value)
    && !UNSAFE_FORMAT_EXCEPT_ZWJ_RE.test(value)
    && !BARE_ZWJ_RE.test(value);
}

function parseActionHeading(line) {
  const visible = line
    .trim()
    .replace(/^[#>\s-]+/u, "")
    .replaceAll("**", "")
    .trim();
  const match = /^(지금 할 한 가지|이유|완료 기준)(?:\s*[:：]\s*(.*)|\s*)$/u.exec(visible);
  if (!match) return null;
  return {
    key: match[1] === "지금 할 한 가지"
      ? "action"
      : match[1] === "이유"
        ? "reason"
        : "completionCriterion",
    inlineValue: (match[2] ?? "").trim(),
  };
}

function normalizeActionField(value, maxLength) {
  if (typeof value !== "string") return null;
  const normalized = value
    .replace(/^\s*(?:[-*•]|\d+[.)])\s*/u, "")
    .replaceAll("**", "")
    .replace(/\s+/gu, " ")
    .trim();
  if (
    !isSafeVisibleText(normalized, maxLength)
    || ["<", ">", "{", "}", "[", "]"].some((character) => normalized.includes(character))
  ) return null;
  return normalized;
}

export function extractAmoraFirstUseActionDraft(value) {
  if (
    typeof value !== "string"
    || !value.trim()
    || Array.from(value).length > 12_000
    || UNSAFE_MULTILINE_RE.test(value)
    || UNSAFE_FORMAT_EXCEPT_ZWJ_RE.test(value)
    || BARE_ZWJ_RE.test(value)
  ) return null;

  const lines = value.split("\n");
  const fields = {};
  for (let index = 0; index < lines.length; index += 1) {
    const heading = parseActionHeading(lines[index]);
    if (!heading) continue;
    if (fields[heading.key] !== undefined) return null;
    let fieldValue = heading.inlineValue;
    if (!fieldValue) {
      let nextIndex = index + 1;
      while (nextIndex < lines.length && !lines[nextIndex].trim()) nextIndex += 1;
      if (nextIndex >= lines.length || parseActionHeading(lines[nextIndex])) return null;
      fieldValue = lines[nextIndex];
    }
    const maxLength = heading.key === "action" ? 120 : 220;
    const normalized = normalizeActionField(fieldValue, maxLength);
    if (!normalized) return null;
    fields[heading.key] = normalized;
  }
  return typeof fields.action === "string"
    && typeof fields.reason === "string"
    && typeof fields.completionCriterion === "string"
    ? Object.freeze({
        action: fields.action,
        reason: fields.reason,
        completionCriterion: fields.completionCriterion,
      })
    : null;
}

export function buildAmoraFirstUseSharedDraft({
  action,
  reason,
  completionCriterion,
}) {
  if (
    !isSafeVisibleText(action, 120)
    || !isSafeVisibleText(reason, 220)
    || !isSafeVisibleText(completionCriterion, 220)
  ) return null;

  return [
    "나만 상담에서 정리한 이 한 가지를 둘이 볼 실행 카드로 제안해줘.",
    `지금 할 한 가지: ${action}`,
    `이유: ${reason}`,
    `완료 기준: ${completionCriterion}`,
    "저장 전에는 확인 카드만 보여줘.",
  ].join("\n");
}

function isCanonicalDraft(value) {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      "action",
      "reason",
      "completionCriterion",
      "sharedText",
    ])
  ) return false;

  const sharedText = buildAmoraFirstUseSharedDraft(value);
  return sharedText !== null && value.sharedText === sharedText;
}

export function validateAmoraFirstUsePromotionPreviewResponse(
  value,
  expectedOwnerUserId,
  expectedCoupleId,
  expectedSourceMessageId,
) {
  if (
    !isUuid(expectedOwnerUserId)
    || !isUuid(expectedCoupleId)
    || !isUuid(expectedSourceMessageId)
    || !isRecord(value)
  ) {
    return { ok: false, reason: "invalid" };
  }
  if (value.version !== AMORA_FIRST_USE_PROMOTION_CONTRACT_VERSION) {
    return { ok: false, reason: "version" };
  }
  if (value.ownerUserId !== expectedOwnerUserId) {
    return { ok: false, reason: "owner" };
  }
  if (value.coupleId !== expectedCoupleId) {
    return { ok: false, reason: "couple" };
  }
  if (value.sourceMessageId !== expectedSourceMessageId) {
    return { ok: false, reason: "source" };
  }

  if (value.state === "ready") {
    if (
      !hasExactKeys(value, [
        "version",
        "state",
        "ownerUserId",
        "coupleId",
        "sourceMessageId",
        "sourceRevision",
        "criterionDecisionId",
        "canonicalDraft",
      ])
      || !Number.isSafeInteger(value.sourceRevision)
      || value.sourceRevision < 0
      || (value.criterionDecisionId !== null && !isUuid(value.criterionDecisionId))
      || !isCanonicalDraft(value.canonicalDraft)
    ) {
      return { ok: false, reason: "state" };
    }
    return { ok: true, value };
  }

  if (value.state === "already_shared") {
    if (
      !hasExactKeys(value, [
        "version",
        "state",
        "ownerUserId",
        "coupleId",
        "sourceMessageId",
        "sharedMessageId",
      ])
      || !isUuid(value.sharedMessageId)
    ) {
      return { ok: false, reason: "state" };
    }
    return { ok: true, value };
  }

  return { ok: false, reason: "state" };
}
