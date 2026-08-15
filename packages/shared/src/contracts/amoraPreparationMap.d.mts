export const AMORA_PREPARATION_MAP_CONTRACT_VERSION: 1;

export type AmoraPreparationTopicState =
  | "unknown"
  | "not_started"
  | "in_progress"
  | "completed"
  | "not_applicable"
  | "needs_review";

export type AmoraPreparationTopicSource =
  | "no_saved_record"
  | "saved_checklist";

export type AmoraPreparationAttentionReason =
  | "continue_saved_progress"
  | "basic_check_window"
  | "saved_not_started"
  | "confirm_applicability"
  | "resolve_conflict";

export interface AmoraPreparationTopicTemplate {
  key: string;
  label: string;
  ddayStart?: number;
  ddayDeadline?: number;
  items: readonly { id: string; label?: string; done?: boolean }[];
}

export interface AmoraPreparationTopicView {
  topicKey: string;
  label: string;
  state: AmoraPreparationTopicState;
  source: AmoraPreparationTopicSource;
  completedItems: number;
  totalItems: number;
  percent: number;
  attentionReason: AmoraPreparationAttentionReason | null;
}

export interface AmoraPreparationOverview {
  version: 1;
  coverage: Readonly<{
    version: 1;
    stage: "complete" | "partial" | "invalid";
    connectedTopicCount: number;
    journeyAxisCount: number;
    gapCount: number;
    issueCount: number;
  }>;
  summary: Readonly<{
    totalTopics: number;
    unknownTopics: number;
    notStartedTopics: number;
    inProgressTopics: number;
    completedTopics: number;
    notApplicableTopics: number;
    needsReviewTopics: number;
    completedItems: number;
    totalItems: number;
    percent: number;
  }>;
  topics: readonly Readonly<AmoraPreparationTopicView>[];
  attentionTopics: readonly Readonly<AmoraPreparationTopicView>[];
}

export function buildAmoraPreparationOverview(input: {
  topics: readonly AmoraPreparationTopicTemplate[];
  progress: Readonly<Record<string, unknown>>;
  attentionTopicKeys?: readonly string[];
}): Readonly<AmoraPreparationOverview>;
