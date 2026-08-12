/**
 * Rollout-safe actor binding for account-owned mutations.
 *
 * Headers are additive so an updated client can still talk to a legacy server.
 * During Phase A, an updated server accepts headerless legacy clients; Phase B
 * may require this exact contract only after supported-fleet drain evidence.
 */
export const HANBANG_MUTATION_CONTRACT_VERSION = "2" as const;
export const HANBANG_MUTATION_CONTRACT_VERSION_HEADER =
  "X-Hanbang-Mutation-Contract-Version" as const;
export const HANBANG_EXPECTED_ACTOR_USER_ID_HEADER =
  "X-Hanbang-Expected-Actor-User-Id" as const;
