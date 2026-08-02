export type MobileAuthIdentitySnapshot =
  | { status: "verifying" | "error"; userId: null; generation: number }
  | { status: "anonymous"; userId: null; generation: number }
  | { status: "authenticated"; userId: string; generation: number };

export type MobileAuthIdentityExpectation = {
  userId: string;
  generation: number;
};

type MobileAuthIdentityListener = () => void;

const listeners = new Set<MobileAuthIdentityListener>();

let snapshot: MobileAuthIdentitySnapshot = {
  status: "verifying",
  userId: null,
  generation: 0,
};
let pendingUserId: string | null | undefined;

function normalizeUserId(userId: string | null | undefined): string | null {
  return typeof userId === "string" && userId.length > 0 ? userId : null;
}

function publish(next: MobileAuthIdentitySnapshot): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

export function getMobileAuthIdentitySnapshot(): MobileAuthIdentitySnapshot {
  return snapshot;
}

export function subscribeMobileAuthIdentity(listener: MobileAuthIdentityListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Synchronously invalidates every expectation owned by the previous account.
 * The root navigator observes the verifying snapshot and removes the protected
 * tree before the candidate session is verified asynchronously.
 */
export function beginMobileAuthIdentityTransition(
  candidateUserId: string | null | undefined,
): {
  changed: boolean;
  generation: number;
  previousUserId: string | null;
  candidateUserId: string | null;
} {
  const candidate = normalizeUserId(candidateUserId);
  const previousUserId = snapshot.status === "authenticated" ? snapshot.userId : null;
  const alreadyResolved = (
    snapshot.status === "authenticated" && snapshot.userId === candidate
  ) || (
    snapshot.status === "anonymous" && candidate === null
  );
  const alreadyVerifying = snapshot.status === "verifying" && pendingUserId === candidate;

  if (alreadyResolved || alreadyVerifying) {
    return {
      changed: false,
      generation: snapshot.generation,
      previousUserId,
      candidateUserId: candidate,
    };
  }

  pendingUserId = candidate;
  const generation = snapshot.generation + 1;
  publish({ status: "verifying", userId: null, generation });
  return { changed: true, generation, previousUserId, candidateUserId: candidate };
}

export function completeMobileAuthIdentityTransition(
  generation: number,
  verifiedUserId: string | null | undefined,
): boolean {
  const verified = normalizeUserId(verifiedUserId);
  if (
    snapshot.status !== "verifying"
    || snapshot.generation !== generation
    || pendingUserId !== verified
  ) {
    return false;
  }

  pendingUserId = undefined;
  publish(verified
    ? { status: "authenticated", userId: verified, generation }
    : { status: "anonymous", userId: null, generation });
  return true;
}

export function failMobileAuthIdentityTransition(generation: number): boolean {
  if (snapshot.status !== "verifying" || snapshot.generation !== generation) return false;
  pendingUserId = undefined;
  publish({ status: "error", userId: null, generation });
  return true;
}

export function captureMobileAuthIdentityExpectation(
  expectedUserId?: string,
): MobileAuthIdentityExpectation | null {
  if (snapshot.status !== "authenticated") return null;
  if (expectedUserId !== undefined && snapshot.userId !== expectedUserId) return null;
  return { userId: snapshot.userId, generation: snapshot.generation };
}

export function isCurrentMobileAuthIdentity(
  expectation: MobileAuthIdentityExpectation | null | undefined,
): expectation is MobileAuthIdentityExpectation {
  return Boolean(expectation)
    && snapshot.status === "authenticated"
    && snapshot.userId === expectation?.userId
    && snapshot.generation === expectation?.generation;
}

export function mobileAuthNavigationKey(identity: MobileAuthIdentitySnapshot): string {
  if (identity.status === "authenticated") {
    return `mobile-user:${identity.userId}:${identity.generation}`;
  }
  return `mobile-${identity.status}:${identity.generation}`;
}

/** Reset module state when the global listener is disposed or hot-reloaded. */
export function resetMobileAuthIdentityBoundary(): void {
  pendingUserId = undefined;
  publish({
    status: "verifying",
    userId: null,
    generation: snapshot.generation + 1,
  });
}
