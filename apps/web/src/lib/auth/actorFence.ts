export const EXPECTED_ACTOR_HEADER = "x-hanbang-expected-actor";

/**
 * Attach the identity that owned a UI mutation when it was initiated. The
 * server compares it with the freshly authenticated request user, closing the
 * cookie-swap race between a client-side actor check and request dispatch.
 * The header stays optional so native and older clients remain compatible.
 */
export function expectedActorHeaders(userId: string): Record<string, string> {
  return { [EXPECTED_ACTOR_HEADER]: userId };
}

export function requestMatchesExpectedActor(
  request: Pick<Request, "headers">,
  authenticatedUserId: string,
): boolean {
  const expected = request.headers.get(EXPECTED_ACTOR_HEADER);
  return expected === null || expected === authenticatedUserId;
}
