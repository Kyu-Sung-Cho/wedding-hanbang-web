import type {
  AmoraPreparationCoverageAudit,
  AmoraPreparationCoverageGapDisposition,
  AmoraPreparationCoverageSurfaceOwner,
  AmoraPreparationJourneyAxisKey,
} from "./amoraPreparationCoverage.mjs";

export const AMORA_JOURNEY_TRUTH_AUDIT_CONTRACT_VERSION: 1;

export type AmoraJourneyTruthTopicPolicy = Readonly<{
  topicKey: string;
  truthOwners: Readonly<{
    problem: "canonical_checklist";
    applicability: "saved_checklist";
    status: "saved_checklist";
    progress: "saved_checklist";
    decision: "validated_receipt_projection";
    execution: "current_schedule_or_shared_action";
    completion: "saved_checklist";
  }>;
  evidenceEffects: Readonly<{
    schedule: "supporting_execution_only";
    decisionReceipt: "supporting_decision_only";
    userReport: "supporting_non_proof_only";
    vendorRecord: "supporting_non_proof_only";
    budgetRecord: "supporting_non_payment_only";
    openAction: "prevents_terminal_completion";
    guide: "supporting_guidance_only";
    savedConversation: "supporting_context_only";
  }>;
  failureUi: Readonly<{
    unknownApplicability: "review_required";
    conflict: "review_required";
    partial: "partial_visible";
    unavailable: "unavailable_visible";
    empty: "empty_only_when_all_required_reads_loaded";
  }>;
}>;

export type AmoraJourneyTruthGapPolicy = Readonly<{
  gapKey: string;
  disposition: AmoraPreparationCoverageGapDisposition;
  surfaceOwner: AmoraPreparationCoverageSurfaceOwner;
  axisKeys: readonly AmoraPreparationJourneyAxisKey[];
  requiredSourceKinds: readonly string[];
  consumerState: "known_gap_priority" | "known_gap" | "parked_out_of_scope";
  allowProgress: false;
  allowCompletion: false;
  allowRecommendation: false;
}>;

export type AmoraJourneyTruthAudit = Readonly<{
  version: 1;
  scope: "full_wedding_journey_truth";
  topicPolicies: readonly AmoraJourneyTruthTopicPolicy[];
  gapPolicies: readonly AmoraJourneyTruthGapPolicy[];
  isComplete: false;
}>;

export function getAmoraJourneyTruthTopicPolicy(
  topicKey: unknown,
): AmoraJourneyTruthTopicPolicy | null;

export function buildAmoraJourneyTruthAudit(
  coverage: unknown | Readonly<AmoraPreparationCoverageAudit>,
): AmoraJourneyTruthAudit | null;
