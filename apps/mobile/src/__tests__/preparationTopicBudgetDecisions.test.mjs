import assert from "node:assert/strict";
import test from "node:test";

import {
  PreparationTopicBudgetDecisionError,
  loadPreparationTopicBudgetDecisions,
} from "../lib/preparationTopicBudgetDecisions.mjs";

const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const PARTNER_ID = "20000000-0000-4000-8000-000000000002";
const COUPLE_ID = "30000000-0000-4000-8000-000000000003";
const REQUEST_ID = "40000000-0000-4000-8000-000000000004";
const DECISION_ID = "50000000-0000-4000-8000-000000000005";

function exactInput() {
  const topicSnapshot = {
    category: "venue",
    budget: 20_000_000,
    spent: 2_000_000,
    payer: "couple",
  };
  const progress = { venue: topicSnapshot };
  const acceptances = [
    { userId: OWNER_ID, acceptedAt: "2026-08-15T09:00:00.000Z" },
    { userId: PARTNER_ID, acceptedAt: "2026-08-15T09:04:00.000Z" },
  ];
  const receipt = {
    id: DECISION_ID,
    couple_id: COUPLE_ID,
    category: "budget",
    decision_type: "decided",
    title: "진행 상황: 1개 수정",
    visibility: "shared",
    source: "manual",
    source_ref_id: REQUEST_ID,
    source_actor_role: "bride",
    source_message_id: null,
    memory_key: null,
    chosen_value: {
      schemaVersion: 1,
      requestId: REQUEST_ID,
      changeDigest: "a".repeat(64),
      expectedRevision: 7,
      appliedRevision: 8,
      requiredCount: 2,
      acceptances,
      mutationKind: null,
      eventId: null,
      before: null,
      after: null,
      changes: { progress_patch: { venue: topicSnapshot } },
    },
    metadata: {
      origin: "couple_plan_change_request",
      requestId: REQUEST_ID,
      changeDigest: "a".repeat(64),
      rosterFingerprint: "b".repeat(32),
      expectedRevision: 7,
      appliedRevision: 8,
      requiredCount: 2,
      acceptances,
      mutationKind: null,
      eventId: null,
      before: null,
      after: null,
      surfaceHref: "/budget",
      previousStatus: "applying",
    },
    user_confirmed_at: "2026-08-15T09:00:00.000Z",
    decided_at: "2026-08-15T09:05:00.000Z",
    superseded_at: null,
    superseded_by: null,
  };
  const statusPayload = {
    requestId: REQUEST_ID,
    status: "applied",
    requiredCount: 2,
    acceptedCount: 2,
    summary: receipt.title,
    surface: "/budget",
    journey: {
      couple_id: COUPLE_ID,
      state_revision: 8,
      total_budget: 50_000_000,
      progress,
      private_field_not_for_projection: "drop-me",
    },
  };
  return { progress, receipt, statusPayload, topicSnapshot };
}

test("the latest exact budget receipt gets one status check and a minimal verification projection", async () => {
  const { progress, receipt, statusPayload, topicSnapshot } = exactInput();
  const reads = [];
  const fetches = [];

  const result = await loadPreparationTopicBudgetDecisions({
    ownerId: OWNER_ID,
    coupleId: COUPLE_ID,
    currentJourneyRevision: 8,
    progress,
    isCurrent: () => true,
    readDecisionRows: async (request) => {
      reads.push(request);
      return [receipt];
    },
    apiFetch: async (path, request) => {
      fetches.push({ path, request });
      return new globalThis.Response(JSON.stringify(statusPayload), { status: 200 });
    },
  });

  assert.equal(reads.length, 1);
  assert.equal(reads[0].ownerId, OWNER_ID);
  assert.equal(reads[0].coupleId, COUPLE_ID);
  assert.equal(reads[0].currentJourneyRevision, 8);
  assert.equal(reads[0].limit, 81);
  assert.equal(reads[0].signal instanceof globalThis.AbortSignal, true);
  assert.equal(fetches.length, 1);
  assert.equal(fetches[0].path, `/api/couple-plan-changes/${REQUEST_ID}`);
  assert.equal(fetches[0].request.method, "GET");
  assert.equal(fetches[0].request.signal, reads[0].signal);
  assert.deepEqual(result, {
    budgetDecisionReceipts: [receipt],
    budgetDecisionVerifications: [
      {
        requestId: REQUEST_ID,
        status: "applied",
        requiredCount: 2,
        acceptedCount: 2,
        summary: receipt.title,
        surface: "/budget",
        journey: {
          coupleId: COUPLE_ID,
          stateRevision: 8,
          topicKey: "venue",
          topicSnapshot,
        },
      },
    ],
    partial: false,
  });
});

