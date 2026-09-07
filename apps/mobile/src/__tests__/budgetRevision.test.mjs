import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCategoryBudgetMutation,
  buildTotalBudgetMutation,
  createBudgetRevisionCoordinator,
  fetchActiveBudgetApprovalStatus,
  isBudgetEditBaseCurrent,
  isPendingBudgetApprovalBoundToIdentity,
  parseActiveBudgetApproval,
  parseBudgetApprovalStatusResponse,
  parseManwonInput,
  parseBudgetJourney,
  parseBudgetMutationResponse,
} from "../lib/budgetRevision.mjs";

const OWNER_A = "10000000-0000-4000-8000-000000000001";
const OWNER_B = "10000000-0000-4000-8000-000000000002";
const COUPLE_A = "50000000-0000-4000-8000-000000000001";
const COUPLE_B = "50000000-0000-4000-8000-000000000002";

function journey(overrides = {}) {
  return {
    couple_id: COUPLE_A,
    total_budget: 30_000_000,
    progress: {
      venue: { category: "venue", budget: 10_000_000, spent: 1_000_000, payer: "couple" },
    },
    state_revision: 7,
    ...overrides,
  };
}

test("a budget load rejects a journey whose revision is missing", () => {
  const withoutRevision = journey();
  delete withoutRevision.state_revision;

  assert.throws(
    () => parseBudgetJourney(withoutRevision, COUPLE_A),
    /INVALID_BUDGET_JOURNEY/,
  );
});

test("a budget load returns one validated couple-and-revision snapshot", () => {
  assert.deepEqual(parseBudgetJourney(journey(), COUPLE_A), {
    coupleId: COUPLE_A,
    totalBudget: 30_000_000,
    progress: {
      venue: { category: "venue", budget: 10_000_000, spent: 1_000_000, payer: "couple" },
    },
    stateRevision: 7,
  });
  assert.throws(
    () => parseBudgetJourney(journey(), "50000000-0000-4000-8000-000000000002"),
    /INVALID_BUDGET_JOURNEY/,
  );
});

test("canonical schedule metadata at capacity cannot make the budget snapshot unreadable", () => {
  const events = Array.from({ length: 500 }, (_, index) => ({
    id: `event-${index}`,
    date: "2027-05-01",
    time: "10:00",
    title: `일정 ${index}`,
    status: "planned",
    createdAt: "2026-08-02T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z",
  }));
  const parsed = parseBudgetJourney(journey({
    progress: {
      venue: {
        category: "venue",
        budget: 10_000_000,
        spent: 1_000_000,
        payer: "couple",
      },
      __events: events,
    },
  }), COUPLE_A);

  assert.equal(parsed.progress.__events.length, 500);
  assert.equal(parsed.progress.venue.budget, 10_000_000);
});

test("a budget load fails closed on malformed money, progress, payer, or revision fields", () => {
  const invalidJourneys = [
    journey({ total_budget: "30000000" }),
    journey({ total_budget: 1.5 }),
    journey({ progress: [] }),
    journey({ progress: { venue: { budget: "10000000" } } }),
    journey({ progress: { venue: { payer: "vendor" } } }),
    journey({ progress: { custom: { label: "정상\u202e0001원", cost: 1 } } }),
    journey({ state_revision: -1 }),
  ];
  for (const value of invalidJourneys) {
    assert.throws(
      () => parseBudgetJourney(value, COUPLE_A),
      /INVALID_BUDGET_JOURNEY/,
    );
  }
});

test("만원 input is parsed exactly and cannot use a parseInt prefix", () => {
  assert.equal(parseManwonInput("3500"), 35_000_000);
  assert.equal(parseManwonInput("0"), 0);
  assert.equal(parseManwonInput("0001"), 10_000);
  assert.equal(parseManwonInput("100000"), 1_000_000_000);
  for (const invalid of ["", "12abc", "1.5", "-1", " 12", "12 ", "100001"]) {
    assert.throws(() => parseManwonInput(invalid), /INVALID_MANWON_AMOUNT/);
  }
});

