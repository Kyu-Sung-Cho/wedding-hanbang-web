import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const mobileRoot = resolve(import.meta.dirname, "../..");
const writeSource = readFileSync(
  resolve(mobileRoot, "app/community/decision/write.tsx"),
  "utf8",
);
const detailSource = readFileSync(
  resolve(mobileRoot, "app/community/decision/[id].tsx"),
  "utf8",
);
const postDetailSource = readFileSync(
  resolve(mobileRoot, "app/community/post/[id].tsx"),
  "utf8",
);
const pendingSource = readFileSync(
  resolve(mobileRoot, "src/lib/communityDecisionPending.ts"),
  "utf8",
);
const pendingIndexSource = readFileSync(
  resolve(mobileRoot, "src/lib/communityDecisionPendingIndex.mjs"),
  "utf8",
);
const communitySource = readFileSync(
  resolve(mobileRoot, "app/(tabs)/community.tsx"),
  "utf8",
);
const authSource = readFileSync(
  resolve(mobileRoot, "src/lib/auth.ts"),
  "utf8",
);
const authListenerSource = readFileSync(
  resolve(mobileRoot, "src/lib/authListener.ts"),
  "utf8",
);
const settingsSource = readFileSync(
  resolve(mobileRoot, "app/settings/index.tsx"),
  "utf8",
);

test("202 remains private and retries the encrypted byte-identical create command", () => {
  assert.match(writeSource, /receipt\.kind === "private_waitlist"/u);
  assert.match(writeSource, /아직 공개되지 않았어요/u);
  assert.match(writeSource, /headers: \{ "Idempotency-Key": submission\.operationKey \}/u);
  assert.match(writeSource, /body: submission\.bodyText/u);
  assert.match(writeSource, /phase: "submitting_unknown"/u);
  assert.match(writeSource, /phase: "private_waitlist"/u);
  assert.match(writeSource, /submitPreparationLockRef/u);
  assert.match(writeSource, /submitRequestLockRef/u);
  assert.match(writeSource, /withdrawLockRef/u);
  assert.doesNotMatch(writeSource, /receipt\.kind === "private_waitlist"[\s\S]{0,500}router\.replace/u);
});

test("owner-scoped pending commands and drafts use device-only encrypted storage", () => {
  assert.match(pendingSource, /from "expo-secure-store"/u);
  assert.match(pendingSource, /WHEN_UNLOCKED_THIS_DEVICE_ONLY/u);
  assert.match(pendingIndexSource, /community_decision_pending_/u);
  assert.match(pendingIndexSource, /community_decision_draft_/u);
  assert.match(pendingSource, /SUBMITTING_UNKNOWN_MAX_AGE_MS = 7 \* 24 \* 60 \* 60 \* 1000/u);
  assert.match(pendingSource, /COMMUNITY_DECISION_WAITLIST_PENDING_MAX_AGE_DAYS = 30/u);
  assert.match(pendingSource, /value\.phase === "private_waitlist"/u);
  assert.match(writeSource, /작성 초안은 24시간 뒤 삭제돼요/u);
  assert.match(writeSource, /대기 질문 상세에서 직접 삭제할 수 있어요/u);
  assert.match(pendingSource, /value\.ownerId\.toLowerCase\(\) !== ownerId\.toLowerCase\(\)/u);
  assert.match(pendingSource, /hasExactPendingBodies/u);
  assert.match(pendingIndexSource, /community_decision_mutation_/u);
  assert.doesNotMatch(pendingSource, /AsyncStorage/u);
});

