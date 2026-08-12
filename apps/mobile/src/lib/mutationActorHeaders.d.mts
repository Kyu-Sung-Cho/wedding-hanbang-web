export const API_MUTATION_ACTOR_HEADER_MISMATCH:
  "API_MUTATION_ACTOR_HEADER_MISMATCH";

export interface MutationActorHeaderContract {
  version: string;
  versionHeader: string;
  actorHeader: string;
}

export function bindExpectedMutationActorHeaders(
  input: HeadersInit | undefined,
  expectedUserId: string,
  contract: MutationActorHeaderContract,
): Headers;
