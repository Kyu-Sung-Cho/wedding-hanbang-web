export type AmoraMediationSummaryResult =
  | { ok: true; summary: string }
  | { ok: false; reason: "invalid" | "too_short" | "too_long" };

export function normalizeAmoraMediationSummary(
  value: unknown,
): AmoraMediationSummaryResult;

export interface AmoraMediationRequestInput {
  summary: string;
  senderRole: "bride" | "groom";
  senderName: string;
  memberModelVersion?: 1 | 2;
  coupleId: string;
  clientRequestId: string;
}

export interface AmoraMediationRequestBody {
  messages: Array<{ role: "user"; content: string }>;
  coupleId: string;
  senderName: string;
  clientRequestId: string;
  requestKind: "mediation";
  conflictContext: string;
  visibility: "shared";
}

export function buildAmoraMediationRequestBody(
  input: AmoraMediationRequestInput,
): AmoraMediationRequestBody;

export interface AmoraMediationDismissalOwner {
  userId: string;
  coupleId: string;
  nowMs?: number;
}

export function createAmoraMediationDismissalRecord(
  input: AmoraMediationDismissalOwner & { offerKeys: string[] },
): string;

export function parseAmoraMediationDismissalRecord(
  raw: unknown,
  expected: AmoraMediationDismissalOwner,
): string[];
