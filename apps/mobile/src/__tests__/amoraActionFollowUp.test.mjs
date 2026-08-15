import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildActionFollowUpPrivateRescueDraft,
  buildActionFollowUpRequestPaths,
  buildActionFollowUpOutcomeBody,
  getActionFollowUpBlockerPresentation,
  getActionFollowUpOutcomePresentation,
  isCurrentActionFollowUpContext,
  isReceiptForActionFollowUpRequest,
  isActionFollowUpCardAdvanced,
  matchCanonicalActionFollowUpReceipt,
  resolveActionFollowUpWhyNow,
  resolveActionFollowUpV2Surface,
  shouldRetainActionFollowUpReceipt,
} from "../lib/amoraActionFollowUp.mjs";
import {
  buildFirstUseSharedActionDraft,
  selectPrivateActionDraftForBridge,
} from "../lib/amoraEntryPlan.mjs";
import { createFollowUpLifecycleCoordinator } from "../lib/followUpLifecycleCoordinator.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

test("an exact home action binds card claim and outcome recording to one explicit mode", () => {
  assert.deepEqual(buildActionFollowUpRequestPaths("act_first_step"), {
    mode: "explicit_action",
    cardPath: "/api/amora/today-one/v2?actionId=act_first_step",
    outcomePath: "/api/amora/today-one/v2/outcomes?mode=explicit_action",
  });
  assert.deepEqual(buildActionFollowUpRequestPaths(null), {
    mode: "scheduled_follow_up",
    cardPath: "/api/amora/today-one/v2",
    outcomePath: "/api/amora/today-one/v2/outcomes",
  });
  assert.equal(buildActionFollowUpRequestPaths(""), null);
  assert.equal(buildActionFollowUpRequestPaths("act/other"), null);
  assert.equal(buildActionFollowUpRequestPaths("a".repeat(201)), null);
});

test("an exact home action keeps its grounded selection reason only for the same revision", () => {
  const card = {
    title: "양가 가능한 상견례 날짜 두 개 고르기",
    sourceRevision: 4,
    whyNow: "아모라와 정한 준비 한 가지를 확인해 주세요.",
  };
  const expected = {
    id: "act_family_dates",
    title: card.title,
    sourceRevision: 4,
    selectionReason: "오늘까지로 저장한 일이어서 먼저 보여드려요.",
  };

  assert.equal(
    resolveActionFollowUpWhyNow(card, "act_family_dates", expected),
    expected.selectionReason,
  );
  assert.equal(
    resolveActionFollowUpWhyNow(card, "act_other", expected),
    card.whyNow,
  );
  assert.equal(
    resolveActionFollowUpWhyNow({ ...card, sourceRevision: 5 }, "act_family_dates", expected),
    card.whyNow,
  );
  assert.equal(
    resolveActionFollowUpWhyNow({ ...card, title: "바뀐 행동" }, "act_family_dates", expected),
    card.whyNow,
  );
});

test("action follow-up presents the four plain-language outcomes without changing data", () => {
  assert.deepEqual(getActionFollowUpOutcomePresentation("completed"), {
    label: "끝냈어요",
    requiresConfirmation: true,
  });
  assert.deepEqual(getActionFollowUpOutcomePresentation("blocked"), {
    label: "막혔어요",
    requiresConfirmation: false,
  });
  assert.deepEqual(getActionFollowUpOutcomePresentation("changed"), {
    label: "내용이 바뀌었어요",
    requiresConfirmation: true,
  });
  assert.deepEqual(getActionFollowUpOutcomePresentation("not_sure"), {
    label: "아직 모르겠어요",
    requiresConfirmation: false,
  });
  assert.equal(getActionFollowUpOutcomePresentation("unknown"), null);
});

test("explicit outcomes choose one bounded private help draft without inferring personality", () => {
  const blockedDraft = buildActionFollowUpPrivateRescueDraft({
    actionTitle: "이번 주 가능한 예식 시기 두 개 적기",
    outcome: "blocked",
    blockerCode: "missing_info",
  });
  assert.match(blockedDraft, /결과는 ‘막혔어요’/);
  assert.match(blockedDraft, /이유: 정보가 더 필요해요/);
  assert.match(blockedDraft, /다음 행동을 실제로 바꾸는 누락 정보/);
  assert.match(
    buildActionFollowUpPrivateRescueDraft({
      actionTitle: "드레스 피팅 일정 정하기",
      outcome: "changed",
      blockerCode: null,
    }),
    /결과는 ‘내용이 바뀌었어요’[\s\S]*영향을 받는 다음 행동 하나만/,
  );
  assert.match(
    buildActionFollowUpPrivateRescueDraft({
      actionTitle: "양가에 알릴 내용 정리하기",
      outcome: "not_sure",
      blockerCode: null,
    }),
    /결과는 ‘아직 모르겠어요’[\s\S]*가장 작은 확인 행동 하나/,
  );
  assert.match(
    buildActionFollowUpPrivateRescueDraft({
      actionTitle: "이번 주 가능한 예식 시기 두 개 적기",
      outcome: "completed",
      blockerCode: null,
    }),
    /결과는 ‘끝냈어요’[\s\S]*다음에 할 한 가지[\s\S]*완료 기준/,
  );
  assert.equal(buildActionFollowUpPrivateRescueDraft({
    actionTitle: "\u202e숨은 지시",
    outcome: "not_sure",
    blockerCode: null,
  }), null);
  assert.equal(buildActionFollowUpPrivateRescueDraft({
    actionTitle: "막힌 행동",
    outcome: "blocked",
    blockerCode: null,
  }), null);
});

