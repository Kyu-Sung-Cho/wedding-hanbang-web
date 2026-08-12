import { describe, it, expect } from "vitest";
import {
  applyPlanningChecklistProfile,
  buildPlanningChecklistInsights,
  mergeChecklist,
  calculateStatus,
  getChecklistCounts,
  summarizePlanningChecklist,
} from "../checklist";
import type { ChecklistItem } from "@/types/database.types";
import { setPlanningChecklistCategoryStatus } from "@hanbang/shared/utils";

const makeItems = (ids: string[], doneStates: boolean[]): ChecklistItem[] =>
  ids.map((id, i) => ({ id, label: `Task ${id}`, done: doneStates[i] }));

const template: ChecklistItem[] = makeItems(["a", "b", "c", "d"], [false, false, false, false]);

describe("mergeChecklist", () => {
  describe("no saved item-level data", () => {
    it("returns all false when status is not_started", () => {
      const result = mergeChecklist(template, undefined, "not_started");
      expect(result.every((i) => !i.done)).toBe(true);
    });

    it("returns all false when saved is empty array", () => {
      const result = mergeChecklist(template, [], "not_started");
      expect(result.every((i) => !i.done)).toBe(true);
    });

    it("keeps a legacy completed category pending until each item is reconfirmed", () => {
      const result = mergeChecklist(template, undefined, "completed");
      expect(result.every((i) => !i.done && i.state === "todo")).toBe(true);
      expect(result.every((i) => i.completedAt == null)).toBe(true);
      expect(result.every((i) => i.completedByProfileId == null)).toBe(true);
    });

    it("does not invent completed items from a category-level in-progress status", () => {
      const result = mergeChecklist(template, undefined, "in_progress");
      expect(result.every((i) => !i.done)).toBe(true);
    });

    it("returns all false when no status provided", () => {
      const result = mergeChecklist(template, undefined);
      expect(result.every((i) => !i.done)).toBe(true);
    });
  });

  describe("with saved data", () => {
    it("merges saved done values into template items", () => {
      const saved = makeItems(["a", "c"], [true, true]);
      const result = mergeChecklist(template, saved);
      expect(result.find((i) => i.id === "a")?.done).toBe(true);
      expect(result.find((i) => i.id === "b")?.done).toBe(false);
      expect(result.find((i) => i.id === "c")?.done).toBe(true);
      expect(result.find((i) => i.id === "d")?.done).toBe(false);
      expect(result.find((i) => i.id === "a")?.state).toBe("completed");
      expect(result.find((i) => i.id === "b")?.state).toBe("todo");
    });

    it("preserves execution metadata and normalizes done from state", () => {
      const saved: ChecklistItem[] = [{
        id: "a",
        label: "사용자가 바꾼 문구",
        done: false,
        state: "waiting",
        assignee: { kind: "member", profileId: "11111111-1111-4111-8111-111111111111" },
        dueDate: "2026-09-20",
        note: "업체 답변을 기다리는 중",
      }];

      const result = mergeChecklist(template, saved);

      expect(result[0]).toMatchObject({
        id: "a",
        label: "Task a",
        done: false,
        state: "waiting",
        dueDate: "2026-09-20",
        note: "업체 답변을 기다리는 중",
      });
      expect(result[0].assignee).toEqual({
        kind: "member",
        profileId: "11111111-1111-4111-8111-111111111111",
      });
    });

    it("treats an item-level not_applicable state as excluded rather than done", () => {
      const saved: ChecklistItem[] = [{
        id: "a",
        label: "Task a",
        done: true,
        state: "not_applicable",
      }];

      const result = mergeChecklist(template, saved);
      expect(result[0]).toMatchObject({ done: false, state: "not_applicable" });
    });

    it("preserves template order regardless of saved order", () => {
      const saved = [
        { id: "d", label: "D", done: true },
        { id: "a", label: "A", done: true },
      ];
      const result = mergeChecklist(template, saved);
      expect(result.map((i) => i.id)).toEqual(["a", "b", "c", "d"]);
    });

    it("defaults to false for items not in saved", () => {
      const saved = makeItems(["a"], [true]);
      const result = mergeChecklist(template, saved);
      expect(result.find((i) => i.id === "b")?.done).toBe(false);
    });

    it("ignores status when saved data is provided", () => {
      const saved = makeItems(["a"], [false]);
      const result = mergeChecklist(template, saved, "completed");
      // Saved data takes precedence — not all items should be done
      expect(result.find((i) => i.id === "a")?.done).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("handles empty template", () => {
      expect(mergeChecklist([], undefined)).toEqual([]);
      expect(mergeChecklist([], [])).toEqual([]);
    });

    it("preserves saved items not present in template", () => {
      const saved = makeItems(["z", "a"], [true, true]);
      const result = mergeChecklist(template, saved);
      expect(result.map((item) => item.id)).toEqual(["a", "b", "c", "d", "z"]);
      expect(result.at(-1)).toMatchObject({ id: "z", done: true });
    });

    it("deduplicates repeated saved-only ids", () => {
      const saved = [...makeItems(["z", "z"], [true, false]), ...makeItems(["a"], [true])];
      const result = mergeChecklist(template, saved);
      expect(result.filter((item) => item.id === "z")).toHaveLength(1);
      expect(result.find((item) => item.id === "z")?.done).toBe(true);
    });
  });
});

describe("category completion audit", () => {
  it("preserves a partner's completed item and stamps only newly completed work", () => {
    const partnerItem: ChecklistItem = {
      id: "a",
      label: "파트너 완료",
      done: true,
      state: "completed",
      completedAt: "2026-08-11T08:00:00.000Z",
      completedByProfileId: "partner-profile",
    };
    const items = [partnerItem, { id: "b", label: "내가 마무리", done: false, state: "todo" as const }];
    const result = setPlanningChecklistCategoryStatus(
      items,
      items,
      "in_progress",
      "completed",
      {
        completedAt: "2026-08-12T08:00:00.000Z",
        completedByProfileId: "viewer-profile",
      },
    );

    expect(result.checklist[0]).toEqual(partnerItem);
    expect(result.checklist[1]).toMatchObject({
      state: "completed",
      done: true,
      completedAt: "2026-08-12T08:00:00.000Z",
      completedByProfileId: "viewer-profile",
    });
  });
});

describe("summarizePlanningChecklist", () => {
  const templates = [
    { key: "small", items: makeItems(["a"], [false]) },
    { key: "large", items: makeItems(["b", "c", "d"], [false, false, false]) },
  ];

  it("excludes not_applicable categories from the denominator", () => {
    expect(
      summarizePlanningChecklist(templates, {
        small: { status: "not_applicable", checklist: makeItems(["a"], [false]) },
        large: { status: "in_progress", checklist: makeItems(["b", "c", "d"], [true, false, false]) },
      }),
    ).toMatchObject({ done: 1, total: 3, percent: 33, skippedCategories: 1 });
  });

  it("uses item-weighted progress instead of category averages", () => {
    expect(
      summarizePlanningChecklist(templates, {
        small: { status: "completed", checklist: makeItems(["a"], [true]) },
        large: { status: "not_started", checklist: makeItems(["b", "c", "d"], [false, false, false]) },
      }).percent,
    ).toBe(25);
  });

  it("returns a stable zero when every category is skipped", () => {
    const result = summarizePlanningChecklist(templates, {
      small: { status: "not_applicable" },
      large: { status: "not_applicable" },
    });
    expect(result).toMatchObject({ done: 0, total: 0, percent: 0, skippedCategories: 2 });
  });

  it("keeps overall progress honest while showing reviewed execution separately", () => {
    const versionedTemplates = [
      { key: "legacy", introducedInVersion: 1 as const, items: makeItems(["a", "b"], [false, false]) },
      { key: "new", introducedInVersion: 2 as const, items: makeItems(["c", "d"], [false, false]) },
    ];

    expect(
      summarizePlanningChecklist(versionedTemplates, {
        legacy: { status: "completed", checklist: makeItems(["a", "b"], [true, true]) },
      }),
    ).toMatchObject({
      done: 2,
      total: 4,
      percent: 50,
      executionDone: 2,
      executionTotal: 2,
      executionPercent: 100,
      reviewedCategories: 1,
      unreviewedCategories: 1,
      coveragePercent: 50,
      availableNewCategories: 1,
      applicableCategories: 2,
    });
  });

  it("keeps status-only legacy categories reviewed without claiming completed items", () => {
    const versionedTemplates = [
      { key: "completed_legacy", introducedInVersion: 1 as const, items: makeItems(["a", "b"], [false, false]) },
      { key: "started_legacy", introducedInVersion: 1 as const, items: makeItems(["c", "d"], [false, false]) },
    ];

    expect(
      summarizePlanningChecklist(versionedTemplates, {
        completed_legacy: { status: "completed" },
        started_legacy: { status: "in_progress" },
      }),
    ).toMatchObject({
      done: 0,
      total: 4,
      percent: 0,
      executionDone: 0,
      executionTotal: 4,
      executionPercent: 0,
      completedCategories: 0,
      reviewedCategories: 2,
      unreviewedCategories: 0,
      coveragePercent: 100,
    });
  });

  it("does not count a budget-only category record as checklist review evidence", () => {
    const versionedTemplates = [
      { key: "venue", introducedInVersion: 1 as const, items: makeItems(["a", "b"], [false, false]) },
    ];

    expect(
      summarizePlanningChecklist(versionedTemplates, {
        venue: { status: "not_started", budget: 10_000_000 } as never,
      }),
    ).toMatchObject({
      reviewedCategories: 0,
      unreviewedCategories: 1,
      coveragePercent: 0,
      executionTotal: 0,
    });
  });

  it("adds only the v2 category whose progress key has been created", () => {
    const versionedTemplates = [
      { key: "legacy", introducedInVersion: 1 as const, items: makeItems(["a", "b"], [false, false]) },
      { key: "new", introducedInVersion: 2 as const, items: makeItems(["c", "d"], [false, false]) },
      { key: "later", introducedInVersion: 2 as const, items: makeItems(["e"], [false]) },
    ];

    expect(
      summarizePlanningChecklist(versionedTemplates, {
        legacy: { status: "completed", checklist: makeItems(["a", "b"], [true, true]) },
        new: { status: "in_progress", checklist: makeItems(["c", "d"], [true, false]) },
      }),
    ).toMatchObject({
      done: 3,
      total: 5,
      percent: 60,
      executionDone: 3,
      executionTotal: 4,
      executionPercent: 75,
      reviewedCategories: 2,
      unreviewedCategories: 1,
      availableNewCategories: 1,
      applicableCategories: 3,
    });
  });

  it("treats an explicitly skipped v2 category as handled without adding its items", () => {
    const versionedTemplates = [
      { key: "legacy", introducedInVersion: 1 as const, items: makeItems(["a"], [false]) },
      { key: "new", introducedInVersion: 2 as const, items: makeItems(["b", "c"], [false, false]) },
    ];

    expect(
      summarizePlanningChecklist(versionedTemplates, {
        legacy: { status: "completed", checklist: makeItems(["a"], [true]) },
        new: { status: "not_applicable" },
      }),
    ).toMatchObject({
      done: 1,
      total: 1,
      percent: 100,
      skippedCategories: 1,
      availableNewCategories: 0,
      reviewedCategories: 2,
      unreviewedCategories: 0,
      coveragePercent: 100,
    });
  });

  it("excludes item-level not_applicable work from both denominators", () => {
    const advancedTemplates = [
      { key: "choice", introducedInVersion: 1 as const, items: makeItems(["a", "b"], [false, false]) },
    ];
    const result = summarizePlanningChecklist(advancedTemplates, {
      choice: {
        status: "in_progress",
        checklist: [
          { id: "a", label: "A", done: true, state: "completed" },
          { id: "b", label: "B", done: false, state: "not_applicable" },
        ],
      },
    });

    expect(result).toMatchObject({
      done: 1,
      total: 1,
      percent: 100,
      executionTotal: 1,
      reviewedCategories: 1,
    });
  });
});

describe("calculateStatus", () => {
  it("returns not_started when no items are done", () => {
    expect(calculateStatus(makeItems(["a", "b"], [false, false]))).toBe("not_started");
  });

  it("returns completed when all items are done", () => {
    expect(calculateStatus(makeItems(["a", "b"], [true, true]))).toBe("completed");
  });

  it("returns in_progress when some items are done", () => {
    expect(calculateStatus(makeItems(["a", "b"], [true, false]))).toBe("in_progress");
  });

  it("returns in_progress for exactly half done", () => {
    expect(calculateStatus(makeItems(["a", "b", "c", "d"], [true, true, false, false]))).toBe("in_progress");
  });

  it("returns not_started for empty checklist", () => {
    expect(calculateStatus([])).toBe("not_started");
  });

  it("returns completed for single-item checklist when done", () => {
    expect(calculateStatus(makeItems(["a"], [true]))).toBe("completed");
  });

  it("keeps waiting and blocked work in progress", () => {
    const items: ChecklistItem[] = [
      { id: "a", label: "A", done: false, state: "waiting" },
      { id: "b", label: "B", done: false, state: "blocked" },
    ];
    expect(calculateStatus(items)).toBe("in_progress");
  });

  it("returns not_applicable when every item was explicitly excluded", () => {
    const items: ChecklistItem[] = [
      { id: "a", label: "A", done: false, state: "not_applicable" },
      { id: "b", label: "B", done: false, state: "not_applicable" },
    ];
    expect(calculateStatus(items)).toBe("not_applicable");
  });
});

describe("getChecklistCounts", () => {
  it("returns correct done and total counts", () => {
    const items = makeItems(["a", "b", "c"], [true, false, true]);
    expect(getChecklistCounts(items)).toEqual({ done: 2, total: 3 });
  });

  it("returns 0,0 for undefined input", () => {
    expect(getChecklistCounts(undefined)).toEqual({ done: 0, total: 0 });
  });

  it("returns 0,0 for empty array", () => {
    expect(getChecklistCounts([])).toEqual({ done: 0, total: 0 });
  });

  it("returns correct count when all done", () => {
    const items = makeItems(["a", "b"], [true, true]);
    expect(getChecklistCounts(items)).toEqual({ done: 2, total: 2 });
  });

  it("returns correct count when none done", () => {
    const items = makeItems(["a", "b", "c"], [false, false, false]);
    expect(getChecklistCounts(items)).toEqual({ done: 0, total: 3 });
  });

  it("excludes item-level not_applicable entries", () => {
    const items: ChecklistItem[] = [
      { id: "a", label: "A", done: true, state: "completed" },
      { id: "b", label: "B", done: false, state: "not_applicable" },
    ];
    expect(getChecklistCounts(items)).toEqual({ done: 1, total: 1 });
  });
});

describe("buildPlanningChecklistInsights", () => {
  const templates = [{
    key: "venue",
    label: "결혼식장",
    introducedInVersion: 1 as const,
    ddayDeadline: 30,
    items: makeItems(["venue_01", "venue_02", "venue_03"], [false, false, false]),
  }];

  it("prioritizes overdue and personally due work without including completed items", () => {
    const result = buildPlanningChecklistInsights(templates, {
      venue: {
        status: "in_progress",
        checklist: [
          { id: "venue_01", label: "A", done: false, state: "todo", dueDate: "2026-08-11" },
          { id: "venue_02", label: "B", done: false, state: "waiting", dueDate: "2026-08-12" },
          { id: "venue_03", label: "C", done: true, state: "completed", dueDate: "2026-08-12" },
        ],
      },
    }, {
      weddingDate: "2026-12-31",
      today: "2026-08-12",
      currentProfileId: "11111111-1111-4111-8111-111111111111",
    });

    expect(result.overdue.map((item) => item.itemId)).toEqual(["venue_01"]);
    expect(result.today.map((item) => item.itemId)).toEqual(["venue_02"]);
    expect(result.all.some((item) => item.itemId === "venue_03")).toBe(false);
  });

  it("derives a suggested date from wedding D-day metadata when no personal date exists", () => {
    const result = buildPlanningChecklistInsights(templates, {
      venue: {
        status: "not_started",
        checklistReviewedAt: "2026-11-25T00:00:00.000Z",
        checklist: makeItems(
          ["venue_01", "venue_02", "venue_03"],
          [false, false, false],
        ),
      },
    }, {
      weddingDate: "2026-12-31",
      today: "2026-11-25",
    });

    expect(result.upcoming[0]).toMatchObject({
      categoryKey: "venue",
      categoryLabel: "결혼식장",
      dueDate: "2026-12-01",
      daysUntilDue: 6,
      dueDateSource: "suggested",
    });
  });

  it("keeps unreviewed categories out of urgent work and offers a review action instead", () => {
    const result = buildPlanningChecklistInsights(templates, {}, {
      weddingDate: "2026-12-31",
      today: "2026-11-25",
    });

    expect(result.all).toEqual([]);
    expect(result.review).toEqual([
      expect.objectContaining({ categoryKey: "venue", categoryLabel: "결혼식장" }),
    ]);
  });

  it("treats a budget-only record as unreviewed instead of overdue checklist work", () => {
    const result = buildPlanningChecklistInsights(templates, {
      venue: { status: "not_started", budget: 5_000_000 } as never,
    }, {
      weddingDate: "2026-12-31",
      today: "2026-11-25",
    });

    expect(result.all).toEqual([]);
    expect(result.review).toEqual([
      expect.objectContaining({ categoryKey: "venue", categoryLabel: "결혼식장" }),
    ]);
  });
  it("surfaces every legacy status-only item for explicit reconfirmation", () => {
    const result = buildPlanningChecklistInsights(templates, {
      venue: { status: "completed" },
    }, {
      weddingDate: "2026-12-31",
      today: "2026-11-25",
    });

    expect(result.review).toEqual([]);
    expect(result.all.map((item) => item.itemId)).toEqual([
      "venue_01",
      "venue_02",
      "venue_03",
    ]);
    expect(result.all.every((item) => item.state === "todo")).toBe(true);
  });
});

describe("applyPlanningChecklistProfile", () => {
  const profileTemplates = [{
    key: "choices",
    label: "선택 준비",
    introducedInVersion: 2 as const,
    items: makeItems(["ceremony", "no_ceremony", "always", "pet"], [false, false, false, false]),
  }];
  const guidance = {
    ceremony: { applicabilityTags: ["ceremony"] },
    no_ceremony: { applicabilityTags: ["no_ceremony"] },
    always: {},
    pet: { applicabilityTags: ["pet_participation"] },
  };
  const baseAnswers = {
    ceremony: "undecided" as const,
    legalMarriage: "undecided" as const,
    travel: "undecided" as const,
    housing: "undecided" as const,
    internationalMarriage: null,
    religiousCeremony: null,
    remarriage: null,
    childrenParticipating: null,
    accessibilitySupport: null,
    healthSupport: null,
    petParticipation: null,
    familyTradition: null,
  };

  it("previews and excludes only explicitly inapplicable conditional items", () => {
    const result = applyPlanningChecklistProfile(profileTemplates, {}, {
      version: 1,
      reviewedAt: "2026-08-12T08:00:00.000Z",
      answers: { ...baseAnswers, ceremony: "no", petParticipation: false },
      autoExcludedItemIds: [],
    }, guidance);

    expect(result.excludedItemIds).toEqual(["ceremony", "pet"]);
    expect(result.restoredItemIds).toEqual([]);
    expect(result.categoryProgressPatch.choices?.checklist?.find((item) => item.id === "ceremony"))
      .toMatchObject({ state: "not_applicable", done: false });
    expect(result.categoryProgressPatch.choices?.checklist?.find((item) => item.id === "no_ceremony"))
      .toMatchObject({ state: "todo", done: false });
    expect(result.categoryProgressPatch.choices?.checklist?.find((item) => item.id === "always"))
      .toMatchObject({ state: "todo", done: false });
  });

  it("restores only items previously auto-excluded by the profile", () => {
    const previousProfile = {
      version: 1 as const,
      reviewedAt: "2026-08-11T08:00:00.000Z",
      answers: { ...baseAnswers, ceremony: "no" as const },
      autoExcludedItemIds: ["ceremony"],
    };
    const progress = {
      __checklist_profile: previousProfile,
      choices: {
        status: "not_applicable" as const,
        checklist: [
          { id: "ceremony", label: "ceremony", done: false, state: "not_applicable" as const },
          { id: "pet", label: "pet", done: false, state: "not_applicable" as const },
        ],
      },
    };

    const result = applyPlanningChecklistProfile(profileTemplates, progress, {
      ...previousProfile,
      reviewedAt: "2026-08-12T08:00:00.000Z",
      answers: { ...baseAnswers, ceremony: "yes", petParticipation: true },
      autoExcludedItemIds: [],
    }, guidance);

    expect(result.restoredItemIds).toEqual(["ceremony"]);
    expect(result.categoryProgressPatch.choices?.checklist?.find((item) => item.id === "ceremony"))
      .toMatchObject({ state: "todo" });
    expect(result.categoryProgressPatch.choices?.checklist?.find((item) => item.id === "pet"))
      .toMatchObject({ state: "not_applicable" });
  });

  it("keeps a manually excluded category excluded while applying situation answers", () => {
    const progress = {
      choices: {
        status: "not_applicable" as const,
        checklist: makeItems(
          ["ceremony", "no_ceremony", "always", "pet"],
          [false, false, false, false],
        ),
      },
    };

    const excluded = applyPlanningChecklistProfile(profileTemplates, progress, {
      version: 1,
      reviewedAt: "2026-08-12T08:00:00.000Z",
      answers: { ...baseAnswers, ceremony: "no" },
      autoExcludedItemIds: [],
    }, guidance);
    expect(excluded.categoryProgressPatch.choices?.status).toBe("not_applicable");

    const restored = applyPlanningChecklistProfile(
      profileTemplates,
      { ...progress, ...excluded.progressPatch },
      {
        ...excluded.profile,
        reviewedAt: "2026-08-12T09:00:00.000Z",
        answers: { ...baseAnswers, ceremony: "yes" },
      },
      guidance,
    );
    expect(restored.categoryProgressPatch.choices?.status).toBe("not_applicable");
  });

  it.each([true, null])(
    "restores a single-item category auto-excluded by the situation profile (%s)",
    (nextAnswer) => {
      const templates = [{
        key: "pet_only",
        label: "반려동물 동행",
        items: makeItems(["pet"], [false]),
      }];
      const first = applyPlanningChecklistProfile(templates, {}, {
        version: 1,
        reviewedAt: "2026-08-12T08:00:00.000Z",
        answers: { ...baseAnswers, petParticipation: false },
        autoExcludedItemIds: [],
      }, guidance, "profile-1");

      expect(first.categoryProgressPatch.pet_only).toMatchObject({
        status: "not_applicable",
        checklistReviewSource: "situation_profile",
      });

      const second = applyPlanningChecklistProfile(
        templates,
        first.progressPatch,
        {
          ...first.profile,
          reviewedAt: "2026-08-12T09:00:00.000Z",
          answers: { ...baseAnswers, petParticipation: nextAnswer },
        },
        guidance,
        "profile-1",
      );

      expect(second.restoredItemIds).toEqual(["pet"]);
      expect(second.categoryProgressPatch.pet_only).toMatchObject({
        status: "not_started",
        checklist: [expect.objectContaining({ id: "pet", state: "todo", done: false })],
      });
    },
  );

  it("reopens a situation-owned N/A category when a template adds unconditional work", () => {
    const oldTemplates = [{
      key: "pet_only",
      label: "반려동물 동행",
      items: makeItems(["pet"], [false]),
    }];
    const first = applyPlanningChecklistProfile(oldTemplates, {}, {
      version: 1,
      reviewedAt: "2026-08-12T08:00:00.000Z",
      answers: { ...baseAnswers, petParticipation: false },
      autoExcludedItemIds: [],
    }, guidance, "profile-1");
    const upgradedTemplates = [{
      ...oldTemplates[0],
      items: makeItems(["pet", "always"], [false, false]),
    }];

    const upgraded = applyPlanningChecklistProfile(
      upgradedTemplates,
      first.progressPatch,
      {
        ...first.profile,
        reviewedAt: "2026-08-12T09:00:00.000Z",
      },
      guidance,
      "profile-1",
    );

    expect(upgraded.categoryProgressPatch.pet_only).toMatchObject({
      status: "not_started",
      checklist: [
        expect.objectContaining({ id: "pet", state: "not_applicable" }),
        expect.objectContaining({ id: "always", state: "todo", done: false }),
      ],
    });
  });

  it("materializes a decided category so situation review counts toward coverage", () => {
    const reviewed = applyPlanningChecklistProfile(profileTemplates, {}, {
      version: 1,
      reviewedAt: "2026-08-12T08:00:00.000Z",
      answers: { ...baseAnswers, ceremony: "yes", petParticipation: true },
      autoExcludedItemIds: [],
    }, guidance);

    expect(reviewed.categoryProgressPatch.choices?.checklist).toHaveLength(4);
    expect(summarizePlanningChecklist(
      profileTemplates,
      reviewed.progressPatch as never,
    )).toMatchObject({ reviewedCategories: 1, coveragePercent: 100 });
  });

  it("does not review an OR-tagged item while one possible applicability answer is undecided", () => {
    const templates = [{
      key: "international",
      label: "국제혼인 선택",
      items: makeItems(["international_or_legal"], [false]),
    }];
    const multiGuidance = {
      international_or_legal: {
        applicabilityTags: ["international_marriage", "legal_marriage"],
      },
    };
    const undecided = applyPlanningChecklistProfile(templates, {}, {
      version: 1,
      reviewedAt: "2026-08-12T08:00:00.000Z",
      answers: {
        ...baseAnswers,
        internationalMarriage: null,
        legalMarriage: "no",
      },
      autoExcludedItemIds: [],
    }, multiGuidance);
    expect(undecided.categoryProgressPatch).not.toHaveProperty("international");

    const applicable = applyPlanningChecklistProfile(templates, {}, {
      version: 1,
      reviewedAt: "2026-08-12T08:00:00.000Z",
      answers: {
        ...baseAnswers,
        internationalMarriage: true,
        legalMarriage: "undecided",
      },
      autoExcludedItemIds: [],
    }, multiGuidance);
    expect(applicable.categoryProgressPatch.international).toMatchObject({
      checklistReviewSource: "situation_profile",
    });

    const inapplicable = applyPlanningChecklistProfile(templates, {}, {
      version: 1,
      reviewedAt: "2026-08-12T08:00:00.000Z",
      answers: {
        ...baseAnswers,
        internationalMarriage: false,
        legalMarriage: "no",
      },
      autoExcludedItemIds: [],
    }, multiGuidance);
    expect(inapplicable.categoryProgressPatch.international?.checklist?.[0])
      .toMatchObject({ state: "not_applicable" });
  });

  it("removes situation-owned review provenance when its answers become undecided", () => {
    const saved = {
      choices: {
        status: "not_started" as const,
        checklist: makeItems(["ceremony", "no_ceremony", "always", "pet"], [false, false, false, false]),
        checklistReviewedAt: "2026-08-11T08:00:00.000Z",
        checklistReviewedByProfileId: "profile-1",
        checklistReviewSource: "situation_profile" as const,
      },
    };
    const result = applyPlanningChecklistProfile(profileTemplates, saved, {
      version: 1,
      reviewedAt: "2026-08-12T08:00:00.000Z",
      answers: baseAnswers,
      autoExcludedItemIds: [],
    }, guidance, "profile-1");

    expect(result.categoryProgressPatch.choices).not.toHaveProperty("checklistReviewedAt");
    expect(result.categoryProgressPatch.choices).not.toHaveProperty("checklistReviewSource");
  });
});
