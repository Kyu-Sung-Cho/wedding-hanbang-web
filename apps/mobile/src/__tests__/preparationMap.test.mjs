import assert from "node:assert/strict";
import test from "node:test";

import { buildAmoraPreparationOverview } from "@hanbang/shared/amora-preparation-map";

const topics = [
  {
    key: "meeting",
    label: "부모님 첫 만남",
    ddayStart: 360,
    ddayDeadline: 300,
    items: [
      { id: "meeting_01", label: "날짜 조율" },
      { id: "meeting_02", label: "장소 정하기" },
    ],
  },
  {
    key: "venue",
    label: "결혼식장",
    ddayStart: 360,
    ddayDeadline: 270,
    items: [{ id: "venue_01", label: "후보 비교" }],
  },
];

const currentChecklistTopics = [
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
].map((key) => ({ key, label: key, items: [] }));

test("an empty journey stays unknown instead of inventing preparation progress", () => {
  const overview = buildAmoraPreparationOverview({
    topics,
    progress: {},
    attentionTopicKeys: [],
  });

  assert.equal(overview.version, 1);
  assert.deepEqual(overview.summary, {
    totalTopics: 2,
    unknownTopics: 2,
    notStartedTopics: 0,
    inProgressTopics: 0,
    completedTopics: 0,
    notApplicableTopics: 0,
    needsReviewTopics: 0,
    completedItems: 0,
    totalItems: 3,
    percent: 0,
  });
  assert.deepEqual(
    overview.topics.map((topic) => ({
      key: topic.topicKey,
      state: topic.state,
      source: topic.source,
    })),
    [
      { key: "meeting", state: "unknown", source: "no_saved_record" },
      { key: "venue", state: "unknown", source: "no_saved_record" },
    ],
  );
  assert.deepEqual(
    overview.attentionTopics.map((topic) => ({
      key: topic.topicKey,
      reason: topic.attentionReason,
    })),
    [
      { key: "meeting", reason: "confirm_applicability" },
      { key: "venue", reason: "confirm_applicability" },
    ],
  );
});

test("saved checklist facts produce the same honest progress and topic states", () => {
  const overview = buildAmoraPreparationOverview({
    topics: [
      ...topics,
      {
        key: "pyebaek",
        label: "결혼식 뒤 전통 인사",
        items: [{ id: "pyebaek_01", label: "진행 여부 합의" }],
      },
      {
        key: "dress",
        label: "드레스·예식 정장",
        items: [{ id: "dress_01", label: "분위기 정하기" }],
      },
    ],
    progress: {
      meeting: {
        status: "in_progress",
        checklist: [
          { id: "meeting_01", label: "날짜 조율", done: true },
          { id: "meeting_02", label: "장소 정하기", done: false },
        ],
      },
      venue: {
        status: "completed",
        checklist: [{ id: "venue_01", label: "후보 비교", done: true }],
      },
      pyebaek: {
        status: "not_applicable",
        checklist: [{ id: "pyebaek_01", label: "진행 여부 합의", done: false }],
      },
    },
    attentionTopicKeys: [],
  });

  assert.deepEqual(overview.summary, {
    totalTopics: 4,
    unknownTopics: 1,
    notStartedTopics: 0,
    inProgressTopics: 1,
    completedTopics: 1,
    notApplicableTopics: 1,
    needsReviewTopics: 0,
    completedItems: 2,
    totalItems: 4,
    percent: 50,
  });
  assert.deepEqual(
    overview.topics.map((topic) => [
      topic.topicKey,
      topic.state,
      topic.completedItems,
      topic.totalItems,
    ]),
    [
      ["meeting", "in_progress", 1, 2],
      ["venue", "completed", 1, 1],
      ["pyebaek", "not_applicable", 0, 0],
      ["dress", "unknown", 0, 1],
    ],
  );
});

