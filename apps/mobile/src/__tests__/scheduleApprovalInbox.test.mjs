import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { URL } from "node:url";

import {
  actOnScheduleApproval,
  fetchScheduleApprovalInbox,
  mergeScheduleApprovalInbox,
  parseScheduleActiveApprovalInbox,
  parseScheduleApprovalNotifications,
  parseScheduleApprovalStatus,
  parseScheduleMutationSubmission,
} from "../lib/scheduleApprovalInbox.mjs";

const REQUEST_ID = "20000000-0000-4000-8000-000000000001";
const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const PARTNER_ID = "10000000-0000-4000-8000-000000000002";
const COUPLE_ID = "50000000-0000-4000-8000-000000000001";
const DISCLOSURE_RECEIPT = "d".repeat(64);
const REFRESHED_DISCLOSURE_RECEIPT = "e".repeat(64);
const scheduleScreenSource = readFileSync(
  new URL("../../app/schedule/index.tsx", import.meta.url),
  "utf8",
);

test("the expanded mobile approval discloses status changes and cleared completion evidence", () => {
  assert.match(
    scheduleScreenSource,
    /category\.statusChanged\s*&&\s*!category\.applicabilityChanged/,
  );
  assert.match(
    scheduleScreenSource,
    /상태 \$\{CHECKLIST_STATUS_LABELS\[category\.beforeStatus\]\} → \$\{CHECKLIST_STATUS_LABELS\[category\.afterStatus\]\}/,
  );
  assert.match(scheduleScreenSource, /item\.completionEvidenceCleared/);
  assert.ok(scheduleScreenSource.includes(
    "자동 제외되며 기존 완료 기록(완료 일시·완료자)이 해제돼요",
  ));
});

test("a pending schedule submission keeps its opaque request reference for the approval inbox", () => {
  assert.deepEqual(parseScheduleMutationSubmission({
    requestId: REQUEST_ID.toUpperCase(),
    status: "pending_partner",
    requiredCount: 2,
    acceptedCount: 1,
    summary: "일정: 드레스 피팅 · 2026-08-20 14:00",
    surface: "/schedule",
  }), {
    status: "pending_partner",
    requestId: REQUEST_ID,
    summary: "일정: 드레스 피팅 · 2026-08-20 14:00",
  });

  for (const malformed of [
    { status: "pending_partner", requiredCount: 2, acceptedCount: 1 },
    { requestId: "not-a-uuid", status: "pending_partner", requiredCount: 2, acceptedCount: 1 },
    { requestId: REQUEST_ID, status: "pending_partner", requiredCount: 1, acceptedCount: 1 },
    { requestId: REQUEST_ID, status: "pending_partner", requiredCount: 2, acceptedCount: 2 },
    { requestId: REQUEST_ID, status: "pending_partner", requiredCount: 2, acceptedCount: 1, summary: "일정\u0000변경", surface: "/schedule" },
    { requestId: REQUEST_ID, status: "applied", requiredCount: 2, acceptedCount: 1 },
  ]) {
    assert.throws(
      () => parseScheduleMutationSubmission(malformed),
      /INVALID_SCHEDULE_MUTATION_RESPONSE/,
    );
  }
});

test("a reviewer approval performs a latest-status preflight before accepting", async () => {
  const calls = [];
  const fetcher = async (path, options = {}) => {
    calls.push({ path, options });
    if (!options.method) return response(200, pendingStatus(REQUEST_ID));
    return response(200, {
      ...pendingStatus(REQUEST_ID),
      status: "applied",
      acceptedCount: 2,
      journey: { couple_id: COUPLE_ID, state_revision: 9 },
    });
  };

  assert.deepEqual(await actOnScheduleApproval({
    apiFetch: fetcher,
    coupleId: COUPLE_ID,
    request: { requestId: REQUEST_ID, role: "reviewer" },
    action: "approve",
  }), { status: "applied" });
  assert.deepEqual(calls.map(({ path, options }) => ({
    path,
    method: options.method ?? "GET",
    body: options.body,
  })), [
    {
      path: `/api/couple-plan-changes/${REQUEST_ID}`,
      method: "GET",
      body: undefined,
    },
    {
      path: `/api/couple-plan-changes/${REQUEST_ID}`,
      method: "POST",
      body: "{}",
    },
  ]);
});

