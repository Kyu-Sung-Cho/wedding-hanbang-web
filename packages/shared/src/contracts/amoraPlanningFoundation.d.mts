export const AMORA_PLANNING_FOUNDATION_CONTRACT_VERSION: 1;

export type PlanningFoundationSelfReportedStage =
  | "starting"
  | "already_preparing"
  | "unknown"
  | "later";

export type PlanningFoundationSource = Readonly<{
  kind: "self_report" | "canonical_progress";
  key: string;
  label: string;
}>;

export type PlanningFoundationFirstValue =
  | Readonly<{
      kind: "question";
      questionKey: "preparation_stage";
      title: string;
      description: string;
      options: readonly Readonly<{
        value: Exclude<PlanningFoundationSelfReportedStage, "later">;
        label: string;
      }>[];
      secondaryAction: Readonly<{ value: "later"; label: string }>;
      usedSources: readonly PlanningFoundationSource[];
    }>
  | Readonly<{
      kind: "action";
      actionKey:
        | "establish_preparation_baseline"
        | "reconstruct_existing_preparation"
        | "continue_saved_topic"
        | "start_saved_topic";
      topicKey: string;
      title: string;
      reason: string;
      completionCriterion: string;
      usedSources: readonly PlanningFoundationSource[];
      unknownSafe: boolean;
    }>
  | Readonly<{
      kind: "recovery";
      recoveryKey: "review_saved_topic";
      topicKey: string;
      title: string;
      description: string;
      usedSources: readonly PlanningFoundationSource[];
    }>
  | Readonly<{
      kind: "deferred";
      title: string;
      description: string;
      resumeKey: "preparation_stage";
      usedSources: readonly PlanningFoundationSource[];
    }>
  | Readonly<{
      kind: "unavailable";
      title: string;
      description: string;
      retryable: true;
      usedSources: readonly PlanningFoundationSource[];
    }>;

export function resolvePlanningFoundationFirstValue(input: {
  preparationOverview: unknown;
  selfReportedStage?: PlanningFoundationSelfReportedStage | null;
  readState?: "loaded" | "partial" | "unavailable";
}): PlanningFoundationFirstValue;
