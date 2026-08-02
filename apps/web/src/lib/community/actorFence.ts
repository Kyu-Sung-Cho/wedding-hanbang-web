import {
  EXPECTED_ACTOR_HEADER,
  expectedActorHeaders,
  requestMatchesExpectedActor,
} from "@/lib/auth/actorFence";

export const EXPECTED_COMMUNITY_ACTOR_HEADER = EXPECTED_ACTOR_HEADER;

export type CurrentCommunityActor = {
  actorKey: string;
  kind: string;
  userId: string | null;
};

export class CommunityActorChangedError extends Error {
  constructor() {
    super("COMMUNITY_ACTOR_CHANGED");
    this.name = "CommunityActorChangedError";
  }
}

export function expectedCommunityActorHeaders(userId: string): Record<string, string> {
  return expectedActorHeaders(userId);
}

export function requestMatchesExpectedCommunityActor(
  request: Pick<Request, "headers">,
  authenticatedUserId: string,
): boolean {
  return requestMatchesExpectedActor(request, authenticatedUserId);
}

/**
 * Verify the actor both before and after the asynchronous Supabase user check.
 * The operation must also send the expected-actor header so the server closes
 * the final cookie-swap race between this check and request dispatch.
 */
export async function runWithExpectedCommunityActor<T>({
  expectedActorKey,
  expectedUserId,
  getCurrentActor,
  getVerifiedUserId,
  operation,
}: {
  expectedActorKey: string;
  expectedUserId: string;
  getCurrentActor: () => CurrentCommunityActor | null;
  getVerifiedUserId: () => Promise<string | null>;
  operation: () => Promise<T>;
}): Promise<T> {
  const matches = () => {
    const current = getCurrentActor();
    return current?.actorKey === expectedActorKey
      && current.kind === "user"
      && current.userId === expectedUserId;
  };

  if (!matches()) throw new CommunityActorChangedError();
  const verifiedUserId = await getVerifiedUserId();
  if (verifiedUserId !== expectedUserId || !matches()) {
    throw new CommunityActorChangedError();
  }
  const result = await operation();
  if (!matches()) throw new CommunityActorChangedError();
  return result;
}