test("venue revision eight and meeting revision nine are verified independently", async () => {
  const { progress: venueProgress, receipt: venueReceipt, statusPayload } = exactInput();
  const meetingRequestId = "40000000-0000-4000-8000-000000000024";
  const meetingSnapshot = {
    category: "meeting",
    budget: 3_000_000,
    spent: 500_000,
    payer: "couple",
  };
  const progress = { ...venueProgress, meeting: meetingSnapshot };
  const meetingReceipt = {
    ...venueReceipt,
    id: "50000000-0000-4000-8000-000000000025",
    source_ref_id: meetingRequestId,
    chosen_value: {
      ...venueReceipt.chosen_value,
      requestId: meetingRequestId,
      changeDigest: "c".repeat(64),
      expectedRevision: 8,
      appliedRevision: 9,
      changes: { progress_patch: { meeting: meetingSnapshot } },
    },
    metadata: {
      ...venueReceipt.metadata,
      requestId: meetingRequestId,
      changeDigest: "c".repeat(64),
      expectedRevision: 8,
      appliedRevision: 9,
    },
    decided_at: "2026-08-15T10:05:00.000Z",
  };
  const statusByRequestId = new Map([
    [REQUEST_ID, {
      ...statusPayload,
      journey: { ...statusPayload.journey, state_revision: 9, progress },
    }],
    [meetingRequestId, {
      ...statusPayload,
      requestId: meetingRequestId,
      journey: { ...statusPayload.journey, state_revision: 9, progress },
    }],
  ]);
  const fetchedRequestIds = [];

  const result = await loadPreparationTopicBudgetDecisions({
    ownerId: OWNER_ID,
    coupleId: COUPLE_ID,
    currentJourneyRevision: 9,
    progress,
    isCurrent: () => true,
    readDecisionRows: async () => [venueReceipt, meetingReceipt],
    apiFetch: async (path) => {
      const requestId = path.split("/").at(-1);
      fetchedRequestIds.push(requestId);
      return new globalThis.Response(
        JSON.stringify(statusByRequestId.get(requestId)),
        { status: 200 },
      );
    },
  });

  assert.deepEqual(fetchedRequestIds.sort(), [REQUEST_ID, meetingRequestId].sort());
  assert.deepEqual(result.budgetDecisionReceipts, [meetingReceipt, venueReceipt]);
  assert.deepEqual(
    result.budgetDecisionVerifications.map((verification) => ({
      requestId: verification.requestId,
      topicKey: verification.journey.topicKey,
    })),
    [
      { requestId: meetingRequestId, topicKey: "meeting" },
      { requestId: REQUEST_ID, topicKey: "venue" },
    ],
  );
  assert.equal(result.partial, false);
});

