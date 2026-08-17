import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";

import { buildAmoraPreparationGuideModules } from "@hanbang/shared/amora-preparation-guide";
import { buildPreparationTopicPresentation } from "../lib/preparationTopicPresentation.mjs";

const summarySource = await readFile(
  new URL("../components/planning/PreparationTopicSummary.tsx", import.meta.url),
  "utf8",
);

function withoutPlanFields(presentation) {
  if (!presentation) return presentation;
  const rest = { ...presentation };
  delete rest.budgetAction;
  delete rest.actionReadNotice;
  delete rest.confirmedScheduleSection;
  delete rest.confirmedBudgetSection;
  delete rest.catchUpSection;
  delete rest.bookingDecisionSection;
  delete rest.completedBookingOutcomeSection;
  delete rest.savedConversationSection;
  delete rest.guideSection;
  return rest;
}

function presentCatchUp(records, catchUpReadState = "loaded") {
  return buildPreparationTopicPresentation({
    version: 1,
    topicKey: "meeting",
    label: "부모님 첫 만남",
    applicability: "unknown",
    status: "not_started",
    progress: { completed: 0, total: 2, percent: 0 },
    facts: [],
    unknowns: [{ key: "applicability", label: "필요한 준비인지 확인 전", source: "no_saved_record" }],
    nextAction: {
      title: "부모님 첫 만남이 우리에게 필요한지 확인하기",
      reason: "아직 확인한 준비 기록이 없어요.",
      completionCriterion: "준비할지 하지 않을지 직접 정하면 끝나요.",
      source: "applicability",
    },
    guideModules: [],
    relatedMessageRefs: [],
    linkedScheduleIds: [],
    linkedBudgetCategoryKeys: [],
    linkedActionIds: [],
    confirmedScheduleDecisions: [],
    confirmedBudgetDecisions: [],
    userReportedCatchUpRecords: records,
    linkedDecisionIds: [],
    decisionReadState: "loaded",
    budgetDecisionReadState: "loaded",
    catchUpReadState,
    conflicts: [],
  });
}

test("user-reported catch-up state is a compact non-proof record without changing the next action", () => {
  const decisionId = "50000000-0000-4000-8000-000000000001";
  const receiptId = "30000000-0000-4000-8000-000000000001";
  const record = {
    decisionId,
    receiptId,
    state: "in_progress",
    scope: "owner_private",
    confirmedAt: "2026-08-18T00:10:00.000Z",
    evidence: "user_reported",
    checklistCompletionChanged: false,
    vendorConfirmationStatus: "unconfirmed",
    paymentEvidence: false,
  };
  const presentation = presentCatchUp([record]);
  const baseline = presentCatchUp([]);

  assert.deepEqual(presentation?.catchUpSection, {
    title: "직접 알려준 현재 상태",
    items: [{
      key: "user-reported-catch-up",
      title: "진행 중이라고 알려준 기록",
      meta: "나만 보는 사용자 기록 · 8월 18일 입력 · 체크리스트 완료·업체·계약·결제 증빙 아님",
      accessibilityLabel: "직접 알려준 현재 상태, 진행 중이라고 알려준 기록, 나만 보는 사용자 기록, 8월 18일 입력, 체크리스트 완료·업체·계약·결제 증빙 아님",
    }],
    notice: null,
  });
  const serialized = JSON.stringify(presentation?.catchUpSection);
  assert.equal(serialized.includes(decisionId), false);
  assert.equal(serialized.includes(receiptId), false);
  for (const field of ["statusLabel", "progressLabel", "nextAction"]) {
    assert.deepEqual(presentation?.[field], baseline?.[field], field);
  }
});

test("catch-up read failures stay visible in a static non-clicking section", () => {
  assert.deepEqual(presentCatchUp([], "partial")?.catchUpSection, {
    title: "직접 알려준 현재 상태",
    items: [],
    notice: "직접 알려준 준비 기록 조회가 일부만 완료됐어요. 새로고침해 다시 확인해 주세요.",
  });
  assert.deepEqual(presentCatchUp([], "unavailable")?.catchUpSection, {
    title: "직접 알려준 현재 상태",
    items: [],
    notice: "직접 알려준 준비 기록을 지금 불러오지 못했어요.",
  });

  const sectionStart = summarySource.indexOf("{presentation.catchUpSection ? (");
  const sectionEnd = summarySource.indexOf(
    "{presentation.completedBookingOutcomeSection ? (",
    sectionStart,
  );
  assert.ok(sectionStart >= 0 && sectionEnd > sectionStart);
  const sectionSource = summarySource.slice(sectionStart, sectionEnd);
  assert.match(sectionSource, /style=\{styles\.confirmedRow\}/);
  assert.match(sectionSource, /style=\{styles\.confirmedDot\}/);
  assert.match(sectionSource, /style=\{styles\.confirmedCopy\}/);
  assert.doesNotMatch(sectionSource, /Pressable|ActionRow|onPress|router|navigation/);
});

function presentConfirmedBudget(
  confirmedBudgetDecisions,
  budgetDecisionReadState = "loaded",
) {
  return buildPreparationTopicPresentation({
    version: 1,
    topicKey: "meeting",
    label: "부모님 첫 만남",
    applicability: "applicable",
    status: "in_progress",
    progress: { completed: 1, total: 2, percent: 50 },
    facts: [],
    unknowns: [{ key: "checklist:2", label: "참석자 확인", source: "unfinished_checklist" }],
    nextAction: {
      title: "참석자 확인",
      reason: "저장한 준비 기록에서 아직 끝내지 않은 첫 항목이에요.",
      completionCriterion: "이 항목을 완료로 표시하면 끝나요.",
      source: "saved_checklist",
    },
    guideModules: [],
    relatedMessageRefs: [],
    linkedScheduleIds: [],
    linkedBudgetCategoryKeys: ["meeting"],
    linkedActionIds: [],
    confirmedScheduleDecisions: [],
    confirmedBudgetDecisions,
    linkedDecisionIds: [],
    decisionReadState: "loaded",
    budgetDecisionReadState,
    conflicts: [],
  });
}

function presentBudget(summary, payerPresentationContext) {
  return buildPreparationTopicPresentation({
    version: 1,
    topicKey: "meeting",
    label: "부모님 첫 만남",
    applicability: "applicable",
    status: "not_started",
    progress: { completed: 0, total: 1, percent: 0 },
    facts: [],
    unknowns: [{ key: "checklist:1", label: "날짜 확인", source: "unfinished_checklist" }],
    nextAction: {
      title: "날짜 확인",
      reason: "저장한 준비 기록에서 아직 끝내지 않은 첫 항목이에요.",
      completionCriterion: "이 항목을 완료로 표시하면 끝나요.",
      source: "saved_checklist",
    },
    guideModules: [],
    relatedMessageRefs: [],
    linkedScheduleIds: [],
    linkedBudgetCategoryKeys: summary?.state === "invalid" ? [] : ["meeting"],
    linkedActionIds: [],
    budgetSummary: summary,
    actionReadState: "loaded",
    conflicts: [],
  }, undefined, payerPresentationContext);
}

