import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";

import * as scheduleIdentityModule from "../lib/scheduleSessionFence.mjs";

const scheduleSource = await readFile(
  new URL("../../app/schedule/index.tsx", import.meta.url),
  "utf8",
);
const summarySource = await readFile(
  new URL("../components/planning/PreparationTopicSummary.tsx", import.meta.url),
  "utf8",
);
const presentationSource = await readFile(
  new URL("../lib/preparationTopicPresentation.mjs", import.meta.url),
  "utf8",
);

test("the collapsed checklist header uses the truthful topic presentation instead of a fake zero percent", () => {
  assert.match(
    scheduleSource,
    /const topicPresentation = buildPreparationTopicPresentation\(\s*topicView,\s*undefined,\s*topicPayerPresentationContext,?\s*\)/,
  );
  assert.match(
    scheduleSource,
    /topicPresentation\?\.progressLabel/,
  );
  assert.match(
    scheduleSource,
    /topicPresentation\?\.statusLabel/,
  );
  assert.match(
    scheduleSource,
    /topicView\?\.applicability === "applicable"[\s\S]{0,120}topicView\.status !== "decision_needed"/,
  );
  assert.match(
    scheduleSource,
    /const categoryAccessibilityLabel = `\$\{cat\.label\} 체크리스트, \$\{categoryStatusLabel\}, \$\{categoryProgressLabel\}`/,
  );
  assert.match(
    scheduleSource,
    /accessibilityLabel=\{categoryAccessibilityLabel\}/,
  );
});

