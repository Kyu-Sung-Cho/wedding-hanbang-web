import assert from "node:assert/strict";
import test from "node:test";

import { buildAmoraPreparationTopicView } from "@hanbang/shared/amora-preparation-topic";

const topics = [
  {
    key: "meeting",
    label: "부모님 첫 만남",
    items: [
      { id: "meeting_01", label: "두 가족이 만날 목적 정하기" },
      { id: "meeting_02", label: "참석자와 가능한 날짜 확인하기" },
    ],
  },
];

function withoutPlanReadState(view) {
  if (!view) return view;
  const rest = { ...view };
  delete rest.budgetSummary;
  delete rest.actionReadState;
  delete rest.confirmedScheduleDecisions;
  delete rest.confirmedBudgetDecisions;
  delete rest.budgetDecisionReadState;
  delete rest.linkedDecisionIds;
  delete rest.decisionReadState;
  delete rest.currentVendorBookingRecords;
  delete rest.linkedVendorBookingIds;
  delete rest.vendorBookingReadState;
  delete rest.currentCompletedVendorBookingRecords;
  delete rest.linkedCompletedVendorBookingIds;
  delete rest.completedVendorBookingReadState;
  return rest;
}

test("a first-time topic stays unknown and asks for applicability before pretending work started", () => {
  const view = buildAmoraPreparationTopicView({
    topicKey: "meeting",
    topics,
    progress: {},
    scheduleEvents: [],
  });

  assert.deepEqual(withoutPlanReadState(view), {
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
});

test("saved progress and an exact linked schedule become evidence for one truthful next action", () => {
  const view = buildAmoraPreparationTopicView({
    topicKey: "meeting",
    topics,
    progress: {
      meeting: {
        status: "in_progress",
        checklist: [
          { id: "meeting_01", label: "두 가족이 만날 목적 정하기", done: true },
          { id: "meeting_02", label: "참석자와 가능한 날짜 확인하기", done: false },
        ],
      },
    },
    scheduleEvents: [{
      id: "meeting-event",
      date: "2026-08-20",
      title: "양가 부모님 첫 만남",
      categoryKey: "meeting",
      status: "planned",
    }],
  });

  assert.deepEqual(withoutPlanReadState(view), {
    version: 1,
    topicKey: "meeting",
    label: "부모님 첫 만남",
    applicability: "applicable",
    status: "in_progress",
    progress: { completed: 1, total: 2, percent: 50 },
    facts: [
      {
        key: "checklist:meeting_01",
        label: "두 가족이 만날 목적 정하기 완료",
        source: "saved_checklist",
      },
      {
        key: "schedule:meeting-event",
        label: "2026-08-20 · 양가 부모님 첫 만남",
        source: "linked_schedule",
      },
    ],
    unknowns: [{
      key: "checklist:meeting_02",
      label: "참석자와 가능한 날짜 확인하기",
      source: "unfinished_checklist",
    }],
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
});

test("an exact saved budget and shared open action personalize the topic without guessing", () => {
  const view = buildAmoraPreparationTopicView({
    topicKey: "meeting",
    topics,
    progress: {
      meeting: {
        status: "in_progress",
        budget: 3_000_000,
        spent: 1_000_000,
        payer: "couple",
        checklist: [
          { id: "meeting_01", label: "두 가족이 만날 목적 정하기", done: true },
          { id: "meeting_02", label: "참석자와 가능한 날짜 확인하기", done: false },
        ],
      },
    },
    scheduleEvents: [],
    budgetCategoryKeys: ["meeting"],
    actionReadState: "loaded",
    openActions: [{
      id: "meeting-action",
      title: "식당 후보 세 곳에 예약 가능 시간 확인하기",
      description: null,
      dueDate: "2026-08-20",
      priority: "high",
      source: "chat",
      categoryKey: "meeting",
      sourceRevision: 2,
      createdAt: "2026-08-16T01:00:00.000Z",
    }],
  });

  assert.deepEqual(view?.budgetSummary, {
    state: "ready",
    categoryKey: "meeting",
    budgetWon: 3_000_000,
    spentWon: 1_000_000,
    payer: "couple",
  });
  assert.deepEqual(view?.linkedBudgetCategoryKeys, ["meeting"]);
  assert.deepEqual(view?.linkedActionIds, ["meeting-action"]);
  assert.deepEqual(view?.facts.at(-1), {
    key: "action:meeting-action",
    label: "2026-08-20까지 · 식당 후보 세 곳에 예약 가능 시간 확인하기",
    source: "linked_action",
  });
  assert.deepEqual(view?.nextAction, {
    title: "식당 후보 세 곳에 예약 가능 시간 확인하기",
    reason: "마감일을 2026-08-20로 저장한 공동 행동이에요.",
    completionCriterion: "이 행동을 실제로 마친 뒤 완료로 기록하면 끝나요.",
    source: "linked_action",
    sourceRef: {
      kind: "amora_action",
      id: "meeting-action",
      revision: 2,
    },
  });
});

test("a current exact shared schedule receipt is shown as history without changing the next action", () => {
  const event = {
    id: "meeting-event",
    date: "2026-09-05",
    time: "12:00",
    title: "양가 부모님 첫 만남",
    categoryKey: "meeting",
    status: "planned",
    createdAt: "2026-08-15T08:00:00.000Z",
    updatedAt: "2026-08-15T09:05:00.000Z",
  };
  const view = buildAmoraPreparationTopicView({
    topicKey: "meeting",
    topics,
    progress: {
      meeting: {
        status: "in_progress",
        checklist: [
          { id: "meeting_01", label: "두 가족이 만날 목적 정하기", done: true },
          { id: "meeting_02", label: "참석자와 가능한 날짜 확인하기", done: false },
        ],
      },
    },
    scheduleEvents: [event],
    expectedCoupleId: "40000000-0000-4000-8000-000000000001",
    currentJourneyRevision: 8,
    scheduleDecisionReceipts: [{
      id: "50000000-0000-4000-8000-000000000001",
      couple_id: "40000000-0000-4000-8000-000000000001",
      category: "meeting",
      decision_type: "scheduled",
      title: "일정 추가 · 양가 부모님 첫 만남",
      visibility: "shared",
      source: "schedule",
      source_ref_id: "60000000-0000-4000-8000-000000000001",
      source_actor_role: "bride",
      memory_key: null,
      chosen_value: {
        schemaVersion: 1,
        operation: "add",
        eventId: event.id,
        after: event,
        expectedRevision: 7,
        appliedRevision: 8,
      },
      metadata: {
        origin: "amora_shared_action",
        actionId: "60000000-0000-4000-8000-000000000001",
        eventId: event.id,
        receiptExpectedRevision: 7,
        receiptAppliedRevision: 8,
      },
      user_confirmed_at: "2026-08-15T09:00:00.000Z",
      decided_at: "2026-08-15T09:05:00.000Z",
      superseded_at: null,
    }],
    decisionReadState: "loaded",
    nowIso: "2026-08-16T00:00:00.000Z",
  });

  assert.deepEqual(view?.confirmedScheduleDecisions, [{
    id: "50000000-0000-4000-8000-000000000001",
    eventId: "meeting-event",
    title: "일정 추가 · 양가 부모님 첫 만남",
    date: "2026-09-05",
    confirmedAt: "2026-08-15T09:00:00.000Z",
    scope: "couple_shared",
  }]);
  assert.deepEqual(view?.linkedDecisionIds, [
    "50000000-0000-4000-8000-000000000001",
  ]);
  assert.equal(view?.nextAction?.source, "saved_checklist");
});

test("automatic, private, stale, foreign, and non-current receipts never become confirmed schedule history", () => {
  const coupleId = "40000000-0000-4000-8000-000000000001";
  const event = {
    id: "meeting-event",
    date: "2026-09-05",
    title: "양가 부모님 첫 만남",
    categoryKey: "meeting",
    status: "planned",
  };
  const base = {
    id: "50000000-0000-4000-8000-000000000010",
    couple_id: coupleId,
    category: "meeting",
    decision_type: "scheduled",
    title: "일정 추가 · 양가 부모님 첫 만남",
    visibility: "shared",
    source: "schedule",
    source_ref_id: "60000000-0000-4000-8000-000000000010",
    source_actor_role: "bride",
    memory_key: null,
    chosen_value: {
      schemaVersion: 1,
      operation: "add",
      eventId: event.id,
      after: event,
      expectedRevision: 7,
      appliedRevision: 8,
    },
    metadata: {
      origin: "amora_shared_action",
      actionId: "60000000-0000-4000-8000-000000000010",
      eventId: event.id,
      receiptExpectedRevision: 7,
      receiptAppliedRevision: 8,
    },
    user_confirmed_at: "2026-08-15T09:00:00.000Z",
    decided_at: "2026-08-15T09:05:00.000Z",
    superseded_at: null,
  };
  const view = buildAmoraPreparationTopicView({
    topicKey: "meeting",
    topics,
    progress: {},
    scheduleEvents: [event],
    expectedCoupleId: coupleId,
    currentJourneyRevision: 8,
    scheduleDecisionReceipts: [
      { ...base, id: "50000000-0000-4000-8000-000000000011", user_confirmed_at: null },
      { ...base, id: "50000000-0000-4000-8000-000000000012", visibility: "bride_private" },
      { ...base, id: "50000000-0000-4000-8000-000000000013", superseded_at: "2026-08-15T10:00:00.000Z" },
      { ...base, id: "50000000-0000-4000-8000-000000000014", couple_id: "40000000-0000-4000-8000-000000000099" },
      { ...base, id: "50000000-0000-4000-8000-000000000015", category: "dress" },
      { ...base, id: "50000000-0000-4000-8000-000000000016", decided_at: "2026-08-17T09:05:00.000Z" },
      { ...base, id: "50000000-0000-4000-8000-000000000017", title: "\u202E숨긴 결정" },
      { ...base, id: "50000000-0000-4000-8000-000000000018", decision_type: "decided" },
      { ...base, id: "50000000-0000-4000-8000-000000000019", source: "chat" },
      { ...base, id: "50000000-0000-4000-8000-000000000020", memory_key: "auto:meeting" },
      {
        ...base,
        id: "50000000-0000-4000-8000-000000000021",
        chosen_value: {
          ...base.chosen_value,
          after: { ...event, date: "2026-09-12" },
        },
      },
      {
        ...base,
        id: "50000000-0000-4000-8000-000000000022",
        chosen_value: { ...base.chosen_value, appliedRevision: 9 },
      },
      {
        ...base,
        id: "50000000-0000-4000-8000-000000000023",
        metadata: { ...base.metadata, origin: "memory_compiler" },
      },
    ],
    nowIso: "2026-08-16T00:00:00.000Z",
  });

  assert.deepEqual(view?.confirmedScheduleDecisions, []);
  assert.deepEqual(view?.linkedDecisionIds, []);
});

test("an exact manual cancellation receipt is history, not an active-plan claim", () => {
  const event = {
    id: "meeting-event",
    date: "2026-09-05",
    title: "양가 부모님 첫 만남",
    categoryKey: "meeting",
    status: "cancelled",
    cancellation: {
      cancelledAt: "2026-08-15T10:00:00.000Z",
      cancelledByProfileId: "70000000-0000-4000-8000-000000000001",
      reason: "가족 일정 변경",
    },
  };
  const requestId = "60000000-0000-4000-8000-000000000031";
  const view = buildAmoraPreparationTopicView({
    topicKey: "meeting",
    topics,
    progress: {},
    scheduleEvents: [event],
    expectedCoupleId: "40000000-0000-4000-8000-000000000001",
    currentJourneyRevision: 12,
    scheduleDecisionReceipts: [{
      id: "50000000-0000-4000-8000-000000000031",
      couple_id: "40000000-0000-4000-8000-000000000001",
      category: "meeting",
      decision_type: "scheduled",
      title: "취소 요청 반영",
      visibility: "shared",
      source: "schedule",
      source_ref_id: requestId,
      source_actor_role: "groom",
      memory_key: null,
      chosen_value: {
        schemaVersion: 1,
        requestId,
        mutationKind: "cancel",
        eventId: event.id,
        after: event,
        expectedRevision: 11,
        appliedRevision: 12,
      },
      metadata: {
        origin: "couple_plan_change_request",
        requestId,
        eventId: event.id,
        expectedRevision: 11,
        appliedRevision: 12,
        mutationKind: "cancel",
      },
      user_confirmed_at: "2026-08-15T09:55:00.000Z",
      decided_at: "2026-08-15T10:00:00.000Z",
      superseded_at: null,
    }],
    nowIso: "2026-08-16T00:00:00.000Z",
  });

  assert.deepEqual(view?.confirmedScheduleDecisions, [{
    id: "50000000-0000-4000-8000-000000000031",
    eventId: "meeting-event",
    title: "일정 취소 · 양가 부모님 첫 만남",
    date: "2026-09-05",
    confirmedAt: "2026-08-15T09:55:00.000Z",
    scope: "couple_shared",
  }]);
  assert.deepEqual(view?.linkedScheduleIds, []);
  assert.equal(view?.nextAction?.source, "applicability");
});

test("only the newest exact receipt for one current event is shown", () => {
  const event = {
    id: "meeting-event",
    date: "2026-09-05",
    title: "양가 부모님 첫 만남",
    categoryKey: "meeting",
    status: "planned",
  };
  const buildReceipt = (id, actionId, decidedAt) => ({
    id,
    couple_id: "40000000-0000-4000-8000-000000000001",
    category: "meeting",
    decision_type: "scheduled",
    title: "일정 수정 · 양가 부모님 첫 만남",
    visibility: "shared",
    source: "schedule",
    source_ref_id: actionId,
    source_actor_role: "bride",
    memory_key: null,
    chosen_value: {
      schemaVersion: 1,
      operation: "update",
      eventId: event.id,
      after: event,
      expectedRevision: 7,
      appliedRevision: 8,
    },
    metadata: {
      origin: "amora_shared_action",
      actionId,
      eventId: event.id,
      receiptExpectedRevision: 7,
      receiptAppliedRevision: 8,
    },
    user_confirmed_at: decidedAt,
    decided_at: decidedAt,
    superseded_at: null,
  });
  const view = buildAmoraPreparationTopicView({
    topicKey: "meeting",
    topics,
    progress: {},
    scheduleEvents: [event],
    expectedCoupleId: "40000000-0000-4000-8000-000000000001",
    currentJourneyRevision: 8,
    scheduleDecisionReceipts: [
      buildReceipt(
        "50000000-0000-4000-8000-000000000041",
        "60000000-0000-4000-8000-000000000041",
        "2026-08-14T09:00:00.000Z",
      ),
      buildReceipt(
        "50000000-0000-4000-8000-000000000042",
        "60000000-0000-4000-8000-000000000042",
        "2026-08-15T09:00:00.000Z",
      ),
    ],
    nowIso: "2026-08-16T00:00:00.000Z",
  });

  assert.deepEqual(view?.linkedDecisionIds, [
    "50000000-0000-4000-8000-000000000042",
  ]);
});

function exactBudgetDecisionInput() {
  const coupleId = "40000000-0000-4000-8000-000000000001";
  const brideId = "70000000-0000-4000-8000-000000000001";
  const groomId = "70000000-0000-4000-8000-000000000002";
  const requestId = "60000000-0000-4000-8000-000000000051";
  const decisionId = "50000000-0000-4000-8000-000000000051";
  const progress = {
    meeting: {
      category: "meeting",
      status: "in_progress",
      budget: 3_000_000,
      spent: 1_000_000,
      payer: "couple",
      checklist: [
        { id: "meeting_01", label: "두 가족이 만날 목적 정하기", done: true },
        { id: "meeting_02", label: "참석자와 가능한 날짜 확인하기", done: false },
      ],
    },
  };
  const acceptances = [
    { userId: brideId, acceptedAt: "2026-08-15T09:00:00.000Z" },
    { userId: groomId, acceptedAt: "2026-08-15T09:04:00.000Z" },
  ];
  const commonInput = {
    topicKey: "meeting",
    topics,
    progress,
    scheduleEvents: [],
    budgetCategoryKeys: ["meeting"],
    expectedCoupleId: coupleId,
    currentCoupleMemberIds: [brideId, groomId],
    currentJourneyRevision: 8,
    nowIso: "2026-08-16T00:00:00.000Z",
  };
  const receipt = {
    id: decisionId,
    couple_id: coupleId,
    category: "budget",
    decision_type: "decided",
    title: "진행 상황: 1개 수정",
    visibility: "shared",
    source: "manual",
    source_ref_id: requestId,
    source_actor_role: "bride",
    source_message_id: null,
    memory_key: null,
    chosen_value: {
      schemaVersion: 1,
      requestId,
      changeDigest: "a".repeat(64),
      expectedRevision: 7,
      appliedRevision: 8,
      requiredCount: 2,
      acceptances,
      mutationKind: null,
      eventId: null,
      before: null,
      after: null,
      changes: { progress_patch: { meeting: progress.meeting } },
    },
    metadata: {
      origin: "couple_plan_change_request",
      requestId,
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
  const verification = {
    requestId,
    status: "applied",
    requiredCount: 2,
    acceptedCount: 2,
    summary: "진행 상황: 1개 수정",
    surface: "/budget",
    journey: {
      coupleId,
      stateRevision: 8,
      topicKey: "meeting",
      topicSnapshot: progress.meeting,
    },
  };
  return {
    ids: { coupleId, brideId, groomId, requestId, decisionId },
    commonInput,
    input: {
      ...commonInput,
      budgetDecisionReceipts: [receipt],
      budgetDecisionVerifications: [verification],
    },
  };
}

test("an exact current applied single-topic budget receipt is read-only confirmed history", () => {
  const { ids, commonInput, input } = exactBudgetDecisionInput();
  const baseline = buildAmoraPreparationTopicView(commonInput);
  const view = buildAmoraPreparationTopicView(input);

  assert.deepEqual(view?.confirmedBudgetDecisions, [{
    id: ids.decisionId,
    title: "진행 상황: 1개 수정",
    confirmedAt: "2026-08-15T09:05:00.000Z",
    confirmationScope: "couple",
    appliedRevision: 8,
    scope: "couple_shared",
  }]);
  assert.deepEqual(view?.linkedDecisionIds, [ids.decisionId]);
  for (const field of ["status", "progress", "facts", "unknowns", "nextAction"]) {
    assert.deepEqual(view?.[field], baseline?.[field], field);
  }
});

test("each topic reads its own latest verified budget receipt from one bounded result set", () => {
  const { input } = exactBudgetDecisionInput();
  const meetingReceipt = {
    ...input.budgetDecisionReceipts[0],
    chosen_value: {
      ...input.budgetDecisionReceipts[0].chosen_value,
      expectedRevision: 8,
      appliedRevision: 9,
    },
    metadata: {
      ...input.budgetDecisionReceipts[0].metadata,
      expectedRevision: 8,
      appliedRevision: 9,
    },
  };
  const venueRequestId = "60000000-0000-4000-8000-000000000053";
  const venueDecisionId = "50000000-0000-4000-8000-000000000053";
  const venueSnapshot = {
    category: "venue",
    status: "in_progress",
    budget: 20_000_000,
    spent: 2_000_000,
    payer: "couple",
    checklist: [{ id: "venue_01", label: "예식장 기준 정하기", done: true }],
  };
  const venueReceipt = {
    ...input.budgetDecisionReceipts[0],
    id: venueDecisionId,
    source_ref_id: venueRequestId,
    title: "진행 상황: 예식장 예산 수정",
    chosen_value: {
      ...input.budgetDecisionReceipts[0].chosen_value,
      requestId: venueRequestId,
      changeDigest: "c".repeat(64),
      changes: { progress_patch: { venue: venueSnapshot } },
    },
    metadata: {
      ...input.budgetDecisionReceipts[0].metadata,
      requestId: venueRequestId,
      changeDigest: "c".repeat(64),
    },
  };
  const progress = { ...input.progress, venue: venueSnapshot };
  const verifications = [
    {
      ...input.budgetDecisionVerifications[0],
      journey: {
        ...input.budgetDecisionVerifications[0].journey,
        stateRevision: 9,
      },
    },
    {
      requestId: venueRequestId,
      status: "applied",
      requiredCount: 2,
      acceptedCount: 2,
      summary: venueReceipt.title,
      surface: "/budget",
      journey: {
        coupleId: input.expectedCoupleId,
        stateRevision: 9,
        topicKey: "venue",
        topicSnapshot: venueSnapshot,
      },
    },
  ];
  const common = {
    ...input,
    topics: [
      ...topics,
      { key: "venue", label: "예식장", items: [{ id: "venue_01", label: "예식장 기준 정하기" }] },
    ],
    progress,
    currentJourneyRevision: 9,
    budgetDecisionReceipts: [venueReceipt, meetingReceipt],
    budgetDecisionVerifications: verifications,
  };

  const meeting = buildAmoraPreparationTopicView({ ...common, topicKey: "meeting" });
  const venue = buildAmoraPreparationTopicView({ ...common, topicKey: "venue" });
  assert.deepEqual(meeting?.confirmedBudgetDecisions.map((value) => value.id), [
    input.budgetDecisionReceipts[0].id,
  ]);
  assert.deepEqual(venue?.confirmedBudgetDecisions.map((value) => value.id), [
    venueDecisionId,
  ]);
});

test("budget decision read state keeps unavailable distinct from an empty confirmed history", () => {
  const { ids, input } = exactBudgetDecisionInput();
  const partial = buildAmoraPreparationTopicView({
    ...input,
    budgetDecisionReadState: "partial",
  });
  const unavailable = buildAmoraPreparationTopicView({
    ...input,
    budgetDecisionReadState: "unavailable",
  });

  assert.equal(partial?.budgetDecisionReadState, "partial");
  assert.deepEqual(partial?.confirmedBudgetDecisions.map((decision) => decision.id), [
    ids.decisionId,
  ]);
  assert.equal(unavailable?.budgetDecisionReadState, "unavailable");
  assert.deepEqual(unavailable?.confirmedBudgetDecisions, []);
  assert.deepEqual(unavailable?.linkedDecisionIds, []);
});

test("budget verification rejects raw acceptance details outside its sanitized GET projection", () => {
  const { input } = exactBudgetDecisionInput();
  const view = buildAmoraPreparationTopicView({
    ...input,
    budgetDecisionVerifications: [{
      ...input.budgetDecisionVerifications[0],
      acceptances: input.budgetDecisionReceipts[0].chosen_value.acceptances,
    }],
  });

  assert.deepEqual(view?.confirmedBudgetDecisions, []);
  assert.deepEqual(view?.linkedDecisionIds, []);
  assert.equal(view?.budgetDecisionReadState, "partial");
});

test("a generic or AI-extended manual row cannot impersonate the canonical budget receipt", () => {
  const { input } = exactBudgetDecisionInput();
  const receipt = input.budgetDecisionReceipts[0];
  const view = buildAmoraPreparationTopicView({
    ...input,
    budgetDecisionReceipts: [{
      ...receipt,
      metadata: {
        ...receipt.metadata,
        aiExtracted: true,
      },
    }],
  });

  assert.deepEqual(view?.confirmedBudgetDecisions, []);
  assert.deepEqual(view?.linkedDecisionIds, []);
});

test("a database-impossible budget snapshot cannot become confirmed history by matching itself", () => {
  const { input } = exactBudgetDecisionInput();
  const invalidTopicSnapshot = {
    ...input.progress.meeting,
    budget: -1,
  };
  const receipt = input.budgetDecisionReceipts[0];
  const view = buildAmoraPreparationTopicView({
    ...input,
    progress: { meeting: invalidTopicSnapshot },
    budgetDecisionReceipts: [{
      ...receipt,
      chosen_value: {
        ...receipt.chosen_value,
        changes: { progress_patch: { meeting: invalidTopicSnapshot } },
      },
    }],
    budgetDecisionVerifications: [{
      ...input.budgetDecisionVerifications[0],
      journey: {
        ...input.budgetDecisionVerifications[0].journey,
        topicSnapshot: invalidTopicSnapshot,
      },
    }],
  });

  assert.deepEqual(view?.confirmedBudgetDecisions, []);
  assert.deepEqual(view?.linkedDecisionIds, []);
});

test("an invalid latest budget receipt blocks fallback to an older matching receipt", () => {
  const { input } = exactBudgetDecisionInput();
  const older = input.budgetDecisionReceipts[0];
  const latestRequestId = "60000000-0000-4000-8000-000000000052";
  const latest = {
    ...older,
    id: "50000000-0000-4000-8000-000000000052",
    source_ref_id: latestRequestId,
    chosen_value: {
      ...older.chosen_value,
      requestId: latestRequestId,
      changeDigest: "c".repeat(64),
      expectedRevision: 8,
      appliedRevision: 9,
    },
    metadata: {
      ...older.metadata,
      requestId: latestRequestId,
      changeDigest: "c".repeat(64),
      expectedRevision: 8,
      appliedRevision: 9,
    },
    decided_at: "2026-08-15T10:05:00.000Z",
  };
  const view = buildAmoraPreparationTopicView({
    ...input,
    currentJourneyRevision: 9,
    budgetDecisionReceipts: [older, latest],
    budgetDecisionVerifications: [{
      ...input.budgetDecisionVerifications[0],
      journey: {
        ...input.budgetDecisionVerifications[0].journey,
        stateRevision: 9,
      },
    }],
  });

  assert.deepEqual(view?.confirmedBudgetDecisions, []);
  assert.deepEqual(view?.linkedDecisionIds, []);
});

test("an excluded topic with an exact open action asks which record is still true", () => {
  const view = buildAmoraPreparationTopicView({
    topicKey: "meeting",
    topics,
    progress: {
      meeting: {
        status: "not_applicable",
        checklist: [
          { id: "meeting_01", label: "두 가족이 만날 목적 정하기", done: false },
          { id: "meeting_02", label: "참석자와 가능한 날짜 확인하기", done: false },
        ],
      },
    },
    scheduleEvents: [],
    openActions: [{
      id: "meeting-action",
      title: "식당 후보 확인하기",
      dueDate: null,
      priority: "medium",
      source: "chat",
      categoryKey: "meeting",
      sourceRevision: 1,
      createdAt: "2026-08-16T01:00:00.000Z",
    }],
  });

  assert.equal(view?.status, "decision_needed");
  assert.deepEqual(view?.linkedActionIds, ["meeting-action"]);
  assert.deepEqual(view?.conflicts, [{
    key: "excluded_with_open_action",
    label: "제외한 준비에 열린 공동 행동이 남아 있어요.",
  }]);
  assert.equal(view?.nextAction?.source, "conflict");
});

test("an exact open action makes an otherwise unknown topic exploratory without fake checklist progress", () => {
  const view = buildAmoraPreparationTopicView({
    topicKey: "meeting",
    topics,
    progress: {},
    scheduleEvents: [],
    openActions: [{
      id: "meeting-action",
      title: "부모님께 가능한 날짜 여쭤보기",
      dueDate: null,
      priority: "medium",
      source: "manual",
      categoryKey: "meeting",
      sourceRevision: null,
      createdAt: "2026-08-16T01:00:00.000Z",
    }],
  });

  assert.equal(view?.applicability, "applicable");
  assert.equal(view?.status, "exploring");
  assert.deepEqual(view?.progress, { completed: 0, total: 2, percent: 0 });
  assert.equal(view?.nextAction?.title, "부모님께 가능한 날짜 여쭤보기");
  assert.equal(view?.nextAction?.source, "linked_action");
  assert.deepEqual(view?.linkedActionIds, ["meeting-action"]);
});

test("a completed checklist with an open action stays in progress instead of claiming the topic is done", () => {
  const view = buildAmoraPreparationTopicView({
    topicKey: "meeting",
    topics,
    progress: {
      meeting: {
        status: "completed",
        checklist: [
          { id: "meeting_01", label: "두 가족이 만날 목적 정하기", done: true },
          { id: "meeting_02", label: "참석자와 가능한 날짜 확인하기", done: true },
        ],
      },
    },
    openActions: [{
      id: "meeting-action",
      title: "예약 시간 최종 확정하기",
      dueDate: null,
      priority: "medium",
      source: "manual",
      categoryKey: "meeting",
      sourceRevision: 1,
      createdAt: "2026-08-16T01:00:00.000Z",
    }],
  });

  assert.equal(view?.status, "in_progress");
  assert.equal(view?.nextAction?.title, "예약 시간 최종 확정하기");
  assert.deepEqual(view?.linkedActionIds, ["meeting-action"]);
});

test("unsafe budgets and actions from another topic are never presented as personalized evidence", () => {
  const view = buildAmoraPreparationTopicView({
    topicKey: "meeting",
    topics,
    progress: {
      meeting: {
        status: "in_progress",
        budget: -1,
        spent: "1000000",
        cost: 9_999_999,
        checklist: [
          { id: "meeting_01", label: "두 가족이 만날 목적 정하기", done: true },
          { id: "meeting_02", label: "참석자와 가능한 날짜 확인하기", done: false },
        ],
      },
    },
    openActions: [
      {
        id: "dress-action",
        title: "상견례라는 단어가 있어도 드레스 행동",
        dueDate: null,
        priority: "high",
        source: "chat",
        categoryKey: "dress",
        sourceRevision: 1,
        createdAt: "2026-08-16T01:00:00.000Z",
      },
      {
        id: "unsafe-action",
        title: "\u202E숨긴 행동",
        dueDate: null,
        priority: "high",
        source: "chat",
        categoryKey: "meeting",
        sourceRevision: 1,
        createdAt: "2026-08-16T01:00:00.000Z",
      },
    ],
    budgetCategoryKeys: ["meeting"],
  });

  assert.deepEqual(view?.budgetSummary, {
    state: "invalid",
    categoryKey: "meeting",
  });
  assert.deepEqual(view?.linkedBudgetCategoryKeys, []);
  assert.deepEqual(view?.linkedActionIds, []);
  assert.equal(view?.nextAction?.source, "saved_checklist");
  assert.equal(
    view?.facts.some((fact) => fact.label.includes("상견례") || fact.label.includes("숨긴")),
    false,
  );
});

test("a topic the couple excluded stays resolved without inventing another task", () => {
  const view = buildAmoraPreparationTopicView({
    topicKey: "meeting",
    topics,
    progress: {
      meeting: {
        status: "not_applicable",
        checklist: [
          { id: "meeting_01", label: "두 가족이 만날 목적 정하기", done: false },
          { id: "meeting_02", label: "참석자와 가능한 날짜 확인하기", done: false },
        ],
      },
    },
    scheduleEvents: [],
  });

  assert.deepEqual(withoutPlanReadState(view), {
    version: 1,
    topicKey: "meeting",
    label: "부모님 첫 만남",
    applicability: "not_applicable",
    status: "not_started",
    progress: { completed: 0, total: 0, percent: 0 },
    facts: [{
      key: "applicability",
      label: "우리에게는 하지 않기로 정했어요.",
      source: "saved_checklist",
    }],
    unknowns: [],
    nextAction: null,
    guideModules: [],
    relatedMessageRefs: [],
    linkedScheduleIds: [],
    linkedBudgetCategoryKeys: [],
    linkedActionIds: [],
    conflicts: [],
  });
});

test("conflicting saved status asks for review instead of inventing confident personalization", () => {
  const view = buildAmoraPreparationTopicView({
    topicKey: "meeting",
    topics,
    progress: {
      meeting: {
        status: "completed",
        checklist: [
          { id: "meeting_01", label: "두 가족이 만날 목적 정하기", done: true },
          { id: "meeting_02", label: "참석자와 가능한 날짜 확인하기", done: false },
        ],
      },
    },
    scheduleEvents: [],
  });

  assert.deepEqual(withoutPlanReadState(view), {
    version: 1,
    topicKey: "meeting",
    label: "부모님 첫 만남",
    applicability: "applicable",
    status: "decision_needed",
    progress: { completed: 1, total: 2, percent: 50 },
    facts: [{
      key: "checklist:meeting_01",
      label: "두 가족이 만날 목적 정하기 완료",
      source: "saved_checklist",
    }],
    unknowns: [{
      key: "checklist:meeting_02",
      label: "참석자와 가능한 날짜 확인하기",
      source: "unfinished_checklist",
    }],
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
    conflicts: [{
      key: "saved_state_mismatch",
      label: "저장된 완료 상태와 체크 항목이 서로 맞지 않아요.",
    }],
  });
});

test("a malformed saved topic explains the record problem instead of claiming a status mismatch", () => {
  const view = buildAmoraPreparationTopicView({
    topicKey: "meeting",
    topics,
    progress: { meeting: "damaged" },
    scheduleEvents: [],
  });

  assert.equal(view?.status, "decision_needed");
  assert.deepEqual(view?.conflicts, [{
    key: "invalid_saved_record",
    label: "저장된 준비 기록 형식을 확인할 수 없어요.",
  }]);
  assert.deepEqual(view?.nextAction, {
    title: "부모님 첫 만남 기록 확인하기",
    reason: "저장된 준비 기록 형식을 확인할 수 없어요.",
    completionCriterion: "현재 준비 상태를 다시 저장하면 끝나요.",
    source: "conflict",
  });
});

test("an unknown schedule status is not used as personalization evidence", () => {
  const view = buildAmoraPreparationTopicView({
    topicKey: "meeting",
    topics,
    progress: {
      meeting: {
        status: "in_progress",
        checklist: [
          { id: "meeting_01", label: "두 가족이 만날 목적 정하기", done: true },
          { id: "meeting_02", label: "참석자와 가능한 날짜 확인하기", done: false },
        ],
      },
    },
    scheduleEvents: [{
      id: "untrusted-event",
      date: "2026-08-20",
      title: "상태를 알 수 없는 일정",
      categoryKey: "meeting",
      status: "draft",
    }],
  });

  assert.deepEqual(view?.facts, [{
    key: "checklist:meeting_01",
    label: "두 가족이 만날 목적 정하기 완료",
    source: "saved_checklist",
  }]);
  assert.deepEqual(view?.linkedScheduleIds, []);
});

test("an excluded topic with a live schedule asks which record is still true", () => {
  const view = buildAmoraPreparationTopicView({
    topicKey: "meeting",
    topics,
    progress: {
      meeting: {
        status: "not_applicable",
        checklist: [
          { id: "meeting_01", label: "두 가족이 만날 목적 정하기", done: false },
          { id: "meeting_02", label: "참석자와 가능한 날짜 확인하기", done: false },
        ],
      },
    },
    scheduleEvents: [{
      id: "meeting-event",
      date: "2026-08-20",
      title: "양가 부모님 첫 만남",
      categoryKey: "meeting",
      status: "planned",
    }],
  });

  assert.deepEqual(withoutPlanReadState(view), {
    version: 1,
    topicKey: "meeting",
    label: "부모님 첫 만남",
    applicability: "not_applicable",
    status: "decision_needed",
    progress: { completed: 0, total: 0, percent: 0 },
    facts: [
      {
        key: "applicability",
        label: "우리에게는 하지 않기로 정했어요.",
        source: "saved_checklist",
      },
      {
        key: "schedule:meeting-event",
        label: "2026-08-20 · 양가 부모님 첫 만남",
        source: "linked_schedule",
      },
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
    conflicts: [{
      key: "excluded_with_active_schedule",
      label: "제외한 준비에 연결된 일정이 남아 있어요.",
    }],
  });
});

test("a linked schedule makes an otherwise unknown topic applicable without inventing checklist progress", () => {
  const view = buildAmoraPreparationTopicView({
    topicKey: "meeting",
    topics,
    progress: {},
    scheduleEvents: [{
      id: "meeting-event",
      date: "2026-08-20",
      title: "양가 부모님 첫 만남",
      categoryKey: "meeting",
      status: "planned",
    }],
  });

  assert.deepEqual(withoutPlanReadState(view), {
    version: 1,
    topicKey: "meeting",
    label: "부모님 첫 만남",
    applicability: "applicable",
    status: "exploring",
    progress: { completed: 0, total: 2, percent: 0 },
    facts: [{
      key: "schedule:meeting-event",
      label: "2026-08-20 · 양가 부모님 첫 만남",
      source: "linked_schedule",
    }],
    unknowns: [
      {
        key: "checklist:meeting_01",
        label: "두 가족이 만날 목적 정하기",
        source: "unfinished_checklist",
      },
      {
        key: "checklist:meeting_02",
        label: "참석자와 가능한 날짜 확인하기",
        source: "unfinished_checklist",
      },
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
});

test("unsafe schedule text is never rendered as a personalized fact", () => {
  const view = buildAmoraPreparationTopicView({
    topicKey: "meeting",
    topics,
    progress: {
      meeting: {
        status: "in_progress",
        checklist: [
          { id: "meeting_01", label: "두 가족이 만날 목적 정하기", done: true },
          { id: "meeting_02", label: "참석자와 가능한 날짜 확인하기", done: false },
        ],
      },
    },
    scheduleEvents: [{
      id: "unsafe-event",
      date: "2026-08-20",
      title: "\u202E숨겨진 일정",
      categoryKey: "meeting",
      status: "planned",
    }],
  });

  assert.deepEqual(view?.facts, [{
    key: "checklist:meeting_01",
    label: "두 가족이 만날 목적 정하기 완료",
    source: "saved_checklist",
  }]);
  assert.deepEqual(view?.linkedScheduleIds, []);
});

test("linked schedules are shown in deterministic chronological order", () => {
  const view = buildAmoraPreparationTopicView({
    topicKey: "meeting",
    topics,
    progress: {},
    scheduleEvents: [
      {
        id: "later-event",
        date: "2026-08-25",
        title: "두 번째 만남",
        categoryKey: "meeting",
        status: "planned",
      },
      {
        id: "earlier-event",
        date: "2026-08-20",
        title: "첫 번째 만남",
        categoryKey: "meeting",
        status: "planned",
      },
    ],
  });

  assert.deepEqual(view?.linkedScheduleIds, ["earlier-event", "later-event"]);
  assert.deepEqual(view?.facts.map((fact) => fact.label), [
    "2026-08-20 · 첫 번째 만남",
    "2026-08-25 · 두 번째 만남",
  ]);
});

function exactVendorIntentInput() {
  const coupleId = "40000000-0000-4000-8000-000000000001";
  const actorId = "70000000-0000-4000-8000-000000000001";
  const bookingId = "80000000-0000-4000-8000-000000000001";
  const vendorId = "90000000-0000-4000-8000-000000000001";
  const decisionId = "50000000-0000-4000-8000-000000000051";
  const createdAt = "2026-08-15T09:00:00.000Z";
  return {
    ids: { coupleId, actorId, bookingId, vendorId, decisionId, createdAt },
    input: {
      topicKey: "studio",
      topics: [{
        key: "studio",
        label: "스튜디오",
        items: [{ id: "studio_01", label: "촬영 후보 비교하기" }],
      }],
      progress: {},
      expectedCoupleId: coupleId,
      currentCoupleMemberIds: [actorId],
      vendorBookings: [{
        id: bookingId,
        couple_id: coupleId,
        vendor_id: vendorId,
        product_id: null,
        status: "pending",
        vendor_delivery_status: "not_sent",
        intent_created_by_profile_id: actorId,
        intent_vendor_name_snapshot: "한방 스튜디오",
        intent_vendor_category_snapshot: "studio",
        intent_product_name_snapshot: null,
        booking_date: "2026-09-20",
        booking_time: "10:00:00",
        amount: 500_000,
        is_paid: false,
        contracted_amount: null,
        actual_amount: null,
        cancelled_at: null,
        cancelled_by_profile_id: null,
        cancel_reason: null,
        created_at: createdAt,
        updated_at: createdAt,
      }],
      vendorBookingDecisionReceipts: [{
        id: decisionId,
        couple_id: coupleId,
        category: "studio",
        decision_type: "considering",
        title: "아모라 방문·상담 후보 기록: 한방 스튜디오",
        chosen_value: {
          booking_id: bookingId,
          vendor_id: vendorId,
          vendor_name: "한방 스튜디오",
          product_id: null,
          product_name: null,
          booking_date: "2026-09-20",
          booking_time: "10:00",
          quoted_amount: 500_000,
          amount_basis: "quote",
          internal_request_status: "recorded",
          vendor_delivery_status: "not_sent",
          vendor_confirmation_status: "unconfirmed",
        },
        confidence: 0.5,
        source: "vendor_booking",
        source_ref_id: bookingId,
        source_message_id: null,
        source_actor_role: null,
        user_confirmed_at: null,
        memory_key: null,
        metadata: {
          hook: "booking_intent",
          execution_scope: "amora_internal_record",
          actor_profile_id: actorId,
          vendor_delivery_status: "not_sent",
          vendor_confirmation_status: "unconfirmed",
        },
        visibility: "shared",
        decided_at: null,
        superseded_at: null,
        superseded_by: null,
        created_at: createdAt,
        updated_at: createdAt,
      }],
      vendorBookingReadState: "loaded",
      nowIso: "2026-08-17T00:00:00.000Z",
    },
  };
}

function exactCompletedVendorBookingInput() {
  const coupleId = "41000000-0000-4000-8000-000000000001";
  const actorId = "71000000-0000-4000-8000-000000000001";
  const bookingId = "81000000-0000-4000-8000-000000000001";
  const vendorId = "91000000-0000-4000-8000-000000000001";
  const productId = "31000000-0000-4000-8000-000000000001";
  const decisionId = "51000000-0000-4000-8000-000000000001";
  const reviewId = "61000000-0000-4000-8000-000000000001";
  const review = "진행이 꼼꼼했어요.";
  const userConfirmedAt = "2026-08-16T09:00:00.000Z";
  const decidedAt = "2026-08-16T09:00:01.000Z";
  const booking = {
    id: bookingId,
    couple_id: coupleId,
    vendor_id: vendorId,
    product_id: productId,
    status: "completed",
    vendor_delivery_status: "not_sent",
    is_paid: false,
    intent_created_by_profile_id: actorId,
    intent_vendor_name_snapshot: "한방 스튜디오",
    intent_vendor_category_snapshot: "studio",
    intent_product_name_snapshot: "기본 촬영",
    booking_date: "2026-08-16",
    booking_time: "10:00:00",
    amount: 500_000,
    contracted_amount: 450_000,
    actual_amount: 520_000,
    cancelled_at: null,
    cancelled_by_profile_id: null,
    cancel_reason: null,
    created_at: "2026-08-10T09:00:00.000Z",
    updated_at: "2026-08-16T09:00:01.000Z",
  };
  const decision = {
    id: decisionId,
    couple_id: coupleId,
    category: "studio",
    decision_type: "completed",
    title: "사용자가 완료로 기록: 한방 스튜디오",
    chosen_value: {
      booking_id: bookingId,
      vendor_id: vendorId,
      vendor_name: "한방 스튜디오",
      product_id: productId,
      product_name: "기본 촬영",
      quoted_amount: 500_000,
      contracted_amount: 450_000,
      actual_amount: 520_000,
      extra_amount: 70_000,
      rating: 5,
      public_review: false,
      completion_evidence: "user_reported",
      vendor_delivery_status: "not_sent",
      vendor_confirmation_status: "unconfirmed",
    },
    reasoning: review,
    confidence: 0.9,
    source: "vendor_booking",
    source_ref_id: bookingId,
    source_message_id: null,
    source_actor_role: "bride",
    user_confirmed_at: userConfirmedAt,
    memory_key: null,
    metadata: {
      hook: "booking_outcome",
      review_id: reviewId,
      extra_amount: 70_000,
      completion_evidence: "user_reported",
      vendor_delivery_status: "not_sent",
      vendor_confirmation_status: "unconfirmed",
      actor_profile_id: actorId,
      outcome_provenance_version: 1,
      outcome_payload_digest: "a".repeat(64),
    },
    visibility: "shared",
    decided_at: decidedAt,
    superseded_at: null,
    superseded_by: null,
    created_at: decidedAt,
    updated_at: decidedAt,
  };
  return {
    ids: {
      actorId,
      bookingId,
      vendorId,
      productId,
      decisionId,
      reviewId,
      userConfirmedAt,
      decidedAt,
    },
    input: {
      topicKey: "studio",
      topics: [{
        key: "studio",
        label: "스튜디오",
        items: [{ id: "studio_01", label: "촬영 후보 비교하기" }],
      }],
      progress: {},
      expectedCoupleId: coupleId,
      currentCoupleMemberIds: [actorId],
      completedVendorBookings: [booking],
      completedVendorBookingDecisionReceipts: [decision],
      completedVendorBookingReadState: "loaded",
      nowIso: "2026-08-17T00:00:00.000Z",
    },
  };
}

test("an exact provenance-v1 decision needs no private review row and exposes only an internal outcome record", () => {
  const { ids, input } = exactCompletedVendorBookingInput();
  const baseline = buildAmoraPreparationTopicView({
    ...input,
    completedVendorBookings: [],
    completedVendorBookingDecisionReceipts: [],
  });
  const view = buildAmoraPreparationTopicView(input);

  assert.deepEqual(view?.currentCompletedVendorBookingRecords, [{
    bookingId: ids.bookingId,
    decisionId: ids.decisionId,
    vendorId: ids.vendorId,
    productId: ids.productId,
    vendorName: "한방 스튜디오",
    productName: "기본 촬영",
    bookingDate: "2026-08-16",
    bookingTime: "10:00",
    quotedAmountWon: 500_000,
    contractedAmountWon: 450_000,
    actualAmountWon: 520_000,
    userConfirmedAt: ids.userConfirmedAt,
    decidedAt: ids.decidedAt,
    recordScope: "amora_internal_completed_outcome",
    evidence: "actor_bound_atomic_user_report",
    completionEvidence: "user_reported",
    vendorDeliveryStatus: "not_sent",
    vendorConfirmationStatus: "unconfirmed",
    isPaid: false,
  }]);
  assert.deepEqual(view?.linkedCompletedVendorBookingIds, [ids.bookingId]);
  assert.equal(view?.completedVendorBookingReadState, "loaded");
  for (const privateReviewField of [
    "reviewId",
    "rating",
    "review",
    "publicReview",
    "completedByProfileId",
    "sourceActorRole",
  ]) {
    assert.equal(
      Object.hasOwn(view?.currentCompletedVendorBookingRecords[0] ?? {}, privateReviewField),
      false,
      privateReviewField,
    );
  }
  for (const field of ["status", "progress", "facts", "unknowns", "nextAction"]) {
    assert.deepEqual(view?.[field], baseline?.[field], field);
  }
  assert.deepEqual(view?.currentVendorBookingRecords, []);
  assert.deepEqual(view?.linkedVendorBookingIds, []);
});

test("a completed outcome updated before its decision time is not current provenance", () => {
  const { input } = exactCompletedVendorBookingInput();
  const view = buildAmoraPreparationTopicView({
    ...input,
    completedVendorBookingDecisionReceipts: [{
      ...input.completedVendorBookingDecisionReceipts[0],
      created_at: "2026-08-16T09:00:00.000Z",
      updated_at: "2026-08-16T09:00:00.500Z",
    }],
  });

  assert.deepEqual(view?.currentCompletedVendorBookingRecords, []);
  assert.deepEqual(view?.linkedCompletedVendorBookingIds, []);
});

test("canonical completed decision amounts keep their JSON numeric types", () => {
  const { input } = exactCompletedVendorBookingInput();
  const decision = input.completedVendorBookingDecisionReceipts[0];
  const view = buildAmoraPreparationTopicView({
    ...input,
    completedVendorBookingDecisionReceipts: [{
      ...decision,
      chosen_value: {
        ...decision.chosen_value,
        quoted_amount: "500000",
      },
    }],
  });

  assert.deepEqual(view?.currentCompletedVendorBookingRecords, []);
});

test("completed booking rows must keep the exact current unpaid uncancelled snapshots", () => {
  const cases = [
    ["status", (booking) => { booking.status = "pending"; }],
    ["delivery", (booking) => { booking.vendor_delivery_status = "sent"; }],
    ["paid", (booking) => { booking.is_paid = true; }],
    ["cancelled at", (booking) => { booking.cancelled_at = "2026-08-16T10:00:00.000Z"; }],
    ["cancelled by", (booking) => {
      booking.cancelled_by_profile_id = "71000000-0000-4000-8000-000000000001";
    }],
    ["cancel reason", (booking) => { booking.cancel_reason = "변경"; }],
    ["vendor id", (booking) => {
      booking.vendor_id = "91000000-0000-4000-8000-000000000099";
    }],
    ["vendor snapshot", (booking) => { booking.intent_vendor_name_snapshot = "다른 업체"; }],
    ["category snapshot", (booking) => { booking.intent_vendor_category_snapshot = "dress"; }],
    ["product id", (booking) => {
      booking.product_id = "31000000-0000-4000-8000-000000000099";
    }],
    ["product snapshot", (booking) => { booking.intent_product_name_snapshot = "다른 상품"; }],
    ["date", (booking) => { booking.booking_date = "2026-02-30"; }],
    ["time", (booking) => { booking.booking_time = "10:30:00"; }],
    ["quoted amount", (booking) => { booking.amount = 500_001; }],
    ["contracted amount", (booking) => { booking.contracted_amount = 450_001; }],
    ["actual amount", (booking) => { booking.actual_amount = 520_001; }],
  ];

  for (const [label, mutate] of cases) {
    const { input } = exactCompletedVendorBookingInput();
    const booking = { ...input.completedVendorBookings[0] };
    mutate(booking);
    const view = buildAmoraPreparationTopicView({
      ...input,
      completedVendorBookings: [booking],
    });
    assert.deepEqual(view?.currentCompletedVendorBookingRecords, [], label);
  }
});

test("legacy foreign superseded duplicate and mismatched completed receipts fail closed", () => {
  const cases = [
    ["legacy null provenance", ({ metadata }) => { metadata.outcome_provenance_version = null; }],
    ["unknown provenance", ({ metadata }) => { metadata.outcome_provenance_version = 2; }],
    ["foreign actor", ({ metadata }) => {
      metadata.actor_profile_id = "71000000-0000-4000-8000-000000000099";
    }],
    ["foreign couple", ({ decision }) => {
      decision.couple_id = "41000000-0000-4000-8000-000000000099";
    }],
    ["foreign source", ({ decision }) => { decision.source = "chat"; }],
    ["wrong decision type", ({ decision }) => { decision.decision_type = "decided"; }],
    ["wrong hook", ({ metadata }) => { metadata.hook = "booking_intent"; }],
    ["wrong actor role", ({ decision }) => { decision.source_actor_role = "system"; }],
    ["future decision", ({ decision }) => {
      decision.user_confirmed_at = "2026-08-18T09:00:00.000Z";
      decision.decided_at = "2026-08-18T09:00:00.000Z";
      decision.created_at = "2026-08-18T09:00:00.000Z";
      decision.updated_at = "2026-08-18T09:00:00.000Z";
    }],
    ["confirmation after decision", ({ decision }) => {
      decision.user_confirmed_at = "2026-08-16T09:00:02.000Z";
    }],
    ["superseded at", ({ decision }) => {
      decision.superseded_at = "2026-08-16T10:00:00.000Z";
    }],
    ["superseded by", ({ decision }) => {
      decision.superseded_by = "51000000-0000-4000-8000-000000000099";
    }],
    ["mismatched booking", ({ chosen }) => {
      chosen.booking_id = "81000000-0000-4000-8000-000000000099";
    }],
    ["mismatched vendor", ({ chosen }) => { chosen.vendor_name = "다른 업체"; }],
    ["mismatched actual", ({ chosen }) => { chosen.actual_amount = 520_001; }],
    ["mismatched extra", ({ chosen, metadata }) => {
      chosen.extra_amount = 70_001;
      metadata.extra_amount = 70_001;
    }],
    ["wrong completion evidence", ({ chosen }) => {
      chosen.completion_evidence = "vendor_confirmed";
    }],
    ["wrong metadata evidence", ({ metadata }) => {
      metadata.completion_evidence = "vendor_confirmed";
    }],
    ["wrong confirmation status", ({ metadata }) => {
      metadata.vendor_confirmation_status = "confirmed";
    }],
    ["extra chosen key", ({ chosen }) => { chosen.internal = true; }],
    ["extra metadata key", ({ metadata }) => { metadata.internal = true; }],
  ];

  for (const [label, mutate] of cases) {
    const { input } = exactCompletedVendorBookingInput();
    const baseDecision = input.completedVendorBookingDecisionReceipts[0];
    const chosen = { ...baseDecision.chosen_value };
    const metadata = { ...baseDecision.metadata };
    const decision = { ...baseDecision, chosen_value: chosen, metadata };
    mutate({ chosen, decision, metadata });
    const view = buildAmoraPreparationTopicView({
      ...input,
      completedVendorBookingDecisionReceipts: [decision],
    });
    assert.deepEqual(view?.currentCompletedVendorBookingRecords, [], label);
  }

  const { input } = exactCompletedVendorBookingInput();
  const duplicateBookingView = buildAmoraPreparationTopicView({
    ...input,
    completedVendorBookings: [
      input.completedVendorBookings[0],
      { ...input.completedVendorBookings[0] },
    ],
  });
  const duplicateDecisionView = buildAmoraPreparationTopicView({
    ...input,
    completedVendorBookingDecisionReceipts: [
      input.completedVendorBookingDecisionReceipts[0],
      {
        ...input.completedVendorBookingDecisionReceipts[0],
        id: "51000000-0000-4000-8000-000000000002",
      },
    ],
  });
  assert.deepEqual(duplicateBookingView?.currentCompletedVendorBookingRecords, []);
  assert.deepEqual(duplicateDecisionView?.currentCompletedVendorBookingRecords, []);
});

test("private review shape is verified only inside the canonical decision envelope", () => {
  const cases = [
    ["review id", ({ metadata }) => { metadata.review_id = "not-a-uuid"; }],
    ["rating", ({ chosen }) => { chosen.rating = 0; }],
    ["public flag", ({ chosen }) => { chosen.public_review = "false"; }],
    ["unsafe reasoning", ({ decision }) => { decision.reasoning = "\u202E숨김"; }],
  ];

  for (const [label, mutate] of cases) {
    const { input } = exactCompletedVendorBookingInput();
    const baseDecision = input.completedVendorBookingDecisionReceipts[0];
    const chosen = { ...baseDecision.chosen_value };
    const metadata = { ...baseDecision.metadata };
    const decision = { ...baseDecision, chosen_value: chosen, metadata };
    mutate({ chosen, decision, metadata });
    const view = buildAmoraPreparationTopicView({
      ...input,
      completedVendorBookingDecisionReceipts: [decision],
    });
    assert.deepEqual(view?.currentCompletedVendorBookingRecords, [], label);
  }
});

test("an exact current actor-bound booking intent is exposed only as an unconfirmed internal record", () => {
  const { ids, input } = exactVendorIntentInput();
  const {
    actorId,
    bookingId,
    vendorId,
    decisionId,
    createdAt,
  } = ids;
  const view = buildAmoraPreparationTopicView(input);

  assert.deepEqual(view?.currentVendorBookingRecords, [{
    bookingId,
    decisionId,
    vendorId,
    productId: null,
    vendorName: "한방 스튜디오",
    productName: null,
    bookingDate: "2026-09-20",
    bookingTime: "10:00",
    quotedAmountWon: 500_000,
    initiatedByProfileId: actorId,
    initiatedAt: createdAt,
    recordScope: "amora_internal_request",
    evidence: "actor_bound_atomic_intent",
    vendorDeliveryStatus: "not_sent",
    vendorConfirmationStatus: "unconfirmed",
  }]);
  assert.deepEqual(view?.linkedVendorBookingIds, [bookingId]);
  assert.equal(view?.vendorBookingReadState, "loaded");
  assert.deepEqual(view?.linkedDecisionIds, []);
  assert.deepEqual(view?.facts, []);
  assert.equal(view?.status, "not_started");
  assert.equal(view?.nextAction?.source, "applicability");
});

test("a past pending booking intent is not treated as a current preparation record", () => {
  const { input } = exactVendorIntentInput();
  const pastDate = "2026-08-16";
  const view = buildAmoraPreparationTopicView({
    ...input,
    vendorBookings: [{
      ...input.vendorBookings[0],
      booking_date: pastDate,
    }],
    vendorBookingDecisionReceipts: [{
      ...input.vendorBookingDecisionReceipts[0],
      chosen_value: {
        ...input.vendorBookingDecisionReceipts[0].chosen_value,
        booking_date: pastDate,
      },
    }],
  });

  assert.deepEqual(view?.currentVendorBookingRecords, []);
  assert.deepEqual(view?.linkedVendorBookingIds, []);
});

test("a padded vendor category snapshot cannot be normalized into another topic identity", () => {
  const { input } = exactVendorIntentInput();
  const view = buildAmoraPreparationTopicView({
    ...input,
    vendorBookings: [{
      ...input.vendorBookings[0],
      intent_vendor_category_snapshot: " studio ",
    }],
  });

  assert.deepEqual(view?.currentVendorBookingRecords, []);
  assert.deepEqual(view?.linkedVendorBookingIds, []);
});

test("a product id and immutable product snapshot must either both exist or both be null", () => {
  const { input } = exactVendorIntentInput();
  const productId = "30000000-0000-4000-8000-000000000001";
  const mismatchedInputs = [
    {
      booking: { ...input.vendorBookings[0], product_id: productId },
      chosen: {
        ...input.vendorBookingDecisionReceipts[0].chosen_value,
        product_id: productId,
      },
    },
    {
      booking: {
        ...input.vendorBookings[0],
        intent_product_name_snapshot: "기본 촬영",
      },
      chosen: {
        ...input.vendorBookingDecisionReceipts[0].chosen_value,
        product_name: "기본 촬영",
      },
    },
  ];

  for (const candidate of mismatchedInputs) {
    const view = buildAmoraPreparationTopicView({
      ...input,
      vendorBookings: [candidate.booking],
      vendorBookingDecisionReceipts: [{
        ...input.vendorBookingDecisionReceipts[0],
        chosen_value: candidate.chosen,
      }],
    });
    assert.deepEqual(view?.currentVendorBookingRecords, []);
  }
});

test("a paid booking row cannot be presented as an unconfirmed internal intent", () => {
  const { input } = exactVendorIntentInput();
  const view = buildAmoraPreparationTopicView({
    ...input,
    vendorBookings: [{
      ...input.vendorBookings[0],
      is_paid: true,
    }],
  });

  assert.deepEqual(view?.currentVendorBookingRecords, []);
  assert.deepEqual(view?.linkedVendorBookingIds, []);
});

test("completed, unbound, automatic, stale, and tampered booking receipts stay excluded", () => {
  const cases = [
    {
      label: "completed outcome",
      change({ booking, decision }) {
        booking.status = "completed";
        booking.actual_amount = 500_000;
        decision.decision_type = "completed";
        decision.decided_at = "2026-08-16T09:00:00.000Z";
        decision.metadata = { ...decision.metadata, hook: "booking_outcome" };
      },
    },
    {
      label: "non-current actor",
      change({ input }) {
        input.currentCoupleMemberIds = ["70000000-0000-4000-8000-000000000099"];
      },
    },
    {
      label: "automatic source",
      change({ decision }) {
        decision.source = "chat";
      },
    },
    {
      label: "invented confirmation timestamp",
      change({ decision }) {
        decision.user_confirmed_at = "2026-08-15T09:00:00.000Z";
      },
    },
    {
      label: "superseded receipt",
      change({ decision }) {
        decision.superseded_at = "2026-08-16T09:00:00.000Z";
      },
    },
    {
      label: "tampered immutable snapshot",
      change({ decision }) {
        decision.chosen_value = {
          ...decision.chosen_value,
          vendor_name: "다른 업체",
        };
      },
    },
  ];

  for (const candidate of cases) {
    const { input: exactInput } = exactVendorIntentInput();
    const input = { ...exactInput };
    const booking = { ...exactInput.vendorBookings[0] };
    const decision = {
      ...exactInput.vendorBookingDecisionReceipts[0],
      chosen_value: { ...exactInput.vendorBookingDecisionReceipts[0].chosen_value },
      metadata: { ...exactInput.vendorBookingDecisionReceipts[0].metadata },
    };
    candidate.change({ input, booking, decision });
    const view = buildAmoraPreparationTopicView({
      ...input,
      vendorBookings: [booking],
      vendorBookingDecisionReceipts: [decision],
    });
    assert.deepEqual(
      view?.currentVendorBookingRecords,
      [],
      candidate.label,
    );
  }
});

test("ambiguous duplicate booking or receipt input fails closed", () => {
  const { input } = exactVendorIntentInput();
  const duplicateBookingView = buildAmoraPreparationTopicView({
    ...input,
    vendorBookings: [input.vendorBookings[0], { ...input.vendorBookings[0] }],
  });
  const duplicateDecisionView = buildAmoraPreparationTopicView({
    ...input,
    vendorBookingDecisionReceipts: [
      input.vendorBookingDecisionReceipts[0],
      {
        ...input.vendorBookingDecisionReceipts[0],
        id: "50000000-0000-4000-8000-000000000052",
      },
    ],
  });

  assert.deepEqual(duplicateBookingView?.currentVendorBookingRecords, []);
  assert.deepEqual(duplicateDecisionView?.currentVendorBookingRecords, []);
});