function completedOutcomeRecord(overrides = {}) {
  return {
    bookingId: "80000000-0000-4000-8000-000000000021",
    decisionId: "50000000-0000-4000-8000-000000000071",
    vendorId: "90000000-0000-4000-8000-000000000021",
    productId: null,
    vendorName: "한방 스튜디오",
    productName: null,
    bookingDate: "2026-08-16",
    bookingTime: "10:00",
    quotedAmountWon: 0,
    contractedAmountWon: null,
    actualAmountWon: 0,
    userConfirmedAt: "2026-08-16T09:00:00.000Z",
    decidedAt: "2026-08-16T09:00:01.000Z",
    recordScope: "amora_internal_completed_outcome",
    evidence: "actor_bound_atomic_user_report",
    completionEvidence: "user_reported",
    vendorDeliveryStatus: "not_sent",
    vendorConfirmationStatus: "unconfirmed",
    isPaid: false,
    ...overrides,
  };
}

function presentCompletedOutcomes(records, readState = "loaded") {
  return buildPreparationTopicPresentation({
    version: 1,
    topicKey: "studio",
    label: "웨딩 사진 촬영",
    applicability: "applicable",
    status: "in_progress",
    progress: { completed: 1, total: 2, percent: 50 },
    facts: [],
    unknowns: [{ key: "checklist:2", label: "사진 수령 확인", source: "unfinished_checklist" }],
    nextAction: {
      title: "사진 수령 확인",
      reason: "저장한 준비 기록에서 아직 끝내지 않은 첫 항목이에요.",
      completionCriterion: "이 항목을 완료로 표시하면 끝나요.",
      source: "saved_checklist",
    },
    guideModules: [],
    relatedMessageRefs: [],
    linkedScheduleIds: [],
    linkedBudgetCategoryKeys: [],
    linkedActionIds: [],
    confirmedScheduleDecisions: [],
    confirmedBudgetDecisions: [],
    linkedDecisionIds: [],
    decisionReadState: "loaded",
    budgetDecisionReadState: "loaded",
    currentVendorBookingRecords: [],
    linkedVendorBookingIds: [],
    vendorBookingReadState: "loaded",
    currentCompletedVendorBookingRecords: records,
    linkedCompletedVendorBookingIds: records.map((record) => record.bookingId),
    completedVendorBookingReadState: readState,
    conflicts: [],
  });
}

test("an in-progress topic becomes a scan-first personalized summary", () => {
  const presentation = buildPreparationTopicPresentation({
    version: 1,
    topicKey: "meeting",
    label: "부모님 첫 만남",
    applicability: "applicable",
    status: "in_progress",
    progress: { completed: 1, total: 2, percent: 50 },
    facts: [
      { key: "checklist:meeting_01", label: "두 가족이 만날 목적 정하기 완료", source: "saved_checklist" },
      { key: "schedule:meeting-event", label: "2026-08-20 · 양가 부모님 첫 만남", source: "linked_schedule" },
    ],
    unknowns: [
      { key: "checklist:meeting_02", label: "참석자와 가능한 날짜 확인하기", source: "unfinished_checklist" },
    ],
    nextAction: {
      title: "참석자와 가능한 날짜 확인하기",
      reason: "저장한 준비 기록에서 아직 끝내지 않은 첫 항목이에요.",
      completionCriterion: "이 항목을 완료로 표시하면 끝나요.",
      source: "saved_checklist",
    },
    guideModules: [],
    relatedMessageRefs: [],
    linkedScheduleIds: ["meeting-event"],
    linkedBudgetCategoryKeys: [],
    linkedActionIds: [],
    conflicts: [],
  });

  assert.deepEqual(withoutPlanFields(presentation), {
    statusLabel: "준비 중",
    statusTone: "rose",
    progressLabel: "2개 중 1개 확인",
    evidenceTitle: "우리 계획과 확인된 준비",
    evidenceLines: [
      "두 가족이 만날 목적 정하기 완료",
      "2026-08-20 · 양가 부모님 첫 만남",
    ],
    remainingLabel: "남은 준비 1개",
    nextAction: {
      eyebrow: "다음 한 가지",
      title: "참석자와 가능한 날짜 확인하기",
      reason: "저장한 준비 기록에서 아직 끝내지 않은 첫 항목이에요.",
      completionCriterion: "이 항목을 완료로 표시하면 끝나요.",
    },
  });
});

test("one validated guide becomes a compact truthful section without changing the next action", () => {
  const [guide] = buildAmoraPreparationGuideModules({
    topicKey: "meeting",
    applicability: "applicable",
    status: "in_progress",
    asOfDate: "2026-08-16",
    checklistItems: [{
      id: "meeting_02",
      label: "만날 장소 정하고 예약",
      done: false,
    }],
  });
  const presentation = buildPreparationTopicPresentation({
    version: 1,
    topicKey: "meeting",
    label: "부모님 첫 만남",
    applicability: "applicable",
    status: "in_progress",
    progress: { completed: 1, total: 6, percent: 17 },
    facts: [],
    unknowns: [{
      key: "checklist:meeting_02",
      label: "만날 장소 정하고 예약",
      source: "unfinished_checklist",
    }],
    nextAction: {
      title: "만날 장소 정하고 예약",
      reason: "저장한 준비 기록에서 아직 끝내지 않은 첫 항목이에요.",
      completionCriterion: "이 항목을 완료로 표시하면 끝나요.",
      source: "saved_checklist",
    },
    guideModules: [guide],
    relatedMessageRefs: [],
    linkedScheduleIds: [],
    linkedBudgetCategoryKeys: [],
    linkedActionIds: [],
    conflicts: [],
  });

  assert.deepEqual(presentation.guideSection, {
    eyebrow: "아모라 가이드",
    moduleId: "meeting.first_family_meeting.v1",
    title: "부모님 첫 만남 전에 맞춰볼 것",
    whyShown: "현재 준비 상태에서 ‘만날 장소 정하고 예약’ 항목이 아직 확인 전이라 이 가이드를 보여드려요.",
    decisions: guide.decisions,
    exceptions: guide.exceptions,
    dialogueLines: guide.dialogueLines,
    completionEvidence: guide.completionEvidence,
    provenance: {
      sourceLabel: "웨딩한방 독립 작성 · 내부 편집 검토",
      reviewedLabel: "2026년 8월 16일 검토",
      scopeLabel: "적용 범위 · 부모님 첫 만남의 참석자·장소·대화 범위 확인",
      limitations: guide.provenance.limitations,
    },
    accessibilityLabel: "아모라 가이드, 부모님 첫 만남 전에 맞춰볼 것, 현재 준비 상태에서 ‘만날 장소 정하고 예약’ 항목이 아직 확인 전이라 이 가이드를 보여드려요.",
  });
  assert.deepEqual(presentation.nextAction, {
    eyebrow: "다음 한 가지",
    title: "만날 장소 정하고 예약",
    reason: "저장한 준비 기록에서 아직 끝내지 않은 첫 항목이에요.",
    completionCriterion: "이 항목을 완료로 표시하면 끝나요.",
  });
});

test("malformed, mismatched, and multiple guide modules hide only the guide section", () => {
  const [guide] = buildAmoraPreparationGuideModules({
    topicKey: "venue",
    applicability: "applicable",
    status: "in_progress",
    asOfDate: "2026-08-16",
    checklistItems: [{
      id: "venue_06",
      label: "취소·변경 때 내거나 돌려받는 금액 확인",
      done: false,
    }],
  });
  const baseView = {
    version: 1,
    topicKey: "meeting",
    label: "부모님 첫 만남",
    applicability: "applicable",
    status: "in_progress",
    progress: { completed: 1, total: 2, percent: 50 },
    facts: [],
    unknowns: [{ key: "checklist:meeting_02", label: "날짜 확인", source: "unfinished_checklist" }],
    nextAction: {
      title: "날짜 확인",
      reason: "아직 확인 전이에요.",
      completionCriterion: "확인하면 끝나요.",
      source: "saved_checklist",
    },
    relatedMessageRefs: [],
    linkedScheduleIds: [],
    linkedBudgetCategoryKeys: [],
    linkedActionIds: [],
    conflicts: [],
  };

  for (const guideModules of [
    [{ ...guide, extra: true }],
    [guide],
    [guide, guide],
    "not-an-array",
  ]) {
    const presentation = buildPreparationTopicPresentation({ ...baseView, guideModules });
    assert.ok(presentation);
    assert.equal(presentation.guideSection, null);
    assert.equal(presentation.nextAction.title, "날짜 확인");
  }
});