test("a checklist situation approval refreshes its random receipt for the exact reviewed proposal", async () => {
  const reviewedProposal = {
    kind: "checklist_situation",
    baseRevision: 7,
    progressPatch: {
      __checklist_profile: { version: 1, answers: { travel: "yes", ceremony: "no" } },
    },
  };
  const latestProposal = {
    kind: "checklist_situation",
    baseRevision: 7,
    progressPatch: {
      __checklist_profile: { answers: { ceremony: "no", travel: "yes" }, version: 1 },
    },
  };
  let mutationCount = 0;
  let mutationBody;
  const fetcher = async (_path, options = {}) => {
    if (!options.method) {
      return response(200, {
        ...pendingStatus(REQUEST_ID),
        proposal: latestProposal,
        disclosureReceipt: REFRESHED_DISCLOSURE_RECEIPT,
      });
    }
    mutationCount += 1;
    mutationBody = options.body;
    return response(200, {
      ...pendingStatus(REQUEST_ID),
      proposal: latestProposal,
      status: "applied",
      acceptedCount: 2,
      journey: { couple_id: COUPLE_ID, state_revision: 8 },
    });
  };
  const request = {
    requestId: REQUEST_ID,
    role: "reviewer",
    proposal: reviewedProposal,
    disclosureReceipt: DISCLOSURE_RECEIPT,
  };

  assert.deepEqual(await actOnScheduleApproval({
    apiFetch: fetcher,
    coupleId: COUPLE_ID,
    request,
    action: "approve",
  }), { status: "conflict" });
  assert.equal(mutationCount, 0);

  assert.deepEqual(await actOnScheduleApproval({
    apiFetch: fetcher,
    coupleId: COUPLE_ID,
    request,
    action: "approve",
    reviewedBaseRevision: 7,
  }), { status: "applied" });
  assert.equal(mutationCount, 1);
  assert.equal(
    mutationBody,
    JSON.stringify({ disclosureReceipt: REFRESHED_DISCLOSURE_RECEIPT }),
  );
});

test("a checklist situation approval never posts when the reviewed proposal changed", async () => {
  const reviewedProposal = {
    kind: "checklist_situation",
    baseRevision: 7,
    progressPatch: { __checklist_profile: { version: 1, answers: { ceremony: "no" } } },
  };
  const latestProposal = {
    kind: "checklist_situation",
    baseRevision: 7,
    progressPatch: { __checklist_profile: { version: 1, answers: { ceremony: "yes" } } },
  };
  let mutationCount = 0;
  const fetcher = async (_path, options = {}) => {
    if (options.method) mutationCount += 1;
    return response(200, {
      ...pendingStatus(REQUEST_ID),
      proposal: latestProposal,
      disclosureReceipt: REFRESHED_DISCLOSURE_RECEIPT,
    });
  };

  assert.deepEqual(await actOnScheduleApproval({
    apiFetch: fetcher,
    coupleId: COUPLE_ID,
    request: {
      requestId: REQUEST_ID,
      role: "reviewer",
      proposal: reviewedProposal,
      disclosureReceipt: DISCLOSURE_RECEIPT,
    },
    action: "approve",
    reviewedBaseRevision: 7,
  }), { status: "conflict" });
  assert.equal(mutationCount, 0);
});

test("a pending checklist status is unusable without its exact disclosure receipt", () => {
  const proposal = {
    kind: "checklist_situation",
    baseRevision: 7,
    progressPatch: { __checklist_profile: { version: 1 } },
  };
  assert.throws(
    () => parseScheduleApprovalStatus({
      ...pendingStatus(REQUEST_ID),
      proposal,
    }, REQUEST_ID, COUPLE_ID),
    /INVALID_SCHEDULE_APPROVAL_STATUS/,
  );
  assert.deepEqual(parseScheduleApprovalStatus({
    ...pendingStatus(REQUEST_ID),
    proposal,
    disclosureReceipt: DISCLOSURE_RECEIPT,
  }, REQUEST_ID, COUPLE_ID), {
    requestId: REQUEST_ID,
    status: "pending_partner",
    summary: pendingStatus(REQUEST_ID).summary,
    proposal,
    disclosureReceipt: DISCLOSURE_RECEIPT,
  });
});

