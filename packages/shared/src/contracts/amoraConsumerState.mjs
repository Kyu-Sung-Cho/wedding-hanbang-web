const APPROVAL_LABELS = Object.freeze({
  proposal: "제안 확인 전",
  review: "재검토 필요",
  approved: "승인됨",
  write_error: "반영 여부 불명",
  receipt: "정본 영수증 확인",
});

const LIFECYCLE_LABELS = Object.freeze({
  ready: "시작 전",
  in_progress: "진행 중",
  blocked: "막힘",
  changed: "변경됨",
  completed: "완료 기록",
  quiet: "급한 일 없음",
});

const PROVENANCE_LABELS = Object.freeze({
  user_input: "사용자 입력",
  user_reported: "사용자가 완료로 기록",
  ai_proposal: "아모라 제안",
  couple_confirmed: "두 사람 확인",
  vendor_unconfirmed: "업체 미확인",
  vendor_confirmed: "업체 확인",
  official_reference: "공식 근거",
});

const MONEY_LABELS = Object.freeze({
  planned: "계획 금액",
  quote: "견적",
  contract_entered: "계약으로 입력한 금액",
  payment_recorded: "지급 기록",
  payment_evidence: "결제 증빙",
  unpaid: "결제 증빙 없음",
});

const INPUT_KEYS = Object.freeze([
  "applicability",
  "approval",
  "hasVerifiedSnapshot",
  "identity",
  "lifecycle",
  "money",
  "provenance",
  "read",
  "safety",
  "scope",
  "vendorConfirmation",
  "version",
]);

const ALLOWED_VALUES = Object.freeze({
  safety: new Set(["clear", "w5"]),
  identity: new Set(["current", "changed", "unknown"]),
  scope: new Set(["verified", "invalid"]),
  read: new Set(["loaded", "loading", "empty", "partial", "unavailable", "stale", "conflict", "timeout"]),
  applicability: new Set(["unknown", "applicable", "not_applicable"]),
  approval: new Set(["none", "proposal", "review", "approved", "write_error", "receipt"]),
  lifecycle: new Set(["ready", "in_progress", "blocked", "changed", "completed", "quiet"]),
  provenance: new Set(Object.keys(PROVENANCE_LABELS)),
  money: new Set(["none", ...Object.keys(MONEY_LABELS)]),
  vendorConfirmation: new Set(["not_applicable", "unconfirmed", "confirmed"]),
});

const READ_PRESENTATIONS = Object.freeze({
  loading: Object.freeze({
    headline: "새로 확인 중",
    tone: "neutral",
    action: null,
  }),
  empty: Object.freeze({
    headline: "아직 확인된 기록이 없어요",
    tone: "neutral",
    action: Object.freeze({
      kind: "start_empty_state",
      label: "처음부터 시작",
      requiresWrite: false,
    }),
  }),
  partial: Object.freeze({
    headline: "일부 기록 확인 필요",
    tone: "warning",
    action: Object.freeze({
      kind: "retry_read",
      label: "기록 다시 확인",
      requiresWrite: false,
    }),
  }),
  unavailable: Object.freeze({
    headline: "기록을 확인하지 못했어요",
    tone: "warning",
    action: Object.freeze({
      kind: "retry_read",
      label: "기록 다시 확인",
      requiresWrite: false,
    }),
  }),
  stale: Object.freeze({
    headline: "바뀐 내용을 다시 확인해요",
    tone: "warning",
    action: Object.freeze({
      kind: "recalculate",
      label: "현재 상태 다시 계산",
      requiresWrite: false,
    }),
  }),
  conflict: Object.freeze({
    headline: "서로 다른 기록을 확인해요",
    tone: "warning",
    action: Object.freeze({
      kind: "review_conflict",
      label: "충돌 기록 확인",
      requiresWrite: false,
    }),
  }),
  timeout: Object.freeze({
    headline: "현재 반영 상태를 확인해 주세요",
    tone: "warning",
    action: Object.freeze({
      kind: "check_canonical_state",
      label: "현재 상태 확인",
      requiresWrite: false,
    }),
  }),
});

