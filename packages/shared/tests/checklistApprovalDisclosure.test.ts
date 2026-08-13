import assert from "node:assert/strict";
import test from "node:test";

import { CATEGORY_CHECKLISTS } from "../src/constants/weddingPlanning";
import {
  buildChecklistApprovalDisclosure,
} from "../src/contracts/checklistApprovalDisclosure.mjs";

const REVIEWER_ID = "11111111-1111-4111-8111-111111111111";
const profile = (overrides: Record<string, unknown> = {}) => ({
  version: 1,
  reviewedAt: "2026-08-12T12:00:00.000Z",
  answers: {
    ceremony: "yes",
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
  },
  autoExcludedItemIds: [],
  ...overrides,
});

const profileV2 = (overrides: Record<string, unknown> = {}) => ({
  version: 2,
  reviewedAt: "2026-08-12T12:00:00.000Z",
  answers: {
    ...profile().answers,
    gathering: "undecided",
  },
  autoExcludedItemIds: [],
  ...overrides,
});

const ceremonyTemplate = CATEGORY_CHECKLISTS.find((category) => category.key === "ceremony")!;
const legalTemplate = CATEGORY_CHECKLISTS.find((category) => category.key === "health_admin")!;
const legalItem = legalTemplate.items.find((item) => item.id === "health_admin_05")!;

test("discloses every changed answer, impacted category, exclusion and restoration from the proposal", () => {
  const currentProgress = {
    __checklist_profile: profile({
      answers: {
        ...profile().answers,
        ceremony: "yes",
        legalMarriage: "yes",
      },
      autoExcludedItemIds: [ceremonyTemplate.items[0].id],
    }),
    ceremony: {
      status: "in_progress",
      checklist: ceremonyTemplate.items.map((item, index) => ({
        ...item,
        done: false,
        state: index === 0 ? "not_applicable" : "todo",
      })),
    },
    health_admin: {
      status: "not_started",
      checklist: legalTemplate.items.map((item) => ({
        ...item,
        done: false,
        state: "todo",
      })),
    },
  };
  const result = buildChecklistApprovalDisclosure({
    currentProgress,
    currentRevision: 7,
    templates: CATEGORY_CHECKLISTS,
    proposal: {
      kind: "checklist_situation",
      baseRevision: 7,
      progressPatch: {
        __checklist_profile: profile({
          answers: {
            ...profile().answers,
            ceremony: "no",
            legalMarriage: "no",
          },
          autoExcludedItemIds: [legalItem.id],
        }),
        ceremony: {
          status: "not_started",
          checklist: ceremonyTemplate.items.map((item) => ({
            ...item,
            done: false,
            state: "todo",
          })),
          checklistReviewedAt: "2026-08-12T12:00:00.000Z",
          checklistReviewedByProfileId: REVIEWER_ID,
          checklistReviewSource: "situation_profile",
        },
        health_admin: {
          status: "in_progress",
          checklist: legalTemplate.items.map((item) => ({
            ...item,
            done: false,
            state: item.id === legalItem.id ? "not_applicable" : "todo",
          })),
          checklistReviewedAt: "2026-08-12T12:00:00.000Z",
          checklistReviewedByProfileId: REVIEWER_ID,
          checklistReviewSource: "situation_profile",
        },
      },
    },
  });

  assert.equal(result.status, "ready");
  if (result.status !== "ready") return;
  assert.deepEqual(
    result.questionChanges.map((change) => [change.label, change.before, change.after]),
    [
      ["예식", "진행", "진행 안 함"],
      ["법률혼(혼인신고)", "진행", "진행 안 함"],
    ],
  );
  assert.deepEqual(result.excludedItems.map((item) => item.itemId), [legalItem.id]);
  assert.deepEqual(result.restoredItems.map((item) => item.itemId), [ceremonyTemplate.items[0].id]);
  assert.deepEqual(result.categories.map((category) => category.categoryKey), ["ceremony", "health_admin"]);
  assert.equal(result.automaticExclusionTotal, 1);
});

