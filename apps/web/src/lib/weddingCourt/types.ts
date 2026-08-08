export const WEDDING_COURT_CHOICES = ["a", "b"] as const;
export type WeddingCourtChoice = (typeof WEDDING_COURT_CHOICES)[number];
export type WeddingCourtRound = 1 | 2;

export interface WeddingCourtReasonChip {
  id: string;
  label: string;
}

export interface WeddingCourtOwnVote {
  round: WeddingCourtRound;
  choice: WeddingCourtChoice;
  reasonChip: string;
  predictedMajority: WeddingCourtChoice | null;
}

export interface WeddingCourtDistributionSide {
  count: number;
  percent: number;
}

export interface WeddingCourtReasonCount {
  id: string;
  label: string;
  count: number;
}

export interface WeddingCourtDistribution {
  totalVotes: number;
  lean: WeddingCourtChoice | "tie";
  a: WeddingCourtDistributionSide;
  b: WeddingCourtDistributionSide;
  reasons: {
    a: WeddingCourtReasonCount[];
    b: WeddingCourtReasonCount[];
  };
}

export interface WeddingCourtPerspective {
  choice: WeddingCourtChoice;
  label: string;
  text: string;
  signal: "more_selected" | "less_selected" | "same";
}

export interface WeddingCourtCaseState {
  id: string;
  slug: string;
  docketLabel: string;
  title: string;
  question: string;
  opening: string;
  initialFacts: string[];
  choices: Record<WeddingCourtChoice, string>;
  reasonChips: WeddingCourtReasonChip[];
  synthetic: true;
  stage: "first_vote" | "appeal_vote" | "complete";
  ownVotes: {
    first?: WeddingCourtOwnVote;
    appeal?: WeddingCourtOwnVote;
  };
  firstRound?: {
    distribution: WeddingCourtDistribution;
    predictionMatchesCurrentLean: boolean | null;
    perspectives: [WeddingCourtPerspective, WeddingCourtPerspective];
  };
  newEvidence?: {
    title: string;
    detail: string;
  };
  appealRound?: {
    distribution: WeddingCourtDistribution;
    perspectives: [WeddingCourtPerspective, WeddingCourtPerspective];
  };
  ending?: string;
  safetyNotice: string;
}

export interface WeddingCourtVoteInput {
  round: WeddingCourtRound;
  choice: WeddingCourtChoice;
  reasonChip: string;
  predictedMajority: WeddingCourtChoice | null;
}

export interface WeddingCourtVoteReceipt {
  action: "created" | "existing";
  courtCase: WeddingCourtCaseState;
}
