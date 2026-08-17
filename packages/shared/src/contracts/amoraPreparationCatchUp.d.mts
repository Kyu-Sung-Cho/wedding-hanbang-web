export const AMORA_PREPARATION_CATCH_UP_CONTRACT_VERSION: 1;

export type AmoraPreparationCatchUpTopicKey =
  | "meeting"
  | "venue"
  | "studio"
  | "dress"
  | "makeup"
  | "ring"
  | "hanbok"
  | "yedan"
  | "honeymoon"
  | "houseware"
  | "housing"
  | "invitation"
  | "snap"
  | "shoes"
  | "bouquet"
  | "gift"
  | "mc"
  | "ham"
  | "pyebaek";

export type AmoraPreparationCatchUpState =
  | "completed"
  | "in_progress"
  | "unknown"
  | "not_applicable";

export type AmoraPreparationCatchUpScope = "owner_private" | "couple_shared";

export const AMORA_PREPARATION_CATCH_UP_TOPICS: readonly Readonly<{
  topicKey: AmoraPreparationCatchUpTopicKey;
  topicLabel: string;
}>[];

export type AmoraPreparationCatchUpEntry = Readonly<{
  version: 1;
  mode: "catch_up" | "canonical_existing" | "recovery" | "deferred" | "not_needed";
  title: string;
  description: string;
  primaryAction: Readonly<{
    kind:
      | "open_catch_up_editor"
      | "continue_canonical"
      | "retry_canonical_read"
      | "continue_first_value";
    label: string;
    requiresWrite: false;
  }> | null;
  catchUpEnabled: boolean;
}>;

export type AmoraPreparationCatchUpOperationItem = Readonly<{
  topicKey: AmoraPreparationCatchUpTopicKey;
  state: AmoraPreparationCatchUpState;
  scope: AmoraPreparationCatchUpScope;
  source: "user_reported";
}>;

export type AmoraPreparationCatchUpPreview = Readonly<{
  version: 1;
  kind: "preview";
  title: string;
  description: string;
  items: readonly Readonly<{
    topicKey: AmoraPreparationCatchUpTopicKey;
    topicLabel: string;
    state: AmoraPreparationCatchUpState;
    stateLabel: string;
    scope: AmoraPreparationCatchUpScope;
    scopeLabel: string;
    source: "user_reported";
    boundaryLabel: string;
  }>[];
  operation: Readonly<{
    version: 1;
    kind: "reconcile_preparation_catch_up";
    items: readonly AmoraPreparationCatchUpOperationItem[];
  }>;
  requiresApproval: true;
  writesChecklistCompletion: false;
  estimatedCompletionRate: null;
}>;

export type AmoraPreparationCatchUpMutationRequest = Readonly<{
  version: 1;
  expectedCoupleId: string;
  requestId: string;
  items: readonly Readonly<{
    topicKey: AmoraPreparationCatchUpTopicKey;
    state: AmoraPreparationCatchUpState;
    scope: AmoraPreparationCatchUpScope;
  }>[];
}>;

export type AmoraPreparationCatchUpDraftSubmission = Omit<
  AmoraPreparationCatchUpMutationRequest,
  "expectedCoupleId"
>;

export type AmoraPreparationCatchUpReceipt = Readonly<{
  version: 1;
  status: "applied";
  receiptId: string;
  coupleId: string;
  requestId: string;
  sourceJourneyRevision: number;
  confirmedAt: string;
  reused: boolean;
  items: readonly Readonly<{
    decisionId: string;
    topicKey: AmoraPreparationCatchUpTopicKey;
    state: AmoraPreparationCatchUpState;
    scope: AmoraPreparationCatchUpScope;
    source: "user_reported";
  }>[];
  boundaries: Readonly<{
    checklistCompletionChanged: false;
    vendorConfirmation: "unconfirmed";
    paymentEvidence: false;
  }>;
  next: Readonly<{
    kind: "recalculate_current_state";
    route: "/schedule";
  }>;
}>;

export type AmoraPreparationCatchUpCanonicalExisting = Readonly<{
  version: 1;
  status: "canonical_existing";
  next: Readonly<{
    kind: "continue_canonical";
    route: "/schedule";
  }>;
}>;

export function resolveAmoraPreparationCatchUpEntry(input: {
  version: 1;
  readState: "loaded" | "partial" | "unavailable";
  canonicalProgress: "empty" | "present";
  selfReportedStage: "starting" | "already_preparing" | "unknown" | "later";
}): AmoraPreparationCatchUpEntry | null;

export function buildAmoraPreparationCatchUpPreview(input: {
  version: 1;
  items: readonly Readonly<{
    topicKey: AmoraPreparationCatchUpTopicKey;
    state: AmoraPreparationCatchUpState;
    scope: AmoraPreparationCatchUpScope;
  }>[];
}): AmoraPreparationCatchUpPreview | null;

export function parseAmoraPreparationCatchUpMutationRequest(
  input: unknown,
): AmoraPreparationCatchUpMutationRequest | null;

export function parseAmoraPreparationCatchUpDraftSubmission(
  input: unknown,
): AmoraPreparationCatchUpDraftSubmission | null;

export function parseAmoraPreparationCatchUpCanonicalExisting(
  input: unknown,
): AmoraPreparationCatchUpCanonicalExisting | null;

export function validateAmoraPreparationCatchUpReceipt(
  input: unknown,
  expectedCoupleId: string,
  expectedRequestId: string,
  expectedItems: readonly Readonly<{
    topicKey: AmoraPreparationCatchUpTopicKey;
    state: AmoraPreparationCatchUpState;
    scope: AmoraPreparationCatchUpScope;
  }>[],
):
  | Readonly<{ ok: true; value: AmoraPreparationCatchUpReceipt }>
  | Readonly<{ ok: false; reason: string }>;
