const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_WON_AMOUNT = 1_000_000_000;
const MAX_REVISION_BEFORE_UPDATE = Number.MAX_SAFE_INTEGER - 1;
const MAX_JSON_DEPTH = 12;
// The shared journey can legitimately hold 500 canonical schedule events.
// Keep the clone bounded while allowing their full optional field envelope.
const MAX_JSON_KEYS = 12_000;
const MAX_JSON_NODES = 20_000;
const MAX_JSON_ARRAY_LENGTH = 1_000;
const MAX_JSON_STRING_LENGTH = 10_000;
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const BUDGET_CATEGORY_KEYS = new Set([
  "meeting", "venue", "studio", "dress", "makeup", "snap", "ring", "yedan",
  "hanbok", "shoes", "bouquet", "honeymoon", "houseware", "housing",
  "invitation", "gift", "mc", "ham", "pyebaek", "reserve",
]);
const CUSTOM_BUDGET_CATEGORY_KEY = /^custom_[a-z0-9_-]{1,64}$/i;
const PAYER_TYPES = new Set([
  "couple", "bride_parents", "groom_parents", "both_parents",
]);
const MUTATION_STATUSES = new Set([
  "applied", "pending_partner", "stale", "rejected",
]);
const MAX_ACTIVE_BUDGET_REQUESTS = 20;
const UNSAFE_DISPLAY_RE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeUuid(value) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) return null;
  return value.toLowerCase();
}

function hasExactKeys(value, expectedKeys) {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value).sort();
  return keys.length === expectedKeys.length
    && keys.every((key, index) => key === expectedKeys[index]);
}

function isSafeSummary(value) {
  return typeof value === "string"
    && value.length > 0
    && Array.from(value).length <= 240
    && value === value.trim()
    && !UNSAFE_DISPLAY_RE.test(value);
}

function isTimestamp(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function isValidWonAmount(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_WON_AMOUNT;
}

function isWritableRevision(value) {
  return Number.isSafeInteger(value)
    && value >= 0
    && value <= MAX_REVISION_BEFORE_UPDATE;
}

function cloneJson(value, depth = 0, budget = { keys: 0, nodes: 0 }) {
  budget.nodes += 1;
  if (budget.nodes > MAX_JSON_NODES) throw new Error("INVALID_BUDGET_JOURNEY");
  if (depth > MAX_JSON_DEPTH) throw new Error("INVALID_BUDGET_JOURNEY");
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.length > MAX_JSON_STRING_LENGTH) throw new Error("INVALID_BUDGET_JOURNEY");
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("INVALID_BUDGET_JOURNEY");
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_JSON_ARRAY_LENGTH) throw new Error("INVALID_BUDGET_JOURNEY");
    return value.map((item) => cloneJson(item, depth + 1, budget));
  }
  if (!isRecord(value)) throw new Error("INVALID_BUDGET_JOURNEY");

  const cloned = {};
  for (const [key, item] of Object.entries(value)) {
    budget.keys += 1;
    if (
      budget.keys > MAX_JSON_KEYS
      || key.length === 0
      || key.length > 200
      || FORBIDDEN_KEYS.has(key)
    ) {
      throw new Error("INVALID_BUDGET_JOURNEY");
    }
    cloned[key] = cloneJson(item, depth + 1, budget);
  }
  return cloned;
}

function validateKnownBudgetFields(progress) {
  for (const [key, value] of Object.entries(progress)) {
    if (!isRecord(value)) {
      if (BUDGET_CATEGORY_KEYS.has(key)) {
        throw new Error("INVALID_BUDGET_JOURNEY");
      }
      continue;
    }
    if (Object.hasOwn(value, "budget") && !isValidWonAmount(value.budget)) {
      throw new Error("INVALID_BUDGET_JOURNEY");
    }
    if (Object.hasOwn(value, "spent") && !isValidWonAmount(value.spent)) {
      throw new Error("INVALID_BUDGET_JOURNEY");
    }
    if (Object.hasOwn(value, "payer") && !PAYER_TYPES.has(value.payer)) {
      throw new Error("INVALID_BUDGET_JOURNEY");
    }
    if (
      Object.hasOwn(value, "category")
      && (
        typeof value.category !== "string"
        || value.category !== key
      )
    ) {
      throw new Error("INVALID_BUDGET_JOURNEY");
    }
    if (
      Object.hasOwn(value, "label")
      && (
        typeof value.label !== "string"
        || value.label.trim().length === 0
        || Array.from(value.label).length > 200
        || UNSAFE_DISPLAY_RE.test(value.label)
      )
    ) {
      throw new Error("INVALID_BUDGET_JOURNEY");
    }
  }
}

