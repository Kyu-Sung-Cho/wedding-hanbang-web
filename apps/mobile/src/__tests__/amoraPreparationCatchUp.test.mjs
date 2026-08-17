import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAmoraPreparationCatchUpPreview,
  parseAmoraPreparationCatchUpCanonicalExisting,
  parseAmoraPreparationCatchUpDraftSubmission,
  parseAmoraPreparationCatchUpMutationRequest,
  resolveAmoraPreparationCatchUpEntry,
  validateAmoraPreparationCatchUpReceipt,
} from "@hanbang/shared/amora-preparation-catch-up";

const COUPLE_ID = "20000000-0000-4000-8000-000000000001";
const REQUEST_ID = "30000000-0000-4000-8000-000000000001";
const RECEIPT_ID = "40000000-0000-4000-8000-000000000001";
const VENUE_DECISION_ID = "50000000-0000-4000-8000-000000000001";

function entry(overrides = {}) {
  return {
    version: 1,
    readState: "loaded",
    canonicalProgress: "empty",
    selfReportedStage: "already_preparing",
    ...overrides,
  };
}

test("an empty canonical journey opens the bounded catch-up only for an already-preparing user", () => {
  assert.deepEqual(resolveAmoraPreparationCatchUpEntry(entry()), {
    version: 1,
    mode: "catch_up",
    title: "이미 준비한 것부터 알려주세요",
    description: "확실한 주제만 최대 세 가지 골라주세요. 모르는 항목은 그대로 남겨도 괜찮아요.",
    primaryAction: {
      kind: "open_catch_up_editor",
      label: "준비한 것 정리하기",
      requiresWrite: false,
    },
    catchUpEnabled: true,
  });

  const canonical = resolveAmoraPreparationCatchUpEntry(entry({
    canonicalProgress: "present",
  }));
  assert.equal(canonical.mode, "canonical_existing");
  assert.equal(canonical.primaryAction.kind, "continue_canonical");
  assert.equal(canonical.primaryAction.requiresWrite, false);
  assert.equal(canonical.catchUpEnabled, false);
});

test("uncertain reads fail closed and never offer a reconstruction write", () => {
  for (const readState of ["partial", "unavailable"]) {
    const result = resolveAmoraPreparationCatchUpEntry(entry({ readState }));
    assert.equal(result.mode, "recovery", readState);
    assert.equal(result.primaryAction.kind, "retry_canonical_read", readState);
    assert.equal(result.primaryAction.requiresWrite, false, readState);
    assert.equal(result.catchUpEnabled, false, readState);
  }
});

test("starting, unknown, and later choices do not create catch-up work", () => {
  const cases = [
    ["starting", "not_needed"],
    ["unknown", "not_needed"],
    ["later", "deferred"],
  ];

  for (const [selfReportedStage, expectedMode] of cases) {
    const result = resolveAmoraPreparationCatchUpEntry(entry({ selfReportedStage }));
    assert.equal(result.mode, expectedMode, selfReportedStage);
    assert.equal(result.primaryAction?.requiresWrite ?? false, false, selfReportedStage);
    assert.equal(result.catchUpEnabled, false, selfReportedStage);
  }
});

