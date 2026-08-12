import assert from "node:assert/strict";
import test from "node:test";

import {
  applyPlanningChecklistProfile,
  PLANNING_CHECKLIST_PROFILE_KEY,
} from "../../../../packages/shared/src/utils/planningChecklist.ts";

const templates = [{
  key: "special_cases",
  label: "선택 준비",
  items: [
    { id: "health", label: "건강 지원", done: false },
    { id: "reception", label: "피로연", done: false },
    { id: "manual", label: "직접 제외", done: false },
  ],
}];

const guidance = {
  health: { applicabilityTags: ["pregnancy_or_health_support"] },
  reception: { applicabilityTags: ["reception"] },
};

const baseAnswers = {
  ceremony: "undecided",
  legalMarriage: "undecided",
  travel: "undecided",
  housing: "undecided",
  internationalMarriage: null,
  religiousCeremony: null,
  remarriage: null,
  childrenParticipating: null,
  accessibilitySupport: null,
  healthSupport: null,
  petParticipation: null,
  familyTradition: null,
};

function profile(answers, autoExcludedItemIds = []) {
  return {
    version: 1,
    reviewedAt: "2026-08-12T09:00:00.000Z",
    answers: { ...baseAnswers, ...answers },
    autoExcludedItemIds,
  };
}

test("mobile situation profile matches the exact API shape", () => {
  const result = applyPlanningChecklistProfile(
    templates,
    {},
    profile({ healthSupport: false }),
    guidance,
  );
  assert.deepEqual(Object.keys(result.profile).sort(), [
    "answers",
    "autoExcludedItemIds",
    "reviewedAt",
    "version",
  ]);
  assert.deepEqual(Object.keys(result.profile.answers).sort(), Object.keys(baseAnswers).sort());
  assert.equal(result.progressPatch[PLANNING_CHECKLIST_PROFILE_KEY], result.profile);
  assert.deepEqual(result.profile.autoExcludedItemIds, ["health"]);
});

test("changing a situation from false to true restores only its previous auto-exclusion", () => {
  const excluded = applyPlanningChecklistProfile(
    templates,
    {},
    profile({ healthSupport: false }),
    guidance,
  );
  const progress = { ...excluded.progressPatch };
  const restored = applyPlanningChecklistProfile(
    templates,
    progress,
    profile({ healthSupport: true }, excluded.profile.autoExcludedItemIds),
    guidance,
  );
  assert.deepEqual(restored.excludedItemIds, []);
  assert.deepEqual(restored.restoredItemIds, ["health"]);
  assert.equal(
    restored.categoryProgressPatch.special_cases.checklist.find((item) => item.id === "health").state,
    "todo",
  );
});

test("a manual not-applicable choice is preserved when the situation profile changes", () => {
  const progress = {
    special_cases: {
      status: "in_progress",
      checklist: [
        { id: "health", label: "건강 지원", done: false, state: "todo" },
        { id: "reception", label: "피로연", done: false, state: "todo" },
        { id: "manual", label: "직접 제외", done: false, state: "not_applicable" },
      ],
    },
    [PLANNING_CHECKLIST_PROFILE_KEY]: profile({}, []),
  };
  const result = applyPlanningChecklistProfile(
    templates,
    progress,
    profile({ healthSupport: true }, []),
    guidance,
  );
  assert.deepEqual(result.restoredItemIds, []);
  assert.equal(result.categoryProgressPatch.special_cases, undefined);
});

test("ceremony=no never auto-excludes reception-only work", () => {
  const result = applyPlanningChecklistProfile(
    templates,
    {},
    profile({ ceremony: "no" }),
    guidance,
  );
  assert.equal(result.profile.autoExcludedItemIds.includes("reception"), false);
});

test("false to true restores an auto exclusion while preserving a separate manual N/A", () => {
  const initial = applyPlanningChecklistProfile(
    templates,
    {
      special_cases: {
        status: "in_progress",
        checklist: [
          { id: "health", label: "건강 지원", done: false, state: "todo" },
          { id: "reception", label: "피로연", done: false, state: "todo" },
          { id: "manual", label: "직접 제외", done: false, state: "not_applicable" },
        ],
      },
    },
    profile({ healthSupport: false }),
    guidance,
  );
  const restored = applyPlanningChecklistProfile(
    templates,
    { ...initial.progressPatch },
    profile({ healthSupport: true }, initial.profile.autoExcludedItemIds),
    guidance,
  );
  const items = restored.categoryProgressPatch.special_cases.checklist;
  assert.equal(items.find((item) => item.id === "health").state, "todo");
  assert.equal(items.find((item) => item.id === "manual").state, "not_applicable");
});

test("a profile never claims an already-manual N/A as its own auto exclusion", () => {
  const progress = {
    special_cases: {
      status: "not_applicable",
      checklist: [
        { id: "health", label: "건강 지원", done: false, state: "not_applicable" },
        { id: "reception", label: "피로연", done: false, state: "todo" },
        { id: "manual", label: "직접 제외", done: false, state: "todo" },
      ],
    },
  };
  const reviewed = applyPlanningChecklistProfile(
    templates,
    progress,
    profile({ healthSupport: false }),
    guidance,
  );
  assert.equal(reviewed.profile.autoExcludedItemIds.includes("health"), false);

  const changed = applyPlanningChecklistProfile(
    templates,
    { ...progress, [PLANNING_CHECKLIST_PROFILE_KEY]: reviewed.profile },
    profile({ healthSupport: true }, reviewed.profile.autoExcludedItemIds),
    guidance,
  );
  assert.deepEqual(changed.restoredItemIds, []);
  assert.equal(changed.categoryProgressPatch.special_cases, undefined);
});

test("a manually excluded category stays excluded across situation changes", () => {
  const progress = {
    special_cases: {
      status: "not_applicable",
      checklist: templates[0].items,
    },
  };
  const excluded = applyPlanningChecklistProfile(
    templates,
    progress,
    profile({ healthSupport: false }),
    guidance,
  );
  assert.equal(excluded.categoryProgressPatch.special_cases.status, "not_applicable");

  const restored = applyPlanningChecklistProfile(
    templates,
    { ...progress, ...excluded.progressPatch },
    profile({ healthSupport: true }, excluded.profile.autoExcludedItemIds),
    guidance,
  );
  assert.equal(restored.categoryProgressPatch.special_cases.status, "not_applicable");
});

test("an explicit situation answer materializes review evidence for its category", () => {
  const reviewableTemplates = [{
    ...templates[0],
    items: [templates[0].items[0]],
  }];
  const reviewed = applyPlanningChecklistProfile(
    reviewableTemplates,
    {},
    profile({ healthSupport: true }),
    guidance,
  );
  assert.equal(reviewed.categoryProgressPatch.special_cases.checklist.length, 1);
  assert.equal(
    reviewed.categoryProgressPatch.special_cases.checklistReviewedAt,
    "2026-08-12T09:00:00.000Z",
  );
  assert.equal(
    reviewed.categoryProgressPatch.special_cases.checklistReviewSource,
    "situation_profile",
  );
});
