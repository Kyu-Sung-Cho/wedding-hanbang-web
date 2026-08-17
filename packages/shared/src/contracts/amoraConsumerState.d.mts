export type AmoraConsumerStateInput = Readonly<{
  version: 1;
  safety: "clear" | "w5";
  identity: "current" | "changed" | "unknown";
  scope: "verified" | "invalid";
  read: "loaded" | "loading" | "empty" | "partial" | "unavailable" | "stale" | "conflict" | "timeout";
  hasVerifiedSnapshot: boolean;
  applicability: "unknown" | "applicable" | "not_applicable";
  approval: "none" | "proposal" | "review" | "approved" | "write_error" | "receipt";
  lifecycle: "ready" | "in_progress" | "blocked" | "changed" | "completed" | "quiet";
  provenance: readonly (
    | "user_input"
    | "user_reported"
    | "ai_proposal"
    | "couple_confirmed"
    | "vendor_unconfirmed"
    | "vendor_confirmed"
    | "official_reference"
  )[];
  money: "none" | "planned" | "quote" | "contract_entered" | "payment_recorded" | "payment_evidence" | "unpaid";
  vendorConfirmation: "not_applicable" | "unconfirmed" | "confirmed";
}>;

export type AmoraConsumerPrimaryState =
  | "safety_hold"
  | "identity_changed"
  | "scope_unavailable"
  | "loading"
  | "empty"
  | "partial"
  | "unavailable"
  | "stale"
  | "conflict"
  | "timeout"
  | "not_applicable"
  | "applicability_unknown"
  | "proposal"
  | "review_required"
  | "approved"
  | "write_error"
  | "completion_unverified"
  | "completed"
  | "ready"
  | "in_progress"
  | "blocked"
  | "changed"
  | "quiet";

export type AmoraConsumerPrimaryActionKind =
  | "open_safety_support"
  | "load_current_identity"
  | "retry_scope"
  | "start_empty_state"
  | "retry_read"
  | "recalculate"
  | "review_conflict"
  | "check_canonical_state"
  | "reinclude_topic"
  | "review_applicability"
  | "review_proposal"
  | "review_changes"
  | "apply_approved_change"
  | "view_receipt"
  | "start_action"
  | "resume_action"
  | "recover_block"
  | "preview_changes"
  | "view_preparation_map";

export type AmoraConsumerState = Readonly<{
  version: 1;
  primaryState: AmoraConsumerPrimaryState;
  headline: string;
  tone: "neutral" | "rose" | "success" | "warning" | "danger";
  primaryAction: Readonly<{
    kind: AmoraConsumerPrimaryActionKind;
    label: string;
    requiresWrite: boolean;
  }> | null;
  showVerifiedContent: boolean;
  retainDraft: boolean;
  allowRecommendation: boolean;
  allowMutation: boolean;
  allowSuccess: boolean;
  supporting: Readonly<{
    approvalLabel: string | null;
    lifecycleLabel: string | null;
    provenanceLabels: readonly string[];
    moneyLabel: string | null;
    boundaryLabels: readonly string[];
  }>;
}>;

export declare function composeAmoraConsumerState(
  input: AmoraConsumerStateInput,
): AmoraConsumerState | null;
