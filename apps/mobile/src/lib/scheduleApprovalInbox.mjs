const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RFC3339_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const DISCLOSURE_RECEIPT_PATTERN = /^[a-f0-9]{64}$/;
const MANUAL_EVENT_KINDS = new Set([
  "approval_requested",
  "approval_pending",
  "approval_ready",
  "approval_withdrawn",
  "change_applied",
  "change_rejected",
  "change_stale",
]);
const PLAN_SURFACES = new Set(["/schedule", "/budget", "/dashboard"]);
const MAX_APPROVAL_STATUS_CHECKS = 20;
const APPROVAL_STATUS_CONCURRENCY = 4;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isTimestamp(value) {
  return typeof value === "string"
    && RFC3339_PATTERN.test(value)
    && Number.isFinite(Date.parse(value));
}

function isSafeDisplayText(value, maximumCharacters) {
  return typeof value === "string"
    && Array.from(value).length >= 1
    && Array.from(value).length <= maximumCharacters
    && !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value);
}

function jsonValuesAreSemanticallyEqual(left, right) {
  const pending = [[left, right]];
  const visited = new WeakMap();

  while (pending.length > 0) {
    const [leftValue, rightValue] = pending.pop();
    if (Object.is(leftValue, rightValue)) continue;
    if (
      leftValue === null
      || rightValue === null
      || typeof leftValue !== "object"
      || typeof rightValue !== "object"
    ) return false;

    const leftIsArray = Array.isArray(leftValue);
    if (leftIsArray !== Array.isArray(rightValue)) return false;
    const leftKeys = Object.keys(leftValue);
    const rightKeys = Object.keys(rightValue);
    if (leftKeys.length !== rightKeys.length) return false;

    let visitedRights = visited.get(leftValue);
    if (visitedRights?.has(rightValue)) continue;
    if (!visitedRights) {
      visitedRights = new WeakSet();
      visited.set(leftValue, visitedRights);
    }
    visitedRights.add(rightValue);

    for (const key of leftKeys) {
      if (!Object.prototype.hasOwnProperty.call(rightValue, key)) return false;
      pending.push([leftValue[key], rightValue[key]]);
    }
  }

  return true;
}

function isSameChecklistSituationProposal(reviewed, latest) {
  return isRecord(reviewed)
    && reviewed.kind === "checklist_situation"
    && Object.keys(reviewed).length === 3
    && Number.isSafeInteger(reviewed.baseRevision)
    && reviewed.baseRevision >= 0
    && isRecord(reviewed.progressPatch)
    && reviewed.baseRevision === latest.baseRevision
    && jsonValuesAreSemanticallyEqual(
      reviewed.progressPatch,
      latest.progressPatch,
    );
}

function invalidMutationResponse() {
  throw new Error("INVALID_SCHEDULE_MUTATION_RESPONSE");
}

export function parseScheduleMutationSubmission(value) {
  if (
    !isRecord(value)
    || !isUuid(value.requestId)
    || !Number.isSafeInteger(value.requiredCount)
    || value.requiredCount < 1
    || value.requiredCount > 2
    || !Number.isSafeInteger(value.acceptedCount)
    || value.acceptedCount < 0
    || value.acceptedCount > value.requiredCount
    || !isSafeDisplayText(value.summary, 240)
    || value.surface !== "/schedule"
  ) {
    return invalidMutationResponse();
  }

  if (
    value.status === "pending_partner"
    && value.requiredCount === 2
    && value.acceptedCount === 1
  ) {
    return {
      status: "pending_partner",
      requestId: value.requestId.toLowerCase(),
      summary: value.summary,
    };
  }

  if (
    value.status === "applied"
    && value.acceptedCount === value.requiredCount
  ) {
    return { status: "applied" };
  }

  return invalidMutationResponse();
}

function invalidNotifications() {
  throw new Error("INVALID_SCHEDULE_APPROVAL_NOTIFICATIONS");
}

