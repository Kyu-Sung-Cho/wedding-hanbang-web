export const AMORA_PREPARATION_COVERAGE_CONTRACT_VERSION: 1;

export type AmoraPreparationJourneyAxisKey =
  | "foundation"
  | "couple_and_family"
  | "venue_and_guests"
  | "photo_and_style"
  | "ceremony_program"
  | "vendors_and_money"
  | "home_and_life"
  | "travel_and_admin"
  | "final_operations"
  | "post_wedding";

export type AmoraPreparationCoverageStatus = "connected" | "partial" | "gap";
export type AmoraPreparationCoverageGapDisposition = "now" | "known_gap" | "parked";
export type AmoraPreparationCoverageSurfaceOwner =
  | "onboarding_and_amora"
  | "preparation_map"
  | "preparation_topic"
  | "none";

export interface AmoraPreparationCoverageChecklistTopic {
  topicKey: string;
  label: string;
  axisKeys: readonly AmoraPreparationJourneyAxisKey[];
}

export interface AmoraPreparationCoverageAxis {
  axisKey: AmoraPreparationJourneyAxisKey;
  label: string;
  status: AmoraPreparationCoverageStatus;
  connectedTopicKeys: readonly string[];
  gapKeys: readonly string[];
}

export interface AmoraPreparationCoverageGap {
  gapKey: string;
  label: string;
  disposition: AmoraPreparationCoverageGapDisposition;
  surfaceOwner: AmoraPreparationCoverageSurfaceOwner;
  axisKeys: readonly AmoraPreparationJourneyAxisKey[];
  reason: string;
  requiredSourceKinds: readonly string[];
}

export type AmoraPreparationCoverageIssue =
  | Readonly<{
      code: "duplicate_checklist_topic";
      topicKey: string;
      inputIndex: number;
    }>
  | Readonly<{
      code: "missing_checklist_topic";
      topicKey: string;
    }>
  | Readonly<{
      code: "unmapped_checklist_topic";
      topicKey: string;
      inputIndex: number;
    }>
  | Readonly<{
      code: "invalid_checklist_topic";
      inputIndex: number;
    }>;

export interface AmoraPreparationCoverageAudit {
  version: 1;
  scope: "full_wedding_journey";
  axes: readonly Readonly<AmoraPreparationCoverageAxis>[];
  connectedChecklistTopics: readonly Readonly<AmoraPreparationCoverageChecklistTopic>[];
  gaps: readonly Readonly<AmoraPreparationCoverageGap>[];
  issues: readonly Readonly<AmoraPreparationCoverageIssue>[];
  isComplete: boolean;
}

export function auditAmoraPreparationCoverage(input: {
  checklistTopics: unknown;
}): Readonly<AmoraPreparationCoverageAudit>;
