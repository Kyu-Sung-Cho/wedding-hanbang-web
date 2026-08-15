const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PERSISTENT_KEY_PREFIX = "hb.opaque.v1.";
const PURPOSE = "hanbang:opaque:v1";
const DEFAULT_STORE_TIMEOUT_MS = 1_000;

function normalizeId(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return UUID_RE.test(normalized) ? normalized : null;
}

export function privateMediationSafetyHoldProcessKey(ownerUserId, coupleId) {
  const owner = normalizeId(ownerUserId);
  const couple = normalizeId(coupleId);
  return owner && couple ? `${owner}:${couple}` : null;
}

export function privateMediationSafetyHoldDigestInput(ownerUserId, coupleId) {
  const owner = normalizeId(ownerUserId);
  const couple = normalizeId(coupleId);
  return owner && couple ? `${PURPOSE}\u0000${owner}\u0000${couple}` : null;
}

export function privateMediationSafetyHoldPersistentKey(digest) {
  return typeof digest === "string" && /^[0-9a-f]{64}$/u.test(digest)
    ? `${PERSISTENT_KEY_PREFIX}${digest}`
    : null;
}

export function createPrivateMediationSafetyHoldRecord(input) {
  if (!privateMediationSafetyHoldProcessKey(input?.ownerUserId, input?.coupleId)) {
    throw new Error("PRIVATE_MEDIATION_SAFETY_HOLD_OWNER_INVALID");
  }
  return JSON.stringify({ version: 1, active: true });
}

export function classifyPrivateMediationSafetyHoldRecord(raw, expected) {
  if (raw === null) return "missing";
  if (expected && !privateMediationSafetyHoldProcessKey(
    expected.ownerUserId,
    expected.coupleId,
  )) return "invalid";
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 128) return "invalid";
  try {
    const value = JSON.parse(raw);
    return value !== null
      && typeof value === "object"
      && !Array.isArray(value)
      && Object.keys(value).sort().join(",") === "active,version"
      && value.version === 1
      && value.active === true
      ? "active"
      : "invalid";
  } catch {
    return "invalid";
  }
}

export function parsePrivateMediationSafetyHoldRecord(raw, expected) {
  return classifyPrivateMediationSafetyHoldRecord(raw, expected) === "active";
}

export function shouldSuppressForPrivateMediationSafetyHold(raw, expected) {
  return classifyPrivateMediationSafetyHoldRecord(raw, expected) !== "missing";
}

function storeTimeoutMs(options) {
  const requested = options?.timeoutMs;
  return Number.isFinite(requested) && requested > 0
    ? Math.min(5_000, Math.max(1, Math.floor(requested)))
    : DEFAULT_STORE_TIMEOUT_MS;
}

function settleStoreOperation(operation, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (outcome) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timeout);
      resolve(outcome);
    };
    const timeout = globalThis.setTimeout(
      () => finish({ status: "timeout" }),
      timeoutMs,
    );
    Promise.resolve()
      .then(operation)
      .then(
        (value) => finish({ status: "fulfilled", value }),
        () => finish({ status: "rejected" }),
      );
  });
}

export async function persistPrivateMediationSafetyHoldRecord(record, writers, options = {}) {
  if (typeof record !== "string" || record.length === 0 || !Array.isArray(writers) || writers.length === 0) {
    return false;
  }
  const timeoutMs = storeTimeoutMs(options);
  const outcomes = writers.map((write) => settleStoreOperation(
    () => write(record),
    timeoutMs,
  ));
  return new Promise((resolve) => {
    let remaining = outcomes.length;
    let resolved = false;
    for (const outcome of outcomes) {
      void outcome.then((result) => {
        if (resolved) return;
        if (result.status === "fulfilled") {
          resolved = true;
          resolve(true);
          return;
        }
        remaining -= 1;
        if (remaining === 0) {
          resolved = true;
          resolve(false);
        }
      });
    }
  });
}

export async function readPrivateMediationSafetyHoldStores(expected, readers, options = {}) {
  if (!privateMediationSafetyHoldProcessKey(expected?.ownerUserId, expected?.coupleId)) return true;
  if (!Array.isArray(readers) || readers.length === 0) return true;
  const timeoutMs = storeTimeoutMs(options);
  const outcomes = readers.map((read) => settleStoreOperation(read, timeoutMs));
  return new Promise((resolve) => {
    let remaining = outcomes.length;
    let resolved = false;
    for (const outcome of outcomes) {
      void outcome.then((result) => {
        if (resolved) return;
        if (
          result.status !== "fulfilled"
          || shouldSuppressForPrivateMediationSafetyHold(result.value, expected)
        ) {
          resolved = true;
          resolve(true);
          return;
        }
        remaining -= 1;
        if (remaining === 0) {
          resolved = true;
          resolve(false);
        }
      });
    }
  });
}

/**
 * Owns the process latch and both opaque device journals behind a small,
 * injectable boundary. The Expo adapter uses this exact orchestrator in
 * production; node tests provide deterministic digest and storage adapters.
 */
export function createPrivateMediationSafetyHoldRuntime(adapters, options = {}) {
  const activeProcessHolds = new Set();
  const timeoutMs = storeTimeoutMs(options);

  async function persistentKeyFor(owner) {
    const digestInput = privateMediationSafetyHoldDigestInput(
      owner?.ownerUserId,
      owner?.coupleId,
    );
    if (!digestInput) return { status: "owner_invalid" };
    const digest = await settleStoreOperation(
      () => adapters.digestSha256(digestInput),
      timeoutMs,
    );
    if (digest.status !== "fulfilled") return { status: "digest_failed" };
    const key = privateMediationSafetyHoldPersistentKey(digest.value);
    return key ? { status: "ready", key } : { status: "digest_invalid" };
  }

  return {
    async seal(owner) {
      const processKey = privateMediationSafetyHoldProcessKey(
        owner?.ownerUserId,
        owner?.coupleId,
      );
      if (!processKey) {
        throw new Error("PRIVATE_MEDIATION_SAFETY_HOLD_OWNER_INVALID");
      }

      // Fail closed synchronously. Even a digest timeout or two failed device
      // writes cannot expose this owner's optional private follow-up again in
      // the current process.
      activeProcessHolds.add(processKey);
      const persistent = await persistentKeyFor(owner);
      if (persistent.status !== "ready") {
        throw new Error(
          persistent.status === "digest_invalid"
            ? "PRIVATE_MEDIATION_SAFETY_HOLD_DIGEST_INVALID"
            : "PRIVATE_MEDIATION_SAFETY_HOLD_DIGEST_FAILED",
        );
      }
      const record = createPrivateMediationSafetyHoldRecord(owner);
      const persisted = await persistPrivateMediationSafetyHoldRecord(record, [
        (value) => adapters.writeSecure(persistent.key, value),
        (value) => adapters.writeJournal(persistent.key, value),
      ], { timeoutMs });
      if (!persisted) {
        throw new Error("PRIVATE_MEDIATION_SAFETY_HOLD_WRITE_FAILED");
      }
    },

    async has(owner) {
      const processKey = privateMediationSafetyHoldProcessKey(
        owner?.ownerUserId,
        owner?.coupleId,
      );
      if (!processKey) return true;
      if (activeProcessHolds.has(processKey)) return true;
      try {
        const persistent = await persistentKeyFor(owner);
        if (persistent.status !== "ready") return true;
        return await readPrivateMediationSafetyHoldStores(owner, [
          () => adapters.readSecure(persistent.key),
          () => adapters.readJournal(persistent.key),
        ], { timeoutMs });
      } catch {
        return true;
      }
    },
  };
}