test("describes an already-arranged home without implying every move task is irrelevant", () => {
  const result = buildChecklistApprovalDisclosure({
    currentProgress: { __checklist_profile: profile() },
    currentRevision: 4,
    templates: CATEGORY_CHECKLISTS,
    proposal: {
      kind: "checklist_situation",
      baseRevision: 4,
      progressPatch: {
        __checklist_profile: profile({
          answers: { ...profile().answers, housing: "other" },
        }),
      },
    },
  });

  assert.equal(result.status, "ready");
  if (result.status !== "ready") return;
  assert.deepEqual(
    result.questionChanges.map(({ key, after }) => ({ key, after })),
    [{ key: "housing", after: "기타·이미 마련" }],
  );
});

test("discloses a version 2 gathering change as one user-readable celebration question", () => {
  const result = buildChecklistApprovalDisclosure({
    currentProgress: {
      __checklist_profile: profileV2({
        answers: { ...profileV2().answers, gathering: "none" },
      }),
    },
    currentRevision: 5,
    templates: CATEGORY_CHECKLISTS,
    proposal: {
      kind: "checklist_situation",
      baseRevision: 5,
      progressPatch: {
        __checklist_profile: profileV2({
          answers: { ...profileV2().answers, gathering: "reception" },
        }),
      },
    },
  });

  assert.equal(result.status, "ready");
  if (result.status !== "ready") return;
  assert.deepEqual(result.questionChanges, [{
    key: "gathering",
    label: "축하 식사·모임",
    before: "따로 없음",
    after: "하객 피로연·축하 모임",
  }]);
});

test("keeps a pending v1 proposal readable and treats its missing gathering as undecided", () => {
  const result = buildChecklistApprovalDisclosure({
    currentProgress: {
      __checklist_profile: profile(),
    },
    currentRevision: 6,
    templates: CATEGORY_CHECKLISTS,
    proposal: {
      kind: "checklist_situation",
      baseRevision: 6,
      progressPatch: {
        __checklist_profile: profile({
          answers: { ...profile().answers, ceremony: "no" },
        }),
      },
    },
  });

  assert.equal(result.status, "ready");
  if (result.status !== "ready") return;
  assert.deepEqual(
    result.questionChanges.map(({ key, before, after }) => ({ key, before, after })),
    [{ key: "ceremony", before: "진행", after: "진행 안 함" }],
  );
});

test("fails closed on answer keys that do not exactly match the profile version", () => {
  const v1WithGathering = buildChecklistApprovalDisclosure({
    currentProgress: {},
    currentRevision: 7,
    templates: CATEGORY_CHECKLISTS,
    proposal: {
      kind: "checklist_situation",
      baseRevision: 7,
      progressPatch: {
        __checklist_profile: {
          ...profile(),
          answers: { ...profile().answers, gathering: "undecided" },
        },
      },
    },
  });
  assert.deepEqual(v1WithGathering, { status: "unsafe", reason: "invalid_profile" });

  const v2WithoutGathering = buildChecklistApprovalDisclosure({
    currentProgress: {},
    currentRevision: 7,
    templates: CATEGORY_CHECKLISTS,
    proposal: {
      kind: "checklist_situation",
      baseRevision: 7,
      progressPatch: {
        __checklist_profile: { ...profile(), version: 2 },
      },
    },
  });
  assert.deepEqual(v2WithoutGathering, { status: "unsafe", reason: "invalid_profile" });
});

test("fails closed when the proposal revision is not the current journey revision", () => {
  const result = buildChecklistApprovalDisclosure({
    currentProgress: {},
    currentRevision: 8,
    templates: CATEGORY_CHECKLISTS,
    proposal: {
      kind: "checklist_situation",
      baseRevision: 7,
      progressPatch: { __checklist_profile: profile() },
    },
  });

  assert.deepEqual(result, { status: "unsafe", reason: "revision_mismatch" });
});

