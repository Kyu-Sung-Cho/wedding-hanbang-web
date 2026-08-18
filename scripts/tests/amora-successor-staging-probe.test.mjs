import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { URL, fileURLToPath } from "node:url";

import {
  AmoraSuccessorStagingProbeError,
  createSupabaseStagingTransport,
  loadSupabaseProjectApiKeys,
  readHostedCriterionActionResidue,
  readHostedMessageRefResidue,
  readHostedMigrationLedger,
  runCriterionActionContextScenario,
  runMediationPrivateDraftScenario,
  runNeutralPreparationSpaceScenario,
  runPreparationTopicMessageRefScenario,
  validateAmoraSuccessorStagingProbeConfig,
} from "../lib/amora-successor-staging-probe.mjs";

const STAGING_REF = "rgxdizztidbgwnsbadml";
const PRODUCTION_REF = "slrtobkksjmxgzatjyqb";
const cliSource = readFileSync(fileURLToPath(new URL(
  "../amora-successor-staging-probe.mjs",
  import.meta.url,
)), "utf8");

test("the Amora successor probe refuses the Production project before any hosted work", () => {
  assert.throws(
    () => validateAmoraSuccessorStagingProbeConfig({
      projectRef: PRODUCTION_REF,
      productionProjectRef: PRODUCTION_REF,
      approvedProjectRef: STAGING_REF,
      managementToken: "management-token-that-is-long-enough",
      expectedCommit: "a".repeat(40),
      receiptOut: "C:\\probe-evidence\\amora-staging.json",
    }),
    (error) => error instanceof AmoraSuccessorStagingProbeError
      && error.code === "PRODUCTION_TARGET_FORBIDDEN",
  );
});

test("two synthetic users get one neutral preparation space with private pre-join membership and exact replay", async () => {
  const users = [
    { id: "10000000-0000-4000-8000-000000000001", accessToken: "token-a" },
    { id: "10000000-0000-4000-8000-000000000002", accessToken: "token-b" },
  ];
  const coupleId = "20000000-0000-4000-8000-000000000001";
  const inviteCode = "WH-ABCDEF123456";
  const membership = new Map(users.map(({ id }) => [id, null]));
  const cleanupCalls = [];
  let createCount = 0;

  const transport = {
    async createSyntheticUser() {
      return users[createCount++];
    },
    async createNeutralPreparationSpace(user) {
      if (membership.get(user.id) === coupleId) {
        return {
          success: true,
          created: false,
          idempotent: true,
          couple_id: coupleId,
          invite_code: inviteCode,
          member_model_version: 2,
        };
      }
      membership.set(user.id, coupleId);
      return {
        success: true,
        created: true,
        idempotent: false,
        couple_id: coupleId,
        invite_code: inviteCode,
        member_model_version: 2,
      };
    },
    async readProfile(viewer, targetId) {
      if (viewer.id === targetId) {
        return [{ id: targetId, couple_id: membership.get(targetId), role: targetId === users[0].id ? "bride" : "groom" }];
      }
      return membership.get(viewer.id) === coupleId && membership.get(targetId) === coupleId
        ? [{ id: targetId, couple_id: coupleId, role: targetId === users[0].id ? "bride" : "groom" }]
        : [];
    },
    async readCouple(viewer) {
      return membership.get(viewer.id) === coupleId
        ? [{ id: coupleId, member_model_version: 2 }]
        : [];
    },
    async callServerJoinAsAuthenticated() {
      return { denied: true };
    },
    async joinNeutralPreparationSpaceServer(actorUserId) {
      membership.set(actorUserId, coupleId);
      return {
        success: true,
        joined: true,
        idempotent: false,
        couple_id: coupleId,
        member_model_version: 2,
      };
    },
    async resetMembership(user) {
      membership.set(user.id, null);
      return { success: true, previous_couple_id: coupleId };
    },
    async deleteSyntheticUser(userId) {
      cleanupCalls.push(userId);
    },
    async readResidue() {
      return { profiles: 0, couples: 0 };
    },
  };

  const result = await runNeutralPreparationSpaceScenario({ transport });

  assert.deepEqual(result.checks, {
    ownerCreate: true,
    ownerReplay: true,
    preJoinProfileIsolation: true,
    preJoinCoupleIsolation: true,
    authenticatedServerJoinDenied: true,
    serverJoin: true,
    postJoinMutualProfileRead: true,
    postJoinCoupleRead: true,
    cleanup: true,
  });
  assert.equal(result.syntheticUserCount, 2);
  assert.deepEqual(result.residue, { profiles: 0, couples: 0 });
  assert.deepEqual(cleanupCalls.sort(), users.map(({ id }) => id).sort());
  assert.equal(JSON.stringify(result).includes(users[0].id), false);
  assert.equal(JSON.stringify(result).includes(users[1].id), false);
  assert.equal(JSON.stringify(result).includes(inviteCode), false);
});