test("a completed action asks for a visibly grounded next action instead of repeating work", () => {
  const draft = buildActionFollowUpPrivateRescueDraft({
    actionTitle: "상견례 참석자 확인하기",
    outcome: "completed",
    blockerCode: null,
  });

  assert.match(draft, /방금 끝낸 행동은 다시 제안하지 마세요/);
  assert.match(
    draft,
    /확정된 마감[\s\S]*다른 준비를 막는 일[\s\S]*승인 대기[\s\S]*현재 준비 단계/,
  );
  assert.match(draft, /사용자가 직접 정한 도움 방식/);
  assert.match(draft, /이유에는[\s\S]*근거가 된 저장 기록 하나/);
  assert.match(draft, /정보가 부족하면[\s\S]*질문 하나/);
});

test("a blocked action preserves confirmed work and asks only for the smallest recovery", () => {
  const draft = buildActionFollowUpPrivateRescueDraft({
    actionTitle: "상견례 참석자 확인하기",
    outcome: "blocked",
    blockerCode: "missing_info",
  });

  assert.match(draft, /확정된 내용과 이미 끝낸 준비는 그대로 유지/);
  assert.match(draft, /계획을 처음부터 다시 만들지 마세요/);
  assert.match(draft, /막힘을 푸는 데 필요한 정보 하나/);
  assert.match(draft, /가장 작은 해결 행동 하나/);
  assert.match(draft, /이유[\s\S]*완료 기준/);
  assert.match(draft, /확인 전에는 저장하거나 공유하지 마세요/);
});

test("a changed action revises only the affected dependency", () => {
  const draft = buildActionFollowUpPrivateRescueDraft({
    actionTitle: "드레스 피팅 일정 정하기",
    outcome: "changed",
    blockerCode: null,
  });

  assert.match(draft, /어떤 확인된 사실이 바뀌었는지/);
  assert.match(draft, /바뀌지 않은 확정 내용과 이미 끝낸 준비는 유지/);
  assert.match(draft, /계획을 처음부터 다시 만들지 마세요/);
  assert.match(draft, /영향을 받는 다음 행동 하나만/);
  assert.match(draft, /이유[\s\S]*완료 기준/);
  assert.match(draft, /확인 전에는 저장하거나 공유하지 마세요/);
});

test("an uncertain action asks for one observable status without deciding for the user", () => {
  const draft = buildActionFollowUpPrivateRescueDraft({
    actionTitle: "양가에 알릴 내용 정리하기",
    outcome: "not_sure",
    blockerCode: null,
  });

  assert.match(draft, /완료나 실패로 대신 판단하지 마세요/);
  assert.match(draft, /현재 기록에서 직접 확인할 수 있는 사실 하나/);
  assert.match(draft, /부족하면 질문 하나/);
  assert.match(draft, /가장 작은 확인 행동 하나/);
  assert.match(draft, /완료 기준/);
  assert.match(draft, /확인 전에는 저장하거나 공유하지 마세요/);
});

test("a private recovery opens as one natural request with a reviewable action card contract", () => {
  for (const [outcome, blockerCode] of [
    ["completed", null],
    ["blocked", "missing_info"],
    ["changed", null],
    ["not_sure", null],
  ]) {
    const draft = buildActionFollowUpPrivateRescueDraft({
      actionTitle: "상견례 참석자 확인하기",
      outcome,
      blockerCode,
    });

    assert.doesNotMatch(draft, /<행동_결과>|<\/행동_결과>|지시문/);
    assert.match(draft, /내가 저장해 둔 행동은 ‘상견례 참석자 확인하기’/);
    assert.match(
      draft,
      /‘확인된 내용’[\s\S]*‘아직 모르는 내용’[\s\S]*‘지금 할 한 가지’[\s\S]*‘이유’[\s\S]*‘완료 기준’/,
    );
    assert.match(draft, /확인 전에는 저장하거나 공유하지 마/);
  }
});

test("a reviewed recovery card crosses to shared planning without copying private context", () => {
  const privateResponse = [
    "확인된 내용",
    "- 모델이 다시 쓴 비공개 설명",
    "아직 모르는 내용",
    "- 모델이 다시 쓴 비공개 질문",
    "지금 할 한 가지: 부모님께 가능한 시간 두 개 묻기",
    "이유: 상견례 일정을 다시 정하려면 가능한 시간을 먼저 확인해야 해요.",
    "완료 기준: 가능한 시간 두 개를 받으면 끝나요.",
  ].join("\n");
  const reviewed = selectPrivateActionDraftForBridge({
    activeScope: "private",
    senderType: "ai",
    isLatestPrivateAiMessage: true,
    isAlreadyPromoted: false,
    content: privateResponse,
    sourceRevision: 12,
    grounding: {
      version: 1,
      sourceRevision: 12,
      confirmed: [{ key: "wedding_date", label: "결혼식 날짜: 2027-05-22" }],
      unknowns: [{ key: "current_progress", label: "상견례 가능 시간" }],
    },
  });

  assert.ok(reviewed);
  const sharedDraft = buildFirstUseSharedActionDraft(reviewed);
  assert.match(sharedDraft, /지금 할 한 가지: 부모님께 가능한 시간 두 개 묻기/);
  assert.match(sharedDraft, /이유: 상견례 일정을 다시 정하려면 가능한 시간을 먼저 확인해야 해요/);
  assert.match(sharedDraft, /완료 기준: 가능한 시간 두 개를 받으면 끝나요/);
  assert.doesNotMatch(sharedDraft, /모델이 다시 쓴 비공개 설명|모델이 다시 쓴 비공개 질문/);
  assert.match(sharedDraft, /저장 전에는 확인 카드만 보여줘/);
});

