export type MediationOutcome = "resolved" | "changed" | "blocked" | "stop";

export interface MediationOutcomeCardIdentity {
  id: string;
  revision: number;
  sourceDigest: string;
  outcomeIdempotencyKey: string;
}

export interface MediationOutcomeBody {
  cardId: string;
  cardRevision: number;
  sourceDigest: string;
  outcome: MediationOutcome;
  idempotencyKey: string;
}

export interface MediationOutcomeContext {
  ownerUserId: string;
  coupleId: string;
  sessionGeneration: number;
}

export declare function buildMediationOutcomeBody(
  card: unknown,
  outcome: unknown,
): MediationOutcomeBody | null;
export declare function isCurrentMediationOutcomeContext(
  captured: unknown,
  current: unknown,
): current is MediationOutcomeContext;
export declare function matchCanonicalMediationOutcomeReceipt<T>(
  posted: unknown,
  reread: T,
): T | null;
export declare function isReceiptForMediationOutcomeRequest(
  receipt: unknown,
  request: unknown,
): boolean;
export declare function isMediationOutcomeCardAdvanced(
  previousCard: unknown,
  refreshed: unknown,
): boolean;
export declare function resolveMediationOutcomeSurface(
  status: number,
  validatedState: "ready" | "none" | null,
): "ready" | "fallback";
