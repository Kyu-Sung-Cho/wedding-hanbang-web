export type CommunityDecisionCreateReceipt =
  | {
      kind: "private_waitlist";
      questionId: string;
      commandId: string;
      operationKey: string;
      replayed: boolean;
    }
  | {
      kind: "published";
      questionId: string;
      commandId: string;
      operationKey: string;
      threadId: string;
      postId: string;
      publicationVersion: 1;
      currentState: CommunityDecisionThreadState;
      currentVersion: number;
      replayed: boolean;
    };

export function isCommunityDecisionUuid(value: unknown): value is string;
export function parseCommunityDecisionCreateReceipt(
  value: unknown,
  httpStatus: number,
): CommunityDecisionCreateReceipt | null;
export function isCommunityDecisionCreateReceiptForSubmission(
  receipt: CommunityDecisionCreateReceipt | null,
  expectedQuestionId: string,
  expectedOperationKey: string,
  expectedCommandId: string | null,
): boolean;
export function readCommunityDecisionApiError(value: unknown, fallback: string): string;
export function parseRetryAfterSeconds(value: unknown): number | null;
export type CommunityDecisionWithdrawReceipt = {
  status: "withdrawn";
  questionId: string;
  threadId: string | null;
  state: CommunityDecisionThreadState | null;
  version: number | null;
  sourceUnavailableAt: string | null;
  commandId: string;
  operationKey: string;
  replayed: boolean;
};
export function parseCommunityDecisionWithdrawReceipt(
  value: unknown,
): CommunityDecisionWithdrawReceipt | null;
export type CommunityDecisionPublicationWithdrawReceipt = {
  status: "withdrawn";
  threadId: string;
  outcomeId: string;
  operationKey: string;
  revision: number;
  withdrawnAt: string;
  replayed: boolean;
};
export function parseCommunityDecisionPublicationWithdrawReceipt(
  value: unknown,
): CommunityDecisionPublicationWithdrawReceipt | null;
export type CommunityDecisionPublicationState =
  | "pending_review"
  | "published"
  | "rejected"
  | "withdrawn";
export type CommunityDecisionPublicationStatus = {
  outcomeId: string;
  threadId: string;
  revision: number;
  publicationState: CommunityDecisionPublicationState;
  canWithdraw: boolean;
  updatedAt: string;
};
export function parseCommunityDecisionPublicationStatus(
  value: unknown,
): CommunityDecisionPublicationStatus | null;
export type CommunityDecisionMutationOperation =
  | "answer"
  | "applicability"
  | "resolve"
  | "outcome";
export type CommunityDecisionMutationReceipt =
  | ({ operation: "answer"; status: "answered"; answerId: string; commentId: string; qualifiedPeerAnswerCount: number; qualifiedProfessionalAnswerCount: number }
    & CommunityDecisionVersionReceipt)
  | ({ operation: "applicability"; status: "applicability_recorded"; selectionId: string; answerId: string; applicability: CommunityDecisionApplicability }
    & CommunityDecisionVersionReceipt)
  | ({ operation: "resolve"; status: "resolved"; nextAction: string; answerIds: string[]; selectionIds: string[] }
    & CommunityDecisionVersionReceipt)
  | ({ operation: "outcome"; status: "completed"; outcomeId: string; revision: number }
    & CommunityDecisionVersionReceipt);
export type CommunityDecisionVersionReceipt = {
  threadId: string;
  state: CommunityDecisionThreadState;
  version: number;
  commandId: string;
  operationKey: string;
  replayed: boolean;
};
export function parseCommunityDecisionMutationReceipt(
  value: unknown,
  operation: CommunityDecisionMutationOperation,
): CommunityDecisionMutationReceipt | null;
export type CommunityDecisionStaleReceipt = {
  status: "stale";
  threadId: string;
  state: CommunityDecisionThreadState;
  currentVersion: number;
  commandId: string;
  operationKey: string;
  replayed: boolean;
};
export function parseCommunityDecisionStaleReceipt(
  value: unknown,
): CommunityDecisionStaleReceipt | null;
export function isCommunityDecisionReceiptForCommand(
  receipt: unknown,
  expectedCommandId: string,
): boolean;
export type CommunityDecisionMutationPending = {
  ownerId: string;
  questionId: string;
  slot: string;
  operation: CommunityDecisionMutationOperation | "withdraw" | "publication_withdraw";
  operationKey: string;
  bodyText: string;
  createdAt: number;
};
export function parseCommunityDecisionMutationPending(
  value: unknown,
  expectedOwnerId: string,
  expectedQuestionId: string,
  now?: number,
): CommunityDecisionMutationPending | null;
export function readDecisionThreadIdFromPost(value: unknown): string | null;

export type CommunityDecisionThreadState =
  | "open"
  | "answered"
  | "resolved"
  | "followup_scheduled"
  | "completed"
  | "closed";
export type CommunityDecisionApplicability =
  | "applies"
  | "conditions_differ"
  | "need_more_info"
  | "taken_as_next_action";
