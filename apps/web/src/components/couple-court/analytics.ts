import { captureEvent } from "@/lib/analytics";
import {
  COURT_CATEGORIES,
  type CoupleCourtEventName,
} from "@/lib/coupleCourt/types";

type CourtEvent = CoupleCourtEventName;

interface CourtEventProperties {
  mode?: unknown;
  category?: unknown;
  tone?: unknown;
  status?: unknown;
}

const MODES = new Set(["solo", "couple"]);
const CATEGORIES = new Set<string>(COURT_CATEGORIES);
const TONES = new Set(["gentle", "practical", "spicy"]);
const STATUSES = new Set([
  "initial", "revision", "statement", "verdict", "requested", "provisional", "bilateral",
  "accepted", "completed", "saved", "created", "awaiting_consents", "pending_review",
  "published", "shared", "copied", "downloaded", "followup", "normal", "sensitive",
  "high_risk", "applicant_more_at_fault", "partner_more_at_fault", "both_need_change",
  "need_more_info", "empathy", "experience", "practical_advice", "question",
]);

/**
 * Couple Court analytics must never receive ids, URLs, tokens, titles, free text,
 * or error messages. This runtime allowlist is intentionally stricter than the
 * generic telemetry sanitizer so future callers fail closed.
 */
export function captureCourtEvent(event: CourtEvent, properties?: CourtEventProperties) {
  const safe: Record<string, string> = {};
  if (typeof properties?.mode === "string" && MODES.has(properties.mode)) safe.mode = properties.mode;
  if (typeof properties?.category === "string" && CATEGORIES.has(properties.category)) safe.category = properties.category;
  if (typeof properties?.tone === "string" && TONES.has(properties.tone)) safe.tone = properties.tone;
  if (typeof properties?.status === "string" && STATUSES.has(properties.status)) safe.status = properties.status;
  captureEvent(event, safe);
}
