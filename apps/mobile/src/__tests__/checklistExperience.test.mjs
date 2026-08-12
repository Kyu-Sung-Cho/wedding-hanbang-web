import assert from "node:assert/strict";
import test from "node:test";

import {
  applyChecklistItemUpdate,
  applyChecklistItemPatchForStage,
  buildChecklistCategoryOptions,
  buildChecklistCategoryReviewPresentation,
  buildChecklistEmptyFocusPresentation,
  buildChecklistSituationPreviewSubmission,
  buildManualChecklistReviewEvidence,
  buildChecklistFocus,
  buildSituationModalFooter,
  captureChecklistItemEditBaseline,
  createChecklistMutationQueue,
  createChecklistSituationPreviewPlan,
  executeChecklistDetailMutationPlan,
  filterChecklistCategories,
  findChecklistItemTarget,
  formatChecklistCompletionAudit,
  getMobileChecklistGuidance,
  getChecklistSharingNotice,
  hasChecklistItemEditConflict,
  hasChecklistItemMutationConflict,
  isChecklistSituationApplicationNoop,
  normalizeChecklistItem,
  normalizeChecklistNote,
  planChecklistDetailMutations,
  readChecklistItemsSnapshot,
  resolveProtectedChecklistMutationStatus,
  validateChecklistDueDate,
} from "../lib/checklistExperience.mjs";

const templates = [
  {
    key: "venue",
    label: "결혼식장",
    ddayDeadline: 30,
    items: [
      { id: "venue_01", label: "후보 비교", done: false },
      { id: "venue_02", label: "계약서 확인", done: false },
    ],
  },
  {
    key: "ceremony",
    label: "결혼식 진행",
    ddayDeadline: 0,
    items: [{ id: "ceremony_01", label: "진행표 확인", done: false }],
  },
];

test("schedule category choices persist stable keys while rendering Korean labels", () => {
  assert.deepEqual(buildChecklistCategoryOptions(templates), [
    { key: "venue", label: "결혼식장" },
    { key: "ceremony", label: "결혼식 진행" },
    { key: "other", label: "기타" },
  ]);
});

test("legacy done booleans become an explicit execution state without losing metadata", () => {
  assert.deepEqual(
    normalizeChecklistItem({
      id: "venue_01",
      label: "후보 비교",
      done: true,
      dueDate: "2026-08-12",
      note: "두 곳 비교",
    }),
    {
      id: "venue_01",
      label: "후보 비교",
      done: true,
      state: "completed",
      dueDate: "2026-08-12",
      note: "두 곳 비교",
    },
  );
  assert.deepEqual(
    readChecklistItemsSnapshot([{ id: "legacy_contract", completed: true }]),
    [{ id: "legacy_contract", label: "legacy_contract", done: true, state: "completed" }],
  );
});

test("protected edits materialize legacy or newly expanded checklists without treating derived status repair as a conflict", () => {
  const legacy = resolveProtectedChecklistMutationStatus(
    {
      status: "completed",
      checklist: [{ id: "venue_01", completed: true }],
    },
    [
      { id: "venue_01", label: "legacy", done: true, state: "completed" },
      { id: "venue_02", label: "new", done: false, state: "todo" },
    ],
    "in_progress",
  );
  assert.deepEqual(legacy, { conflict: false, status: "in_progress" });

  const inconsistentCanonical = resolveProtectedChecklistMutationStatus(
    {
      status: "completed",
      checklist: [{ id: "venue_01", label: "existing", done: false, state: "todo" }],
    },
    [{ id: "venue_01", label: "existing", done: false, state: "todo" }],
    "not_started",
  );
  assert.deepEqual(inconsistentCanonical, { conflict: true, status: "completed" });
});

