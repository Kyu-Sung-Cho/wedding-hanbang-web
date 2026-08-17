import assert from "node:assert/strict";
import test from "node:test";

import {
  PreparationTopicVendorBookingError,
  loadPreparationTopicVendorBookings,
} from "../lib/preparationTopicVendorBookings.mjs";

const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const PARTNER_ID = "20000000-0000-4000-8000-000000000002";
const COUPLE_ID = "30000000-0000-4000-8000-000000000003";
const BOOKING_IDS = [
  "40000000-0000-4000-8000-000000000004",
  "50000000-0000-4000-8000-000000000005",
];

test("the optional booking read binds the current couple roster before decisions and exact bookings", async () => {
  const calls = [];
  const decisions = BOOKING_IDS.map((bookingId, index) => ({
    id: `60000000-0000-4000-8000-00000000000${index + 1}`,
    source_ref_id: bookingId,
  }));
  const bookings = BOOKING_IDS.map((id) => ({ id }));

  const result = await loadPreparationTopicVendorBookings({
    ownerId: OWNER_ID,
    coupleId: COUPLE_ID,
    isCurrent: () => true,
    readCoupleRoster: async (request) => {
      calls.push({ kind: "roster", request });
      return { id: COUPLE_ID, bride_id: OWNER_ID, groom_id: PARTNER_ID };
    },
    readDecisionRows: async (request) => {
      calls.push({ kind: "decisions", request });
      return decisions;
    },
    readBookingRows: async (request) => {
      calls.push({ kind: "bookings", request });
      return bookings;
    },
  });

  assert.deepEqual(calls.map(({ kind }) => kind), ["roster", "decisions", "bookings"]);
  for (const { request } of calls) {
    assert.equal(request.ownerId, OWNER_ID);
    assert.equal(request.coupleId, COUPLE_ID);
    assert.equal(request.signal instanceof globalThis.AbortSignal, true);
  }
  assert.equal(calls[1].request.limit, 81);
  assert.deepEqual(calls[2].request.bookingIds, BOOKING_IDS);
  assert.deepEqual(result, {
    currentCoupleMemberIds: [OWNER_ID, PARTNER_ID],
    vendorBookingDecisionReceipts: decisions,
    vendorBookings: bookings,
    partial: false,
  });
});

test("invalid owner or couple identities fail before any read", async () => {
  let reads = 0;
  const dependencies = {
    isCurrent: () => true,
    readCoupleRoster: async () => { reads += 1; },
    readDecisionRows: async () => { reads += 1; },
    readBookingRows: async () => { reads += 1; },
  };

  for (const identity of [
    { ownerId: "not-a-uuid", coupleId: COUPLE_ID },
    { ownerId: OWNER_ID, coupleId: "not-a-uuid" },
  ]) {
    await assert.rejects(
      loadPreparationTopicVendorBookings({ ...identity, ...dependencies }),
      (error) => error instanceof PreparationTopicVendorBookingError
        && error.code === "invalid_request",
    );
  }
  assert.equal(reads, 0);
});

test("the roster must exactly match the couple with one or two unique UUID members including the owner", async () => {
  const invalidRosters = [
    null,
    { id: "90000000-0000-4000-8000-000000000009", bride_id: OWNER_ID, groom_id: PARTNER_ID },
    { id: COUPLE_ID, bride_id: "not-a-uuid", groom_id: PARTNER_ID },
    { id: COUPLE_ID, bride_id: OWNER_ID, groom_id: OWNER_ID },
    { id: COUPLE_ID, bride_id: null, groom_id: null },
    {
      id: COUPLE_ID,
      bride_id: "70000000-0000-4000-8000-000000000007",
      groom_id: PARTNER_ID,
    },
  ];

  for (const roster of invalidRosters) {
    let laterRead = false;
    await assert.rejects(
      loadPreparationTopicVendorBookings({
        ownerId: OWNER_ID,
        coupleId: COUPLE_ID,
        isCurrent: () => true,
        readCoupleRoster: async () => roster,
        readDecisionRows: async () => { laterRead = true; return []; },
        readBookingRows: async () => { laterRead = true; return []; },
      }),
      (error) => error?.code === "invalid_roster",
    );
    assert.equal(laterRead, false);
  }
});

test("a current single-member couple roster is valid while the partner slot is empty", async () => {
  const result = await loadPreparationTopicVendorBookings({
    ownerId: OWNER_ID,
    coupleId: COUPLE_ID,
    isCurrent: () => true,
    readCoupleRoster: async () => ({
      id: COUPLE_ID,
      bride_id: null,
      groom_id: OWNER_ID,
    }),
    readDecisionRows: async () => [],
    readBookingRows: async () => [],
  });

  assert.deepEqual(result.currentCoupleMemberIds, [OWNER_ID]);
});

test("no valid booking reference returns raw decisions without issuing a booking read", async () => {
  const decisions = [
    { id: "raw-null", source_ref_id: null },
    { id: "raw-invalid", source_ref_id: "not-a-uuid" },
  ];
  let bookingRead = false;
  const result = await loadPreparationTopicVendorBookings({
    ownerId: OWNER_ID,
    coupleId: COUPLE_ID,
    isCurrent: () => true,
    readCoupleRoster: async () => ({
      id: COUPLE_ID,
      bride_id: OWNER_ID,
      groom_id: PARTNER_ID,
    }),
    readDecisionRows: async () => decisions,
    readBookingRows: async () => { bookingRead = true; return []; },
  });

  assert.equal(bookingRead, false);
  assert.deepEqual(result.vendorBookingDecisionReceipts, decisions);
  assert.deepEqual(result.vendorBookings, []);
  assert.equal(result.partial, false);
});

