import assert from "node:assert/strict";
import test from "node:test";

import { buildAmoraPreparationNotes } from "../lib/amoraPreparationNotes.mjs";

const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const COUPLE_ID = "20000000-0000-4000-8000-000000000002";
const MESSAGE_ID = "30000000-0000-4000-8000-000000000003";
const RECEIPT_MESSAGE_ID = "90000000-0000-4000-8000-000000000009";
const ACTION_ID = "act_10000000000040008000000000000001_123456789012345678901234";
const SCHEDULE_DECISION_ID = "a0000000-0000-4000-8000-00000000000a";

function reference(overrides = {}) {
  return {
    refId: "40000000-0000-4000-8000-000000000004",
    topicKey: "venue",
    messageId: MESSAGE_ID,
    audience: "owner_private",
    revision: 1,
    savedAt: "2026-08-18T08:00:00.000Z",
    sourceCreatedAt: "2026-08-18T07:00:00.000Z",
    excerpt: "예식장 후보를 볼 때 보증 인원과 식대 조건을 먼저 비교해 보세요.",
    canRemove: true,
    canOpenOriginal: true,
    ...overrides,
  };
}

function actionReceiptPage(overrides = {}) {
  return {
    version: 1,
    state: "ready",
    recipientUserId: OWNER_ID,
    coupleId: COUPLE_ID,
    snapshotAt: "2026-08-18T12:00:00.000Z",
    entries: [{
      receiptMessageId: RECEIPT_MESSAGE_ID,
      actionId: ACTION_ID,
      topicKey: "venue",
      title: "예식장 후보 세 곳에 같은 조건 묻기",
      displayMessage: "예식장 후보 확인 행동을 준비에 반영했어요.",
      appliedAt: "2026-08-18T11:00:00.000Z",
      scope: "couple_shared",
      canOpenAction: true,
    }],
    nextCursor: null,
    partial: false,
    ...overrides,
  };
}

function scheduleDecisionPage(overrides = {}) {
  return {
    version: 1,
    state: "ready",
    recipientUserId: OWNER_ID,
    coupleId: COUPLE_ID,
    snapshotAt: "2026-08-18T12:00:00.000Z",
    currentJourneyRevision: 8,
    entries: [{
      decisionId: SCHEDULE_DECISION_ID,
      eventId: "meeting-event",
      topicKey: "meeting",
      title: "일정 추가 · 양가 부모님 첫 만남",
      date: "2026-09-05",
      confirmedAt: "2026-08-18T10:30:00.000Z",
      scope: "couple_shared",
      canOpenSchedule: true,
    }],
    nextCursor: null,
    partial: false,
    ...overrides,
  };
}

test("a current schedule receipt becomes one searchable confirmed-decision record", () => {
  const result = buildAmoraPreparationNotes({
    ownerId: OWNER_ID,
    coupleId: COUPLE_ID,
    topics: [
      { key: "venue", label: "예식장" },
      { key: "meeting", label: "상견례" },
    ],
    messageReferenceCollection: {
      version: 1,
      state: "ready",
      recipientUserId: OWNER_ID,
      coupleId: COUPLE_ID,
      references: [],
      partial: false,
    },
    messageReferenceReadState: "loaded",
    scheduleDecisionCollection: scheduleDecisionPage(),
    scheduleDecisionReadState: "loaded",
    query: "상견례 일정",
    scopeFilter: "couple_shared",
    topicFilter: "meeting",
    typeFilter: "confirmed_decision",
  });

  assert.deepEqual(result.records, [{
    id: `confirmed_decision:${SCHEDULE_DECISION_ID}`,
    type: "confirmed_decision",
    typeLabel: "확인한 결정",
    title: "일정 추가 · 양가 부모님 첫 만남",
    excerpt: "2026-09-05 일정에 반영됐어요.",
    topicKeys: ["meeting"],
    topicLabels: ["상견례"],
    scope: "couple_shared",
    scopeLabel: "함께 보기",
    savedAt: "2026-08-18T10:30:00.000Z",
    sourceCreatedAt: "2026-08-18T10:30:00.000Z",
    freshness: "current",
    openSchedule: { eventId: "meeting-event" },
  }]);
});

