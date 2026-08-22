import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

const helperPath = fileURLToPath(new URL("../lib/pendingAmoraAction.ts", import.meta.url));
const sharedSchedulePath = fileURLToPath(new URL(
  "../../../../packages/shared/src/contracts/sharedSchedule.ts",
  import.meta.url,
));
const budgetImpactPath = fileURLToPath(new URL(
  "../../../../packages/shared/src/contracts/budgetImpactPreview.ts",
  import.meta.url,
));
const actionApprovalPath = fileURLToPath(new URL(
  "../../../../packages/shared/src/contracts/amoraActionApproval.ts",
  import.meta.url,
));

function compileCommonJs(source, resolveDependency = () => {
  throw new Error("unexpected dependency");
}) {
  const result = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const module = { exports: {} };
  new Function("exports", "module", "require", result.outputText)(
    module.exports,
    module,
    resolveDependency,
  );
  return module.exports;
}

const sharedScheduleModule = compileCommonJs(
  readFileSync(sharedSchedulePath, "utf8"),
);
const sharedModule = {
  ...sharedScheduleModule,
  ...compileCommonJs(readFileSync(budgetImpactPath, "utf8")),
  ...compileCommonJs(
    readFileSync(actionApprovalPath, "utf8"),
    (specifier) => {
      if (specifier === "./sharedSchedule") return sharedScheduleModule;
      throw new Error(`unexpected dependency: ${specifier}`);
    },
  ),
};
const helperSource = readFileSync(helperPath, "utf8");
const compiled = ts.transpileModule(helperSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
});
const helperModule = { exports: {} };
new Function("exports", "module", "require", compiled.outputText)(
  helperModule.exports,
  helperModule,
  (specifier) => {
    if (specifier === "@hanbang/shared") return sharedModule;
    throw new Error(`unexpected dependency: ${specifier}`);
  },
);
const {
  getAmoraActionApprovalPolicy,
  getAmoraPendingActionTtlMs,
  getPendingAmoraAction,
  getPendingAmoraBudgetImpactPreview,
  getPendingActionDisabledReason,
  isPendingAmoraActionExpired,
  getSharedActionApprovalPresentation,
  parseSharedActionApprovalStatus,
} = helperModule.exports;

const chatPath = fileURLToPath(new URL("../../app/(tabs)/chat.tsx", import.meta.url));
const chatSource = readFileSync(chatPath, "utf8");

const action = {
  version: 2,
  actionId: "33333333-3333-4333-8333-333333333333",
  tool: "add_schedule_event",
  input: {
    date: "2026-08-01",
    title: "드레스 피팅",
    schedule_scope: "confirmed_fact",
  },
  inputDigest: "a".repeat(64),
  operationKey: "b".repeat(64),
  confirmation: "드레스 피팅 일정을 추가할까요?",
  issuedAt: Date.parse("2026-07-17T00:00:00.000Z"),
  expiresAt: Date.parse("2026-07-17T00:10:00.000Z"),
};

test("mobile uses the exact input-aware approval policy", () => {
  assert.equal(
    getAmoraActionApprovalPolicy("add_schedule_event", {
      schedule_scope: "confirmed_fact",
    }),
    "single",
  );
  assert.equal(getAmoraActionApprovalPolicy("add_schedule_event", {}), "couple");
  assert.equal(
    getAmoraActionApprovalPolicy("add_schedule_event", {
      schedule_scope: "shared_commitment",
    }),
    "couple",
  );
  assert.equal(getAmoraActionApprovalPolicy("update_schedule_event", {}), "couple");
  assert.equal(getAmoraActionApprovalPolicy("update_category_budget", {}), "single");
  assert.equal(
    getAmoraActionApprovalPolicy("update_category_budget", { budget: 30_000_000 }),
    "couple",
  );
  assert.equal(getAmoraActionApprovalPolicy("add_custom_category", {}), "single");
  assert.equal(
    getAmoraActionApprovalPolicy("add_custom_category", { budget: 3_000_000 }),
    "couple",
  );
  assert.equal(getAmoraActionApprovalPolicy("update_budget", {}), "couple");
  assert.equal(getAmoraActionApprovalPolicy("unknown_tool", {}), "blocked");
});