export function parseBudgetJourney(value, expectedCoupleId) {
  const coupleId = isRecord(value) ? normalizeUuid(value.couple_id) : null;
  const normalizedExpectedCoupleId = normalizeUuid(expectedCoupleId);
  if (
    !isRecord(value)
    || !coupleId
    || !normalizedExpectedCoupleId
    || coupleId !== normalizedExpectedCoupleId
    || !isValidWonAmount(value.total_budget)
    || !isRecord(value.progress)
    || !isWritableRevision(value.state_revision)
  ) {
    throw new Error("INVALID_BUDGET_JOURNEY");
  }

  const progress = cloneJson(value.progress);
  validateKnownBudgetFields(progress);
  return {
    coupleId,
    totalBudget: value.total_budget,
    progress,
    stateRevision: value.state_revision,
  };
}

export function parseManwonInput(value) {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new Error("INVALID_MANWON_AMOUNT");
  }
  const manwon = Number(value);
  const won = manwon * 10_000;
  if (!Number.isSafeInteger(manwon) || !isValidWonAmount(won)) {
    throw new Error("INVALID_MANWON_AMOUNT");
  }
  return won;
}

function assertWritableSnapshot(snapshot) {
  if (
    !isRecord(snapshot)
    || !normalizeUuid(snapshot.coupleId)
    || !isValidWonAmount(snapshot.totalBudget)
    || !isRecord(snapshot.progress)
    || !isWritableRevision(snapshot.stateRevision)
  ) {
    throw new Error("INVALID_BUDGET_SNAPSHOT");
  }
  try {
    validateKnownBudgetFields(cloneJson(snapshot.progress));
  } catch {
    throw new Error("INVALID_BUDGET_SNAPSHOT");
  }
}

export function buildTotalBudgetMutation(snapshot, totalInput) {
  assertWritableSnapshot(snapshot);
  return {
    expected_revision: snapshot.stateRevision,
    total_budget: parseManwonInput(totalInput),
  };
}

function optionalManwonInput(value) {
  if (value === "") return undefined;
  return parseManwonInput(value);
}

export function buildCategoryBudgetMutation(snapshot, input) {
  assertWritableSnapshot(snapshot);
  const categoryKey = isRecord(input) && typeof input.categoryKey === "string"
    ? input.categoryKey
    : null;
  const existing = categoryKey === null
    ? undefined
    : snapshot.progress[categoryKey];
  const isWritableCategory = categoryKey !== null && (
    BUDGET_CATEGORY_KEYS.has(categoryKey)
    || (
      CUSTOM_BUDGET_CATEGORY_KEY.test(categoryKey)
      && Object.hasOwn(snapshot.progress, categoryKey)
      && isRecord(existing)
    )
  );
  if (
    !isRecord(input)
    || !isWritableCategory
    || typeof input.budgetInput !== "string"
    || typeof input.spentInput !== "string"
    || !PAYER_TYPES.has(input.payer)
  ) {
    throw new Error("INVALID_CATEGORY_BUDGET_INPUT");
  }

  if (existing !== undefined && !isRecord(existing)) {
    throw new Error("INVALID_BUDGET_SNAPSHOT");
  }
  const budget = optionalManwonInput(input.budgetInput);
  const spent = optionalManwonInput(input.spentInput);
  const next = {
    ...(existing ?? {}),
    category: input.categoryKey,
    ...(budget === undefined ? {} : { budget }),
    ...(spent === undefined ? {} : { spent }),
    payer: input.payer,
  };

  return {
    expected_revision: snapshot.stateRevision,
    progress_patch: { [input.categoryKey]: next },
  };
}