test("a guide is rendered only while its exact unfinished item and topic state remain current", () => {
  const [guide] = buildAmoraPreparationGuideModules({
    topicKey: "meeting",
    applicability: "applicable",
    status: "in_progress",
    asOfDate: "2026-08-16",
    checklistItems: [{
      id: "meeting_02",
      label: "만날 장소 정하고 예약",
      done: false,
    }],
  });
  const baseView = {
    version: 1,
    topicKey: "meeting",
    label: "부모님 첫 만남",
    applicability: "applicable",
    status: "in_progress",
    progress: { completed: 1, total: 6, percent: 17 },
    facts: [],
    unknowns: [{
      key: "checklist:meeting_02",
      label: "만날 장소 정하고 예약",
      source: "unfinished_checklist",
    }],
    nextAction: {
      title: "만날 장소 정하고 예약",
      reason: "아직 확인 전이에요.",
      completionCriterion: "확인하면 끝나요.",
      source: "saved_checklist",
    },
    guideModules: [guide],
    relatedMessageRefs: [],
    linkedScheduleIds: [],
    linkedBudgetCategoryKeys: [],
    linkedActionIds: [],
    conflicts: [],
  };
  assert.ok(buildPreparationTopicPresentation(baseView)?.guideSection);

  const staleViews = [
    { ...baseView, topicKey: undefined },
    { ...baseView, unknowns: [] },
    { ...baseView, unknowns: [{
      key: "checklist:meeting_02",
      label: "다른 준비",
      source: "unfinished_checklist",
    }] },
    { ...baseView, unknowns: [{
      key: "checklist:meeting_02",
      label: "만날 장소 정하고 예약",
      source: "linked_schedule",
    }] },
    {
      ...baseView,
      status: "completed",
      progress: { completed: 6, total: 6, percent: 100 },
      nextAction: null,
    },
    {
      ...baseView,
      status: "decision_needed",
      conflicts: [{ key: "changed", label: "기록 확인 필요" }],
    },
    {
      ...baseView,
      applicability: "not_applicable",
      status: "not_started",
      nextAction: null,
    },
  ];
  for (const staleView of staleViews) {
    const presentation = buildPreparationTopicPresentation(staleView);
    assert.ok(presentation);
    assert.equal(presentation.guideSection, null);
  }
});

test("current shared schedule receipts become a compact read-only confirmation section", () => {
  const presentation = buildPreparationTopicPresentation({
    version: 1,
    topicKey: "meeting",
    label: "부모님 첫 만남",
    applicability: "applicable",
    status: "in_progress",
    progress: { completed: 1, total: 2, percent: 50 },
    facts: [],
    unknowns: [{ key: "checklist:2", label: "참석자 확인", source: "unfinished_checklist" }],
    nextAction: {
      title: "참석자 확인",
      reason: "저장한 준비 기록에서 아직 끝내지 않은 첫 항목이에요.",
      completionCriterion: "이 항목을 완료로 표시하면 끝나요.",
      source: "saved_checklist",
    },
    guideModules: [],
    relatedMessageRefs: [],
    linkedScheduleIds: ["meeting-event"],
    linkedBudgetCategoryKeys: [],
    linkedActionIds: [],
    confirmedScheduleDecisions: [
      {
        id: "50000000-0000-4000-8000-000000000001",
        eventId: "meeting-event",
        title: "일정 추가 · 양가 부모님 첫 만남",
        date: "2026-09-05",
        confirmedAt: "2026-08-15T09:00:00.000Z",
        scope: "couple_shared",
      },
      {
        id: "50000000-0000-4000-8000-000000000002",
        eventId: "restaurant-event",
        title: "일정 수정 · 식당 답사",
        date: "2026-08-22",
        confirmedAt: "2026-08-14T09:00:00.000Z",
        scope: "couple_shared",
      },
      {
        id: "50000000-0000-4000-8000-000000000003",
        eventId: "call-event",
        title: "일정 추가 · 부모님 통화",
        date: "2026-08-20",
        confirmedAt: "2026-08-13T09:00:00.000Z",
        scope: "couple_shared",
      },
    ],
    linkedDecisionIds: [
      "50000000-0000-4000-8000-000000000001",
      "50000000-0000-4000-8000-000000000002",
      "50000000-0000-4000-8000-000000000003",
    ],
    decisionReadState: "loaded",
    conflicts: [],
  });

  assert.deepEqual(presentation?.confirmedScheduleSection, {
    title: "확인한 일정 기록",
    items: [
      {
        id: "50000000-0000-4000-8000-000000000001",
        title: "일정 추가 · 양가 부모님 첫 만남",
        meta: "함께 보는 기록 · 8월 15일 확인",
        accessibilityLabel: "확인한 일정 기록, 일정 추가 · 양가 부모님 첫 만남, 함께 보는 기록, 8월 15일 확인",
      },
      {
        id: "50000000-0000-4000-8000-000000000002",
        title: "일정 수정 · 식당 답사",
        meta: "함께 보는 기록 · 8월 14일 확인",
        accessibilityLabel: "확인한 일정 기록, 일정 수정 · 식당 답사, 함께 보는 기록, 8월 14일 확인",
      },
    ],
    additionalLabel: "그 외 1개 일정 기록",
  });
  assert.equal(
    JSON.stringify(presentation?.confirmedScheduleSection).includes("둘이 확인"),
    false,
  );
});

test("confirmed budget history shows one scope-accurate non-payment row without leaking receipt details", () => {
  const decisionId = "50000000-0000-4000-8000-000000000071";
  const hiddenRequestId = "60000000-0000-4000-8000-000000000071";
  const hiddenMemberId = "70000000-0000-4000-8000-000000000071";
  const nextDecisionId = "50000000-0000-4000-8000-000000000072";
  const presentation = presentConfirmedBudget([
    {
      id: decisionId,
      title: `예산 500만원 · 요청 ${hiddenRequestId} · 구성원 ${hiddenMemberId}`,
      confirmedAt: "2026-08-15T09:05:00.000Z",
      confirmationScope: "couple",
      appliedRevision: 8,
      scope: "couple_shared",
    },
    {
      id: nextDecisionId,
      title: "진행 상황: 1개 수정",
      confirmedAt: "2026-08-14T09:05:00.000Z",
      confirmationScope: "current_member",
      appliedRevision: 7,
      scope: "couple_shared",
    },
  ]);

  assert.deepEqual(presentation?.confirmedBudgetSection, {
    title: "확인한 예산 기록",
    items: [{
      key: "confirmed-budget",
      title: "두 사람이 확인한 예산 기록",
      meta: "준비 예산 변경 · 결제 기록이 아니에요.",
      accessibilityLabel: "확인한 예산 기록, 두 사람이 확인한 예산 기록, 준비 예산 변경, 결제 기록이 아니에요",
    }],
    notice: null,
  });
  const serialized = JSON.stringify(presentation?.confirmedBudgetSection);
  for (const hiddenValue of ["500만원", decisionId, nextDecisionId, hiddenRequestId, hiddenMemberId]) {
    assert.equal(serialized.includes(hiddenValue), false, hiddenValue);
  }

  const currentMember = presentConfirmedBudget([{
    id: decisionId,
    title: "진행 상황: 1개 수정",
    confirmedAt: "2026-08-15T09:05:00.000Z",
    confirmationScope: "current_member",
    appliedRevision: 8,
    scope: "couple_shared",
  }]);
  assert.equal(
    currentMember?.confirmedBudgetSection?.items[0]?.title,
    "현재 구성원이 확인한 예산 기록",
  );
  const baseline = presentConfirmedBudget([], "loaded");
  for (const field of ["statusLabel", "progressLabel", "nextAction"]) {
    assert.deepEqual(presentation?.[field], baseline?.[field], field);
    assert.deepEqual(currentMember?.[field], baseline?.[field], field);
  }
});