test("budget editors accept at most four decimal manwon digits without rounding a won", () => {
  const snapshot = parseBudgetJourney(journey(), COUPLE_A);
  for (const [input, amount] of [["0.0001", 1], ["0.5", 5_000], ["1.5001", 15_001], ["12345.6789", 123_456_789], ["99999.9999", 999_999_999], ["100000.0000", 1_000_000_000]]) {
    assert.equal(buildTotalBudgetMutation(snapshot, input).total_budget, amount);
    const category = buildCategoryBudgetMutation(snapshot, { categoryKey: "venue", budgetInput: input, spentInput: input, payer: "couple" });
    assert.equal(category.progress_patch.venue.budget, amount);
    assert.equal(category.progress_patch.venue.spent, amount);
  }
  for (const invalid of ["", ".5", "1.", "0.00001", "100000.0001", "1e2", "1,000", "-0.5", " 1", "1 ", "NaN", "Infinity"]) {
    assert.throws(() => buildTotalBudgetMutation(snapshot, invalid), /INVALID_MANWON_AMOUNT/);
  }
});

test("total and category writes bind the loaded revision and loaded progress snapshot", () => {
  const snapshot = parseBudgetJourney(journey(), COUPLE_A);
  assert.deepEqual(buildTotalBudgetMutation(snapshot, "4200"), {
    expected_revision: 7,
    total_budget: 42_000_000,
  });

  const categoryMutation = buildCategoryBudgetMutation(snapshot, {
    categoryKey: "venue",
    budgetInput: "1200",
    spentInput: "250",
    payer: "both_parents",
  });
  assert.deepEqual(categoryMutation, {
    expected_revision: 7,
    progress_patch: {
      venue: {
        category: "venue",
        budget: 12_000_000,
        spent: 2_500_000,
        payer: "both_parents",
      },
    },
  });
  assert.equal(snapshot.progress.venue.budget, 10_000_000);
});

test("an existing canonical custom category can be edited without opening arbitrary progress keys", () => {
  const snapshot = parseBudgetJourney(journey({
    progress: {
      custom_transport: {
        category: "custom_transport",
        label: "차량",
        budget: 2_000_000,
        spent: 3_000_000,
        payer: "couple",
      },
      __preferences: { weddingStyle: "classic" },
    },
  }), COUPLE_A);

  assert.deepEqual(buildCategoryBudgetMutation(snapshot, {
    categoryKey: "custom_transport",
    budgetInput: "250",
    spentInput: "320",
    payer: "both_parents",
  }), {
    expected_revision: 7,
    progress_patch: {
      custom_transport: {
        category: "custom_transport",
        label: "차량",
        budget: 2_500_000,
        spent: 3_200_000,
        payer: "both_parents",
      },
    },
  });

  for (const categoryKey of [
    "custom_missing",
    "__preferences",
    "custom_<script>",
  ]) {
    assert.throws(() => buildCategoryBudgetMutation(snapshot, {
      categoryKey,
      budgetInput: "1",
      spentInput: "1",
      payer: "couple",
    }), /INVALID_CATEGORY_BUDGET_INPUT/);
  }
});

test("applied and pending responses are accepted only with their exact safe envelopes", () => {
  const requestId = "70000000-0000-4000-8000-000000000001";
  const applied = parseBudgetMutationResponse({
    requestId,
    status: "applied",
    requiredCount: 1,
    acceptedCount: 1,
    summary: "총예산: 42000000원",
    surface: "/budget",
    journey: journey({ total_budget: 42_000_000, state_revision: 8 }),
  }, COUPLE_A, 7);
  assert.equal(applied.status, "applied");
  assert.equal(applied.journey.stateRevision, 8);
  assert.equal(applied.journey.totalBudget, 42_000_000);

  assert.deepEqual(parseBudgetMutationResponse({
    requestId,
    status: "pending_partner",
    requiredCount: 2,
    acceptedCount: 1,
    summary: "예식장 예산 변경",
    surface: "/budget",
  }, COUPLE_A, 7), {
    requestId,
    status: "pending_partner",
    requiredCount: 2,
    acceptedCount: 1,
    summary: "예식장 예산 변경",
    surface: "/budget",
  });
});