test("item state is the source of truth and completion audit fields move with it", () => {
  const completed = applyChecklistItemUpdate(
    { id: "venue_01", label: "후보 비교", done: false, state: "waiting" },
    { state: "completed" },
    { now: "2026-08-12T08:30:00.000Z", profileId: "profile-1" },
  );
  assert.equal(completed.done, true);
  assert.equal(completed.completedAt, "2026-08-12T08:30:00.000Z");
  assert.equal(completed.completedByProfileId, "profile-1");

  const reopened = applyChecklistItemUpdate(completed, { state: "blocked" }, {
    now: "2026-08-13T00:00:00.000Z",
    profileId: "profile-1",
  });
  assert.equal(reopened.done, false);
  assert.equal(reopened.completedAt, null);
  assert.equal(reopened.completedByProfileId, null);
});

test("editing a legacy completed item preserves the absence of completion provenance", () => {
  const updated = applyChecklistItemUpdate(
    { id: "legacy", label: "legacy", done: true, state: "completed" },
    { note: "memo" },
    { now: "2026-08-12T08:30:00.000Z", profileId: "profile-1" },
  );

  assert.equal(updated.state, "completed");
  assert.equal(updated.note, "memo");
  assert.equal(Object.hasOwn(updated, "completedAt"), false);
  assert.equal(Object.hasOwn(updated, "completedByProfileId"), false);
});

test("today board separates overdue, today, and this-week tasks and omits completed or N/A items", () => {
  const categories = [
    {
      key: "venue",
      label: "결혼식장",
      ddayDeadline: 30,
      status: "in_progress",
      items: [
        { id: "venue_01", label: "후보 비교", done: false, state: "blocked", dueDate: "2026-08-11" },
        { id: "venue_02", label: "계약서 확인", done: false, state: "waiting", dueDate: "2026-08-12" },
      ],
    },
    {
      key: "ceremony",
      label: "결혼식 진행",
      ddayDeadline: 0,
      status: "in_progress",
      items: [
        { id: "ceremony_01", label: "진행표 확인", done: false, state: "todo", dueDate: "2026-08-17" },
        { id: "ceremony_02", label: "생략", done: false, state: "not_applicable", dueDate: "2026-08-12" },
        { id: "ceremony_03", label: "완료", done: true, state: "completed", dueDate: "2026-08-10" },
      ],
    },
  ];

  const focus = buildChecklistFocus(categories, "2026-08-12");
  assert.deepEqual(focus.overdue.map((item) => item.itemId), ["venue_01"]);
  assert.deepEqual(focus.today.map((item) => item.itemId), ["venue_02"]);
  assert.deepEqual(focus.thisWeek.map((item) => item.itemId), ["ceremony_01"]);
});

test("search, state, owner, and completed visibility filters compose", () => {
  const categories = [{
    key: "venue",
    label: "결혼식장",
    status: "in_progress",
    items: [
      { id: "a", label: "계약서 확인", done: false, state: "blocked", assignee: { kind: "member", profileId: "me" } },
      { id: "b", label: "견적 비교", done: true, state: "completed", assignee: { kind: "couple" } },
    ],
  }];

  const filtered = filterChecklistCategories(categories, {
    query: "계약",
    state: "blocked",
    owner: "mine",
    hideCompleted: true,
    profileId: "me",
  });
  assert.deepEqual(filtered[0].items.map((item) => item.id), ["a"]);
});

test("consumer aliases, partner ownership, and category-level N/A remain discoverable", () => {
  const categories = [
    {
      key: "meeting",
      label: "부모님 첫 만남",
      status: "in_progress",
      items: [{ id: "meeting_01", label: "날짜 조율", done: false }],
    },
    {
      key: "studio",
      label: "웨딩 사진 촬영",
      status: "in_progress",
      items: [{ id: "studio_01", label: "후보 비교", done: false, assignee: { kind: "member", profileId: "partner" } }],
    },
    {
      key: "venue",
      label: "결혼식장",
      status: "not_applicable",
      items: [{ id: "venue_01", label: "후보 비교", done: false }],
    },
  ];

  assert.deepEqual(
    filterChecklistCategories(categories, { query: "상견례" }).map((category) => category.key),
    ["meeting"],
  );
  assert.deepEqual(
    filterChecklistCategories(categories, { query: "스드메" }).map((category) => category.key),
    ["studio"],
  );
  assert.deepEqual(
    filterChecklistCategories(categories, { owner: "partner", profileId: "me" })[0].items.map((item) => item.id),
    ["studio_01"],
  );
  assert.deepEqual(
    filterChecklistCategories(categories, { state: "not_applicable" }).map((category) => category.key),
    ["venue"],
  );
});

