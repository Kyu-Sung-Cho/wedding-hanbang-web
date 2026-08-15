export const AMORA_CORE_CRITERION_CONTRACT_VERSION = 1;
export const AMORA_CORE_CRITERION_MAX_LENGTH = 120;

const EXTENDED_PICTOGRAPHIC_PATTERN = /^\p{Extended_Pictographic}$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value, allowedKeys) {
  return Object.keys(value).every((key) => allowedKeys.includes(key));
}

function isEmojiAdornment(character) {
  const codePoint = character?.codePointAt(0);
  return character === "\ufe0e"
    || character === "\ufe0f"
    || (codePoint != null && codePoint >= 0x1f3fb && codePoint <= 0x1f3ff);
}

function hasUnsafeFormatting(value) {
  const characters = Array.from(value);
  return characters.some((character, index) => {
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

export function normalizeAmoraCoreCriterionText(value) {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (
    !normalized
    || Array.from(normalized).length > AMORA_CORE_CRITERION_MAX_LENGTH
    || hasUnsafeFormatting(normalized)
  ) return null;
  return normalized;
}

export function parseAmoraCoreCriterionResponse(value) {
  if (
    !isRecord(value)
    || !hasOnlyKeys(value, ["version", "criterion"])
    || value.version !== AMORA_CORE_CRITERION_CONTRACT_VERSION
  ) return null;

  if (value.criterion === null) {
    return { version: AMORA_CORE_CRITERION_CONTRACT_VERSION, criterion: null };
  }
  if (
    !isRecord(value.criterion)
    || !hasOnlyKeys(value.criterion, ["id", "value", "updatedAt"])
    || typeof value.criterion.id !== "string"
    || !UUID_PATTERN.test(value.criterion.id)
  ) return null;

  const criterionValue = normalizeAmoraCoreCriterionText(value.criterion.value);
  if (criterionValue !== value.criterion.value) return null;
  if (
    typeof value.criterion.updatedAt !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value.criterion.updatedAt)
    || Number.isNaN(Date.parse(value.criterion.updatedAt))
  ) return null;

  return {
    version: AMORA_CORE_CRITERION_CONTRACT_VERSION,
    criterion: {
      id: value.criterion.id.toLowerCase(),
      value: criterionValue,
      updatedAt: value.criterion.updatedAt,
    },
  };
}

export function parseAmoraCoreCriterionSaveRequest(value) {
  if (
    !isRecord(value)
    || !hasOnlyKeys(value, ["version", "expectedCriterionId", "requestId", "value"])
    || Object.keys(value).length !== 4
    || value.version !== AMORA_CORE_CRITERION_CONTRACT_VERSION
    || !(
      value.expectedCriterionId === null
      || (typeof value.expectedCriterionId === "string" && UUID_PATTERN.test(value.expectedCriterionId))
    )
    || typeof value.requestId !== "string"
    || !UUID_PATTERN.test(value.requestId)
  ) return null;

  const criterionValue = normalizeAmoraCoreCriterionText(value.value);
  if (criterionValue !== value.value) return null;
  return {
    version: AMORA_CORE_CRITERION_CONTRACT_VERSION,
    expectedCriterionId: value.expectedCriterionId?.toLowerCase() ?? null,
    requestId: value.requestId.toLowerCase(),
    value: criterionValue,
  };
}

export function buildAmoraCoreCriterionSaveRequest({
  expectedCriterionId,
  requestId,
  value,
}) {
  const criterionValue = normalizeAmoraCoreCriterionText(value);
  const candidate = {
    version: AMORA_CORE_CRITERION_CONTRACT_VERSION,
    expectedCriterionId,
    requestId,
    value: criterionValue,
  };
  return criterionValue ? parseAmoraCoreCriterionSaveRequest(candidate) : null;
}

export function parseAmoraCoreCriterionDeleteRequest(value) {
  if (
    !isRecord(value)
    || !hasOnlyKeys(value, ["version", "expectedCriterionId", "requestId"])
    || Object.keys(value).length !== 3
    || value.version !== AMORA_CORE_CRITERION_CONTRACT_VERSION
    || typeof value.expectedCriterionId !== "string"
    || !UUID_PATTERN.test(value.expectedCriterionId)
    || typeof value.requestId !== "string"
    || !UUID_PATTERN.test(value.requestId)
  ) return null;

  return {
    version: AMORA_CORE_CRITERION_CONTRACT_VERSION,
    expectedCriterionId: value.expectedCriterionId.toLowerCase(),
    requestId: value.requestId.toLowerCase(),
  };
}

export function buildAmoraCoreCriterionDeleteRequest({
  expectedCriterionId,
  requestId,
}) {
  return parseAmoraCoreCriterionDeleteRequest({
    version: AMORA_CORE_CRITERION_CONTRACT_VERSION,
    expectedCriterionId,
    requestId,
  });
}