test("the preview sorts at most three canonical topics and keeps every state explicitly user-reported", () => {
  const preview = buildAmoraPreparationCatchUpPreview({
    version: 1,
    items: [
      { topicKey: "makeup", state: "unknown", scope: "owner_private" },
      { topicKey: "venue", state: "completed", scope: "couple_shared" },
      { topicKey: "studio", state: "in_progress", scope: "owner_private" },
    ],
  });

  assert.deepEqual(preview, {
    version: 1,
    kind: "preview",
    title: "이렇게 준비 상태를 정리할게요",
    description: "확인한 세 항목만 반영하며, 기존 체크리스트를 임의로 완료하지 않아요.",
    items: [
      {
        topicKey: "venue",
        topicLabel: "결혼식장",
        state: "completed",
        stateLabel: "이미 끝냈어요",
        scope: "couple_shared",
        scopeLabel: "함께 보기",
        source: "user_reported",
        boundaryLabel: "사용자가 완료로 기록 · 체크리스트 완료·예약·계약·결제 증빙 아님",
      },
      {
        topicKey: "studio",
        topicLabel: "웨딩 사진 촬영",
        state: "in_progress",
        stateLabel: "진행 중이에요",
        scope: "owner_private",
        scopeLabel: "나만 보기",
        source: "user_reported",
        boundaryLabel: "사용자가 진행 중으로 기록 · 업체 진행 확인 아님",
      },
      {
        topicKey: "makeup",
        topicLabel: "헤어·메이크업",
        state: "unknown",
        stateLabel: "아직 잘 모르겠어요",
        scope: "owner_private",
        scopeLabel: "나만 보기",
        source: "user_reported",
        boundaryLabel: "아직 모름으로 유지 · 완료로 계산하지 않음",
      },
    ],
    operation: {
      version: 1,
      kind: "reconcile_preparation_catch_up",
      items: [
        { topicKey: "venue", state: "completed", scope: "couple_shared", source: "user_reported" },
        { topicKey: "studio", state: "in_progress", scope: "owner_private", source: "user_reported" },
        { topicKey: "makeup", state: "unknown", scope: "owner_private", source: "user_reported" },
      ],
    },
    requiresApproval: true,
    writesChecklistCompletion: false,
    estimatedCompletionRate: null,
  });
  assert.equal(Object.isFrozen(preview), true);
  assert.equal(Object.isFrozen(preview.items), true);
  assert.equal(Object.isFrozen(preview.operation.items), true);
});

test("not-applicable remains reversible and is never presented as unfinished work", () => {
  const preview = buildAmoraPreparationCatchUpPreview({
    version: 1,
    items: [
      { topicKey: "pyebaek", state: "not_applicable", scope: "couple_shared" },
    ],
  });

  assert.equal(preview.items[0].stateLabel, "해당 없어요");
  assert.equal(preview.items[0].boundaryLabel, "사용자가 해당 없음으로 기록 · 언제든 다시 포함 가능");
  assert.equal(preview.estimatedCompletionRate, null);
  assert.equal(preview.writesChecklistCompletion, false);
});

test("malformed, duplicate, unsupported, empty, and oversized previews fail closed", () => {
  const valid = { topicKey: "venue", state: "completed", scope: "owner_private" };
  const invalidInputs = [
    null,
    {},
    { version: 1, items: [] },
    { version: 1, items: [valid, valid] },
    { version: 1, items: [valid, { ...valid, topicKey: "studio" }, { ...valid, topicKey: "dress" }, { ...valid, topicKey: "makeup" }] },
    { version: 1, items: [{ ...valid, topicKey: "reserve" }] },
    { version: 1, items: [{ ...valid, topicKey: "other" }] },
    { version: 1, items: [{ ...valid, state: "verified_completed" }] },
    { version: 1, items: [{ ...valid, scope: "auto_shared" }] },
    { version: 1, items: [{ ...valid, externalNote: "계약 끝남" }] },
    { version: 1, items: [valid], importedFrom: "messenger" },
  ];

  for (const input of invalidInputs) {
    assert.equal(buildAmoraPreparationCatchUpPreview(input), null, JSON.stringify(input));
  }
});

test("entry parsing rejects extra keys and contradictory canonical state", () => {
  assert.equal(resolveAmoraPreparationCatchUpEntry({ ...entry(), inferredProgress: 80 }), null);
  assert.equal(resolveAmoraPreparationCatchUpEntry(entry({ canonicalProgress: "guessed" })), null);
  assert.equal(resolveAmoraPreparationCatchUpEntry(entry({ readState: "loaded", selfReportedStage: "imported" })), null);
});