export function parseBudgetMutationResponse(value, expectedCoupleId, expectedRevision) {
  const requestId = isRecord(value) ? normalizeUuid(value.requestId) : null;
  if (
    !isRecord(value)
    || !requestId
    || !MUTATION_STATUSES.has(value.status)
    || !Number.isSafeInteger(value.requiredCount)
    || value.requiredCount < 1
    || value.requiredCount > 2
    || !Number.isSafeInteger(value.acceptedCount)
    || value.acceptedCount < 0
    || value.acceptedCount > value.requiredCount
    || typeof value.summary !== "string"
    || value.summary.length === 0
    || Array.from(value.summary).length > 240
    || UNSAFE_DISPLAY_RE.test(value.summary)
    || value.surface !== "/budget"
    || !isWritableRevision(expectedRevision)
  ) {
    throw new Error("INVALID_BUDGET_MUTATION_RESPONSE");
  }

  const common = {
    requestId,
    status: value.status,
    requiredCount: value.requiredCount,
    acceptedCount: value.acceptedCount,
    summary: value.summary,
    surface: "/budget",
  };

  if (value.status === "applied") {
    if (value.acceptedCount !== value.requiredCount) {
      throw new Error("INVALID_BUDGET_MUTATION_RESPONSE");
    }
    let journey;
    try {
      journey = parseBudgetJourney(value.journey, expectedCoupleId);
    } catch {
      throw new Error("INVALID_BUDGET_MUTATION_RESPONSE");
    }
    if (journey.stateRevision !== expectedRevision + 1) {
      throw new Error("INVALID_BUDGET_MUTATION_RESPONSE");
    }
    return { ...common, status: "applied", journey };
  }

  if (Object.hasOwn(value, "journey")) {
    throw new Error("INVALID_BUDGET_MUTATION_RESPONSE");
  }
  if (
    value.status === "pending_partner"
    && (value.requiredCount !== 2 || value.acceptedCount !== 1)
  ) {
    throw new Error("INVALID_BUDGET_MUTATION_RESPONSE");
  }
  return common;
}

export function parseBudgetApprovalStatusResponse(
  value,
  expectedCoupleId,
  baseRevision,
  currentRevision,
) {
  if (
    !isWritableRevision(baseRevision)
    || !isWritableRevision(currentRevision)
    || currentRevision < baseRevision
  ) {
    throw new Error("INVALID_BUDGET_APPROVAL_STATUS_RESPONSE");
  }
  if (!isRecord(value) || value.status !== "applied") {
    try {
      return parseBudgetMutationResponse(value, expectedCoupleId, baseRevision);
    } catch {
      throw new Error("INVALID_BUDGET_APPROVAL_STATUS_RESPONSE");
    }
  }

  let journey;
  try {
    journey = parseBudgetJourney(value.journey, expectedCoupleId);
  } catch {
    throw new Error("INVALID_BUDGET_APPROVAL_STATUS_RESPONSE");
  }
  const expectedObservedRevision = currentRevision === baseRevision
    ? baseRevision + 1
    : currentRevision;
  if (journey.stateRevision !== expectedObservedRevision) {
    throw new Error("INVALID_BUDGET_APPROVAL_STATUS_RESPONSE");
  }

  let strictEnvelope;
  try {
    strictEnvelope = parseBudgetMutationResponse({
      ...value,
      journey: {
        ...value.journey,
        state_revision: baseRevision + 1,
      },
    }, expectedCoupleId, baseRevision);
  } catch {
    throw new Error("INVALID_BUDGET_APPROVAL_STATUS_RESPONSE");
  }
  return { ...strictEnvelope, journey };
}

export function parseActiveBudgetApproval(
  value,
  expectedOwnerId,
  expectedCoupleId,
) {
  const ownerId = isRecord(value) ? normalizeUuid(value.ownerId) : null;
  const coupleId = isRecord(value) ? normalizeUuid(value.coupleId) : null;
  const normalizedExpectedOwnerId = normalizeUuid(expectedOwnerId);
  const normalizedExpectedCoupleId = normalizeUuid(expectedCoupleId);
  if (
    !hasExactKeys(value, ["coupleId", "ownerId", "requests", "surface"])
    || !ownerId
    || !coupleId
    || ownerId !== normalizedExpectedOwnerId
    || coupleId !== normalizedExpectedCoupleId
    || value.surface !== "/budget"
    || !Array.isArray(value.requests)
    || value.requests.length > MAX_ACTIVE_BUDGET_REQUESTS
  ) {
    throw new Error("INVALID_ACTIVE_BUDGET_APPROVAL");
  }

  const seen = new Set();
  let requester = null;
  for (const row of value.requests) {
    const requestId = isRecord(row) ? normalizeUuid(row.requestId) : null;
    if (
      !hasExactKeys(row, [
        "baseRevision",
        "createdAt",
        "requestId",
        "role",
        "summary",
      ])
      || !requestId
      || seen.has(requestId)
      || (row.role !== "requester" && row.role !== "reviewer")
      || !isWritableRevision(row.baseRevision)
      || !isSafeSummary(row.summary)
      || !isTimestamp(row.createdAt)
    ) {
      throw new Error("INVALID_ACTIVE_BUDGET_APPROVAL");
    }
    seen.add(requestId);
    if (row.role === "requester") {
      if (requester !== null) {
        throw new Error("INVALID_ACTIVE_BUDGET_APPROVAL");
      }
      requester = {
        ownerId,
        coupleId,
        surface: "/budget",
        requestId,
        baseRevision: row.baseRevision,
        summary: row.summary,
        createdAt: row.createdAt,
      };
    }
  }
  return requester;
}

