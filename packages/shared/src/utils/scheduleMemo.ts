const LEGACY_BOOKING_MEMO_ID_PATTERN =
  /^(예약 자동 등록)\s*·\s*booking\s+[0-9a-f-]{8,36}(?=\s*(?:·|$))/iu;

/**
 * Removes only the internal identifier emitted by the retired booking
 * projection memo format. User-authored text and any useful amount suffix are
 * preserved across web and mobile clients.
 */
export function sanitizeUserFacingScheduleMemo(
  memo: string | null | undefined,
): string | undefined {
  return memo == null
    ? undefined
    : memo.replace(LEGACY_BOOKING_MEMO_ID_PATTERN, "$1");
}