test("mobile binds 10-minute and 24-hour TTLs to the exact policy", () => {
  assert.equal(
    getAmoraPendingActionTtlMs("add_schedule_event", {
      schedule_scope: "confirmed_fact",
    }),
    10 * 60 * 1_000,
  );
  assert.equal(
    getAmoraPendingActionTtlMs("add_schedule_event", {}),
    24 * 60 * 60 * 1_000,
  );
  assert.equal(
    getAmoraPendingActionTtlMs("update_schedule_event", {}),
    24 * 60 * 60 * 1_000,
  );

  const ambiguousSchedule = {
    ...action,
    input: { date: "2026-08-02", title: "상담" },
    expiresAt: action.issuedAt + 24 * 60 * 60 * 1_000,
  };
  assert.deepEqual(getPendingAmoraAction(message({
    metadata: { pending_amora_action: ambiguousSchedule },
  })), ambiguousSchedule);
  assert.equal(getPendingAmoraAction(message({
    metadata: {
      pending_amora_action: {
        ...ambiguousSchedule,
        expiresAt: action.issuedAt + 10 * 60 * 1_000,
      },
    },
  })), null);
});

test("mobile presents every couple approval state truthfully", () => {
  const zero = parseSharedActionApprovalStatus({
    approvalMode: "couple",
    accepted: false,
    acceptedCount: 0,
    requiredCount: 2,
    partnerLinked: true,
    ready: false,
  });
  assert.equal(
    getSharedActionApprovalPresentation(zero).copy,
    "두 분이 각각 확인해야 반영돼요 · 현재 0/2",
  );

  const mine = parseSharedActionApprovalStatus({
    approvalMode: "couple",
    accepted: true,
    acceptedCount: 1,
    requiredCount: 2,
    partnerLinked: true,
    ready: false,
  });
  assert.deepEqual(
    getSharedActionApprovalPresentation(mine),
    {
      copy: "내 확인 1/2 · 아직 반영되지 않았어요. 적용 요청 전까지 취소할 수 있어요.",
      applyLabel: "상대방 확인 기다리는 중",
      waitingForPartner: true,
      canWithdraw: true,
    },
  );

  const partner = parseSharedActionApprovalStatus({
    approvalMode: "couple",
    accepted: false,
    acceptedCount: 1,
    requiredCount: 2,
    partnerLinked: true,
    ready: false,
  });
  assert.equal(
    getSharedActionApprovalPresentation(partner).copy,
    "상대방 확인 1/2 · 내 확인을 누르면 바로 반영을 시작해요.",
  );
  assert.equal(
    getSharedActionApprovalPresentation(partner).applyLabel,
    "확인하고 바로 반영",
  );

  const ready = parseSharedActionApprovalStatus({
    approvalMode: "couple",
    accepted: true,
    acceptedCount: 2,
    requiredCount: 2,
    partnerLinked: true,
    ready: true,
  });
  assert.equal(
    getSharedActionApprovalPresentation(ready).copy,
    "두 분 확인 완료 · 반영하기를 누르면 바로 적용 요청이 시작돼요.",
  );
  assert.equal(
    getSharedActionApprovalPresentation(ready).applyLabel,
    "두 분 확인 완료 · 반영하기",
  );

  const unlinked = parseSharedActionApprovalStatus({
    approvalMode: "couple",
    accepted: false,
    acceptedCount: 0,
    requiredCount: 1,
    partnerLinked: false,
    ready: false,
  });
  assert.equal(
    getSharedActionApprovalPresentation(unlinked).copy,
    "파트너 연결 전이라 내 확인으로 반영돼요.",
  );
  assert.equal(
    getSharedActionApprovalPresentation(unlinked).applyLabel,
    "확인하고 반영",
  );
  assert.equal(parseSharedActionApprovalStatus({
    approvalMode: "couple",
    accepted: true,
    acceptedCount: 2,
    requiredCount: 2,
    partnerLinked: true,
    ready: false,
  }), null);
  assert.equal(parseSharedActionApprovalStatus({
    approvalMode: "couple",
    accepted: false,
    acceptedCount: 0,
    requiredCount: 1,
    partnerLinked: true,
    ready: false,
  }), null);
});