test("three synthetic users prove saved conversation sharing, private isolation, replay, removal, and zero residue", async () => {
  const users = [
    { id: "10000000-0000-4000-8000-000000000011", accessToken: "token-owner" },
    { id: "10000000-0000-4000-8000-000000000012", accessToken: "token-partner" },
    { id: "10000000-0000-4000-8000-000000000013", accessToken: "token-outsider" },
  ];
  const ownerCoupleId = "20000000-0000-4000-8000-000000000011";
  const outsiderCoupleId = "20000000-0000-4000-8000-000000000012";
  const sharedQuestionId = "30000000-0000-4000-8000-000000000011";
  const sharedAnswerId = "40000000-0000-4000-8000-000000000011";
  const privateQuestionId = "30000000-0000-4000-8000-000000000012";
  const privateAnswerId = "40000000-0000-4000-8000-000000000012";
  const sharedRefId = "50000000-0000-4000-8000-000000000011";
  const privateRefId = "50000000-0000-4000-8000-000000000012";
  const sharedQuestion = "상견례 날짜를 정할 때 무엇부터 확인할까요?";
  const sharedAnswer = "양가가 피하기 어려운 날짜부터 두세 개만 먼저 모아 보세요.";
  const privateQuestion = "제 예산 걱정은 상대에게 아직 보이지 않게 정리하고 싶어요.";
  const privateAnswer = "혼자 감당 가능한 상한과 함께 상의할 범위를 나눠 보세요.";
  let userIndex = 0;
  let sharedSaveCount = 0;
  let removed = false;
  const deletedUsers = [];

  const mutation = ({ messageId, audience, refId, savedState, revision, reused }) => ({
    version: 1,
    state: "ready",
    recipientUserId: users[0].id,
    coupleId: ownerCoupleId,
    reused,
    reference: {
      topicKey: messageId === sharedAnswerId ? "meeting" : "housing",
      messageId,
      refId: savedState === "saved" ? refId : null,
      audience,
      savedState,
      revision,
    },
  });
  const listedRef = ({ refId, topicKey, messageId, audience, excerpt }) => ({
    refId,
    topicKey,
    messageId,
    audience,
    revision: 1,
    savedAt: "2026-08-18T01:00:02.000Z",
    sourceCreatedAt: "2026-08-18T01:00:01.000Z",
    excerpt,
    canRemove: true,
    canOpenOriginal: true,
  });
  const sharedListed = listedRef({
    refId: sharedRefId,
    topicKey: "meeting",
    messageId: sharedAnswerId,
    audience: "couple_shared",
    excerpt: sharedAnswer,
  });
  const privateListed = listedRef({
    refId: privateRefId,
    topicKey: "housing",
    messageId: privateAnswerId,
    audience: "owner_private",
    excerpt: privateAnswer,
  });

  const transport = {
    async createSyntheticUser() {
      return users[userIndex++];
    },
    async createNeutralPreparationSpace(user) {
      if (user.id === users[0].id) {
        return {
          success: true,
          created: true,
          couple_id: ownerCoupleId,
          invite_code: "WH-OWNER000001",
          member_model_version: 2,
        };
      }
      return {
        success: true,
        created: true,
        couple_id: outsiderCoupleId,
        invite_code: "WH-OTHER000001",
        member_model_version: 2,
      };
    },
    async joinNeutralPreparationSpaceServer() {
      return {
        success: true,
        joined: true,
        couple_id: ownerCoupleId,
        member_model_version: 2,
      };
    },
    async createPreparationTopicMessageFixtures() {
      return {
        sharedQuestionId,
        sharedAnswerId,
        privateQuestionId,
        privateAnswerId,
        sharedQuestion,
        sharedAnswer,
        privateQuestion,
        privateAnswer,
      };
    },
    async readPrivacyEpoch() {
      return 7;
    },
    async callMessageRefRpcAsAuthenticated() {
      return { denied: true };
    },
    async callPreparationNotesRpcAsAuthenticated() {
      return { denied: true };
    },
    async readMessageRefTableAsAuthenticated() {
      return { denied: true };
    },
    async setMessageRefAsService(input) {
      if (input.messageId === sharedAnswerId && input.desiredState === "saved") {
        if (removed && input.expectedRevision === 0) {
          return {
            ok: false,
            status: 409,
            body: {
              code: "PT409",
              message: "AMORA_PREPARATION_TOPIC_MESSAGE_REF_REVISION_STALE",
            },
          };
        }
        sharedSaveCount += 1;
        return {
          ok: true,
          status: 200,
          body: mutation({
            messageId: sharedAnswerId,
            audience: "couple_shared",
            refId: sharedRefId,
            savedState: "saved",
            revision: 1,
            reused: sharedSaveCount > 1,
          }),
        };
      }
      if (input.messageId === privateAnswerId) {
        return {
          ok: true,
          status: 200,
          body: mutation({
            messageId: privateAnswerId,
            audience: "owner_private",
            refId: privateRefId,
            savedState: "saved",
            revision: 1,
            reused: false,
          }),
        };
      }
      removed = true;
      return {
        ok: true,
        status: 200,
        body: mutation({
          messageId: sharedAnswerId,
          audience: "couple_shared",
          refId: sharedRefId,
          savedState: "removed",
          revision: 2,
          reused: false,
        }),
      };
    },
    async listMessageRefsAsService({ recipientUserId, coupleId }) {
      if (coupleId !== ownerCoupleId || recipientUserId === users[2].id) {
        return { ok: false, status: 404, body: {} };
      }
      const references = removed
        ? (recipientUserId === users[0].id ? [privateListed] : [])
        : (recipientUserId === users[0].id ? [sharedListed, privateListed] : [sharedListed]);
      return {
        ok: true,
        status: 200,
        body: {
          version: 1,
          state: "ready",
          recipientUserId,
          coupleId,
          references,
          partial: false,
        },
      };
    },
    async listPreparationNotesAsService({ recipientUserId, coupleId, query }) {
      if (coupleId !== ownerCoupleId || recipientUserId === users[2].id) {
        return { ok: false, status: 404, body: {} };
      }
      const sharedEntry = {
        refId: sharedRefId,
        topicKey: "meeting",
        messageId: sharedAnswerId,
        audience: "couple_shared",
        revision: 1,
        savedAt: "2026-08-18T01:00:02.000Z",
        sourceCreatedAt: "2026-08-18T01:00:01.000Z",
        questionExcerpt: sharedQuestion,
        answerExcerpt: sharedAnswer,
        canRemove: true,
        canOpenOriginal: true,
      };
      const privateEntry = {
        refId: privateRefId,
        topicKey: "housing",
        messageId: privateAnswerId,
        audience: "owner_private",
        revision: 1,
        savedAt: "2026-08-18T01:00:04.000Z",
        sourceCreatedAt: "2026-08-18T01:00:03.000Z",
        questionExcerpt: privateQuestion,
        answerExcerpt: privateAnswer,
        canRemove: true,
        canOpenOriginal: true,
      };
      const entries = query === "예산"
        ? (recipientUserId === users[0].id ? [privateEntry] : [])
        : (recipientUserId === users[0].id ? [privateEntry, sharedEntry] : [sharedEntry]);
      return {
        ok: true,
        status: 200,
        body: {
          version: 1,
          state: "ready",
          recipientUserId,
          coupleId,
          snapshotAt: "2026-08-18T01:00:05.000Z",
          entries,
          nextBoundary: null,
          partial: false,
        },
      };
    },
    async resolveMessageRefAsService({ recipientUserId, refId }) {
      if ((refId === privateRefId && recipientUserId !== users[0].id)
          || (refId === sharedRefId && removed)) {
        return { ok: false, status: 404, body: {} };
      }
      const isShared = refId === sharedRefId;
      return {
        ok: true,
        status: 200,
        body: {
          version: 1,
          state: "ready",
          recipientUserId,
          coupleId: ownerCoupleId,
          reference: {
            refId,
            topicKey: isShared ? "meeting" : "housing",
            messageId: isShared ? sharedAnswerId : privateAnswerId,
            audience: isShared ? "couple_shared" : "owner_private",
            revision: 1,
            savedAt: "2026-08-18T01:00:02.000Z",
          },
          target: {
            messageId: isShared ? sharedAnswerId : privateAnswerId,
            lane: isShared ? "shared" : "private",
            content: isShared ? sharedAnswer : privateAnswer,
            createdAt: "2026-08-18T01:00:01.000Z",
          },
          question: {
            messageId: isShared ? sharedQuestionId : privateQuestionId,
            lane: isShared ? "shared" : "private",
            senderType: "bride",
            content: isShared ? sharedQuestion : privateQuestion,
            createdAt: "2026-08-18T01:00:00.000Z",
          },
        },
      };
    },
    async deletePreparationTopicMessageFixtures() {},
    async resetMembership() {},
    async deleteSyntheticUser(userId) {
      deletedUsers.push(userId);
    },
    async readMessageRefResidue() {
      return { profiles: 0, couples: 0, chatMessages: 0, messageRefs: 0 };
    },
  };

  const result = await runPreparationTopicMessageRefScenario({ transport });

  assert.deepEqual(result.checks, {
    ownerSpace: true,
    partnerJoin: true,
    outsiderSpace: true,
    authenticatedRpcDenied: true,
    authenticatedTableDenied: true,
    authenticatedNotesRpcDenied: true,
    sharedConcurrentReplay: true,
    privateSave: true,
    ownerList: true,
    partnerListPrivacy: true,
    outsiderIsolation: true,
    ownerNotesSearch: true,
    partnerNotesPrivacy: true,
    outsiderNotesIsolation: true,
    sharedResolve: true,
    privateResolve: true,
    partnerPrivateDenied: true,
    removeAndStaleRevision: true,
    cleanup: true,
  });
  assert.deepEqual(result.residue, {
    profiles: 0,
    couples: 0,
    chatMessages: 0,
    messageRefs: 0,
  });
  assert.equal(result.syntheticUserCount, 3);
  assert.deepEqual(deletedUsers.sort(), users.map(({ id }) => id).sort());
  const serialized = JSON.stringify(result);
  for (const secret of [
    ...users.map(({ id }) => id),
    ownerCoupleId,
    outsiderCoupleId,
    sharedQuestion,
    sharedAnswer,
    privateQuestion,
    privateAnswer,
  ]) assert.equal(serialized.includes(secret), false);
});