test("budget history read states stay truthful in a non-clicking confirmed-row section", () => {
  const decision = {
    id: "50000000-0000-4000-8000-000000000071",
    title: "진행 상황: 1개 수정",
    confirmedAt: "2026-08-15T09:05:00.000Z",
    confirmationScope: "couple",
    appliedRevision: 8,
    scope: "couple_shared",
  };
  assert.equal(presentConfirmedBudget([], "loaded")?.confirmedBudgetSection, null);
  assert.deepEqual(
    presentConfirmedBudget([decision], "partial")?.confirmedBudgetSection,
    {
      title: "확인한 예산 기록",
      items: [{
        key: "confirmed-budget",
        title: "두 사람이 확인한 예산 기록",
        meta: "준비 예산 변경 · 결제 기록이 아니에요.",
        accessibilityLabel: "확인한 예산 기록, 두 사람이 확인한 예산 기록, 준비 예산 변경, 결제 기록이 아니에요",
      }],
      notice: "확인한 예산 기록 조회가 일부만 완료됐어요. 새로고침해 다시 확인해 주세요.",
    },
  );
  assert.deepEqual(
    presentConfirmedBudget([decision], "unavailable")?.confirmedBudgetSection,
    {
      title: "확인한 예산 기록",
      items: [],
      notice: "확인한 예산 기록을 지금 불러오지 못했어요.",
    },
  );

  const sectionStart = summarySource.indexOf("{presentation.confirmedBudgetSection ? (");
  const sectionEnd = summarySource.indexOf("{presentation.bookingDecisionSection ? (", sectionStart);
  assert.ok(sectionStart >= 0 && sectionEnd > sectionStart);
  const sectionSource = summarySource.slice(sectionStart, sectionEnd);
  assert.match(sectionSource, /style=\{styles\.confirmedRow\}/);
  assert.match(sectionSource, /style=\{styles\.confirmedDot\}/);
  assert.match(sectionSource, /style=\{styles\.confirmedCopy\}/);
  assert.doesNotMatch(sectionSource, /Pressable|ActionRow|onPress|router|navigation/);
});

test("current provider-unconfirmed booking intents reuse the compact evidence rhythm and show at most two", () => {
  const presentation = buildPreparationTopicPresentation({
    version: 1,
    topicKey: "studio",
    label: "웨딩 사진 촬영",
    applicability: "applicable",
    status: "in_progress",
    progress: { completed: 1, total: 2, percent: 50 },
    facts: [],
    unknowns: [{ key: "checklist:2", label: "업체 후보 비교", source: "unfinished_checklist" }],
    nextAction: {
      title: "업체 후보 비교",
      reason: "저장한 준비 기록에서 아직 끝내지 않은 첫 항목이에요.",
      completionCriterion: "이 항목을 완료로 표시하면 끝나요.",
      source: "saved_checklist",
    },
    guideModules: [],
    relatedMessageRefs: [],
    linkedScheduleIds: [],
    linkedBudgetCategoryKeys: [],
    linkedActionIds: [],
    confirmedScheduleDecisions: [],
    linkedDecisionIds: [],
    decisionReadState: "loaded",
    currentVendorBookingRecords: [
      {
        bookingId: "80000000-0000-4000-8000-000000000001",
        decisionId: "50000000-0000-4000-8000-000000000051",
        vendorId: "90000000-0000-4000-8000-000000000001",
        productId: "91000000-0000-4000-8000-000000000001",
        vendorName: "한방 스튜디오",
        productName: "올인원 촬영",
        bookingDate: "2026-09-20",
        bookingTime: "10:00",
        quotedAmountWon: 500_000,
        initiatedByProfileId: "70000000-0000-4000-8000-000000000001",
        initiatedAt: "2026-08-15T09:00:00.000Z",
        recordScope: "amora_internal_request",
        evidence: "actor_bound_atomic_intent",
        vendorDeliveryStatus: "not_sent",
        vendorConfirmationStatus: "unconfirmed",
      },
      {
        bookingId: "80000000-0000-4000-8000-000000000002",
        decisionId: "50000000-0000-4000-8000-000000000052",
        vendorId: "90000000-0000-4000-8000-000000000002",
        productId: null,
        vendorName: "두번째 스튜디오",
        productName: null,
        bookingDate: "2026-09-21",
        bookingTime: "11:00",
        quotedAmountWon: 0,
        initiatedByProfileId: "70000000-0000-4000-8000-000000000001",
        initiatedAt: "2026-08-15T10:00:00.000Z",
        recordScope: "amora_internal_request",
        evidence: "actor_bound_atomic_intent",
        vendorDeliveryStatus: "not_sent",
        vendorConfirmationStatus: "unconfirmed",
      },
      {
        bookingId: "80000000-0000-4000-8000-000000000003",
        decisionId: "50000000-0000-4000-8000-000000000053",
        vendorId: "90000000-0000-4000-8000-000000000003",
        productId: null,
        vendorName: "세번째 스튜디오",
        productName: null,
        bookingDate: "2026-09-22",
        bookingTime: "12:00",
        quotedAmountWon: 0,
        initiatedByProfileId: "70000000-0000-4000-8000-000000000001",
        initiatedAt: "2026-08-15T11:00:00.000Z",
        recordScope: "amora_internal_request",
        evidence: "actor_bound_atomic_intent",
        vendorDeliveryStatus: "not_sent",
        vendorConfirmationStatus: "unconfirmed",
      },
    ],
    linkedVendorBookingIds: [
      "80000000-0000-4000-8000-000000000001",
      "80000000-0000-4000-8000-000000000002",
      "80000000-0000-4000-8000-000000000003",
    ],
    vendorBookingReadState: "loaded",
    conflicts: [],
  });

  assert.deepEqual(presentation?.bookingDecisionSection, {
    title: "방문·상담 후보 기록",
    items: [
      {
        id: "80000000-0000-4000-8000-000000000001",
        title: "한방 스튜디오 · 올인원 촬영",
        detail: "9월 20일 10:00 방문 후보",
        meta: "아모라 내부 기록 · 업체에 전달·확정된 예약이 아니에요.",
        accessibilityLabel: "방문·상담 후보 기록, 한방 스튜디오 · 올인원 촬영, 9월 20일 10:00 방문 후보, 아모라 내부 기록, 업체에 전달·확정된 예약이 아니에요",
      },
      {
        id: "80000000-0000-4000-8000-000000000002",
        title: "두번째 스튜디오",
        detail: "9월 21일 11:00 방문 후보",
        meta: "아모라 내부 기록 · 업체에 전달·확정된 예약이 아니에요.",
        accessibilityLabel: "방문·상담 후보 기록, 두번째 스튜디오, 9월 21일 11:00 방문 후보, 아모라 내부 기록, 업체에 전달·확정된 예약이 아니에요",
      },
    ],
    additionalLabel: "그 외 1개 후보 기록",
    notice: null,
  });
  assert.equal(JSON.stringify(presentation).includes("둘이 확인"), false);
  assert.equal(JSON.stringify(presentation).includes("예약 확정"), false);
});

