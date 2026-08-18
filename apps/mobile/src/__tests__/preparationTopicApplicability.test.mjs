import assert from "node:assert/strict";
import test from "node:test";

import { buildAmoraPreparationOverview } from "@hanbang/shared/amora-preparation-map";

import {
  buildPreparationTopicApplicabilityControl,
  buildPreparationTopicApplicabilityMutation,
  classifyPreparationTopicApplicabilityFailure,
} from "../lib/preparationTopicApplicability.mjs";

const COUPLE_ID = "10000000-0000-4000-8000-000000000001";
const topics = [
  {
    key: "venue",
    label: "결혼식장",
    items: [
      { id: "venue_01", label: "원하는 예식 조건 정하기", done: false },
      { id: "venue_02", label: "후보 식장 비교하기", done: false },
    ],
  },
  {
    key: "pyebaek",
    label: "결혼식 뒤 전통 인사",
    items: [
      { id: "pyebaek_01", label: "진행 여부 정하기", done: false },
    ],
  },
];

test("일부 준비한 주제를 제외했다가 다시 포함해도 체크 기록과 전체 진행률이 정확히 복구된다", () => {
  const initialProgress = {
    venue: {
      category: "venue",
      status: "in_progress",
      checklist: [
        { id: "venue_01", label: "원하는 예식 조건 정하기", done: true },
        { id: "venue_02", label: "후보 식장 비교하기", done: false },
      ],
    },
    pyebaek: {
      category: "pyebaek",
      status: "not_started",
      checklist: [
        { id: "pyebaek_01", label: "진행 여부 정하기", done: false },
      ],
    },
  };

  const exclusion = buildPreparationTopicApplicabilityMutation({
    expectedCoupleId: COUPLE_ID,
    expectedRevision: 12,
    intent: "exclude",
    topic: topics[0],
    savedTopic: initialProgress.venue,
  });
  assert.ok(exclusion);
  assert.equal(exclusion.body.progress_patch.venue.status, "not_applicable");
  assert.deepEqual(
    exclusion.body.progress_patch.venue.checklist,
    initialProgress.venue.checklist,
  );

  const excludedProgress = {
    ...initialProgress,
    ...exclusion.body.progress_patch,
  };
  const excludedOverview = buildAmoraPreparationOverview({
    topics,
    progress: excludedProgress,
  });
  assert.equal(excludedOverview.topics[0].state, "not_applicable");
  assert.deepEqual(excludedOverview.summary, {
    totalTopics: 2,
    unknownTopics: 0,
    notStartedTopics: 1,
    inProgressTopics: 0,
    completedTopics: 0,
    notApplicableTopics: 1,
    needsReviewTopics: 0,
    completedItems: 0,
    totalItems: 1,
    percent: 0,
  });

  const inclusion = buildPreparationTopicApplicabilityMutation({
    expectedCoupleId: COUPLE_ID,
    expectedRevision: 13,
    intent: "reinclude",
    topic: topics[0],
    savedTopic: exclusion.body.progress_patch.venue,
  });
  assert.ok(inclusion);
  assert.equal(inclusion.body.progress_patch.venue.status, "in_progress");
  assert.deepEqual(
    inclusion.body.progress_patch.venue.checklist,
    initialProgress.venue.checklist,
  );

  const restoredProgress = {
    ...excludedProgress,
    ...inclusion.body.progress_patch,
  };
  const restoredOverview = buildAmoraPreparationOverview({
    topics,
    progress: restoredProgress,
  });
  assert.equal(restoredOverview.topics[0].state, "in_progress");
  assert.deepEqual(restoredOverview.summary, {
    totalTopics: 2,
    unknownTopics: 0,
    notStartedTopics: 1,
    inProgressTopics: 1,
    completedTopics: 0,
    notApplicableTopics: 0,
    needsReviewTopics: 0,
    completedItems: 1,
    totalItems: 3,
    percent: 33,
  });
});

