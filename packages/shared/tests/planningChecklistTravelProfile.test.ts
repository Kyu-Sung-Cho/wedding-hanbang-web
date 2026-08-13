import assert from "node:assert/strict";
import test from "node:test";

import { CHECKLIST_ITEM_GUIDANCE } from "../src/constants/checklistItemGuidance";
import { CATEGORY_CHECKLISTS } from "../src/constants/weddingPlanning";
import {
  applyPlanningChecklistProfile,
  DEFAULT_PLANNING_CHECKLIST_PROFILE_ANSWERS,
  PLANNING_CHECKLIST_PROFILE_KEY,
  type PlanningChecklistProfile,
} from "../src/utils/planningChecklist";

const REVIEWED_AT = "2026-08-13T00:00:00.000Z";
const HONEYMOON_TEMPLATE = CATEGORY_CHECKLISTS
  .find((category) => category.key === "honeymoon")!;
const HONEYMOON_ITEM_IDS = HONEYMOON_TEMPLATE.items.map((item) => item.id);

function applyTravelProfile(travel: PlanningChecklistProfile["answers"]["travel"]) {
  return applyPlanningChecklistProfile(
    CATEGORY_CHECKLISTS,
    {},
    {
      version: 2,
      reviewedAt: REVIEWED_AT,
      answers: {
        ...DEFAULT_PLANNING_CHECKLIST_PROFILE_ANSWERS,
        travel,
      },
      autoExcludedItemIds: [],
    },
    CHECKLIST_ITEM_GUIDANCE,
    "profile-1",
  );
}

test("travel=none excludes every honeymoon travel execution item", () => {
  const application = applyTravelProfile("none");
  const excludedHoneymoonIds = application.excludedItemIds.filter((itemId) =>
    itemId.startsWith("honeymoon_"),
  );

  assert.deepEqual(excludedHoneymoonIds, HONEYMOON_ITEM_IDS);
  assert.equal(application.categoryProgressPatch.honeymoon.status, "not_applicable");
});

test("travel=domestic keeps the domestic honeymoon execution path", () => {
  const application = applyTravelProfile("domestic");
  const expectedItemIds = [
    "honeymoon_01",
    "honeymoon_02",
    "honeymoon_03",
    "honeymoon_04",
    "honeymoon_05",
    "honeymoon_07",
  ];
  const expectedItemStates = application.categoryProgressPatch.honeymoon.checklist!
    .filter((item) => expectedItemIds.includes(item.id))
    .map((item) => [item.id, item.state]);

  assert.deepEqual(
    expectedItemStates,
    expectedItemIds.map((itemId) => [itemId, "todo"]),
  );
});

test("travel=domestic excludes overseas-only honeymoon work", () => {
  const application = applyTravelProfile("domestic");
  const overseasOnlyStates = application.categoryProgressPatch.honeymoon.checklist!
    .filter((item) => ["honeymoon_06", "honeymoon_08"].includes(item.id))
    .map((item) => [item.id, item.state]);

  assert.deepEqual(overseasOnlyStates, [
    ["honeymoon_06", "not_applicable"],
    ["honeymoon_08", "not_applicable"],
  ]);
});

test("travel=domestic offers transport that is not limited to flights", () => {
  const application = applyTravelProfile("domestic");
  const transportItem = application.categoryProgressPatch.honeymoon.checklist!
    .find((item) => item.id === "honeymoon_03");

  assert.match(transportItem!.label, /항공·철도/);
});

test("domestic transport guidance does not assume a passport or visa", () => {
  assert.doesNotMatch(CHECKLIST_ITEM_GUIDANCE.honeymoon_03.tip, /여권|비자/);
});

test("domestic travel work does not cite an overseas-only source as its general basis", () => {
  for (const itemId of ["honeymoon_03", "honeymoon_05"] as const) {
    assert.doesNotMatch(
      (CHECKLIST_ITEM_GUIDANCE[itemId].sourceRefs ?? []).map((source) => source.url).join(" "),
      /0404\.go\.kr/,
    );
  }
});

test("travel=international keeps every honeymoon travel execution item", () => {
  const application = applyTravelProfile("international");
  const applicableItemIds = application.categoryProgressPatch.honeymoon.checklist!
    .filter((item) => item.state !== "not_applicable")
    .map((item) => item.id);

  assert.deepEqual(applicableItemIds, HONEYMOON_ITEM_IDS);
});

test("new domestic semantics preserve saved work while restoring prior auto-exclusions", () => {
  const previousAutoExcludedItemIds = [
    "honeymoon_03",
    "honeymoon_04",
    "honeymoon_05",
    "honeymoon_06",
  ];
  const previousProfile: PlanningChecklistProfile = {
    version: 2,
    reviewedAt: "2026-08-12T00:00:00.000Z",
    answers: {
      ...DEFAULT_PLANNING_CHECKLIST_PROFILE_ANSWERS,
      travel: "domestic",
    },
    autoExcludedItemIds: previousAutoExcludedItemIds,
  };
  const savedChecklist = HONEYMOON_TEMPLATE.items.map((item) => ({
    ...item,
    ...(previousAutoExcludedItemIds.includes(item.id)
      ? { state: "not_applicable" as const }
      : { state: "todo" as const }),
    ...(item.id === "honeymoon_03"
      ? {
          label: "항공권 예약",
          assignee: { kind: "couple" as const },
          dueDate: "2026-09-10",
          note: "교통편 비교표 확인",
        }
      : {}),
  }));
  const application = applyPlanningChecklistProfile(
    CATEGORY_CHECKLISTS,
    {
      [PLANNING_CHECKLIST_PROFILE_KEY]: previousProfile,
      honeymoon: {
        category: "honeymoon",
        status: "not_started",
        checklist: savedChecklist,
      },
    },
    {
      ...previousProfile,
      reviewedAt: REVIEWED_AT,
      autoExcludedItemIds: [],
    },
    CHECKLIST_ITEM_GUIDANCE,
    "profile-1",
  );
  const transportItem = application.categoryProgressPatch.honeymoon.checklist!
    .find((item) => item.id === "honeymoon_03");

  assert.deepEqual(
    {
      restoredItemIds: application.restoredItemIds,
      autoExcludedHoneymoonIds: application.profile.autoExcludedItemIds.filter((itemId) =>
        itemId.startsWith("honeymoon_"),
      ),
      transportItem,
    },
    {
      restoredItemIds: ["honeymoon_03", "honeymoon_04", "honeymoon_05"],
      autoExcludedHoneymoonIds: ["honeymoon_06", "honeymoon_08"],
      transportItem: {
        id: "honeymoon_03",
        label: "교통편 예약 (항공·철도 등)",
        done: false,
        state: "todo",
        assignee: { kind: "couple" },
        dueDate: "2026-09-10",
        note: "교통편 비교표 확인",
      },
    },
  );
});