test("legacy booleans and user-saved checklist items remain part of the overview", () => {
  const overview = buildAmoraPreparationOverview({
    topics: [topics[0]],
    progress: {
      meeting: {
        meeting_01: true,
        meeting_02: false,
        user_added_question: true,
      },
    },
  });

  assert.deepEqual(overview.topics[0], {
    topicKey: "meeting",
    label: "부모님 첫 만남",
    state: "in_progress",
    source: "saved_checklist",
    completedItems: 2,
    totalItems: 3,
    percent: 67,
    attentionReason: "continue_saved_progress",
  });
  assert.equal(overview.summary.percent, 67);
});

test("contradictory or malformed saved data is shown as review-needed", () => {
  const overview = buildAmoraPreparationOverview({
    topics,
    progress: {
      meeting: {
        status: "completed",
        checklist: [
          { id: "meeting_01", done: true },
          { id: "meeting_02", done: false },
        ],
      },
      venue: "completed",
    },
  });

  assert.deepEqual(
    overview.topics.map((topic) => [
      topic.topicKey,
      topic.state,
      topic.attentionReason,
    ]),
    [
      ["meeting", "needs_review", "resolve_conflict"],
      ["venue", "needs_review", "resolve_conflict"],
    ],
  );
  assert.equal(overview.summary.needsReviewTopics, 2);
  assert.deepEqual(
    overview.attentionTopics.map((topic) => topic.topicKey),
    ["meeting", "venue"],
  );
});

test("attention order continues real progress before date heuristics and unknown topics", () => {
  const orderedTopics = [
    { key: "unknown", label: "아직 확인 전", items: [{ id: "u" }] },
    { key: "saved", label: "시작 전", items: [{ id: "s" }] },
    { key: "active", label: "진행 중", items: [{ id: "a" }, { id: "b" }] },
    { key: "review", label: "확인 필요", items: [{ id: "r" }] },
    { key: "done", label: "완료", items: [{ id: "d" }] },
    { key: "skip", label: "해당 없음", items: [{ id: "x" }] },
  ];
  const overview = buildAmoraPreparationOverview({
    topics: orderedTopics,
    progress: {
      saved: { status: "not_started" },
      active: {
        status: "in_progress",
        checklist: [{ id: "a", done: true }, { id: "b", done: false }],
      },
      review: { status: "completed", checklist: [{ id: "r", done: false }] },
      done: { status: "completed", checklist: [{ id: "d", done: true }] },
      skip: { status: "not_applicable" },
    },
    attentionTopicKeys: ["unknown", "done"],
  });

  assert.deepEqual(
    overview.attentionTopics.map((topic) => [topic.topicKey, topic.attentionReason]),
    [
      ["review", "resolve_conflict"],
      ["active", "continue_saved_progress"],
      ["unknown", "basic_check_window"],
    ],
  );
  assert.equal(overview.attentionTopics.some((topic) => topic.topicKey === "done"), false);
  assert.equal(overview.attentionTopics.some((topic) => topic.topicKey === "skip"), false);
});

test("invalid and duplicate topic adapters cannot duplicate the customer map", () => {
  const overview = buildAmoraPreparationOverview({
    topics: [topics[0], { ...topics[0], label: "중복 이름" }, null, { key: "", items: [] }],
    progress: null,
  });

  assert.equal(overview.summary.totalTopics, 1);
  assert.deepEqual(
    overview.topics.map((topic) => [topic.topicKey, topic.label]),
    [["meeting", "부모님 첫 만남"]],
  );
});

test("the customer map carries full-journey coverage without inventing gap topics", () => {
  const overview = buildAmoraPreparationOverview({
    topics: currentChecklistTopics,
    progress: {},
  });

  assert.deepEqual(overview.coverage, {
    version: 1,
    stage: "partial",
    connectedTopicCount: 19,
    journeyAxisCount: 10,
    gapCount: 7,
    issueCount: 0,
  });
  assert.equal(overview.topics.length, 19);
  assert.equal(
    overview.topics.some((topic) => topic.topicKey === "planning_foundation"),
    false,
  );
  assert.equal(
    overview.topics.some((topic) => topic.topicKey === "guest_operations"),
    false,
  );
});
