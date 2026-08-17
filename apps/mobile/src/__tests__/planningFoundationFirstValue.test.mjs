import assert from "node:assert/strict";
import test from "node:test";

import {
  resolvePlanningFoundationFirstValue,
} from "@hanbang/shared/amora-planning-foundation";

function overview(overrides = {}) {
  return {
    version: 1,
    coverage: {
      version: 1,
      stage: "partial",
      connectedTopicCount: 19,
      journeyAxisCount: 10,
      gapCount: 7,
      issueCount: 0,
    },
    summary: {
      totalTopics: 19,
      unknownTopics: 19,
      notStartedTopics: 0,
      inProgressTopics: 0,
      completedTopics: 0,
      notApplicableTopics: 0,
      needsReviewTopics: 0,
      completedItems: 0,
      totalItems: 95,
      percent: 0,
    },
    topics: [],
    attentionTopics: [],
    ...overrides,
  };
}

test("an empty solo journey asks one useful question without requiring role, partner, date, or budget", () => {
  const result = resolvePlanningFoundationFirstValue({
    preparationOverview: overview(),
    selfReportedStage: null,
  });

  assert.deepEqual(result, {
    kind: "question",
    questionKey: "preparation_stage",
    title: "지금 결혼 준비는 어디쯤인가요?",
    description: "정확하지 않아도 괜찮아요. 지금 상태에 가까운 하나만 골라주세요.",
    options: [
      { value: "starting", label: "이제 시작해요" },
      { value: "already_preparing", label: "이미 준비 중이에요" },
      { value: "unknown", label: "아직 잘 모르겠어요" },
    ],
    secondaryAction: { value: "later", label: "나중에 답할게요" },
    usedSources: [],
  });
  assert.equal(JSON.stringify(result).includes("role"), false);
  assert.equal(JSON.stringify(result).includes("partner"), false);
  assert.equal(JSON.stringify(result).includes("budget"), false);
  assert.equal(JSON.stringify(result).includes("weddingDate"), false);
});

test("a starting answer reaches an unknown-safe first action instead of another mandatory question", () => {
  assert.deepEqual(resolvePlanningFoundationFirstValue({
    preparationOverview: overview(),
    selfReportedStage: "starting",
  }), {
    kind: "action",
    actionKey: "establish_preparation_baseline",
    topicKey: "planning_foundation",
    title: "정한 것과 아직 모르는 것 하나씩 나누기",
    reason: "처음에는 답을 다 정하는 것보다 현재 상태를 구분해야 다음 안내가 내 상황에 맞아져요.",
    completionCriterion:
      "정한 것과 아직 모르는 것을 하나씩 표시하거나, 모두 아직 모름으로 남기면 끝나요.",
    usedSources: [
      { kind: "self_report", key: "preparation_stage", label: "이제 시작해요" },
    ],
    unknownSafe: true,
  });
});

test("an already-preparing answer changes the action but never guesses completed work", () => {
  const result = resolvePlanningFoundationFirstValue({
    preparationOverview: overview(),
    selfReportedStage: "already_preparing",
  });

  assert.deepEqual(result, {
    kind: "action",
    actionKey: "reconstruct_existing_preparation",
    topicKey: "planning_foundation",
    title: "이미 준비한 것 최대 세 가지 확인하기",
    reason: "기존 기록을 다시 다 입력하지 않고, 확실한 것부터 확인해야 중복 질문을 줄일 수 있어요.",
    completionCriterion:
      "확실한 항목만 최대 세 가지 고르고, 나머지는 확인 전으로 남기면 끝나요.",
    usedSources: [
      { kind: "self_report", key: "preparation_stage", label: "이미 준비 중이에요" },
    ],
    unknownSafe: true,
  });
  assert.doesNotMatch(JSON.stringify(result), /완료했어요|완료됨|확정/u);
});