const APPROVAL_PRESENTATIONS = Object.freeze({
  proposal: Object.freeze({
    primaryState: "proposal",
    headline: "제안을 확인해 주세요",
    tone: "rose",
    action: Object.freeze({
      kind: "review_proposal",
      label: "제안 확인",
      requiresWrite: false,
    }),
    allowMutation: false,
  }),
  review: Object.freeze({
    primaryState: "review_required",
    headline: "다시 확인이 필요해요",
    tone: "warning",
    action: Object.freeze({
      kind: "review_changes",
      label: "바뀐 내용 확인",
      requiresWrite: false,
    }),
    allowMutation: false,
  }),
  approved: Object.freeze({
    primaryState: "approved",
    headline: "반영할 준비가 됐어요",
    tone: "rose",
    action: Object.freeze({
      kind: "apply_approved_change",
      label: "확인한 변경 반영",
      requiresWrite: true,
    }),
    allowMutation: true,
  }),
  write_error: Object.freeze({
    primaryState: "write_error",
    headline: "반영 여부를 확인해 주세요",
    tone: "warning",
    action: Object.freeze({
      kind: "check_canonical_state",
      label: "현재 상태 확인",
      requiresWrite: false,
    }),
    allowMutation: false,
  }),
});

const LIFECYCLE_PRESENTATIONS = Object.freeze({
  ready: Object.freeze({
    headline: "지금 한 가지를 시작해요",
    tone: "rose",
    action: Object.freeze({ kind: "start_action", label: "시작하기", requiresWrite: false }),
    allowRecommendation: true,
  }),
  in_progress: Object.freeze({
    headline: "준비를 이어가요",
    tone: "rose",
    action: Object.freeze({ kind: "resume_action", label: "이어서 준비", requiresWrite: false }),
    allowRecommendation: true,
  }),
  blocked: Object.freeze({
    headline: "막힌 이유부터 풀어요",
    tone: "warning",
    action: Object.freeze({ kind: "recover_block", label: "막힌 이유 풀기", requiresWrite: false }),
    allowRecommendation: false,
  }),
  changed: Object.freeze({
    headline: "바뀐 내용만 다시 확인해요",
    tone: "warning",
    action: Object.freeze({ kind: "preview_changes", label: "변경 내용 확인", requiresWrite: false }),
    allowRecommendation: false,
  }),
  quiet: Object.freeze({
    headline: "지금 급한 준비는 없어요",
    tone: "neutral",
    action: Object.freeze({ kind: "view_preparation_map", label: "전체 준비 보기", requiresWrite: false }),
    allowRecommendation: false,
  }),
});

function emptySupporting() {
  return Object.freeze({
    approvalLabel: null,
    lifecycleLabel: null,
    provenanceLabels: Object.freeze([]),
    moneyLabel: null,
    boundaryLabels: Object.freeze([]),
  });
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, expectedKeys) {
  const keys = Object.keys(value).sort();
  return keys.length === expectedKeys.length
    && keys.every((key, index) => key === expectedKeys[index]);
}

