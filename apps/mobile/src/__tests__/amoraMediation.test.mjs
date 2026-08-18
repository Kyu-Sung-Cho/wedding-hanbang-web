import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";
// 앱과 웹이 같은 판정을 쓰는지 확인하려면 테스트도 그 실물을 써야 한다.
import {
  isRequesterSummaryMediationProvenance,
  readAmoraPrivateMediationDraftMetadata,
} from "@hanbang/shared/mediation-provenance";
import {
  hasUnsafeStoredMediationRenderContent,
  MEDIATION_DISCLOSURE_VERIFYING_COPY,
  MEDIATION_DISCLOSURE_WITHHELD_COPY,
  MEDIATION_RENDER_SAFETY_FALLBACK,
  resolveMediationDisclosureState,
} from "@hanbang/shared/mediation-render-safety";

const chatPath = fileURLToPath(new URL("../../app/(tabs)/chat.tsx", import.meta.url));
const cardPath = fileURLToPath(new URL("../components/chat/AmoraMediationCard.tsx", import.meta.url));
const clientPath = fileURLToPath(new URL("../lib/amoraMediation.ts", import.meta.url));
const chatSource = readFileSync(chatPath, "utf8");
const cardSource = existsSync(cardPath) ? readFileSync(cardPath, "utf8") : "";
const EXPECTED_REVISION = {
  expectedProposalVersion: "123e4567-e89b-42d3-a456-426614174000",
  expectedRosterFingerprint: "0123456789abcdef0123456789abcdef",
};

test("private mediation draft metadata is strict, owner-only, and revision-bound", () => {
  const metadata = {
    question_scope: "W1_wedding_adjacent",
    memory_eligible: false,
    mediation_draft_state: "draft",
    mediation_draft_sendable: true,
    mediation_draft_roster_fingerprint: "a".repeat(32),
    mediation: {
      empathy: "요청자가 답답함을 느꼈다고 전했어요.",
      translation: "요청자가 예산 기준을 먼저 정하고 싶다고 전했어요.",
      data: "상대방의 생각은 아직 확인되지 않았어요.",
      resolution: "서로 가능한 상한을 하나씩 확인해요.",
      origin: "user_requested",
      evidenceScope: "requester_summary_only",
      schemaVersion: 2,
    },
  };

  assert.deepEqual(
    readAmoraPrivateMediationDraftMetadata(metadata, "bride_private"),
    {
      state: "draft",
      rosterFingerprint: "a".repeat(32),
      sharedMessageId: null,
    },
  );
  assert.equal(readAmoraPrivateMediationDraftMetadata(metadata, "shared"), null);
  assert.equal(readAmoraPrivateMediationDraftMetadata({
    ...metadata,
    memory_eligible: true,
  }, "bride_private"), null);
  assert.equal(readAmoraPrivateMediationDraftMetadata({
    ...metadata,
    mediation: { ...metadata.mediation, resolution: "" },
  }, "bride_private"), null);
  assert.equal(readAmoraPrivateMediationDraftMetadata({
    ...metadata,
    mediation_draft_roster_fingerprint: "wrong",
  }, "bride_private"), null);
});

test("a persisted AI mediation message exposes its structured proposal in the native chat", () => {
  assert.equal(existsSync(cardPath), true, "native mediation card is missing");
  assert.match(chatSource, /mediation\?: unknown/);
  assert.match(chatSource, /normalizeMediationBlock\(item\.metadata\?\.mediation\)/);
  assert.match(chatSource, /<AmoraMediationCard[\s\S]*block=\{mediationBlock\}[\s\S]*messageId=\{item\.id\}/);
  assert.match(cardSource, /from "react-native"/);
  assert.doesNotMatch(cardSource, /WebView|Linking\.openURL/);
});