test("rapid checklist saves are serialized so each CAS reads the latest revision", async () => {
  const order = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const queue = createChecklistMutationQueue();

  const first = queue.enqueue(async () => {
    order.push("first:start");
    await firstGate;
    order.push("first:end");
  });
  const second = queue.enqueue(async () => {
    order.push("second:start");
    order.push("second:end");
  });

  await Promise.resolve();
  assert.deepEqual(order, ["first:start"]);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(order, ["first:start", "first:end", "second:start", "second:end"]);
  assert.equal(queue.pendingCount, 0);
});

test("empty TODAY FIRST renders review suggestions while the situation footer remains modal-only", () => {
  const suggestions = [{ categoryKey: "venue", categoryLabel: "결혼식장" }];
  assert.deepEqual(buildChecklistEmptyFocusPresentation("today", suggestions), {
    emptyTitle: "이 구간에 저장된 할 일이 없어요",
    reviewTitle: "먼저 검토할 분야",
    reviewSuggestions: suggestions,
  });
  assert.deepEqual(buildChecklistEmptyFocusPresentation("overdue", []), {
    emptyTitle: "저장된 기한 기준, 늦은 일이 없어요",
    reviewTitle: null,
    reviewSuggestions: [],
  });

  assert.deepEqual(buildSituationModalFooter(false), {
    secondaryAction: "dismiss",
    secondaryLabel: "나중에",
    primaryLabel: "제외 항목 미리보기",
  });
  assert.deepEqual(buildSituationModalFooter(true), {
    secondaryAction: "edit",
    secondaryLabel: "선택 수정",
    primaryLabel: "확인하고 적용",
  });
});

test("manual category and item mutations create review evidence once and preserve prior provenance", () => {
  assert.deepEqual(buildManualChecklistReviewEvidence({}, {
    now: "2026-08-12T10:00:00.000Z",
    profileId: "profile-1",
  }), {
    checklistReviewedAt: "2026-08-12T10:00:00.000Z",
    checklistReviewedByProfileId: "profile-1",
    checklistReviewSource: "manual",
  });

  assert.deepEqual(buildManualChecklistReviewEvidence({
    checklistReviewedAt: "2026-08-10T08:00:00.000Z",
    checklistReviewedByProfileId: null,
    checklistReviewSource: "situation_profile",
  }, {
    now: "2026-08-12T10:00:00.000Z",
    profileId: "profile-1",
  }), {
    checklistReviewedAt: "2026-08-10T08:00:00.000Z",
    checklistReviewedByProfileId: null,
    checklistReviewSource: "situation_profile",
  });

  assert.deepEqual(buildManualChecklistReviewEvidence({
    checklistReviewedAt: "2026-08-10T08:00:00.000Z",
    checklistReviewedByProfileId: null,
    checklistReviewSource: "situation_profile",
  }, {
    now: "2026-08-12T10:00:00.000Z",
    profileId: "profile-1",
    preserveExisting: true,
  }), {
    checklistReviewedAt: "2026-08-10T08:00:00.000Z",
    checklistReviewedByProfileId: null,
    checklistReviewSource: "situation_profile",
  });

  assert.deepEqual(buildManualChecklistReviewEvidence({
    checklistReviewedAt: "2026-08-11T07:00:00.000Z",
    checklistReviewedByProfileId: "profile-2",
    checklistReviewSource: "manual",
  }, {
    now: "2026-08-12T10:00:00.000Z",
    profileId: "profile-1",
  }), {
    checklistReviewedAt: "2026-08-11T07:00:00.000Z",
    checklistReviewedByProfileId: "profile-2",
    checklistReviewSource: "manual",
  });
});

