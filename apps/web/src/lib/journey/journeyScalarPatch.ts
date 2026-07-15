import { cleanOptionalIsoDate, isRecord } from "@/utils/requestValidation";

const ALLOWED_FIELDS = new Set(["wedding_date", "total_budget", "venue"]);
const MAX_TOTAL_BUDGET_WON = 10_000_000_000;
const MAX_VENUE_LENGTH = 120;
const CONTROL_CHARACTER_RE = /[\u0000-\u001f\u007f]/;

export interface JourneyScalarPatch {
  wedding_date?: string | null;
  total_budget?: number;
  venue?: string | null;
}

export function parseJourneyScalarPatch(body: unknown): JourneyScalarPatch | null {
  if (!isRecord(body)) return null;

  const keys = Object.keys(body);
  if (keys.length === 0 || keys.some((field) => !ALLOWED_FIELDS.has(field))) {
    return null;
  }

  const patch: JourneyScalarPatch = {};

  if (Object.hasOwn(body, "wedding_date")) {
    const weddingDate = cleanOptionalIsoDate(body.wedding_date);
    if (weddingDate === undefined) return null;
    patch.wedding_date = weddingDate;
  }

  if (Object.hasOwn(body, "total_budget")) {
    if (
      typeof body.total_budget !== "number" ||
      !Number.isSafeInteger(body.total_budget) ||
      body.total_budget < 0 ||
      body.total_budget > MAX_TOTAL_BUDGET_WON
    ) {
      return null;
    }
    patch.total_budget = body.total_budget;
  }

  if (Object.hasOwn(body, "venue")) {
    if (body.venue === null || body.venue === "") {
      patch.venue = null;
    } else {
      if (
        typeof body.venue !== "string" ||
        body.venue.length > MAX_VENUE_LENGTH ||
        CONTROL_CHARACTER_RE.test(body.venue)
      ) {
        return null;
      }
      const venue = body.venue.trim();
      patch.venue = venue.length > 0 ? venue : null;
    }
  }

  return patch;
}