test("native chat keeps a strict mediation draft private until an explicit share action", () => {
  assert.match(chatSource, /readAmoraPrivateMediationDraftMetadata/);
  assert.match(
    chatSource,
    /const privateMediationDraft = isAi[\s\S]*readAmoraPrivateMediationDraftMetadata\(item\.metadata, item\.visibility\)/,
  );
  assert.match(
    chatSource,
    /<AmoraMediationCard[\s\S]*privateDraft=\{privateMediationDraft\}[\s\S]*onDraftShared=/,
  );
  assert.match(cardSource, /나만 보는 조율 초안/);
  assert.match(cardSource, /직접 보내기 전에는 상대방에게 보이지 않아요/);
  assert.match(cardSource, /함께 보내고 내 확인 남기기/);
  assert.match(cardSource, /초안 버리기/);
  assert.match(cardSource, /shareMediationDraft\(messageId\)/);
  assert.match(cardSource, /discardMediationDraft\(messageId\)/);
  assert.match(cardSource, /minHeight:\s*48/);
});

test("native realtime replaces an updated proposal and removes newly hidden messages", () => {
  assert.match(chatSource, /event:\s*"UPDATE"[\s\S]*table:\s*"chat_messages"/);
  assert.match(chatSource, /const updated = chatMessageFromRealtimeRow\(payload\.new\)/);
  assert.match(chatSource, /!canViewerSeeChatMessage\(updated, viewerRole\)[\s\S]*filter\(\(message\) => message\.id !== updatedId\)/);
  assert.match(chatSource, /map\(\(message\) => message\.id === updated\.id \? updated : message\)/);
  assert.match(chatSource, /key=\{`\$\{item\.id\}:\$\{privateMediationDraft\?\.state \?\? mediationBlock\.proposalVersion \?\? "draft"\}:\$\{privateMediationDraft\?\.sharedMessageId \?\? mediationBlock\.rosterFingerprint \?\? "unknown-roster"\}`\}/);
});