test("two synthetic users prove mediation stays private until the requester explicitly shares one canonical card", async () => {
  const owner = { id: "10000000-0000-4000-8000-000000000041", accessToken: "owner-token" };
  const partner = { id: "10000000-0000-4000-8000-000000000042", accessToken: "partner-token" };
  const coupleId = "20000000-0000-4000-8000-000000000041";
  const draftId = "30000000-0000-4000-8000-000000000041";
  const sharedId = "40000000-0000-4000-8000-000000000041";
  const directId = "50000000-0000-4000-8000-000000000041";
  const users = [owner, partner];
  let userIndex = 0;
  let shared = false;
  const deletedUsers = [];
  const transport = {
    async createSyntheticUser() { return users[userIndex++]; },
    async createNeutralPreparationSpace() {
      return {
        success: true,
        created: true,
        couple_id: coupleId,
        invite_code: "WH-MEDIATION001",
        member_model_version: 2,
      };
    },
    async joinNeutralPreparationSpaceServer() {
      return { success: true, joined: true, couple_id: coupleId, member_model_version: 2 };
    },
    async createMediationDraftFixture() {
      return { draftId, privateVisibility: "bride_private" };
    },
    async attemptDirectSharedMediation() { return { denied: true, messageId: directId }; },
    async callShareMediationAsAuthenticated() { return { denied: true }; },
    async shareMediationAsService({ userId }) {
      if (userId === partner.id) return { ok: false, status: 403, body: {} };
      const reused = shared;
      shared = true;
      return {
        ok: true,
        status: 200,
        body: { shared_message_id: sharedId, reused, acceptance: null },
      };
    },
    async readMediationMessageAsUser(user, messageId) {
      if (messageId === draftId && user.id !== owner.id) return [];
      if (messageId === sharedId && !shared) return [];
      return [{
        id: messageId,
        visibility: messageId === draftId ? "bride_private" : "shared",
        content: messageId === draftId
          ? "private outer prose"
          : "요청하신 분이 초안을 읽고 이 카드를 보냈어요.",
        metadata: messageId === draftId
          ? { mediation_draft_state: shared ? "sent" : "draft", mediation_shared_message_id: shared ? sharedId : null }
          : { mediation_source_draft_id: draftId, mediation_share_origin: "requester_sent" },
      }];
    },
    async deleteMediationFixtures() {},
    async resetMembership() {},
    async deleteSyntheticUser(userId) { deletedUsers.push(userId); },
    async readMessageRefResidue() {
      return { profiles: 0, couples: 0, chatMessages: 0, messageRefs: 0 };
    },
  };

  const result = await runMediationPrivateDraftScenario({ transport });

  assert.deepEqual(result.checks, {
    ownerSpace: true,
    partnerJoin: true,
    privateBeforeShare: true,
    directSharedInsertDenied: true,
    authenticatedShareDenied: true,
    wrongActorShareDenied: true,
    canonicalShare: true,
    exactReplay: true,
    sharedVisibleToCouple: true,
    cleanup: true,
  });
  assert.deepEqual(result.residue, {
    profiles: 0,
    couples: 0,
    chatMessages: 0,
    messageRefs: 0,
  });
  assert.deepEqual(deletedUsers.sort(), users.map(({ id }) => id).sort());
  assert.equal(JSON.stringify(result).includes(owner.id), false);
  assert.equal(JSON.stringify(result).includes(partner.id), false);
  assert.equal(JSON.stringify(result).includes(draftId), false);
  assert.equal(JSON.stringify(result).includes(sharedId), false);
});