test("schedule-decision pages require one journey snapshot and preserve partial verified results", () => {
  const first = scheduleDecisionPage({
    nextCursor: "sd1.eyJmaXJzdFBhZ2VCb3VuZGFyeSI6dHJ1ZX0",
  });
  const second = scheduleDecisionPage({
    entries: [{
      ...first.entries[0],
      decisionId: "b0000000-0000-4000-8000-00000000000b",
      eventId: "venue-event",
      topicKey: "venue",
      title: "일정 수정 · 예식장 최종 상담",
      date: "2026-09-12",
      confirmedAt: "2026-08-18T09:30:00.000Z",
    }],
    nextCursor: null,
    partial: true,
  });
  const base = {
    ownerId: OWNER_ID,
    coupleId: COUPLE_ID,
    topics: [
      { key: "venue", label: "예식장" },
      { key: "meeting", label: "상견례" },
    ],
    messageReferenceCollection: {
      version: 1,
      state: "ready",
      recipientUserId: OWNER_ID,
      coupleId: COUPLE_ID,
      references: [],
      partial: false,
    },
    messageReferenceReadState: "loaded",
    scheduleDecisionCollection: first,
    scheduleDecisionPages: [first, second],
    scheduleDecisionReadState: "loaded",
    query: "",
    scopeFilter: "all",
    topicFilter: "all",
    typeFilter: "all",
  };

  const merged = buildAmoraPreparationNotes(base);
  assert.equal(merged.state, "partial");
  assert.deepEqual(merged.records.map((record) => record.id), [
    `confirmed_decision:${SCHEDULE_DECISION_ID}`,
    "confirmed_decision:b0000000-0000-4000-8000-00000000000b",
  ]);
  assert.equal(buildAmoraPreparationNotes({
    ...base,
    scheduleDecisionPages: [first, { ...second, currentJourneyRevision: 9 }],
  }).state, "partial");
  assert.equal(buildAmoraPreparationNotes({
    ...base,
    scheduleDecisionPages: [first, { ...second, entries: first.entries }],
  }).state, "partial");
});

test("a server-authoritative application receipt becomes one searchable actual-application record", () => {
  const result = buildAmoraPreparationNotes({
    ownerId: OWNER_ID,
    coupleId: COUPLE_ID,
    topics: [{ key: "venue", label: "예식장" }],
    messageReferenceCollection: {
      version: 1,
      state: "ready",
      recipientUserId: OWNER_ID,
      coupleId: COUPLE_ID,
      references: [],
      partial: false,
    },
    messageReferenceReadState: "loaded",
    actionReceiptCollection: actionReceiptPage(),
    actionReceiptReadState: "loaded",
    query: "예식장 후보",
    scopeFilter: "couple_shared",
    topicFilter: "venue",
    typeFilter: "applied_receipt",
  });

  assert.deepEqual(result, {
    state: "ready",
    query: "예식장 후보",
    scopeFilter: "couple_shared",
    topicFilter: "venue",
    typeFilter: "applied_receipt",
    continuingStory: null,
    records: [{
      id: `applied_receipt:${RECEIPT_MESSAGE_ID}`,
      type: "applied_receipt",
      typeLabel: "실제 반영",
      title: "예식장 후보 세 곳에 같은 조건 묻기",
      excerpt: "예식장 후보 확인 행동을 준비에 반영했어요.",
      topicKeys: ["venue"],
      topicLabels: ["예식장"],
      scope: "couple_shared",
      scopeLabel: "함께 보기",
      savedAt: "2026-08-18T11:00:00.000Z",
      sourceCreatedAt: "2026-08-18T11:00:00.000Z",
      freshness: "current",
      openAction: { actionId: ACTION_ID },
    }],
  });
});