test("해당 없음과 다시 포함은 공유 범위·진행률·남는 기록을 확인한 뒤에만 실행한다", () => {
  const exclusion = buildPreparationTopicApplicabilityControl({
    version: 1,
    topicKey: "venue",
    label: "결혼식장",
    applicability: "applicable",
    status: "in_progress",
    actionReadState: "loaded",
    linkedScheduleIds: ["schedule-1"],
    linkedActionIds: ["action-1"],
  });
  assert.deepEqual(exclusion, {
    version: 1,
    intent: "exclude",
    label: "이 준비는 하지 않아요",
    description: "진행률과 마감 알림에서 제외해요. 체크 기록과 연결된 기록 2개는 지워지지 않아요.",
    confirmTitle: "공유 준비 목록에서 제외할까요?",
    confirmMessage: "진행률과 마감 알림에서 빠져요. 이전 체크 기록과 연결된 일정·행동은 지워지지 않으며, 언제든 다시 포함할 수 있어요.",
    confirmActionLabel: "준비에서 제외",
    accessibilityLabel: "결혼식장 준비 목록에서 제외하기",
    disabledReason: null,
  });

  const reinclusion = buildPreparationTopicApplicabilityControl({
    version: 1,
    topicKey: "venue",
    label: "결혼식장",
    applicability: "not_applicable",
    status: "decision_needed",
    actionReadState: "loaded",
    linkedScheduleIds: ["schedule-1"],
    linkedActionIds: [],
  });
  assert.deepEqual(reinclusion, {
    version: 1,
    intent: "reinclude",
    label: "다시 준비에 포함",
    description: "이전 체크 기록이 진행률에 다시 반영돼요. 연결된 기록 1개는 그대로예요.",
    confirmTitle: "공유 준비 목록에 다시 포함할까요?",
    confirmMessage: "이전 체크 기록이 진행률에 다시 반영돼요. 연결된 일정·행동은 그대로 유지돼요.",
    confirmActionLabel: "다시 포함",
    accessibilityLabel: "결혼식장 다시 준비 목록에 넣기",
    disabledReason: null,
  });

  for (const copy of [
    exclusion.description,
    exclusion.confirmTitle,
    exclusion.confirmMessage,
    reinclusion.description,
    reinclusion.confirmTitle,
    reinclusion.confirmMessage,
  ]) {
    assert.doesNotMatch(copy, /우리 둘|두 사람이 확인|커플 합의/);
  }
});

test("저장 실패는 대기 중 요청과 최신 상태 변경을 서로 다른 복구 안내로 분류한다", () => {
  assert.equal(
    classifyPreparationTopicApplicabilityFailure(409, {
      code: "PLAN_CHANGE_ACTIVE_REQUEST",
    }),
    "active_request",
  );
  assert.equal(
    classifyPreparationTopicApplicabilityFailure(409, {
      code: "PLAN_CHANGE_STALE",
    }),
    "stale",
  );
  assert.equal(
    classifyPreparationTopicApplicabilityFailure(409, {
      code: "UNKNOWN_CONFLICT",
    }),
    "failed",
  );
  assert.equal(classifyPreparationTopicApplicabilityFailure(503, null), "failed");
});

test("불완전하거나 다른 주제의 기록은 덮어쓰지 않고 조작 버튼도 숨긴다", () => {
  const template = topics[0];
  const base = {
    expectedCoupleId: COUPLE_ID,
    expectedRevision: 15,
    intent: "exclude",
    topic: template,
  };

  assert.equal(buildPreparationTopicApplicabilityMutation({
    ...base,
    savedTopic: { category: "meeting", status: "not_started" },
  }), null);
  assert.equal(buildPreparationTopicApplicabilityMutation({
    ...base,
    savedTopic: { category: "venue", status: "invented" },
  }), null);
  assert.equal(buildPreparationTopicApplicabilityMutation({
    ...base,
    savedTopic: {
      category: "venue",
      status: "in_progress",
      checklist: [
        { id: "venue_01", label: "원하는 예식 조건 정하기", done: true },
        { id: "venue_01", label: "원하는 예식 조건 정하기", done: false },
      ],
    },
  }), null);
  assert.equal(buildPreparationTopicApplicabilityMutation({
    ...base,
    savedTopic: { category: "venue", status: "not_applicable" },
  }), null);
  assert.equal(buildPreparationTopicApplicabilityMutation({
    ...base,
    intent: "reinclude",
    savedTopic: { category: "venue", status: "not_started" },
  }), null);

  const visibleView = {
    version: 1,
    topicKey: "venue",
    label: "결혼식장",
    applicability: "applicable",
    status: "in_progress",
    actionReadState: "loaded",
    linkedScheduleIds: [],
    linkedActionIds: [],
  };
  assert.equal(buildPreparationTopicApplicabilityControl({
    ...visibleView,
    actionReadState: "unavailable",
  }), null);
  assert.equal(buildPreparationTopicApplicabilityControl({
    ...visibleView,
    status: "decision_needed",
  }), null);
  assert.equal(buildPreparationTopicApplicabilityControl({
    ...visibleView,
    linkedScheduleIds: ["same-id"],
    linkedActionIds: ["same-id"],
  }), null);
});
