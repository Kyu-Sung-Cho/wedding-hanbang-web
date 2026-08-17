export type PreparationTopicVendorBookingErrorCode =
  | "invalid_request"
  | "invalid_roster"
  | "invalid_response"
  | "read_failed"
  | "stale_context"
  | "timeout"
  | "cancelled";

export declare class PreparationTopicVendorBookingError extends Error {
  readonly code: PreparationTopicVendorBookingErrorCode;
  constructor(code: PreparationTopicVendorBookingErrorCode);
}

export interface PreparationTopicVendorBookingReadContext {
  readonly ownerId: string;
  readonly coupleId: string;
  readonly signal: AbortSignal;
}

export interface PreparationTopicVendorBookingDecisionReadContext
  extends PreparationTopicVendorBookingReadContext {
  readonly limit: 81;
}

export interface PreparationTopicVendorBookingRowsReadContext
  extends PreparationTopicVendorBookingReadContext {
  readonly bookingIds: readonly string[];
}

export type PreparationTopicVendorBookingRosterReader = (
  context: PreparationTopicVendorBookingReadContext,
) => Promise<unknown>;

export type PreparationTopicVendorBookingDecisionReader = (
  context: PreparationTopicVendorBookingDecisionReadContext,
) => Promise<unknown>;

export type PreparationTopicVendorBookingRowsReader = (
  context: PreparationTopicVendorBookingRowsReadContext,
) => Promise<unknown>;

export interface PreparationTopicVendorBookingReadResult {
  readonly currentCoupleMemberIds: readonly string[];
  readonly vendorBookingDecisionReceipts: readonly unknown[];
  readonly vendorBookings: readonly unknown[];
  readonly partial: boolean;
}

export declare function loadPreparationTopicVendorBookings(options: {
  ownerId: string;
  coupleId: string;
  isCurrent: () => boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
  readCoupleRoster: PreparationTopicVendorBookingRosterReader;
  readDecisionRows: PreparationTopicVendorBookingDecisionReader;
  readBookingRows: PreparationTopicVendorBookingRowsReader;
}): Promise<PreparationTopicVendorBookingReadResult>;