export async function fetchActiveBudgetApprovalStatus({
  apiFetch,
  ownerId,
  coupleId,
  currentRevision,
}) {
  if (
    typeof apiFetch !== "function"
    || !normalizeUuid(ownerId)
    || !normalizeUuid(coupleId)
    || !isWritableRevision(currentRevision)
  ) {
    throw new Error("INVALID_ACTIVE_BUDGET_APPROVAL_CONTEXT");
  }

  const activeResponse = await apiFetch(
    "/api/couple-plan-changes/active?surface=%2Fbudget",
    { method: "GET" },
  );
  if (
    !isRecord(activeResponse)
    || activeResponse.ok !== true
    || typeof activeResponse.json !== "function"
  ) {
    throw new Error("ACTIVE_BUDGET_APPROVAL_UNAVAILABLE");
  }
  const activePayload = await activeResponse.json().catch(() => null);
  const approval = parseActiveBudgetApproval(
    activePayload,
    ownerId,
    coupleId,
  );
  if (approval === null) return null;

  const statusResponse = await apiFetch(
    `/api/couple-plan-changes/${approval.requestId}`,
    { method: "GET" },
  );
  if (
    !isRecord(statusResponse)
    || statusResponse.ok !== true
    || typeof statusResponse.json !== "function"
  ) {
    throw new Error("ACTIVE_BUDGET_APPROVAL_STATUS_UNAVAILABLE");
  }
  const statusPayload = await statusResponse.json().catch(() => null);
  const outcome = parseBudgetApprovalStatusResponse(
    statusPayload,
    approval.coupleId,
    approval.baseRevision,
    currentRevision,
  );
  if (
    outcome.requestId !== approval.requestId
    || outcome.summary !== approval.summary
  ) {
    throw new Error("ACTIVE_BUDGET_APPROVAL_STATUS_MISMATCH");
  }
  return { approval, outcome };
}

export function isPendingBudgetApprovalBoundToIdentity(pending, identity) {
  if (!isRecord(pending) || !isRecord(identity)) return false;
  const pendingOwnerId = normalizeUuid(pending.ownerId);
  const identityOwnerId = normalizeUuid(identity.ownerId);
  const pendingCoupleId = normalizeUuid(pending.coupleId);
  const identityCoupleId = normalizeUuid(identity.coupleId);
  return pendingOwnerId !== null
    && pendingOwnerId === identityOwnerId
    && pendingCoupleId !== null
    && pendingCoupleId === identityCoupleId
    && pending.surface === "/budget"
    && normalizeUuid(pending.requestId) !== null
    && isSafeSummary(pending.summary)
    && isWritableRevision(pending.expectedRevision)
    && isWritableRevision(identity.stateRevision);
}

export function isBudgetEditBaseCurrent(base, identity) {
  if (!isRecord(base) || !isRecord(identity)) return false;
  const baseOwnerId = normalizeUuid(base.ownerId);
  const identityOwnerId = normalizeUuid(identity.ownerId);
  const baseCoupleId = normalizeUuid(base.coupleId);
  const identityCoupleId = normalizeUuid(identity.coupleId);
  return baseOwnerId !== null
    && baseOwnerId === identityOwnerId
    && baseCoupleId !== null
    && baseCoupleId === identityCoupleId
    && isWritableRevision(base.stateRevision)
    && base.stateRevision === identity.stateRevision;
}