test("a partner rejects an incoming request while its requester withdraws an outgoing request", async () => {
  for (const scenario of [
    { role: "reviewer", action: "reject", expected: "rejected" },
    { role: "requester", action: "withdraw", expected: "withdrawn" },
  ]) {
    const methods = [];
    const fetcher = async (_path, options = {}) => {
      methods.push(options.method ?? "GET");
      return options.method
        ? response(200, { ...pendingStatus(REQUEST_ID), status: "rejected" })
        : response(200, pendingStatus(REQUEST_ID));
    };
    assert.deepEqual(await actOnScheduleApproval({
      apiFetch: fetcher,
      coupleId: COUPLE_ID,
      request: { requestId: REQUEST_ID, role: scenario.role },
      action: scenario.action,
    }), { status: scenario.expected });
    assert.deepEqual(methods, ["GET", "DELETE"]);
  }

  for (const [role, action] of [
    ["requester", "approve"],
    ["requester", "reject"],
    ["reviewer", "withdraw"],
  ]) {
    await assert.rejects(
      actOnScheduleApproval({
        apiFetch: async () => { throw new Error("must not fetch"); },
        coupleId: COUPLE_ID,
        request: { requestId: REQUEST_ID, role },
        action,
      }),
      /SCHEDULE_APPROVAL_ACTION_INVALID/,
    );
  }
});

test("an action conflict rechecks the server and recovers an already terminal request", async () => {
  let call = 0;
  const fetcher = async (_path, options = {}) => {
    call += 1;
    if (call === 1) return response(200, pendingStatus(REQUEST_ID));
    if (options.method === "POST") {
      return response(409, { code: "PLAN_CHANGE_CONFLICT" });
    }
    return response(200, {
      ...pendingStatus(REQUEST_ID),
      status: "applied",
      acceptedCount: 2,
      journey: { couple_id: COUPLE_ID, state_revision: 10 },
    });
  };

  assert.deepEqual(await actOnScheduleApproval({
    apiFetch: fetcher,
    coupleId: COUPLE_ID,
    request: { requestId: REQUEST_ID, role: "reviewer" },
    action: "approve",
  }), { status: "terminal", terminalStatus: "applied" });
  assert.equal(call, 3);
});

test("a malformed mutation acknowledgement is recovered through status GET without replaying the action", async () => {
  const methods = [];
  const fetcher = async (_path, options = {}) => {
    methods.push(options.method ?? "GET");
    if (methods.length === 1) return response(200, pendingStatus(REQUEST_ID));
    if (options.method === "POST") return response(200, { ok: true });
    return response(200, {
      ...pendingStatus(REQUEST_ID),
      status: "applied",
      acceptedCount: 2,
      journey: { couple_id: COUPLE_ID, state_revision: 11 },
    });
  };

  assert.deepEqual(await actOnScheduleApproval({
    apiFetch: fetcher,
    coupleId: COUPLE_ID,
    request: { requestId: REQUEST_ID, role: "reviewer" },
    action: "approve",
  }), { status: "terminal", terminalStatus: "applied" });
  assert.deepEqual(methods, ["GET", "POST", "GET"]);
});

