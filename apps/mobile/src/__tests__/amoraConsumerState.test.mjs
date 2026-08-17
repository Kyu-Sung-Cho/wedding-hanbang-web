import assert from "node:assert/strict";
import test from "node:test";

import { composeAmoraConsumerState } from "@hanbang/shared/amora-consumer-state";

function input(overrides = {}) {
  return {
    version: 1,
    safety: "clear",
    identity: "current",
    scope: "verified",
    read: "loaded",
    hasVerifiedSnapshot: true,
    applicability: "applicable",
    approval: "none",
    lifecycle: "ready",
    provenance: [],
    money: "none",
    vendorConfirmation: "not_applicable",
    ...overrides,
  };
}

test("partial evidence stays primary over an approved blocked action", () => {
  const state = composeAmoraConsumerState(input({
    read: "partial",
    approval: "approved",
    lifecycle: "blocked",
    provenance: ["couple_confirmed"],
    money: "planned",
  }));

  assert.deepEqual(state, {
    version: 1,
    primaryState: "partial",
    headline: "일부 기록 확인 필요",
    tone: "warning",
    primaryAction: {
      kind: "retry_read",
      label: "기록 다시 확인",
      requiresWrite: false,
    },
    showVerifiedContent: true,
    retainDraft: true,
    allowRecommendation: false,
    allowMutation: false,
    allowSuccess: false,
    supporting: {
      approvalLabel: "승인됨",
      lifecycleLabel: "막힘",
      provenanceLabels: ["두 사람 확인"],
      moneyLabel: "계획 금액",
      boundaryLabels: [],
    },
  });
});

test("a W5 safety state suppresses ordinary content, actions, evidence, and money", () => {
  assert.deepEqual(composeAmoraConsumerState(input({
    safety: "w5",
    read: "partial",
    approval: "approved",
    lifecycle: "completed",
    provenance: ["couple_confirmed", "vendor_confirmed"],
    money: "payment_evidence",
    vendorConfirmation: "confirmed",
  })), {
    version: 1,
    primaryState: "safety_hold",
    headline: "안전을 먼저 확인해요",
    tone: "danger",
    primaryAction: {
      kind: "open_safety_support",
      label: "안전 도움 보기",
      requiresWrite: false,
    },
    showVerifiedContent: false,
    retainDraft: true,
    allowRecommendation: false,
    allowMutation: false,
    allowSuccess: false,
    supporting: {
      approvalLabel: null,
      lifecycleLabel: null,
      provenanceLabels: [],
      moneyLabel: null,
      boundaryLabels: [],
    },
  });
});

test("an identity change discards every prior projection before showing a new scope", () => {
  assert.deepEqual(composeAmoraConsumerState(input({
    identity: "changed",
    approval: "receipt",
    lifecycle: "completed",
    provenance: ["couple_confirmed", "vendor_confirmed"],
    money: "payment_evidence",
    vendorConfirmation: "confirmed",
  })), {
    version: 1,
    primaryState: "identity_changed",
    headline: "새 준비 공간을 확인하고 있어요",
    tone: "neutral",
    primaryAction: {
      kind: "load_current_identity",
      label: "현재 준비 다시 불러오기",
      requiresWrite: false,
    },
    showVerifiedContent: false,
    retainDraft: false,
    allowRecommendation: false,
    allowMutation: false,
    allowSuccess: false,
    supporting: {
      approvalLabel: null,
      lifecycleLabel: null,
      provenanceLabels: [],
      moneyLabel: null,
      boundaryLabels: [],
    },
  });
});