test("an active budget recovery envelope returns only the exact current owner's requester record", () => {
  const requestId = "70000000-0000-4000-8000-000000000001";
  const reviewerRequestId = "70000000-0000-4000-8000-000000000002";

  assert.deepEqual(parseActiveBudgetApproval({
    ownerId: OWNER_A.toUpperCase(),
    coupleId: COUPLE_A.toUpperCase(),
    surface: "/budget",
    requests: [
      {
        requestId: reviewerRequestId,
        role: "reviewer",
        baseRevision: 6,
        summary: "파트너가 보낸 예산 변경",
        createdAt: "2026-08-02T00:00:00.000Z",
      },
      {
        requestId,
        role: "requester",
        baseRevision: 7,
        summary: "예식장 예산 변경",
        createdAt: "2026-08-02T01:00:00.000Z",
      },
    ],
  }, OWNER_A, COUPLE_A), {
    ownerId: OWNER_A,
    coupleId: COUPLE_A,
    surface: "/budget",
    requestId,
    baseRevision: 7,
    summary: "예식장 예산 변경",
    createdAt: "2026-08-02T01:00:00.000Z",
  });
});

test("active budget recovery fails closed on identity, surface, summary, revision, or request ambiguity", () => {
  const request = {
    requestId: "70000000-0000-4000-8000-000000000001",
    role: "requester",
    baseRevision: 7,
    summary: "예식장 예산 변경",
    createdAt: "2026-08-02T01:00:00.000Z",
  };
  const envelope = {
    ownerId: OWNER_A,
    coupleId: COUPLE_A,
    surface: "/budget",
    requests: [request],
  };
  const malformed = [
    { ...envelope, ownerId: OWNER_B },
    { ...envelope, coupleId: COUPLE_B },
    { ...envelope, surface: "/schedule" },
    { ...envelope, requests: [{ ...request, baseRevision: "7" }] },
    { ...envelope, requests: [{ ...request, summary: "위험\u202e요약" }] },
    { ...envelope, requests: [{ ...request, createdAt: "today" }] },
    { ...envelope, requests: [request, { ...request }] },
    { ...envelope, unexpected: true },
  ];

  for (const value of malformed) {
    assert.throws(
      () => parseActiveBudgetApproval(value, OWNER_A, COUPLE_A),
      /INVALID_ACTIVE_BUDGET_APPROVAL/,
    );
  }
  assert.equal(parseActiveBudgetApproval({
    ...envelope,
    requests: [{ ...request, role: "reviewer" }],
  }, OWNER_A, COUPLE_A), null);
});

test("cold-start recovery verifies the requester through its exact status endpoint before returning it", async () => {
  const requestId = "70000000-0000-4000-8000-000000000001";
  const calls = [];
  const apiFetch = async (path, options = {}) => {
    calls.push({ path, method: options.method ?? "GET" });
    const body = path.includes("/active")
      ? {
          ownerId: OWNER_A,
          coupleId: COUPLE_A,
          surface: "/budget",
          requests: [{
            requestId,
            role: "requester",
            baseRevision: 7,
            summary: "예식장 예산 변경",
            createdAt: "2026-08-02T01:00:00.000Z",
          }],
        }
      : {
          requestId,
          status: "pending_partner",
          requiredCount: 2,
          acceptedCount: 1,
          summary: "예식장 예산 변경",
          surface: "/budget",
        };
    return {
      ok: true,
      status: 200,
      json: async () => body,
    };
  };

  const recovered = await fetchActiveBudgetApprovalStatus({
    apiFetch,
    ownerId: OWNER_A,
    coupleId: COUPLE_A,
    currentRevision: 7,
  });

  assert.equal(recovered.approval.requestId, requestId);
  assert.equal(recovered.outcome.status, "pending_partner");
  assert.deepEqual(calls, [
    {
      path: "/api/couple-plan-changes/active?surface=%2Fbudget",
      method: "GET",
    },
    {
      path: `/api/couple-plan-changes/${requestId}`,
      method: "GET",
    },
  ]);
});