test("a schedule approval card is shown only after its latest server status is strictly verified", () => {
  assert.deepEqual(parseScheduleApprovalStatus({
    requestId: REQUEST_ID.toUpperCase(),
    status: "pending_partner",
    requiredCount: 2,
    acceptedCount: 1,
    summary: "일정: 드레스 피팅 · 2026-08-20 14:00",
    surface: "/schedule",
  }, REQUEST_ID, COUPLE_ID), {
    requestId: REQUEST_ID,
    status: "pending_partner",
    summary: "일정: 드레스 피팅 · 2026-08-20 14:00",
    proposal: { kind: "unavailable" },
  });

  assert.equal(parseScheduleApprovalStatus({
    requestId: REQUEST_ID,
    status: "applied",
    requiredCount: 2,
    acceptedCount: 2,
    summary: "일정: 드레스 피팅 · 2026-08-20 14:00",
    surface: "/schedule",
    journey: { couple_id: COUPLE_ID, state_revision: 8 },
  }, REQUEST_ID, COUPLE_ID).status, "applied");

  for (const malformed of [
    { requestId: REQUEST_ID, status: "pending_partner", requiredCount: 2, acceptedCount: 0, summary: "일정 변경", surface: "/schedule" },
    { requestId: "20000000-0000-4000-8000-000000000009", status: "pending_partner", requiredCount: 2, acceptedCount: 1, summary: "일정 변경", surface: "/schedule" },
    { requestId: REQUEST_ID, status: "pending_partner", requiredCount: 2, acceptedCount: 1, summary: "일정\u0000변경", surface: "/schedule" },
    { requestId: REQUEST_ID, status: "pending_partner", requiredCount: 2, acceptedCount: 1, summary: "일정 변경", surface: "/budget" },
    { requestId: REQUEST_ID, status: "applied", requiredCount: 2, acceptedCount: 2, summary: "일정 변경", surface: "/schedule", journey: { couple_id: OWNER_ID, state_revision: 8 } },
  ]) {
    assert.throws(
      () => parseScheduleApprovalStatus(malformed, REQUEST_ID, COUPLE_ID),
      /INVALID_SCHEDULE_APPROVAL_STATUS/,
    );
  }
});

test("the schedule inbox accepts only owner-bound manual approval rows and keeps requester and reviewer roles distinct", () => {
  const requested = {
    id: "30000000-0000-4000-8000-000000000001",
    event_kind: "approval_requested",
    action_id: REQUEST_ID,
    tool_name: "manual_plan_change",
    title: "함께 확인할 계획 변경이 있어요",
    message: "일정: 드레스 피팅 · 2026-08-20 14:00",
    href: "/schedule",
    read_at: null,
    created_at: "2026-08-02T10:00:00.000Z",
  };
  const pendingRequestId = "20000000-0000-4000-8000-000000000002";
  const pending = {
    ...requested,
    id: "30000000-0000-4000-8000-000000000002",
    action_id: pendingRequestId,
    event_kind: "approval_pending",
    title: "파트너 확인을 기다리는 계획 변경이에요",
    created_at: "2026-08-02T11:00:00.000Z",
  };

  assert.deepEqual(parseScheduleApprovalNotifications({
    ownerId: OWNER_ID.toUpperCase(),
    notifications: [requested, pending, {
      ...requested,
      id: "30000000-0000-4000-8000-000000000003",
      tool_name: "update_budget",
      href: "/budget",
    }],
  }, OWNER_ID), [
    {
      requestId: pendingRequestId,
      role: "requester",
      createdAt: "2026-08-02T11:00:00.000Z",
    },
    {
      requestId: REQUEST_ID,
      role: "reviewer",
      createdAt: "2026-08-02T10:00:00.000Z",
    },
  ]);

  for (const malformed of [
    { ownerId: "40000000-0000-4000-8000-000000000001", notifications: [requested] },
    { ownerId: OWNER_ID, notifications: [{ ...requested, action_id: "not-a-uuid" }] },
    { ownerId: OWNER_ID, notifications: [{ ...requested, href: "/not-allowed" }] },
    { ownerId: OWNER_ID, notifications: [{ ...requested, created_at: "yesterday" }] },
  ]) {
    assert.throws(
      () => parseScheduleApprovalNotifications(malformed, OWNER_ID),
      /INVALID_SCHEDULE_APPROVAL_NOTIFICATIONS/,
    );
  }
});