export function parseScheduleApprovalNotifications(value, expectedOwnerId) {
  if (
    !isUuid(expectedOwnerId)
    || !isRecord(value)
    || !isUuid(value.ownerId)
    || value.ownerId.toLowerCase() !== expectedOwnerId.toLowerCase()
    || !Array.isArray(value.notifications)
    || value.notifications.length > 270
  ) {
    return invalidNotifications();
  }

  const byRequestId = new Map();
  for (const row of value.notifications) {
    if (!isRecord(row)) return invalidNotifications();
    if (row.tool_name !== "manual_plan_change") continue;

    if (
      !isUuid(row.id)
      || !isUuid(row.action_id)
      || typeof row.event_kind !== "string"
      || !MANUAL_EVENT_KINDS.has(row.event_kind)
      || !isSafeDisplayText(row.title, 120)
      || !isSafeDisplayText(row.message, 240)
      || typeof row.href !== "string"
      || !PLAN_SURFACES.has(row.href)
      || !isTimestamp(row.created_at)
      || !(row.read_at === null || isTimestamp(row.read_at))
    ) {
      return invalidNotifications();
    }

    if (
      row.href !== "/schedule"
      || (
        row.event_kind !== "approval_requested"
        && row.event_kind !== "approval_pending"
      )
    ) {
      continue;
    }

    const requestId = row.action_id.toLowerCase();
    const candidate = {
      requestId,
      role: row.event_kind === "approval_requested" ? "reviewer" : "requester",
      createdAt: row.created_at,
    };
    const existing = byRequestId.get(requestId);
    if (existing && existing.role !== candidate.role) {
      return invalidNotifications();
    }
    if (!existing || Date.parse(candidate.createdAt) > Date.parse(existing.createdAt)) {
      byRequestId.set(requestId, candidate);
    }
  }

  return [...byRequestId.values()].sort(
    (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
  );
}

function invalidActiveApprovalInbox() {
  throw new Error("INVALID_SCHEDULE_ACTIVE_APPROVAL_INBOX");
}

export function parseScheduleActiveApprovalInbox(
  value,
  expectedOwnerId,
  expectedCoupleId,
) {
  if (
    !isUuid(expectedOwnerId)
    || !isUuid(expectedCoupleId)
    || !isRecord(value)
    || Object.keys(value).length !== 3
    || !isUuid(value.ownerId)
    || value.ownerId.toLowerCase() !== expectedOwnerId.toLowerCase()
    || !isUuid(value.coupleId)
    || value.coupleId.toLowerCase() !== expectedCoupleId.toLowerCase()
    || !Array.isArray(value.requests)
    || value.requests.length > MAX_APPROVAL_STATUS_CHECKS
  ) {
    return invalidActiveApprovalInbox();
  }

  const seen = new Set();
  const requests = value.requests.map((row) => {
    if (
      !isRecord(row)
      || Object.keys(row).length !== 3
      || !isUuid(row.requestId)
      || !(row.role === "reviewer" || row.role === "requester")
      || !isTimestamp(row.createdAt)
    ) {
      return invalidActiveApprovalInbox();
    }
    const requestId = row.requestId.toLowerCase();
    if (seen.has(requestId)) return invalidActiveApprovalInbox();
    seen.add(requestId);
    return {
      requestId,
      role: row.role,
      createdAt: row.createdAt,
    };
  });

  return requests.sort(
    (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
  );
}

function invalidApprovalStatus() {
  throw new Error("INVALID_SCHEDULE_APPROVAL_STATUS");
}

function parseApprovalProposal(value) {
  if (value === undefined) return { kind: "unavailable" };
  if (!isRecord(value)) return invalidApprovalStatus();
  if (value.kind === "other" && Object.keys(value).length === 1) {
    return { kind: "other" };
  }
  if (
    value.kind !== "checklist_situation"
    || Object.keys(value).length !== 3
    || !Number.isSafeInteger(value.baseRevision)
    || value.baseRevision < 0
    || !isRecord(value.progressPatch)
  ) return invalidApprovalStatus();
  let serialized;
  try {
    serialized = JSON.stringify(value.progressPatch);
  } catch {
    return invalidApprovalStatus();
  }
  if (Array.from(serialized).length > 131_072) return invalidApprovalStatus();
  return {
    kind: "checklist_situation",
    baseRevision: value.baseRevision,
    progressPatch: value.progressPatch,
  };
}

export function parseScheduleApprovalStatus(
  value,
  expectedRequestId,
  expectedCoupleId,
) {
  if (
    !isUuid(expectedRequestId)
    || !isUuid(expectedCoupleId)
    || !isRecord(value)
    || !isUuid(value.requestId)
    || value.requestId.toLowerCase() !== expectedRequestId.toLowerCase()
    || !(
      value.status === "applied"
      || value.status === "pending_partner"
      || value.status === "stale"
      || value.status === "rejected"
    )
    || !Number.isSafeInteger(value.requiredCount)
    || value.requiredCount < 1
    || value.requiredCount > 2
    || !Number.isSafeInteger(value.acceptedCount)
    || value.acceptedCount < 0
    || value.acceptedCount > value.requiredCount
    || !isSafeDisplayText(value.summary, 240)
    || value.surface !== "/schedule"
  ) {
    return invalidApprovalStatus();
  }

  if (value.status === "pending_partner") {
    if (
      value.requiredCount !== 2
      || value.acceptedCount !== 1
      || (
        Object.prototype.hasOwnProperty.call(value, "journey")
        && value.journey !== null
      )
    ) {
      return invalidApprovalStatus();
    }
  } else if (value.status === "applied") {
    if (
      value.acceptedCount !== value.requiredCount
      || !isRecord(value.journey)
      || !isUuid(value.journey.couple_id)
      || value.journey.couple_id.toLowerCase() !== expectedCoupleId.toLowerCase()
      || !Number.isSafeInteger(value.journey.state_revision)
      || value.journey.state_revision < 0
    ) {
      return invalidApprovalStatus();
    }
  } else if (
    Object.prototype.hasOwnProperty.call(value, "journey")
    && value.journey !== null
  ) {
    return invalidApprovalStatus();
  }

  const proposal = parseApprovalProposal(value.proposal);
  if (
    value.status === "pending_partner"
    && proposal.kind === "checklist_situation"
    && (
      typeof value.disclosureReceipt !== "string"
      || !DISCLOSURE_RECEIPT_PATTERN.test(value.disclosureReceipt)
    )
  ) {
    return invalidApprovalStatus();
  }

  return {
    requestId: value.requestId.toLowerCase(),
    status: value.status,
    summary: value.summary,
    proposal,
    ...(proposal.kind === "checklist_situation"
      && typeof value.disclosureReceipt === "string"
      ? { disclosureReceipt: value.disclosureReceipt }
      : {}),
  };
}

async function readResponseJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function assertResponse(value) {
  if (
    !isRecord(value)
    || typeof value.ok !== "boolean"
    || !Number.isSafeInteger(value.status)
    || typeof value.json !== "function"
  ) {
    throw new Error("SCHEDULE_APPROVAL_INBOX_UNAVAILABLE");
  }
  return value;
}

async function mapWithBoundedConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function runWorker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, items.length) },
      () => runWorker(),
    ),
  );
  return results;
}

