import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAmoraPreparationTopicConsumerState,
} from "@hanbang/shared/amora-preparation-topic-consumer-state";

const TOPIC_KEYS = [
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
];

function view(overrides = {}) {
  return {
    version: 1,
    topicKey: "meeting",
    applicability: "applicable",
    status: "not_started",
    progress: { completed: 0, total: 2, percent: 0 },
    confirmedScheduleDecisions: [],
    confirmedBudgetDecisions: [],
    userReportedCatchUpRecords: [],
    currentVendorBookingRecords: [],
    currentCompletedVendorBookingRecords: [],
    budgetSummary: null,
    actionReadState: "loaded",
    decisionReadState: "loaded",
    budgetDecisionReadState: "loaded",
    catchUpReadState: "loaded",
    vendorBookingReadState: "loaded",
    completedVendorBookingReadState: "loaded",
    ...overrides,
  };
}

test("all canonical preparation topics use the same journey-truth and consumer-state adapter", () => {
  const results = TOPIC_KEYS.map((topicKey) => (
    buildAmoraPreparationTopicConsumerState(view({ topicKey }))
  ));

  assert.deepEqual(results.map((result) => result?.truthPolicy.topicKey), TOPIC_KEYS);
  assert.ok(results.every((result) => (
    result?.truthPolicy.truthOwners.status === "saved_checklist"
    && result.truthPolicy.truthOwners.completion === "saved_checklist"
    && result.consumerState.primaryState === "ready"
  )));
});

test("the canonical topic states map through one shared consumer composer", () => {
  const cases = [
    [{ applicability: "unknown", status: "not_started" }, "applicability_unknown"],
    [{ applicability: "not_applicable", status: "not_started" }, "not_applicable"],
    [{ applicability: "applicable", status: "not_started" }, "ready"],
    [{ applicability: "applicable", status: "exploring" }, "in_progress"],
    [{ applicability: "applicable", status: "in_progress" }, "in_progress"],
    [{ applicability: "applicable", status: "decision_needed" }, "conflict"],
    [{ applicability: "not_applicable", status: "decision_needed" }, "conflict"],
    [{ applicability: "applicable", status: "completed" }, "completed"],
  ];

  for (const [state, primaryState] of cases) {
    const result = buildAmoraPreparationTopicConsumerState(view(state));
    assert.equal(result?.consumerState.primaryState, primaryState);
  }
});

test("supporting receipts and optional read failures never promote or erase the canonical topic state", () => {
  const baseline = buildAmoraPreparationTopicConsumerState(view({
    status: "in_progress",
  }));
  const withSupportingEvidence = buildAmoraPreparationTopicConsumerState(view({
    status: "in_progress",
    confirmedScheduleDecisions: [{ id: "schedule", scope: "couple_shared" }],
    confirmedBudgetDecisions: [{ id: "budget", scope: "couple_shared" }],
    userReportedCatchUpRecords: [{
      state: "completed",
      evidence: "user_reported",
      checklistCompletionChanged: false,
      vendorConfirmationStatus: "unconfirmed",
      paymentEvidence: false,
    }],
    currentVendorBookingRecords: [{
      quotedAmountWon: 1_000_000,
      recordScope: "amora_internal_request",
      evidence: "actor_bound_atomic_intent",
      vendorDeliveryStatus: "not_sent",
      vendorConfirmationStatus: "unconfirmed",
    }],
    currentCompletedVendorBookingRecords: [{
      contractedAmountWon: 2_000_000,
      recordScope: "amora_internal_completed_outcome",
      evidence: "actor_bound_atomic_user_report",
      completionEvidence: "user_reported",
      vendorDeliveryStatus: "not_sent",
      vendorConfirmationStatus: "unconfirmed",
      isPaid: false,
    }],
    budgetSummary: {
      state: "ready",
      categoryKey: "meeting",
      budgetWon: 3_000_000,
      spentWon: null,
      payer: null,
    },
    actionReadState: "unavailable",
    decisionReadState: "partial",
    budgetDecisionReadState: "unavailable",
    catchUpReadState: "partial",
    vendorBookingReadState: "unavailable",
    completedVendorBookingReadState: "partial",
  }));

  assert.equal(withSupportingEvidence?.consumerState.primaryState, "in_progress");
  assert.deepEqual(
    withSupportingEvidence?.consumerState.primaryAction,
    baseline?.consumerState.primaryAction,
  );
  assert.equal(withSupportingEvidence?.consumerState.allowSuccess, false);
  assert.deepEqual(withSupportingEvidence?.consumerState.supporting.boundaryLabels, [
    "업체 확인 아님",
    "결제 증빙 아님",
  ]);
  assert.equal(
    withSupportingEvidence?.truthPolicy.evidenceEffects.userReport,
    "supporting_non_proof_only",
  );
});

test("malformed optional records are ignored without hiding the verified core topic", () => {
  const result = buildAmoraPreparationTopicConsumerState(view({
    userReportedCatchUpRecords: [{ state: "completed" }],
    currentVendorBookingRecords: [{ vendorConfirmationStatus: "unconfirmed" }],
    currentCompletedVendorBookingRecords: [{ completionEvidence: "user_reported" }],
    budgetSummary: { state: "ready", budgetWon: "not-a-number" },
  }));

  assert.equal(result?.consumerState.primaryState, "ready");
  assert.deepEqual(result?.consumerState.supporting.provenanceLabels, ["사용자 입력"]);
  assert.deepEqual(result?.consumerState.supporting.boundaryLabels, []);
  assert.equal(result?.consumerState.supporting.moneyLabel, null);
});

test("malformed, unknown, and impossible topic states fail closed", () => {
  for (const candidate of [
    null,
    view({ topicKey: "secret_topic" }),
    view({ applicability: "unknown", status: "completed" }),
    view({ applicability: "not_applicable", status: "completed" }),
    view({ applicability: "applicable", status: "mystery" }),
    view({ userReportedCatchUpRecords: "not-an-array" }),
    view({ progress: null }),
  ]) {
    assert.equal(buildAmoraPreparationTopicConsumerState(candidate), null);
  }
});
