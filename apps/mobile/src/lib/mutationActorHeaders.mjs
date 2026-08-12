/* global Headers */

export const API_MUTATION_ACTOR_HEADER_MISMATCH =
  "API_MUTATION_ACTOR_HEADER_MISMATCH";
const USER_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function hasAsciiControlCharacter(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || (code >= 127 && code <= 159)) return true;
  }
  return false;
}

function isSafeHeaderContractValue(value) {
  return typeof value === "string"
    && value.length > 0
    && value.trim() === value
    && !hasAsciiControlCharacter(value);
}

/**
 * The expected-user transport owns these headers. A caller may redundantly
 * supply the same pair during rollout, but can never replace its owner or
 * downgrade the contract version.
 */
export function bindExpectedMutationActorHeaders(
  input,
  expectedUserId,
  contract,
) {
  const normalizedExpectedUserId = typeof expectedUserId === "string"
    ? expectedUserId.trim().toLowerCase()
    : "";
  if (
    !isSafeHeaderContractValue(expectedUserId)
    || !USER_ID_PATTERN.test(normalizedExpectedUserId)
    || !contract
    || !isSafeHeaderContractValue(contract.version)
    || !isSafeHeaderContractValue(contract.versionHeader)
    || !isSafeHeaderContractValue(contract.actorHeader)
  ) {
    throw new Error(API_MUTATION_ACTOR_HEADER_MISMATCH);
  }

  const headers = new Headers(input);
  const suppliedVersion = headers.get(contract.versionHeader);
  const suppliedActor = headers.get(contract.actorHeader);
  if (
    (suppliedVersion !== null && suppliedVersion !== contract.version)
    || (
      suppliedActor !== null
      && suppliedActor.trim().toLowerCase() !== normalizedExpectedUserId
    )
  ) {
    throw new Error(API_MUTATION_ACTOR_HEADER_MISMATCH);
  }

  headers.set(contract.versionHeader, contract.version);
  headers.set(contract.actorHeader, normalizedExpectedUserId);
  return headers;
}