test("logout, account switch, and deletion purge every owner-scoped decision key", () => {
  assert.match(pendingSource, /communityDecisionMutationIndexBackupKey/u);
  assert.match(pendingIndexSource, /buildCommunityDecisionOwnerPurgeKeys/u);
  assert.match(pendingIndexSource, /Promise\.allSettled/u);
  assert.match(pendingIndexSource, /purgeCommunityDecisionOwnerKeys/u);
  assert.match(pendingSource, /purgeCommunityDecisionPendingForOwnerWithRetry/u);
  assert.match(
    authSource,
    /getSession\(\)[\s\S]*purgeCommunityDecisionPendingForOwnerWithRetry\(ownerId\)[\s\S]*releasePushNotificationsForCurrentSession\(\)[\s\S]*supabase\.auth\.signOut/u,
  );
  assert.match(
    authListenerSource,
    /event === "SIGNED_IN"[\s\S]*previousOwnerId !== nextOwnerId[\s\S]*scheduleDecisionOwnerPurge\(previousOwnerId\)/u,
  );
  assert.match(
    authListenerSource,
    /event === "SIGNED_OUT"[\s\S]*scheduleDecisionOwnerPurge\(previousOwnerId\)/u,
  );
  assert.doesNotMatch(
    authListenerSource,
    /event === "TOKEN_REFRESHED"[^}]*scheduleDecisionOwnerPurge/u,
  );
  const ownerConfirmation = settingsSource.indexOf("function showDeletionConfirmation(deletionOwnerId: string)");
  const deleteRequest = settingsSource.indexOf('apiFetchForExpectedUser(deletionOwnerId, "/api/auth/delete"');
  assert.ok(ownerConfirmation >= 0 && ownerConfirmation < deleteRequest);
  assert.match(settingsSource.slice(ownerConfirmation, deleteRequest), /getSession\(\)[\s\S]*session\?\.user\.id === deletionOwnerId/u);
  assert.match(settingsSource, /expectedOwnerId: deletionOwnerId/u);
  assert.match(settingsSource, /isCurrentSession: \(\) => sessionStillCurrent && settingsMountedRef\.current/u);
  assert.match(settingsSource, /continueOnDecisionPurgeFailure: true/u);
  assert.match(settingsSource, /purgeCommunityDecisionPendingForOwnerWithRetry\(\s*deletionOwnerId/u);
});

test("detail keeps applicability, resolution, private outcomes, and withdrawal separate", () => {
  assert.match(detailSource, /\/applicability`/u);
  assert.match(detailSource, /\/resolve`/u);
  assert.match(detailSource, /\/outcomes`/u);
  assert.match(detailSource, /\/withdraw`/u);
  assert.match(detailSource, /includedInResolutionAt !== null/u);
  assert.match(detailSource, /사용했던 출처를 더 이상 확인할 수 없어요/u);
  assert.match(detailSource, /나만 보는 결과 기록/u);
  assert.match(detailSource, /아직 공개된 것은 아니에요/u);
  assert.match(detailSource, /동의만으로 공개·검색 노출되지 않으며/u);
  assert.doesNotMatch(detailSource, /공개됐어요/u);
});

test("detail reads guest-visible projections with optional auth and never falls back to private outcomes", () => {
  assert.match(detailSource, /optionalAuthGetJson<unknown>\(path\)/u);
  assert.match(detailSource, /optionalAuthGetJson<unknown>\(outcomePath\)/u);
  assert.doesNotMatch(detailSource, /publicApiFetch/u);
  assert.match(detailSource, /parseCommunityDecisionPublicOutcome/u);
  assert.match(detailSource, /작성자가 돌아와 남긴 결과/u);
  assert.match(detailSource, /비공개 결과로 대신하지 않아요/u);
});

test("author publication withdrawal is state-gated, confirmed, exact, and recoverable", () => {
  assert.match(detailSource, /parseCommunityDecisionPublicationStatus/u);
  assert.match(detailSource, /publication\?\.status\?\.canWithdraw/u);
  assert.match(detailSource, /publicationState === "pending_review"/u);
  assert.match(detailSource, /publicationState === "published"/u);
  assert.match(detailSource, /공개 검수에서 비공개 유지됨/u);
  assert.match(detailSource, /결과 공개 동의를 철회할까요\?/u);
  assert.match(detailSource, /method: "DELETE"/u);
  assert.match(
    detailSource,
    /outcomes\/\$\{outcomeId\}\/publication/u,
  );
  assert.match(detailSource, /parseCommunityDecisionPublicationWithdrawReceipt/u);
  assert.match(detailSource, /receiptBelongsToCommand/u);
  assert.match(
    detailSource,
    /reloadAfterSuccess: pending\.operation !== "withdraw"[\s\S]{0,100}pending\.operation !== "publication_withdraw"/u,
  );
  assert.match(detailSource, /철회된 질문을 다시 불러온 실패 화면으로 이 확인 결과를 덮어쓰지 않아요/u);
});