function isValidInput(input) {
  if (
    !isRecord(input)
    || !hasExactKeys(input, INPUT_KEYS)
    || input.version !== 1
    || typeof input.hasVerifiedSnapshot !== "boolean"
    || !ALLOWED_VALUES.safety.has(input.safety)
    || !ALLOWED_VALUES.identity.has(input.identity)
    || !ALLOWED_VALUES.scope.has(input.scope)
    || !ALLOWED_VALUES.read.has(input.read)
    || !ALLOWED_VALUES.applicability.has(input.applicability)
    || !ALLOWED_VALUES.approval.has(input.approval)
    || !ALLOWED_VALUES.lifecycle.has(input.lifecycle)
    || !ALLOWED_VALUES.money.has(input.money)
    || !ALLOWED_VALUES.vendorConfirmation.has(input.vendorConfirmation)
    || !Array.isArray(input.provenance)
    || input.provenance.some((value) => !ALLOWED_VALUES.provenance.has(value))
    || new Set(input.provenance).size !== input.provenance.length
  ) return false;

  const hasVendorConfirmed = input.provenance.includes("vendor_confirmed");
  const hasVendorUnconfirmed = input.provenance.includes("vendor_unconfirmed");
  if (hasVendorConfirmed && hasVendorUnconfirmed) return false;
  if (input.vendorConfirmation === "confirmed") return hasVendorConfirmed;
  if (input.vendorConfirmation === "unconfirmed") return hasVendorUnconfirmed;
  return !hasVendorConfirmed && !hasVendorUnconfirmed;
}

function buildSupporting(input) {
  const boundaryLabels = [];
  if (
    input.vendorConfirmation === "unconfirmed"
    || input.provenance?.includes("vendor_unconfirmed")
  ) {
    boundaryLabels.push("업체 확인 아님");
  }
  if (input.money === "unpaid") boundaryLabels.push("결제 증빙 아님");
  return Object.freeze({
    approvalLabel: APPROVAL_LABELS[input.approval] ?? null,
    lifecycleLabel: LIFECYCLE_LABELS[input.lifecycle] ?? null,
    provenanceLabels: Object.freeze((input.provenance ?? []).flatMap((value) => (
      PROVENANCE_LABELS[value] ? [PROVENANCE_LABELS[value]] : []
    ))),
    moneyLabel: MONEY_LABELS[input.money] ?? null,
    boundaryLabels: Object.freeze(boundaryLabels),
  });
}

function buildState({
  primaryState,
  headline,
  tone,
  primaryAction,
  showVerifiedContent,
  retainDraft,
  allowRecommendation = false,
  allowMutation = false,
  allowSuccess = false,
  supporting,
}) {
  return Object.freeze({
    version: 1,
    primaryState,
    headline,
    tone,
    primaryAction,
    showVerifiedContent,
    retainDraft,
    allowRecommendation,
    allowMutation,
    allowSuccess,
    supporting,
  });
}