test("an exact completed outcome is shown only as a user-recorded completion and spend record", () => {
  const presentation = buildPreparationTopicPresentation({
    version: 1,
    topicKey: "studio",
    label: "웨딩 사진 촬영",
    applicability: "applicable",
    status: "in_progress",
    progress: { completed: 1, total: 2, percent: 50 },
    facts: [],
    unknowns: [{ key: "checklist:2", label: "사진 수령 확인", source: "unfinished_checklist" }],
    nextAction: {
      title: "사진 수령 확인",
      reason: "저장한 준비 기록에서 아직 끝내지 않은 첫 항목이에요.",
      completionCriterion: "이 항목을 완료로 표시하면 끝나요.",
      source: "saved_checklist",
    },
    guideModules: [],
    relatedMessageRefs: [],
    linkedScheduleIds: [],
    linkedBudgetCategoryKeys: [],
    linkedActionIds: [],
    confirmedScheduleDecisions: [],
    confirmedBudgetDecisions: [],
    linkedDecisionIds: [],
    decisionReadState: "loaded",
    budgetDecisionReadState: "loaded",
    currentVendorBookingRecords: [],
    linkedVendorBookingIds: [],
    vendorBookingReadState: "loaded",
    currentCompletedVendorBookingRecords: [{
      bookingId: "80000000-0000-4000-8000-000000000011",
      decisionId: "50000000-0000-4000-8000-000000000061",
      vendorId: "90000000-0000-4000-8000-000000000011",
      productId: "91000000-0000-4000-8000-000000000011",
      vendorName: "한방 스튜디오",
      productName: "올인원 촬영",
      bookingDate: "2026-08-16",
      bookingTime: "10:00",
      quotedAmountWon: 500_000,
      contractedAmountWon: 450_000,
      actualAmountWon: 520_000,
      userConfirmedAt: "2026-08-16T09:00:00.000Z",
      decidedAt: "2026-08-16T09:00:01.000Z",
      recordScope: "amora_internal_completed_outcome",
      evidence: "actor_bound_atomic_user_report",
      completionEvidence: "user_reported",
      vendorDeliveryStatus: "not_sent",
      vendorConfirmationStatus: "unconfirmed",
      isPaid: false,
    }],
    linkedCompletedVendorBookingIds: ["80000000-0000-4000-8000-000000000011"],
    completedVendorBookingReadState: "loaded",
    conflicts: [],
  });

  assert.deepEqual(presentation?.completedBookingOutcomeSection, {
    title: "직접 남긴 완료·지출 기록",
    items: [{
      id: "80000000-0000-4000-8000-000000000011",
      title: "한방 스튜디오 · 올인원 촬영",
      detail: "8월 16일 10:00 완료로 기록",
      amount: "계약으로 입력한 금액 45만원 · 직접 기록한 지출 52만원",
      meta: "사용자가 직접 남긴 내부 기록 · 업체 확인·결제 증빙이 아니에요.",
      accessibilityLabel: "직접 남긴 완료·지출 기록, 한방 스튜디오 · 올인원 촬영, 8월 16일 10:00 완료로 기록, 계약으로 입력한 금액 45만원, 직접 기록한 지출 52만원, 업체 확인·결제 증빙이 아니에요",
    }],
    additionalLabel: null,
    notice: null,
  });
});

test("a zero-spend completed outcome stays visible without inventing a contract amount", () => {
  const presentation = presentCompletedOutcomes([completedOutcomeRecord()]);

  assert.equal(
    presentation?.completedBookingOutcomeSection?.items[0]?.amount,
    "직접 기록한 지출 0원",
  );
});

test("completed outcome evidence stays scan-first at two records", () => {
  const records = [1, 2, 3].map((index) => completedOutcomeRecord({
    bookingId: `80000000-0000-4000-8000-00000000002${index}`,
    decisionId: `50000000-0000-4000-8000-00000000007${index}`,
    vendorId: `90000000-0000-4000-8000-00000000002${index}`,
    vendorName: `${index}번 스튜디오`,
  }));
  const section = presentCompletedOutcomes(records)?.completedBookingOutcomeSection;

  assert.deepEqual(section?.items.map((item) => item.id), [
    "80000000-0000-4000-8000-000000000021",
    "80000000-0000-4000-8000-000000000022",
  ]);
  assert.equal(section?.additionalLabel, "그 외 1개 완료 기록");
});

test("completed outcome read failures stay visible while malformed rows fail closed", () => {
  assert.deepEqual(
    presentCompletedOutcomes([], "partial")?.completedBookingOutcomeSection,
    {
      title: "직접 남긴 완료·지출 기록",
      items: [],
      additionalLabel: null,
      notice: "완료·지출 기록 조회가 일부만 완료됐어요. 새로고침해 다시 확인해 주세요.",
    },
  );
  assert.deepEqual(
    presentCompletedOutcomes([completedOutcomeRecord()], "unavailable")
      ?.completedBookingOutcomeSection,
    {
      title: "직접 남긴 완료·지출 기록",
      items: [],
      additionalLabel: null,
      notice: "완료·지출 기록을 지금 불러오지 못했어요.",
    },
  );
  assert.equal(
    presentCompletedOutcomes([{ malformed: true }])?.completedBookingOutcomeSection,
    null,
  );
});

test("completed outcome rows are static evidence without navigation, writes, or private provenance", () => {
  const sectionStart = summarySource.indexOf(
    "{presentation.completedBookingOutcomeSection ? (",
  );
  const sectionEnd = summarySource.indexOf(
    "{presentation.bookingDecisionSection ? (",
    sectionStart,
  );
  assert.ok(sectionStart >= 0 && sectionEnd > sectionStart);
  const sectionSource = summarySource.slice(sectionStart, sectionEnd);
  assert.match(sectionSource, /completedBookingOutcomeSection\.items\.map/);
  assert.match(sectionSource, /item\.detail/);
  assert.match(sectionSource, /item\.amount/);
  assert.match(sectionSource, /item\.meta/);
  assert.match(sectionSource, /accessibilityLabel=\{item\.accessibilityLabel\}/);
  assert.doesNotMatch(
    sectionSource,
    /Pressable|ActionRow|onPress|router|navigation|review|rating|completedByProfileId|sourceActorRole/,
  );
});