test("waitlist detail retains, retries, deletes, or withdraws the exact create command", () => {
  assert.match(detailSource, /COMMUNITY_DECISION_WAITLIST_PENDING_MAX_AGE_DAYS/u);
  assert.match(detailSource, /body: bodyText/u);
  assert.match(detailSource, /"Idempotency-Key": operationKey/u);
  assert.match(detailSource, /isCommunityDecisionCreateReceiptForSubmission/u);
  assert.match(detailSource, /clearCommunityDecisionPendingIfMatches/u);
  assert.match(detailSource, /이 기기의 복구 명령을 삭제할까요\?/u);
  assert.match(detailSource, /서버의 비공개 대기 질문은 철회되지 않아요/u);
  assert.match(detailSource, /대기 질문 철회 후 새로 작성/u);
  assert.match(detailSource, /rewriteAfter: true/u);
});

test("source withdrawal copy and high-risk controls expose explicit accessible state", () => {
  assert.match(detailSource, /답변 출처가 철회되었거나 이용할 수 없어요/u);
  assert.match(detailSource, /새 답변을 기다리는 상태가 아니에요/u);
  assert.match(detailSource, /accessibilityState=\{\{ checked: isIncluded, disabled: busy \}\}/u);
  assert.match(detailSource, /accessibilityState=\{\{ expanded: showWithdraw, disabled: mutationBusy !== null \}\}/u);
  assert.match(detailSource, /includeRow: \{ minHeight: 44/u);
  assert.match(detailSource, /withdrawToggle: \{ minHeight: 44/u);
  assert.match(detailSource, /outcomePublicationWithdraw: \{ minHeight: 44/u);
});

test("detail rejects stale account responses and does not persist private reads", () => {
  assert.match(detailSource, /authGenerationRef/u);
  assert.match(detailSource, /isViewerCurrent/u);
  assert.match(detailSource, /optionalAuthGetJson/u);
  assert.match(detailSource, /loadSequenceRef/u);
  assert.match(detailSource, /mutationSequenceRef/u);
  assert.match(detailSource, /mutationBusyRef/u);
  assert.match(detailSource, /saveCommunityDecisionMutationPending/u);
  assert.match(detailSource, /loadCommunityDecisionMutationPending/u);
  assert.match(detailSource, /clearCommunityDecisionMutationPending/u);
  assert.match(detailSource, /isCommunityDecisionReceiptForCommand/u);
  assert.match(detailSource, /outcome: "outcomes"/u);
  assert.match(
    detailSource,
    /saveCommunityDecisionMutationPending[\s\S]{0,1000}apiFetchForExpectedUser/u,
  );
  assert.doesNotMatch(detailSource, /AsyncStorage|SecureStore|communityPostCache/u);
});

test("generic post detail opens a decision thread only from an actual response UUID", () => {
  assert.match(postDetailSource, /readDecisionThreadIdFromPost\(rawData\)/u);
  assert.match(postDetailSource, /decisionThreadId \? \(/u);
  assert.doesNotMatch(postDetailSource, /decisionThreadId\s*\?\?\s*(post\.)?id/u);
});

test("community connects decision feed, inbox, write, and detail without synthetic ids", () => {
  assert.match(communitySource, /parseCommunityDecisionFeed/u);
  assert.match(communitySource, /parseCommunityDecisionInbox/u);
  assert.match(communitySource, /\{renderDecisionSection\(\)\}/u);
  assert.match(communitySource, /<DecisionThreadCard key=\{item\.threadId\}/u);
  assert.match(communitySource, /params: \{ id: item\.threadId \}/u);
  assert.match(communitySource, /params: \{ id: targetId \}/u);
  assert.match(communitySource, /\/community\/decision\/write/u);
  assert.doesNotMatch(communitySource, /targetId\s*\?\?\s*/u);
});