test("action-receipt cursor pages are snapshot-bound, ordered, unique, and preserve verified partial results", () => {
  const first = actionReceiptPage({
    nextCursor: "ap1.eyJmaXJzdFBhZ2VCb3VuZGFyeSI6dHJ1ZX0",
  });
  const secondEntry = {
    ...first.entries[0],
    receiptMessageId: "a0000000-0000-4000-8000-00000000000a",
    actionId: "act_20000000000040008000000000000002_123456789012345678901234",
    appliedAt: "2026-08-18T10:00:00.000Z",
    title: "예식장 계약 조건 다시 확인하기",
    displayMessage: "계약 조건 확인 행동을 준비에 반영했어요.",
  };
  const second = {
    ...first,
    entries: [secondEntry],
    nextCursor: null,
    partial: true,
  };
  const base = {
    ownerId: OWNER_ID,
    coupleId: COUPLE_ID,
    topics: [{ key: "venue", label: "예식장" }],
    messageReferenceCollection: {
      version: 1,
      state: "ready",
      recipientUserId: OWNER_ID,
      coupleId: COUPLE_ID,
      references: [],
      partial: false,
    },
    messageReferenceReadState: "loaded",
    actionReceiptCollection: first,
    actionReceiptPages: [first, second],
    actionReceiptReadState: "loaded",
    query: "",
    scopeFilter: "all",
    topicFilter: "all",
    typeFilter: "all",
  };

  const merged = buildAmoraPreparationNotes(base);
  assert.equal(merged.state, "partial");
  assert.deepEqual(merged.records.map((record) => record.id), [
    `applied_receipt:${RECEIPT_MESSAGE_ID}`,
    "applied_receipt:a0000000-0000-4000-8000-00000000000a",
  ]);
  assert.equal(buildAmoraPreparationNotes({
    ...base,
    actionReceiptPages: [first, { ...second, snapshotAt: "2026-08-18T12:01:00.000Z" }],
  }).state, "partial");
  assert.equal(buildAmoraPreparationNotes({
    ...base,
    actionReceiptPages: [first, { ...second, entries: first.entries }],
  }).state, "partial");
});

test("saved conversations become scope-labelled notes and the same source is grouped across topics", () => {
  const result = buildAmoraPreparationNotes({
    ownerId: OWNER_ID,
    coupleId: COUPLE_ID,
    topics: [
      { key: "venue", label: "예식장" },
      { key: "meeting", label: "상견례" },
    ],
    messageReferenceCollection: {
      version: 1,
      state: "ready",
      recipientUserId: OWNER_ID,
      coupleId: COUPLE_ID,
      references: [
        reference(),
        reference({
          refId: "50000000-0000-4000-8000-000000000005",
          topicKey: "meeting",
          revision: 2,
          savedAt: "2026-08-18T09:00:00.000Z",
        }),
      ],
      partial: false,
    },
    messageReferenceReadState: "loaded",
    query: "",
    scopeFilter: "all",
    topicFilter: "all",
    typeFilter: "all",
  });

  assert.deepEqual(result, {
    state: "ready",
    query: "",
    scopeFilter: "all",
    topicFilter: "all",
    typeFilter: "all",
    continuingStory: null,
    records: [{
      id: `saved_conversation:owner_private:${MESSAGE_ID}`,
      type: "saved_conversation",
      typeLabel: "저장 대화",
      excerpt: "예식장 후보를 볼 때 보증 인원과 식대 조건을 먼저 비교해 보세요.",
      topicKeys: ["venue", "meeting"],
      topicLabels: ["예식장", "상견례"],
      scope: "owner_private",
      scopeLabel: "나만 보기",
      savedAt: "2026-08-18T09:00:00.000Z",
      sourceCreatedAt: "2026-08-18T07:00:00.000Z",
      freshness: "current",
      openOriginal: {
        refId: "50000000-0000-4000-8000-000000000005",
      },
    }],
  });
});

