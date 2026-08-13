import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { URL } from "node:url";
import ts from "typescript";

import {
  buildChecklistCategoryReviewPresentation,
  buildChecklistEmptyFocusPresentation,
  buildManualChecklistReviewEvidence,
  buildSituationModalFooter,
  getChecklistSharingNotice,
} from "../lib/checklistExperience.mjs";

const checklistSource = readFileSync(
  new URL("../../app/checklist/index.tsx", import.meta.url),
  "utf8",
);
const scheduleSource = readFileSync(
  new URL("../../app/schedule/index.tsx", import.meta.url),
  "utf8",
);

test("mobile checklist is a dedicated daily execution screen, not a schedule alias", () => {
  assert.doesNotMatch(checklistSource, /export \{ default \} from "\.\.\/schedule\/index"/);
  assert.match(checklistSource, /오늘 할 일/);
  assert.match(checklistSource, /이번 주/);
  assert.match(checklistSource, /늦은 일/);
  assert.match(checklistSource, /buildPlanningChecklistInsights/);
  assert.match(checklistSource, /insights\.review\.slice\(0, 3\)/);
  assert.match(checklistSource, /buildChecklistEmptyFocusPresentation/);
  assert.doesNotMatch(checklistSource, /legacyCompleted/);
});

test("housing profile copy keeps universal move work honest for an already-arranged home", () => {
  assert.match(checklistSource, /value: "other", label: "기타·이미 마련"/);
  assert.doesNotMatch(checklistSource, /기타\/해당 없음/);
});