export function createBudgetRevisionCoordinator() {
  let generation = 0;
  let ownerId = null;
  let identity = null;
  let nextOperationId = 0;
  const locks = { total: null, category: null };

  function snapshotIdentity() {
    if (!identity) return null;
    return {
      generation,
      ownerId: identity.ownerId,
      coupleId: identity.coupleId,
      stateRevision: identity.stateRevision,
      totalBudget: identity.totalBudget,
      progress: cloneJson(identity.progress),
    };
  }

  function isCurrent(token) {
    return isRecord(token)
      && identity !== null
      && token.generation === generation
      && token.ownerId === identity.ownerId
      && token.coupleId === identity.coupleId
      && token.stateRevision === identity.stateRevision;
  }

  function isLoadCurrent(token) {
    return isRecord(token)
      && token.generation === generation
      && token.ownerId === ownerId;
  }

  function commitNextJourney(token, appliedJourney) {
    if (
      !isCurrent(token)
      || !isRecord(appliedJourney)
      || appliedJourney.coupleId !== token.coupleId
      || appliedJourney.stateRevision !== token.stateRevision + 1
      || !isValidWonAmount(appliedJourney.totalBudget)
      || !isRecord(appliedJourney.progress)
    ) {
      return null;
    }
    let progress;
    try {
      progress = cloneJson(appliedJourney.progress);
      validateKnownBudgetFields(progress);
    } catch {
      return null;
    }
    generation += 1;
    identity = {
      ownerId: token.ownerId,
      coupleId: appliedJourney.coupleId,
      stateRevision: appliedJourney.stateRevision,
      totalBudget: appliedJourney.totalBudget,
      progress,
    };
    return snapshotIdentity();
  }

  return {
    setOwner(nextOwnerId) {
      const normalized = nextOwnerId === null ? null : normalizeUuid(nextOwnerId);
      if (nextOwnerId !== null && !normalized) {
        throw new Error("INVALID_BUDGET_OWNER");
      }
      if (ownerId === normalized) return false;
      generation += 1;
      ownerId = normalized;
      identity = null;
      locks.total = null;
      locks.category = null;
      return true;
    },

    beginLoad(expectedOwnerId, authorizedMutationToken) {
      const normalized = normalizeUuid(expectedOwnerId);
      if (!normalized || ownerId !== normalized) return null;
      const hasActiveMutation = locks.total !== null || locks.category !== null;
      const ownsActiveMutation = isRecord(authorizedMutationToken)
        && (
          authorizedMutationToken.kind === "total"
          || authorizedMutationToken.kind === "category"
        )
        && authorizedMutationToken.ownerId === ownerId
        && locks[authorizedMutationToken.kind] === authorizedMutationToken.operationId;
      if (hasActiveMutation && !ownsActiveMutation) return null;
      generation += 1;
      identity = null;
      return { generation, ownerId: normalized };
    },

    isLoadCurrent(token) {
      return isLoadCurrent(token);
    },

    commitJourney(token, rawJourney, expectedCoupleId) {
      if (!isLoadCurrent(token)) return null;
      let parsed;
      try {
        parsed = parseBudgetJourney(
          rawJourney,
          expectedCoupleId ?? rawJourney?.couple_id,
        );
      } catch {
        return null;
      }
      if (!isLoadCurrent(token)) return null;
      identity = {
        ownerId: token.ownerId,
        coupleId: parsed.coupleId,
        stateRevision: parsed.stateRevision,
        totalBudget: parsed.totalBudget,
        progress: parsed.progress,
      };
      return snapshotIdentity();
    },

    captureIdentity() {
      return snapshotIdentity();
    },

    isCurrent,

    beginMutation(kind) {
      if (
        (kind !== "total" && kind !== "category")
        || !identity
        || locks.total !== null
        || locks.category !== null
      ) {
        return null;
      }
      nextOperationId += 1;
      locks[kind] = nextOperationId;
      return {
        ...snapshotIdentity(),
        kind,
        operationId: nextOperationId,
      };
    },

    finishMutation(token) {
      if (
        !isRecord(token)
        || (token.kind !== "total" && token.kind !== "category")
        || locks[token.kind] !== token.operationId
      ) {
        return false;
      }
      locks[token.kind] = null;
      return true;
    },

    commitApplied(token, appliedJourney) {
      return commitNextJourney(token, appliedJourney);
    },

    commitObservedApplied(token, appliedJourney, baseRevision) {
      if (locks.total !== null || locks.category !== null) return null;
      if (
        !isCurrent(token)
        || !isWritableRevision(baseRevision)
        || token.stateRevision < baseRevision
        || !isRecord(appliedJourney)
        || appliedJourney.coupleId !== token.coupleId
        || !isValidWonAmount(appliedJourney.totalBudget)
        || !isRecord(appliedJourney.progress)
      ) return null;
      try {
        validateKnownBudgetFields(cloneJson(appliedJourney.progress));
      } catch {
        return null;
      }
      if (token.stateRevision === baseRevision) {
        return commitNextJourney(token, appliedJourney);
      }
      if (appliedJourney.stateRevision !== token.stateRevision) return null;
      return snapshotIdentity();
    },
  };
}
