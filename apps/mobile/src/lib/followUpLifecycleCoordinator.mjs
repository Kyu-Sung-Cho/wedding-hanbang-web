function normalizedExpectedId(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function sameContext(left, right) {
  return left !== null
    && right !== null
    && left.ownerUserId === right.ownerUserId
    && left.coupleId === right.coupleId
    && left.sessionGeneration === right.sessionGeneration;
}

/**
 * Shared owner/couple lifecycle fence for optional dashboard follow-ups.
 * Network details stay in each feature, while every asynchronous boundary is
 * checked against one abortable, ABA-safe operation token.
 */
export function createFollowUpLifecycleCoordinator() {
  let expectedOwnerUserId = null;
  let expectedCoupleId = null;
  let authenticatedUserId = null;
  let sessionGeneration = 0;
  let operationGeneration = 0;
  let activeLoad = null;
  let activeOutcome = null;

  function capture() {
    return expectedOwnerUserId && expectedCoupleId
      ? { ownerUserId: expectedOwnerUserId, coupleId: expectedCoupleId, sessionGeneration }
      : null;
  }

  function abortActive(entry) {
    entry?.controller.abort();
  }

  function cancelAll() {
    abortActive(activeLoad);
    abortActive(activeOutcome);
    activeLoad = null;
    activeOutcome = null;
    operationGeneration += 1;
  }

  function updateExpected(ownerUserId, coupleId) {
    const nextOwner = normalizedExpectedId(ownerUserId);
    const nextCouple = normalizedExpectedId(coupleId);
    if (nextOwner === expectedOwnerUserId && nextCouple === expectedCoupleId) return false;
    expectedOwnerUserId = nextOwner;
    expectedCoupleId = nextCouple;
    sessionGeneration += 1;
    cancelAll();
    return true;
  }

  function updateAuthenticatedUser(userId) {
    const nextUserId = normalizedExpectedId(userId);
    if (nextUserId === authenticatedUserId) return false;
    authenticatedUserId = nextUserId;
    sessionGeneration += 1;
    cancelAll();
    return true;
  }

  function adoptAuthenticatedUser(userId) {
    const nextUserId = normalizedExpectedId(userId);
    if (!nextUserId) return false;
    if (authenticatedUserId === null) authenticatedUserId = nextUserId;
    return authenticatedUserId === nextUserId;
  }

  function operation(kind, context) {
    const controller = new globalThis.AbortController();
    const value = {
      kind,
      context,
      id: ++operationGeneration,
      signal: controller.signal,
    };
    return { value, controller };
  }

  function beginLoad() {
    if (activeOutcome) return null;
    const context = capture();
    if (!context) return null;
    abortActive(activeLoad);
    const next = operation("load", context);
    activeLoad = next;
    return next.value;
  }

  function beginOutcome(expectedContext) {
    const context = capture();
    if (activeOutcome || !sameContext(expectedContext, context)) return null;
    abortActive(activeLoad);
    activeLoad = null;
    const next = operation("outcome", context);
    activeOutcome = next;
    return next.value;
  }

  function isCurrent(value) {
    if (!value || value.signal.aborted || value.id !== operationGeneration) return false;
    return sameContext(value.context, capture());
  }

  async function runStage(value, stage) {
    if (!isCurrent(value)) return { status: "stale" };
    const result = await stage(value.signal);
    return isCurrent(value)
      ? { status: "current", value: result }
      : { status: "stale" };
  }

  function finish(value) {
    if (!value) return;
    if (activeLoad?.value.id === value.id) activeLoad = null;
    if (activeOutcome?.value.id === value.id) activeOutcome = null;
  }

  return {
    updateExpected,
    updateAuthenticatedUser,
    adoptAuthenticatedUser,
    capture,
    beginLoad,
    beginOutcome,
    isCurrent,
    runStage,
    finish,
    cancelAll,
    hasOutcomeInFlight: () => activeOutcome !== null,
  };
}