test("unknown and later remain successful no-write paths", () => {
  const unknown = resolvePlanningFoundationFirstValue({
    preparationOverview: overview(),
    selfReportedStage: "unknown",
  });
  const later = resolvePlanningFoundationFirstValue({
    preparationOverview: overview(),
    selfReportedStage: "later",
  });

  assert.equal(unknown.kind, "action");
  assert.equal(unknown.actionKey, "establish_preparation_baseline");
  assert.equal(unknown.unknownSafe, true);
  assert.deepEqual(later, {
    kind: "deferred",
    title: "지금은 답하지 않아도 괜찮아요",
    description: "입력한 내용을 준비 기록으로 확정하지 않았어요. 아모라에서 언제든 다시 이어갈 수 있어요.",
    resumeKey: "preparation_stage",
    usedSources: [],
  });
});

test("saved in-progress evidence skips the generic question and continues that exact topic", () => {
  const activeTopic = {
    topicKey: "venue",
    label: "결혼식장",
    state: "in_progress",
    source: "saved_checklist",
    completedItems: 1,
    totalItems: 8,
    percent: 13,
    attentionReason: "continue_saved_progress",
  };
  const result = resolvePlanningFoundationFirstValue({
    preparationOverview: overview({
      summary: {
        ...overview().summary,
        unknownTopics: 18,
        inProgressTopics: 1,
        completedItems: 1,
      },
      topics: [activeTopic],
      attentionTopics: [activeTopic],
    }),
    selfReportedStage: null,
  });

  assert.deepEqual(result, {
    kind: "action",
    actionKey: "continue_saved_topic",
    topicKey: "venue",
    title: "결혼식장 준비 이어보기",
    reason: "저장된 진행 중 기록이 있어 처음부터 다시 묻지 않아요.",
    completionCriterion: "현재 남은 항목 하나를 확인하거나, 지금은 해당 없다고 표시하면 끝나요.",
    usedSources: [
      { kind: "canonical_progress", key: "venue", label: "결혼식장 · 진행 중" },
    ],
    unknownSafe: false,
  });
});

test("a conflicted saved topic produces a recovery action instead of a confident recommendation", () => {
  const conflictedTopic = {
    topicKey: "meeting",
    label: "부모님 첫 만남",
    state: "needs_review",
    source: "saved_checklist",
    completedItems: 0,
    totalItems: 6,
    percent: 0,
    attentionReason: "resolve_conflict",
  };

  assert.deepEqual(resolvePlanningFoundationFirstValue({
    preparationOverview: overview({
      summary: { ...overview().summary, unknownTopics: 18, needsReviewTopics: 1 },
      topics: [conflictedTopic],
      attentionTopics: [conflictedTopic],
    }),
    selfReportedStage: "starting",
  }), {
    kind: "recovery",
    recoveryKey: "review_saved_topic",
    topicKey: "meeting",
    title: "부모님 첫 만남 기록 다시 확인하기",
    description: "저장된 상태와 체크 내용이 맞지 않아 새 행동을 추천하기 전에 확인이 필요해요.",
    usedSources: [
      { kind: "canonical_progress", key: "meeting", label: "부모님 첫 만남 · 확인 필요" },
    ],
  });
});

test("malformed or partial critical state fails closed instead of looking empty", () => {
  assert.deepEqual(resolvePlanningFoundationFirstValue({
    preparationOverview: { ...overview(), coverage: { ...overview().coverage, stage: "invalid" } },
    selfReportedStage: null,
  }), {
    kind: "unavailable",
    title: "준비 상태를 다시 확인할게요",
    description: "일부 기록을 안전하게 확인하지 못해 지금은 새 행동을 추천하지 않았어요.",
    retryable: true,
    usedSources: [],
  });
  assert.deepEqual(resolvePlanningFoundationFirstValue({
    preparationOverview: overview(),
    selfReportedStage: null,
    readState: "partial",
  }), {
    kind: "unavailable",
    title: "준비 상태를 다시 확인할게요",
    description: "일부 기록을 안전하게 확인하지 못해 지금은 새 행동을 추천하지 않았어요.",
    retryable: true,
    usedSources: [],
  });
});