export async function fetchScheduleApprovalInbox({ apiFetch, ownerId, coupleId }) {
  if (typeof apiFetch !== "function" || !isUuid(ownerId) || !isUuid(coupleId)) {
    throw new Error("SCHEDULE_APPROVAL_INBOX_INVALID_CONTEXT");
  }

  const listResponse = assertResponse(await apiFetch(
    "/api/couple-plan-changes/active",
  ));
  const listPayload = await readResponseJson(listResponse);
  if (!listResponse.ok) {
    throw new Error("SCHEDULE_APPROVAL_INBOX_UNAVAILABLE");
  }
  const allCandidates = parseScheduleActiveApprovalInbox(
    listPayload,
    ownerId,
    coupleId,
  );
  const candidates = allCandidates.slice(0, MAX_APPROVAL_STATUS_CHECKS);

  const verified = await mapWithBoundedConcurrency(
    candidates,
    APPROVAL_STATUS_CONCURRENCY,
    async (candidate) => {
      try {
        const response = assertResponse(await apiFetch(
          `/api/couple-plan-changes/${candidate.requestId}`,
        ));
        const payload = await readResponseJson(response);
        if (!response.ok) {
          if (
            response.status === 403
            || response.status === 404
            || response.status === 409
          ) {
            return {
              request: null,
              partial: false,
              definitivelyRemovedId: candidate.requestId,
            };
          }
          return {
            request: null,
            partial: true,
            definitivelyRemovedId: null,
          };
        }

        const latest = parseScheduleApprovalStatus(
          payload,
          candidate.requestId,
          coupleId,
        );
        if (latest.status !== "pending_partner") {
          return {
            request: null,
            partial: false,
            definitivelyRemovedId: candidate.requestId,
          };
        }
        return {
          request: {
            ...candidate,
            summary: latest.summary,
            proposal: latest.proposal,
            ...(latest.disclosureReceipt
              ? { disclosureReceipt: latest.disclosureReceipt }
              : {}),
          },
          partial: false,
          definitivelyRemovedId: null,
        };
      } catch {
        return {
          request: null,
          partial: true,
          definitivelyRemovedId: null,
        };
      }
    },
  );

  return {
    requests: verified.flatMap((result) => result.request ? [result.request] : []),
    definitivelyRemovedIds: verified.flatMap((result) => (
      result.definitivelyRemovedId ? [result.definitivelyRemovedId] : []
    )),
    partial: allCandidates.length > MAX_APPROVAL_STATUS_CHECKS
      || verified.some((result) => result.partial),
  };
}