test("action follow-up rejects callbacks after an account, couple, or session switch", () => {
  const captured = {
    ownerUserId: "10000000-0000-4000-8000-000000000001",
    coupleId: "20000000-0000-4000-8000-000000000001",
    sessionGeneration: 7,
  };

  assert.equal(isCurrentActionFollowUpContext(captured, { ...captured }), true);
  assert.equal(isCurrentActionFollowUpContext(captured, {
    ...captured,
    ownerUserId: "10000000-0000-4000-8000-000000000002",
  }), false);
  assert.equal(isCurrentActionFollowUpContext(captured, {
    ...captured,
    coupleId: "20000000-0000-4000-8000-000000000002",
  }), false);
  assert.equal(isCurrentActionFollowUpContext(captured, {
    ...captured,
    sessionGeneration: 8,
  }), false);
  assert.equal(isCurrentActionFollowUpContext(captured, null), false);
});

test("shared follow-up lifecycle drops every stale POST, receipt, and card-reread boundary", async () => {
  const original = {
    ownerUserId: "10000000-0000-4000-8000-000000000011",
    coupleId: "20000000-0000-4000-8000-000000000011",
  };
  const boundaries = ["before_post", "before_receipt", "before_card_reread"];

  for (const boundary of boundaries) {
    const lifecycle = createFollowUpLifecycleCoordinator();
    lifecycle.updateExpected(original.ownerUserId, original.coupleId);
    lifecycle.adoptAuthenticatedUser(original.ownerUserId);
    const operation = lifecycle.beginOutcome(lifecycle.capture());
    assert.ok(operation);
    const completed = [];

    if (boundary === "before_post") {
      lifecycle.updateExpected(original.ownerUserId, "20000000-0000-4000-8000-000000000012");
    }
    const posted = await lifecycle.runStage(operation, async () => "posted");
    if (posted.status === "current") completed.push(posted.value);

    if (boundary === "before_receipt") {
      lifecycle.updateAuthenticatedUser("10000000-0000-4000-8000-000000000012");
    }
    const receipt = await lifecycle.runStage(operation, async () => "receipt");
    if (receipt.status === "current") completed.push(receipt.value);

    if (boundary === "before_card_reread") {
      lifecycle.updateExpected(original.ownerUserId, "20000000-0000-4000-8000-000000000013");
    }
    const reread = await lifecycle.runStage(operation, async () => "card");
    if (reread.status === "current") completed.push(reread.value);

    const expectedCompleted = boundary === "before_post"
      ? []
      : boundary === "before_receipt"
        ? ["posted"]
        : ["posted", "receipt"];
    assert.deepEqual(completed, expectedCompleted, boundary);
    assert.equal(operation.signal.aborted, true, boundary);
  }
});

test("shared follow-up lifecycle rejects a load result after an owner or couple switch", async () => {
  const original = {
    ownerUserId: "10000000-0000-4000-8000-000000000021",
    coupleId: "20000000-0000-4000-8000-000000000021",
  };
  for (const replacement of [
    { ...original, ownerUserId: "10000000-0000-4000-8000-000000000022" },
    { ...original, coupleId: "20000000-0000-4000-8000-000000000022" },
  ]) {
    const lifecycle = createFollowUpLifecycleCoordinator();
    lifecycle.updateExpected(original.ownerUserId, original.coupleId);
    const load = lifecycle.beginLoad();
    assert.ok(load);
    let release;
    const pending = lifecycle.runStage(load, () => new Promise((resolve) => {
      release = resolve;
    }));

    lifecycle.updateExpected(replacement.ownerUserId, replacement.coupleId);
    release("old-card");

    assert.deepEqual(await pending, { status: "stale" });
    assert.equal(load.signal.aborted, true);
  }
});

test("shared follow-up lifecycle aborts an in-flight outcome on focus cleanup or unmount", async () => {
  const lifecycle = createFollowUpLifecycleCoordinator();
  lifecycle.updateExpected(
    "10000000-0000-4000-8000-000000000031",
    "20000000-0000-4000-8000-000000000031",
  );
  const outcome = lifecycle.beginOutcome(lifecycle.capture());
  assert.ok(outcome);
  let release;
  const pending = lifecycle.runStage(outcome, () => new Promise((resolve) => {
    release = resolve;
  }));

  lifecycle.cancelAll();
  release("late-receipt");

  assert.equal(outcome.signal.aborted, true);
  assert.equal(lifecycle.hasOutcomeInFlight(), false);
  assert.deepEqual(await pending, { status: "stale" });
});