test("a newer snapshot revision does not detach an exact pending budget request from its owner and couple", () => {
  const pending = {
    ownerId: OWNER_A,
    coupleId: COUPLE_A,
    surface: "/budget",
    requestId: "70000000-0000-4000-8000-000000000001",
    summary: "예식장 예산 변경",
    expectedRevision: 7,
  };
  const newerIdentity = {
    ownerId: OWNER_A,
    coupleId: COUPLE_A,
    stateRevision: 9,
  };

  assert.equal(
    isPendingBudgetApprovalBoundToIdentity(pending, newerIdentity),
    true,
  );
  assert.equal(
    isPendingBudgetApprovalBoundToIdentity(
      pending,
      { ...newerIdentity, ownerId: OWNER_B },
    ),
    false,
  );
  assert.equal(
    isPendingBudgetApprovalBoundToIdentity(
      pending,
      { ...newerIdentity, coupleId: COUPLE_B },
    ),
    false,
  );
});

test("stale, rejected, and malformed mutation envelopes fail closed", () => {
  const requestId = "70000000-0000-4000-8000-000000000001";
  for (const status of ["stale", "rejected"]) {
    assert.equal(parseBudgetMutationResponse({
      requestId,
      status,
      requiredCount: 2,
      acceptedCount: 1,
      summary: "예산 변경",
      surface: "/budget",
    }, COUPLE_A, 7).status, status);
  }

  const malformed = [
    { requestId, status: "pending_partner", requiredCount: 1, acceptedCount: 1, summary: "예산 변경", surface: "/budget" },
    { requestId, status: "pending_partner", requiredCount: 2, acceptedCount: 1, summary: "예산 변경", surface: "/budget", journey: null },
    { requestId, status: "applied", requiredCount: 1, acceptedCount: 1, summary: "예산 변경", surface: "/budget", journey: journey() },
    { requestId, status: "applied", requiredCount: 1, acceptedCount: 1, summary: "예산 변경", surface: "/budget", journey: journey({ couple_id: COUPLE_B, state_revision: 8 }) },
    { requestId, status: "applied", requiredCount: 1, acceptedCount: 1, summary: "예산 변경", surface: "/schedule", journey: journey({ state_revision: 8 }) },
    { requestId, status: "unknown", requiredCount: 1, acceptedCount: 1, summary: "예산 변경", surface: "/budget" },
  ];
  for (const value of malformed) {
    assert.throws(
      () => parseBudgetMutationResponse(value, COUPLE_A, 7),
      /INVALID_BUDGET_MUTATION_RESPONSE/,
    );
  }
});

test("an A load or mutation cannot commit after authentication changes to B", () => {
  const coordinator = createBudgetRevisionCoordinator();
  coordinator.setOwner(OWNER_A);
  const staleLoad = coordinator.beginLoad(OWNER_A);
  assert.ok(staleLoad);

  coordinator.setOwner(OWNER_B);
  assert.equal(coordinator.commitJourney(staleLoad, journey()), null);

  const loadB = coordinator.beginLoad(OWNER_B);
  assert.ok(loadB);
  const snapshotB = coordinator.commitJourney(
    loadB,
    journey({ couple_id: COUPLE_B }),
  );
  assert.equal(snapshotB.ownerId, OWNER_B);
  assert.equal(snapshotB.coupleId, COUPLE_B);

  const mutationB = coordinator.beginMutation("total");
  assert.ok(mutationB);
  coordinator.setOwner(OWNER_A);
  assert.equal(coordinator.isCurrent(mutationB), false);
  assert.equal(coordinator.commitApplied(
    mutationB,
    parseBudgetJourney(journey({ couple_id: COUPLE_B, state_revision: 8 }), COUPLE_B),
  ), null);
});

test("a later same-owner load fences an earlier profile or realtime result", () => {
  const coordinator = createBudgetRevisionCoordinator();
  coordinator.setOwner(OWNER_A);
  const earlier = coordinator.beginLoad(OWNER_A);
  const later = coordinator.beginLoad(OWNER_A);

  assert.equal(coordinator.commitJourney(earlier, journey()), null);
  assert.equal(
    coordinator.commitJourney(later, journey({ state_revision: 9 })).stateRevision,
    9,
  );
});

