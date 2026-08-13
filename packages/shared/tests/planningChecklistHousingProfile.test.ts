import assert from "node:assert/strict";
import test from "node:test";

import {
  CHECKLIST_ITEM_GUIDANCE,
  CHECKLIST_ITEM_GUIDANCE_SOURCES,
} from "../src/constants/checklistItemGuidance";
import { CATEGORY_CHECKLISTS } from "../src/constants/weddingPlanning";
import {
  applyPlanningChecklistProfile,
  DEFAULT_PLANNING_CHECKLIST_PROFILE_ANSWERS,
  PLANNING_CHECKLIST_PROFILE_KEY,
  type PlanningChecklistProfile,
} from "../src/utils/planningChecklist";

const REVIEWED_AT = "2026-08-13T00:00:00.000Z";
const HOME_ADMIN_TEMPLATE = CATEGORY_CHECKLISTS.find(
  (category) => category.key === "home_admin",
)!;

function applyHousingProfile(housing: PlanningChecklistProfile["answers"]["housing"]) {
  return applyPlanningChecklistProfile(
    CATEGORY_CHECKLISTS,
    {},
    {
      version: 1,
      reviewedAt: REVIEWED_AT,
      answers: {
        ...DEFAULT_PLANNING_CHECKLIST_PROFILE_ANSWERS,
        housing,
      },
      autoExcludedItemIds: [],
    },
    CHECKLIST_ITEM_GUIDANCE,
    "profile-1",
  );
}

function itemStatesFor(
  application: ReturnType<typeof applyHousingProfile>,
  categoryKey: "housing" | "home_admin",
) {
  const template = CATEGORY_CHECKLISTS.find((category) => category.key === categoryKey)!;
  const checklist = application.categoryProgressPatch[categoryKey]?.checklist
    ?? template.items.map((item) => ({ ...item, state: "todo" as const }));
  return Object.fromEntries(checklist.map((item) => [item.id, item.state]));
}

test("housing=buy excludes lease-only work and keeps address registration", () => {
  const application = applyHousingProfile("buy");
  const excludedHomeAdminIds = application.categoryProgressPatch.home_admin.checklist!
    .filter((item) => item.state === "not_applicable")
    .map((item) => item.id);

  assert.deepEqual(excludedHomeAdminIds, [
    "home_admin_03",
    "home_admin_04",
    "home_admin_06",
  ]);
});

test("housing=other excludes housing transactions but keeps move and address administration", () => {
  const application = applyHousingProfile("other");

  assert.deepEqual(itemStatesFor(application, "housing"), {
    housing_01: "not_applicable",
    housing_02: "not_applicable",
    housing_03: "not_applicable",
    housing_04: "not_applicable",
    housing_05: "not_applicable",
    housing_06: "todo",
    housing_07: "todo",
  });
  assert.deepEqual(itemStatesFor(application, "home_admin"), {
    home_admin_01: "not_applicable",
    home_admin_02: "not_applicable",
    home_admin_03: "not_applicable",
    home_admin_04: "not_applicable",
    home_admin_05: "not_applicable",
    home_admin_06: "not_applicable",
    home_admin_07: "todo",
    home_admin_08: "todo",
    home_admin_09: "todo",
    home_admin_10: "todo",
    home_admin_11: "todo",
  });
});

test("housing=rent keeps lease, common official-document, and universal work", () => {
  const application = applyHousingProfile("rent");

  assert.deepEqual(itemStatesFor(application, "housing"), {
    housing_01: "todo",
    housing_02: "todo",
    housing_03: "todo",
    housing_04: "todo",
    housing_05: "todo",
    housing_06: "todo",
    housing_07: "todo",
  });
  assert.deepEqual(itemStatesFor(application, "home_admin"), {
    home_admin_01: "todo",
    home_admin_02: "todo",
    home_admin_03: "todo",
    home_admin_04: "todo",
    home_admin_05: "todo",
    home_admin_06: "todo",
    home_admin_07: "todo",
    home_admin_08: "todo",
    home_admin_09: "todo",
    home_admin_10: "todo",
    home_admin_11: "todo",
  });
});

test("housing=buy keeps the existing official-document task and offers purchase-only follow-up as a tip", () => {
  const application = applyHousingProfile("buy");
  const officialDocumentCheck = application.categoryProgressPatch.home_admin.checklist!
    .find((item) => item.id === "home_admin_02")!;
  const guidance = CHECKLIST_ITEM_GUIDANCE[officialDocumentCheck.id];

  assert.equal(officialDocumentCheck.state, "todo");
  assert.equal(
    officialDocumentCheck.label,
    "등기·건축물 정보·소유자와 대리 권한을 공식 문서로 확인",
  );
  assert.match(guidance.completionCriteria, /등기·건축물 정보.*소유자.*대리 계약/);
  assert.match(guidance.tip, /매수라면.*공식 실거래가.*현장 하자.*예상 수리비/);
});

test("housing=undecided excludes no housing work", () => {
  const application = applyHousingProfile("undecided");

  assert.deepEqual(
    application.excludedItemIds.filter((itemId) =>
      itemId.startsWith("housing_") || itemId.startsWith("home_admin_"),
    ),
    [],
  );
});