test("situation consent submits the exact patch and revision shown in preview", () => {
  const previewApplication = {
    progressPatch: {
      venue: {
        status: "not_applicable",
        checklist: [{ id: "venue_01", label: "후보 비교", done: false, state: "not_applicable" }],
      },
      __checklist_profile: { version: 1, reviewedAt: "2026-08-12T10:00:00.000Z" },
    },
    profile: { version: 1, reviewedAt: "2026-08-12T10:00:00.000Z" },
    excludedItemIds: ["venue_01"],
    restoredItemIds: [],
  };
  const plan = createChecklistSituationPreviewPlan({
    coupleId: "couple-1",
    ownerId: "profile-1",
    stateRevision: 17,
    application: previewApplication,
  });

  const laterApplication = {
    progressPatch: { venue: { status: "not_started", checklist: [] } },
    profile: { version: 1 },
    excludedItemIds: [],
    restoredItemIds: ["venue_01"],
  };
  assert.notDeepEqual(laterApplication.progressPatch, previewApplication.progressPatch);
  assert.deepEqual(buildChecklistSituationPreviewSubmission(plan), {
    expected_revision: 17,
    progress_patch: previewApplication.progressPatch,
  });
  assert.deepEqual(plan.excludedItemIds, ["venue_01"]);
  assert.deepEqual(plan.restoredItemIds, []);
});

test("an unchanged situation profile is a no-op even when reviewedAt would be refreshed", () => {
  const currentProfile = {
    answers: { ceremony: "yes" },
    autoExcludedItemIds: ["b", "a"],
  };
  assert.equal(isChecklistSituationApplicationNoop(currentProfile, {
    profile: {
      answers: { ceremony: "yes" },
      autoExcludedItemIds: ["a", "b"],
      reviewedAt: "2026-08-12T09:00:00.000Z",
    },
    categoryProgressPatch: {},
  }), true);
  assert.equal(isChecklistSituationApplicationNoop(currentProfile, {
    profile: { answers: { ceremony: "no" }, autoExcludedItemIds: ["a", "b"] },
    categoryProgressPatch: {},
  }), false);
});

test("unreviewed categories expose exactly two applicability choices", () => {
  assert.deepEqual(buildChecklistCategoryReviewPresentation(false, false), {
    showChoices: true,
    question: "이 분야가 우리 준비에 필요한가요?",
    applicableLabel: "우리에게 필요한 준비예요",
    notApplicableLabel: "필요 없는 준비예요",
  });
  assert.equal(buildChecklistCategoryReviewPresentation(true, false).showChoices, false);
  assert.equal(buildChecklistCategoryReviewPresentation(false, true).showChoices, false);
});

test("item detail explains the couple-sharing boundary for linked and solo members", () => {
  assert.equal(getChecklistSharingNotice(true), "항목 기한과 메모는 파트너와 공유돼요.");
  assert.equal(
    getChecklistSharingNotice(false),
    "항목 기한과 메모는 파트너를 연결하면 함께 공유돼요.",
  );
});

test("a detail baseline detects fresh edits before a stale draft can overwrite them", () => {
  const opened = {
    id: "venue_01",
    label: "계약 조건 확인",
    done: false,
    state: "waiting",
    assignee: { kind: "member", profileId: "profile-2" },
    dueDate: "2026-08-20",
    note: "취소 조건 회신 대기",
    completedAt: null,
    completedByProfileId: null,
  };
  const baseline = captureChecklistItemEditBaseline(opened);

  assert.equal(hasChecklistItemEditConflict(baseline, { ...opened }), false);
  assert.equal(hasChecklistItemEditConflict(baseline, {
    ...opened,
    note: "파트너가 환불 조건을 확인함",
  }), true);
  assert.equal(hasChecklistItemEditConflict(baseline, {
    ...opened,
    assignee: { kind: "couple" },
  }), true);
  assert.equal(hasChecklistItemEditConflict(baseline, {
    ...opened,
    state: "completed",
    done: true,
    completedAt: "2026-08-12T11:00:00.000Z",
    completedByProfileId: "profile-2",
  }), true);
  assert.equal(hasChecklistItemEditConflict(baseline, null), true);
});