test("an unverified scope fails closed without revealing prior state", () => {
  const state = composeAmoraConsumerState(input({
    scope: "invalid",
    approval: "receipt",
    lifecycle: "completed",
  }));

  assert.equal(state.primaryState, "scope_unavailable");
  assert.equal(state.headline, "현재 준비 범위를 확인하지 못했어요");
  assert.deepEqual(state.primaryAction, {
    kind: "retry_scope",
    label: "준비 범위 다시 확인",
    requiresWrite: false,
  });
  assert.equal(state.showVerifiedContent, false);
  assert.equal(state.retainDraft, false);
  assert.equal(state.allowSuccess, false);
  assert.deepEqual(state.supporting, {
    approvalLabel: null,
    lifecycleLabel: null,
    provenanceLabels: [],
    moneyLabel: null,
    boundaryLabels: [],
  });
});

test("read freshness states expose one truthful recovery before lower action state", () => {
  const cases = [
    ["loading", "loading", "새로 확인 중", null, true],
    ["empty", "empty", "아직 확인된 기록이 없어요", "start_empty_state", false],
    ["unavailable", "unavailable", "기록을 확인하지 못했어요", "retry_read", true],
    ["stale", "stale", "바뀐 내용을 다시 확인해요", "recalculate", true],
    ["conflict", "conflict", "서로 다른 기록을 확인해요", "review_conflict", true],
    ["timeout", "timeout", "현재 반영 상태를 확인해 주세요", "check_canonical_state", true],
  ];

  for (const [read, primaryState, headline, actionKind, showVerifiedContent] of cases) {
    const state = composeAmoraConsumerState(input({
      read,
      approval: "approved",
      lifecycle: "in_progress",
    }));
    assert.equal(state.primaryState, primaryState, read);
    assert.equal(state.headline, headline, read);
    assert.equal(state.primaryAction?.kind ?? null, actionKind, read);
    assert.equal(state.showVerifiedContent, showVerifiedContent, read);
    assert.equal(state.allowRecommendation, false, read);
    assert.equal(state.allowMutation, false, read);
    assert.equal(state.allowSuccess, false, read);
  }
});

test("applicability is decided before approval and action lifecycle", () => {
  const excluded = composeAmoraConsumerState(input({
    applicability: "not_applicable",
    approval: "none",
    lifecycle: "in_progress",
  }));
  assert.equal(excluded.primaryState, "not_applicable");
  assert.equal(excluded.headline, "하지 않기로 한 준비예요");
  assert.deepEqual(excluded.primaryAction, {
    kind: "reinclude_topic",
    label: "다시 준비에 포함",
    requiresWrite: true,
  });
  assert.equal(excluded.allowRecommendation, false);
  assert.equal(excluded.allowMutation, true);

  const unknown = composeAmoraConsumerState(input({
    applicability: "unknown",
    approval: "proposal",
    lifecycle: "ready",
  }));
  assert.equal(unknown.primaryState, "applicability_unknown");
  assert.equal(unknown.headline, "이 준비가 필요한지 먼저 확인해요");
  assert.equal(unknown.primaryAction.kind, "review_applicability");
  assert.equal(unknown.allowMutation, false);
});

test("approval and write certainty select one safe action before lifecycle", () => {
  const cases = [
    ["proposal", "proposal", "제안을 확인해 주세요", "review_proposal", false],
    ["review", "review_required", "다시 확인이 필요해요", "review_changes", false],
    ["approved", "approved", "반영할 준비가 됐어요", "apply_approved_change", true],
    ["write_error", "write_error", "반영 여부를 확인해 주세요", "check_canonical_state", false],
  ];

  for (const [approval, primaryState, headline, actionKind, allowMutation] of cases) {
    const state = composeAmoraConsumerState(input({
      approval,
      lifecycle: "quiet",
    }));
    assert.equal(state.primaryState, primaryState, approval);
    assert.equal(state.headline, headline, approval);
    assert.equal(state.primaryAction.kind, actionKind, approval);
    assert.equal(state.primaryAction.requiresWrite, allowMutation, approval);
    assert.equal(state.allowMutation, allowMutation, approval);
    assert.equal(state.allowRecommendation, false, approval);
    assert.equal(state.allowSuccess, false, approval);
  }
});

