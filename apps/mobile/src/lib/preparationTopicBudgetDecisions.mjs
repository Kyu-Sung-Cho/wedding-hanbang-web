/* global AbortController, clearTimeout, setTimeout */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const VISIBLE_DECISION_LIMIT = 80;
const DECISION_READ_LIMIT = VISIBLE_DECISION_LIMIT + 1;
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 60_000;
const UNSAFE_DISPLAY_TEXT_RE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const CANONICAL_TOPIC_KEYS = Object.freeze([
  "meeting",
  "venue",
  "studio",
  "dress",
  "makeup",
  "ring",
  "hanbok",
  "yedan",
  "honeymoon",
  "houseware",
  "housing",
  "invitation",
  "snap",
  "shoes",
  "bouquet",
  "gift",
  "mc",
  "ham",
  "pyebaek",
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, expectedKeys) {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value).sort();
  return keys.length === expectedKeys.length
    && keys.every((key, index) => key === expectedKeys[index]);
}

function isSafeRevision(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function stableJsonValue(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (!isRecord(value)) return undefined;
  const result = {};
  for (const key of Object.keys(value).sort()) {
    const normalized = stableJsonValue(value[key]);
    if (normalized !== undefined) result[key] = normalized;
  }
  return result;
}

function hasExactSnapshot(left, right) {
  return JSON.stringify(stableJsonValue(left)) === JSON.stringify(stableJsonValue(right));
}

function isSafeSummary(value) {
  return typeof value === "string"
    && value.trim() === value
    && value.length > 0
    && Array.from(value).length <= 240
    && !UNSAFE_DISPLAY_TEXT_RE.test(value);
}

export class PreparationTopicBudgetDecisionError extends Error {
  constructor(code) {
    super(code);
    this.name = "PreparationTopicBudgetDecisionError";
    this.code = code;
  }
}

function assertCurrent(isCurrent) {
  if (!isCurrent()) {
    throw new PreparationTopicBudgetDecisionError("stale_context");
  }
}

function isAbortSignal(value) {
  return value !== null
    && typeof value === "object"
    && typeof value.aborted === "boolean"
    && typeof value.addEventListener === "function"
    && typeof value.removeEventListener === "function";
}

async function runBoundedRead(operation, options) {
  const {
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    isCurrent,
  } = options;
  if (
    (signal !== undefined && !isAbortSignal(signal))
    || !Number.isSafeInteger(timeoutMs)
    || timeoutMs < 1
    || timeoutMs > MAX_TIMEOUT_MS
  ) {
    throw new PreparationTopicBudgetDecisionError("invalid_request");
  }
  assertCurrent(isCurrent);
  const controller = new AbortController();
  if (signal?.aborted) {
    controller.abort();
    assertCurrent(isCurrent);
    throw new PreparationTopicBudgetDecisionError("cancelled");
  }

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
  const operationPromise = Promise.resolve().then(
    () => operation(controller.signal),
  ).then(
    (value) => ({ kind: "value", value }),
    (error) => ({ kind: "error", error }),
  );

  try {
    const outcome = await Promise.race([
      operationPromise,
      timeoutPromise,
      ...(cancellationPromise ? [cancellationPromise] : []),
    ]);
    if (outcome === timeoutOutcome) {
      throw new PreparationTopicBudgetDecisionError("timeout");
    }
    if (outcome === cancelledOutcome) {
      assertCurrent(isCurrent);
      throw new PreparationTopicBudgetDecisionError("cancelled");
    }
    assertCurrent(isCurrent);
    if (outcome.kind === "error") {
      if (outcome.error instanceof PreparationTopicBudgetDecisionError) {
        throw outcome.error;
      }
      throw new PreparationTopicBudgetDecisionError("read_failed");
    }
    return outcome.value;
  } finally {
    clearTimeout(timeoutHandle);
    if (signal && cancelForCaller) {
      signal.removeEventListener("abort", cancelForCaller);
    }
  }
}

function decisionTouchesTopic(decision, topicKey) {
  if (
    !isRecord(decision)
    || !isRecord(decision.chosen_value)
    || !isRecord(decision.chosen_value.changes)
    || !isRecord(decision.chosen_value.changes.progress_patch)
  ) return false;
  return Object.hasOwn(decision.chosen_value.changes.progress_patch, topicKey);
}

function selectLatestTouchingDecision(rows, topicKey) {
  const touching = rows.filter((row) => decisionTouchesTopic(row, topicKey));
  if (touching.length === 0) return Object.freeze({ kind: "none" });
  if (touching.some((row) => !isSafeRevision(row.chosen_value.appliedRevision))) {
    return Object.freeze({ kind: "invalid" });
  }
  touching.sort((left, right) => (
    right.chosen_value.appliedRevision - left.chosen_value.appliedRevision
  ));
  if (
    touching.length > 1
    && touching[0].chosen_value.appliedRevision
      === touching[1].chosen_value.appliedRevision
  ) return Object.freeze({ kind: "invalid" });
  return Object.freeze({ kind: "selected", decision: touching[0] });
}

function readCurrentTopicSnapshots(progress) {
  const snapshots = new Map();
  for (const topicKey of CANONICAL_TOPIC_KEYS) {
    const snapshot = progress[topicKey];
    if (isRecord(snapshot) && snapshot.category === topicKey) {
      snapshots.set(topicKey, snapshot);
    }
  }
  return snapshots;
}

function readReceiptAcceptanceTimes(value, requiredCount, decidedMs) {
  if (!Array.isArray(value) || value.length !== requiredCount) return null;
  const userIds = new Set();
  const acceptedTimes = new Set();
  for (const acceptance of value) {
    const userId = isRecord(acceptance) && typeof acceptance.userId === "string"
      ? acceptance.userId.toLowerCase()
      : "";
    const acceptedMs = isRecord(acceptance)
      ? Date.parse(String(acceptance.acceptedAt ?? ""))
      : NaN;
    if (
      !hasExactKeys(acceptance, ["acceptedAt", "userId"])
      || !UUID_RE.test(userId)
      || userIds.has(userId)
      || !Number.isFinite(acceptedMs)
      || acceptedMs > decidedMs
    ) return null;
    userIds.add(userId);
    acceptedTimes.add(new Date(acceptedMs).toISOString());
  }
  return acceptedTimes;
}

function readExactStatusTarget(
  decision,
  expectedTopicKey,
  coupleId,
  currentJourneyRevision,
  progress,
) {
  if (!isRecord(decision) || !isRecord(decision.chosen_value) || !isRecord(decision.metadata)) {
    return null;
  }
  const chosen = decision.chosen_value;
  const metadata = decision.metadata;
  const changes = chosen.changes;
  if (
    !hasExactKeys(chosen, [
      "acceptances",
      "after",
      "appliedRevision",
      "before",
      "changeDigest",
      "changes",
      "eventId",
      "expectedRevision",
      "mutationKind",
      "requestId",
      "requiredCount",
      "schemaVersion",
    ])
    || !hasExactKeys(metadata, [
      "acceptances",
      "after",
      "appliedRevision",
      "before",
      "changeDigest",
      "eventId",
      "expectedRevision",
      "mutationKind",
      "origin",
      "previousStatus",
      "requestId",
      "requiredCount",
      "rosterFingerprint",
      "surfaceHref",
    ])
    || !isRecord(changes)
    || !hasExactKeys(changes, ["progress_patch"])
  ) return null;
  const progressPatch = changes.progress_patch;
  if (!isRecord(progressPatch)) return null;
  const topicKeys = Object.keys(progressPatch);
  if (topicKeys.length !== 1) return null;
  const topicKey = topicKeys[0];
  const topicSnapshot = progressPatch[topicKey];
  const requestId = typeof decision.source_ref_id === "string"
    ? decision.source_ref_id.toLowerCase()
    : "";
  const decisionId = typeof decision.id === "string" ? decision.id.toLowerCase() : "";
  const confirmedMs = Date.parse(String(decision.user_confirmed_at ?? ""));
  const decidedMs = Date.parse(String(decision.decided_at ?? ""));
  const requiredCount = chosen.requiredCount;
  const acceptedTimes = readReceiptAcceptanceTimes(
    chosen.acceptances,
    requiredCount,
    decidedMs,
  );
  if (
    !Object.hasOwn(progress, topicKey)
    || topicKey !== expectedTopicKey
    || !isRecord(topicSnapshot)
    || !hasExactSnapshot(topicSnapshot, progress[topicKey])
    || !UUID_RE.test(decisionId)
    || !UUID_RE.test(requestId)
    || decision.couple_id !== coupleId
    || decision.category !== "budget"
    || decision.decision_type !== "decided"
    || decision.source !== "manual"
    || decision.visibility !== "shared"
    || decision.source_actor_role !== "bride" && decision.source_actor_role !== "groom"
    || decision.source_message_id !== null
    || decision.memory_key !== null
    || decision.superseded_at !== null
    || decision.superseded_by !== null
    || !isSafeSummary(decision.title)
    || !Number.isFinite(confirmedMs)
    || !Number.isFinite(decidedMs)
    || confirmedMs > decidedMs
    || !acceptedTimes
    || !acceptedTimes.has(new Date(confirmedMs).toISOString())
    || chosen.schemaVersion !== 1
    || chosen.requestId !== requestId
    || !/^[a-f0-9]{64}$/u.test(String(chosen.changeDigest ?? ""))
    || !isSafeRevision(chosen.expectedRevision)
    || chosen.appliedRevision !== chosen.expectedRevision + 1
    || chosen.appliedRevision > currentJourneyRevision
    || requiredCount !== 1 && requiredCount !== 2
    || chosen.mutationKind !== null
    || chosen.eventId !== null
    || chosen.before !== null
    || chosen.after !== null
    || metadata.origin !== "couple_plan_change_request"
    || metadata.requestId !== requestId
    || metadata.changeDigest !== chosen.changeDigest
    || !/^[a-f0-9]{32}$/u.test(String(metadata.rosterFingerprint ?? ""))
    || metadata.expectedRevision !== chosen.expectedRevision
    || metadata.appliedRevision !== chosen.appliedRevision
    || metadata.requiredCount !== requiredCount
    || !hasExactSnapshot(metadata.acceptances, chosen.acceptances)
    || metadata.mutationKind !== null
    || metadata.eventId !== null
    || metadata.before !== null
    || metadata.after !== null
    || metadata.surfaceHref !== "/budget"
    || metadata.previousStatus !== "applying"
  ) return null;
  return Object.freeze({ requestId, topicKey, topicSnapshot });
}

function sanitizeVerification(
  payload,
  decision,
  target,
  coupleId,
  currentJourneyRevision,
  progress,
) {
  const journey = isRecord(payload) ? payload.journey : null;
  if (
    !hasExactKeys(payload, [
      "acceptedCount",
      "journey",
      "requestId",
      "requiredCount",
      "status",
      "summary",
      "surface",
    ])
    || !isRecord(journey)
    || payload.requestId !== target.requestId
    || payload.status !== "applied"
    || !Number.isSafeInteger(payload.requiredCount)
    || payload.requiredCount < 1
    || payload.requiredCount > 2
    || payload.requiredCount !== decision.chosen_value.requiredCount
    || payload.requiredCount !== decision.metadata.requiredCount
    || payload.acceptedCount !== payload.requiredCount
    || payload.summary !== decision.title
    || !isSafeSummary(payload.summary)
    || payload.surface !== "/budget"
    || journey.couple_id !== coupleId
    || journey.state_revision !== currentJourneyRevision
    || !isRecord(journey.progress)
    || !Object.hasOwn(journey.progress, target.topicKey)
    || !hasExactSnapshot(journey.progress[target.topicKey], target.topicSnapshot)
    || !hasExactSnapshot(journey.progress[target.topicKey], progress[target.topicKey])
  ) {
    throw new PreparationTopicBudgetDecisionError("invalid_response");
  }
  return Object.freeze({
    requestId: target.requestId,
    status: "applied",
    requiredCount: payload.requiredCount,
    acceptedCount: payload.acceptedCount,
    summary: payload.summary,
    surface: "/budget",
    journey: Object.freeze({
      coupleId,
      stateRevision: currentJourneyRevision,
      topicKey: target.topicKey,
      topicSnapshot: target.topicSnapshot,
    }),
  });
}

async function readJsonResponse(response, isCurrent) {
  if (!isRecord(response) || response.ok !== true || typeof response.json !== "function") {
    throw new PreparationTopicBudgetDecisionError("read_failed");
  }
  assertCurrent(isCurrent);
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new PreparationTopicBudgetDecisionError("invalid_response");
  }
  assertCurrent(isCurrent);
  return payload;
}

