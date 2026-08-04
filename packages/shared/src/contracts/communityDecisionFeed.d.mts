export type CommunityDecisionFeedMode = "for_you" | "needs_help" | "outcomes";
export type CommunityDecisionFeedState =
  | "open"
  | "answered"
  | "resolved"
  | "followup_scheduled"
  | "completed"
  | "closed";
export type CommunityDecisionFeedItem = {
  threadId: string;
  postId: string;
  state: CommunityDecisionFeedState;
  version: number;
  kind: "experience_question";
  topicCategory: "contract_extra_cost";
  experienceScope: "contract_terms" | "extra_charge" | "vendor_response" | "cancellation_refund";
  coarseRegion: string | null;
  preparationStage: "vendor_search" | "contract_review" | "contracted" | "dispute_or_cancellation";
  contractPhase: "before_contract" | "after_contract" | "cancellation_or_refund";
  desiredAnswer: string;
  title: string;
  content: string;
  contentOrigin: "member";
  commercialRelationship: "none" | "gift" | "discount" | "refund" | "affiliate" | "paid" | "employee" | "owner_or_family" | "platform_research_compensation";
  sponsorshipDetail: string | null;
  author: { nickname: string; badge: string };
  qualifiedPeerAnswerCount: number;
  qualifiedProfessionalAnswerCount: number;
  viewer: { isAuthor: boolean; canAnswer: boolean };
  outcome: null | {
    id: string;
    revision: number;
    actionTaken: string;
    resultSummary: string;
    applicableConditions: string;
    commercialRelationship: CommunityDecisionFeedItem["commercialRelationship"];
    sponsorshipDetail: string | null;
    createdAt: string;
  };
  createdAt: string;
  sortAt: string;
};
export type CommunityDecisionFeed = {
  items: readonly CommunityDecisionFeedItem[];
  nextCursor: null | { at: string; id: string };
  hasMore: boolean;
  mode: CommunityDecisionFeedMode;
};
export type CommunityDecisionPublicOutcome = NonNullable<
  CommunityDecisionFeedItem["outcome"]
>;
export type CommunityDecisionPublicOutcomeResponse = {
  outcome: CommunityDecisionPublicOutcome | null;
};
export type CommunityDecisionInbox = {
  waitingReplies: {
    count: number;
    targetQuestionId: string | null;
    targetStatus: "private_waitlist" | "open" | null;
  };
  experienceNeeded: { count: number; targetThreadId: string | null };
  returnedOutcomes: { count: number; targetThreadId: string | null };
};
export function parseCommunityDecisionFeed(
  value: unknown,
  expectedMode?: CommunityDecisionFeedMode,
): CommunityDecisionFeed | null;
export function parseCommunityDecisionPublicOutcome(
  value: unknown,
): CommunityDecisionPublicOutcomeResponse | null;
export function parseCommunityDecisionInbox(
  value: unknown,
): CommunityDecisionInbox | null;