test("action lifecycle never promotes an unreceipted completion to success", () => {
  const cases = [
    ["ready", "ready", "지금 한 가지를 시작해요", "start_action", true],
    ["in_progress", "in_progress", "준비를 이어가요", "resume_action", true],
    ["blocked", "blocked", "막힌 이유부터 풀어요", "recover_block", false],
    ["changed", "changed", "바뀐 내용만 다시 확인해요", "preview_changes", false],
    ["quiet", "quiet", "지금 급한 준비는 없어요", "view_preparation_map", false],
  ];

  for (const [lifecycle, primaryState, headline, actionKind, allowRecommendation] of cases) {
    const state = composeAmoraConsumerState(input({ lifecycle }));
    assert.equal(state.primaryState, primaryState, lifecycle);
    assert.equal(state.headline, headline, lifecycle);
    assert.equal(state.primaryAction.kind, actionKind, lifecycle);
    assert.equal(state.allowRecommendation, allowRecommendation, lifecycle);
    assert.equal(state.allowMutation, false, lifecycle);
    assert.equal(state.allowSuccess, false, lifecycle);
  }

  const unverified = composeAmoraConsumerState(input({ lifecycle: "completed" }));
  assert.equal(unverified.primaryState, "completion_unverified");
  assert.equal(unverified.headline, "완료 여부를 확인해 주세요");
  assert.equal(unverified.primaryAction.kind, "check_canonical_state");
  assert.equal(unverified.allowSuccess, false);

  const completed = composeAmoraConsumerState(input({
    approval: "receipt",
    lifecycle: "completed",
  }));
  assert.equal(completed.primaryState, "completed");
  assert.equal(completed.headline, "완료가 정본에 반영됐어요");
  assert.equal(completed.primaryAction.kind, "view_receipt");
  assert.equal(completed.allowSuccess, true);
});

test("evidence and money stay supporting facts and keep user-reported completion boundaries", () => {
  const completed = composeAmoraConsumerState(input({
    approval: "receipt",
    lifecycle: "completed",
    provenance: ["user_reported", "vendor_unconfirmed"],
    money: "unpaid",
    vendorConfirmation: "unconfirmed",
  }));
  assert.equal(completed.primaryState, "completed");
  assert.equal(completed.headline, "사용자가 완료로 기록했어요");
  assert.equal(completed.allowSuccess, true);
  assert.deepEqual(completed.supporting, {
    approvalLabel: "정본 영수증 확인",
    lifecycleLabel: "완료 기록",
    provenanceLabels: ["사용자가 완료로 기록", "업체 미확인"],
    moneyLabel: "결제 증빙 없음",
    boundaryLabels: ["업체 확인 아님", "결제 증빙 아님"],
  });

  const moneyOnly = composeAmoraConsumerState(input({
    lifecycle: "ready",
    money: "payment_evidence",
  }));
  assert.equal(moneyOnly.primaryState, "ready");
  assert.equal(moneyOnly.supporting.moneyLabel, "결제 증빙");
  assert.equal(moneyOnly.allowSuccess, false);
});

test("malformed or contradictory state axes fail closed and valid output is deeply frozen", () => {
  assert.equal(composeAmoraConsumerState(input({ unexpected: true })), null);
  assert.equal(composeAmoraConsumerState(input({ read: "maybe" })), null);
  assert.equal(composeAmoraConsumerState(input({
    provenance: ["user_input", "user_input"],
  })), null);
  assert.equal(composeAmoraConsumerState(input({
    provenance: [],
    vendorConfirmation: "confirmed",
  })), null);
  assert.equal(composeAmoraConsumerState(input({
    provenance: ["vendor_confirmed"],
    vendorConfirmation: "unconfirmed",
  })), null);

  const valid = composeAmoraConsumerState(input({
    approval: "receipt",
    lifecycle: "completed",
    provenance: ["vendor_confirmed"],
    vendorConfirmation: "confirmed",
  }));
  assert.equal(Object.isFrozen(valid), true);
  assert.equal(Object.isFrozen(valid.primaryAction), true);
  assert.equal(Object.isFrozen(valid.supporting), true);
  assert.equal(Object.isFrozen(valid.supporting.provenanceLabels), true);
  assert.equal(Object.isFrozen(valid.supporting.boundaryLabels), true);
});