test("topic applicability changes require an explicit shared-scope confirmation and stay fenced to one session", () => {
  const applicabilityStart = scheduleSource.indexOf("async function submitCategoryApplicabilityChange");
  const applicabilityEnd = scheduleSource.indexOf("function getCategoryStats", applicabilityStart);
  const applicabilitySource = scheduleSource.slice(applicabilityStart, applicabilityEnd);
  assert.ok(applicabilityStart >= 0 && applicabilityEnd > applicabilityStart);
  assert.match(
    scheduleSource,
    /buildPreparationTopicApplicabilityControl[\s\S]{0,120}buildPreparationTopicApplicabilityMutation[\s\S]{0,120}classifyPreparationTopicApplicabilityFailure/,
  );
  assert.match(
    scheduleSource,
    /const applicabilityControl = buildPreparationTopicApplicabilityControl\(topicView\)/,
  );
  assert.match(
    scheduleSource,
    /Alert\.alert\(\s*control\.confirmTitle,\s*control\.confirmMessage,[\s\S]{0,500}control\.confirmActionLabel[\s\S]{0,300}submitCategoryApplicabilityChange/,
  );
  assert.match(scheduleSource, /applicabilityMutationRef\.current/);
  assert.match(scheduleSource, /disabled=\{applicabilitySavingKey !== null\}/);
  assert.match(
    scheduleSource,
    /buildPreparationTopicApplicabilityMutation\(\{[\s\S]{0,500}savedTopic,/,
  );
  assert.match(scheduleSource, /body: JSON\.stringify\(mutation\.body\)/);
  assert.match(
    scheduleSource,
    /const payload: unknown = await response\.json\(\)\.catch\(\(\) => null\);[\s\S]{0,240}scheduleSessionFenceRef\.isCurrent\(sessionToken\)/,
  );
  assert.match(
    scheduleSource,
    /classifyPreparationTopicApplicabilityFailure\(response\.status, payload\)/,
  );
  assert.match(applicabilitySource, /showActivePreparationRequestAlert\(\)/);
  assert.doesNotMatch(applicabilitySource, /showActiveScheduleRequestAlert\(\)/);
  assert.doesNotMatch(scheduleSource, /우리는 이건 안 해요/);
});

test("the topic screen loads exact shared actions and keeps read failures distinct from an empty result", () => {
  assert.match(scheduleSource, /\.from\("amora_actions"\)/);
  assert.match(scheduleSource, /\.eq\("couple_id", identity\.coupleId\)/);
  assert.match(scheduleSource, /\.eq\("status", "open"\)/);
  assert.match(scheduleSource, /\.limit\(DASHBOARD_OPEN_ACTION_CANDIDATE_LIMIT\)/);
  assert.match(scheduleSource, /listDashboardOpenActions\([\s\S]{0,180}identity\.coupleId/);
  assert.match(scheduleSource, /setTopicActionReadState\("unavailable"\)/);
  assert.match(scheduleSource, /저장된 공동 행동을 지금 확인하지 못했어요/);
});

test("the topic screen loads only bounded shared schedule receipts and compares them to the current journey", () => {
  assert.match(scheduleSource, /\.from\("decision_nodes"\)/);
  assert.match(scheduleSource, /\.eq\("couple_id", identity\.coupleId\)/);
  assert.match(scheduleSource, /\.eq\("visibility", "shared"\)/);
  assert.match(scheduleSource, /\.eq\("source", "schedule"\)/);
  assert.match(scheduleSource, /\.eq\("decision_type", "scheduled"\)/);
  assert.match(scheduleSource, /\.is\("memory_key", null\)/);
  assert.match(scheduleSource, /\.is\("superseded_at", null\)/);
  assert.match(scheduleSource, /\.not\("user_confirmed_at", "is", null\)/);
  assert.match(scheduleSource, /\.limit\(PREPARATION_DECISION_RECEIPT_LIMIT \+ 1\)/);
  assert.match(scheduleSource, /currentJourneyRevision: topicJourneyRevision/);
  assert.match(scheduleSource, /scheduleDecisionReceipts: topicScheduleDecisionReceipts/);
  assert.match(scheduleSource, /decisionReadState: topicDecisionReadState/);
});

test("confirmed budget history is an optional bounded read with exact status verification and session fencing", () => {
  assert.match(scheduleSource, /loadPreparationTopicBudgetDecisions\(\{/);
  assert.match(
    scheduleSource,
    /\.from\("decision_nodes"\)[\s\S]{0,1200}\.eq\("category", "budget"\)[\s\S]{0,500}\.eq\("decision_type", "decided"\)[\s\S]{0,500}\.eq\("source", "manual"\)/,
  );
  assert.match(scheduleSource, /\.contains\("metadata", \{ origin: "couple_plan_change_request" \}\)/);
  assert.match(
    scheduleSource,
    /\.limit\(Math\.min\(limit, PREPARATION_BUDGET_DECISION_RECEIPT_LIMIT \+ 1\)\)/,
  );
  assert.match(scheduleSource, /apiFetchForExpectedUser\([\s\S]{0,80}topicBudgetDecisionIdentity\.ownerId/);
  assert.match(scheduleSource, /budgetDecisionReceipts: topicBudgetDecisionReceipts/);
  assert.match(scheduleSource, /budgetDecisionVerifications: topicBudgetDecisionVerifications/);
  assert.match(scheduleSource, /budgetDecisionReadState: topicBudgetDecisionReadState/);
  assert.match(
    scheduleSource,
    /void topicBudgetDecisionResultPromise\.then\([\s\S]{0,900}scheduleLoadSequenceRef\.current !== loadSequence[\s\S]{0,500}scheduleSessionFenceRef\.isCurrent\(topicBudgetDecisionSessionToken\)[\s\S]{0,900}setTopicBudgetDecisionVerifications/,
  );
  assert.match(scheduleSource, /setTopicBudgetDecisionReadState\("unavailable"\)/);
  assert.match(scheduleSource, /setTopicBudgetDecisionReceipts\(\[\]\)/);
  assert.match(scheduleSource, /setTopicBudgetDecisionVerifications\(\[\]\)/);

  const coreAwaitStart = scheduleSource.indexOf("= await Promise.all([");
  const coreAwaitEnd = scheduleSource.indexOf("]);", coreAwaitStart);
  assert.ok(coreAwaitStart >= 0 && coreAwaitEnd > coreAwaitStart);
  assert.doesNotMatch(
    scheduleSource.slice(coreAwaitStart, coreAwaitEnd),
    /loadPreparationTopicBudgetDecisions|topicBudgetDecisionResultPromise/,
  );
});

test("decision read failure and truncation stay visible without hiding other topic records", () => {
  assert.match(scheduleSource, /setTopicDecisionReadState\("unavailable"\)/);
  assert.match(scheduleSource, /setTopicDecisionReadState\(\s*normalizedDecisionRows\.length > PREPARATION_DECISION_RECEIPT_LIMIT[\s\S]{0,120}\? "partial"[\s\S]{0,80}: "loaded"/);
  assert.match(scheduleSource, /확인한 일정 기록을 지금 불러오지 못했어요/);
  assert.match(scheduleSource, /확인한 일정 기록이 많아 최근 기록부터 보여드려요/);
  assert.match(scheduleSource, /setTopicScheduleDecisionReceipts\(\[\]\)/);
});

test("user-reported catch-up records are an optional bounded private-aware read with session fencing", () => {
  const optionalReadStart = scheduleSource.indexOf(
    "const topicCatchUpResultPromise = loadPreparationTopicCatchUpRecords",
  );
  const coreAwaitStart = scheduleSource.indexOf("= await Promise.all([", optionalReadStart);
  const coreAwaitEnd = scheduleSource.indexOf("]);", coreAwaitStart);
  const optionalReadEnd = scheduleSource.indexOf(
    "const topicVendorBookingResultPromise",
    optionalReadStart,
  );
  assert.ok(optionalReadStart >= 0);
  assert.ok(optionalReadEnd > optionalReadStart);
  assert.ok(coreAwaitStart > optionalReadEnd && coreAwaitEnd > coreAwaitStart);
  const optionalSource = scheduleSource.slice(optionalReadStart, optionalReadEnd);
  assert.match(optionalSource, /\.from\("decision_nodes"\)/);
  assert.match(optionalSource, /\.eq\("couple_id", exactCoupleId\)/);
  assert.match(optionalSource, /\.eq\("category", "preparation_catch_up"\)/);
  assert.match(optionalSource, /\.eq\("source", "onboarding"\)/);
  assert.match(optionalSource, /\.contains\("metadata", \{ hook: "amora_preparation_catch_up_v1" \}\)/);
  assert.doesNotMatch(optionalSource, /\.eq\("visibility", "shared"\)/);
  assert.match(optionalSource, /\.limit\(limit\)/);
  assert.doesNotMatch(
    scheduleSource.slice(coreAwaitStart, coreAwaitEnd),
    /topicCatchUpResultPromise|loadPreparationTopicCatchUpRecords/,
  );
  assert.match(scheduleSource, /catchUpDecisionReceipts: topicCatchUpDecisionReceipts/);
  assert.match(scheduleSource, /catchUpReadState: topicCatchUpReadState/);
  assert.match(
    scheduleSource,
    /void topicCatchUpResultPromise\.then\([\s\S]{0,1000}scheduleLoadSequenceRef\.current !== loadSequence[\s\S]{0,700}scheduleSessionFenceRef\.isCurrent\(topicCatchUpSessionToken\)[\s\S]{0,1000}setTopicCatchUpDecisionReceipts/,
  );
  assert.match(scheduleSource, /setTopicCatchUpReadState\("unavailable"\)/);
  assert.match(scheduleSource, /setTopicCatchUpDecisionReceipts\(\[\]\)/);
});

test("the topic budget opens the existing budget editor with only the exact category key", () => {
  assert.match(summarySource, /<ActionRow[\s\S]{0,260}budgetAction\.title/);
  assert.match(summarySource, /onOpenBudget\?\.\(budgetAction\.categoryKey\)/);
  assert.match(scheduleSource, /router\.push\(\{[\s\S]{0,120}pathname: "\/budget"[\s\S]{0,120}params: \{ category: categoryKey \}/);
  assert.doesNotMatch(summarySource, /ownerId|coupleId|budgetWon|spentWon/);
});

test("confirmed schedules are static accessible evidence, not another action or tab", () => {
  assert.match(summarySource, /presentation\.confirmedScheduleSection/);
  assert.match(summarySource, /accessibilityRole="header"/);
  assert.match(summarySource, /accessible[\s\S]{0,160}accessibilityLabel=\{item\.accessibilityLabel\}/);
  assert.match(summarySource, /additionalLabel/);
  assert.doesNotMatch(summarySource, /onOpenDecision|onPressDecision|ChevronRight/);
});

test("provider-unconfirmed booking intents reuse the static summary rows without navigation or writes", () => {
  assert.match(summarySource, /presentation\.bookingDecisionSection/);
  assert.match(summarySource, /bookingDecisionSection\.items\.map/);
  assert.match(summarySource, /item\.detail/);
  assert.match(presentationSource, /업체에 전달·확정된 예약이 아니에요/);
  assert.doesNotMatch(
    summarySource,
    /onOpenBookingDecision|onPressBookingDecision|onConfirmBooking|onCompleteBooking/,
  );
});

test("booking decision evidence loads after core data with bounded exact-id reads and session fencing", () => {
  assert.match(scheduleSource, /loadPreparationTopicVendorBookings\(\{/);
  assert.match(scheduleSource, /PREPARATION_VENDOR_BOOKING_DECISION_LIMIT/);
  assert.match(scheduleSource, /\.from\("couples"\)[\s\S]{0,160}\.select\("id, bride_id, groom_id"\)/);
  assert.match(scheduleSource, /\.from\("decision_nodes"\)[\s\S]{0,1000}\.eq\("source", "vendor_booking"\)[\s\S]{0,500}\.eq\("decision_type", "considering"\)/);
  assert.match(scheduleSource, /\.limit\(PREPARATION_VENDOR_BOOKING_DECISION_LIMIT \+ 1\)/);
  assert.match(scheduleSource, /\.from\("vendor_bookings"\)[\s\S]{0,1000}\.eq\("couple_id", exactCoupleId\)[\s\S]{0,300}\.in\("id", bookingIds\)/);
  assert.match(scheduleSource, /vendorBookings: topicVendorBookings/);
  assert.match(scheduleSource, /vendorBookingDecisionReceipts: topicVendorBookingDecisionReceipts/);
  assert.match(scheduleSource, /currentCoupleMemberIds: topicCurrentCoupleMemberIds/);
  assert.match(scheduleSource, /vendorBookingReadState: topicVendorBookingReadState/);

  const optionalReadStart = scheduleSource.indexOf(
    "const topicVendorBookingResultPromise = loadPreparationTopicVendorBookings",
  );
  const coreAwaitStart = scheduleSource.indexOf("= await Promise.all([", optionalReadStart);
  const coreAwaitEnd = scheduleSource.indexOf("]);", coreAwaitStart);
  assert.ok(optionalReadStart >= 0);
  assert.ok(coreAwaitStart > optionalReadStart);
  assert.ok(coreAwaitEnd > coreAwaitStart);
  assert.doesNotMatch(
    scheduleSource.slice(coreAwaitStart, coreAwaitEnd),
    /topicVendorBookingResultPromise|loadPreparationTopicVendorBookings/,
  );
  assert.match(
    scheduleSource,
    /void topicVendorBookingResultPromise\.then\([\s\S]{0,1200}scheduleLoadSequenceRef\.current !== loadSequence[\s\S]{0,700}scheduleSessionFenceRef\.isCurrent\(topicVendorBookingSessionToken\)[\s\S]{0,1000}setTopicVendorBookings/,
  );
});

test("completed booking outcomes reuse an independent bounded optional read and feed only the completed contract lane", () => {
  const completedReadStart = scheduleSource.indexOf(
    "const topicCompletedVendorBookingResultPromise = loadPreparationTopicVendorBookings",
  );
  const coreAwaitStart = scheduleSource.indexOf("= await Promise.all([", completedReadStart);
  assert.ok(completedReadStart >= 0 && coreAwaitStart > completedReadStart);
  const completedReadSource = scheduleSource.slice(completedReadStart, coreAwaitStart);

  assert.match(completedReadSource, /\.from\("couples"\)/);
  assert.match(completedReadSource, /\.from\("decision_nodes"\)/);
  assert.match(completedReadSource, /reasoning/);
  assert.match(completedReadSource, /\.eq\("visibility", "shared"\)/);
  assert.match(completedReadSource, /\.eq\("source", "vendor_booking"\)/);
  assert.match(completedReadSource, /\.eq\("decision_type", "completed"\)/);
  assert.match(completedReadSource, /\.in\("source_actor_role", \["bride", "groom"\]\)/);
  assert.match(completedReadSource, /outcome_provenance_version:\s*1/);
  assert.match(completedReadSource, /completion_evidence:\s*"user_reported"/);
  assert.match(completedReadSource, /vendor_confirmation_status:\s*"unconfirmed"/);
  assert.match(completedReadSource, /\.limit\(PREPARATION_VENDOR_BOOKING_DECISION_LIMIT \+ 1\)/);
  assert.match(completedReadSource, /\.from\("vendor_bookings"\)/);
  assert.match(completedReadSource, /\.eq\("status", "completed"\)/);
  assert.match(completedReadSource, /\.eq\("vendor_delivery_status", "not_sent"\)/);
  assert.match(completedReadSource, /\.eq\("is_paid", false\)/);
  assert.doesNotMatch(completedReadSource, /vendor_reviews/);

  assert.match(scheduleSource, /completedVendorBookings: topicCompletedVendorBookings/);
  assert.match(
    scheduleSource,
    /completedVendorBookingDecisionReceipts:\s*topicCompletedVendorBookingDecisionReceipts/,
  );
  assert.match(
    scheduleSource,
    /completedVendorBookingReadState: topicCompletedVendorBookingReadState/,
  );
});

test("completed booking outcomes fail closed across late reads, identity resets, and realtime reloads", () => {
  const completedHandlerStart = scheduleSource.indexOf(
    "void topicCompletedVendorBookingResultPromise.then",
  );
  const completedHandlerEnd = scheduleSource.indexOf("return identity;", completedHandlerStart);
  assert.ok(completedHandlerStart >= 0 && completedHandlerEnd > completedHandlerStart);
  const completedHandlerSource = scheduleSource.slice(completedHandlerStart, completedHandlerEnd);

  assert.match(completedHandlerSource, /scheduleLoadSequenceRef\.current !== loadSequence/);
  assert.match(
    completedHandlerSource,
    /scheduleSessionFenceRef\.isCurrent\(topicCompletedVendorBookingSessionToken\)/,
  );
  assert.match(completedHandlerSource, /activeIdentity\?\.ownerId/);
  assert.match(completedHandlerSource, /activeIdentity\?\.coupleId/);
  assert.match(
    completedHandlerSource,
    /!topicCompletedVendorBookingResult\.ok[\s\S]*setTopicCompletedVendorBookingDecisionReceipts\(\[\]\)[\s\S]*setTopicCompletedVendorBookings\(\[\]\)[\s\S]*setTopicCompletedVendorBookingReadState\("unavailable"\)/,
  );

  const resetStart = scheduleSource.indexOf("const clearIdentityBoundState = useCallback");
  const resetEnd = scheduleSource.indexOf("const loadApprovalRequests = useCallback", resetStart);
  const resetSource = scheduleSource.slice(resetStart, resetEnd);
  assert.match(resetSource, /setTopicCompletedVendorBookingDecisionReceipts\(\[\]\)/);
  assert.match(resetSource, /setTopicCompletedVendorBookings\(\[\]\)/);
  assert.match(resetSource, /setTopicCompletedVendorBookingReadState\("loaded"\)/);

  assert.match(
    scheduleSource,
    /table: "vendor_bookings"[\s\S]{0,150}reloadIfStillSubscribed/,
  );
});

test("booking decision read failures and truncation stay inside the expanded summary and identity resets clear all rows", () => {
  assert.match(scheduleSource, /setTopicVendorBookingReadState\("unavailable"\)/);
  assert.match(scheduleSource, /setTopicVendorBookings\(\[\]\)/);
  assert.match(scheduleSource, /setTopicVendorBookingDecisionReceipts\(\[\]\)/);
  assert.match(scheduleSource, /setTopicCurrentCoupleMemberIds\(\[\]\)/);
  assert.match(presentationSource, /방문·상담 후보 기록을 지금 불러오지 못했어요/);
  assert.match(presentationSource, /후보 기록 조회가 일부만 완료됐어요\. 새로고침해 다시 확인해 주세요/);
  assert.match(summarySource, /bookingDecisionSection\.notice/);
  assert.match(scheduleSource, /table: 'vendor_bookings'|table: "vendor_bookings"/);
});

test("saved conversations stay inside the topic summary, show two first, and open by opaque ref only", () => {
  assert.match(summarySource, /presentation\.savedConversationSection/);
  assert.match(summarySource, /\.items\.slice\([\s\S]{0,80}expandedSavedConversations[\s\S]{0,100}\.items\.length[\s\S]{0,100}initialVisibleCount/);
  assert.match(summarySource, /저장한 대화/);
  assert.match(summarySource, /onOpenSavedConversation\?\.\(item\.refId\)/);
  assert.match(summarySource, /minHeight:\s*48/);
  assert.match(summarySource, /accessibilityLabel=\{item\.accessibilityLabel\}/);
  assert.doesNotMatch(summarySource, /onOpenSavedConversation\?\.\(item\.messageId|router\.push/);
});

test("the reviewed guide stays collapsed between the next action and saved conversations", () => {
  const nextActionStart = summarySource.indexOf("{presentation.nextAction ?");
  const guideStart = summarySource.indexOf("{guideSection ?");
  const savedConversationStart = summarySource.indexOf("{savedConversationSection ?");
  assert.ok(nextActionStart >= 0);
  assert.ok(guideStart > nextActionStart);
  assert.ok(savedConversationStart > guideStart);

  const guideBlock = summarySource.slice(guideStart, savedConversationStart);
  assert.match(guideBlock, /guideSection\.eyebrow/);
  assert.match(guideBlock, /guideSection\.title/);
  assert.match(guideBlock, /guideSection\.whyShown/);
  assert.match(guideBlock, /먼저 맞출 것/);
  assert.match(guideBlock, /놓치기 쉬운 경우/);
  assert.match(guideBlock, /이렇게 물어보세요/);
  assert.match(guideBlock, /끝났다고 확인할 것/);
  assert.match(guideBlock, /guideSection\.provenance\.sourceLabel/);
  assert.match(guideBlock, /guideSection\.provenance\.scopeLabel/);
  assert.match(guideBlock, /guideSection\.provenance\.limitations/);
  assert.match(guideBlock, /accessibilityState=\{\{ expanded: expandedGuide \}\}/);
  assert.doesNotMatch(
    guideBlock,
    /router\.|fetch\(|supabase|onOpenBudget|onOpenSavedConversation|onSave|onWrite|onComplete/,
  );
  assert.match(summarySource, /guideToggle:\s*\{[\s\S]{0,120}minHeight:\s*48/);
});

test("the topic summary leads with one grounded action before context, guidance, records, and Amora handoff", () => {
  const statusStart = summarySource.indexOf("<View style={styles.header}>");
  const nextActionStart = summarySource.indexOf("{presentation.nextAction ?");
  const personalizationStart = summarySource.indexOf("{personalizationSection ?");
  const evidenceStart = summarySource.indexOf("{presentation.evidenceLines.length > 0 ?");
  const remainingStart = summarySource.indexOf("{presentation.remainingLabel ?");
  const guideStart = summarySource.indexOf("{guideSection ?");
  const savedConversationStart = summarySource.indexOf("{savedConversationSection ?");
  const supportingRecordsStart = summarySource.indexOf(
    "<SupportingRecordSections presentation={presentation} />",
  );
  const budgetActionStart = summarySource.indexOf("{budgetAction ?");
  const handoffStart = summarySource.indexOf("{amoraHandoff ?");

  for (const position of [
    statusStart,
    nextActionStart,
    personalizationStart,
    evidenceStart,
    remainingStart,
    guideStart,
    savedConversationStart,
    supportingRecordsStart,
    budgetActionStart,
    handoffStart,
  ]) assert.ok(position >= 0);

  assert.ok(statusStart < nextActionStart);
  assert.ok(nextActionStart < personalizationStart);
  assert.ok(personalizationStart < evidenceStart);
  assert.ok(evidenceStart < remainingStart);
  assert.ok(remainingStart < guideStart);
  assert.ok(guideStart < savedConversationStart);
  assert.ok(savedConversationStart < supportingRecordsStart);
  assert.ok(supportingRecordsStart < budgetActionStart);
  assert.ok(budgetActionStart < handoffStart);

  const actionBlock = summarySource.slice(nextActionStart, personalizationStart);
  assert.match(actionBlock, /presentation\.nextAction\.reason/);
  assert.match(actionBlock, /presentation\.nextAction\.completionCriterion/);
  assert.match(actionBlock, /presentation\.actionReadNotice/);

  const recordsHelperStart = summarySource.indexOf("function SupportingRecordSections");
  const summaryStart = summarySource.indexOf("export default function PreparationTopicSummary");
  const recordsHelper = summarySource.slice(recordsHelperStart, summaryStart);
  for (const marker of [
    "presentation.confirmedScheduleSection",
    "presentation.confirmedBudgetSection",
    "presentation.catchUpSection",
    "presentation.completedBookingOutcomeSection",
    "presentation.bookingDecisionSection",
  ]) assert.match(recordsHelper, new RegExp(marker.replaceAll(".", "\\."), "u"));
});

test("the schedule loads identity-bound references and passes only an opaque ref into existing chat", () => {
  assert.match(scheduleSource, /loadPreparationTopicMessageReferences\(\{/);
  assert.match(scheduleSource, /apiFetchForExpectedUser\([\s\S]{0,40}topicMessageRefIdentity\.ownerId/);
  assert.match(scheduleSource, /scheduleSessionFenceRef\.isCurrent\(topicMessageRefSessionToken\)/);
  assert.match(scheduleSource, /setTopicMessageReferenceReadState\([\s\S]{0,100}partial[\s\S]{0,100}"partial"[\s\S]{0,100}"loaded"/);
  assert.match(scheduleSource, /setTopicMessageReferenceReadState\("unavailable"\)/);
  assert.match(scheduleSource, /pathname: "\/\(tabs\)\/chat"[\s\S]{0,100}params: \{ topicMessageRefId \}/);
  assert.doesNotMatch(scheduleSource, /params: \{[^}]*messageId|params: \{[^}]*content/);
});

test("the schedule commits core data without awaiting optional saved conversations and fences their late result", () => {
  const optionalReadStart = scheduleSource.indexOf(
    "const topicMessageReferenceResultPromise = loadPreparationTopicMessageReferences",
  );
  const coreAwaitStart = scheduleSource.indexOf("= await Promise.all([", optionalReadStart);
  const coreAwaitEnd = scheduleSource.indexOf("]);", coreAwaitStart);
  assert.ok(optionalReadStart >= 0);
  assert.ok(coreAwaitStart > optionalReadStart);
  assert.ok(coreAwaitEnd > coreAwaitStart);
  assert.doesNotMatch(
    scheduleSource.slice(coreAwaitStart, coreAwaitEnd),
    /topicMessageReferenceResultPromise|loadPreparationTopicMessageReferences/,
  );
  assert.match(
    scheduleSource,
    /void topicMessageReferenceResultPromise\.then\(\(topicMessageReferenceResult\) => \{[\s\S]{0,900}scheduleLoadSequenceRef\.current !== loadSequence[\s\S]{0,500}scheduleSessionFenceRef\.isCurrent\(topicMessageRefSessionToken\)[\s\S]{0,700}setTopicMessageReferences/,
  );
});

test("a failed core reload cannot leave the previous couple's topic summary visible", () => {
  assert.match(
    scheduleSource,
    /catch \(err\)[\s\S]{0,500}setCategories\(\[\]\)[\s\S]{0,200}setPreparationProgress\(\{\}\)/,
  );
});

test("bounded foreground roster reconciliation fails closed without unpublished table subscriptions", () => {
  const intervalMs = scheduleIdentityModule.SCHEDULE_IDENTITY_RECONCILIATION_INTERVAL_MS;
  assert.ok(intervalMs >= 30_000 && intervalMs <= 60_000);
  assert.match(
    scheduleSource,
    /buildScheduleIdentitySnapshot[\s\S]{0,160}SCHEDULE_IDENTITY_RECONCILIATION_INTERVAL_MS[\s\S]{0,160}from "@\/lib\/scheduleSessionFence\.mjs"/,
  );

  const buildIdentity = scheduleIdentityModule.buildScheduleIdentitySnapshot;
  assert.equal(typeof buildIdentity, "function");
  const ownerId = "10000000-0000-4000-8000-000000000001";
  const partnerId = "10000000-0000-4000-8000-000000000002";
  const foreignId = "10000000-0000-4000-8000-000000000003";
  const coupleId = "50000000-0000-4000-8000-000000000001";
  const validIdentity = buildIdentity({
    ownerId,
    coupleId,
    roster: { id: coupleId, bride_id: ownerId, groom_id: partnerId },
  });
  assert.deepEqual(validIdentity, {
    ownerId,
    coupleId,
    memberIds: [ownerId, partnerId],
  });
  assert.equal(buildIdentity({
    ownerId,
    coupleId,
    roster: { id: coupleId, bride_id: ownerId, groom_id: "malformed" },
  }), null);
  assert.equal(buildIdentity({
    ownerId,
    coupleId,
    roster: { id: coupleId, bride_id: partnerId, groom_id: foreignId },
  }), null);
  assert.equal(buildIdentity({
    ownerId,
    coupleId,
    roster: { id: coupleId, bride_id: ownerId, groom_id: ownerId },
  }), null);
  assert.equal(
    scheduleIdentityModule.isSameScheduleIdentitySnapshot(
      validIdentity,
      buildIdentity({
        ownerId,
        coupleId,
        roster: { id: coupleId, bride_id: ownerId, groom_id: null },
      }),
    ),
    false,
  );

  assert.doesNotMatch(scheduleSource, /table: ['"](?:profiles|couples)['"]/);
  assert.match(
    scheduleSource,
    /const reconcileSubscribedIdentity = async \(\) =>[\s\S]{0,1800}\.from\("profiles"\)[\s\S]{0,240}\.eq\("id", subscribedOwnerId\)[\s\S]{0,1400}\.from\("couples"\)[\s\S]{0,240}\.eq\("id", subscribedCoupleId\)/,
  );
  assert.match(
    scheduleSource,
    /setInterval\([\s\S]{0,180}reconcileSubscribedIdentity\(\)[\s\S]{0,180}SCHEDULE_IDENTITY_RECONCILIATION_INTERVAL_MS/,
  );
  assert.match(
    scheduleSource,
    /appStateRef\.current !== "active"[\s\S]{0,160}!scheduleScreenFocusedRef\.current/,
  );

  const invalidationStart = scheduleSource.indexOf(
    "const invalidateSubscribedIdentity = (reason:",
  );
  const generationInvalidation = scheduleSource.indexOf(
    "scheduleLoadSequenceRef.current += 1",
    invalidationStart,
  );
  const sessionInvalidation = scheduleSource.indexOf(
    "scheduleSessionFenceRef.clearCouple(subscribedOwnerId)",
    generationInvalidation,
  );
  const visibleStateClear = scheduleSource.indexOf(
    "clearIdentityBoundState(subscribedOwnerId)",
    sessionInvalidation,
  );
  const reloadStart = scheduleSource.indexOf(
    "void reloadSubscribedIdentity()",
    visibleStateClear,
  );
  assert.ok(invalidationStart >= 0);
  assert.ok(generationInvalidation > invalidationStart);
  assert.ok(sessionInvalidation > generationInvalidation);
  assert.ok(visibleStateClear > sessionInvalidation);
  assert.ok(reloadStart > visibleStateClear);

  assert.match(
    scheduleSource,
    /\.from\("couples"\)[\s\S]{0,160}\.select\("id, bride_id, groom_id"\)[\s\S]{0,120}\.eq\("id", profile\.couple_id\)/,
  );
  assert.match(
    scheduleSource,
    /const currentIdentitySnapshot = buildScheduleIdentitySnapshot\(\{[\s\S]{0,180}ownerId: user\.id[\s\S]{0,180}coupleId: profile\.couple_id[\s\S]{0,180}roster: currentRoster/,
  );
  assert.match(
    scheduleSource,
    /const nextPayerPresentationContext = buildSchedulePayerPresentationContext\(\{[\s\S]{0,180}ownerId: user\.id[\s\S]{0,180}profileRole: profile\.role[\s\S]{0,180}preparationSpace: currentRoster/,
  );
  assert.match(
    scheduleSource,
    /identity = \{ ownerId: user\.id, coupleId: profile\.couple_id \}[\s\S]{0,400}verifiedScheduleIdentityRef\.current = currentIdentitySnapshot[\s\S]{0,180}verifiedPayerPresentationContextRef\.current = nextPayerPresentationContext/,
  );
  assert.match(
    scheduleSource,
    /\.subscribe\(\(status\) => \{[\s\S]{0,220}status !== ['"]SUBSCRIBED['"][\s\S]{0,300}!hasSubscribedOnce[\s\S]{0,220}hasSubscribedOnce = true[\s\S]{0,300}void reconcileSubscribedIdentity\(\)/,
  );
  assert.match(
    scheduleSource,
    /const identity = await loadData\(\)[\s\S]{0,420}scheduleScreenMountedRef\.current[\s\S]{0,420}scheduleSessionFenceRef\.isCurrent\([\s\S]{0,300}loadApprovalRequests\(identity/,
  );

  assert.match(scheduleSource, /useFocusEffect\(/);
  assert.match(scheduleSource, /AppState\.addEventListener\("change"/);
});