test("buy preserves completed official-document work and every saved metadata field", () => {
  const previousAutoExcludedItemIds = ["home_admin_06", "home_admin_07"];
  const previousProfile: PlanningChecklistProfile = {
    version: 1,
    reviewedAt: "2026-08-12T00:00:00.000Z",
    answers: {
      ...DEFAULT_PLANNING_CHECKLIST_PROFILE_ANSWERS,
      housing: "buy",
    },
    autoExcludedItemIds: previousAutoExcludedItemIds,
  };
  const savedChecklist = HOME_ADMIN_TEMPLATE.items.map((item) => ({
    ...item,
    ...(previousAutoExcludedItemIds.includes(item.id)
      ? { state: "not_applicable" as const }
      : { state: "todo" as const }),
    ...(item.id === "home_admin_02"
      ? {
          label: "등기·건축물 정보·소유자와 대리 권한을 공식 문서로 확인",
          done: true,
          state: "completed" as const,
          assignee: { kind: "couple" as const },
          dueDate: "2026-09-10",
          note: "등기 확인 완료",
          completedAt: "2026-08-12T09:00:00.000Z",
          completedByProfileId: "profile-1",
        }
      : {}),
    ...(item.id === "home_admin_07"
      ? {
          assignee: { kind: "external" as const, label: "행정 도움" },
          dueDate: "2026-10-01",
          note: "입주 뒤 확인",
        }
      : {}),
  }));
  const application = applyPlanningChecklistProfile(
    CATEGORY_CHECKLISTS,
    {
      [PLANNING_CHECKLIST_PROFILE_KEY]: previousProfile,
      home_admin: {
        category: "home_admin",
        status: "in_progress",
        checklist: savedChecklist,
        checklistReviewedAt: "2026-08-12T08:00:00.000Z",
        checklistReviewedByProfileId: "profile-1",
        checklistReviewSource: "manual",
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
  const homeAdmin = application.categoryProgressPatch.home_admin.checklist!;

  assert.deepEqual(
    {
      restoredItemIds: application.restoredItemIds,
      autoExcludedHomeIds: application.profile.autoExcludedItemIds.filter((itemId) =>
        itemId.startsWith("home_admin_"),
      ),
      legacyOfficialDocumentCheck: homeAdmin.find((item) => item.id === "home_admin_02"),
      addressRegistration: homeAdmin.find((item) => item.id === "home_admin_07"),
      reviewProvenance: {
        reviewedAt: application.categoryProgressPatch.home_admin.checklistReviewedAt,
        reviewedByProfileId:
          application.categoryProgressPatch.home_admin.checklistReviewedByProfileId,
        source: application.categoryProgressPatch.home_admin.checklistReviewSource,
      },
    },
    {
      restoredItemIds: ["home_admin_07"],
      autoExcludedHomeIds: ["home_admin_03", "home_admin_04", "home_admin_06"],
      legacyOfficialDocumentCheck: {
        id: "home_admin_02",
        label: "등기·건축물 정보·소유자와 대리 권한을 공식 문서로 확인",
        done: true,
        state: "completed",
        assignee: { kind: "couple" },
        dueDate: "2026-09-10",
        note: "등기 확인 완료",
        completedAt: "2026-08-12T09:00:00.000Z",
        completedByProfileId: "profile-1",
      },
      addressRegistration: {
        id: "home_admin_07",
        label: "실제 이사 날짜에 맞춰 전입신고 방법과 준비 서류 확인",
        done: false,
        state: "todo",
        assignee: { kind: "external", label: "행정 도움" },
        dueDate: "2026-10-01",
        note: "입주 뒤 확인",
      },
      reviewProvenance: {
        reviewedAt: "2026-08-12T08:00:00.000Z",
        reviewedByProfileId: "profile-1",
        source: "manual",
      },
    },
  );
});

test("common official-document work links to official records instead of lease-only guidance", () => {
  const application = applyHousingProfile("buy");
  const purchaseDueDiligence = application.categoryProgressPatch.home_admin.checklist!
    .find((item) => item.id === "home_admin_02")!;
  const sources = CHECKLIST_ITEM_GUIDANCE[purchaseDueDiligence.id].sourceRefs ?? [];

  assert.deepEqual(sources.map((source) => source.url).sort(), [
    "https://rt.molit.go.kr/",
    "https://www.gov.kr/mw/AA020InfoCappView.do?CappBizCD=15000000098",
    "https://www.iros.go.kr/index.jsp",
  ]);
  assert.ok(sources.every((source) => source.checkedAt === "2026-08-13"));
});

test("housing=buy does not expose lease-only sources on applicable work", () => {
  const application = applyHousingProfile("buy");
  const applicableItemIds = (["housing", "home_admin"] as const).flatMap((categoryKey) => {
    const template = CATEGORY_CHECKLISTS.find((category) => category.key === categoryKey)!;
    const checklist = application.categoryProgressPatch[categoryKey]?.checklist
      ?? template.items.map((item) => ({ ...item, state: "todo" as const }));
    return checklist
      .filter((item) => item.state !== "not_applicable")
      .map((item) => item.id);
  });
  const leaseOnlySourceUrl = CHECKLIST_ITEM_GUIDANCE_SOURCES.easylaw_lease_safety.url;
  const offenders = applicableItemIds.filter((itemId) =>
    CHECKLIST_ITEM_GUIDANCE[itemId].sourceRefs?.some(
      (source) => source.url === leaseOnlySourceUrl,
    ),
  );

  assert.deepEqual(offenders, []);
});

test("universal address registration links to the official move-in report", () => {
  const application = applyHousingProfile("other");
  const addressRegistration = application.categoryProgressPatch.home_admin.checklist!
    .find((item) => item.id === "home_admin_07")!;
  const sources = CHECKLIST_ITEM_GUIDANCE[addressRegistration.id].sourceRefs ?? [];

  assert.equal(addressRegistration.state, "todo");
  assert.deepEqual(
    sources.map((source) => source.url),
    ["https://www.gov.kr/mw/AA020InfoCappView.do?CappBizCD=13100000016"],
  );
  assert.equal(sources[0]?.checkedAt, "2026-08-13");
});