test("the active schedule inbox is bound to the exact owner and couple without notification-history loss", () => {
  const secondRequestId = "20000000-0000-4000-8000-000000000002";
  assert.deepEqual(parseScheduleActiveApprovalInbox({
    ownerId: OWNER_ID.toUpperCase(),
    coupleId: COUPLE_ID.toUpperCase(),
    requests: [
      {
        requestId: REQUEST_ID,
        role: "reviewer",
        createdAt: "2026-08-02T10:00:00.000Z",
      },
      {
        requestId: secondRequestId,
        role: "requester",
        createdAt: "2026-08-02T11:00:00.000Z",
      },
    ],
  }, OWNER_ID, COUPLE_ID), [
    {
      requestId: secondRequestId,
      role: "requester",
      createdAt: "2026-08-02T11:00:00.000Z",
    },
    {
      requestId: REQUEST_ID,
      role: "reviewer",
      createdAt: "2026-08-02T10:00:00.000Z",
    },
  ]);

  for (const malformed of [
    { ownerId: PARTNER_ID, coupleId: COUPLE_ID, requests: [] },
    { ownerId: OWNER_ID, coupleId: PARTNER_ID, requests: [] },
    {
      ownerId: OWNER_ID,
      coupleId: COUPLE_ID,
      requests: [{
        requestId: REQUEST_ID,
        role: "other",
        createdAt: "2026-08-02T10:00:00.000Z",
      }],
    },
    {
      ownerId: OWNER_ID,
      coupleId: COUPLE_ID,
      requests: [
        {
          requestId: REQUEST_ID,
          role: "reviewer",
          createdAt: "2026-08-02T10:00:00.000Z",
        },
        {
          requestId: REQUEST_ID,
          role: "reviewer",
          createdAt: "2026-08-02T10:00:00.000Z",
        },
      ],
    },
  ]) {
    assert.throws(
      () => parseScheduleActiveApprovalInbox(malformed, OWNER_ID, COUPLE_ID),
      /INVALID_SCHEDULE_ACTIVE_APPROVAL_INBOX/,
    );
  }
});

test("loading the schedule inbox confirms every active server request against its latest status", async () => {
  const terminalRequestId = "20000000-0000-4000-8000-000000000002";
  const calls = [];
  const fetcher = async (path, options = {}) => {
    calls.push({ path, options });
    if (path === "/api/couple-plan-changes/active") {
      return response(200, {
        ownerId: OWNER_ID,
        coupleId: COUPLE_ID,
        requests: [
          { requestId: REQUEST_ID, role: "reviewer", createdAt: "2026-08-02T12:00:00.000Z" },
          { requestId: terminalRequestId, role: "requester", createdAt: "2026-08-02T11:00:00.000Z" },
        ],
      });
    }
    if (path.endsWith(REQUEST_ID)) {
      return response(200, pendingStatus(REQUEST_ID));
    }
    return response(200, {
      ...pendingStatus(terminalRequestId),
      status: "rejected",
    });
  };

  assert.deepEqual(await fetchScheduleApprovalInbox({
    apiFetch: fetcher,
    ownerId: OWNER_ID,
    coupleId: COUPLE_ID,
  }), {
    requests: [{
      requestId: REQUEST_ID,
      role: "reviewer",
      createdAt: "2026-08-02T12:00:00.000Z",
      summary: "일정: 드레스 피팅 · 2026-08-20 14:00",
      proposal: { kind: "other" },
    }],
    definitivelyRemovedIds: [terminalRequestId],
    partial: false,
  });
  assert.deepEqual(calls.map(({ path, options }) => ({
    path,
    method: options.method ?? "GET",
  })), [
    { path: "/api/couple-plan-changes/active", method: "GET" },
    { path: `/api/couple-plan-changes/${REQUEST_ID}`, method: "GET" },
    { path: `/api/couple-plan-changes/${terminalRequestId}`, method: "GET" },
  ]);
});