test("the celebration gathering question is independent from ceremony and follows it immediately", () => {
  const questionsSource = checklistSource.slice(
    checklistSource.indexOf("const SITUATION_QUESTIONS"),
    checklistSource.indexOf("function readSituationProfile"),
  );
  const questionKeys = [...questionsSource.matchAll(/\{ key: "([^"]+)"/g)]
    .map((match) => match[1]);
  assert.deepEqual(questionKeys.slice(0, 2), ["ceremony", "gathering"]);
  assert.match(
    questionsSource,
    /key: "gathering", label: "축하 식사·모임", help: "예식과 별개예요\. 가장 큰 모임 기준으로 골라 주세요\."/,
  );
  assert.match(
    questionsSource,
    /key: "gathering"[\s\S]*?value: "none", label: "따로 없음"[\s\S]*?value: "family_meal", label: "가족 식사만"[\s\S]*?value: "reception", label: "하객 피로연·축하 모임"[\s\S]*?value: "undecided", label: "아직 미정"/,
  );
});

test("situation radios announce both the question and answer", () => {
  assert.match(checklistSource, /accessibilityLabel=\{`\$\{question\.label\}: \$\{option\.label\}`\}/);
});

test("new situation saves emit profile version 2 with a gathering answer", () => {
  assert.match(checklistSource, /const DEFAULT_SITUATION_ANSWERS[\s\S]*?gathering: "undecided"/);
  assert.match(
    checklistSource,
    /applyPlanningChecklistProfile\([\s\S]*?version: 2,[\s\S]*?answers: situationDraft/,
  );
});

test("an upgrade-required response preserves the draft and tells the user how to recover", () => {
  const applySource = checklistSource.slice(
    checklistSource.indexOf("async function applySituationProfile"),
    checklistSource.indexOf("if (loading)"),
  );
  assert.match(
    applySource,
    /response\.status === 409[\s\S]*?payload\.code === "CHECKLIST_PROFILE_UPGRADE_REQUIRED"[\s\S]*?new ChecklistMutationError\("profile_upgrade_required"\)/,
  );
  assert.match(applySource, /앱 업데이트가 필요해요/);
  assert.match(applySource, /앱을 업데이트한 뒤 이 화면을 새로고침해 주세요/);
  assert.match(applySource, /지금 선택한 내용은 바꾸지 않았어요/);
});

test("TODAY FIRST empty-state and situation modal footer have separate render contracts", () => {
  const review = [{ categoryKey: "venue", categoryLabel: "결혼식장" }];
  const focusEmpty = buildChecklistEmptyFocusPresentation("today", review);
  assert.equal(focusEmpty.reviewTitle, "먼저 검토할 분야");
  assert.equal(focusEmpty.reviewSuggestions, review);

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

test("mobile checklist exposes guidance and all item execution controls", () => {
  assert.match(checklistSource, /getChecklistItemGuidance/);
  assert.match(checklistSource, /완료 기준/);
  assert.match(checklistSource, /팁/);
  assert.match(checklistSource, /주의/);
  assert.match(checklistSource, /진행 상태/);
  assert.match(checklistSource, /담당/);
  assert.match(checklistSource, /기한/);
  assert.match(checklistSource, /메모/);
  assert.match(checklistSource, /not_applicable/);
  assert.match(checklistSource, /sourceRefs/);
  assert.match(checklistSource, /checkedAt/);
  assert.match(checklistSource, /공식 근거/);
  assert.match(checklistSource, /Linking\.openURL/);
  assert.match(checklistSource, /getChecklistSharingNotice/);
  assert.equal(getChecklistSharingNotice(true), "항목 기한과 메모는 파트너와 공유돼요.");
});

test("category applicability review uses the shared explicit evidence marker", () => {
  const presentation = buildChecklistCategoryReviewPresentation(false, false);
  const evidence = buildManualChecklistReviewEvidence({}, {
    now: "2026-08-12T10:00:00.000Z",
    profileId: "profile-1",
  });
  assert.match(checklistSource, /hasChecklistReviewEvidence/);
  assert.match(checklistSource, /buildManualChecklistReviewEvidence/);
  assert.match(checklistSource, /markCategoryReviewed/);
  assert.match(checklistSource, /\.\.\.reviewEvidence/);
  assert.equal(presentation.applicableLabel, "우리에게 필요한 준비예요");
  assert.equal(presentation.notApplicableLabel, "필요 없는 준비예요");
  assert.deepEqual(Object.keys(evidence), [
    "checklistReviewedAt",
    "checklistReviewedByProfileId",
    "checklistReviewSource",
  ]);
});

test("a real partner profile is selectable by stable member id and existing partner ownership is preserved", () => {
  assert.match(checklistSource, /\.from\("couple_profile_directory"\)[\s\S]*?\.eq\("couple_id", profile\.couple_id\)/);
  assert.match(checklistSource, /partnerProfileId/);
  assert.match(checklistSource, /파트너 담당/);
  assert.match(checklistSource, /\{ kind: "member", profileId: selectedPartnerId \}/);
  assert.match(checklistSource, /normalized\.assignee\.profileId === partnerProfileId/);
  assert.match(checklistSource, /partnerProfileId \?\? detailPartnerAssigneeId/);
});

test("completion activity names the exact couple member without surfacing private notes in lists or alerts", () => {
  assert.match(checklistSource, /formatChecklistCompletionAudit/);
  assert.match(checklistSource, /selectedCompletionAudit/);
  assert.match(checklistSource, /completionAudit/);
  assert.doesNotMatch(checklistSource, /Alert\.alert\([^)]*detailNote/);
  assert.doesNotMatch(checklistSource, /itemMetaRow[\s\S]{0,700}normalized\.note/);
});

test("detail saves compare a captured baseline and split routine work before assignee approval", () => {
  assert.match(checklistSource, /setDetailBaseline\(captureChecklistItemEditBaseline\(normalized\)\)/);
  assert.match(checklistSource, /hasChecklistItemMutationConflict/);
  assert.match(checklistSource, /categoryStatus: typeof existing\.status/);
  assert.match(checklistSource, /executeChecklistDetailMutationPlan/);
  assert.match(checklistSource, /preserveReviewEvidence: stage === "assignee"/);
  assert.match(checklistSource, /showAlerts: false/);
});

test("mobile checklist supports retrieval and recommendation deep focus", () => {
  assert.match(checklistSource, /검색/);
  assert.match(checklistSource, /완료 숨기기/);
  assert.match(checklistSource, /filterChecklistCategories/);
  assert.match(checklistSource, /scrollTo/);
  assert.match(checklistSource, /highlightedItemId/);
  const focusHandler = checklistSource.match(
    /function focusRecommendedItem[\s\S]*?\n {2}}\n\n {2}function focusReviewCategory/,
  )?.[0] ?? "";
  assert.match(focusHandler, /findChecklistItemTarget/);
  assert.match(focusHandler, /openDetail\(focusTarget\.category, focusTarget\.item\)/);
});

test("situation setup previews exclusions before storing a minimal non-sensitive profile", () => {
  assert.match(checklistSource, /우리 상황 설정/);
  assert.match(checklistSource, /PLANNING_CHECKLIST_PROFILE_KEY/);
  assert.match(checklistSource, /reviewedAt/);
  assert.match(checklistSource, /healthSupport/);
  assert.match(checklistSource, /autoExcludedItemIds/);
  assert.match(checklistSource, /applyPlanningChecklistProfile/);
  assert.match(checklistSource, /제외 예정 항목/);
  assert.match(checklistSource, /적용 전 미리보기/);
  assert.match(checklistSource, /not_applicable/);
  assert.doesNotMatch(
    checklistSource,
    /\b(?:diagnosis|healthDetails|nationality|childName|religionDetails)\s*:/,
  );
});

test("situation apply is pinned to the exact preview revision and patch", () => {
  assert.match(checklistSource, /createChecklistSituationPreviewPlan/);
  assert.match(checklistSource, /buildChecklistSituationPreviewSubmission/);
  assert.match(checklistSource, /const \[situationPreviewPlan, setSituationPreviewPlan\]/);
  assert.match(checklistSource, /stateRevision: situationDraftBase\.stateRevision/);
  assert.match(checklistSource, /const submission = buildChecklistSituationPreviewSubmission\(previewPlan\)/);
  assert.match(checklistSource, /body: JSON\.stringify\(submission\)/);

  const applySource = checklistSource.slice(
    checklistSource.indexOf("async function applySituationProfile"),
    checklistSource.indexOf("if (loading)"),
  );
  assert.doesNotMatch(applySource, /fetchChecklistSnapshot/);
  assert.doesNotMatch(applySource, /applyPlanningChecklistProfile/);
  assert.match(applySource, /setSituationPreviewPlan\(null\)/);
  assert.match(applySource, /setSituationPreviewVisible\(false\)/);
});

test("an open situation draft cannot overwrite a newer realtime profile", () => {
  assert.match(checklistSource, /interface SituationDraftBase[\s\S]*?stateRevision: number;[\s\S]*?profileIdentity: string;/);
  assert.match(checklistSource, /const \[situationDraftBase, setSituationDraftBase\]/);
  assert.match(checklistSource, /const \[situationDraftDirty, setSituationDraftDirty\]/);
  assert.match(checklistSource, /isSituationDraftBaseCurrent\(situationDraftBase, loadedChecklistSnapshot\)/);
  assert.match(checklistSource, /setSituationExternalChange\(true\)/);
  assert.match(checklistSource, /function reloadLatestSituationDraft\(\)/);
  assert.match(checklistSource, /최신 설정 다시 불러오기/);
  assert.match(checklistSource, /onPress=\{\(\) => updateSituationDraftAnswer\(question\.key, option\.value\)\}/);
  assert.match(checklistSource, /onPress=\{reloadLatestSituationDraft\}/);
  assert.match(checklistSource, /disabled=\{situationSaving \|\| situationExternalChange\}/);

  const helperSource = checklistSource.slice(
    checklistSource.indexOf("function getSituationProfileIdentity"),
    checklistSource.indexOf("function isRecord"),
  );
  const sandbox = {};
  const executableHelpers = ts.transpileModule(`
    const PLANNING_CHECKLIST_PROFILE_KEY = "__checklist_profile";
    ${helperSource}
    globalThis.helpers = { createSituationDraftBase, isSituationDraftBaseCurrent };
  `, {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  Function("globalThis", executableHelpers)(sandbox);
  const { createSituationDraftBase, isSituationDraftBaseCurrent } = sandbox.helpers;
  const opened = {
    coupleId: "couple-1",
    ownerId: "profile-1",
    stateRevision: 7,
    progress: { __checklist_profile: { version: 2, answers: { gathering: "none" } } },
  };
  const newerProfile = {
    ...opened,
    stateRevision: 8,
    progress: { __checklist_profile: { version: 2, answers: { gathering: "family_meal" } } },
  };
  const draftBase = createSituationDraftBase(opened);
  assert.equal(isSituationDraftBaseCurrent(draftBase, newerProfile), false);
  assert.equal(isSituationDraftBaseCurrent(createSituationDraftBase(newerProfile), newerProfile), true);

  const previewSource = checklistSource.slice(
    checklistSource.indexOf("function previewSituationProfile"),
    checklistSource.indexOf("async function applySituationProfile"),
  );
  assert.match(previewSource, /stateRevision: situationDraftBase\.stateRevision/);
  assert.match(previewSource, /setSituationPreviewProfileIdentity\(situationDraftBase\.profileIdentity\)/);

  const applySource = checklistSource.slice(
    checklistSource.indexOf("async function applySituationProfile"),
    checklistSource.indexOf("if (loading)"),
  );
  assert.match(applySource, /getSituationProfileIdentity\(loadedChecklistSnapshot\.progress\) !== situationPreviewProfileIdentity/);
  assert.match(applySource, /\|\| situationExternalChange[\s\S]*?\) \{[\s\S]*?return;/);
  assert.ok(
    applySource.indexOf("getSituationProfileIdentity(loadedChecklistSnapshot.progress) !== situationPreviewProfileIdentity")
      < applySource.indexOf("apiFetchForExpectedUser"),
  );
});

test("mobile checklist serializes writes and binds them to the current identity", () => {
  assert.match(checklistSource, /createChecklistMutationQueue/);
  assert.match(checklistSource, /checklistMutationQueueRef\.current\.enqueue/);
  assert.match(checklistSource, /createScheduleSessionFence/);
  assert.match(checklistSource, /expected_revision/);
  assert.match(checklistSource, /PLAN_CHANGE_STALE/);
});

test("schedule category picker stores canonical keys and renders human labels", () => {
  assert.match(scheduleSource, /buildChecklistCategoryOptions\(CATEGORY_CHECKLISTS\)/);
  assert.match(scheduleSource, /cat\.key/);
  assert.match(scheduleSource, /cat\.label/);
  assert.doesNotMatch(
    scheduleSource,
    /CATEGORY_CHECKLISTS\.map\(\(category\) => category\.label\)/,
  );
});
