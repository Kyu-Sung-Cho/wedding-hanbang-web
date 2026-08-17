const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const STAGES = new Set(["starting", "already_preparing", "unknown", "later"]);
const PURPOSE = "hanbang:planning-foundation-draft:v1";
const KEY_PREFIX = "hb.planning-foundation.v1.";
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_TIMEOUT_MS = 1_000;

function normalizeUuid(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return UUID_PATTERN.test(normalized) ? normalized : null;
}

function normalizeStage(value) {
  return typeof value === "string" && STAGES.has(value) ? value : null;
}

function normalizePositiveInteger(value, fallback, maximum) {
  return Number.isSafeInteger(value) && value > 0
    ? Math.min(value, maximum)
    : fallback;
}

function exactKeys(value, expected) {
  return Object.keys(value).sort().join(",") === [...expected].sort().join(",");
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
    Promise.resolve()
      .then(operation)
      .then(
        (value) => done({ status: "fulfilled", value }),
        () => done({ status: "rejected" }),
      );
  });
}

export function planningFoundationDraftHandoffDigestInput(ownerUserId, coupleId) {
  const owner = normalizeUuid(ownerUserId);
  const couple = normalizeUuid(coupleId);
  return owner && couple ? `${PURPOSE}\u0000${owner}\u0000${couple}` : null;
}

export function planningFoundationDraftHandoffPersistentKey(digest) {
  return typeof digest === "string" && /^[0-9a-f]{64}$/u.test(digest)
    ? `${KEY_PREFIX}${digest}`
    : null;
}

export function createPlanningFoundationDraftHandoffRecord(input) {
  const owner = normalizeUuid(input?.ownerUserId);
  const couple = normalizeUuid(input?.coupleId);
  const stage = normalizeStage(input?.stage);
  const nowMs = input?.nowMs;
  const ttlMs = normalizePositiveInteger(input?.ttlMs, DEFAULT_TTL_MS, 7 * DEFAULT_TTL_MS);
  if (!owner || !couple || !stage || !Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new Error("PLANNING_FOUNDATION_DRAFT_RECORD_INVALID");
  }
  return JSON.stringify({
    version: 1,
    stage,
    createdAtMs: nowMs,
    expiresAtMs: nowMs + ttlMs,
  });
}

export function parsePlanningFoundationDraftHandoffRecord(raw, expected) {
  if (
    !planningFoundationDraftHandoffDigestInput(
      expected?.ownerUserId,
      expected?.coupleId,
    )
    || typeof expected?.nowMs !== "number"
    || !Number.isSafeInteger(expected.nowMs)
    || expected.nowMs < 0
    || typeof raw !== "string"
    || raw.length === 0
    || raw.length > 256
  ) return null;
  try {
    const value = JSON.parse(raw);
    if (
      value === null
      || typeof value !== "object"
      || Array.isArray(value)
      || !exactKeys(value, ["version", "stage", "createdAtMs", "expiresAtMs"])
      || value.version !== 1
      || !normalizeStage(value.stage)
      || !Number.isSafeInteger(value.createdAtMs)
      || !Number.isSafeInteger(value.expiresAtMs)
      || value.createdAtMs < 0
      || value.expiresAtMs <= value.createdAtMs
      || value.expiresAtMs - value.createdAtMs > 7 * DEFAULT_TTL_MS
      || expected.nowMs < value.createdAtMs
      || expected.nowMs >= value.expiresAtMs
    ) return null;
    return value.stage;
  } catch {
    return null;
  }
}

export function createPlanningFoundationDraftHandoffRuntime(adapters, options = {}) {
  const timeoutMs = normalizePositiveInteger(
    options.timeoutMs,
    DEFAULT_TIMEOUT_MS,
    5_000,
  );
  const ttlMs = normalizePositiveInteger(options.ttlMs, DEFAULT_TTL_MS, 7 * DEFAULT_TTL_MS);
  const now = typeof options.now === "function" ? options.now : () => Date.now();

  async function keyFor(owner) {
    const digestInput = planningFoundationDraftHandoffDigestInput(
      owner?.ownerUserId,
      owner?.coupleId,
    );
    if (!digestInput) return null;
    const digest = await settle(() => adapters.digestSha256(digestInput), timeoutMs);
    return digest.status === "fulfilled"
      ? planningFoundationDraftHandoffPersistentKey(digest.value)
      : null;
  }

  return {
    async stage(input) {
      const key = await keyFor(input);
      if (!key) throw new Error("PLANNING_FOUNDATION_DRAFT_OWNER_INVALID");
      const record = createPlanningFoundationDraftHandoffRecord({
        ...input,
        nowMs: now(),
        ttlMs,
      });
      const outcome = await settle(() => adapters.writeSecure(key, record), timeoutMs);
      if (outcome.status !== "fulfilled") {
        throw new Error("PLANNING_FOUNDATION_DRAFT_WRITE_FAILED");
      }
    },

    async read(owner) {
      const key = await keyFor(owner);
      if (!key) return null;
      const outcome = await settle(() => adapters.readSecure(key), timeoutMs);
      if (outcome.status !== "fulfilled") return null;
      const stage = parsePlanningFoundationDraftHandoffRecord(outcome.value, {
        ...owner,
        nowMs: now(),
      });
      if (!stage && outcome.value !== null) {
        await settle(() => adapters.deleteSecure(key), timeoutMs);
      }
      return stage;
    },

    async clear(owner) {
      const key = await keyFor(owner);
      if (!key) return false;
      const outcome = await settle(() => adapters.deleteSecure(key), timeoutMs);
      return outcome.status === "fulfilled";
    },
  };
}
