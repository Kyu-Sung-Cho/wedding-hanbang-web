export type BudgetPayer =
  | "couple"
  | "bride_parents"
  | "groom_parents"
  | "both_parents";

export interface BudgetJourneySnapshot {
  coupleId: string;
  totalBudget: number;
  progress: Record<string, unknown>;
  stateRevision: number;
}

export interface BudgetIdentityToken extends BudgetJourneySnapshot {
  generation: number;
  ownerId: string;
}

export interface BudgetLoadToken {
  generation: number;
  ownerId: string;
}

export interface BudgetMutationToken extends BudgetIdentityToken {
  kind: "total" | "category";
  operationId: number;
}

export type BudgetMutationResponse =
  | {
      requestId: string;
      status: "applied";
      requiredCount: number;
      acceptedCount: number;
      summary: string;
      surface: "/budget";
      journey: BudgetJourneySnapshot;
    }
  | {
      requestId: string;
      status: "pending_partner" | "stale" | "rejected";
      requiredCount: number;
      acceptedCount: number;
      summary: string;
      surface: "/budget";
    };

export function parseBudgetJourney(
  value: unknown,
  expectedCoupleId: string,
): BudgetJourneySnapshot;

export function parseManwonInput(value: string): number;

export function buildTotalBudgetMutation(
  snapshot: BudgetJourneySnapshot,
  totalInput: string,
): { expected_revision: number; total_budget: number };

export function buildCategoryBudgetMutation(
  snapshot: BudgetJourneySnapshot,
  input: {
    categoryKey: string;
    budgetInput: string;
    spentInput: string;
    payer: BudgetPayer;
  },
): {
  expected_revision: number;
  progress_patch: Record<string, Record<string, unknown>>;
};

export function parseBudgetMutationResponse(
  value: unknown,
  expectedCoupleId: string,
  expectedRevision: number,
): BudgetMutationResponse;

export function parseBudgetApprovalStatusResponse(
  value: unknown,
  expectedCoupleId: string,
  baseRevision: number,
  currentRevision: number,
): BudgetMutationResponse;

export interface ActiveBudgetApproval {
  ownerId: string;
  coupleId: string;
  surface: "/budget";
  requestId: string;
  baseRevision: number;
  summary: string;
  createdAt: string;
}

export function parseActiveBudgetApproval(
  value: unknown,
  expectedOwnerId: string,
  expectedCoupleId: string,
): ActiveBudgetApproval | null;

export interface ActiveBudgetApprovalStatus {
  approval: ActiveBudgetApproval;
  outcome: BudgetMutationResponse;
}

export function fetchActiveBudgetApprovalStatus(input: {
  apiFetch: (path: string, options?: RequestInit) => Promise<Response>;
  ownerId: string;
  coupleId: string;
  currentRevision: number;
}): Promise<ActiveBudgetApprovalStatus | null>;

export interface PendingBudgetApprovalReference {
  ownerId: string;
  coupleId: string;
  surface: "/budget";
  requestId: string;
  summary: string;
  expectedRevision: number;
}

export function isPendingBudgetApprovalBoundToIdentity(
  pending: PendingBudgetApprovalReference | null,
  identity: Pick<
    BudgetIdentityToken,
    "ownerId" | "coupleId" | "stateRevision"
  > | null,
): boolean;

export type BudgetEditBase = Pick<
  BudgetIdentityToken,
  "ownerId" | "coupleId" | "stateRevision"
>;

export function isBudgetEditBaseCurrent(
  base: BudgetEditBase | null,
  identity: BudgetEditBase | BudgetIdentityToken | BudgetMutationToken | null,
): boolean;

export interface BudgetRevisionCoordinator {
  setOwner(ownerId: string | null): boolean;
  beginLoad(
    expectedOwnerId: string,
    authorizedMutationToken?: BudgetMutationToken,
  ): BudgetLoadToken | null;
  isLoadCurrent(token: BudgetLoadToken | null): boolean;
  commitJourney(
    token: BudgetLoadToken | null,
    rawJourney: unknown,
    expectedCoupleId?: string,
  ): BudgetIdentityToken | null;
  captureIdentity(): BudgetIdentityToken | null;
  isCurrent(token: BudgetIdentityToken | BudgetMutationToken | null): boolean;
  beginMutation(kind: "total" | "category"): BudgetMutationToken | null;
  finishMutation(token: BudgetMutationToken | null): boolean;
  commitApplied(
    token: BudgetMutationToken | null,
    journey: BudgetJourneySnapshot,
  ): BudgetIdentityToken | null;
  commitObservedApplied(
    token: BudgetIdentityToken | null,
    journey: BudgetJourneySnapshot,
    baseRevision: number,
  ): BudgetIdentityToken | null;
}

export function createBudgetRevisionCoordinator(): BudgetRevisionCoordinator;
