import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAmoraOfficialReferenceScope,
  parseAmoraOfficialReferenceScope,
} from "@hanbang/shared/amora-official-reference-scope";
import {
  buildAmoraPreparationTopicConsumerState,
} from "@hanbang/shared/amora-preparation-topic-consumer-state";

const TOPIC_KEYS = Object.freeze([
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
]);

function topicView(topicKey, overrides = {}) {
  return {
    version: 1,
    topicKey,
    applicability: "applicable",
    status: "in_progress",
    progress: { completed: 1, total: 3, percent: 33 },
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

const TOPIC_SCENARIOS = Object.freeze([
  Object.freeze({
    name: "정상 진행",
    overrides: Object.freeze({}),
    primaryState: "in_progress",
  }),
  Object.freeze({
    name: "해당 없음",
    overrides: Object.freeze({
      applicability: "not_applicable",
      status: "not_started",
      progress: Object.freeze({ completed: 0, total: 0, percent: 0 }),
    }),
    primaryState: "not_applicable",
  }),
  Object.freeze({
    name: "계획 변경 충돌",
    overrides: Object.freeze({ status: "decision_needed" }),
    primaryState: "conflict",
  }),
  Object.freeze({
    name: "일부 근거 조회 실패",
    overrides: Object.freeze({
      actionReadState: "unavailable",
      decisionReadState: "partial",
      budgetDecisionReadState: "unavailable",
      catchUpReadState: "partial",
      vendorBookingReadState: "unavailable",
      completedVendorBookingReadState: "partial",
    }),
    primaryState: "in_progress",
  }),
]);

test("21개 준비 주제가 정상·배제·변경·부분 조회에서 같은 truth policy와 상태 규칙을 쓴다", () => {
  for (const topicKey of TOPIC_KEYS) {
    for (const scenario of TOPIC_SCENARIOS) {
      const result = buildAmoraPreparationTopicConsumerState(
        topicView(topicKey, scenario.overrides),
      );
      assert.ok(result, `${topicKey}/${scenario.name}`);
      assert.equal(result.truthPolicy.topicKey, topicKey, `${topicKey}/${scenario.name}`);
      assert.equal(
        result.consumerState.primaryState,
        scenario.primaryState,
        `${topicKey}/${scenario.name}`,
      );
      assert.equal(result.truthPolicy.truthOwners.status, "saved_checklist");
      assert.equal(result.truthPolicy.truthOwners.completion, "saved_checklist");
      assert.equal(result.truthPolicy.failureUi.partial, "partial_visible");
      assert.equal(result.truthPolicy.failureUi.unavailable, "unavailable_visible");
    }
  }
});

test("부분 조회나 손상 optional record가 정본 진행 상태를 완료·업체 확인·결제로 승격하지 않는다", () => {
  const result = buildAmoraPreparationTopicConsumerState(topicView("studio", {
    currentVendorBookingRecords: [{
      recordScope: "amora_internal_request",
      evidence: "actor_bound_atomic_intent",
      vendorDeliveryStatus: "sent",
      vendorConfirmationStatus: "confirmed",
    }],
    currentCompletedVendorBookingRecords: [{
      recordScope: "amora_internal_completed_outcome",
      evidence: "actor_bound_atomic_user_report",
      completionEvidence: "vendor_confirmed",
      vendorDeliveryStatus: "sent",
      vendorConfirmationStatus: "confirmed",
      isPaid: true,
    }],
    vendorBookingReadState: "partial",
    completedVendorBookingReadState: "partial",
  }));

  assert.equal(result?.consumerState.primaryState, "in_progress");
  assert.equal(result?.consumerState.allowSuccess, false);
  assert.deepEqual(result?.consumerState.supporting.boundaryLabels, []);
  assert.equal(result?.consumerState.supporting.moneyLabel, null);
  assert.deepEqual(result?.consumerState.supporting.provenanceLabels, ["사용자 입력"]);
});

const OFFICIAL_REFERENCE_INPUT = Object.freeze({
  version: 1,
  referenceId: "kca_wedding_service_price_2025_11",
  regionScope: "seoul",
  applicabilityKey: "studio",
  asOfDate: "2026-08-18",
});

test("공식 근거는 정상 source-date-region-scope만 표시하고 손상·구버전·누락은 모두 숨긴다", () => {
  const canonical = buildAmoraOfficialReferenceScope(OFFICIAL_REFERENCE_INPUT);
  assert.ok(canonical);
  assert.equal(canonical.sourceDisclosure.checkedAt, "2026-07-27");
  assert.equal(canonical.sourcePeriod, "2025-11");
  assert.equal(canonical.regionLabel, "서울");
  assert.equal(canonical.applicabilityScopeLabel, "사진 촬영 공시 기본가 하한 참고");
  assert.equal(canonical.referenceEffect, "context_only");

  const invalidInputs = [
    { ...OFFICIAL_REFERENCE_INPUT, referenceId: "kca_wedding_service_price_2025_05" },
    { ...OFFICIAL_REFERENCE_INPUT, regionScope: undefined },
    { ...OFFICIAL_REFERENCE_INPUT, applicabilityKey: undefined },
    { ...OFFICIAL_REFERENCE_INPUT, asOfDate: "2026-07-26" },
    { ...OFFICIAL_REFERENCE_INPUT, sourceUrl: "https://example.com" },
  ];
  for (const input of invalidInputs) {
    assert.equal(buildAmoraOfficialReferenceScope(input), null);
  }

  const tamperedOutputs = [
    { ...canonical, sourceUrl: "https://example.com" },
    { ...canonical, regionLabel: "전국" },
    { ...canonical, applicabilityScopeLabel: "공식 평균 가격" },
    {
      ...canonical,
      sourceDisclosure: { ...canonical.sourceDisclosure, checkedAt: "2026-08-18" },
    },
  ];
  for (const output of tamperedOutputs) {
    assert.equal(parseAmoraOfficialReferenceScope(output, "2026-08-18"), null);
  }
});