export async function loadPreparationTopicBudgetDecisions(options) {
  const {
    ownerId,
    coupleId,
    currentJourneyRevision,
    progress,
    isCurrent,
    apiFetch,
    readDecisionRows,
    signal,
    timeoutMs,
  } = options ?? {};
  const normalizedOwnerId = typeof ownerId === "string" ? ownerId.toLowerCase() : "";
  const normalizedCoupleId = typeof coupleId === "string" ? coupleId.toLowerCase() : "";
  if (
    !UUID_RE.test(normalizedOwnerId)
    || !UUID_RE.test(normalizedCoupleId)
    || !isSafeRevision(currentJourneyRevision)
    || !isRecord(progress)
    || typeof isCurrent !== "function"
    || typeof apiFetch !== "function"
    || typeof readDecisionRows !== "function"
  ) {
    throw new PreparationTopicBudgetDecisionError("invalid_request");
  }

  return runBoundedRead(async (requestSignal) => {
    const baseRequest = {
      ownerId: normalizedOwnerId,
      coupleId: normalizedCoupleId,
      currentJourneyRevision,
      signal: requestSignal,
    };
    assertCurrent(isCurrent);
    const decisionRows = await readDecisionRows({
      ...baseRequest,
      limit: DECISION_READ_LIMIT,
    });
    assertCurrent(isCurrent);
    if (!Array.isArray(decisionRows) || decisionRows.length > DECISION_READ_LIMIT) {
      throw new PreparationTopicBudgetDecisionError("invalid_response");
    }
    const topicSnapshots = readCurrentTopicSnapshots(progress);
    let partial = decisionRows.length > VISIBLE_DECISION_LIMIT;
    const selectedTargets = [];
    for (const topicKey of CANONICAL_TOPIC_KEYS) {
      if (!topicSnapshots.has(topicKey)) continue;
      const selected = selectLatestTouchingDecision(decisionRows, topicKey);
      if (selected.kind === "none") continue;
      if (selected.kind === "invalid") {
        partial = true;
        continue;
      }
      const target = readExactStatusTarget(
        selected.decision,
        topicKey,
        normalizedCoupleId,
        currentJourneyRevision,
        progress,
      );
      if (!target) {
        partial = true;
        continue;
      }
      selectedTargets.push(Object.freeze({
        decision: selected.decision,
        target,
      }));
    }

    const requestCounts = new Map();
    for (const selected of selectedTargets) {
      requestCounts.set(
        selected.target.requestId,
        (requestCounts.get(selected.target.requestId) ?? 0) + 1,
      );
    }
    const uniqueTargets = selectedTargets.filter(
      (selected) => requestCounts.get(selected.target.requestId) === 1,
    );
    if (uniqueTargets.length !== selectedTargets.length) partial = true;
    if (uniqueTargets.length === 0) {
      return Object.freeze({
        budgetDecisionReceipts: Object.freeze([]),
        budgetDecisionVerifications: Object.freeze([]),
        partial,
      });
    }

    const outcomes = await Promise.all(uniqueTargets.map(async (selected) => {
      try {
        assertCurrent(isCurrent);
        const response = await apiFetch(
          `/api/couple-plan-changes/${encodeURIComponent(selected.target.requestId)}`,
          { method: "GET", signal: requestSignal },
        );
        assertCurrent(isCurrent);
        const payload = await readJsonResponse(response, isCurrent);
        const verification = sanitizeVerification(
          payload,
          selected.decision,
          selected.target,
          normalizedCoupleId,
          currentJourneyRevision,
          progress,
        );
        return Object.freeze({
          kind: "verified",
          decision: selected.decision,
          verification,
        });
      } catch (error) {
        if (
          error instanceof PreparationTopicBudgetDecisionError
          && error.code === "stale_context"
        ) throw error;
        return Object.freeze({
          kind: "failed",
          error: error instanceof PreparationTopicBudgetDecisionError
            ? error
            : new PreparationTopicBudgetDecisionError("read_failed"),
        });
      }
    }));
    assertCurrent(isCurrent);
    const verified = outcomes.filter((outcome) => outcome.kind === "verified");
    const failures = outcomes.filter((outcome) => outcome.kind === "failed");
    if (verified.length === 0 && failures.length > 0) {
      const allTransportFailures = failures.every(
        (outcome) => outcome.error.code === "read_failed",
      );
      if (allTransportFailures) {
        throw new PreparationTopicBudgetDecisionError("read_failed");
      }
      if (failures.every((outcome) => outcome.error.code === "invalid_response")) {
        throw new PreparationTopicBudgetDecisionError("invalid_response");
      }
    }
    if (failures.length > 0) partial = true;
    return Object.freeze({
      budgetDecisionReceipts: Object.freeze(
        verified.map((outcome) => outcome.decision),
      ),
      budgetDecisionVerifications: Object.freeze(
        verified.map((outcome) => outcome.verification),
      ),
      partial,
    });
  }, { signal, timeoutMs, isCurrent });
}