test("a notes page searches the exact user question and keeps the server answer separate", () => {
  const result = buildAmoraPreparationNotes({
    ownerId: OWNER_ID,
    coupleId: COUPLE_ID,
    topics: [{ key: "venue", label: "예식장" }],
    messageReferenceCollection: {
      version: 1,
      state: "ready",
      recipientUserId: OWNER_ID,
      coupleId: COUPLE_ID,
      snapshotAt: "2026-08-18T09:00:00.000Z",
      entries: [{
        refId: "40000000-0000-4000-8000-000000000004",
        topicKey: "venue",
        messageId: MESSAGE_ID,
        audience: "owner_private",
        revision: 1,
        savedAt: "2026-08-18T08:00:00.000Z",
        sourceCreatedAt: "2026-08-18T07:00:00.000Z",
        questionExcerpt: "예식장 계약 전에 무엇을 확인해야 할까?",
        answerExcerpt: "대관 범위와 취소 조건을 서면에서 먼저 확인해요.",
        canRemove: true,
        canOpenOriginal: true,
      }],
      nextCursor: "np1.eyJzbmFwc2hvdEF0IjoiMjAyNi0wOC0xOFQwOTowMDowMC4wMDBaIn0",
      partial: false,
    },
    messageReferenceReadState: "loaded",
    query: "계약 전에",
    scopeFilter: "all",
    topicFilter: "all",
    typeFilter: "all",
  });

  assert.equal(result.state, "ready");
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].questionExcerpt, "예식장 계약 전에 무엇을 확인해야 할까?");
  assert.equal(result.records[0].excerpt, "대관 범위와 취소 조건을 서면에서 먼저 확인해요.");
});

test("cursor pages merge only inside one snapshot without duplicate saved references", () => {
  const first = {
    version: 1,
    state: "ready",
    recipientUserId: OWNER_ID,
    coupleId: COUPLE_ID,
    snapshotAt: "2026-08-18T09:00:00.000Z",
    entries: [{
      refId: "40000000-0000-4000-8000-000000000004",
      topicKey: "venue",
      messageId: MESSAGE_ID,
      audience: "owner_private",
      revision: 1,
      savedAt: "2026-08-18T08:00:00.000Z",
      sourceCreatedAt: "2026-08-18T07:00:00.000Z",
      questionExcerpt: "첫 질문",
      answerExcerpt: "첫 답변",
      canRemove: true,
      canOpenOriginal: true,
    }],
    nextCursor: "np1.eyJmaXJzdFBhZ2VCb3VuZGFyeSI6dHJ1ZX0",
    partial: false,
  };
  const second = {
    ...first,
    entries: [{
      ...first.entries[0],
      refId: "50000000-0000-4000-8000-000000000005",
      messageId: "60000000-0000-4000-8000-000000000006",
      savedAt: "2026-08-18T06:00:00.000Z",
      sourceCreatedAt: "2026-08-18T05:00:00.000Z",
      questionExcerpt: "둘째 질문",
      answerExcerpt: "둘째 답변",
    }],
    nextCursor: null,
  };
  const base = {
    ownerId: OWNER_ID,
    coupleId: COUPLE_ID,
    topics: [{ key: "venue", label: "예식장" }],
    messageReferenceCollection: first,
    messageReferencePages: [first, second],
    messageReferenceReadState: "loaded",
    query: "",
    scopeFilter: "all",
    topicFilter: "all",
    typeFilter: "all",
  };

  const merged = buildAmoraPreparationNotes(base);
  assert.deepEqual(merged.records.map((record) => record.questionExcerpt), [
    "첫 질문",
    "둘째 질문",
  ]);
  assert.equal(buildAmoraPreparationNotes({
    ...base,
    messageReferencePages: [first, { ...second, snapshotAt: "2026-08-18T10:00:00.000Z" }],
  }).state, "read_error");
  assert.equal(buildAmoraPreparationNotes({
    ...base,
    messageReferencePages: [first, { ...second, entries: first.entries }],
  }).state, "read_error");
  assert.equal(buildAmoraPreparationNotes({
    ...base,
    messageReferencePages: [first, { ...second, nextCursor: first.nextCursor }],
  }).state, "read_error");
  assert.equal(buildAmoraPreparationNotes({
    ...base,
    messageReferenceCollection: {
      ...first,
      entries: [
        first.entries[0],
        { ...second.entries[0], savedAt: "2026-08-18T08:30:00.000Z" },
      ],
    },
    messageReferencePages: undefined,
  }).state, "read_error");
});