test("fails closed on unknown progress keys or hidden non-situation item changes", () => {
  const unknownKey = buildChecklistApprovalDisclosure({
    currentProgress: {},
    currentRevision: 1,
    templates: CATEGORY_CHECKLISTS,
    proposal: {
      kind: "checklist_situation",
      baseRevision: 1,
      progressPatch: {
        __checklist_profile: profile(),
        __events: [],
      },
    },
  });
  assert.equal(unknownKey.status, "unsafe");

  const currentProgress = {
    health_admin: {
      status: "not_started",
      checklist: legalTemplate.items.map((item) => ({
        ...item,
        done: false,
        state: "todo",
      })),
    },
  };
  const hiddenNote = buildChecklistApprovalDisclosure({
    currentProgress,
    currentRevision: 1,
    templates: CATEGORY_CHECKLISTS,
    proposal: {
      kind: "checklist_situation",
      baseRevision: 1,
      progressPatch: {
        __checklist_profile: profile(),
        health_admin: {
          status: "not_started",
          checklist: legalTemplate.items.map((item, index) => ({
            ...item,
            done: false,
            state: "todo",
            ...(index === 0 ? { note: "요약에 없는 변경" } : {}),
          })),
        },
      },
    },
  });
  assert.deepEqual(hiddenNote, { status: "unsafe", reason: "hidden_item_delta" });
});

test("discloses a non-applicability status repair and preserves unchanged legacy metadata", () => {
  const firstItem = ceremonyTemplate.items[0];
  const currentProgress = {
    __checklist_profile: profile(),
    ceremony: {
      status: "completed",
      retired_payload: { kept: true },
      checklist: [{ ...firstItem, done: true, state: "completed" }],
    },
  };
  const progressPatch = {
    __checklist_profile: profile({ reviewedAt: "2026-08-12T12:05:00.000Z" }),
    ceremony: {
      status: "in_progress",
      retired_payload: { kept: true },
      checklist: ceremonyTemplate.items.map((item, index) => ({
        ...item,
        done: index === 0,
        state: index === 0 ? "completed" : "todo",
      })),
    },
  };
  const result = buildChecklistApprovalDisclosure({
    currentProgress,
    currentRevision: 11,
    templates: CATEGORY_CHECKLISTS,
    proposal: { kind: "checklist_situation", baseRevision: 11, progressPatch },
  });

  assert.equal(result.status, "ready");
  if (result.status !== "ready") return;
  assert.deepEqual(
    result.categories.map(({ categoryKey, beforeStatus, afterStatus, statusChanged }) => ({
      categoryKey,
      beforeStatus,
      afterStatus,
      statusChanged,
    })),
    [{
      categoryKey: "ceremony",
      beforeStatus: "completed",
      afterStatus: "in_progress",
      statusChanged: true,
    }],
  );

  const changedLegacyMetadata = buildChecklistApprovalDisclosure({
    currentProgress,
    currentRevision: 11,
    templates: CATEGORY_CHECKLISTS,
    proposal: {
      kind: "checklist_situation",
      baseRevision: 11,
      progressPatch: {
        ...progressPatch,
        ceremony: { ...progressPatch.ceremony, retired_payload: { kept: false } },
      },
    },
  });
  assert.deepEqual(changedLegacyMetadata, {
    status: "unsafe",
    reason: "invalid_proposed_category",
  });
});

test("discloses when a situation exclusion clears prior completion evidence", () => {
  const currentProgress = {
    __checklist_profile: profile({
      answers: { ...profile().answers, legalMarriage: "yes" },
    }),
    health_admin: {
      status: "in_progress",
      checklist: legalTemplate.items.map((item) => ({
        ...item,
        done: item.id === legalItem.id,
        state: item.id === legalItem.id ? "completed" : "todo",
        ...(item.id === legalItem.id ? {
          completedAt: "2026-08-11T10:00:00.000Z",
          completedByProfileId: REVIEWER_ID,
        } : {}),
      })),
    },
  };
  const result = buildChecklistApprovalDisclosure({
    currentProgress,
    currentRevision: 12,
    templates: CATEGORY_CHECKLISTS,
    proposal: {
      kind: "checklist_situation",
      baseRevision: 12,
      progressPatch: {
        __checklist_profile: profile({
          answers: { ...profile().answers, legalMarriage: "no" },
          autoExcludedItemIds: [legalItem.id],
        }),
        health_admin: {
          status: "in_progress",
          checklist: legalTemplate.items.map((item) => ({
            ...item,
            done: false,
            state: item.id === legalItem.id ? "not_applicable" : "todo",
          })),
        },
      },
    },
  });

  assert.equal(result.status, "ready");
  if (result.status !== "ready") return;
  assert.deepEqual(
    result.excludedItems.map(({ itemId, completionEvidenceCleared }) => ({
      itemId,
      completionEvidenceCleared,
    })),
    [{ itemId: legalItem.id, completionEvidenceCleared: true }],
  );
});