test("booking read states stay visible inside the expanded topic without inventing an empty success", () => {
  const buildWithReadState = (
    vendorBookingReadState,
    currentVendorBookingRecords = [],
  ) => buildPreparationTopicPresentation({
    version: 1,
    topicKey: "studio",
    label: "스튜디오 사진 촬영",
    applicability: "applicable",
    status: "not_started",
    progress: { completed: 0, total: 1, percent: 0 },
    facts: [],
    unknowns: [{ key: "checklist:1", label: "업체 후보 비교", source: "unfinished_checklist" }],
    nextAction: {
      title: "업체 후보 비교",
      reason: "저장한 준비 기록에서 아직 끝내지 않은 첫 항목이에요.",
      completionCriterion: "이 항목을 완료로 표시하면 끝나요.",
      source: "saved_checklist",
    },
    guideModules: [],
    relatedMessageRefs: [],
    linkedScheduleIds: [],
    linkedBudgetCategoryKeys: [],
    linkedActionIds: [],
    confirmedScheduleDecisions: [],
    linkedDecisionIds: [],
    decisionReadState: "loaded",
    currentVendorBookingRecords,
    linkedVendorBookingIds: [],
    vendorBookingReadState,
    conflicts: [],
  });

  assert.equal(buildWithReadState("loaded")?.bookingDecisionSection, null);
  assert.deepEqual(buildWithReadState("partial")?.bookingDecisionSection, {
    title: "방문·상담 후보 기록",
    items: [],
    additionalLabel: null,
      notice: "후보 기록 조회가 일부만 완료됐어요. 새로고침해 다시 확인해 주세요.",
  });
  assert.deepEqual(buildWithReadState("unavailable")?.bookingDecisionSection, {
    title: "방문·상담 후보 기록",
    items: [],
    additionalLabel: null,
    notice: "방문·상담 후보 기록을 지금 불러오지 못했어요.",
  });
  assert.doesNotThrow(() => buildWithReadState("partial", { malformed: true }));
});

test("a verified topic budget is easy to scan without pretending recorded spending is paid", () => {
  const presentation = buildPreparationTopicPresentation({
    version: 1,
    topicKey: "meeting",
    label: "부모님 첫 만남",
    applicability: "applicable",
    status: "in_progress",
    progress: { completed: 1, total: 2, percent: 50 },
    facts: [],
    unknowns: [{ key: "checklist:2", label: "날짜 확인", source: "unfinished_checklist" }],
    nextAction: {
      title: "날짜 확인",
      reason: "저장한 준비 기록에서 아직 끝내지 않은 첫 항목이에요.",
      completionCriterion: "이 항목을 완료로 표시하면 끝나요.",
      source: "saved_checklist",
    },
    guideModules: [],
    relatedMessageRefs: [],
    linkedScheduleIds: [],
    linkedBudgetCategoryKeys: ["meeting"],
    linkedActionIds: [],
    budgetSummary: {
      state: "ready",
      categoryKey: "meeting",
      budgetWon: 3_000_000,
      spentWon: 1_000_000,
      payer: "couple",
    },
    actionReadState: "loaded",
    conflicts: [],
  });

  assert.deepEqual(presentation?.budgetAction, {
    categoryKey: "meeting",
    title: "예산 300만원 · 기록 지출 100만원",
    description: "분담 · 두 사람",
    canOpen: true,
  });
  assert.equal(presentation?.budgetAction?.title.includes("결제 완료"), false);
});

test("empty, over-budget, and malformed budget records stay explicit", () => {
  assert.deepEqual(presentBudget({
    state: "empty",
    categoryKey: "meeting",
    budgetWon: null,
    spentWon: null,
    payer: null,
  })?.budgetAction, {
    categoryKey: "meeting",
    title: "예산 입력 전",
    description: "이 준비에 쓸 범위를 정해두면 비교가 쉬워져요.",
    canOpen: true,
  });

  assert.deepEqual(presentBudget({
    state: "ready",
    categoryKey: "meeting",
    budgetWon: 3_000_000,
    spentWon: 3_500_000,
    payer: null,
  })?.budgetAction, {
    categoryKey: "meeting",
    title: "예산 300만원 · 기록 지출 350만원",
    description: "입력 예산보다 50만원 많아요",
    canOpen: true,
  });

  assert.deepEqual(presentBudget({
    state: "invalid",
    categoryKey: "meeting",
  })?.budgetAction, {
    categoryKey: "meeting",
    title: "예산 기록 확인 필요",
    description: "저장된 금액 형식을 안전하게 읽지 못했어요.",
    canOpen: false,
  });
});

test("neutral preparation spaces present legacy budget payer keys relative to the viewer", () => {
  const summary = {
    state: "ready",
    categoryKey: "meeting",
    budgetWon: 3_000_000,
    spentWon: 1_000_000,
    payer: "bride_parents",
  };

  assert.equal(
    presentBudget(summary)?.budgetAction?.description,
    "분담 · 예비 신부 가족",
  );
  assert.equal(
    presentBudget(summary, {
      memberModelVersion: 2,
      viewerRole: "bride",
    })?.budgetAction?.description,
    "분담 · 내 가족",
  );
  assert.equal(
    presentBudget(summary, {
      memberModelVersion: 2,
      viewerRole: "groom",
    })?.budgetAction?.description,
    "분담 · 파트너 가족",
  );

  const unknownV2 = presentBudget(summary, {
    memberModelVersion: 2,
    viewerRole: null,
  });
  assert.equal(unknownV2?.budgetAction?.description, null);
  assert.doesNotMatch(JSON.stringify(unknownV2), /예비 신부|예비 신랑/u);
});

test("an action-led topic says a plan is connected instead of calling it a schedule", () => {
  const presentation = buildPreparationTopicPresentation({
    version: 1,
    topicKey: "meeting",
    label: "부모님 첫 만남",
    applicability: "applicable",
    status: "exploring",
    progress: { completed: 0, total: 2, percent: 0 },
    facts: [{
      key: "action:meeting-action",
      label: "진행 중 행동 · 부모님께 가능한 날짜 여쭤보기",
      source: "linked_action",
    }],
    unknowns: [
      { key: "checklist:1", label: "목적 확인", source: "unfinished_checklist" },
      { key: "checklist:2", label: "참석자 확인", source: "unfinished_checklist" },
    ],
    nextAction: {
      title: "부모님께 가능한 날짜 여쭤보기",
      reason: "공동 준비 기록에 저장한 열린 행동이에요.",
      completionCriterion: "이 행동을 실제로 마친 뒤 완료로 기록하면 끝나요.",
      source: "linked_action",
    },
    guideModules: [],
    relatedMessageRefs: [],
    linkedScheduleIds: [],
    linkedBudgetCategoryKeys: [],
    linkedActionIds: ["meeting-action"],
    budgetSummary: null,
    actionReadState: "loaded",
    conflicts: [],
  });

  assert.equal(presentation?.statusLabel, "계획 연결됨");
  assert.equal(presentation?.progressLabel, "연결된 계획 1개 · 준비 2개 확인 전");
  assert.equal(presentation?.evidenceTitle, "우리 계획과 확인된 준비");
});

test("an unavailable shared-action read limits the recommendation claim and stays visible", () => {
  const presentation = buildPreparationTopicPresentation({
    version: 1,
    topicKey: "meeting",
    label: "부모님 첫 만남",
    applicability: "applicable",
    status: "in_progress",
    progress: { completed: 1, total: 2, percent: 50 },
    facts: [{ key: "checklist:1", label: "목적 정하기 완료", source: "saved_checklist" }],
    unknowns: [{ key: "checklist:2", label: "날짜 확인", source: "unfinished_checklist" }],
    nextAction: {
      title: "날짜 확인",
      reason: "저장한 준비 기록에서 아직 끝내지 않은 첫 항목이에요.",
      completionCriterion: "이 항목을 완료로 표시하면 끝나요.",
      source: "saved_checklist",
    },
    guideModules: [],
    relatedMessageRefs: [],
    linkedScheduleIds: [],
    linkedBudgetCategoryKeys: ["meeting"],
    linkedActionIds: [],
    budgetSummary: {
      state: "empty",
      categoryKey: "meeting",
      budgetWon: null,
      spentWon: null,
      payer: null,
    },
    actionReadState: "unavailable",
    conflicts: [],
  });

  assert.equal(
    presentation?.actionReadNotice,
    "저장된 공동 행동은 지금 확인하지 못했어요. 아래 내용은 체크리스트와 일정 기준이에요.",
  );
  assert.equal(presentation?.nextAction?.eyebrow, "확인된 기록 기준");
});