test("the authoritative active inbox keeps status checks bounded and preserves verified cards on a partial outage", async () => {
  const rows = Array.from({ length: 20 }, (_, index) => ({
    requestId: requestIdFor(index),
    role: index % 2 === 0 ? "reviewer" : "requester",
    createdAt: new Date(Date.UTC(2026, 7, 2, 0, 0, index)).toISOString(),
  }));
  const activeRequestId = requestIdFor(19);
  const unavailableRequestId = requestIdFor(18);
  let statusChecks = 0;
  let inFlight = 0;
  let maximumInFlight = 0;
  const fetcher = async (path) => {
    if (path === "/api/couple-plan-changes/active") {
      return response(200, {
        ownerId: OWNER_ID,
        coupleId: COUPLE_ID,
        requests: rows,
      });
    }
    statusChecks += 1;
    inFlight += 1;
    maximumInFlight = Math.max(maximumInFlight, inFlight);
    await delay(1);
    inFlight -= 1;
    const requestId = path.split("/").at(-1);
    if (requestId === unavailableRequestId) {
      return response(429, { error: "rate limited" });
    }
    if (requestId === activeRequestId) {
      return response(200, pendingStatus(activeRequestId));
    }
    return response(200, {
      ...pendingStatus(requestId),
      status: "rejected",
    });
  };

  const result = await fetchScheduleApprovalInbox({
    apiFetch: fetcher,
    ownerId: OWNER_ID,
    coupleId: COUPLE_ID,
  });

  assert.equal(statusChecks, 20);
  assert.ok(maximumInFlight <= 4);
  assert.equal(result.partial, true);
  assert.deepEqual(result.requests.map(({ requestId }) => requestId), [activeRequestId]);
});

test("a partial refresh preserves previously verified cards while a complete refresh replaces them", () => {
  const current = [{
    requestId: REQUEST_ID,
    role: "reviewer",
    createdAt: "2026-08-02T10:00:00.000Z",
    summary: "기존 검증 요청",
  }];
  const nextRequestId = "20000000-0000-4000-8000-000000000002";
  const next = [{
    requestId: nextRequestId,
    role: "requester",
    createdAt: "2026-08-02T11:00:00.000Z",
    summary: "새로 검증한 요청",
  }];

  assert.deepEqual(mergeScheduleApprovalInbox(current, {
    requests: next,
    definitivelyRemovedIds: [],
    partial: true,
  }).map(({ requestId }) => requestId), [nextRequestId, REQUEST_ID]);
  assert.deepEqual(mergeScheduleApprovalInbox(current, {
    requests: [],
    definitivelyRemovedIds: [],
    partial: false,
  }), []);
});

test("a partial refresh removes cards that this refresh definitively found terminal", async () => {
  const terminalRequestId = "20000000-0000-4000-8000-000000000002";
  const current = [
    {
      requestId: REQUEST_ID,
      role: "reviewer",
      createdAt: "2026-08-02T12:00:00.000Z",
      summary: "상태 확인 실패 요청",
    },
    {
      requestId: terminalRequestId,
      role: "requester",
      createdAt: "2026-08-02T11:00:00.000Z",
      summary: "종료된 요청",
    },
  ];
  const fetcher = async (path) => {
    if (path === "/api/couple-plan-changes/active") {
      return response(200, {
        ownerId: OWNER_ID,
        coupleId: COUPLE_ID,
        requests: [
          { requestId: REQUEST_ID, role: "reviewer", createdAt: "2026-08-02T12:00:00.000Z" },
          { requestId: terminalRequestId, role: "requester", createdAt: "2026-08-02T11:00:00.000Z" },
        ],
      });
    }
    if (path.endsWith(REQUEST_ID)) {
      return response(429, { error: "rate limited" });
    }
    return response(200, {
      ...pendingStatus(terminalRequestId),
      status: "rejected",
    });
  };

  const result = await fetchScheduleApprovalInbox({
    apiFetch: fetcher,
    ownerId: OWNER_ID,
    coupleId: COUPLE_ID,
  });

  assert.equal(result.partial, true);
  assert.deepEqual(result.definitivelyRemovedIds, [terminalRequestId]);
  assert.deepEqual(
    mergeScheduleApprovalInbox(current, result).map(({ requestId }) => requestId),
    [REQUEST_ID],
  );
});

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function pendingStatus(requestId) {
  return {
    requestId,
    status: "pending_partner",
    requiredCount: 2,
    acceptedCount: 1,
    summary: "일정: 드레스 피팅 · 2026-08-20 14:00",
    surface: "/schedule",
    proposal: { kind: "other" },
  };
}

function requestIdFor(index) {
  return `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
}
