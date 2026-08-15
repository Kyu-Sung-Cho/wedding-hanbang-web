import { parseAmoraCoupleCriterionResponse } from "@hanbang/shared/amora-couple-criterion";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function isUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function getAmoraCoupleCriterionView(value, ownerUserId) {
  const parsed = parseAmoraCoupleCriterionResponse(value);
  if (!parsed || !isUuid(ownerUserId)) return null;
  const normalizedOwner = ownerUserId.toLowerCase();
  if (!parsed.linked) {
    return Object.freeze({
      status: "unlinked",
      currentValue: null,
      proposalValue: null,
      canPropose: false,
      canAccept: false,
      canCancel: false,
    });
  }
  if (!parsed.proposal) {
    return Object.freeze({
      status: parsed.current ? "confirmed" : "empty",
      currentValue: parsed.current?.value ?? null,
      proposalValue: null,
      canPropose: true,
      canAccept: false,
      canCancel: false,
    });
  }
  if (
    normalizedOwner !== parsed.proposal.brideUserId
    && normalizedOwner !== parsed.proposal.groomUserId
  ) return null;
  const isProposer = normalizedOwner === parsed.proposal.proposerUserId;
  return Object.freeze({
    status: isProposer ? "waiting_partner" : "review_required",
    currentValue: parsed.current?.value ?? null,
    proposalValue: parsed.proposal.value,
    canPropose: false,
    canAccept: !isProposer,
    canCancel: isProposer,
  });
}

export async function loadOwnerAmoraCoupleCriterion(
  ownerUserId,
  expectedCoupleId,
  fetchForExpectedUser,
) {
  if (
    !isUuid(ownerUserId)
    || !isUuid(expectedCoupleId)
    || typeof fetchForExpectedUser !== "function"
  ) return Object.freeze({ loaded: false, value: null });

  try {
    const response = await fetchForExpectedUser(
      ownerUserId,
      "/api/amora/couple-criterion",
      { method: "GET", headers: { Accept: "application/json" } },
    );
    const payload = await response.json().catch(() => null);
    const parsed = response.ok ? parseAmoraCoupleCriterionResponse(payload) : null;
    return parsed?.coupleId === expectedCoupleId.toLowerCase()
      ? Object.freeze({ loaded: true, value: parsed })
      : Object.freeze({ loaded: false, value: null });
  } catch {
    return Object.freeze({ loaded: false, value: null });
  }
}