export type CommunityDecisionCommercialRelationship =
  | "none"
  | "gift"
  | "discount"
  | "refund"
  | "affiliate"
  | "paid"
  | "employee"
  | "owner_or_family"
  | "platform_research_compensation";
export type CommunityDecisionPreparationStage =
  | "vendor_search"
  | "contract_review"
  | "contracted"
  | "dispute_or_cancellation";
export type CommunityDecisionDetail = CommunityDecisionPublishedDetail | CommunityDecisionWaitlistDetail;
export type CommunityDecisionPublishedDetail = {
  thread: {
    id: string;
    postId: string;
    state: CommunityDecisionThreadState;
    version: number;
    kind: "experience_question";
    topicCategory: "contract_extra_cost";
    experienceScope: "contract_terms" | "extra_charge" | "vendor_response" | "cancellation_refund";
    coarseRegion: string | null;
    preparationStage: CommunityDecisionPreparationStage;
    contractPhase: "before_contract" | "after_contract" | "cancellation_or_refund";
    desiredAnswer: string;
    qualifiedPeerAnswerCount: number;
    qualifiedProfessionalAnswerCount: number;
    nextAction: string | null;
    resolvedAt: string | null;
    completedAt: string | null;
    sourceUnavailableAt: string | null;
    newApplicationsAllowed: boolean;
    createdAt: string;
  };
  post: null | {
    title: string;
    content: string;
    contentOrigin: "member" | "industry_professional" | "vendor_official" | "operator" | "ai" | "legacy_unverified";
    commercialRelationship: CommunityDecisionCommercialRelationship;
    sponsorshipDetail: string | null;
    publicationState: "draft" | "published" | "failed" | "withdrawn";
    author: null | { nickname: string; badge: string };
    createdAt: string;
  };
  answers: Array<{
    id: string;
    commentId: string;
    content: string;
    responseKind: "answer" | "experience";
    contentOrigin: "member" | "industry_professional";
    directExperience: true;
    experiencePeriod: "within_3_months" | "within_6_months" | "within_12_months" | "over_12_months";
    experienceStage: CommunityDecisionPreparationStage;
    coarseRegion: string | null;
    actionTaken: string | null;
    resultSummary: string | null;
    nextCheck: string | null;
    factOpinionBoundary: string;
    commercialRelationship: CommunityDecisionCommercialRelationship;
    sponsorshipDetail: string | null;
    rubricVersion: 1;
    author: { nickname: string; badge: string };
    createdAt: string;
  }>;
  viewer: {
    isAuthor: boolean;
    canAnswer: boolean;
    canResolve: boolean;
    canRecordOutcome: boolean;
    canWithdraw: boolean;
    selection: Array<{
      id: string;
      answerId: string;
      commentId: string;
      applicability: CommunityDecisionApplicability;
      selectedAt: string;
      includedInResolutionAt: string | null;
    }>;
    outcomes: Array<{
      id: string;
      revision: number;
      supersedesOutcomeId: string | null;
      actionTaken: string;
      resultSummary: string;
      applicableConditions: string;
      publicConsent: boolean;
      commercialRelationship: CommunityDecisionCommercialRelationship;
      sponsorshipDetail: string | null;
      createdAt: string;
    }>;
  };
};
export type CommunityDecisionWaitlistDetail = {
  status: "private_waitlist";
  intake: {
    questionId: string;
    title: string;
    content: string;
    topicCategory: "contract_extra_cost";
    experienceScope: CommunityDecisionPublishedDetail["thread"]["experienceScope"];
    coarseRegion: string | null;
    preparationStage: CommunityDecisionPreparationStage;
    contractPhase: CommunityDecisionPublishedDetail["thread"]["contractPhase"];
    desiredAnswer: string;
    commercialRelationship: CommunityDecisionCommercialRelationship;
    sponsorshipDetail: string | null;
    createdAt: string;
  };
  thread: null;
  post: null;
  answers: [];
  viewer: {
    isAuthor: true;
    canAnswer: false;
    canResolve: false;
    canRecordOutcome: false;
    canWithdraw: true;
    selection: [];
    outcomes: [];
  };
};
export function parseCommunityDecisionDetail(value: unknown): CommunityDecisionDetail | null;
export type CommunityDecisionDraft = {
  ownerId: string;
  updatedAt: number;
  content: string;
  title: string;
  experienceScope: CommunityDecisionPublishedDetail["thread"]["experienceScope"] | null;
  preparationStage: CommunityDecisionPreparationStage | null;
  contractPhase: CommunityDecisionPublishedDetail["thread"]["contractPhase"] | null;
  coarseRegion: string;
  desiredAnswer: string;
  commercialRelationship: CommunityDecisionCommercialRelationship;
  sponsorshipDetail: string;
};
export function parseCommunityDecisionDraft(
  value: unknown,
  expectedOwnerId: string,
  now?: number,
): CommunityDecisionDraft | null;