export function mergeScheduleApprovalInbox(current, result) {
  if (!result.partial) return result.requests;
  const verifiedIds = new Set(result.requests.map((request) => request.requestId));
  const definitivelyRemovedIds = new Set(result.definitivelyRemovedIds ?? []);
  return [
    ...result.requests,
    ...current.filter((request) => (
      !verifiedIds.has(request.requestId)
      && !definitivelyRemovedIds.has(request.requestId)
    )),
  ];
}

async function fetchLatestApprovalStatus(apiFetch, requestId, coupleId) {
  const response = assertResponse(await apiFetch(
    `/api/couple-plan-changes/${requestId}`,
  ));
  const payload = await readResponseJson(response);
  if (!response.ok) {
    if (response.status === 403 || response.status === 404 || response.status === 409) {
      return null;
    }
    throw new Error("SCHEDULE_APPROVAL_ACTION_UNAVAILABLE");
  }
  return parseScheduleApprovalStatus(payload, requestId, coupleId);
}

export async function actOnScheduleApproval({
  apiFetch,
  coupleId,
  request,
  action,
  reviewedBaseRevision,
}) {
  if (
    typeof apiFetch !== "function"
    || !isUuid(coupleId)
    || !isRecord(request)
    || !isUuid(request.requestId)
    || !(request.role === "reviewer" || request.role === "requester")
    || !(action === "approve" || action === "reject" || action === "withdraw")
    || (request.role === "reviewer" && action === "withdraw")
    || (request.role === "requester" && action !== "withdraw")
  ) {
    throw new Error("SCHEDULE_APPROVAL_ACTION_INVALID");
  }

  const requestId = request.requestId.toLowerCase();
  const latest = await fetchLatestApprovalStatus(apiFetch, requestId, coupleId);
  if (!latest) return { status: "conflict" };
  if (latest.status !== "pending_partner") {
    return { status: "terminal", terminalStatus: latest.status };
  }

  if (action === "approve") {
    if (latest.proposal.kind === "unavailable") return { status: "conflict" };
    if (latest.proposal.kind === "checklist_situation" && (
      !isSameChecklistSituationProposal(request.proposal, latest.proposal)
      || reviewedBaseRevision !== latest.proposal.baseRevision
    )) return { status: "conflict" };
  }

  const method = action === "approve" ? "POST" : "DELETE";
  const mutationBody = action === "approve"
    && latest.proposal.kind === "checklist_situation"
    ? JSON.stringify({ disclosureReceipt: latest.disclosureReceipt })
    : "{}";
  let response;
  try {
    response = assertResponse(await apiFetch(
      `/api/couple-plan-changes/${requestId}`,
      { method, body: mutationBody },
    ));
  } catch {
    const recovered = await fetchLatestApprovalStatus(
      apiFetch,
      requestId,
      coupleId,
    );
    if (recovered && recovered.status !== "pending_partner") {
      return { status: "terminal", terminalStatus: recovered.status };
    }
    throw new Error("SCHEDULE_APPROVAL_ACTION_UNCERTAIN");
  }
  const payload = await readResponseJson(response);
  if (!response.ok) {
    const recovered = await fetchLatestApprovalStatus(
      apiFetch,
      requestId,
      coupleId,
    );
    if (recovered && recovered.status !== "pending_partner") {
      return { status: "terminal", terminalStatus: recovered.status };
    }
    return { status: "conflict" };
  }
  let result;
  try {
    result = parseScheduleApprovalStatus(payload, requestId, coupleId);
  } catch {
    const recovered = await fetchLatestApprovalStatus(
      apiFetch,
      requestId,
      coupleId,
    );
    if (recovered && recovered.status !== "pending_partner") {
      return { status: "terminal", terminalStatus: recovered.status };
    }
    throw new Error("SCHEDULE_APPROVAL_ACTION_UNCERTAIN");
  }
  if (action === "approve" && result.status === "applied") {
    return { status: "applied" };
  }
  if (action !== "approve" && result.status === "rejected") {
    return { status: action === "withdraw" ? "withdrawn" : "rejected" };
  }
  return { status: "conflict" };
}