test("a lower write uncertainty cannot turn not-applicable recovery into a new write", () => {
  const state = composeAmoraConsumerState(input({
    applicability: "not_applicable",
    approval: "write_error",
    lifecycle: "changed",
  }));

  assert.equal(state.primaryState, "not_applicable");
  assert.equal(state.headline, "하지 않기로 한 준비예요");
  assert.deepEqual(state.primaryAction, {
    kind: "check_canonical_state",
    label: "현재 상태 확인",
    requiresWrite: false,
  });
  assert.equal(state.allowMutation, false);
  assert.equal(state.supporting.approvalLabel, "반영 여부 불명");
});

test("a pending approval cannot be bypassed by the not-applicable reinclude action", () => {
  const state = composeAmoraConsumerState(input({
    applicability: "not_applicable",
    approval: "proposal",
    lifecycle: "quiet",
  }));

  assert.equal(state.primaryState, "not_applicable");
  assert.deepEqual(state.primaryAction, {
    kind: "review_proposal",
    label: "제안 확인",
    requiresWrite: false,
  });
  assert.equal(state.allowMutation, false);
  assert.equal(state.supporting.approvalLabel, "제안 확인 전");
});

test("the complete independent-axis matrix has one result and never widens success or writes", () => {
  const safetyValues = ["clear", "w5"];
  const identityValues = ["current", "changed", "unknown"];
  const scopeValues = ["verified", "invalid"];
  const readValues = ["loaded", "loading", "empty", "partial", "unavailable", "stale", "conflict", "timeout"];
  const applicabilityValues = ["unknown", "applicable", "not_applicable"];
  const approvalValues = ["none", "proposal", "review", "approved", "write_error", "receipt"];
  const lifecycleValues = ["ready", "in_progress", "blocked", "changed", "completed", "quiet"];
  let combinations = 0;

  for (const safety of safetyValues) {
    for (const identity of identityValues) {
      for (const scope of scopeValues) {
        for (const read of readValues) {
          for (const applicability of applicabilityValues) {
            for (const approval of approvalValues) {
              for (const lifecycle of lifecycleValues) {
                combinations += 1;
                const state = composeAmoraConsumerState(input({
                  safety,
                  identity,
                  scope,
                  read,
                  applicability,
                  approval,
                  lifecycle,
                }));
                assert.ok(state, JSON.stringify({
                  safety,
                  identity,
                  scope,
                  read,
                  applicability,
                  approval,
                  lifecycle,
                }));

                const baseIsWritable = safety === "clear"
                  && identity === "current"
                  && scope === "verified"
                  && read === "loaded";
                const shouldAllowMutation = baseIsWritable && (
                  (applicability === "applicable" && approval === "approved")
                  || (
                    applicability === "not_applicable"
                    && (approval === "none" || approval === "receipt")
                  )
                );
                const shouldAllowSuccess = baseIsWritable
                  && applicability === "applicable"
                  && approval === "receipt"
                  && lifecycle === "completed";
                assert.equal(state.allowMutation, shouldAllowMutation);
                assert.equal(state.allowSuccess, shouldAllowSuccess);
                if (state.allowMutation) {
                  assert.equal(state.primaryAction?.requiresWrite, true);
                }
                if (state.allowSuccess) {
                  assert.equal(state.primaryState, "completed");
                }
              }
            }
          }
        }
      }
    }
  }

  assert.equal(combinations, 10_368);
});