test("blocked follow-up accepts only bounded private blocker choices", () => {
  assert.deepEqual(getActionFollowUpBlockerPresentation("time"), {
    label: "시간이 더 필요해요",
  });
  assert.deepEqual(getActionFollowUpBlockerPresentation("partner_check"), {
    label: "둘이 먼저 확인해야 해요",
  });
  assert.deepEqual(getActionFollowUpBlockerPresentation("missing_info"), {
    label: "정보가 더 필요해요",
  });
  assert.deepEqual(getActionFollowUpBlockerPresentation("other"), {
    label: "다른 이유가 있어요",
  });
  assert.equal(getActionFollowUpBlockerPresentation("free text"), null);

  const title = "상견례 참석자 확인하기";
  assert.match(buildActionFollowUpPrivateRescueDraft({
    actionTitle: title,
    outcome: "blocked",
    blockerCode: "time",
  }), /마감이나 가능한 시간을 추정하지 말고[\s\S]*범위를 줄이거나 날짜를 다시 잡는 선택 중 하나/);
  assert.match(buildActionFollowUpPrivateRescueDraft({
    actionTitle: title,
    outcome: "blocked",
    blockerCode: "partner_check",
  }), /상대방의 생각을 추정하지 말고[\s\S]*중립적인 질문 하나나 보낼 문장 초안 하나/);
  assert.match(buildActionFollowUpPrivateRescueDraft({
    actionTitle: title,
    outcome: "blocked",
    blockerCode: "missing_info",
  }), /다음 행동을 실제로 바꾸는 누락 정보[\s\S]*필요한 정보 하나/);
  assert.match(buildActionFollowUpPrivateRescueDraft({
    actionTitle: title,
    outcome: "blocked",
    blockerCode: "other",
  }), /막힌 이유를 추정하지 말고 질문 하나로만 확인/);
});

test("outcome mutation binds the exact card revisions and an idempotency key", () => {
  const card = {
    id: "30000000-0000-4000-8000-000000000001",
    revision: 4,
    sourceRevision: 9,
    outcomeIdempotencyKey: "40000000-0000-4000-8000-000000000001",
  };

  assert.deepEqual(
    buildActionFollowUpOutcomeBody(card, "completed", null, true),
    {
      cardId: card.id,
      cardRevision: 4,
      sourceRevision: 9,
      outcome: "completed",
      confirmed: true,
      idempotencyKey: card.outcomeIdempotencyKey,
    },
  );
  assert.deepEqual(
    buildActionFollowUpOutcomeBody(card, "blocked", "time", false),
    {
      cardId: card.id,
      cardRevision: 4,
      sourceRevision: 9,
      outcome: "blocked",
      blockerCode: "time",
      idempotencyKey: card.outcomeIdempotencyKey,
    },
  );
  assert.equal(
    buildActionFollowUpOutcomeBody(card, "blocked", null, false),
    null,
  );
  assert.equal(
    buildActionFollowUpOutcomeBody(card, "completed", null, false),
    null,
  );
  assert.equal(
    buildActionFollowUpOutcomeBody(
      { ...card, outcomeIdempotencyKey: "retry-me" },
      "completed",
      null,
      true,
    ),
    null,
  );
  assert.equal(
    buildActionFollowUpOutcomeBody(
      { ...card, sourceRevision: 0 },
      "completed",
      null,
      true,
    ),
    null,
  );
});

test("a success receipt is shown only after the canonical reread matches exactly", () => {
  const receipt = {
    id: "50000000-0000-4000-8000-000000000001",
    cardId: "30000000-0000-4000-8000-000000000001",
    cardRevision: 4,
    outcome: "completed",
    actionStatus: "done",
    actionRevision: 10,
    recordedAt: "2026-08-12T12:00:00.000Z",
    idempotencyKey: "40000000-0000-4000-8000-000000000001",
  };

  assert.deepEqual(matchCanonicalActionFollowUpReceipt(receipt, { ...receipt }), receipt);
  assert.equal(matchCanonicalActionFollowUpReceipt(receipt, {
    ...receipt,
    actionRevision: 11,
  }), null);
  assert.equal(matchCanonicalActionFollowUpReceipt(receipt, {
    ...receipt,
    idempotencyKey: "40000000-0000-4000-8000-000000000002",
  }), null);
  assert.equal(matchCanonicalActionFollowUpReceipt(receipt, {
    ...receipt,
    outcome: "changed",
  }), null);
});

test("a canonical receipt must belong to the exact outcome request", () => {
  const request = {
    cardId: "30000000-0000-4000-8000-000000000001",
    cardRevision: 4,
    sourceRevision: 9,
    outcome: "blocked",
    blockerCode: "time",
    idempotencyKey: "40000000-0000-4000-8000-000000000001",
  };
  const receipt = {
    id: "50000000-0000-4000-8000-000000000001",
    cardId: request.cardId,
    cardRevision: request.cardRevision,
    outcome: request.outcome,
    actionStatus: "open",
    actionRevision: 10,
    blockerCode: request.blockerCode,
    recordedAt: "2026-08-12T12:00:00.000Z",
    idempotencyKey: request.idempotencyKey,
  };

  assert.equal(isReceiptForActionFollowUpRequest(receipt, request), true);
  assert.equal(isReceiptForActionFollowUpRequest({ ...receipt, cardRevision: 5 }, request), false);
  assert.equal(isReceiptForActionFollowUpRequest({ ...receipt, blockerCode: "other" }, request), false);
  assert.equal(isReceiptForActionFollowUpRequest({ ...receipt, outcome: "completed" }, request), false);
});