test("every item mutation fails closed when the fresh category is not applicable", () => {
  const freshItem = {
    id: "venue_01",
    label: "계약 조건 확인",
    done: false,
    state: "todo",
  };
  assert.equal(hasChecklistItemMutationConflict({
    categoryStatus: "not_applicable",
    expectedBaseline: null,
    freshItem,
  }), true);
  assert.equal(hasChecklistItemMutationConflict({
    categoryStatus: "not_started",
    expectedBaseline: null,
    freshItem,
  }), false);
});

test("a mixed detail edit becomes a routine request followed by an assignee-only request", () => {
  const baseline = captureChecklistItemEditBaseline({
    id: "venue_01",
    label: "계약 조건 확인",
    done: false,
    state: "todo",
    dueDate: null,
    note: "",
  });
  const plan = planChecklistDetailMutations(baseline, {
    state: "waiting",
    assignee: { kind: "member", profileId: "profile-2" },
    dueDate: "2026-08-20",
    note: "취소 조건 회신 대기",
  });

  assert.deepEqual(plan.routinePatch, {
    state: "waiting",
    dueDate: "2026-08-20",
    note: "취소 조건 회신 대기",
  });
  assert.deepEqual(plan.assigneePatch, {
    assignee: { kind: "member", profileId: "profile-2" },
  });
  assert.equal(Object.hasOwn(plan.routinePatch, "assignee"), false);
  assert.deepEqual(Object.keys(plan.assigneePatch), ["assignee"]);
});

test("an assignee stage preserves every routine and audit field byte-for-byte", () => {
  const current = {
    id: "venue_01",
    label: "계약 조건 확인",
    done: false,
    state: "todo",
    dueDate: null,
    note: "",
  };
  const updated = applyChecklistItemPatchForStage(
    current,
    { assignee: { kind: "couple" } },
    { now: "2026-08-12T10:00:00.000Z", profileId: "profile-1" },
    "assignee",
  );

  assert.deepEqual(updated, { ...current, assignee: { kind: "couple" } });
  assert.equal(Object.hasOwn(updated, "completedAt"), false);
  assert.equal(Object.hasOwn(updated, "completedByProfileId"), false);
  assert.deepEqual(
    applyChecklistItemPatchForStage(
      { ...current, assignee: { kind: "couple" } },
      { assignee: null },
      { now: "2026-08-12T10:00:00.000Z", profileId: "profile-1" },
      "assignee",
    ),
    { ...current, assignee: null },
  );
});

test("mixed detail execution rebases the assignee request on the applied routine item", async () => {
  const openedItem = {
    id: "venue_01",
    label: "계약 조건 확인",
    done: false,
    state: "todo",
    dueDate: null,
    note: "",
  };
  const baseline = captureChecklistItemEditBaseline(openedItem);
  const calls = [];
  const execution = await executeChecklistDetailMutationPlan({
    routinePatch: { state: "waiting", note: "회신 대기" },
    assigneePatch: { assignee: { kind: "couple" } },
  }, baseline, async (patch, expectedBaseline) => {
    calls.push({ patch, expectedBaseline });
    if (calls.length === 1) {
      return {
        status: "applied",
        item: {
          ...openedItem,
          ...patch,
          state: "waiting",
          note: "회신 대기",
        },
      };
    }
    return {
      status: "pending_partner",
      item: { ...openedItem, state: "waiting", note: "회신 대기", ...patch },
    };
  });

  assert.equal(calls.length, 2);
  assert.deepEqual(Object.keys(calls[0].patch).sort(), ["note", "state"]);
  assert.deepEqual(Object.keys(calls[1].patch), ["assignee"]);
  assert.equal(calls[1].expectedBaseline.state, "waiting");
  assert.equal(calls[1].expectedBaseline.note, "회신 대기");
  assert.deepEqual(execution, {
    status: "pending_partner",
    stage: "assignee",
    routineApplied: true,
  });
});