test("an invalid latest meeting receipt does not hide an independently valid venue receipt", async () => {
  const { progress: venueProgress, receipt: venueReceipt, statusPayload } = exactInput();
  const meetingSnapshot = {
    category: "meeting",
    budget: 3_000_000,
    spent: 500_000,
    payer: "couple",
  };
  const progress = { ...venueProgress, meeting: meetingSnapshot };
  const olderMeetingRequestId = "40000000-0000-4000-8000-000000000034";
  const olderMeetingReceipt = {
    ...venueReceipt,
    id: "50000000-0000-4000-8000-000000000035",
    source_ref_id: olderMeetingRequestId,
    chosen_value: {
      ...venueReceipt.chosen_value,
      requestId: olderMeetingRequestId,
      changeDigest: "d".repeat(64),
      expectedRevision: 6,
      appliedRevision: 7,
      changes: { progress_patch: { meeting: meetingSnapshot } },
    },
    metadata: {
      ...venueReceipt.metadata,
      requestId: olderMeetingRequestId,
      changeDigest: "d".repeat(64),
      expectedRevision: 6,
      appliedRevision: 7,
    },
  };
  const latestMeetingRequestId = "40000000-0000-4000-8000-000000000044";
  const invalidLatestMeetingReceipt = {
    ...olderMeetingReceipt,
    id: "50000000-0000-4000-8000-000000000045",
    source_ref_id: latestMeetingRequestId,
    chosen_value: {
      ...olderMeetingReceipt.chosen_value,
      requestId: latestMeetingRequestId,
      changeDigest: "e".repeat(64),
      expectedRevision: 8,
      appliedRevision: 9,
    },
    metadata: {
      ...olderMeetingReceipt.metadata,
      requestId: latestMeetingRequestId,
      changeDigest: "e".repeat(64),
      expectedRevision: 8,
      appliedRevision: 9,
      aiExtracted: true,
    },
  };
  const fetchedRequestIds = [];

  const result = await loadPreparationTopicBudgetDecisions({
    ownerId: OWNER_ID,
    coupleId: COUPLE_ID,
    currentJourneyRevision: 9,
    progress,
    isCurrent: () => true,
    readDecisionRows: async () => [
      venueReceipt,
      olderMeetingReceipt,
      invalidLatestMeetingReceipt,
    ],
    apiFetch: async (path) => {
      fetchedRequestIds.push(path.split("/").at(-1));
      return new globalThis.Response(JSON.stringify({
        ...statusPayload,
        journey: { ...statusPayload.journey, state_revision: 9, progress },
      }), { status: 200 });
    },
  });

  assert.deepEqual(fetchedRequestIds, [REQUEST_ID]);
  assert.deepEqual(result.budgetDecisionReceipts, [venueReceipt]);
  assert.deepEqual(
    result.budgetDecisionVerifications.map((verification) => ({
      requestId: verification.requestId,
      topicKey: verification.journey.topicKey,
    })),
    [{ requestId: REQUEST_ID, topicKey: "venue" }],
  );
  assert.equal(result.partial, true);
});

test("one failed status read keeps another verified topic and marks the result partial", async () => {
  const { progress: venueProgress, receipt: venueReceipt, statusPayload } = exactInput();
  const meetingRequestId = "40000000-0000-4000-8000-000000000054";
  const meetingSnapshot = {
    category: "meeting",
    budget: 3_000_000,
    spent: 500_000,
    payer: "couple",
  };
  const progress = { ...venueProgress, meeting: meetingSnapshot };
  const meetingReceipt = {
    ...venueReceipt,
    id: "50000000-0000-4000-8000-000000000055",
    source_ref_id: meetingRequestId,
    chosen_value: {
      ...venueReceipt.chosen_value,
      requestId: meetingRequestId,
      changeDigest: "f".repeat(64),
      expectedRevision: 8,
      appliedRevision: 9,
      changes: { progress_patch: { meeting: meetingSnapshot } },
    },
    metadata: {
      ...venueReceipt.metadata,
      requestId: meetingRequestId,
      changeDigest: "f".repeat(64),
      expectedRevision: 8,
      appliedRevision: 9,
    },
  };
  const fetchedRequestIds = [];

  const result = await loadPreparationTopicBudgetDecisions({
    ownerId: OWNER_ID,
    coupleId: COUPLE_ID,
    currentJourneyRevision: 9,
    progress,
    isCurrent: () => true,
    readDecisionRows: async () => [venueReceipt, meetingReceipt],
    apiFetch: async (path) => {
      const requestId = path.split("/").at(-1);
      fetchedRequestIds.push(requestId);
      if (requestId === meetingRequestId) {
        return new globalThis.Response(null, { status: 503 });
      }
      return new globalThis.Response(JSON.stringify({
        ...statusPayload,
        journey: { ...statusPayload.journey, state_revision: 9, progress },
      }), { status: 200 });
    },
  });

  assert.deepEqual(fetchedRequestIds.sort(), [REQUEST_ID, meetingRequestId].sort());
  assert.deepEqual(result.budgetDecisionReceipts, [venueReceipt]);
  assert.deepEqual(
    result.budgetDecisionVerifications.map((verification) => verification.requestId),
    [REQUEST_ID],
  );
  assert.equal(result.partial, true);
});