test("two synthetic users prove only the current shared criterion gains one immutable action-context receipt", async () => {
  const owner = { id: "10000000-0000-4000-8000-000000000061", accessToken: "owner-token" };
  const partner = { id: "10000000-0000-4000-8000-000000000062", accessToken: "partner-token" };
  const coupleId = "20000000-0000-4000-8000-000000000061";
  const firstDecisionId = "70000000-0000-4000-8000-000000000061";
  const secondDecisionId = "70000000-0000-4000-8000-000000000062";
  const firstSourceId = "30000000-0000-4000-8000-000000000061";
  const secondSourceId = "30000000-0000-4000-8000-000000000062";
  const firstActionId = "act_first_context";
  const secondActionId = "act_stale_context";
  const users = [owner, partner];
  let userIndex = 0;
  let criterionCount = 0;
  const finalizeCounts = new Map();
  const transport = {
    async createSyntheticUser() { return users[userIndex++]; },
    async createNeutralPreparationSpace() {
      return {
        success: true,
        created: true,
        couple_id: coupleId,
        invite_code: "WH-CRITERION001",
        member_model_version: 2,
      };
    },
    async joinNeutralPreparationSpaceServer() {
      return { success: true, joined: true, couple_id: coupleId, member_model_version: 2 };
    },
    async createConfirmedCoupleCriterion({ value }) {
      criterionCount += 1;
      return {
        linked: true,
        decisionId: criterionCount === 1 ? firstDecisionId : secondDecisionId,
        value,
      };
    },
    async attemptInjectCriterionActionContext() { return { denied: true, actionId: "act_injected" }; },
    async prepareCriterionActionApplication({ sequence, criterionDecisionId }) {
      return {
        sourceProposalId: sequence === 1 ? firstSourceId : secondSourceId,
        criterionDecisionId,
        journeyRevision: 7,
        applicationRequestKey: `chat:${owner.id}:80000000-0000-4000-8000-00000000006${sequence}`,
        attemptCount: 1,
        expectedPrivacyEpoch: 11,
      };
    },
    async finalizeCriterionActionApplication(fixture) {
      const count = finalizeCounts.get(fixture.applicationRequestKey) ?? 0;
      finalizeCounts.set(fixture.applicationRequestKey, count + 1);
      const actionId = fixture.sourceProposalId === firstSourceId ? firstActionId : secondActionId;
      return [{
        outcome: count === 0 ? "persisted" : "replayed",
        message_id: fixture.sourceProposalId === firstSourceId
          ? "90000000-0000-4000-8000-000000000061"
          : "90000000-0000-4000-8000-000000000062",
        message_reused: count > 0,
        tool_result: {
          toolName: "add_amora_action",
          toolOutput: { action: { id: actionId, status: "open" } },
          success: true,
        },
      }];
    },
    async readCriterionAction(actionId) {
      if (actionId === firstActionId) {
        return [{
          id: firstActionId,
          category_key: "venue",
          follow_up_revision: 1,
          status: "open",
          metadata: {
            amora_topic_criterion_context_v1: {
              version: 1,
              scope: "couple",
              criterionDecisionId: firstDecisionId,
              topicKey: "venue",
              affects: "action",
              sourceMessageId: firstSourceId,
              sourceJourneyRevision: 7,
              actionRevision: 1,
            },
          },
        }];
      }
      return [{
        id: secondActionId,
        category_key: "venue",
        follow_up_revision: 1,
        status: "open",
        metadata: {},
      }];
    },
    async attemptRemoveCriterionActionContext() { return { denied: true }; },
    async resetMembership() {},
    async deleteSyntheticUser() {},
    async readCriterionActionResidue() {
      return {
        profiles: 0,
        couples: 0,
        journeys: 0,
        chatMessages: 0,
        chatClaims: 0,
        actions: 0,
        executions: 0,
        applicationClaims: 0,
        criterionProposals: 0,
        criterionAcceptances: 0,
        decisions: 0,
        providerReceipts: 0,
      };
    },
  };

  const result = await runCriterionActionContextScenario({ transport });

  assert.equal(result.providerEvidence, "synthetic_fixture_no_live_provider_call");
  assert.deepEqual(result.checks, {
    ownerSpace: true,
    partnerJoin: true,
    firstCriterionConfirmed: true,
    directInjectionDenied: true,
    currentContextSealed: true,
    criterionTextNotCopied: true,
    exactReplay: true,
    contextImmutable: true,
    changedCriterionConfirmed: true,
    staleContextOmittedWithoutUndoingAction: true,
    cleanup: true,
  });
  assert.ok(Object.values(result.residue).every((count) => count === 0));
  const serialized = JSON.stringify(result);
  for (const secret of [
    owner.id,
    partner.id,
    coupleId,
    firstDecisionId,
    secondDecisionId,
    "무리하지 않는 예산 안에서 결정해요",
    "이동 시간을 먼저 봐요",
  ]) assert.equal(serialized.includes(secret), false);
});