test("an edit draft cannot overwrite a newer revision or a different owner", () => {
  const base = {
    ownerId: OWNER_A,
    coupleId: COUPLE_A,
    stateRevision: 7,
  };
  assert.equal(isBudgetEditBaseCurrent(base, base), true);
  assert.equal(isBudgetEditBaseCurrent(base, { ...base, stateRevision: 8 }), false);
  assert.equal(isBudgetEditBaseCurrent(base, { ...base, ownerId: OWNER_B }), false);
  assert.equal(isBudgetEditBaseCurrent(base, { ...base, coupleId: COUPLE_B }), false);
});

test("total and category saves each have an atomic double-click lock", () => {
  const coordinator = createBudgetRevisionCoordinator();
  coordinator.setOwner(OWNER_A);
  const load = coordinator.beginLoad(OWNER_A);
  coordinator.commitJourney(load, journey());

  const total = coordinator.beginMutation("total");
  assert.ok(total);
  assert.equal(coordinator.beginMutation("total"), null);
  assert.equal(coordinator.beginMutation("category"), null);
  assert.equal(coordinator.beginLoad(OWNER_A), null);
  assert.ok(coordinator.beginLoad(OWNER_A, total));

  assert.equal(coordinator.finishMutation(total), true);
  coordinator.commitJourney(
    coordinator.beginLoad(OWNER_A),
    journey(),
  );
  const category = coordinator.beginMutation("category");
  assert.ok(category);
  assert.equal(coordinator.beginMutation("category"), null);
  assert.equal(coordinator.beginMutation("total"), null);
});

test("a verified terminal approval can advance only the currently loaded revision", () => {
  const coordinator = createBudgetRevisionCoordinator();
  coordinator.setOwner(OWNER_A);
  const current = coordinator.commitJourney(
    coordinator.beginLoad(OWNER_A),
    journey(),
  );
  assert.ok(current);

  const applied = parseBudgetJourney(
    journey({ total_budget: 42_000_000, state_revision: 8 }),
    COUPLE_A,
  );
  const advanced = coordinator.commitObservedApplied(current, applied, 7);
  assert.equal(advanced.stateRevision, 8);
  assert.equal(advanced.totalBudget, 42_000_000);
  assert.equal(coordinator.commitObservedApplied(current, applied, 7), null);
});

test("an applied status GET can confirm a matching later snapshot while own mutation parsing stays strict plus one", () => {
  const requestId = "70000000-0000-4000-8000-000000000001";
  const laterJourney = journey({
    total_budget: 44_000_000,
    state_revision: 9,
  });
  const response = {
    requestId,
    status: "applied",
    requiredCount: 2,
    acceptedCount: 2,
    summary: "예식장 예산 변경",
    surface: "/budget",
    journey: laterJourney,
  };

  assert.throws(
    () => parseBudgetMutationResponse(response, COUPLE_A, 7),
    /INVALID_BUDGET_MUTATION_RESPONSE/,
  );
  const observedStatus = parseBudgetApprovalStatusResponse(
    response,
    COUPLE_A,
    7,
    9,
  );

  const coordinator = createBudgetRevisionCoordinator();
  coordinator.setOwner(OWNER_A);
  const current = coordinator.commitJourney(
    coordinator.beginLoad(OWNER_A),
    laterJourney,
  );
  const observed = coordinator.commitObservedApplied(
    current,
    observedStatus.journey,
    7,
  );

  assert.equal(observed.stateRevision, 9);
  assert.equal(observed.totalBudget, 44_000_000);
});

test("a late approval observation cannot invalidate a budget save already in flight", () => {
  const coordinator = createBudgetRevisionCoordinator();
  coordinator.setOwner(OWNER_A);
  const current = coordinator.commitJourney(
    coordinator.beginLoad(OWNER_A),
    journey(),
  );
  assert.ok(current);

  const mutation = coordinator.beginMutation("category");
  assert.ok(mutation);
  const observedApproval = parseBudgetJourney(
    journey({ total_budget: 42_000_000, state_revision: 8 }),
    COUPLE_A,
  );

  assert.equal(
    coordinator.commitObservedApplied(current, observedApproval, 7),
    null,
  );
  assert.equal(coordinator.isCurrent(mutation), true);

  const ownResult = parseBudgetJourney(
    journey({ total_budget: 41_000_000, state_revision: 8 }),
    COUPLE_A,
  );
  assert.equal(coordinator.commitApplied(mutation, ownResult)?.totalBudget, 41_000_000);
});