test("search and scope/type filters never turn a non-empty collection into an empty-account claim", () => {
  const base = {
    ownerId: OWNER_ID,
    coupleId: COUPLE_ID,
    topics: [
      { key: "venue", label: "예식장" },
      { key: "meeting", label: "상견례" },
    ],
    messageReferenceCollection: {
      version: 1,
      state: "ready",
      recipientUserId: OWNER_ID,
      coupleId: COUPLE_ID,
      references: [
        reference(),
        reference({
          refId: "60000000-0000-4000-8000-000000000006",
          topicKey: "meeting",
          messageId: "70000000-0000-4000-8000-000000000007",
          audience: "couple_shared",
          excerpt: "상견례 장소와 참석자를 두 사람이 함께 확인해 보세요.",
          savedAt: "2026-08-18T10:00:00.000Z",
          sourceCreatedAt: "2026-08-18T06:00:00.000Z",
        }),
      ],
      partial: false,
    },
    messageReferenceReadState: "loaded",
  };

  const searched = buildAmoraPreparationNotes({
    ...base,
    query: "예식장",
    scopeFilter: "all",
    typeFilter: "all",
  });
  assert.equal(searched.state, "ready");
  assert.deepEqual(searched.records.map((record) => record.scope), ["owner_private"]);

  const sharedOnly = buildAmoraPreparationNotes({
    ...base,
    query: "",
    scopeFilter: "couple_shared",
    typeFilter: "saved_conversation",
  });
  assert.deepEqual(sharedOnly.records.map((record) => record.scopeLabel), ["함께 보기"]);

  const unsupportedType = buildAmoraPreparationNotes({
    ...base,
    query: "",
    scopeFilter: "all",
    typeFilter: "owner_criterion",
  });
  assert.equal(unsupportedType.state, "no_results");
  assert.deepEqual(unsupportedType.records, []);
});

test("a preparation-topic filter isolates exact saved sources without borrowing global criteria", () => {
  const result = buildAmoraPreparationNotes({
    ownerId: OWNER_ID,
    coupleId: COUPLE_ID,
    topics: [
      { key: "venue", label: "예식장" },
      { key: "meeting", label: "상견례" },
    ],
    messageReferenceCollection: {
      version: 1,
      state: "ready",
      recipientUserId: OWNER_ID,
      coupleId: COUPLE_ID,
      references: [
        reference(),
        reference({
          refId: "60000000-0000-4000-8000-000000000006",
          topicKey: "meeting",
          messageId: "70000000-0000-4000-8000-000000000007",
          audience: "couple_shared",
          excerpt: "상견례 장소와 참석자를 두 사람이 함께 확인해 보세요.",
          savedAt: "2026-08-18T10:00:00.000Z",
          sourceCreatedAt: "2026-08-18T06:00:00.000Z",
        }),
      ],
      partial: false,
    },
    messageReferenceReadState: "loaded",
    ownerCriterionResponse: {
      version: 1,
      criterion: {
        id: "a0000000-0000-4000-8000-00000000000a",
        value: "이동이 편한 곳",
        updatedAt: "2026-08-18T11:00:00.000Z",
      },
    },
    ownerCriterionReadState: "loaded",
    query: "",
    scopeFilter: "all",
    topicFilter: "meeting",
    typeFilter: "all",
  });

  assert.equal(result.state, "ready");
  assert.equal(result.topicFilter, "meeting");
  assert.deepEqual(result.records.map((record) => record.topicKeys), [["meeting"]]);

  const invalid = buildAmoraPreparationNotes({
    ownerId: OWNER_ID,
    coupleId: COUPLE_ID,
    topics: [{ key: "venue", label: "예식장" }],
    messageReferenceCollection: {
      version: 1,
      state: "ready",
      recipientUserId: OWNER_ID,
      coupleId: COUPLE_ID,
      references: [],
      partial: false,
    },
    messageReferenceReadState: "loaded",
    query: "",
    scopeFilter: "all",
    topicFilter: "unknown_topic",
    typeFilter: "all",
  });
  assert.equal(invalid.state, "read_error");
});