test("post-outcome refetch must retire the exact card and source before success", () => {
  const previous = {
    id: "30000000-0000-4000-8000-000000000001",
    sourceDigest: "a".repeat(64),
  };
  assert.equal(isActionFollowUpCardAdvanced(previous, { state: "none" }), true);
  assert.equal(isActionFollowUpCardAdvanced(previous, { state: "daily_limit" }), true);
  assert.equal(isActionFollowUpCardAdvanced(previous, {
    state: "ready",
    card: { ...previous },
  }), false);
  assert.equal(isActionFollowUpCardAdvanced(previous, {
    state: "ready",
    card: {
      id: "30000000-0000-4000-8000-000000000002",
      sourceDigest: previous.sourceDigest,
    },
  }), false);
  assert.equal(isActionFollowUpCardAdvanced(previous, {
    state: "ready",
    card: {
      id: previous.id,
      sourceDigest: "b".repeat(64),
    },
  }), false);
  assert.equal(isActionFollowUpCardAdvanced(previous, {
    state: "ready",
    card: {
      id: "30000000-0000-4000-8000-000000000002",
      sourceDigest: "b".repeat(64),
    },
  }), true);
});

test("the action follow-up card exposes four outcomes with bounded private blocker reasons", async () => {
  const source = await readFile(
    resolve(HERE, "../components/dashboard/AmoraActionFollowUpCard.tsx"),
    "utf8",
  );

  for (const label of ["끝냈어요", "막혔어요", "내용이 바뀌었어요", "아직 모르겠어요"]) {
    assert.match(source, new RegExp(label));
  }
  assert.match(source, /막힌 이유는 나에게만 보여요/);
  assert.doesNotMatch(source, /TextInput/);
  assert.match(source, /requiresConfirmation/);
  assert.match(source, /확인 후에만/);
  assert.match(source, /아모라와 해결 방법 정리하기/);
  assert.match(source, /바뀐 내용 정리하기/);
  assert.match(source, /먼저 확인할 것 찾기/);
  assert.match(source, /다음 한 가지 정하기/);
  assert.match(
    source,
    /receipt\.outcome === "completed"[\s\S]*receipt\.outcome === "blocked"[\s\S]*receipt\.outcome === "changed"[\s\S]*receipt\.outcome === "not_sure"/,
  );
  assert.match(source, /onPrivateRescue/);
  assert.doesNotMatch(source, /변경됨으로 닫|기존 행동을 닫/);
  assert.match(source, /기존 행동은 그대로 열어둬요/);
});