test("reviews a malformed legacy profile repair against the documented defaults", () => {
  const result = buildChecklistApprovalDisclosure({
    currentProgress: {
      __checklist_profile: {
        version: 1,
        reviewedAt: "2026-07-01T10:00:00.000Z",
        answers: { ceremony: "yes" },
        autoExcludedItemIds: ["retired_unknown_item"],
      },
    },
    currentRevision: 13,
    templates: CATEGORY_CHECKLISTS,
    proposal: {
      kind: "checklist_situation",
      baseRevision: 13,
      progressPatch: { __checklist_profile: profile() },
    },
  });

  assert.equal(result.status, "ready");
  if (result.status !== "ready") return;
  assert.deepEqual(
    result.questionChanges.map(({ key, before, after }) => ({ key, before, after })),
    [{ key: "ceremony", before: "미정", after: "진행" }],
  );
  assert.equal(result.automaticExclusionTotal, 0);
});

test("fails closed when profile ownership changes without the matching exclusion or restoration", () => {
  const manualNotApplicable = {
    __checklist_profile: profile(),
    health_admin: {
      status: "in_progress",
      checklist: legalTemplate.items.map((item) => ({
        ...item,
        done: false,
        state: item.id === legalItem.id ? "not_applicable" : "todo",
      })),
    },
  };
  const hijackedManualExclusion = buildChecklistApprovalDisclosure({
    currentProgress: manualNotApplicable,
    currentRevision: 14,
    templates: CATEGORY_CHECKLISTS,
    proposal: {
      kind: "checklist_situation",
      baseRevision: 14,
      progressPatch: {
        __checklist_profile: profile({ autoExcludedItemIds: [legalItem.id] }),
      },
    },
  });
  assert.deepEqual(hijackedManualExclusion, {
    status: "unsafe",
    reason: "profile_exclusion_delta_mismatch",
  });

  const abandonedAutomaticExclusion = buildChecklistApprovalDisclosure({
    currentProgress: {
      ...manualNotApplicable,
      __checklist_profile: profile({ autoExcludedItemIds: [legalItem.id] }),
    },
    currentRevision: 15,
    templates: CATEGORY_CHECKLISTS,
    proposal: {
      kind: "checklist_situation",
      baseRevision: 15,
      progressPatch: { __checklist_profile: profile() },
    },
  });
  assert.deepEqual(abandonedAutomaticExclusion, {
    status: "unsafe",
    reason: "profile_exclusion_delta_mismatch",
  });
});

