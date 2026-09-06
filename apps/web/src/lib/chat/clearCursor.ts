import { compareChatTimestamps } from "@hanbang/shared";

/**
 * Resolve an accepted shared-chat clear cursor without ever moving an already
 * applied cursor backwards. The RPC-authored value is canonical; the request
 * message timestamp exists only for compatibility with pre-RPC rows.
 */
export function resolveMonotonicSharedClearCursor(input: {
  currentClearedAt?: string | null;
  rpcClearedAt?: string | null;
  requestCreatedAt: string;
}): string {
  const rpcTimestamp = input.rpcClearedAt ? Date.parse(input.rpcClearedAt) : NaN;
  const requestTimestamp = Date.parse(input.requestCreatedAt);
  const candidate = Number.isFinite(rpcTimestamp)
    ? input.rpcClearedAt!
    : input.requestCreatedAt;
  const candidateTimestamp = Number.isFinite(rpcTimestamp)
    ? rpcTimestamp
    : requestTimestamp;
  const currentTimestamp = input.currentClearedAt
    ? Date.parse(input.currentClearedAt)
    : NaN;

  if (
    Number.isFinite(currentTimestamp) &&
    (!Number.isFinite(candidateTimestamp) || compareChatTimestamps(input.currentClearedAt!, candidate) === 1)
  ) {
    return input.currentClearedAt!;
  }
  return candidate;
}