test("only a confirmed blocked receipt offers an explicit private personalization step", async () => {
  const [cardSource, controllerSource] = await Promise.all([
    readFile(
      resolve(HERE, "../components/dashboard/AmoraActionFollowUpCard.tsx"),
      "utf8",
    ),
    readFile(
      resolve(HERE, "../components/dashboard/AmoraActionFollowUpV2.tsx"),
      "utf8",
    ),
  ]);

  assert.match(cardSource, /onPersonalizeAfterBlocked\?: \(\) => void/);
  assert.match(
    cardSource,
    /receipt\.outcome === "blocked"\s*&& onPersonalizeAfterBlocked/,
  );
  assert.match(cardSource, /다음부터 도와주는 순서 맞추기/);
  assert.match(cardSource, /선택하기 전에는 도움 방식을 바꾸지 않아요/);

  assert.match(controllerSource, /<AmoraPersonalizationSheet/);
  assert.match(controllerSource, /setPersonalizationEntryPoint\("blocked_action"\)/);
  assert.match(controllerSource, /entryPoint=\{personalizationEntryPoint \?\? "general"\}/);
  assert.match(controllerSource, /expectedOwnerUserId=\{current\.ownerUserId\}/);
  assert.match(
    controllerSource,
    /view\.kind === "receipt"\s*&& view\.receipt\.outcome === "blocked"\s*\? openBlockedPersonalization/,
  );
  assert.match(
    controllerSource,
    /function openBlockedPersonalization\(\) \{\s*if \(view\.kind !== "receipt" \|\| view\.receipt\.outcome !== "blocked"\) return;/,
  );
});

test("only a confirmed uncertain receipt offers an explicit decision-start personalization step", async () => {
  const [cardSource, controllerSource] = await Promise.all([
    readFile(
      resolve(HERE, "../components/dashboard/AmoraActionFollowUpCard.tsx"),
      "utf8",
    ),
    readFile(
      resolve(HERE, "../components/dashboard/AmoraActionFollowUpV2.tsx"),
      "utf8",
    ),
  ]);

  assert.match(cardSource, /onPersonalizeAfterUncertain\?: \(\) => void/);
  assert.match(
    cardSource,
    /receipt\.outcome === "not_sure"\s*&& onPersonalizeAfterUncertain/,
  );
  assert.match(cardSource, /결정 시작 방식 맞추기/);
  assert.match(cardSource, /선택하기 전에는 도움 방식을 바꾸지 않아요/);

  assert.match(
    controllerSource,
    /view\.kind === "receipt"\s*&& view\.receipt\.outcome === "not_sure"\s*\? openUncertainPersonalization/,
  );
  assert.match(
    controllerSource,
    /function openUncertainPersonalization\(\) \{\s*if \(view\.kind !== "receipt" \|\| view\.receipt\.outcome !== "not_sure"\) return;/,
  );
  assert.match(controllerSource, /setPersonalizationEntryPoint\("uncertain_action"\)/);
  assert.match(controllerSource, /entryPoint=\{personalizationEntryPoint \?\? "general"\}/);
});

test("only a confirmed changed receipt offers an explicit impact-detail personalization step", async () => {
  const [cardSource, controllerSource] = await Promise.all([
    readFile(
      resolve(HERE, "../components/dashboard/AmoraActionFollowUpCard.tsx"),
      "utf8",
    ),
    readFile(
      resolve(HERE, "../components/dashboard/AmoraActionFollowUpV2.tsx"),
      "utf8",
    ),
  ]);

  assert.match(cardSource, /onPersonalizeAfterChanged\?: \(\) => void/);
  assert.match(
    cardSource,
    /receipt\.outcome === "changed"\s*&& onPersonalizeAfterChanged/,
  );
  assert.match(cardSource, /변경 영향 보기 방식 맞추기/);
  assert.match(cardSource, /선택하기 전에는 도움 방식을 바꾸지 않아요/);

  assert.match(
    controllerSource,
    /view\.kind === "receipt"\s*&& view\.receipt\.outcome === "changed"\s*\? openChangedPersonalization/,
  );
  assert.match(
    controllerSource,
    /function openChangedPersonalization\(\) \{\s*if \(view\.kind !== "receipt" \|\| view\.receipt\.outcome !== "changed"\) return;/,
  );
  assert.match(controllerSource, /setPersonalizationEntryPoint\("changed_action"\)/);
});

test("only a confirmed completed receipt offers an explicit collaboration personalization step", async () => {
  const [cardSource, controllerSource] = await Promise.all([
    readFile(
      resolve(HERE, "../components/dashboard/AmoraActionFollowUpCard.tsx"),
      "utf8",
    ),
    readFile(
      resolve(HERE, "../components/dashboard/AmoraActionFollowUpV2.tsx"),
      "utf8",
    ),
  ]);

  assert.match(cardSource, /onPersonalizeAfterCompleted\?: \(\) => void/);
  assert.match(
    cardSource,
    /receipt\.outcome === "completed"\s*&& onPersonalizeAfterCompleted/,
  );
  assert.match(cardSource, /협업 방식 맞추기/);
  assert.match(cardSource, /선택하기 전에는 도움 방식을 바꾸지 않아요/);

  assert.match(
    controllerSource,
    /view\.kind === "receipt"\s*&& view\.receipt\.outcome === "completed"\s*\? openCompletedPersonalization/,
  );
  assert.match(
    controllerSource,
    /function openCompletedPersonalization\(\) \{\s*if \(view\.kind !== "receipt" \|\| view\.receipt\.outcome !== "completed"\) return;/,
  );
  assert.match(controllerSource, /setPersonalizationEntryPoint\("completed_action"\)/);
});

test("v2 keeps the grounded fallback when no optional follow-up can be shown", () => {
  assert.equal(resolveActionFollowUpV2Surface(404, null), "fallback");
  assert.equal(resolveActionFollowUpV2Surface(200, "none"), "fallback");
  assert.equal(resolveActionFollowUpV2Surface(200, "ready"), "ready");
  assert.equal(resolveActionFollowUpV2Surface(200, "disabled"), "fallback");
  assert.equal(resolveActionFollowUpV2Surface(200, "paused"), "fallback");
  assert.equal(resolveActionFollowUpV2Surface(200, "daily_limit"), "fallback");
  assert.equal(resolveActionFollowUpV2Surface(503, null), "error");
  assert.equal(resolveActionFollowUpV2Surface(200, null), "error");
});

test("the v2 controller re-reads a canonical receipt before success and fences private rescue", async () => {
  const source = await readFile(
    resolve(HERE, "../components/dashboard/AmoraActionFollowUpV2.tsx"),
    "utf8",
  );

  assert.match(source, /validateTodayOneCareV2Response/);
  assert.match(source, /validateTodayOneCareV2OutcomeRequest/);
  assert.match(source, /validateTodayOneCareV2OutcomeResponse/);
  assert.match(source, /apiFetchForExpectedUser/);
  assert.match(source, /\/api\/amora\/today-one\/v2/);
  assert.match(source, /\/api\/amora\/today-one\/v2\/outcomes/);
  assert.match(source, /idempotencyKey=\$\{encodeURIComponent/);
  assert.match(source, /matchCanonicalActionFollowUpReceipt/);
  assert.match(source, /isActionFollowUpCardAdvanced\(card, refreshedValidation\.value\)/);
  assert.match(source, /isCurrentActionFollowUpContext/);
  assert.match(source, /createFollowUpLifecycleCoordinator/);
  assert.match(source, /lifecycle\.beginOutcome\(captured\)/);
  assert.match(source, /lifecycle\.runStage/);
  assert.match(source, /stagePrivateChatHandoff/);
  assert.match(source, /buildActionFollowUpPrivateRescueDraft/);
  assert.match(source, /ownerUserId:\s*current\.ownerUserId/);
  assert.match(source, /coupleId:\s*current\.coupleId/);
  assert.match(source, /function openPrivateRescue\(\) \{\s*if \(view\.kind !== "receipt"\) return;/);
  assert.match(source, /onPrivateRescue=\{view\.kind === "receipt" \? openPrivateRescue : undefined\}/);
  assert.match(source, /if \(!handoff\) \{\s*router\.push\("\/\(tabs\)\/chat"\);\s*return;/);
  assert.match(source, /onReceiptPinned/);
  assert.match(source, /onReceiptAcknowledged/);
  assert.match(source, /loadingFallback\?: ReactNode/);
  assert.match(source, /verifiedFallbackContext/);
  assert.match(source, /verifyFreshContext/);
  assert.match(source, /isCurrentActionFollowUpContext\(verifiedFallbackContext, current\)/);
  assert.match(source, /view\.kind === "loading"[\s\S]{0,160}loadingFallback/);
  assert.match(source, /view\.kind === "fallback"[\s\S]{0,160}fallback/);
  assert.match(source, /preferredActionId\?: string \| null/);
  assert.match(source, /buildActionFollowUpRequestPaths/);
  assert.match(source, /const requestedActionId = preferredActionId/);
  assert.match(source, /requestedActionId,/);
  assert.match(source, /requestPaths\.cardPath/);
  assert.match(source, /view\.requestPaths\.outcomePath/);
});

test("a verified v2 error keeps the grounded action visible with retry", async () => {
  const source = await readFile(
    resolve(HERE, "../components/dashboard/AmoraActionFollowUpV2.tsx"),
    "utf8",
  );

  const errorBranchStart = source.indexOf('if (view.kind === "error")');
  const readyBranchStart = source.indexOf("<AmoraActionFollowUpCard", errorBranchStart);
  assert.ok(errorBranchStart > 0 && readyBranchStart > errorBranchStart);
  const errorBranch = source.slice(errorBranchStart, readyBranchStart);

  assert.match(errorBranch, /verifiedFallbackIsCurrent\s*\?\s*fallback\s*:\s*null/);
  assert.match(errorBranch, /행동 후속 확인을 다시 불러와 주세요/);
  assert.match(errorBranch, /다시 불러오기/);
});

test("every fresh owner verification failure purges the prior owner's surface", async () => {
  const source = await readFile(
    resolve(HERE, "../components/dashboard/AmoraActionFollowUpV2.tsx"),
    "utf8",
  );

  const verificationStart = source.indexOf("const verifyFreshContext");
  const loadStart = source.indexOf("const load = useCallback", verificationStart);
  assert.ok(verificationStart > 0 && loadStart > verificationStart);
  const verificationBody = source.slice(verificationStart, loadStart);
  assert.match(
    verificationBody,
    /verified\.value !== operation\.context\.ownerUserId[\s\S]*setVerifiedFallbackContext\(null\)[\s\S]*setView\(\{ kind: "hidden" \}\)/,
  );

  const freshChecks = source.match(
    /await verifyFreshContext\(operation\)/g,
  ) ?? [];
  assert.ok(
    freshChecks.length >= 5,
    "initial load, card response, POST, receipt reread, and card reread must all reverify",
  );
  assert.match(source.slice(loadStart), /lifecycle\.runStage\(/);
});

test("dashboard composes generic loading, v1 fallback, and acknowledged home refresh", async () => {
  const source = await readFile(
    resolve(HERE, "../../app/(tabs)/dashboard.tsx"),
    "utf8",
  );

  assert.match(source, /<AmoraActionFollowUpV2/);
  assert.match(source, /loadingFallback=\{companionFallback\}/);
  assert.match(
    source,
    /focus\.kind !== "action" \|\| !data\.openAction[\s\S]*return mediatedCare/,
  );
  assert.match(source, /<TodayOneCareCard[\s\S]{0,260}fallback=\{companionFallback\}/);
  assert.match(source, /<AmoraMediationOutcomeFollowUp[\s\S]{0,300}fallback=\{todayOneCare\}/);
  assert.match(source, /const renderActionCare = \(actionFallback: ReactNode\)[\s\S]*fallback=\{actionFallback\}/);
  assert.match(source, /expectedOwnerUserId=\{data\.ownerUserId\}/);
  assert.match(source, /expectedCoupleId=\{data\.coupleId\}/);
  assert.match(source, /const openAction = data\.openAction/);
  assert.match(source, /preferredActionId=\{openAction\.id\}/);
  assert.match(source, /preferredActionPresentation=\{[\s\S]{0,240}sourceRevision:/);
  assert.match(source, /sourceRevision:\s*openAction\.sourceRevision/);
  assert.match(source, /selectionReason:\s*focus\.selectionReason/);
  assert.doesNotMatch(source, /preferredActionId=\{data\?\.openAction\?\.id \?\? null\}/);
  assert.match(source, /if \(focus\.claimBeforeCare\) return renderActionCare\(mediatedCare\)/);
  assert.match(source, /fallback=\{ordinaryActionCare\}/);
  assert.match(
    source,
    /onReceiptAcknowledged=\{async \(_receipt, receiptIdentity, leaseToken\) => \{[\s\S]{0,360}releasePinnedActionReceipt\([\s\S]{0,180}leaseToken[\s\S]{0,180}loadData\(\)/,
  );
  assert.doesNotMatch(source, /allowPinnedReceiptCommit/);
  assert.doesNotMatch(source, /onReceiptRecorded/);
});

test("a canonical action receipt stays visible until the user explicitly continues", async () => {
  const [controllerSource, cardSource] = await Promise.all([
    readFile(
      resolve(HERE, "../components/dashboard/AmoraActionFollowUpV2.tsx"),
      "utf8",
    ),
    readFile(
      resolve(HERE, "../components/dashboard/AmoraActionFollowUpCard.tsx"),
      "utf8",
    ),
  ]);

  assert.match(controllerSource, /receiptPinnedContextRef/);
  assert.match(
    controllerSource,
    /if \(shouldRetainActionFollowUpReceipt\([\s\S]{0,260}pinnedReceiptContext[\s\S]{0,180}currentContext[\s\S]{0,180}\)\) \{\s*return/,
  );
  assert.match(
    controllerSource,
    /onReceiptPinned\(captured, receiptLeaseToken\)[\s\S]{0,220}receiptPinnedContextRef\.current = captured;[\s\S]{0,220}setView\(\{[\s\S]{0,80}kind: "receipt"/,
  );
  const submissionLeaseStart = controllerSource.indexOf("onReceiptSubmissionStarted(captured)");
  const outcomeStart = controllerSource.indexOf("lifecycle.beginOutcome(captured)", submissionLeaseStart);
  const failedLeaseRelease = controllerSource.indexOf(
    "if (receiptLeaseToken !== null && !receiptConfirmed)",
    outcomeStart,
  );
  const abortCallback = controllerSource.indexOf(
    "onReceiptSubmissionAborted?.(captured, receiptLeaseToken)",
    failedLeaseRelease,
  );
  assert.ok(submissionLeaseStart > 0 && outcomeStart > submissionLeaseStart);
  assert.ok(failedLeaseRelease > outcomeStart && abortCallback > failedLeaseRelease);
  assert.match(
    controllerSource,
    /async function acknowledgeReceipt\(\)[\s\S]{0,500}receiptPinnedContextRef\.current = null[\s\S]{0,320}onReceiptAcknowledged/,
  );

  const receiptPinStart = controllerSource.indexOf("receiptPinnedContextRef.current = captured");
  const receiptSetStart = controllerSource.indexOf('kind: "receipt"', receiptPinStart);
  const acknowledgementStart = controllerSource.indexOf("async function acknowledgeReceipt");
  assert.ok(receiptPinStart > 0 && receiptSetStart > receiptPinStart && acknowledgementStart > receiptSetStart);
  assert.doesNotMatch(
    controllerSource.slice(receiptSetStart, acknowledgementStart),
    /onReceiptAcknowledged|onReceiptRecorded/,
  );

  assert.match(cardSource, /onAcknowledgeReceipt/);
  assert.match(cardSource, /확인했어요 · 다음 준비 보기/);
  assert.match(cardSource, /receiptContinueButton:\s*\{[^}]*minHeight:\s*44/);
});

test("manual refresh releases only the exact locally pinned receipt generation", async () => {
  const context = {
    ownerUserId: "10000000-0000-4000-8000-000000000001",
    coupleId: "20000000-0000-4000-8000-000000000001",
    sessionGeneration: 3,
  };
  assert.equal(shouldRetainActionFollowUpReceipt(context, context, 4, 4), true);
  assert.equal(shouldRetainActionFollowUpReceipt(context, context, 4, 5), false);
  assert.equal(shouldRetainActionFollowUpReceipt(
    context,
    { ...context, coupleId: "20000000-0000-4000-8000-000000000002" },
    4,
    4,
  ), false);

  const [controllerSource, dashboardSource] = await Promise.all([
    readFile(resolve(HERE, "../components/dashboard/AmoraActionFollowUpV2.tsx"), "utf8"),
    readFile(resolve(HERE, "../../app/(tabs)/dashboard.tsx"), "utf8"),
  ]);
  assert.match(controllerSource, /receiptReleaseVersion = 0/);
  assert.match(controllerSource, /receiptPinnedReleaseVersionRef\.current = receiptReleaseVersion/);
  assert.match(
    controllerSource,
    /shouldRetainActionFollowUpReceipt\([\s\S]{0,220}pinnedReceiptReleaseVersion[\s\S]{0,120}receiptReleaseVersion/,
  );
  assert.match(dashboardSource, /const \[actionReceiptReleaseVersion, setActionReceiptReleaseVersion\]/);
  assert.match(
    dashboardSource,
    /releasePinnedActionReceipt\([\s\S]{0,260}released\.released[\s\S]{0,180}setActionReceiptReleaseVersion/,
  );
  assert.match(dashboardSource, /receiptReleaseVersion=\{actionReceiptReleaseVersion\}/);
});

test("action follow-up secondary controls keep a 44px touch target", async () => {
  const [cardSource, controllerSource] = await Promise.all([
    readFile(
      resolve(HERE, "../components/dashboard/AmoraActionFollowUpCard.tsx"),
      "utf8",
    ),
    readFile(
      resolve(HERE, "../components/dashboard/AmoraActionFollowUpV2.tsx"),
      "utf8",
    ),
  ]);

  assert.match(
    cardSource,
    /cancelButton:\s*\{[^}]*minHeight:\s*44[^}]*justifyContent:\s*"center"/,
  );
  assert.match(
    cardSource,
    /rescueButton:\s*\{[^}]*minHeight:\s*44[^}]*justifyContent:\s*"center"/,
  );
  assert.match(
    controllerSource,
    /retryButton:\s*\{[^}]*minHeight:\s*44[^}]*justifyContent:\s*"center"/,
  );
});

test("the outcome sheet stays reachable on small screens and large text", async () => {
  const source = await readFile(
    resolve(HERE, "../components/dashboard/AmoraActionFollowUpCard.tsx"),
    "utf8",
  );

  assert.match(source, /useWindowDimensions/);
  assert.match(source, /useSafeAreaInsets/);
  assert.match(source, /maxHeight:\s*sheetMaxHeight/);
  assert.match(
    source,
    /<ScrollView[\s\S]*accessibilityViewIsModal[\s\S]*contentContainerStyle=\{styles\.sheetContent\}/,
  );
  assert.match(source, /showsVerticalScrollIndicator/);
  assert.match(
    source,
    /cancelButton:\s*\{[^}]*minHeight:\s*44[^}]*justifyContent:\s*"center"/,
  );
});
