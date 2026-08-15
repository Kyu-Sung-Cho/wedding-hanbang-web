import { parseDashboardOpenAction } from "./dashboardExperience.mjs";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const ACTION_ID_PATTERN = /^[0-9A-Za-z_-]{1,200}$/u;
const HANDOFF_TTL_MS = 10 * 60 * 1000;

let pendingHandoff = null;

function normalizeUuid(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return UUID_PATTERN.test(normalized) ? normalized : null;
}

function normalizeActionId(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return ACTION_ID_PATTERN.test(normalized) ? normalized : null;
}

export function stageActionReceiptHomeHandoff({
  handoffId,
  ownerUserId,
  coupleId,
  actionId,
  nowMs = Date.now(),
}) {
  const normalizedHandoffId = normalizeUuid(handoffId);
  const normalizedOwnerUserId = normalizeUuid(ownerUserId);
  const normalizedCoupleId = normalizeUuid(coupleId);
  const normalizedActionId = normalizeActionId(actionId);
  if (
    !normalizedHandoffId
    || !normalizedOwnerUserId
    || !normalizedCoupleId
    || !normalizedActionId
    || !Number.isFinite(nowMs)
  ) {
    pendingHandoff = null;
    return null;
  }

  pendingHandoff = {
    handoffId: normalizedHandoffId,
    ownerUserId: normalizedOwnerUserId,
    coupleId: normalizedCoupleId,
    actionId: normalizedActionId,
    expiresAtMs: nowMs + HANDOFF_TTL_MS,
  };
  return normalizedHandoffId;
}

export function consumeActionReceiptHomeHandoff(
  handoffId,
  expectedOwnerUserId,
  expectedCoupleId,
  nowMs = Date.now(),
) {
  const normalizedHandoffId = normalizeUuid(handoffId);
  const normalizedOwnerUserId = normalizeUuid(expectedOwnerUserId);
  const normalizedCoupleId = normalizeUuid(expectedCoupleId);
  if (!normalizedHandoffId || !normalizedOwnerUserId || !normalizedCoupleId) return null;
  if (!pendingHandoff || pendingHandoff.handoffId !== normalizedHandoffId) return null;

  const handoff = pendingHandoff;
  pendingHandoff = null;
  if (!Number.isFinite(nowMs) || handoff.expiresAtMs <= nowMs) return null;
  if (handoff.ownerUserId !== normalizedOwnerUserId) return null;
  if (handoff.coupleId !== normalizedCoupleId) return null;
  return { actionId: handoff.actionId };
}

function isExactReadResult(value, ok) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  return ok
    ? keys.length === 2 && keys[0] === "ok" && keys[1] === "value" && value.ok === true
    : keys.length === 1 && keys[0] === "ok" && value.ok === false;
}

function isCurrentResolution(checkCurrent) {
  try {
    return checkCurrent() === true;
  } catch {
    return false;
  }
}

export async function resolveActionReceiptHomeHandoff({
  handoffId,
  expectedOwnerUserId,
  expectedCoupleId,
  isResolutionCurrent,
  readCurrentOpenAction,
  nowMs = Date.now(),
}) {
  const normalizedHandoffId = normalizeUuid(handoffId);
  const normalizedOwnerUserId = normalizeUuid(expectedOwnerUserId);
  const normalizedCoupleId = normalizeUuid(expectedCoupleId);
  if (!normalizedHandoffId || !normalizedOwnerUserId || !normalizedCoupleId) {
    return { state: "rejected" };
  }
  if (!pendingHandoff || pendingHandoff.handoffId !== normalizedHandoffId) {
    return { state: "rejected" };
  }

  const handoff = pendingHandoff;
  if (
    !Number.isFinite(nowMs)
    || handoff.expiresAtMs <= nowMs
    || handoff.ownerUserId !== normalizedOwnerUserId
    || handoff.coupleId !== normalizedCoupleId
    || typeof isResolutionCurrent !== "function"
    || typeof readCurrentOpenAction !== "function"
  ) {
    pendingHandoff = null;
    return { state: "rejected" };
  }
  if (!isCurrentResolution(isResolutionCurrent)) return { state: "retry" };

  let readResult;
  try {
    readResult = await readCurrentOpenAction({
      actionId: handoff.actionId,
      coupleId: normalizedCoupleId,
    });
  } catch {
    return pendingHandoff === handoff && isCurrentResolution(isResolutionCurrent)
      ? { state: "retry" }
      : { state: "rejected" };
  }

  if (pendingHandoff !== handoff) return { state: "rejected" };
  if (!isCurrentResolution(isResolutionCurrent)) return { state: "retry" };
  if (isExactReadResult(readResult, false)) {
    return { state: "retry" };
  }

  pendingHandoff = null;
  if (!isExactReadResult(readResult, true)) return { state: "rejected" };
  const action = parseDashboardOpenAction(readResult.value, normalizedCoupleId);
  if (!action || action.id !== handoff.actionId) return { state: "rejected" };
  return { state: "focused", action };
}
