import assert from "node:assert/strict";
import test from "node:test";

import { CATEGORY_CHECKLISTS } from "../src/constants/weddingPlanning";
import {
  hasChecklistReviewEvidence,
  getEffectivePlanningChecklistStatus,
  isCanonicalPlanningChecklistProfile,
  mergePlanningChecklist,
  normalizePlanningChecklistProfile,
  summarizePlanningChecklist,
} from "../src/utils/planningChecklist";

test("legacy status-only categories remain reviewed without fabricating 218 completions", () => {
  const progress = Object.fromEntries(
    CATEGORY_CHECKLISTS.map((category, index) => [
      category.key,
      { status: index % 2 === 0 ? "completed" as const : "in_progress" as const },
    ]),
  );

  assert.equal(hasChecklistReviewEvidence({ status: "completed" }), true);
  assert.equal(hasChecklistReviewEvidence({ status: "in_progress" }), true);
  assert.equal(hasChecklistReviewEvidence({
    status: "not_started",
    checklist: [{ id: "conditional", label: "조건부 항목", done: false, state: "not_applicable" }],
  }), true);

  const summary = summarizePlanningChecklist(CATEGORY_CHECKLISTS, progress);
  assert.equal(summary.done, 0);
  assert.equal(summary.total, 218);
  assert.equal(summary.percent, 0);
  assert.equal(summary.executionDone, 0);
  assert.equal(summary.executionTotal, 218);
  assert.equal(summary.executionPercent, 0);
  assert.equal(summary.completedCategories, 0);
  assert.equal(summary.reviewedCategories, CATEGORY_CHECKLISTS.length);
  assert.equal(summary.coveragePercent, 100);
});

test("effective status trusts item evidence but preserves an explicit category exclusion", () => {
  const template = CATEGORY_CHECKLISTS[0].items;

  assert.equal(
    getEffectivePlanningChecklistStatus(template, { status: "completed" }),
    "not_started",
  );
  assert.equal(
    getEffectivePlanningChecklistStatus(template, { status: "in_progress" }),
    "not_started",
  );
  assert.equal(
    getEffectivePlanningChecklistStatus(template, { status: "not_applicable" }),
    "not_applicable",
  );
  assert.equal(
    getEffectivePlanningChecklistStatus(template, {
      status: "completed",
      checklist: template.map((item) => ({ ...item, done: true, state: "completed" })),
    }),
    "completed",
  );
});

test("legacy status-only completed and in-progress categories require item-by-item reconfirmation", () => {
  const template = CATEGORY_CHECKLISTS[0].items;

  for (const status of ["completed", "in_progress"] as const) {
    const merged = mergePlanningChecklist(template, undefined, status);
    assert.equal(merged.length, template.length);
    assert.ok(merged.every((item) => item.done === false && item.state === "todo"));
    assert.ok(merged.every((item) => item.completedAt == null));
    assert.ok(merged.every((item) => item.completedByProfileId == null));
  }
});

test("legacy item completion is canonicalized without leaking its retired field", () => {
  const merged = mergePlanningChecklist(
    [{ id: "legacy", label: "계약 확인", done: false }],
    [{ id: "legacy", label: "옛 문구", done: false, completed: true } as never],
  );

  assert.deepEqual(merged, [{
    id: "legacy",
    label: "계약 확인",
    done: true,
    state: "completed",
  }]);
  assert.equal(Object.prototype.hasOwnProperty.call(merged[0], "completed"), false);
});

test("a partial legacy v1 situation profile becomes a complete repairable v2 profile", () => {
  const partial = {
    version: 1,
    reviewedAt: "legacy-date",
    answers: { ceremony: "yes", healthSupport: "unknown" },
    autoExcludedItemIds: ["venue_01", "venue_01", 7],
  };

  assert.equal(isCanonicalPlanningChecklistProfile(partial), false);
  const normalized = normalizePlanningChecklistProfile(partial);
  assert.ok(normalized);
  assert.equal(normalized.version, 2);
  assert.equal(normalized.answers.ceremony, "yes");
  assert.equal(normalized.answers.gathering, "undecided");
  assert.equal(normalized.answers.legalMarriage, "undecided");
  assert.equal(normalized.answers.healthSupport, null);
  assert.deepEqual(normalized.autoExcludedItemIds, ["venue_01"]);
  assert.equal(isCanonicalPlanningChecklistProfile(normalized), true);
});