test("an unknown topic explains the first decision without showing a fake zero-percent failure", () => {
  const presentation = buildPreparationTopicPresentation({
    version: 1,
    topicKey: "meeting",
    label: "부모님 첫 만남",
    applicability: "unknown",
    status: "not_started",
    progress: { completed: 0, total: 2, percent: 0 },
    facts: [],
    unknowns: [{
      key: "applicability",
      label: "우리에게 필요한 준비인지 아직 확인하지 않았어요.",
      source: "no_saved_record",
    }],
    nextAction: {
      title: "부모님 첫 만남이 우리에게 필요한지 확인하기",
      reason: "아직 확인한 준비 기록이 없어요.",
      completionCriterion: "준비할지 하지 않을지 직접 정하면 끝나요.",
      source: "applicability",
    },
    guideModules: [],
    relatedMessageRefs: [],
    linkedScheduleIds: [],
    linkedBudgetCategoryKeys: [],
    linkedActionIds: [],
    conflicts: [],
  });

  assert.deepEqual(withoutPlanFields(presentation), {
    statusLabel: "확인 전",
    statusTone: "neutral",
    progressLabel: "필요한 준비인지 먼저 확인해요.",
    evidenceTitle: "확인된 준비",
    evidenceLines: [],
    remainingLabel: "아직 확인하지 않은 준비 1개",
    nextAction: {
      eyebrow: "먼저 확인할 것",
      title: "부모님 첫 만남이 우리에게 필요한지 확인하기",
      reason: "아직 확인한 준비 기록이 없어요.",
      completionCriterion: "준비할지 하지 않을지 직접 정하면 끝나요.",
    },
  });
});

test("an excluded topic shows the couple's choice without a next-action card", () => {
  const presentation = buildPreparationTopicPresentation({
    version: 1,
    topicKey: "meeting",
    label: "부모님 첫 만남",
    applicability: "not_applicable",
    status: "not_started",
    progress: { completed: 0, total: 0, percent: 0 },
    facts: [{ key: "applicability", label: "우리에게는 하지 않기로 정했어요.", source: "saved_checklist" }],
    unknowns: [],
    nextAction: null,
    guideModules: [],
    relatedMessageRefs: [],
    linkedScheduleIds: [],
    linkedBudgetCategoryKeys: [],
    linkedActionIds: [],
    conflicts: [],
  });

  assert.deepEqual(withoutPlanFields(presentation), {
    statusLabel: "해당 없음",
    statusTone: "neutral",
    progressLabel: "우리에게는 하지 않기로 정했어요.",
    evidenceTitle: "확인된 준비",
    evidenceLines: ["우리에게는 하지 않기로 정했어요."],
    remainingLabel: null,
    nextAction: null,
  });
});

test("a conflicting topic is visibly a review state rather than a confident recommendation", () => {
  const presentation = buildPreparationTopicPresentation({
    version: 1,
    topicKey: "meeting",
    label: "부모님 첫 만남",
    applicability: "applicable",
    status: "decision_needed",
    progress: { completed: 1, total: 2, percent: 50 },
    facts: [{ key: "checklist:meeting_01", label: "두 가족이 만날 목적 정하기 완료", source: "saved_checklist" }],
    unknowns: [{ key: "checklist:meeting_02", label: "참석자와 가능한 날짜 확인하기", source: "unfinished_checklist" }],
    nextAction: {
      title: "부모님 첫 만남 기록 확인하기",
      reason: "완료 상태와 체크 항목이 서로 맞지 않아요.",
      completionCriterion: "현재 준비 상태를 다시 저장하면 끝나요.",
      source: "conflict",
    },
    guideModules: [],
    relatedMessageRefs: [],
    linkedScheduleIds: [],
    linkedBudgetCategoryKeys: [],
    linkedActionIds: [],
    conflicts: [{ key: "saved_state_mismatch", label: "저장된 완료 상태와 체크 항목이 서로 맞지 않아요." }],
  });

  assert.deepEqual(withoutPlanFields(presentation), {
    statusLabel: "기록 확인 필요",
    statusTone: "warning",
    progressLabel: "서로 다른 준비 기록을 먼저 확인해요.",
    evidenceTitle: "확인된 준비",
    evidenceLines: ["두 가족이 만날 목적 정하기 완료"],
    remainingLabel: "확인할 기록 1개",
    nextAction: {
      eyebrow: "먼저 바로잡을 것",
      title: "부모님 첫 만남 기록 확인하기",
      reason: "완료 상태와 체크 항목이 서로 맞지 않아요.",
      completionCriterion: "현재 준비 상태를 다시 저장하면 끝나요.",
    },
  });
});

test("a completed topic closes cleanly without inventing more work", () => {
  const presentation = buildPreparationTopicPresentation({
    version: 1,
    topicKey: "meeting",
    label: "부모님 첫 만남",
    applicability: "applicable",
    status: "completed",
    progress: { completed: 2, total: 2, percent: 100 },
    facts: [
      { key: "checklist:meeting_01", label: "두 가족이 만날 목적 정하기 완료", source: "saved_checklist" },
      { key: "checklist:meeting_02", label: "참석자와 가능한 날짜 확인하기 완료", source: "saved_checklist" },
    ],
    unknowns: [],
    nextAction: null,
    guideModules: [],
    relatedMessageRefs: [],
    linkedScheduleIds: [],
    linkedBudgetCategoryKeys: [],
    linkedActionIds: [],
    conflicts: [],
  });

  assert.deepEqual(withoutPlanFields(presentation), {
    statusLabel: "준비 완료",
    statusTone: "success",
    progressLabel: "2개 모두 확인했어요.",
    evidenceTitle: "확인된 준비",
    evidenceLines: [
      "두 가족이 만날 목적 정하기 완료",
      "참석자와 가능한 날짜 확인하기 완료",
    ],
    remainingLabel: null,
    nextAction: null,
  });
});

test("an applicable saved topic with no completed items starts from one concrete task", () => {
  const presentation = buildPreparationTopicPresentation({
    version: 1,
    topicKey: "meeting",
    label: "부모님 첫 만남",
    applicability: "applicable",
    status: "not_started",
    progress: { completed: 0, total: 2, percent: 0 },
    facts: [],
    unknowns: [
      { key: "checklist:meeting_01", label: "두 가족이 만날 목적 정하기", source: "unfinished_checklist" },
      { key: "checklist:meeting_02", label: "참석자와 가능한 날짜 확인하기", source: "unfinished_checklist" },
    ],
    nextAction: {
      title: "두 가족이 만날 목적 정하기",
      reason: "저장한 준비 기록에서 아직 끝내지 않은 첫 항목이에요.",
      completionCriterion: "이 항목을 완료로 표시하면 끝나요.",
      source: "saved_checklist",
    },
    guideModules: [],
    relatedMessageRefs: [],
    linkedScheduleIds: [],
    linkedBudgetCategoryKeys: [],
    linkedActionIds: [],
    conflicts: [],
  });

  assert.deepEqual(withoutPlanFields(presentation), {
    statusLabel: "준비 전",
    statusTone: "neutral",
    progressLabel: "2개 중 아직 확인한 항목이 없어요.",
    evidenceTitle: "확인된 준비",
    evidenceLines: [],
    remainingLabel: "남은 준비 2개",
    nextAction: {
      eyebrow: "다음 한 가지",
      title: "두 가족이 만날 목적 정하기",
      reason: "저장한 준비 기록에서 아직 끝내지 않은 첫 항목이에요.",
      completionCriterion: "이 항목을 완료로 표시하면 끝나요.",
    },
  });
});

