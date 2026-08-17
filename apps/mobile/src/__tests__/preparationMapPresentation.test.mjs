import assert from "node:assert/strict";
import test from "node:test";

import { buildAmoraPreparationOverview } from "@hanbang/shared/amora-preparation-map";
import {
  buildPreparationHomeSectionModel,
  buildPreparationHomeStatusModel,
} from "../lib/preparationMapPresentation.mjs";

const topics = [
  {
    key: "meeting",
    label: "부모님 첫 만남",
    items: [{ id: "meeting_01" }, { id: "meeting_02" }],
  },
  {
    key: "venue",
    label: "결혼식장",
    items: [{ id: "venue_01" }],
  },
];

test("home explains a personal preparation snapshot and deep-links each exact topic", () => {
  const overview = buildAmoraPreparationOverview({
    topics,
    progress: {
      meeting: {
        status: "in_progress",
        checklist: [
          { id: "meeting_01", done: true },
          { id: "meeting_02", done: false },
        ],
      },
    },
    attentionTopicKeys: ["venue"],
  });

  const model = buildPreparationHomeSectionModel(overview);

  assert.equal(model.eyebrow, "MY PREPARATION");
  assert.equal(model.title, "내 결혼 준비");
  assert.match(model.description, /직접 저장한 준비 기록/);
  assert.deepEqual(model.summaryItems, [
    { key: "in_progress", label: "진행 중", count: 1, tone: "active" },
    { key: "unknown", label: "확인 전", count: 1, tone: "neutral" },
  ]);
  assert.deepEqual(model.rows, [
    {
      topicKey: "meeting",
      title: "부모님 첫 만남",
      statusLabel: "1/2 완료",
      reasonLabel: "저장한 진행 상태부터 이어서 볼게요.",
      tone: "active",
      route: { pathname: "/checklist", params: { category: "meeting" } },
    },
    {
      topicKey: "venue",
      title: "결혼식장",
      statusLabel: "아직 확인 전",
      reasonLabel: "결혼식 날짜 기준의 기본 확인 시점이 가까워요.",
      tone: "warning",
      route: { pathname: "/checklist", params: { category: "venue" } },
    },
  ]);
  assert.deepEqual(model.allTopicsAction, {
    label: "전체 준비 보기",
    route: "/checklist",
  });
});

test("a first-time customer sees a calm starting point rather than fabricated status", () => {
  const overview = buildAmoraPreparationOverview({ topics, progress: {} });
  const model = buildPreparationHomeSectionModel(overview);

  assert.match(model.description, /아직 확인한 준비가 없어요/);
  assert.deepEqual(model.summaryItems, [
    { key: "unknown", label: "확인 전", count: 2, tone: "neutral" },
  ]);
  assert.equal(model.rows[0].statusLabel, "아직 확인 전");
  assert.equal(model.rows[0].reasonLabel, "필요한 준비인지부터 하나씩 확인해요.");
});

test("a fully reviewed map explains the calm state instead of rendering an empty list", () => {
  const overview = buildAmoraPreparationOverview({
    topics,
    progress: {
      meeting: {
        status: "completed",
        checklist: [
          { id: "meeting_01", done: true },
          { id: "meeting_02", done: true },
        ],
      },
      venue: { status: "not_applicable" },
    },
  });
  const model = buildPreparationHomeSectionModel(overview);

  assert.deepEqual(model.rows, []);
  assert.equal(
    model.emptyMessage,
    "현재 확인한 준비는 모두 정리됐어요. 전체 목록에서 다음 준비를 살펴볼 수 있어요.",
  );
});

test("home replaces checklist completion with four truthful preparation states", () => {
  const statusTopics = [
    { key: "meeting", label: "부모님 첫 만남", items: [{ id: "meeting_01" }, { id: "meeting_02" }] },
    { key: "venue", label: "결혼식장", items: [{ id: "venue_01" }] },
    { key: "studio", label: "스튜디오", items: [{ id: "studio_01" }] },
    { key: "dress", label: "드레스", items: [{ id: "dress_01" }] },
    { key: "makeup", label: "메이크업", items: [{ id: "makeup_01" }] },
    { key: "mc", label: "사회자", items: [{ id: "mc_01" }] },
  ];
  const overview = buildAmoraPreparationOverview({
    topics: statusTopics,
    progress: {
      meeting: {
        status: "in_progress",
        checklist: [
          { id: "meeting_01", done: true },
          { id: "meeting_02", done: false },
        ],
      },
      venue: {
        status: "not_started",
        checklist: [{ id: "venue_01", done: false }],
      },
      studio: {
        status: "completed",
        checklist: [{ id: "studio_01", done: true }],
      },
      dress: {
        status: "not_started",
        checklist: [{ id: "dress_01", done: true }],
      },
      mc: { status: "not_applicable" },
    },
  });

  const model = buildPreparationHomeStatusModel(overview);

  assert.deepEqual(model, {
    label: "준비 상태",
    boundaryLabel: "저장한 준비 기록 기준",
    items: [
      { key: "in_progress", label: "진행 중", count: 1, tone: "active" },
      { key: "needs_attention", label: "확인 필요", count: 2, tone: "warning" },
      { key: "unknown", label: "아직 모름", count: 1, tone: "neutral" },
      { key: "completed", label: "완료", count: 1, tone: "success" },
    ],
  });
  assert.equal("percent" in model, false);
});

test("home withholds a status summary whose counts cannot reconcile", () => {
  const overview = buildAmoraPreparationOverview({ topics, progress: {} });
  const malformed = {
    ...overview,
    summary: { ...overview.summary, unknownTopics: 1 },
  };

  assert.equal(buildPreparationHomeStatusModel(malformed), null);
});
