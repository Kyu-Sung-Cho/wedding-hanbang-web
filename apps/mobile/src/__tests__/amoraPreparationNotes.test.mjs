import assert from "node:assert/strict";
import test from "node:test";

import { buildAmoraPreparationNotes } from "../lib/amoraPreparationNotes.mjs";

const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const COUPLE_ID = "20000000-0000-4000-8000-000000000002";
const MESSAGE_ID = "30000000-0000-4000-8000-000000000003";

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
});
