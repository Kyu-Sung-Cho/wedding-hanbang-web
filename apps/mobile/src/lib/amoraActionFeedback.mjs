import {
  validateAmoraActionOutcomeFeedbackResponse,
} from "@hanbang/shared/amora-action-outcome-feedback";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export async function loadOwnerAmoraActionOutcomeFeedback(
  ownerUserId,
  coupleId,
  fetchForExpectedUser,
  nowMs = Date.now(),
) {
  if (
    typeof ownerUserId !== "string"
    || !UUID_RE.test(ownerUserId)
    || typeof coupleId !== "string"
    || !UUID_RE.test(coupleId)
    || typeof fetchForExpectedUser !== "function"
    || !Number.isFinite(nowMs)
  ) return null;

  try {
    const response = await fetchForExpectedUser(
      ownerUserId,
      "/api/amora/action-feedback",
      {
        method: "GET",
        headers: { Accept: "application/json" },
      },
    );
    const payload = await response.json().catch(() => null);
    if (!response.ok) return null;
    const validated = validateAmoraActionOutcomeFeedbackResponse(
      payload,
      ownerUserId,
      coupleId,
      nowMs,
    );
    if (!validated.ok || validated.value.state !== "ready") return null;
    return Object.freeze({ ...validated.value.feedback });
  } catch {
    return null;
  }
}