function loadAcceptanceClient(apiJson) {
  const clientSource = readFileSync(clientPath, "utf8");
  const sourceFile = ts.createSourceFile(
    clientPath,
    clientSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const declarations = sourceFile.statements
    .filter((statement) =>
      ts.isFunctionDeclaration(statement) || ts.isVariableStatement(statement)
    )
    .map((statement) => statement.getFullText(sourceFile).replace(/\bexport\s+/g, ""))
    .join("\n");
  const compiled = ts.transpileModule(declarations, {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
  });
  return new Function(
    "apiJson",
    "isRequesterSummaryMediationProvenance",
    "hasUnsafeStoredMediationRenderContent",
    `${compiled.outputText}\nreturn {
      getMediationAcceptance,
      acceptMediationResolution: typeof acceptMediationResolution === "function"
        ? acceptMediationResolution
        : undefined,
      withdrawMediationAcceptance: typeof withdrawMediationAcceptance === "function"
        ? withdrawMediationAcceptance
        : undefined,
      canWithdrawMediationAcceptance: typeof canWithdrawMediationAcceptance === "function"
        ? canWithdrawMediationAcceptance
        : undefined,
      canAcceptMediationResolution: typeof canAcceptMediationResolution === "function"
        ? canAcceptMediationResolution
        : undefined,
      shareMediationDraft: typeof shareMediationDraft === "function"
        ? shareMediationDraft
        : undefined,
      discardMediationDraft: typeof discardMediationDraft === "function"
        ? discardMediationDraft
        : undefined,
      getExpectedMediationRevision: typeof getExpectedMediationRevision === "function"
        ? getExpectedMediationRevision
        : undefined,
      normalizeMediationBlock,
    };`,
  )(
    apiJson,
    isRequesterSummaryMediationProvenance,
    hasUnsafeStoredMediationRenderContent,
  );
}

test("sharing and discarding a private draft use only its opaque message id", async () => {
  const calls = [];
  const apiJson = async (path, options) => {
    calls.push({ path, options });
    return options.method === "POST"
      ? {
          sharedMessageId: "1474c6f2-29c6-4c77-8d91-d3347eef4c3f",
          reused: false,
        }
      : { discarded: true };
  };
  const { shareMediationDraft, discardMediationDraft } = loadAcceptanceClient(apiJson);
  const draftId = "2474c6f2-29c6-4c77-8d91-d3347eef4c3f";

  assert.deepEqual(await shareMediationDraft(draftId), {
    sharedMessageId: "1474c6f2-29c6-4c77-8d91-d3347eef4c3f",
    reused: false,
  });
  assert.deepEqual(await discardMediationDraft(draftId), { discarded: true });
  assert.deepEqual(calls, [
    {
      path: "/api/amora/mediation/draft",
      options: { method: "POST", body: JSON.stringify({ messageId: draftId }) },
    },
    {
      path: "/api/amora/mediation/draft",
      options: { method: "DELETE", body: JSON.stringify({ messageId: draftId }) },
    },
  ]);
});

test("a malformed draft mutation receipt fails closed", async () => {
  const { shareMediationDraft, discardMediationDraft } = loadAcceptanceClient(async (_path, options) => (
    options.method === "POST"
      ? { sharedMessageId: "wrong", reused: false }
      : { discarded: "yes" }
  ));
  const draftId = "2474c6f2-29c6-4c77-8d91-d3347eef4c3f";

  await assert.rejects(() => shareMediationDraft(draftId), /응답이 올바르지/);
  await assert.rejects(() => discardMediationDraft(draftId), /응답이 올바르지/);
});

test("opening a confirmable proposal loads the authenticated acceptance state", async () => {
  assert.equal(existsSync(clientPath), true, "mediation acceptance client is missing");
  const calls = [];
  const apiJson = async (path, options) => {
    calls.push({ path, options });
    return { accepted: false, acceptedCount: 0, requiredCount: 2, completed: false };
  };
  const { getMediationAcceptance } = loadAcceptanceClient(apiJson);
  const messageId = "1474c6f2-29c6-4c77-8d91-d3347eef4c3f";

  const state = await getMediationAcceptance(messageId, EXPECTED_REVISION);

  assert.deepEqual(state, {
    accepted: false,
    acceptedCount: 0,
    requiredCount: 2,
    completed: false,
  });
  assert.deepEqual(calls, [{
    path: `/api/amora/mediation/accept?messageId=${messageId}&expectedProposalVersion=${EXPECTED_REVISION.expectedProposalVersion}&expectedRosterFingerprint=${EXPECTED_REVISION.expectedRosterFingerprint}`,
    options: { cache: "no-store" },
  }]);
});

test("the mobile client preserves a solo account's partner-linked state", async () => {
  const { getMediationAcceptance } = loadAcceptanceClient(async () => ({
    accepted: false,
    acceptedCount: 0,
    requiredCount: 2,
    completed: false,
    partnerLinked: false,
  }));

  const state = await getMediationAcceptance(
    "1474c6f2-29c6-4c77-8d91-d3347eef4c3f",
    EXPECTED_REVISION,
  );

  assert.deepEqual(state, {
    accepted: false,
    acceptedCount: 0,
    requiredCount: 2,
    completed: false,
    partnerLinked: false,
  });
});

test("untrusted mediation metadata is normalized before it can reach native text", () => {
  const { normalizeMediationBlock } = loadAcceptanceClient(async () => ({}));

  assert.deepEqual(normalizeMediationBlock({
    empathy: "  속상했겠어요  ",
    translation: { unsafe: true },
    data: "확인할 자료가 아직 부족해요",
    proposalVersion: "not-a-uuid",
    rosterFingerprint: "not-a-fingerprint",
    ignored: "화면에 나오면 안 돼요",
  }), {
    empathy: "속상했겠어요",
    translation: undefined,
    data: "확인할 자료가 아직 부족해요",
    resolution: undefined,
    proposalVersion: undefined,
    rosterFingerprint: undefined,
    // 표식이 없으면 출처를 주장하지 않는다 — 화면은 "요청자가 전한" 문구를 쓰지 못한다.
    requesterSummaryOnly: false,
  });
  assert.equal(normalizeMediationBlock(null), null);
  assert.equal(normalizeMediationBlock([]), null);
  assert.equal(normalizeMediationBlock({ resolution: "가".repeat(501) }), null);
});

test("native normalization fails closed for biased forged-v2 and legacy stored cards", () => {
  const { normalizeMediationBlock } = loadAcceptanceClient(async () => ({}));
  const unsafeStoredCards = [
    {
      empathy: "요청자가 답답하다고 전했어요.",
      translation: "신랑은 이기적이고 신부의 요구가 더 타당해요.",
      data: "상대방의 생각은 확인되지 않았어요.",
      resolution: "신랑이 먼저 사과하고 양보하는 게 좋겠어요.",
      origin: "user_requested",
      evidenceScope: "requester_summary_only",
      schemaVersion: 2,
      proposalVersion: EXPECTED_REVISION.expectedProposalVersion,
      rosterFingerprint: EXPECTED_REVISION.expectedRosterFingerprint,
    },
    {
      translation: "신부는 신랑을 통제하려고 일부러 결정을 미루는 거예요.",
      resolution: "신부가 먼저 양보하세요.",
    },
    {
      translation: "민수는 이기적이에요.",
      resolution: "철수는 먼저 사과해야 해요.",
    },
  ];

  for (const stored of unsafeStoredCards) {
    const normalized = normalizeMediationBlock(stored);
    assert.deepEqual(normalized, {
      renderSafetyFallback: true,
      requesterSummaryOnly: false,
    });
    assert.doesNotMatch(JSON.stringify(normalized), /이기적|더 타당|통제하려고|먼저 사과|먼저 양보/);
  }
});

test("the native card independently replaces unsafe stored wording with a fixed notice", () => {
  for (const required of [
    "hasUnsafeStoredMediationRenderContent(block)",
    "MEDIATION_RENDER_SAFETY_FALLBACK",
  ]) {
    assert.equal(cardSource.includes(required), true, `missing native render guard: ${required}`);
  }
  assert.match(MEDIATION_RENDER_SAFETY_FALLBACK, /원문을 표시하지 않았어요/);
});

test("native chat hides every stored mediation AI body until its card is verified", () => {
  const renderMessageStart = chatSource.indexOf("function renderMessage");
  const renderMessageEnd = chatSource.indexOf("const isP =", renderMessageStart);
  assert.ok(renderMessageStart >= 0 && renderMessageEnd > renderMessageStart);
  const renderMessage = chatSource.slice(renderMessageStart, renderMessageEnd);

  assert.match(
    renderMessage,
    /shouldRenderBubble\s*&&\s*mediationBlock\s*===\s*null/,
  );
});

test("native mediation text stays hidden until exact server verification succeeds", () => {
  assert.equal(resolveMediationDisclosureState({
    hasExactRevision: true,
    verificationState: "idle",
  }), "verifying");
  assert.equal(resolveMediationDisclosureState({
    hasExactRevision: true,
    verificationState: "verifying",
  }), "verifying");
  assert.equal(resolveMediationDisclosureState({
    hasExactRevision: true,
    verificationState: "verified",
  }), "verified");
  assert.equal(resolveMediationDisclosureState({
    hasExactRevision: true,
    verificationState: "error",
  }), "withheld");
  assert.equal(resolveMediationDisclosureState({
    hasExactRevision: false,
    verificationState: "verified",
  }), "withheld");
  assert.equal(MEDIATION_DISCLOSURE_VERIFYING_COPY, "조율 초안의 공개 범위를 확인하는 중이에요.");
  assert.match(MEDIATION_DISCLOSURE_WITHHELD_COPY, /내용을 숨겼어요/);

  assert.match(chatSource, /shouldRenderBubble\s*&&\s*mediationBlock\s*===\s*null/);
  assert.match(cardSource, /resolveMediationDisclosureState/);
  assert.match(cardSource, /disclosureState\s*!==\s*"verified"/);
  assert.equal(cardSource.includes("MEDIATION_DISCLOSURE_VERIFYING_COPY"), true);
  assert.equal(cardSource.includes("MEDIATION_DISCLOSURE_WITHHELD_COPY"), true);
});

test("native normalization preserves the exact server proposal revision", () => {
  const { normalizeMediationBlock } = loadAcceptanceClient(async () => ({}));

  assert.deepEqual(normalizeMediationBlock({
    resolution: "  예산 상한선을 같이 확인해 봐요  ",
    proposalVersion: "123E4567-E89B-42D3-A456-426614174000",
    rosterFingerprint: "0123456789abcdef0123456789abcdef",
  }), {
    empathy: undefined,
    translation: undefined,
    data: undefined,
    resolution: "예산 상한선을 같이 확인해 봐요",
    proposalVersion: "123e4567-e89b-42d3-a456-426614174000",
    rosterFingerprint: "0123456789abcdef0123456789abcdef",
    requesterSummaryOnly: false,
  });
});

test("native confirmation fails closed without both exact revision fields", () => {
  const { getExpectedMediationRevision } = loadAcceptanceClient(async () => ({}));
  assert.equal(typeof getExpectedMediationRevision, "function");

  assert.equal(getExpectedMediationRevision({
    resolution: "내용은 계속 표시해요",
    proposalVersion: "123e4567-e89b-42d3-a456-426614174000",
  }), null);
  assert.deepEqual(getExpectedMediationRevision({
    resolution: "내용은 계속 표시해요",
    proposalVersion: "123e4567-e89b-42d3-a456-426614174000",
    rosterFingerprint: "0123456789abcdef0123456789abcdef",
    requesterSummaryOnly: true,
  }), {
    expectedProposalVersion: "123e4567-e89b-42d3-a456-426614174000",
    expectedRosterFingerprint: "0123456789abcdef0123456789abcdef",
  });
  assert.equal(getExpectedMediationRevision({
    resolution: "출처 계약이 없는 이전 초안",
    proposalVersion: "123e4567-e89b-42d3-a456-426614174000",
    rosterFingerprint: "0123456789abcdef0123456789abcdef",
    requesterSummaryOnly: false,
  }), null);
});

test("accepting a proposal posts its message id and displayed exact revision", async () => {
  const calls = [];
  const apiJson = async (path, options) => {
    calls.push({ path, options });
    return { accepted: true, acceptedCount: 1, requiredCount: 2, completed: false };
  };
  const { acceptMediationResolution } = loadAcceptanceClient(apiJson);
  assert.equal(typeof acceptMediationResolution, "function");
  const messageId = "1474c6f2-29c6-4c77-8d91-d3347eef4c3f";

  const state = await acceptMediationResolution(messageId, EXPECTED_REVISION);

  assert.deepEqual(state, {
    accepted: true,
    acceptedCount: 1,
    requiredCount: 2,
    completed: false,
  });
  assert.deepEqual(calls, [{
    path: "/api/amora/mediation/accept",
    options: {
      method: "POST",
      body: JSON.stringify({ messageId, ...EXPECTED_REVISION }),
    },
  }]);
});

test("withdrawing my incomplete acceptance sends the displayed exact revision", async () => {
  const calls = [];
  const apiJson = async (path, options) => {
    calls.push({ path, options });
    return { accepted: false, acceptedCount: 0, requiredCount: 2, completed: false };
  };
  const { withdrawMediationAcceptance } = loadAcceptanceClient(apiJson);
  assert.equal(typeof withdrawMediationAcceptance, "function");
  const messageId = "1474c6f2-29c6-4c77-8d91-d3347eef4c3f";

  const state = await withdrawMediationAcceptance(messageId, EXPECTED_REVISION);

  assert.deepEqual(state, {
    accepted: false,
    acceptedCount: 0,
    requiredCount: 2,
    completed: false,
  });
  assert.deepEqual(calls, [{
    path: "/api/amora/mediation/accept",
    options: {
      method: "DELETE",
      body: JSON.stringify({ messageId, ...EXPECTED_REVISION }),
    },
  }]);
});

test("missing exact revision blocks acceptance requests before the network", async () => {
  const calls = [];
  const client = loadAcceptanceClient(async (...args) => {
    calls.push(args);
    return {};
  });
  const messageId = "1474c6f2-29c6-4c77-8d91-d3347eef4c3f";

  await assert.rejects(
    () => client.getMediationAcceptance(messageId),
    /표시된 선택안의 정확한 버전을 확인할 수 없습니다/,
  );
  await assert.rejects(
    () => client.acceptMediationResolution(messageId, {
      expectedProposalVersion: EXPECTED_REVISION.expectedProposalVersion,
    }),
    /표시된 선택안의 정확한 버전을 확인할 수 없습니다/,
  );
  assert.deepEqual(calls, []);
});

test("withdrawal is available only for my acceptance before joint completion", () => {
  const { canWithdrawMediationAcceptance } = loadAcceptanceClient(async () => ({}));
  assert.equal(typeof canWithdrawMediationAcceptance, "function");
  assert.equal(canWithdrawMediationAcceptance({
    accepted: true,
    acceptedCount: 1,
    requiredCount: 2,
    completed: false,
  }), true);
  assert.equal(canWithdrawMediationAcceptance({
    accepted: true,
    acceptedCount: 2,
    requiredCount: 2,
    completed: true,
  }), false);
  assert.equal(canWithdrawMediationAcceptance({
    accepted: false,
    acceptedCount: 1,
    requiredCount: 2,
    completed: false,
  }), false);
  assert.equal(canWithdrawMediationAcceptance(null), false);
});

test("a solo account cannot confirm a two-person mediation proposal", () => {
  const { canAcceptMediationResolution } = loadAcceptanceClient(async () => ({}));
  assert.equal(typeof canAcceptMediationResolution, "function");

  assert.equal(canAcceptMediationResolution({
    accepted: false,
    acceptedCount: 0,
    requiredCount: 2,
    completed: false,
    partnerLinked: false,
  }), false);
  assert.equal(canAcceptMediationResolution({
    accepted: false,
    acceptedCount: 0,
    requiredCount: 2,
    completed: false,
    partnerLinked: true,
  }), true);
});

test("a withdrawal response that still marks me accepted fails closed", async () => {
  const { withdrawMediationAcceptance } = loadAcceptanceClient(async () => ({
    accepted: true,
    acceptedCount: 1,
    requiredCount: 2,
    completed: false,
  }));

  await assert.rejects(
    () => withdrawMediationAcceptance(
      "1474c6f2-29c6-4c77-8d91-d3347eef4c3f",
      EXPECTED_REVISION,
    ),
    /확인 취소 응답이 올바르지 않습니다/,
  );
});

test("an inconsistent server response fails closed instead of showing a false joint agreement", async () => {
  const { getMediationAcceptance } = loadAcceptanceClient(async () => ({
    accepted: false,
    acceptedCount: 2,
    requiredCount: 2,
    completed: true,
  }));

  await assert.rejects(
    () => getMediationAcceptance(
      "1474c6f2-29c6-4c77-8d91-d3347eef4c3f",
      EXPECTED_REVISION,
    ),
    /동의 상태 응답이 올바르지 않습니다/,
  );
});

test("the native confirmation surface withholds before verification and distinguishes waiting from joint completion", () => {
  assert.match(cardSource, /getExpectedMediationRevision\(block\)/);
  assert.match(cardSource, /getMediationAcceptance\(messageId, exactRevision\)/);
  assert.match(cardSource, /acceptMediationResolution\(messageId, exactRevision\)/);
  assert.match(cardSource, /withdrawMediationAcceptance\(messageId, exactRevision\)/);
  assert.match(cardSource, /expectedProposalVersion[\s\S]*expectedRosterFingerprint[\s\S]*loadAttempt/s);
  assert.match(cardSource, /resolveMediationDisclosureState/);
  assert.match(cardSource, /disclosureState\s*!==\s*"verified"/);
  assert.match(cardSource, /retryVerification/);
  assert.match(cardSource, /내가 확인했어요/);
  assert.match(cardSource, /상대방의 확인을 기다리고 있어요/);
  assert.match(cardSource, /두 분이 각각 확인해 공동 결정으로 저장했어요/);
  assert.match(cardSource, /이 선택안을 나는 확인했어요/);
  assert.match(cardSource, /accessibilityRole="button"/);
  assert.match(cardSource, /confirmButton:\s*\{[^}]*minHeight:\s*(?:4[4-9]|[5-9]\d)/s);
  assert.match(cardSource, /retryButton:\s*\{[^}]*minHeight:\s*(?:4[4-9]|[5-9]\d)/s);
});

test("the native mediation card describes an AI draft rather than a settled agreement", () => {
  for (const copy of [
    "요청자 요약 기반 조율 초안",
    "요청자가 전한 감정",
    "요청자가 전한 상황",
    "상대방에게 확인할 점",
    "같이 검토할 선택안",
    "파트너가 연결된 뒤 두 분이 각각 확인할 수 있어요",
    "두 분 모두 확인해야 공동 결정으로 저장돼요",
  ]) {
    assert.equal(cardSource.includes(copy), true, `missing non-final copy: ${copy}`);
  }
  assert.doesNotMatch(cardSource, /제안 합의안|이 제안을 합의로 남길까요|공동 합의로 기록/);
});

test("the native card never claims Amora heard both partners", () => {
  // 카드에 담긴 말은 요청한 사람이 쓴 요약뿐이다. 상대의 메시지는 서버가 모델에
  // 보내지도 않는다. 그런데도 "두 분의 대화를 정리했다"고 쓰면, 그 카드를 읽는
  // 상대는 아모라가 양쪽 말을 듣고 저쪽 편을 들었다고 이해한다.
  // 웹 카드는 같은 금지선을 MediationCardContract.test.ts에 걸어 두었는데
  // 앱에는 없어서, 정작 주 제품인 앱만 잘못된 문구를 계속 내보내고 있었다.
  for (const forbidden of ["두 사람이 말한 내용", "두 분의 대화"]) {
    assert.equal(
      cardSource.includes(forbidden),
      false,
      `native mediation card must not claim it heard both partners: ${forbidden}`,
    );
  }

  // 출처·현재 roster를 서버가 확인하지 못하면 legacy 본문을 참고용으로도 보여주지 않는다.
  assert.match(cardSource, /MEDIATION_DISCLOSURE_WITHHELD_COPY/);
  assert.doesNotMatch(cardSource, /내용은 참고만 하고/);
});

test("the mediation block keeps the provenance marker the copy depends on", () => {
  const { normalizeMediationBlock } = loadAcceptanceClient(async () => ({}));

  const requesterSummary = normalizeMediationBlock({
    empathy: "감정",
    translation: "상황",
    data: "확인할 점",
    resolution: "선택안",
    origin: "user_requested",
    evidenceScope: "requester_summary_only",
    schemaVersion: 2,
  });
  assert.equal(requesterSummary.requesterSummaryOnly, true);

  // 표식이 하나라도 어긋나면 출처를 알 수 없는 것으로 본다.
  const legacy = normalizeMediationBlock({
    empathy: "감정",
    translation: "상황",
    origin: "user_requested",
    evidenceScope: "requester_summary_only",
    schemaVersion: 1,
  });
  assert.equal(legacy.requesterSummaryOnly, false);

  // 표식만 있고 본문이 없으면 카드가 되지 않는다.
  assert.equal(normalizeMediationBlock({
    origin: "user_requested",
    evidenceScope: "requester_summary_only",
    schemaVersion: 2,
  }), null);
});

test("a person waiting on their partner can refresh the joint acceptance state", () => {
  assert.match(cardSource, /상대방 확인 상태 새로고침/);
  assert.match(cardSource, /setLoadAttempt\(\(attempt\) => attempt \+ 1\)/);
});

test("the native card offers a 48px withdrawal action only through the incomplete-acceptance guard", () => {
  assert.match(cardSource, /canWithdrawMediationAcceptance\(acceptance\)/);
  assert.match(cardSource, /withdrawMediationAcceptance\(messageId, exactRevision\)/);
  assert.match(cardSource, /내 확인 취소/);
  assert.match(cardSource, /accessibilityLabel="내 확인 취소"/);
  assert.match(cardSource, /withdrawButton:\s*\{[^}]*minHeight:\s*(?:4[8-9]|[5-9]\d)/s);
});

test("a failed withdrawal withholds stale content and exposes an explicit 48px verification retry", () => {
  const withdrawalStart = cardSource.indexOf("async function withdrawAcceptance");
  const renderStart = cardSource.indexOf("if (renderSafetyFallback)", withdrawalStart);
  assert.ok(withdrawalStart >= 0 && renderStart > withdrawalStart);
  const withdrawal = cardSource.slice(withdrawalStart, renderStart);
  assert.match(withdrawal, /catch[\s\S]*setAcceptance\(null\)[\s\S]*setLoadState\("error"\)/);
  assert.doesNotMatch(cardSource, /기존 확인 상태는 그대로 유지했어요/);
  assert.match(cardSource, /accessibilityLabel="조율 초안 공개 범위 다시 확인"/);
  assert.match(cardSource, /onPress=\{retryVerification\}/);
  assert.match(cardSource, /retryButton:\s*\{[^}]*minHeight:\s*(?:4[8-9]|[5-9]\d)/s);
});
