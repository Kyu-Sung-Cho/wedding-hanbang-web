export declare const SHARED_ACTION_ACTOR_MISMATCH: "AMORA_SHARED_ACTION_ACTOR_MISMATCH";

/**
 * Throws `SHARED_ACTION_ACTOR_MISMATCH` unless both values are user ids and
 * refer to the same person. Call it before sending a shared-action request so a
 * mid-flight account switch cannot record someone else's approval.
 */
export declare function assertSharedActionActor(
  expectedUserId: unknown,
  sessionUserId: unknown,
): void;