test("status fan-out is bounded to the twenty-one canonical progress topics", async () => {
  const canonicalTopicKeys = [
    "greeting",
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
  "registration",
  ];
  const { receipt: receiptTemplate, statusPayload } = exactInput();
  const progress = Object.fromEntries(canonicalTopicKeys.map((topicKey, index) => [
    topicKey,
    {
      category: topicKey,
      budget: 1_000_000 + index,
      spent: index,
      payer: "couple",
    },
  ]));
  progress.__events = { category: "__events", protected: true };
  progress.unlisted = { category: "unlisted", protected: true };
  const makeReceipt = (topicKey, index) => {
    const suffix = String(100 + index).padStart(12, "0");
    const requestId = `40000000-0000-4000-8000-${suffix}`;
    return {
      ...receiptTemplate,
      id: `50000000-0000-4000-8000-${suffix}`,
      source_ref_id: requestId,
      chosen_value: {
        ...receiptTemplate.chosen_value,
        requestId,
        changeDigest: index.toString(16).padStart(64, "0"),
        expectedRevision: index,
        appliedRevision: index + 1,
        changes: { progress_patch: { [topicKey]: progress[topicKey] } },
      },
      metadata: {
        ...receiptTemplate.metadata,
        requestId,
        changeDigest: index.toString(16).padStart(64, "0"),
        expectedRevision: index,
        appliedRevision: index + 1,
      },
    };
  };
  const receipts = canonicalTopicKeys.map(makeReceipt);
  const excludedReceipts = [
    makeReceipt("__events", 22),
    makeReceipt("unlisted", 23),
  ];
  const receiptByRequestId = new Map(
    receipts.map((receipt) => [receipt.source_ref_id, receipt]),
  );
  const fetchedRequestIds = [];
  let releaseStatuses;
  const allCanonicalRequestsStarted = new Promise((resolve) => {
    releaseStatuses = resolve;
  });

  const result = await loadPreparationTopicBudgetDecisions({
    ownerId: OWNER_ID,
    coupleId: COUPLE_ID,
    currentJourneyRevision: 21,
    progress,
    timeoutMs: 250,
    isCurrent: () => true,
    readDecisionRows: async () => [...receipts, ...excludedReceipts],
    apiFetch: async (path) => {
      const requestId = path.split("/").at(-1);
      fetchedRequestIds.push(requestId);
      if (fetchedRequestIds.length === canonicalTopicKeys.length) {
        releaseStatuses();
      }
      await allCanonicalRequestsStarted;
      const receipt = receiptByRequestId.get(requestId);
      assert.ok(receipt, `unexpected status request ${requestId}`);
      return new globalThis.Response(JSON.stringify({
        ...statusPayload,
        requestId,
        summary: receipt.title,
        journey: { ...statusPayload.journey, state_revision: 21, progress },
      }), { status: 200 });
    },
  });

  assert.equal(fetchedRequestIds.length, 21);
  assert.equal(new Set(fetchedRequestIds).size, 21);
  assert.deepEqual(
    result.budgetDecisionReceipts.map((receipt) => receipt.source_ref_id),
    receipts.map((receipt) => receipt.source_ref_id),
  );
  assert.equal(result.budgetDecisionVerifications.length, 21);
  assert.deepEqual(
    result.budgetDecisionVerifications.map((verification) => verification.journey.topicKey),
    canonicalTopicKeys,
  );
  assert.equal(result.partial, false);
});