test("the staging transport obtains both legacy API roles without exposing unrelated keys", async () => {
  const requests = [];
  const keys = await loadSupabaseProjectApiKeys({
    projectRef: STAGING_REF,
    managementToken: "management-token-that-is-long-enough",
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return new Response(JSON.stringify([
        { name: "anon", api_key: "anon-key-value" },
        { name: "service_role", api_key: "service-role-key-value" },
        { name: "publishable", api_key: "unused-publishable-key" },
      ]), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  assert.deepEqual(keys, {
    anonKey: "anon-key-value",
    serviceRoleKey: "service-role-key-value",
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, `https://api.supabase.com/v1/projects/${STAGING_REF}/api-keys`);
  assert.equal(requests[0].init.headers.Authorization, "Bearer management-token-that-is-long-enough");
  assert.equal(JSON.stringify(keys).includes("unused-publishable-key"), false);
});

test("hosted request failures name only a redacted API path", async () => {
  const transport = createSupabaseStagingTransport({
    projectRef: STAGING_REF,
    anonKey: "anon-key-value",
    serviceRoleKey: "service-role-key-value",
    fetchImpl: async () => new Response(JSON.stringify({ message: "secret backend detail" }), {
      status: 403,
    }),
  });
  const user = {
    id: "10000000-0000-4000-8000-000000000091",
    accessToken: "private-user-token",
  };

  await assert.rejects(
    () => transport.readProfile(user, user.id),
    (error) => error instanceof AmoraSuccessorStagingProbeError
      && error.code === "HOSTED_REQUEST_REJECTED"
      && error.message === "Hosted staging request to /rest/v1/profiles returned HTTP 403"
      && !error.message.includes(user.id)
      && !error.message.includes(user.accessToken)
      && !error.message.includes("secret backend detail"),
  );
});

test("hosted request failures expose only bounded SQL diagnostics", async () => {
  const transport = createSupabaseStagingTransport({
    projectRef: STAGING_REF,
    anonKey: "anon-key-value",
    serviceRoleKey: "service-role-key-value",
    fetchImpl: async () => new Response(JSON.stringify({
      code: "23514",
      message: "AMORA_PROVIDER_BACKED_ADD_ACTION_SOURCE_INVALID",
      details: "private row detail",
    }), { status: 400 }),
  });
  const user = {
    id: "10000000-0000-4000-8000-000000000092",
    accessToken: "private-user-token",
  };

  await assert.rejects(
    () => transport.readProfile(user, user.id),
    (error) => error instanceof AmoraSuccessorStagingProbeError
      && error.code === "HOSTED_REQUEST_REJECTED"
      && error.message === "Hosted staging request to /rest/v1/profiles returned HTTP 400 (SQLSTATE 23514; AMORA_PROVIDER_BACKED_ADD_ACTION_SOURCE_INVALID)"
      && !error.message.includes(user.id)
      && !error.message.includes("private row detail"),
  );
});

test("the staging transport binds message-ref fixtures and RPCs to service versus user credentials", async () => {
  const owner = {
    id: "10000000-0000-4000-8000-000000000021",
    accessToken: "owner-access-token",
  };
  const coupleId = "20000000-0000-4000-8000-000000000021";
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("/profiles?")) {
      return new Response(JSON.stringify([{
        id: owner.id,
        couple_id: coupleId,
        role: "bride",
      }]), { status: 200 });
    }
    if (String(url).endsWith("/rest/v1/chat_messages") && init.method === "POST") {
      return new Response("", { status: 201 });
    }
    if (String(url).endsWith("/rest/v1/rpc/get_own_amora_privacy_epoch")) {
      return new Response("7", { status: 200 });
    }
    if (String(url).includes("/rest/v1/amora_preparation_topic_message_refs")) {
      return new Response(JSON.stringify({ code: "42501" }), { status: 401 });
    }
    if (String(url).endsWith("/rest/v1/rpc/set_amora_preparation_topic_message_ref_v1")) {
      const body = JSON.parse(init.body);
      if (init.headers.Authorization === `Bearer ${owner.accessToken}`) {
        return new Response(JSON.stringify({ code: "42501" }), { status: 401 });
      }
      return new Response(JSON.stringify({ request: body }), { status: 200 });
    }
    if (String(url).endsWith("/rest/v1/rpc/list_amora_preparation_notes_v1")) {
      const body = JSON.parse(init.body);
      if (init.headers.Authorization === `Bearer ${owner.accessToken}`) {
        return new Response(JSON.stringify({ code: "42501" }), { status: 401 });
      }
      return new Response(JSON.stringify({
        version: 1,
        state: "ready",
        recipientUserId: body.p_recipient_user_id,
        coupleId: body.p_couple_id,
        snapshotAt: "2026-08-18T01:00:05.000Z",
        entries: [],
        nextBoundary: null,
        partial: false,
      }), { status: 200 });
    }
    if (String(url).includes("/rest/v1/chat_messages?") && init.method === "DELETE") {
      return new Response(null, { status: 204 });
    }
    return new Response("[]", { status: 200 });
  };
  const transport = createSupabaseStagingTransport({
    projectRef: STAGING_REF,
    anonKey: "anon-key-value",
    serviceRoleKey: "service-role-key-value",
    fetchImpl,
    runNonce: "message-ref-contract",
  });

  const fixtures = await transport.createPreparationTopicMessageFixtures({ owner, coupleId });
  assert.equal(new Set([
    fixtures.sharedQuestionId,
    fixtures.sharedAnswerId,
    fixtures.privateQuestionId,
    fixtures.privateAnswerId,
  ]).size, 4);
  assert.equal(await transport.readPrivacyEpoch(owner, coupleId), 7);
  assert.deepEqual(
    await transport.callMessageRefRpcAsAuthenticated(owner, {
      coupleId,
      actorUserId: owner.id,
      topicKey: "meeting",
      messageId: fixtures.sharedAnswerId,
      desiredState: "saved",
      expectedRevision: 0,
      requestId: "60000000-0000-4000-8000-000000000021",
      expectedPrivacyEpoch: 7,
    }),
    { denied: true },
  );
  assert.deepEqual(await transport.readMessageRefTableAsAuthenticated(owner), {
    denied: true,
  });
  assert.deepEqual(await transport.callPreparationNotesRpcAsAuthenticated(owner, {
    coupleId,
    recipientUserId: owner.id,
    expectedPrivacyEpoch: 7,
    query: "예산",
  }), { denied: true });
  const serviceNotes = await transport.listPreparationNotesAsService({
    coupleId,
    recipientUserId: owner.id,
    expectedPrivacyEpoch: 7,
    query: "예산",
  });
  assert.equal(serviceNotes.ok, true);
  const serviceMutation = await transport.setMessageRefAsService({
    coupleId,
    actorUserId: owner.id,
    topicKey: "meeting",
    messageId: fixtures.sharedAnswerId,
    desiredState: "saved",
    expectedRevision: 0,
    requestId: "60000000-0000-4000-8000-000000000022",
    expectedPrivacyEpoch: 7,
  });
  assert.equal(serviceMutation.ok, true);
  await transport.deletePreparationTopicMessageFixtures([
    fixtures.sharedQuestionId,
    fixtures.sharedAnswerId,
    fixtures.privateQuestionId,
    fixtures.privateAnswerId,
  ]);

  const insertCall = calls.find(({ url, init }) => (
    url.endsWith("/rest/v1/chat_messages") && init.method === "POST"
  ));
  assert.ok(insertCall);
  const inserted = JSON.parse(insertCall.init.body);
  assert.equal(inserted.length, 4);
  assert.deepEqual(inserted.map(({ visibility }) => visibility), [
    "shared", "shared", "bride_private", "bride_private",
  ]);
  assert.deepEqual(inserted.map(({ role }) => role), [
    "user", "assistant", "user", "assistant",
  ]);
  assert.equal(inserted[1].metadata.in_reply_to_user_message_id, inserted[0].id);
  assert.equal(inserted[3].metadata.in_reply_to_user_message_id, inserted[2].id);
  const authenticatedRpcCall = calls.find(({ url, init }) => (
    url.endsWith("/rest/v1/rpc/set_amora_preparation_topic_message_ref_v1")
      && init.headers.Authorization === `Bearer ${owner.accessToken}`
  ));
  const serviceRpcCall = calls.find(({ url, init }) => (
    url.endsWith("/rest/v1/rpc/set_amora_preparation_topic_message_ref_v1")
      && init.headers.Authorization === "Bearer service-role-key-value"
  ));
  assert.ok(authenticatedRpcCall);
  assert.ok(serviceRpcCall);
  const notesCalls = calls.filter(({ url }) => (
    url.endsWith("/rest/v1/rpc/list_amora_preparation_notes_v1")
  ));
  assert.equal(notesCalls.length, 2);
  assert.equal(notesCalls[0].init.headers.Authorization, `Bearer ${owner.accessToken}`);
  assert.equal(notesCalls[1].init.headers.Authorization, "Bearer service-role-key-value");
  const notesBody = JSON.parse(notesCalls[1].init.body);
  assert.deepEqual(notesBody, {
    p_couple_id: coupleId,
    p_recipient_user_id: owner.id,
    p_expected_privacy_epoch: 7,
    p_query: "예산",
    p_snapshot_at: null,
    p_cursor_saved_at: null,
    p_cursor_ref_id: null,
    p_limit: 24,
  });
});

test("the staging transport binds mediation drafts, sharing, reads, and cleanup to exact credentials", async () => {
  const owner = {
    id: "10000000-0000-4000-8000-000000000051",
    accessToken: "mediation-owner-token",
  };
  const partnerId = "10000000-0000-4000-8000-000000000052";
  const coupleId = "20000000-0000-4000-8000-000000000051";
  const sharedId = "40000000-0000-4000-8000-000000000051";
  const calls = [];
  const fetchImpl = async (url, init) => {
    const request = { url: String(url), init };
    calls.push(request);
    if (request.url.includes("/rest/v1/profiles?")) {
      return new Response(JSON.stringify([{
        id: owner.id,
        couple_id: coupleId,
        role: "bride",
      }]), { status: 200 });
    }
    if (request.url.includes("/rest/v1/couples?")) {
      return new Response(JSON.stringify([{
        id: coupleId,
        bride_id: owner.id,
        groom_id: partnerId,
      }]), { status: 200 });
    }
    if (request.url.endsWith("/rest/v1/chat_messages") && init.method === "POST") {
      const body = JSON.parse(init.body);
      if (body.visibility === "shared") {
        return new Response(JSON.stringify({ code: "23514" }), { status: 400 });
      }
      return new Response(null, { status: 201 });
    }
    if (request.url.endsWith("/rest/v1/rpc/share_amora_mediation_draft")) {
      if (init.headers.Authorization === `Bearer ${owner.accessToken}`) {
        return new Response(JSON.stringify({ code: "42501" }), { status: 401 });
      }
      return new Response(JSON.stringify({
        shared_message_id: sharedId,
        reused: false,
        acceptance: null,
      }), { status: 200 });
    }
    if (request.url.includes("/rest/v1/chat_messages?") && init.method === "GET") {
      return new Response("[]", { status: 200 });
    }
    if (request.url.includes("/rest/v1/chat_messages?") && init.method === "DELETE") {
      return new Response(null, { status: 204 });
    }
    return new Response("[]", { status: 200 });
  };
  const transport = createSupabaseStagingTransport({
    projectRef: STAGING_REF,
    anonKey: "anon-key-value",
    serviceRoleKey: "service-role-key-value",
    fetchImpl,
    runNonce: "mediation-contract",
  });

  const fixture = await transport.createMediationDraftFixture({ owner, coupleId });
  assert.equal(fixture.privateVisibility, "bride_private");
  const direct = await transport.attemptDirectSharedMediation({ coupleId });
  assert.equal(direct.denied, true);
  assert.deepEqual(await transport.callShareMediationAsAuthenticated(owner, {
    draftId: fixture.draftId,
    userId: owner.id,
  }), { denied: true });
  const shared = await transport.shareMediationAsService({
    draftId: fixture.draftId,
    userId: owner.id,
    accept: false,
  });
  assert.equal(shared.body.shared_message_id, sharedId);
  assert.deepEqual(await transport.readMediationMessageAsUser(owner, sharedId), []);
  await transport.deleteMediationFixtures([fixture.draftId, direct.messageId, sharedId]);

  const fixtureInsert = calls.find(({ url, init }) => (
    url.endsWith("/rest/v1/chat_messages")
      && init.method === "POST"
      && JSON.parse(init.body).visibility === "bride_private"
  ));
  assert.ok(fixtureInsert);
  assert.equal(fixtureInsert.init.headers.Authorization, "Bearer service-role-key-value");
  const draft = JSON.parse(fixtureInsert.init.body);
  assert.equal(draft.sender_id, null);
  assert.equal(draft.sender_type, "ai");
  assert.equal(draft.role, "assistant");
  assert.deepEqual(Object.keys(draft.metadata.mediation).sort(), [
    "data", "empathy", "evidenceScope", "origin", "resolution", "schemaVersion", "translation",
  ].sort());
  assert.equal(
    draft.metadata.mediation_draft_roster_fingerprint,
    createHash("md5").update(`${owner.id}:${partnerId}`, "utf8").digest("hex"),
  );

  const directInsert = calls.find(({ url, init }) => (
    url.endsWith("/rest/v1/chat_messages")
      && init.method === "POST"
      && JSON.parse(init.body).visibility === "shared"
  ));
  assert.ok(directInsert);
  assert.equal(directInsert.init.headers.Authorization, "Bearer service-role-key-value");
  assert.equal(JSON.parse(directInsert.init.body).metadata.mediation_share_origin, "requester_sent");

  const shareCalls = calls.filter(({ url }) => (
    url.endsWith("/rest/v1/rpc/share_amora_mediation_draft")
  ));
  assert.equal(shareCalls.length, 2);
  assert.equal(shareCalls[0].init.headers.Authorization, `Bearer ${owner.accessToken}`);
  assert.equal(shareCalls[1].init.headers.Authorization, "Bearer service-role-key-value");
  assert.deepEqual(JSON.parse(shareCalls[1].init.body), {
    p_draft_message_id: fixture.draftId,
    p_user_id: owner.id,
    p_accept: false,
  });
  const readCall = calls.find(({ url, init }) => (
    url.includes("/rest/v1/chat_messages?") && init.method === "GET"
  ));
  assert.equal(readCall.init.headers.Authorization, `Bearer ${owner.accessToken}`);
});

test("the staging transport derives criterion action applications through canonical service boundaries", async () => {
  const owner = {
    id: "10000000-0000-4000-8000-000000000071",
    accessToken: "criterion-owner-token",
  };
  const partnerId = "10000000-0000-4000-8000-000000000072";
  const coupleId = "20000000-0000-4000-8000-000000000071";
  const proposalId = "60000000-0000-4000-8000-000000000071";
  const decisionId = "70000000-0000-4000-8000-000000000071";
  const applicationMessageId = "90000000-0000-4000-8000-000000000071";
  const calls = [];
  let journeyCreated = false;
  const fetchImpl = async (url, init) => {
    const request = { url: String(url), init, body: init.body ? JSON.parse(init.body) : null };
    calls.push(request);
    if (request.url.includes("/rest/v1/profiles?")) {
      return new Response(JSON.stringify([{
        id: owner.id,
        couple_id: coupleId,
        role: "bride",
      }]), { status: 200 });
    }
    if (request.url.includes("/rest/v1/wedding_journeys?")) {
      return new Response(JSON.stringify(journeyCreated
        ? [{ couple_id: coupleId, state_revision: 7 }]
        : []), { status: 200 });
    }
    if (request.url.endsWith("/rest/v1/wedding_journeys") && init.method === "POST") {
      journeyCreated = true;
      return new Response(null, { status: 201 });
    }
    if (request.url.endsWith("/rest/v1/rpc/get_own_amora_privacy_epoch")) {
      return new Response("11", { status: 200 });
    }
    if (request.url.endsWith("/rest/v1/rpc/propose_amora_couple_core_criterion_v1")) {
      return new Response(JSON.stringify({
        coupleId,
        linked: true,
        current: null,
        proposal: {
          id: proposalId,
          value: "무리하지 않는 예산 안에서 결정해요",
          revision: 1,
        },
      }), { status: 200 });
    }
    if (request.url.endsWith("/rest/v1/rpc/accept_amora_couple_core_criterion_v1")
        || request.url.endsWith("/rest/v1/rpc/read_amora_couple_core_criterion_v1")) {
      return new Response(JSON.stringify({
        linked: true,
        current: { decisionId, value: "무리하지 않는 예산 안에서 결정해요" },
        proposal: null,
      }), { status: 200 });
    }
    if (request.url.endsWith("/rest/v1/chat_messages") && init.method === "POST") {
      return new Response(null, { status: 201 });
    }
    if (request.url.endsWith("/rest/v1/rpc/claim_amora_chat_request")) {
      return new Response(JSON.stringify({ action: "acquired", attempt_count: 1 }), { status: 200 });
    }
    if (request.url.endsWith("/rest/v1/rpc/complete_amora_chat_request")) {
      return new Response("true", { status: 200 });
    }
    if (request.url.endsWith("/rest/v1/ai_interactions_log") && init.method === "POST") {
      return new Response(null, { status: 201 });
    }
    if (request.url.endsWith("/rest/v1/rpc/claim_amora_shared_action_application")) {
      return new Response(JSON.stringify({ applicationGranted: true, retryAfterMs: 0 }), { status: 200 });
    }
    if (request.url.endsWith("/rest/v1/rpc/finalize_amora_provider_backed_add_action_application_v1")) {
      return new Response(JSON.stringify([{
        outcome: "persisted",
        message_id: applicationMessageId,
        message_reused: false,
        tool_result: {
          toolName: "add_amora_action",
          toolOutput: { action: { id: "act_criterion_probe", status: "open" } },
          success: true,
        },
      }]), { status: 200 });
    }
    if (request.url.includes("/rest/v1/amora_actions?") && init.method === "GET") {
      return new Response(JSON.stringify([{ id: "act_criterion_probe", metadata: {} }]), { status: 200 });
    }
    if (request.url.endsWith("/rest/v1/amora_actions") && init.method === "POST") {
      return new Response(JSON.stringify({ code: "42501" }), { status: 400 });
    }
    if (request.url.includes("/rest/v1/amora_actions?") && init.method === "PATCH") {
      return new Response(JSON.stringify({ code: "23514" }), { status: 400 });
    }
    return new Response("[]", { status: 200 });
  };
  const transport = createSupabaseStagingTransport({
    projectRef: STAGING_REF,
    anonKey: "anon-key-value",
    serviceRoleKey: "service-role-key-value",
    fetchImpl,
    runNonce: "criterion-contract",
  });

  const criterion = await transport.createConfirmedCoupleCriterion({
    coupleId,
    ownerId: owner.id,
    partnerId,
    expectedCurrentDecisionId: null,
    value: "무리하지 않는 예산 안에서 결정해요",
  });
  assert.equal(criterion.decisionId, decisionId);
  assert.equal((await transport.attemptInjectCriterionActionContext({
    coupleId,
    criterionDecisionId: decisionId,
  })).denied, true);
  const fixture = await transport.prepareCriterionActionApplication({
    owner,
    coupleId,
    criterionDecisionId: decisionId,
    sequence: 1,
  });
  const finalized = await transport.finalizeCriterionActionApplication(fixture);
  assert.equal(finalized[0].message_id, applicationMessageId);
  assert.deepEqual(await transport.readCriterionAction("act_criterion_probe"), [{
    id: "act_criterion_probe",
    metadata: {},
  }]);
  assert.equal((await transport.attemptRemoveCriterionActionContext({
    actionId: "act_criterion_probe",
  })).denied, true);

  const privacyCall = calls.find(({ url }) => url.endsWith("/rest/v1/rpc/get_own_amora_privacy_epoch"));
  assert.equal(privacyCall.init.headers.Authorization, `Bearer ${owner.accessToken}`);
  assert.ok(calls
    .filter((call) => call !== privacyCall)
    .every(({ init }) => init.headers.Authorization === "Bearer service-role-key-value"));
  const sourceProposal = calls
    .filter(({ url, init }) => url.endsWith("/rest/v1/chat_messages") && init.method === "POST")
    .map(({ body }) => body)
    .find(({ sender_type: senderType }) => senderType === "ai");
  assert.equal(sourceProposal.metadata.amora_couple_criterion_decision_id, decisionId);
  assert.equal(sourceProposal.metadata.amora_add_action_proposal_origin_v1, "ordinary_provider");
  assert.equal(sourceProposal.metadata.amora_first_use_grounding, undefined);
  assert.equal(JSON.stringify(sourceProposal.metadata).includes("무리하지 않는 예산 안에서 결정해요"), false);
  assert.match(sourceProposal.metadata.pending_amora_action.inputDigest, /^[a-f0-9]{64}$/);
  assert.match(sourceProposal.metadata.pending_amora_action.operationKey, /^[a-f0-9]{64}$/);
  const providerReceipt = calls.find(({ url }) => url.endsWith("/rest/v1/ai_interactions_log"));
  assert.equal(providerReceipt.body.amora_call_source, "durable");
  assert.equal(providerReceipt.body.amora_cost_status, "settled");
  assert.equal(providerReceipt.body.metadata.hosted_probe_fixture, true);
});

test("the hosted probe binds its receipt to the exact applied migration ledger", async () => {
  const ledger = await readHostedMigrationLedger({
    projectRef: STAGING_REF,
    managementToken: "management-token-that-is-long-enough",
    expectedCount: 218,
    expectedHead: "20260816190000",
    fetchImpl: async () => new Response(JSON.stringify([{
      migration_count: 218,
      migration_head: "20260816190000",
    }]), { status: 201, headers: { "content-type": "application/json" } }),
  });

  assert.deepEqual(ledger, { count: 218, head: "20260816190000" });
});

test("the fixed read-only residue query counts protected message refs without exposing rows", async () => {
  const requests = [];
  const residue = await readHostedMessageRefResidue({
    projectRef: STAGING_REF,
    productionProjectRef: PRODUCTION_REF,
    managementToken: "management-token-that-is-long-enough",
    userIds: ["10000000-0000-4000-8000-000000000031"],
    coupleIds: ["20000000-0000-4000-8000-000000000031"],
    messageIds: ["30000000-0000-4000-8000-000000000031"],
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return new Response(JSON.stringify([{
        profiles: 0,
        couples: 0,
        chat_messages: 0,
        message_refs: 0,
      }]), { status: 201 });
    },
  });

  assert.deepEqual(residue, {
    profiles: 0,
    couples: 0,
    chatMessages: 0,
    messageRefs: 0,
  });
  assert.equal(requests.length, 1);
  assert.equal(
    requests[0].url,
    `https://api.supabase.com/v1/projects/${STAGING_REF}/database/query/read-only`,
  );
  const requestBody = JSON.parse(requests[0].init.body);
  assert.deepEqual(requestBody.parameters, [
    ["10000000-0000-4000-8000-000000000031"],
    ["20000000-0000-4000-8000-000000000031"],
    ["30000000-0000-4000-8000-000000000031"],
  ]);
  assert.match(requestBody.query, /amora_preparation_topic_message_refs/);
  assert.throws(
    () => readHostedMessageRefResidue({
      projectRef: PRODUCTION_REF,
      productionProjectRef: PRODUCTION_REF,
      managementToken: "management-token-that-is-long-enough",
      userIds: ["10000000-0000-4000-8000-000000000031"],
      coupleIds: ["20000000-0000-4000-8000-000000000031"],
      messageIds: ["30000000-0000-4000-8000-000000000031"],
    }),
    (error) => error instanceof AmoraSuccessorStagingProbeError
      && error.code === "PRODUCTION_TARGET_FORBIDDEN",
  );
});

test("the fixed read-only residue query covers criterion decisions, actions, claims, and provider receipts", async () => {
  const requests = [];
  const userIds = ["10000000-0000-4000-8000-000000000081"];
  const coupleIds = ["20000000-0000-4000-8000-000000000081"];
  const messageIds = ["30000000-0000-4000-8000-000000000081"];
  const actionIds = ["act_probe_criterion_081"];
  const residue = await readHostedCriterionActionResidue({
    projectRef: STAGING_REF,
    productionProjectRef: PRODUCTION_REF,
    managementToken: "management-token-that-is-long-enough",
    userIds,
    coupleIds,
    messageIds,
    actionIds,
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return new Response(JSON.stringify([{
        profiles: 0,
        couples: 0,
        journeys: 0,
        chat_messages: 0,
        chat_claims: 0,
        actions: 0,
        executions: 0,
        application_claims: 0,
        criterion_proposals: 0,
        criterion_acceptances: 0,
        decisions: 0,
        provider_receipts: 0,
      }]), { status: 201 });
    },
  });

  assert.deepEqual(residue, {
    profiles: 0,
    couples: 0,
    journeys: 0,
    chatMessages: 0,
    chatClaims: 0,
    actions: 0,
    executions: 0,
    applicationClaims: 0,
    criterionProposals: 0,
    criterionAcceptances: 0,
    decisions: 0,
    providerReceipts: 0,
  });
  assert.equal(requests.length, 1);
  assert.deepEqual(JSON.parse(requests[0].init.body).parameters, [
    userIds,
    coupleIds,
    messageIds,
    actionIds,
  ]);
  assert.match(JSON.parse(requests[0].init.body).query, /amora_couple_core_criterion_proposals/);
  assert.match(JSON.parse(requests[0].init.body).query, /ai_interactions_log/);
  assert.throws(
    () => readHostedCriterionActionResidue({
      projectRef: PRODUCTION_REF,
      productionProjectRef: PRODUCTION_REF,
      managementToken: "management-token-that-is-long-enough",
      userIds,
      coupleIds,
      messageIds,
      actionIds,
    }),
    (error) => error instanceof AmoraSuccessorStagingProbeError
      && error.code === "PRODUCTION_TARGET_FORBIDDEN",
  );
});

test("the hosted receipt runs membership, notes, mediation, and criterion-action scenarios", () => {
  assert.match(cliSource, /runNeutralPreparationSpaceScenario/);
  assert.match(cliSource, /runPreparationTopicMessageRefScenario/);
  assert.match(cliSource, /runMediationPrivateDraftScenario/);
  assert.match(cliSource, /runCriterionActionContextScenario/);
  assert.match(cliSource, /readHostedMessageRefResidue/);
  assert.match(cliSource, /readHostedCriterionActionResidue/);
  assert.match(cliSource, /receiptVersion:\s*5/);
  assert.match(cliSource, /scope:\s*"neutral-space-message-refs-notes-mediation-and-criterion"/);
  assert.match(cliSource, /neutralPreparationSpace/);
  assert.match(cliSource, /preparationTopicMessageRefs/);
  assert.match(cliSource, /mediationPrivateDraft/);
  assert.match(cliSource, /criterionActionContext/);
});