test("canonical-existing onboarding outcomes are exact and carry no reconstructed facts", () => {
  const outcome = {
    version: 1,
    status: "canonical_existing",
    next: { kind: "continue_canonical", route: "/schedule" },
  };
  assert.deepEqual(parseAmoraPreparationCatchUpCanonicalExisting(outcome), outcome);
  assert.equal(parseAmoraPreparationCatchUpCanonicalExisting({
    ...outcome,
    inferredProgress: 80,
  }), null);
  assert.equal(parseAmoraPreparationCatchUpCanonicalExisting({
    ...outcome,
    next: { kind: "recalculate_current_state", route: "/schedule" },
  }), null);
});

test("mutation requests retain only the exact preview operation and canonical request fence", () => {
  assert.deepEqual(parseAmoraPreparationCatchUpDraftSubmission({
    version: 1,
    requestId: REQUEST_ID,
    items: [{ topicKey: "venue", state: "completed", scope: "owner_private" }],
  }), {
    version: 1,
    requestId: REQUEST_ID,
    items: [{ topicKey: "venue", state: "completed", scope: "owner_private" }],
  });

  const parsed = parseAmoraPreparationCatchUpMutationRequest({
    version: 1,
    expectedCoupleId: COUPLE_ID.toUpperCase(),
    requestId: REQUEST_ID.toUpperCase(),
    items: [
      { topicKey: "venue", state: "completed", scope: "owner_private" },
    ],
  });

  assert.deepEqual(parsed, {
    version: 1,
    expectedCoupleId: COUPLE_ID,
    requestId: REQUEST_ID,
    items: [
      { topicKey: "venue", state: "completed", scope: "owner_private" },
    ],
  });
  assert.equal(parseAmoraPreparationCatchUpMutationRequest({
    version: 1,
    expectedCoupleId: COUPLE_ID,
    requestId: REQUEST_ID,
    items: [{ topicKey: "venue", state: "completed", scope: "owner_private", source: "imported" }],
  }), null);
});

test("canonical receipts are strict, item-bound, and preserve the non-proof boundaries", () => {
  const expectedItems = [
    { topicKey: "venue", state: "completed", scope: "owner_private" },
  ];
  const receipt = {
    version: 1,
    status: "applied",
    receiptId: RECEIPT_ID,
    coupleId: COUPLE_ID,
    requestId: REQUEST_ID,
    sourceJourneyRevision: 0,
    confirmedAt: "2026-08-17T10:30:00.000Z",
    reused: false,
    items: [
      {
        decisionId: VENUE_DECISION_ID,
        topicKey: "venue",
        state: "completed",
        scope: "owner_private",
        source: "user_reported",
      },
    ],
    boundaries: {
      checklistCompletionChanged: false,
      vendorConfirmation: "unconfirmed",
      paymentEvidence: false,
    },
    next: {
      kind: "recalculate_current_state",
      route: "/schedule",
    },
  };

  assert.deepEqual(validateAmoraPreparationCatchUpReceipt(
    receipt,
    COUPLE_ID,
    REQUEST_ID,
    expectedItems,
  ), { ok: true, value: receipt });

  for (const tampered of [
    { ...receipt, status: "completed" },
    { ...receipt, reused: "false" },
    { ...receipt, sourceJourneyRevision: -1 },
    { ...receipt, boundaries: { ...receipt.boundaries, checklistCompletionChanged: true } },
    { ...receipt, items: [{ ...receipt.items[0], source: "imported" }] },
    { ...receipt, items: [{ ...receipt.items[0], state: "in_progress" }] },
    { ...receipt, provider: "claude" },
  ]) {
    assert.equal(
      validateAmoraPreparationCatchUpReceipt(
        tampered,
        COUPLE_ID,
        REQUEST_ID,
        expectedItems,
      ).ok,
      false,
    );
  }
});