export function composeAmoraConsumerState(input) {
  if (!isValidInput(input)) return null;

  if (input.safety === "w5") {
    return buildState({
      primaryState: "safety_hold",
      headline: "안전을 먼저 확인해요",
      tone: "danger",
      primaryAction: Object.freeze({
        kind: "open_safety_support",
        label: "안전 도움 보기",
        requiresWrite: false,
      }),
      showVerifiedContent: false,
      retainDraft: input.identity === "current" && input.scope === "verified",
      allowRecommendation: false,
      allowMutation: false,
      allowSuccess: false,
      supporting: emptySupporting(),
    });
  }

  if (input.identity === "changed" || input.identity === "unknown") {
    return buildState({
      primaryState: "identity_changed",
      headline: "새 준비 공간을 확인하고 있어요",
      tone: "neutral",
      primaryAction: Object.freeze({
        kind: "load_current_identity",
        label: "현재 준비 다시 불러오기",
        requiresWrite: false,
      }),
      showVerifiedContent: false,
      retainDraft: false,
      allowRecommendation: false,
      allowMutation: false,
      allowSuccess: false,
      supporting: emptySupporting(),
    });
  }

  if (input.scope === "invalid") {
    return buildState({
      primaryState: "scope_unavailable",
      headline: "현재 준비 범위를 확인하지 못했어요",
      tone: "warning",
      primaryAction: Object.freeze({
        kind: "retry_scope",
        label: "준비 범위 다시 확인",
        requiresWrite: false,
      }),
      showVerifiedContent: false,
      retainDraft: false,
      allowRecommendation: false,
      allowMutation: false,
      allowSuccess: false,
      supporting: emptySupporting(),
    });
  }

  if (input.read !== "loaded") {
    const presentation = READ_PRESENTATIONS[input.read];
    if (!presentation) return null;
    return buildState({
      primaryState: input.read,
      headline: presentation.headline,
      tone: presentation.tone,
      primaryAction: presentation.action,
      showVerifiedContent: input.read === "partial"
        || (input.read !== "empty" && input.hasVerifiedSnapshot === true),
      retainDraft: true,
      supporting: input.read === "empty" ? emptySupporting() : buildSupporting(input),
    });
  }

  if (input.applicability === "not_applicable") {
    const approvalBlocksReinclude = [
      "proposal",
      "review",
      "approved",
      "write_error",
    ].includes(input.approval);
    const blockedAction = input.approval === "proposal"
      ? APPROVAL_PRESENTATIONS.proposal.action
      : input.approval === "review"
        ? APPROVAL_PRESENTATIONS.review.action
        : input.approval === "approved"
          ? Object.freeze({
              kind: "review_changes",
              label: "승인 내용 확인",
              requiresWrite: false,
            })
          : APPROVAL_PRESENTATIONS.write_error.action;
    return buildState({
      primaryState: "not_applicable",
      headline: "하지 않기로 한 준비예요",
      tone: "neutral",
      primaryAction: approvalBlocksReinclude
        ? blockedAction
        : Object.freeze({ kind: "reinclude_topic", label: "다시 준비에 포함", requiresWrite: true }),
      showVerifiedContent: true,
      retainDraft: true,
      allowMutation: !approvalBlocksReinclude,
      supporting: buildSupporting(input),
    });
  }

  if (input.applicability === "unknown") {
    return buildState({
      primaryState: "applicability_unknown",
      headline: "이 준비가 필요한지 먼저 확인해요",
      tone: "neutral",
      primaryAction: Object.freeze({
        kind: "review_applicability",
        label: "필요 여부 확인",
        requiresWrite: false,
      }),
      showVerifiedContent: true,
      retainDraft: true,
      supporting: buildSupporting(input),
    });
  }

  const approvalPresentation = APPROVAL_PRESENTATIONS[input.approval];
  if (approvalPresentation) {
    return buildState({
      primaryState: approvalPresentation.primaryState,
      headline: approvalPresentation.headline,
      tone: approvalPresentation.tone,
      primaryAction: approvalPresentation.action,
      showVerifiedContent: true,
      retainDraft: true,
      allowMutation: approvalPresentation.allowMutation,
      supporting: buildSupporting(input),
    });
  }

  if (input.lifecycle === "completed") {
    const hasCanonicalReceipt = input.approval === "receipt";
    const isUserReported = input.provenance?.includes("user_reported") === true;
    return buildState({
      primaryState: hasCanonicalReceipt ? "completed" : "completion_unverified",
      headline: hasCanonicalReceipt
        ? isUserReported
          ? "사용자가 완료로 기록했어요"
          : "완료가 정본에 반영됐어요"
        : "완료 여부를 확인해 주세요",
      tone: hasCanonicalReceipt ? "success" : "warning",
      primaryAction: Object.freeze(hasCanonicalReceipt
        ? { kind: "view_receipt", label: "반영 결과 보기", requiresWrite: false }
        : { kind: "check_canonical_state", label: "현재 상태 확인", requiresWrite: false }),
      showVerifiedContent: true,
      retainDraft: true,
      allowSuccess: hasCanonicalReceipt,
      supporting: buildSupporting(input),
    });
  }

  const lifecyclePresentation = LIFECYCLE_PRESENTATIONS[input.lifecycle];
  if (lifecyclePresentation) {
    return buildState({
      primaryState: input.lifecycle,
      headline: lifecyclePresentation.headline,
      tone: lifecyclePresentation.tone,
      primaryAction: lifecyclePresentation.action,
      showVerifiedContent: true,
      retainDraft: true,
      allowRecommendation: lifecyclePresentation.allowRecommendation,
      supporting: buildSupporting(input),
    });
  }

  return null;
}
