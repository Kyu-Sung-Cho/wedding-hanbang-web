export type PreparationTopicApplicabilityIntent = "exclude" | "reinclude";

export type PreparationTopicApplicabilityFailure =
  | "active_request"
  | "stale"
  | "failed";

export interface PreparationTopicApplicabilityControl {
  readonly version: 1;
  readonly intent: PreparationTopicApplicabilityIntent;
  readonly label: string;
  readonly description: string;
  readonly confirmTitle: string;
  readonly confirmMessage: string;
  readonly confirmActionLabel: string;
  readonly accessibilityLabel: string;
  readonly disabledReason: null;
}

export interface PreparationTopicApplicabilityMutation {
  readonly version: 1;
  readonly intent: PreparationTopicApplicabilityIntent;
  readonly previousStatus: string;
  readonly nextStatus: "not_started" | "in_progress" | "completed" | "not_applicable";
  readonly retainedCompletedItems: number;
  readonly body: {
    readonly expected_couple_id: string;
    readonly expected_revision: number;
    readonly progress_patch: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  };
}

export function classifyPreparationTopicApplicabilityFailure(
  status: number,
  payload: unknown,
): PreparationTopicApplicabilityFailure;

export function buildPreparationTopicApplicabilityControl(
  view: unknown,
): PreparationTopicApplicabilityControl | null;

export function buildPreparationTopicApplicabilityMutation(input: {
  expectedCoupleId: string;
  expectedRevision: number;
  intent: PreparationTopicApplicabilityIntent;
  topic: {
    key: string;
    items: readonly {
      id: string;
      label: string;
    }[];
  } | undefined;
  savedTopic?: unknown;
}): PreparationTopicApplicabilityMutation | null;
