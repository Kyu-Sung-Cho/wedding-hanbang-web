import assert from "node:assert/strict";
import test from "node:test";

import {
  applyPlanningChecklistProfile,
  DEFAULT_PLANNING_CHECKLIST_PROFILE_ANSWERS,
  isCanonicalPlanningChecklistProfile,
  normalizePlanningChecklistProfile,
  PLANNING_CHECKLIST_PROFILE_KEY,
  type PlanningChecklistGathering,
  type PlanningChecklistProfile,
} from "../src/utils/planningChecklist";
import { CHECKLIST_ITEM_GUIDANCE } from "../src/constants/checklistItemGuidance";
import { CATEGORY_CHECKLISTS } from "../src/constants/weddingPlanning";

const REVIEWED_AT = "2026-08-13T00:00:00.000Z";

test("v1 상황 설정을 gathering=undecided인 canonical v2로 정규화한다", () => {
  const v1 = {
    version: 1,
    reviewedAt: REVIEWED_AT,
    answers: Object.fromEntries(
      Object.entries(DEFAULT_PLANNING_CHECKLIST_PROFILE_ANSWERS).filter(
        ([key]) => key !== "gathering",
      ),
    ),
    autoExcludedItemIds: ["venue_01"],
  };

  assert.equal(isCanonicalPlanningChecklistProfile(v1), true);
  assert.deepEqual(normalizePlanningChecklistProfile(v1), {
    version: 2,
    reviewedAt: REVIEWED_AT,
    answers: {
      ...DEFAULT_PLANNING_CHECKLIST_PROFILE_ANSWERS,
      gathering: "undecided",
    },
    autoExcludedItemIds: ["venue_01"],
  });
});

test("v1은 12개, v2는 gathering을 포함한 13개 answer만 canonical로 인정한다", () => {
  const v2 = {
    version: 2,
    reviewedAt: REVIEWED_AT,
    answers: DEFAULT_PLANNING_CHECKLIST_PROFILE_ANSWERS,
    autoExcludedItemIds: [],
  };
  const v1Answers = Object.fromEntries(
    Object.entries(DEFAULT_PLANNING_CHECKLIST_PROFILE_ANSWERS).filter(
      ([key]) => key !== "gathering",
    ),
  );

  assert.equal(isCanonicalPlanningChecklistProfile(v2), true);
  assert.equal(isCanonicalPlanningChecklistProfile({ ...v2, version: 1 }), false);
  assert.equal(isCanonicalPlanningChecklistProfile({
    ...v2,
    answers: v1Answers,
  }), false);
  assert.equal(isCanonicalPlanningChecklistProfile({
    ...v2,
    answers: { ...v2.answers, gathering: "party" },
  }), false);
});

function applyGatheringProfile(gathering: PlanningChecklistGathering) {
  return applyPlanningChecklistProfile(
    CATEGORY_CHECKLISTS,
    {},
    {
      version: 2,
      reviewedAt: REVIEWED_AT,
      answers: {
        ...DEFAULT_PLANNING_CHECKLIST_PROFILE_ANSWERS,
        ceremony: "no",
        gathering,
      },
      autoExcludedItemIds: [],
    },
    CHECKLIST_ITEM_GUIDANCE,
    "profile-1",
  );
}

test("예식 없음에서 모임 유형별 exact 제외/유지 개수를 보장한다", () => {
  const expected = {
    none: { excluded: 78, remaining: 140 },
    family_meal: { excluded: 61, remaining: 157 },
    reception: { excluded: 53, remaining: 165 },
    undecided: { excluded: 53, remaining: 165 },
  } as const;

  assert.equal(CATEGORY_CHECKLISTS.length, 27);
  assert.equal(
    new Set(CATEGORY_CHECKLISTS.flatMap((category) => category.items.map((item) => item.id))).size,
    218,
  );
  for (const gathering of Object.keys(expected) as PlanningChecklistGathering[]) {
    const application = applyGatheringProfile(gathering);
    assert.deepEqual(
      {
        excluded: application.profile.autoExcludedItemIds.length,
        remaining: 218 - application.profile.autoExcludedItemIds.length,
      },
      expected[gathering],
      gathering,
    );
  }
});