test("mobile fails closed unless the budget preview matches action digest and journey revision", () => {
  const budgetAction = {
    ...action,
    tool: "update_budget",
    input: { budget: 50_000_000 },
    expiresAt: action.issuedAt + 24 * 60 * 60 * 1_000,
  };
  const preview = {
    version: 1,
    kind: "budget_change",
    tool: "update_budget",
    inputDigest: budgetAction.inputDigest,
    sourceRevision: 7,
    recordedSpendBasis: "explicit_spent_only",
    current: {
      totalBudget: 40_000_000,
      allocatedBudget: 30_000_000,
      recordedSpend: 5_000_000,
      unallocatedBudget: 10_000_000,
    },
    proposed: {
      totalBudget: 50_000_000,
      allocatedBudget: 30_000_000,
      recordedSpend: 5_000_000,
      unallocatedBudget: 20_000_000,
    },
    delta: {
      totalBudget: 10_000_000,
      allocatedBudget: 0,
      recordedSpend: 0,
      unallocatedBudget: 10_000_000,
    },
    categories: [],
    warnings: [],
  };
  const budgetMessage = message({
    metadata: {
      pending_amora_action: budgetAction,
      pending_amora_action_journey_revision: 7,
      pending_amora_action_impact_preview: preview,
    },
  });

  assert.deepEqual(
    getPendingAmoraBudgetImpactPreview(budgetMessage, budgetAction),
    preview,
  );
  assert.equal(getPendingAmoraBudgetImpactPreview({
    ...budgetMessage,
    metadata: {
      ...budgetMessage.metadata,
      pending_amora_action_journey_revision: 8,
    },
  }, budgetAction), null);
  assert.equal(getPendingAmoraBudgetImpactPreview({
    ...budgetMessage,
    metadata: {
      ...budgetMessage.metadata,
      pending_amora_action_impact_preview: {
        ...preview,
        inputDigest: "c".repeat(64),
      },
    },
  }, budgetAction), null);
  assert.equal(getPendingAmoraBudgetImpactPreview(
    budgetMessage,
    {
      ...budgetAction,
      actionId: "44444444-4444-4444-8444-444444444444",
    },
  ), null);
});

function message(overrides = {}) {
  return {
    sender_type: "ai",
    visibility: "shared",
    metadata: { pending_amora_action: action },
    ...overrides,
  };
}

test("mobile accepts pending actions only from structurally valid shared AI metadata", () => {
  assert.deepEqual(getPendingAmoraAction(message()), action);
  assert.equal(getPendingAmoraAction(message({ visibility: "bride_private" })), null);
  assert.equal(getPendingAmoraAction(message({ sender_type: "bride" })), null);
  assert.equal(getPendingAmoraAction(message({
    metadata: { pending_amora_action: { ...action, actionId: "not-a-uuid" } },
  })), null);
  assert.equal(getPendingAmoraAction(message({
    metadata: { pending_amora_action: { ...action, input: [] } },
  })), null);
  assert.equal(getPendingAmoraAction(message({
    metadata: { pending_amora_action: { ...action, issuedAt: "2026-07-17T00:00:00.000Z" } },
  })), null);
  assert.equal(getPendingAmoraAction(message({
    metadata: { pending_amora_action: { ...action, expiresAt: action.expiresAt + 1 } },
  })), null);
  assert.equal(getPendingAmoraAction(message({
    metadata: { pending_amora_action: { ...action, inputDigest: "wrong" } },
  })), null);
  assert.equal(getPendingAmoraAction(message({
    metadata: { pending_amora_action: { ...action, operationKey: "wrong" } },
  })), null);
  const blocked = getPendingAmoraAction(message({
    metadata: {
      pending_amora_action: { ...action, tool: "update_amora_action" },
    },
  }));
  assert.equal(blocked?.tool, "update_amora_action");
  assert.equal(
    getAmoraActionApprovalPolicy(blocked?.tool ?? "", blocked?.input),
    "blocked",
  );
});