test("non-array decision or booking payloads fail closed", async () => {
  const common = {
    ownerId: OWNER_ID,
    coupleId: COUPLE_ID,
    isCurrent: () => true,
    readCoupleRoster: async () => ({
      id: COUPLE_ID,
      bride_id: OWNER_ID,
      groom_id: PARTNER_ID,
    }),
  };

  await assert.rejects(
    loadPreparationTopicVendorBookings({
      ...common,
      readDecisionRows: async () => null,
      readBookingRows: async () => [],
    }),
    (error) => error?.code === "invalid_response",
  );
  await assert.rejects(
    loadPreparationTopicVendorBookings({
      ...common,
      readDecisionRows: async () => [{ source_ref_id: BOOKING_IDS[0] }],
      readBookingRows: async () => ({ id: BOOKING_IDS[0] }),
    }),
    (error) => error?.code === "invalid_response",
  );
});

test("the N+1 decision read returns the first 80 raw rows and queries only their unique valid booking refs", async () => {
  const firstEighty = [
    { marker: "first", source_ref_id: BOOKING_IDS[0] },
    { marker: "duplicate", source_ref_id: BOOKING_IDS[0] },
    { marker: "invalid", source_ref_id: "not-a-uuid" },
    ...Array.from({ length: 77 }, (_, index) => ({ marker: `raw-${index}`, source_ref_id: null })),
  ];
  const decisionRows = [
    ...firstEighty,
    { marker: "overflow", source_ref_id: BOOKING_IDS[1] },
  ];
  let receivedBookingIds = null;
  const result = await loadPreparationTopicVendorBookings({
    ownerId: OWNER_ID,
    coupleId: COUPLE_ID,
    isCurrent: () => true,
    readCoupleRoster: async () => ({
      id: COUPLE_ID,
      bride_id: OWNER_ID,
      groom_id: PARTNER_ID,
    }),
    readDecisionRows: async () => decisionRows,
    readBookingRows: async ({ bookingIds }) => {
      receivedBookingIds = bookingIds;
      return [{ id: BOOKING_IDS[0], arbitrary: "raw" }];
    },
  });

  assert.deepEqual(receivedBookingIds, [BOOKING_IDS[0]]);
  assert.deepEqual(result.vendorBookingDecisionReceipts, firstEighty);
  assert.deepEqual(result.vendorBookings, [{ id: BOOKING_IDS[0], arbitrary: "raw" }]);
  assert.equal(result.partial, true);
});

test("the current identity fence is checked immediately before and after every read", async () => {
  const expectedReadsByFailedCheck = [0, 1, 1, 2, 2, 3];
  for (let failedCheck = 1; failedCheck <= 6; failedCheck += 1) {
    let checks = 0;
    let reads = 0;
    await assert.rejects(
      loadPreparationTopicVendorBookings({
        ownerId: OWNER_ID,
        coupleId: COUPLE_ID,
        isCurrent: () => {
          checks += 1;
          return checks !== failedCheck;
        },
        readCoupleRoster: async () => {
          reads += 1;
          return { id: COUPLE_ID, bride_id: OWNER_ID, groom_id: PARTNER_ID };
        },
        readDecisionRows: async () => {
          reads += 1;
          return [{ source_ref_id: BOOKING_IDS[0] }];
        },
        readBookingRows: async () => {
          reads += 1;
          return [{ id: BOOKING_IDS[0] }];
        },
      }),
      (error) => error?.code === "stale_context",
      `failed check ${failedCheck}`,
    );
    assert.equal(reads, expectedReadsByFailedCheck[failedCheck - 1]);
  }
});

test("the optional read times out and aborts a dependency that ignores cancellation", async () => {
  let receivedSignal = null;
  const outcome = await Promise.race([
    loadPreparationTopicVendorBookings({
      ownerId: OWNER_ID,
      coupleId: COUPLE_ID,
      timeoutMs: 10,
      isCurrent: () => true,
      readCoupleRoster: async ({ signal }) => {
        receivedSignal = signal;
        return new Promise(() => {});
      },
      readDecisionRows: async () => [],
      readBookingRows: async () => [],
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

test("an external cancellation settles an ignored read and aborts its internal signal", async () => {
  const controller = new globalThis.AbortController();
  let startedResolve;
  const started = new Promise((resolve) => { startedResolve = resolve; });
  let receivedSignal = null;
  const pending = loadPreparationTopicVendorBookings({
    ownerId: OWNER_ID,
    coupleId: COUPLE_ID,
    signal: controller.signal,
    timeoutMs: 1_000,
    isCurrent: () => true,
    readCoupleRoster: async ({ signal }) => {
      receivedSignal = signal;
      startedResolve();
      return new Promise(() => {});
    },
    readDecisionRows: async () => [],
    readBookingRows: async () => [],
  });

  await started;
  controller.abort();
  await assert.rejects(pending, (error) => error?.code === "cancelled");
  assert.equal(receivedSignal?.aborted, true);
});