test("one request id claimed by two topics is never status-checked", async () => {
  const { progress: venueProgress, receipt: venueReceipt } = exactInput();
  const meetingSnapshot = {
    category: "meeting",
    budget: 3_000_000,
    spent: 500_000,
    payer: "couple",
  };
  const progress = { ...venueProgress, meeting: meetingSnapshot };
  const meetingReceiptWithDuplicateRequest = {
    ...venueReceipt,
    id: "50000000-0000-4000-8000-000000000065",
    chosen_value: {
      ...venueReceipt.chosen_value,
      expectedRevision: 8,
      appliedRevision: 9,
      changes: { progress_patch: { meeting: meetingSnapshot } },
    },
    metadata: {
      ...venueReceipt.metadata,
      expectedRevision: 8,
      appliedRevision: 9,
    },
  };
  let statusReads = 0;

  const result = await loadPreparationTopicBudgetDecisions({
    ownerId: OWNER_ID,
    coupleId: COUPLE_ID,
    currentJourneyRevision: 9,
    progress,
    isCurrent: () => true,
    readDecisionRows: async () => [venueReceipt, meetingReceiptWithDuplicateRequest],
    apiFetch: async () => {
      statusReads += 1;
      throw new Error("duplicate request must not be fetched");
    },
  });

  assert.equal(statusReads, 0);
  assert.deepEqual(result, {
    budgetDecisionReceipts: [],
    budgetDecisionVerifications: [],
    partial: true,
  });
});

test("a generic latest touching row blocks older fallback without issuing a status request", async () => {
  const { progress, receipt } = exactInput();
  const latestRequestId = "40000000-0000-4000-8000-000000000014";
  const latest = {
    ...receipt,
    id: "50000000-0000-4000-8000-000000000015",
    source_ref_id: latestRequestId,
    chosen_value: {
      ...receipt.chosen_value,
      requestId: latestRequestId,
      changeDigest: "c".repeat(64),
      expectedRevision: 8,
      appliedRevision: 9,
    },
    metadata: {
      ...receipt.metadata,
      requestId: latestRequestId,
      changeDigest: "c".repeat(64),
      expectedRevision: 8,
      appliedRevision: 9,
      aiExtracted: true,
    },
    decided_at: "2026-08-15T10:05:00.000Z",
  };
  let statusReads = 0;

  const result = await loadPreparationTopicBudgetDecisions({
    ownerId: OWNER_ID,
    coupleId: COUPLE_ID,
    currentJourneyRevision: 9,
    progress,
    isCurrent: () => true,
    readDecisionRows: async () => [receipt, latest],
    apiFetch: async () => {
      statusReads += 1;
      throw new Error("unexpected status read");
    },
  });

  assert.equal(statusReads, 0);
  assert.deepEqual(result, {
    budgetDecisionReceipts: [],
    budgetDecisionVerifications: [],
    partial: true,
  });
});

test("an applied status whose confirmation count disagrees with the receipt is unavailable", async () => {
  const { progress, receipt, statusPayload } = exactInput();

  await assert.rejects(
    loadPreparationTopicBudgetDecisions({
      ownerId: OWNER_ID,
      coupleId: COUPLE_ID,
      currentJourneyRevision: 8,
      progress,
      isCurrent: () => true,
      readDecisionRows: async () => [receipt],
      apiFetch: async () => new globalThis.Response(JSON.stringify({
        ...statusPayload,
        requiredCount: 1,
        acceptedCount: 1,
      }), { status: 200 }),
    }),
    (error) => error?.code === "invalid_response",
  );
});

test("an unconfirmed touching row is not status-checked as an exact receipt", async () => {
  const { progress, receipt } = exactInput();
  let statusReads = 0;

  const result = await loadPreparationTopicBudgetDecisions({
    ownerId: OWNER_ID,
    coupleId: COUPLE_ID,
    currentJourneyRevision: 8,
    progress,
    isCurrent: () => true,
    readDecisionRows: async () => [{ ...receipt, user_confirmed_at: null }],
    apiFetch: async () => {
      statusReads += 1;
      throw new Error("unexpected status read");
    },
  });

  assert.equal(statusReads, 0);
  assert.deepEqual(result, {
    budgetDecisionReceipts: [],
    budgetDecisionVerifications: [],
    partial: true,
  });
});