test("mobile disables expired, superseded, and in-flight actions", () => {
  const beforeExpiry = action.expiresAt - 1;
  assert.equal(getPendingActionDisabledReason(action, beforeExpiry, true, false), null);
  assert.equal(getPendingActionDisabledReason(action, action.expiresAt, true, false), "expired");
  assert.equal(getPendingActionDisabledReason(action, beforeExpiry, false, false), "not_latest");
  assert.equal(getPendingActionDisabledReason(action, beforeExpiry, true, true), "busy");
});

// 휴대폰은 시계가 어긋나 있는 일이 흔하다. 그때 방금 받은 제안이 만료로 보이면
// 그 사람은 아모라가 제안한 어떤 변경도 확인할 수 없다. 진짜 만료는 서버가 막는다.
test("mobile does not call a fresh proposal expired when the phone clock lags the server", () => {
  const laggingClock = action.issuedAt - 1_500;
  assert.ok(laggingClock < action.expiresAt);
  assert.equal(isPendingAmoraActionExpired(action, laggingClock), false);
  assert.equal(getPendingActionDisabledReason(action, laggingClock, true, false), null);
});

test("mobile does not call a proposal expired before the clock has been read", () => {
  assert.equal(isPendingAmoraActionExpired(action, 0), false);
  assert.equal(isPendingAmoraActionExpired(action, Number.NaN), false);
  assert.equal(getPendingActionDisabledReason(action, 0, true, false), null);
});

test("mobile still expires once the clock is usable and the server instant has passed", () => {
  assert.equal(isPendingAmoraActionExpired(action, action.expiresAt), true);
  assert.equal(isPendingAmoraActionExpired(action, action.expiresAt + 60_000), true);
  assert.equal(getPendingActionDisabledReason(action, action.expiresAt, true, false), "expired");
});

test("mobile confirmation button sends and retries the exact server action id", () => {
  assert.match(chatSource, /confirmedActionId\?: string/);
  assert.match(chatSource, /confirmedActionId: draft\.confirmedActionId/);
  assert.match(chatSource, /async function handleApplyPendingAction\(actionId: string\)/);
  assert.match(chatSource, /const content = "좋아요\. 제안한 변경을 적용해 주세요\."/);
  assert.match(chatSource, /text: content/);
  assert.match(chatSource, /confirmedActionId: actionId/);
  assert.match(chatSource, /await streamAiRequest\(failure\.request\)/);
});

test("mobile obtains the single application lease before sending a confirmation", () => {
  const handlerStart = chatSource.indexOf(
    "async function handleApplyPendingAction(actionId: string)",
  );
  const handlerEnd = chatSource.indexOf(
    "function handleScopeChange",
    handlerStart,
  );
  const handler = chatSource.slice(handlerStart, handlerEnd);

  assert.match(
    chatSource,
    // P0-2 이후 이 요청은 누른 사람에 결박된다. lease를 얻는다는 원래 의도에
    // 더해 결박까지 함께 고정한다.
    /requestAmoraSharedAction\(actionId, messageId, "PUT", expectedUserId\)/,
  );
  assert.match(chatSource, /Authorization: `Bearer \$\{accessToken\}`/);
  assert.match(
    handler,
    /await requestAmoraApplicationClaim\(\s*actionId,\s*latestSharedMessage\.id,\s*sessionUserIdRef\.current,\s*\)/,
  );
  assert.ok(
    handler.indexOf("await requestAmoraApplicationClaim(")
      < handler.indexOf("await sendAiDraft("),
  );
  assert.match(handler, /if \(!claim\.applicationGranted\)/);
  assert.match(
    chatSource,
    /confirmed_amora_action_id: draft\.confirmedActionId[\s\S]*client_request_id: draft\.clientRequestId/,
  );
});

