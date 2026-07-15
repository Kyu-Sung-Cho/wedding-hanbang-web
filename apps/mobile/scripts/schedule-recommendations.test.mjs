import assert from "node:assert/strict";
import test from "node:test";

import {
  getStartedScheduleActions,
  partitionScheduleCategories,
} from "../src/lib/scheduleRecommendations.ts";

const categories = [
  {
    key: "venue",
    label: "예식장",
    items: [
      { id: "venue_01", label: "조건 정하기", done: false },
      { id: "venue_02", label: "직접 확인하기", done: false },
    ],
  },
  {
    key: "studio",
    label: "스튜디오",
    items: [{ id: "studio_01", label: "진행 여부 정하기", done: false }],
  },
];

test("untouched templates never become schedule recommendations", () => {
  const progress = {
    venue: { status: "not_started" },
    studio: { status: "not_started" },
  };

  assert.deepEqual(getStartedScheduleActions(categories, progress), []);
});

test("only an explicitly started category is recommended", () => {
  const progress = {
    venue: { status: "in_progress" },
    studio: { status: "not_started" },
  };

  assert.deepEqual(getStartedScheduleActions(categories, progress), [
    {
      categoryKey: "venue",
      categoryLabel: "예식장",
      nextItemLabel: "조건 정하기",
      percent: 0,
    },
  ]);
});

test("untouched categories stay in an optional reference collection", () => {
  const progress = {
    venue: {
      status: "in_progress",
      checklist: [{ id: "venue_01", done: true }],
    },
    studio: { status: "not_started" },
  };

  const result = partitionScheduleCategories(categories, progress);

  assert.deepEqual(result.started.map((category) => category.key), ["venue"]);
  assert.deepEqual(result.optional.map((category) => category.key), ["studio"]);
});
