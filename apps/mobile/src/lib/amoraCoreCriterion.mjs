import { parseAmoraCoreCriterionResponse } from "@hanbang/shared/amora-core-criterion";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export async function loadOwnerAmoraCoreCriterion(ownerUserId, fetchForExpectedUser) {
  if (
    typeof ownerUserId !== "string"
    || !UUID_PATTERN.test(ownerUserId)
    || typeof fetchForExpectedUser !== "function"
  ) return Object.freeze({ loaded: false, criterion: null });

  try {
    const response = await fetchForExpectedUser(
      ownerUserId,
      "/api/amora/criterion",
      { method: "GET", headers: { Accept: "application/json" } },
    );
    const payload = await response.json().catch(() => null);
    const parsed = response.ok ? parseAmoraCoreCriterionResponse(payload) : null;
    return parsed
      ? Object.freeze({ loaded: true, criterion: parsed.criterion })
      : Object.freeze({ loaded: false, criterion: null });
  } catch {
    return Object.freeze({ loaded: false, criterion: null });
  }
}