test("mobile retry reconciles a durable confirmation before reacquiring its lease", () => {
  const senderStart = chatSource.indexOf(
    "async function sendAiDraft(draft: AiDraft, reconcileFirst: boolean)",
  );
  const senderEnd = chatSource.indexOf(
    "async function handleRetry()",
    senderStart,
  );
  const sender = chatSource.slice(senderStart, senderEnd);

  assert.match(chatSource, /amoraSourceMessageId\?: string/);
  assert.match(
    sender,
    /let durableMessage = reconcileFirst\s*\?\s*await findDurableUserMessage\(draft, "ai"\)/,
  );
  assert.match(
    sender,
    /await requestAmoraApplicationClaim\(\s*draft\.confirmedActionId,\s*draft\.amoraSourceMessageId,\s*sessionUserIdRef\.current,\s*\)/,
  );
  assert.ok(
    sender.indexOf('findDurableUserMessage(draft, "ai")')
      < sender.indexOf("requestAmoraApplicationClaim("),
  );
  assert.match(
    chatSource,
    /amoraSourceMessageId: latestSharedMessage\.id/,
  );
  assert.match(
    chatSource,
    /draft\.confirmedActionId[\s\S]*confirmed_amora_action_id: draft\.confirmedActionId[\s\S]*client_request_id: draft\.clientRequestId/,
  );
  assert.doesNotMatch(chatSource, /draft\.startedAt/);
});

test("mobile restores an owned durable confirmation and ignores direct partner chat for freshness", () => {
  assert.match(
    chatSource,
    /\.order\("created_at", \{ ascending: false \}\)\s*\.order\("id", \{ ascending: false \}\)\s*\.limit\(200\)/,
  );
  assert.match(
    chatSource,
    /\.or\("metadata->>target\.is\.null,metadata->>target\.neq\.partner"\)\s*\.order\("created_at", \{ ascending: false \}\)\s*\.order\("id", \{ ascending: false \}\)\s*\.limit\(1\)\s*\.maybeSingle\(\)/,
  );
  assert.match(chatSource, /const historyMessages = boundedHistory\s*\.sort\(/);
  assert.match(
    chatSource,
    /const durableConfirmation = canonicalShared\[canonicalShared\.length - 1\]/,
  );
  assert.match(
    chatSource,
    /message\.visibility === "shared"\s*&& message\.metadata\?\.target !== "partner"/,
  );
  assert.match(
    chatSource,
    /message: "확인은 안전하게 저장됐어요\. 반영을 이어서 완료해 주세요\."/,
  );
  assert.match(chatSource, /"반영 계속하기"/);
});

test("mobile exposes explicit 44-point apply and dismiss controls", () => {
  assert.match(chatSource, /: "확인한 내용을 이대로 적용"/);
  assert.match(chatSource, /accessibilityLabel=\{applyAccessibilityLabel\}/);
  assert.match(chatSource, /accessibilityLabel="지금은 적용하지 않기"/);
  assert.match(chatSource, /pendingActionButton: \{[^}]*minHeight: 44/);
  assert.match(chatSource, /pendingActionDismiss: \{[^}]*minHeight: 44/);
});

test("mobile uses Bearer-authenticated GET, POST, DELETE, and PUT shared-action flows", () => {
  assert.match(
    chatSource,
    /type AmoraSharedActionMethod = "GET" \| "POST" \| "DELETE" \| "PUT"/,
  );
  assert.match(
    chatSource,
    /Authorization: `Bearer \$\{accessToken\}`/,
  );
  assert.match(chatSource, /requestAmoraSharedActionStatus\(/);
  assert.match(chatSource, /requestAmoraSharedActionApproval\([^)]*"POST"/s);
  assert.match(chatSource, /requestAmoraSharedActionApproval\([^)]*"DELETE"/s);
  assert.match(chatSource, /requestAmoraApplicationClaim\(/);
  assert.match(chatSource, /async function handleWithdrawPendingAction\(actionId: string\)/);
});

test("mobile renders truthful couple progress and bound budget impact copy", () => {
  assert.match(chatSource, /getAmoraActionApprovalPolicy\(pendingAction\.tool, pendingAction\.input\)/);
  assert.match(chatSource, /getSharedActionApprovalPresentation\(/);
  assert.match(chatSource, /두 분 확인이 필요한 변경이에요/);
  assert.match(chatSource, /내 공동 변경 확인 취소/);
  assert.match(chatSource, /getPendingAmoraBudgetImpactPreview\(item, pendingAction\)/);
  assert.match(chatSource, /총예산/);
  assert.match(chatSource, /배분 합계/);
  assert.match(chatSource, /기록 지출/);
  assert.match(
    chatSource,
    /기록 지출은 사용자가 명시적으로 입력한 금액이며, 결제 증거나 결제 완료를 뜻하지 않아요\./,
  );
});