test("the N plus one decision boundary keeps a verified candidate but marks the read partial", async () => {
  const { progress, receipt, statusPayload } = exactInput();
  const rows = [
    ...Array.from({ length: 80 }, (_, index) => ({
      id: `irrelevant-${index}`,
      chosen_value: null,
    })),
    receipt,
  ];
  let receivedLimit = null;
  let statusReads = 0;

  const result = await loadPreparationTopicBudgetDecisions({
    ownerId: OWNER_ID,
    coupleId: COUPLE_ID,
    currentJourneyRevision: 8,
    progress,
    isCurrent: () => true,
    readDecisionRows: async ({ limit }) => {
      receivedLimit = limit;
      return rows;
    },
    apiFetch: async () => {
      statusReads += 1;
      return new globalThis.Response(JSON.stringify(statusPayload), { status: 200 });
    },
  });

  assert.equal(receivedLimit, 81);
  assert.equal(statusReads, 1);
  assert.deepEqual(result.budgetDecisionReceipts, [receipt]);
  assert.equal(result.budgetDecisionVerifications[0]?.requestId, REQUEST_ID);
  assert.equal(result.partial, true);
});

test("a status transport failure is thrown as unavailable instead of becoming an empty or partial read", async () => {
  const { progress, receipt } = exactInput();

  await assert.rejects(
    loadPreparationTopicBudgetDecisions({
      ownerId: OWNER_ID,
      coupleId: COUPLE_ID,
      currentJourneyRevision: 8,
      progress,
      isCurrent: () => true,
      readDecisionRows: async () => [receipt],
      apiFetch: async () => {
        throw new Error("offline");
      },
    }),
    (error) => error instanceof PreparationTopicBudgetDecisionError
      && error.code === "read_failed",
  );
});

test("a decision query failure is thrown as unavailable", async () => {
  const { progress } = exactInput();

  await assert.rejects(
    loadPreparationTopicBudgetDecisions({
      ownerId: OWNER_ID,
      coupleId: COUPLE_ID,
      currentJourneyRevision: 8,
      progress,
      isCurrent: () => true,
      readDecisionRows: async () => {
        throw new Error("offline");
      },
      apiFetch: async () => {
        throw new Error("unreachable");
      },
    }),
    (error) => error instanceof PreparationTopicBudgetDecisionError
      && error.code === "read_failed",
  );
});

test("one deadline aborts and settles the whole optional read even when a dependency hangs", async () => {
  const { progress } = exactInput();
  let receivedSignal = null;
  const outcome = await Promise.race([
    loadPreparationTopicBudgetDecisions({
      ownerId: OWNER_ID,
      coupleId: COUPLE_ID,
      currentJourneyRevision: 8,
      progress,
      timeoutMs: 10,
      isCurrent: () => true,
      readDecisionRows: async ({ signal }) => {
        receivedSignal = signal;
        return new Promise(() => {});
      },
      apiFetch: async () => {
        throw new Error("unreachable");
      },
    }).then(
      () => ({ status: "unexpected_success" }),
      (error) => ({ status: "error", code: error?.code }),
    ),
    new Promise((resolve) => globalThis.setTimeout(
      () => resolve({ status: "test_transport_hung" }),
      100,
    )),
  ]);

  assert.deepEqual(outcome, { status: "error", code: "timeout" });
  assert.equal(receivedSignal?.aborted, true);
});

test("the identity fence is checked before and after every decision, status, and payload await", async () => {
  const { progress, receipt, statusPayload } = exactInput();
  const expectedAwaitsByFailedCheck = [0, 0, 1, 1, 2, 2, 3, 3, 3];

  for (let failedCheck = 1; failedCheck <= 9; failedCheck += 1) {
    let checks = 0;
    let awaits = 0;
    await assert.rejects(
      loadPreparationTopicBudgetDecisions({
        ownerId: OWNER_ID,
        coupleId: COUPLE_ID,
        currentJourneyRevision: 8,
        progress,
        isCurrent: () => {
          checks += 1;
          return checks !== failedCheck;
        },
        readDecisionRows: async () => {
          awaits += 1;
          return [receipt];
        },
        apiFetch: async () => {
          awaits += 1;
          return {
            ok: true,
            async json() {
              awaits += 1;
              return statusPayload;
            },
          };
        },
      }),
      (error) => error?.code === "stale_context",
      `failed check ${failedCheck}`,
    );
    assert.equal(
      awaits,
      expectedAwaitsByFailedCheck[failedCheck - 1],
      `failed check ${failedCheck}`,
    );
  }
});
