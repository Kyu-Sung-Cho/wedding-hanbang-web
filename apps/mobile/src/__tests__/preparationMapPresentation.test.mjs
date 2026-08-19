import assert from "node:assert/strict";
import test from "node:test";

import { buildAmoraPreparationOverview } from "@hanbang/shared/amora-preparation-map";
import {
  buildPreparationHomeSectionModel,
  buildPreparationHomeStatusModel,
  buildPreparationJourneyMapModel,
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

const journeyTopics = [
  "meeting", "venue",
  "studio", "dress", "makeup", "ring",
  "hanbok", "yedan", "honeymoon", "houseware", "housing",
  "invitation", "snap", "shoes", "bouquet", "gift", "mc", "ham", "pyebaek",
].map((key) => ({
  key,
  label: `주제 ${key}`,
  items: key === "meeting"
    ? [{ id: "meeting_01" }, { id: "meeting_02" }]
    : [{ id: `${key}_01` }],
}));

test("the journey map groups every saved topic once and pins only canonical attention topics", () => {
  const overview = buildAmoraPreparationOverview({
    topics: journeyTopics,
    progress: {
      meeting: {
        status: "in_progress",
        checklist: [
          { id: "meeting_01", done: true },
          { id: "meeting_02", done: false },
        ],
      },
      studio: {
        status: "completed",
        checklist: [{ id: "studio_01", done: true }],
      },
      honeymoon: { status: "not_applicable" },
      invitation: {
        status: "completed",
        checklist: [{ id: "invitation_01", done: false }],
      },
    },
    attentionTopicKeys: ["venue"],
  });

  const model = buildPreparationJourneyMapModel(overview);

  assert.equal(model.description, "저장한 기록에서 이번에 볼 준비를 모았어요.");
  assert.equal(model.boundaryLabel, "저장한 준비 기록 기준");
  assert.equal(
    model.coverageNotice,
    "현재 체크리스트에 연결된 준비만 보여요. 예식 당일과 결혼 후처럼 아직 연결되지 않은 준비는 포함되지 않아요.",
  );
  assert.deepEqual(model.viewOptions, [
    { key: "map", label: "지도" },
    { key: "details", label: "상세 목록" },
  ]);
  assert.deepEqual(
    model.chapters.map((chapter) => ({
      key: chapter.key,
      topicKeys: chapter.nodes.map((node) => node.topicKey),
    })),
    [
      { key: "agreements", topicKeys: ["meeting", "venue"] },
      { key: "vendors", topicKeys: ["studio", "dress", "makeup", "ring"] },
      { key: "life_and_family", topicKeys: ["hanbok", "yedan", "honeymoon", "houseware", "housing"] },
      { key: "ceremony_details", topicKeys: ["invitation", "snap", "shoes", "bouquet", "gift", "mc", "ham", "pyebaek"] },
    ],
  );
  assert.deepEqual(
    model.focus.nodes.map((node) => ({
      topicKey: node.topicKey,
      focusReasonLabel: node.focusReasonLabel,
    })),
    [
      {
        topicKey: "invitation",
        focusReasonLabel: "저장된 상태가 서로 달라 한 번 확인이 필요해요.",
      },
      {
        topicKey: "meeting",
        focusReasonLabel: "저장한 진행 상태부터 이어서 볼게요.",
      },
      {
        topicKey: "venue",
        focusReasonLabel: "결혼식 날짜 기준의 기본 확인 시점이 가까워요.",
      },
    ],
  );
  assert.equal(model.focus.title, "이번에 볼 준비");
  assert.deepEqual(
    model.chapters.flatMap((chapter) => chapter.nodes)
      .filter((node) => node.isFocus)
      .map((node) => node.topicKey),
    ["meeting", "venue", "invitation"],
  );
  assert.equal(model.chapters[0].nodes[0].stateLabel, "준비 중");
  assert.equal(model.chapters[1].nodes[0].stateLabel, "완료");
  assert.equal(model.chapters[2].nodes[2].stateLabel, "해당 없음");
  assert.equal(model.chapters[3].nodes[0].stateLabel, "확인 필요");
  assert.doesNotMatch(JSON.stringify(model), /percent|progressbar|전체 진행률/u);
});

test("the journey map withholds a focus whose reason cannot be proven", () => {
  const overview = buildAmoraPreparationOverview({
    topics: journeyTopics,
    progress: {},
    attentionTopicKeys: ["venue"],
  });
  const malformed = {
    ...overview,
    attentionTopics: overview.attentionTopics.map((topic, index) => (
      index === 0 ? { ...topic, attentionReason: null } : topic
    )),
  };

  assert.equal(buildPreparationJourneyMapModel(malformed), null);
});

test("a customer without a wedding date never receives a date-window explanation", () => {
  const overview = buildAmoraPreparationOverview({
    topics: journeyTopics,
    progress: {},
    attentionTopicKeys: [],
  });
  const model = buildPreparationJourneyMapModel(overview);

  assert.ok(model);
  assert.equal(
    model.focus.nodes.some((node) => node.focusReasonLabel.includes("날짜 기준")),
    false,
  );
});

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