test("partial reads preserve verified notes while foreign or contradictory source rows fail closed", () => {
  const base = {
    ownerId: OWNER_ID,
    coupleId: COUPLE_ID,
    topics: [
      { key: "venue", label: "예식장" },
      { key: "meeting", label: "상견례" },
    ],
    query: "",
    scopeFilter: "all",
    typeFilter: "all",
  };
  const partial = buildAmoraPreparationNotes({
    ...base,
    messageReferenceCollection: {
      version: 1,
      state: "ready",
      recipientUserId: OWNER_ID,
      coupleId: COUPLE_ID,
      references: [reference()],
      partial: true,
    },
    messageReferenceReadState: "loaded",
  });
  assert.equal(partial.state, "partial");
  assert.equal(partial.records.length, 1);

  const foreign = buildAmoraPreparationNotes({
    ...base,
    messageReferenceCollection: {
      version: 1,
      state: "ready",
      recipientUserId: "80000000-0000-4000-8000-000000000008",
      coupleId: COUPLE_ID,
      references: [reference()],
      partial: false,
    },
    messageReferenceReadState: "loaded",
  });
  assert.equal(foreign.state, "read_error");
  assert.deepEqual(foreign.records, []);

  const contradictory = buildAmoraPreparationNotes({
    ...base,
    messageReferenceCollection: {
      version: 1,
      state: "ready",
      recipientUserId: OWNER_ID,
      coupleId: COUPLE_ID,
      references: [
        reference(),
        reference({
          refId: "90000000-0000-4000-8000-000000000009",
          topicKey: "meeting",
          excerpt: "같은 원문인데 다른 발췌문",
        }),
      ],
      partial: false,
    },
    messageReferenceReadState: "loaded",
  });
  assert.equal(contradictory.state, "read_error");
  assert.deepEqual(contradictory.records, []);
});

test("only the current explicit owner and mutually confirmed couple criteria appear as searchable notes", () => {
  const result = buildAmoraPreparationNotes({
    ownerId: OWNER_ID,
    coupleId: COUPLE_ID,
    topics: [{ key: "venue", label: "예식장" }],
    messageReferenceCollection: {
      version: 1,
      state: "ready",
      recipientUserId: OWNER_ID,
      coupleId: COUPLE_ID,
      references: [],
      partial: false,
    },
    messageReferenceReadState: "loaded",
    ownerCriterionResponse: {
      version: 1,
      criterion: {
        id: "a0000000-0000-4000-8000-00000000000a",
        value: "예산 안에서 이동이 편한 곳",
        updatedAt: "2026-08-18T11:00:00.000Z",
      },
    },
    ownerCriterionReadState: "loaded",
    coupleCriterionResponse: {
      version: 1,
      coupleId: COUPLE_ID,
      linked: true,
      current: {
        decisionId: "b0000000-0000-4000-8000-00000000000b",
        value: "하객 이동과 예산을 함께 확인하기",
        confirmedAt: "2026-08-18T12:00:00.000Z",
      },
      proposal: null,
    },
    coupleCriterionReadState: "loaded",
    query: "예산",
    scopeFilter: "all",
    typeFilter: "all",
  });

  assert.equal(result.state, "ready");
  assert.deepEqual(result.records, [
    {
      id: "couple_criterion:b0000000-0000-4000-8000-00000000000b",
      type: "couple_criterion",
      typeLabel: "우리 기준",
      excerpt: "하객 이동과 예산을 함께 확인하기",
      topicKeys: [],
      topicLabels: [],
      scope: "couple_shared",
      scopeLabel: "함께 보기",
      savedAt: "2026-08-18T12:00:00.000Z",
      sourceCreatedAt: "2026-08-18T12:00:00.000Z",
      freshness: "current",
      openSource: {
        route: "/settings/amora-style",
        focus: "couple_criterion",
      },
    },
    {
      id: "owner_criterion:a0000000-0000-4000-8000-00000000000a",
      type: "owner_criterion",
      typeLabel: "내 기준",
      excerpt: "예산 안에서 이동이 편한 곳",
      topicKeys: [],
      topicLabels: [],
      scope: "owner_private",
      scopeLabel: "나만 보기",
      savedAt: "2026-08-18T11:00:00.000Z",
      sourceCreatedAt: "2026-08-18T11:00:00.000Z",
      freshness: "current",
      openSource: {
        route: "/settings/amora-style",
        focus: "owner_criterion",
      },
    },
  ]);
});

