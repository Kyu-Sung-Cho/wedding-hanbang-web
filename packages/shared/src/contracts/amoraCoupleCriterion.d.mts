export const AMORA_COUPLE_CRITERION_CONTRACT_VERSION: 1;

export interface AmoraConfirmedCoupleCriterion {
  decisionId: string;
  value: string;
  confirmedAt: string;
}

export interface AmoraCoupleCriterionProposal {
  id: string;
  value: string;
  revision: number;
  proposerUserId: string;
  brideUserId: string;
  groomUserId: string;
  acceptedUserIds: [string];
  createdAt: string;
  updatedAt: string;
}

export interface AmoraCoupleCriterionResponse {
  version: 1;
  coupleId: string;
  linked: boolean;
  current: AmoraConfirmedCoupleCriterion | null;
  proposal: AmoraCoupleCriterionProposal | null;
}

export function parseAmoraCoupleCriterionResponse(
  value: unknown,
): AmoraCoupleCriterionResponse | null;

export interface AmoraCoupleCriterionProposeRequest {
  version: 1;
  expectedCoupleId: string;
  expectedCurrentDecisionId: string | null;
  requestId: string;
  value: string;
}

export function parseAmoraCoupleCriterionProposeRequest(
  value: unknown,
): AmoraCoupleCriterionProposeRequest | null;

export function buildAmoraCoupleCriterionProposeRequest(input: {
  expectedCoupleId: string;
  expectedCurrentDecisionId: string | null;
  requestId: string;
  value: unknown;
}): AmoraCoupleCriterionProposeRequest | null;

export interface AmoraCoupleCriterionProposalMutationRequest {
  version: 1;
  expectedCoupleId: string;
  proposalId: string;
  expectedRevision: number;
  requestId: string;
}

export function parseAmoraCoupleCriterionAcceptRequest(
  value: unknown,
): AmoraCoupleCriterionProposalMutationRequest | null;

export function buildAmoraCoupleCriterionAcceptRequest(input: {
  expectedCoupleId: string;
  proposalId: string;
  expectedRevision: number;
  requestId: string;
}): AmoraCoupleCriterionProposalMutationRequest | null;

export function parseAmoraCoupleCriterionCancelRequest(
  value: unknown,
): AmoraCoupleCriterionProposalMutationRequest | null;

export function buildAmoraCoupleCriterionCancelRequest(input: {
  expectedCoupleId: string;
  proposalId: string;
  expectedRevision: number;
  requestId: string;
}): AmoraCoupleCriterionProposalMutationRequest | null;