test("a routine conflict stops a mixed detail plan before any assignee request", async () => {
  const baseline = captureChecklistItemEditBaseline({
    id: "venue_01",
    label: "계약 조건 확인",
    done: false,
    state: "todo",
  });
  const calls = [];
  const execution = await executeChecklistDetailMutationPlan({
    routinePatch: { note: "내 메모" },
    assigneePatch: { assignee: { kind: "couple" } },
  }, baseline, async (patch, expectedBaseline, stage) => {
    calls.push({ patch, expectedBaseline, stage });
    return { status: "conflict" };
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].stage, "routine");
  assert.deepEqual(execution, {
    status: "conflict",
    stage: "routine",
    routineApplied: false,
  });
});

test("a TODAY FIRST recommendation resolves the exact category and item needed by the detail sheet", () => {
  const categories = [{
    key: "venue",
    label: "결혼식장",
    items: [{ id: "venue_01", label: "후보 비교", done: false }],
  }];
  const target = findChecklistItemTarget(categories, {
    categoryKey: "venue",
    itemId: "venue_01",
  });
  assert.equal(target?.category, categories[0]);
  assert.equal(target?.item, categories[0].items[0]);
  assert.equal(findChecklistItemTarget(categories, {
    categoryKey: "venue",
    itemId: "missing",
  }), null);
});

test("completion audit names the exact couple member and omits incomplete audit pairs", () => {
  const members = new Map([
    ["me", "지우"],
    ["partner", "서준"],
  ]);
  assert.equal(
    formatChecklistCompletionAudit({
      completedAt: "2026-08-12T07:30:00.000Z",
      completedByProfileId: "partner",
    }, members),
    "서준님이 8월 12일 완료",
  );
  assert.equal(
    formatChecklistCompletionAudit({
      completedAt: "2026-08-11T15:30:00.000Z",
      completedByProfileId: "me",
    }, members),
    "지우님이 8월 12일 완료",
    "completion dates use the Korean product day rather than the UTC date key",
  );
  assert.equal(formatChecklistCompletionAudit({ completedAt: null }, members), null);
  assert.equal(formatChecklistCompletionAudit({
    completedAt: "2026-08-12T07:30:00.000Z",
    completedByProfileId: "unknown",
  }, members), null);
});

test("item editor sends API-safe notes and rejects impossible calendar dates", () => {
  assert.equal(normalizeChecklistNote("첫 줄\n둘째\t줄\u2066"), "첫 줄 둘째 줄");
  assert.equal(validateChecklistDueDate(""), true);
  assert.equal(validateChecklistDueDate("2026-08-12"), true);
  assert.equal(validateChecklistDueDate("2026-02-29"), false);
  assert.equal(validateChecklistDueDate("2026-13-01"), false);
});

test("mobile item guidance keeps official source titles, links, and checked dates", () => {
  const sourceRefs = [{
    title: "공식 안내",
    url: "https://example.go.kr/guide",
    checkedAt: "2026-08-12",
  }];
  assert.equal(
    getMobileChecklistGuidance(
      { tip: "기본 팁" },
      { label: "혼인신고" },
      { completionCriteria: "서류 확인", tip: "실전 팁", caution: "주의", sourceRefs },
    ).sourceRefs,
    sourceRefs,
  );
});

test("stored checklist parsing fails closed instead of hiding only malformed or duplicate rows", () => {
  assert.deepEqual(readChecklistItemsSnapshot(undefined), undefined);
  assert.deepEqual(readChecklistItemsSnapshot([
    { id: "venue_01", label: "후보 비교", done: false },
  ]), [
    { id: "venue_01", label: "후보 비교", done: false, state: "todo" },
  ]);
  assert.throws(() => readChecklistItemsSnapshot([
    { id: "venue_01", label: "후보 비교", done: false },
    { id: "broken", done: false },
  ]), /invalid checklist snapshot/);
  assert.throws(() => readChecklistItemsSnapshot([
    { id: "venue_01", label: "후보 비교", done: false },
    { id: "venue_01", label: "중복", done: false },
  ]), /invalid checklist snapshot/);
});
