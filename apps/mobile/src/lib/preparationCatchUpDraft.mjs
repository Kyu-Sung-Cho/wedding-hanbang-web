import { buildAmoraPreparationCatchUpPreview } from "@hanbang/shared/amora-preparation-catch-up";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PURPOSE = "hanbang:preparation-catch-up-draft:v1";
const KEY_PREFIX = "hb.preparation-catch-up.v1.";
const RECORD_KEYS = Object.freeze([
  "createdAtMs",
  "expiresAtMs",
  "items",
  "phase",
  "requestId",
  "requestLocked",
  "version",
]);
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_TIMEOUT_MS = 1_000;

function normalizeUuid(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return UUID_PATTERN.test(normalized) ? normalized : null;
}

function exactKeys(value, expected) {
  return Object.keys(value).sort().join(",") === [...expected].sort().join(",");
}

function normalizePositiveInteger(value, fallback, maximum) {
  return Number.isSafeInteger(value) && value > 0
    ? Math.min(value, maximum)
    : fallback;
}

function settle(operation, timeoutMs) {
  return new Promise((resolve) => {
    let finished = false;
    const done = (result) => {
      if (finished) return;
      finished = true;
      globalThis.clearTimeout(timeout);
      resolve(result);
    };
    const timeout = globalThis.setTimeout(
      () => done({ status: "timeout" }),
      timeoutMs,
    );
    Promise.resolve().then(operation).then(
      (value) => done({ status: "fulfilled", value }),
      () => done({ status: "rejected" }),
    );
  });
}

function normalizeDraft(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  if (value.phase !== "edit" && value.phase !== "preview") return null;
  if (typeof value.requestLocked !== "boolean") return null;
  const preview = buildAmoraPreparationCatchUpPreview({ version: 1, items: value.items });
  if (!preview) return null;
  const requestId = value.requestId === null ? null : normalizeUuid(value.requestId);
  if (
    (value.phase === "edit" && (requestId !== null || value.requestLocked))
    || (value.phase === "preview" && requestId === null)
    || (value.requestLocked && value.phase !== "preview")
  ) return null;
  return Object.freeze({
    phase: value.phase,
    requestId,
    requestLocked: value.requestLocked,
    items: Object.freeze(preview.operation.items.map((item) => Object.freeze({
      topicKey: item.topicKey,
      state: item.state,
      scope: item.scope,
    }))),
  });
}

export function preparationCatchUpDraftDigestInput(ownerUserId) {
  const owner = normalizeUuid(ownerUserId);
  return owner ? `${PURPOSE}\u0000${owner}` : null;
}

export function preparationCatchUpDraftPersistentKey(digest) {
  return typeof digest === "string" && /^[0-9a-f]{64}$/u.test(digest)
    ? `${KEY_PREFIX}${digest}`
    : null;
}

export function createPreparationCatchUpDraftRecord(input) {
  if (!preparationCatchUpDraftDigestInput(input?.ownerUserId)) {
    throw new Error("PREPARATION_CATCH_UP_DRAFT_OWNER_INVALID");
  }
  const draft = normalizeDraft(input);
  const nowMs = input?.nowMs;
  const ttlMs = normalizePositiveInteger(input?.ttlMs, DEFAULT_TTL_MS, 7 * DEFAULT_TTL_MS);
  if (!draft || !Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new Error("PREPARATION_CATCH_UP_DRAFT_RECORD_INVALID");
  }
  return JSON.stringify({
    version: 1,
    phase: draft.phase,
    requestId: draft.requestId,
    requestLocked: draft.requestLocked,
    items: draft.items,
    createdAtMs: nowMs,
    expiresAtMs: nowMs + ttlMs,
  });
}

export function parsePreparationCatchUpDraftRecord(raw, expected) {
  if (
    !preparationCatchUpDraftDigestInput(expected?.ownerUserId)
    || !Number.isSafeInteger(expected?.nowMs)
    || expected.nowMs < 0
    || typeof raw !== "string"
    || raw.length === 0
    || raw.length > 4_096
  ) return null;
  try {
    const value = JSON.parse(raw);
    if (
      value === null
      || typeof value !== "object"
      || Array.isArray(value)
      || !exactKeys(value, RECORD_KEYS)
      || value.version !== 1
      || !Number.isSafeInteger(value.createdAtMs)
      || !Number.isSafeInteger(value.expiresAtMs)
      || value.createdAtMs < 0
      || value.expiresAtMs <= value.createdAtMs
      || value.expiresAtMs - value.createdAtMs > 7 * DEFAULT_TTL_MS
      || expected.nowMs < value.createdAtMs
      || expected.nowMs >= value.expiresAtMs
    ) return null;
    return normalizeDraft(value);
  } catch {
    return null;
  }
}

export function createPreparationCatchUpDraftRuntime(adapters, options = {}) {
  const timeoutMs = normalizePositiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 5_000);
  const ttlMs = normalizePositiveInteger(options.ttlMs, DEFAULT_TTL_MS, 7 * DEFAULT_TTL_MS);
  const now = typeof options.now === "function" ? options.now : () => Date.now();

  async function keyFor(owner) {
    const digestInput = preparationCatchUpDraftDigestInput(owner?.ownerUserId);
    if (!digestInput) return null;
    const digest = await settle(() => adapters.digestSha256(digestInput), timeoutMs);
    return digest.status === "fulfilled"
      ? preparationCatchUpDraftPersistentKey(digest.value)
      : null;
  }

  return {
    async stage(input) {
      const key = await keyFor(input);
      if (!key) throw new Error("PREPARATION_CATCH_UP_DRAFT_OWNER_INVALID");
      const record = createPreparationCatchUpDraftRecord({
        ...input,
        nowMs: now(),
        ttlMs,
      });
      const outcome = await settle(() => adapters.writeSecure(key, record), timeoutMs);
      if (outcome.status !== "fulfilled") {
        throw new Error("PREPARATION_CATCH_UP_DRAFT_WRITE_FAILED");
      }
    },

    async read(owner) {
      const key = await keyFor(owner);
      if (!key) return null;
      const outcome = await settle(() => adapters.readSecure(key), timeoutMs);
      if (outcome.status !== "fulfilled") return null;
      const draft = parsePreparationCatchUpDraftRecord(outcome.value, {
        ...owner,
        nowMs: now(),
      });
      if (!draft && outcome.value !== null) {
        await settle(() => adapters.deleteSecure(key), timeoutMs);
      }
      return draft;
    },

    async clear(owner) {
      const key = await keyFor(owner);
      if (!key) return false;
      const outcome = await settle(() => adapters.deleteSecure(key), timeoutMs);
      return outcome.status === "fulfilled";
    },
  };
}