test("ignores only orphaned legacy ownership while preserving backed N/A ownership and answers", () => {
  const answers = { ...profile().answers, travel: "domestic" };
  const currentCategory = {
    status: "in_progress",
    checklist: legalTemplate.items.map((item) => ({
      ...item,
      done: false,
      state: item.id === legalItem.id ? "not_applicable" : "todo",
    })),
  };
  const currentProgress = {
    __checklist_profile: profile({
      reviewedAt: "2026-08-10T12:00:00.000Z",
      answers,
      autoExcludedItemIds: ["retired_unknown_item", legalItem.id],
    }),
    health_admin: currentCategory,
  };
  const repairedProfile = profile({
    reviewedAt: "2026-08-12T12:00:00.000Z",
    answers,
    autoExcludedItemIds: [],
  });

  const abandonedBackedOwnership = buildChecklistApprovalDisclosure({
    currentProgress,
    currentRevision: 16,
    templates: CATEGORY_CHECKLISTS,
    proposal: {
      kind: "checklist_situation",
      baseRevision: 16,
      progressPatch: { __checklist_profile: repairedProfile },
    },
  });
  assert.deepEqual(abandonedBackedOwnership, {
    status: "unsafe",
    reason: "profile_exclusion_delta_mismatch",
  });

  const restored = buildChecklistApprovalDisclosure({
    currentProgress,
    currentRevision: 16,
    templates: CATEGORY_CHECKLISTS,
    proposal: {
      kind: "checklist_situation",
      baseRevision: 16,
      progressPatch: {
        __checklist_profile: repairedProfile,
        health_admin: {
          status: "not_started",
          checklist: legalTemplate.items.map((item) => ({
            ...item,
            done: false,
            state: "todo",
          })),
        },
      },
    },
  });
  assert.equal(restored.status, "ready");
  if (restored.status !== "ready") return;
  assert.deepEqual(restored.questionChanges, []);
  assert.deepEqual(restored.restoredItems.map((item) => item.itemId), [legalItem.id]);
});

test("preserves manual review provenance and discloses only valid review additions or clears", () => {
  const baseCategory = {
    status: "not_started",
    checklist: legalTemplate.items.map((item) => ({
      ...item,
      done: false,
      state: "todo",
    })),
  };
  const manualEvidence = {
    ...baseCategory,
    checklistReviewedAt: "2026-08-12T12:00:00.000Z",
    checklistReviewedByProfileId: REVIEWER_ID,
    checklistReviewSource: "manual",
  };
  const rewrittenManualEvidence = buildChecklistApprovalDisclosure({
    currentProgress: { __checklist_profile: profile(), health_admin: manualEvidence },
    currentRevision: 16,
    templates: CATEGORY_CHECKLISTS,
    proposal: {
      kind: "checklist_situation",
      baseRevision: 16,
      progressPatch: {
        __checklist_profile: profile({ reviewedAt: "2026-08-12T12:05:00.000Z" }),
        health_admin: {
          ...baseCategory,
          checklistReviewedAt: "2026-08-12T12:05:00.000Z",
          checklistReviewedByProfileId: REVIEWER_ID,
          checklistReviewSource: "situation_profile",
        },
      },
    },
  });
  assert.deepEqual(rewrittenManualEvidence, {
    status: "unsafe",
    reason: "hidden_review_delta",
  });

  const added = buildChecklistApprovalDisclosure({
    currentProgress: { health_admin: baseCategory },
    currentRevision: 17,
    templates: CATEGORY_CHECKLISTS,
    proposal: {
      kind: "checklist_situation",
      baseRevision: 17,
      progressPatch: {
        __checklist_profile: profile(),
        health_admin: {
          ...baseCategory,
          checklistReviewedAt: "2026-08-12T12:00:00.000Z",
          checklistReviewedByProfileId: REVIEWER_ID,
          checklistReviewSource: "situation_profile",
        },
      },
    },
  });
  assert.equal(added.status, "ready");
  if (added.status === "ready") {
    assert.equal(added.categories[0]?.reviewChangeKind, "added");
  }

  const cleared = buildChecklistApprovalDisclosure({
    currentProgress: {
      __checklist_profile: profile(),
      health_admin: {
        ...baseCategory,
        checklistReviewedAt: "2026-08-12T12:00:00.000Z",
        checklistReviewedByProfileId: REVIEWER_ID,
        checklistReviewSource: "situation_profile",
      },
    },
    currentRevision: 18,
    templates: CATEGORY_CHECKLISTS,
    proposal: {
      kind: "checklist_situation",
      baseRevision: 18,
      progressPatch: {
        __checklist_profile: profile({ reviewedAt: "2026-08-12T12:05:00.000Z" }),
        health_admin: baseCategory,
      },
    },
  });
  assert.equal(cleared.status, "ready");
  if (cleared.status === "ready") {
    assert.equal(cleared.categories[0]?.reviewChangeKind, "cleared");
  }
});