test("장소·하객·하객 선물 항목이 가족 식사와 피로연 범위를 정확히 구분한다", () => {
  for (const itemNumber of [1, 2, 3, 5, 6, 7, 8]) {
    const itemId = `venue_${String(itemNumber).padStart(2, "0")}`;
    assert.deepEqual(CHECKLIST_ITEM_GUIDANCE[itemId].applicabilityTags, [
      "ceremony",
      "family_meal",
      "reception",
    ]);
  }
  assert.deepEqual(CHECKLIST_ITEM_GUIDANCE.venue_04.applicabilityTags, [
    "family_meal",
    "reception",
  ]);
  for (let itemNumber = 1; itemNumber <= 9; itemNumber += 1) {
    const itemId = `guests_${String(itemNumber).padStart(2, "0")}`;
    assert.deepEqual(CHECKLIST_ITEM_GUIDANCE[itemId].applicabilityTags, [
      "ceremony",
      "family_meal",
      "reception",
    ]);
  }
  assert.deepEqual(CHECKLIST_ITEM_GUIDANCE.guests_10.applicabilityTags, [
    "ceremony",
    "reception",
  ]);
  for (let itemNumber = 1; itemNumber <= 7; itemNumber += 1) {
    const itemId = `gift_${String(itemNumber).padStart(2, "0")}`;
    assert.deepEqual(CHECKLIST_ITEM_GUIDANCE[itemId].applicabilityTags, ["reception"]);
  }
});

test("예식이 있으면 별도 축하 모임이 없어도 하객 운영 항목을 숨기지 않는다", () => {
  const application = applyPlanningChecklistProfile(
    CATEGORY_CHECKLISTS,
    {},
    {
      version: 2,
      reviewedAt: REVIEWED_AT,
      answers: {
        ...DEFAULT_PLANNING_CHECKLIST_PROFILE_ANSWERS,
        ceremony: "yes",
        gathering: "none",
      },
      autoExcludedItemIds: [],
    },
    CHECKLIST_ITEM_GUIDANCE,
    "profile-1",
  );

  for (let itemNumber = 1; itemNumber <= 10; itemNumber += 1) {
    const itemId = `guests_${String(itemNumber).padStart(2, "0")}`;
    assert.equal(application.profile.autoExcludedItemIds.includes(itemId), false, itemId);
  }
});

test("무예식 모임 경로는 결혼식장·하객을 전제하지 않는 체크리스트 문구를 사용한다", () => {
  const venue = CATEGORY_CHECKLISTS.find((category) => category.key === "venue");
  const guests = CATEGORY_CHECKLISTS.find((category) => category.key === "guests");
  const gift = CATEGORY_CHECKLISTS.find((category) => category.key === "gift");

  assert.equal(venue?.label, "예식·모임 장소");
  assert.equal(venue?.items.find((item) => item.id === "venue_01")?.label, "원하는 장소 형태 정하기");
  assert.equal(venue?.items.find((item) => item.id === "venue_04")?.label, "참석자 식사 메뉴와 1인당 금액 확인");
  assert.equal(venue?.items.find((item) => item.id === "venue_05")?.label, "예식·모임 시간대 정하기");
  assert.equal(venue?.items.find((item) => item.id === "venue_08")?.label, "대기·주차·사진 촬영 공간 확인");
  assert.equal(guests?.label, "초대·참석 답변·이동");
  assert.equal(guests?.items.find((item) => item.id === "guests_09")?.label, "정보 수정·예식·모임 변경·긴급 연락을 전달할 방법 준비");
  assert.equal(gift?.label, "참석자에게 드릴 선물");
  assert.equal(gift?.items.find((item) => item.id === "gift_07")?.label, "예식·모임 장소에 도착할 날짜와 위치 확인");
  assert.equal(venue?.tip.includes("예상 하객 수"), false);
  assert.equal(guests?.tip.includes("하객 수"), false);
});