test("an excluded topic with a linked schedule is shown as a conflict, not hidden as excluded", () => {
  const presentation = buildPreparationTopicPresentation({
    version: 1,
    topicKey: "meeting",
    label: "부모님 첫 만남",
    applicability: "not_applicable",
    status: "decision_needed",
    progress: { completed: 0, total: 0, percent: 0 },
    facts: [
      { key: "applicability", label: "우리에게는 하지 않기로 정했어요.", source: "saved_checklist" },
      { key: "schedule:meeting-event", label: "2026-08-20 · 양가 부모님 첫 만남", source: "linked_schedule" },
    ],
    unknowns: [],
    nextAction: {
      title: "부모님 첫 만남 기록 확인하기",
      reason: "준비 목록에서는 제외했지만 연결된 일정이 있어요.",
      completionCriterion: "일정을 유지할지, 준비에서 제외할지 다시 정하면 끝나요.",
      source: "conflict",
    },
    guideModules: [],
    relatedMessageRefs: [],
    linkedScheduleIds: ["meeting-event"],
    linkedBudgetCategoryKeys: [],
    linkedActionIds: [],
    conflicts: [{ key: "excluded_with_active_schedule", label: "제외한 준비에 연결된 일정이 남아 있어요." }],
  });

  assert.deepEqual(withoutPlanFields(presentation), {
    statusLabel: "기록 확인 필요",
    statusTone: "warning",
    progressLabel: "서로 다른 준비 기록을 먼저 확인해요.",
    evidenceTitle: "우리 계획과 확인된 준비",
    evidenceLines: [
      "우리에게는 하지 않기로 정했어요.",
      "2026-08-20 · 양가 부모님 첫 만남",
    ],
    remainingLabel: "확인할 기록 1개",
    nextAction: {
      eyebrow: "먼저 바로잡을 것",
      title: "부모님 첫 만남 기록 확인하기",
      reason: "준비 목록에서는 제외했지만 연결된 일정이 있어요.",
      completionCriterion: "일정을 유지할지, 준비에서 제외할지 다시 정하면 끝나요.",
    },
  });
});

test("a schedule-led topic shows the real event and one checklist step", () => {
  const presentation = buildPreparationTopicPresentation({
    version: 1,
    topicKey: "meeting",
    label: "부모님 첫 만남",
    applicability: "applicable",
    status: "exploring",
    progress: { completed: 0, total: 2, percent: 0 },
    facts: [{ key: "schedule:meeting-event", label: "2026-08-20 · 양가 부모님 첫 만남", source: "linked_schedule" }],
    unknowns: [
      { key: "checklist:meeting_01", label: "두 가족이 만날 목적 정하기", source: "unfinished_checklist" },
      { key: "checklist:meeting_02", label: "참석자와 가능한 날짜 확인하기", source: "unfinished_checklist" },
    ],
    nextAction: {
      title: "두 가족이 만날 목적 정하기",
      reason: "연결된 일정은 있지만 준비 항목은 아직 확인하지 않았어요.",
      completionCriterion: "이 항목을 완료로 표시하면 끝나요.",
      source: "linked_schedule",
    },
    guideModules: [],
    relatedMessageRefs: [],
    linkedScheduleIds: ["meeting-event"],
    linkedBudgetCategoryKeys: [],
    linkedActionIds: [],
    conflicts: [],
  });

  assert.deepEqual(withoutPlanFields(presentation), {
    statusLabel: "계획 연결됨",
    statusTone: "rose",
    progressLabel: "연결된 계획 1개 · 준비 2개 확인 전",
    evidenceTitle: "우리 계획과 확인된 준비",
    evidenceLines: ["2026-08-20 · 양가 부모님 첫 만남"],
    remainingLabel: "남은 준비 2개",
    nextAction: {
      eyebrow: "다음 한 가지",
      title: "두 가족이 만날 목적 정하기",
      reason: "연결된 일정은 있지만 준비 항목은 아직 확인하지 않았어요.",
      completionCriterion: "이 항목을 완료로 표시하면 끝나요.",
    },
  });
});

test("dense evidence stays scan-first while preserving at least one linked schedule", () => {
  const presentation = buildPreparationTopicPresentation({
    version: 1,
    topicKey: "meeting",
    label: "부모님 첫 만남",
    applicability: "applicable",
    status: "completed",
    progress: { completed: 4, total: 4, percent: 100 },
    facts: [
      { key: "checklist:1", label: "첫 번째 준비 완료", source: "saved_checklist" },
      { key: "checklist:2", label: "두 번째 준비 완료", source: "saved_checklist" },
      { key: "checklist:3", label: "세 번째 준비 완료", source: "saved_checklist" },
      { key: "checklist:4", label: "네 번째 준비 완료", source: "saved_checklist" },
      { key: "schedule:event", label: "2026-08-20 · 양가 부모님 첫 만남", source: "linked_schedule" },
    ],
    unknowns: [],
    nextAction: null,
    guideModules: [],
    relatedMessageRefs: [],
    linkedScheduleIds: ["event"],
    linkedBudgetCategoryKeys: [],
    linkedActionIds: [],
    conflicts: [],
  });

  assert.deepEqual(presentation?.evidenceLines, [
    "첫 번째 준비 완료",
    "두 번째 준비 완료",
    "2026-08-20 · 양가 부모님 첫 만남",
    "그 외 2개 확인됨",
  ]);
});

test("dense evidence preserves both a linked schedule and a shared action", () => {
  const presentation = buildPreparationTopicPresentation({
    version: 1,
    topicKey: "meeting",
    label: "부모님 첫 만남",
    applicability: "applicable",
    status: "in_progress",
    progress: { completed: 4, total: 5, percent: 80 },
    facts: [
      { key: "checklist:1", label: "첫 번째 준비 완료", source: "saved_checklist" },
      { key: "checklist:2", label: "두 번째 준비 완료", source: "saved_checklist" },
      { key: "checklist:3", label: "세 번째 준비 완료", source: "saved_checklist" },
      { key: "schedule:event", label: "2026-08-20 · 부모님 첫 만남", source: "linked_schedule" },
      { key: "action:one", label: "진행 중 행동 · 참석자 확인", source: "linked_action" },
    ],
    unknowns: [{ key: "checklist:4", label: "장소 확인", source: "unfinished_checklist" }],
    nextAction: {
      title: "참석자 확인",
      reason: "공동 준비 기록에 저장한 열린 행동이에요.",
      completionCriterion: "이 행동을 실제로 마친 뒤 완료로 기록하면 끝나요.",
      source: "linked_action",
    },
    guideModules: [],
    relatedMessageRefs: [],
    linkedScheduleIds: ["event"],
    linkedBudgetCategoryKeys: [],
    linkedActionIds: ["one"],
    budgetSummary: null,
    actionReadState: "loaded",
    conflicts: [],
  });

  assert.deepEqual(presentation?.evidenceLines, [
    "첫 번째 준비 완료",
    "진행 중 행동 · 참석자 확인",
    "2026-08-20 · 부모님 첫 만남",
    "그 외 2개 확인됨",
  ]);
});