test("the one continuing story reuses the same canonical open-action priority as home", () => {
  const result = buildAmoraPreparationNotes({
    ownerId: OWNER_ID,
    coupleId: COUPLE_ID,
    topics: [
      { key: "venue", label: "예식장" },
      { key: "meeting", label: "상견례" },
    ],
    messageReferenceCollection: {
      version: 1,
      state: "ready",
      recipientUserId: OWNER_ID,
      coupleId: COUPLE_ID,
      references: [],
      partial: false,
    },
    messageReferenceReadState: "loaded",
    openActions: [
      {
        id: "act_10000000000040008000000000000001_123456789012345678901234",
        couple_id: COUPLE_ID,
        title: "예식장 후보 세 곳에 같은 조건 묻기",
        description: "보증 인원과 식대 조건을 같은 기준으로 확인해요.",
        due_date: "2026-08-19",
        priority: "medium",
        status: "open",
        source: "chat",
        category_key: "venue",
        follow_up_revision: 7,
        created_at: "2026-08-17T12:00:00.000Z",
      },
      {
        id: "act_20000000000040008000000000000002_123456789012345678901234",
        couple_id: COUPLE_ID,
        title: "상견례 참석자 확인하기",
        description: "양가 참석자를 확인해요.",
        due_date: "2026-08-30",
        priority: "high",
        status: "open",
        source: "chat",
        category_key: "meeting",
        follow_up_revision: 6,
        created_at: "2026-08-18T12:00:00.000Z",
      },
    ],
    actionReadState: "loaded",
    todayYmd: "2026-08-18",
    query: "",
    scopeFilter: "all",
    typeFilter: "all",
  });

  assert.deepEqual(result.continuingStory, {
    actionId: "act_10000000000040008000000000000001_123456789012345678901234",
    actionRevision: 7,
    topicKey: "venue",
    topicLabel: "예식장",
    title: "예식장 후보 세 곳에 같은 조건 묻기",
    description: "보증 인원과 식대 조건을 같은 기준으로 확인해요.",
    route: "/checklist",
  });
});

test("one unavailable notes source preserves records from the other verified source", () => {
  const withCriterionOnly = buildAmoraPreparationNotes({
    ownerId: OWNER_ID,
    coupleId: COUPLE_ID,
    topics: [{ key: "venue", label: "예식장" }],
    messageReferenceCollection: null,
    messageReferenceReadState: "unavailable",
    ownerCriterionResponse: {
      version: 1,
      criterion: {
        id: "a0000000-0000-4000-8000-00000000000a",
        value: "이동이 편한 곳",
        updatedAt: "2026-08-18T11:00:00.000Z",
      },
    },
    ownerCriterionReadState: "loaded",
    query: "",
    scopeFilter: "all",
    typeFilter: "all",
  });
  assert.equal(withCriterionOnly.state, "partial");
  assert.deepEqual(withCriterionOnly.records.map((record) => record.type), [
    "owner_criterion",
  ]);

  const withConversationOnly = buildAmoraPreparationNotes({
    ownerId: OWNER_ID,
    coupleId: COUPLE_ID,
    topics: [{ key: "venue", label: "예식장" }],
    messageReferenceCollection: {
      version: 1,
      state: "ready",
      recipientUserId: OWNER_ID,
      coupleId: COUPLE_ID,
      references: [reference()],
      partial: false,
    },
    messageReferenceReadState: "loaded",
    ownerCriterionResponse: null,
    ownerCriterionReadState: "unavailable",
    query: "",
    scopeFilter: "all",
    typeFilter: "all",
  });
  assert.equal(withConversationOnly.state, "partial");
  assert.deepEqual(withConversationOnly.records.map((record) => record.type), [
    "saved_conversation",
  ]);

  const withUnavailableReceipts = buildAmoraPreparationNotes({
    ownerId: OWNER_ID,
    coupleId: COUPLE_ID,
    topics: [{ key: "venue", label: "예식장" }],
    messageReferenceCollection: {
      version: 1,
      state: "ready",
      recipientUserId: OWNER_ID,
      coupleId: COUPLE_ID,
      references: [reference()],
      partial: false,
    },
    messageReferenceReadState: "loaded",
    actionReceiptCollection: null,
    actionReceiptReadState: "unavailable",
    query: "",
    scopeFilter: "all",
    typeFilter: "all",
  });
  assert.equal(withUnavailableReceipts.state, "partial");
  assert.deepEqual(withUnavailableReceipts.records.map((record) => record.type), [
    "saved_conversation",
  ]);
});