function transition(from: PlanningChecklistGathering, to: PlanningChecklistGathering) {
  const before = applyGatheringProfile(from);
  return applyPlanningChecklistProfile(
    CATEGORY_CHECKLISTS,
    before.progressPatch,
    {
      version: 2,
      reviewedAt: "2026-08-13T01:00:00.000Z",
      answers: {
        ...DEFAULT_PLANNING_CHECKLIST_PROFILE_ANSWERS,
        ceremony: "no",
        gathering: to,
      },
      autoExcludedItemIds: [],
    },
    CHECKLIST_ITEM_GUIDANCE,
    "profile-1",
  );
}

test("none→family→reception 전이의 복원과 reception→none 제외를 정확히 소유한다", () => {
  assert.equal(transition("none", "family_meal").restoredItemIds.length, 17);
  assert.equal(transition("family_meal", "reception").restoredItemIds.length, 8);
  assert.equal(transition("reception", "none").excludedItemIds.length, 25);
  assert.equal(transition("none", "reception").restoredItemIds.length, 25);
});

test("전이 시 profile 소유 제외만 복원하고 수동 해당 없음과 작업 메타데이터를 보존한다", () => {
  const venue = CATEGORY_CHECKLISTS.find((category) => category.key === "venue")!;
  const previousProfile: PlanningChecklistProfile = {
    version: 2,
    reviewedAt: "2026-08-12T00:00:00.000Z",
    answers: {
      ...DEFAULT_PLANNING_CHECKLIST_PROFILE_ANSWERS,
      ceremony: "no",
      gathering: "none",
    },
    autoExcludedItemIds: ["venue_01"],
  };
  const progress = {
    [PLANNING_CHECKLIST_PROFILE_KEY]: previousProfile,
    venue: {
      status: "in_progress",
      checklistReviewedAt: "2026-08-12T02:00:00.000Z",
      checklistReviewedByProfileId: "profile-1",
      checklistReviewSource: "manual",
      checklist: venue.items.map((item) => ({
        ...item,
        ...(item.id === "venue_01"
          ? {
              state: "not_applicable" as const,
              assignee: { kind: "couple" as const },
              dueDate: "2026-09-01",
              note: "모임 유형 확정 뒤 재검토",
            }
          : item.id === "venue_02"
            ? {
                state: "not_applicable" as const,
                assignee: { kind: "external" as const, label: "가족" },
                note: "직접 제외",
              }
            : item.id === "venue_03"
              ? {
                  state: "completed" as const,
                  done: true,
                  completedAt: "2026-08-12T03:00:00.000Z",
                  completedByProfileId: "profile-1",
                }
              : { state: "todo" as const }),
      })),
    },
  };
  const result = applyPlanningChecklistProfile(
    CATEGORY_CHECKLISTS,
    progress,
    {
      ...previousProfile,
      reviewedAt: REVIEWED_AT,
      answers: { ...previousProfile.answers, gathering: "reception" },
      autoExcludedItemIds: [],
    },
    CHECKLIST_ITEM_GUIDANCE,
    "profile-1",
  );
  const checklist = result.categoryProgressPatch.venue.checklist!;

  assert.deepEqual(result.restoredItemIds, ["venue_01"]);
  assert.deepEqual(checklist.find((item) => item.id === "venue_01"), {
    id: "venue_01",
    label: "원하는 장소 형태 정하기",
    done: false,
    state: "todo",
    assignee: { kind: "couple" },
    dueDate: "2026-09-01",
    note: "모임 유형 확정 뒤 재검토",
  });
  assert.equal(checklist.find((item) => item.id === "venue_02")?.state, "not_applicable");
  assert.equal(checklist.find((item) => item.id === "venue_02")?.note, "직접 제외");
  assert.equal(checklist.find((item) => item.id === "venue_03")?.state, "completed");
  assert.equal(checklist.find((item) => item.id === "venue_03")?.completedAt, "2026-08-12T03:00:00.000Z");
  assert.deepEqual(
    {
      at: result.categoryProgressPatch.venue.checklistReviewedAt,
      by: result.categoryProgressPatch.venue.checklistReviewedByProfileId,
      source: result.categoryProgressPatch.venue.checklistReviewSource,
    },
    { at: "2026-08-12T02:00:00.000Z", by: "profile-1", source: "manual" },
  );
});
