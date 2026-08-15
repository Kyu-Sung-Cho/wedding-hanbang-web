export const MEDIATION_FOLLOW_UP_SAFETY_VERSION = 1 as const;

export interface ClearMediationFollowUpSafetyMarker {
  version: typeof MEDIATION_FOLLOW_UP_SAFETY_VERSION;
  violence: false;
  coercion: false;
  privateSafetyHold: false;
  contextComplete: true;
}

interface BuildMediationFollowUpSafetyMarkerInput {
  requestKind: string;
  questionScope: string;
  hasScreenedMediationCard: boolean;
}

const CLEAR_MARKER: ClearMediationFollowUpSafetyMarker = Object.freeze({
  version: MEDIATION_FOLLOW_UP_SAFETY_VERSION,
  violence: false,
  coercion: false,
  privateSafetyHold: false,
  contextComplete: true,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>): boolean {
  const expected = new Set([
    "version",
    "violence",
    "coercion",
    "privateSafetyHold",
    "contextComplete",
  ]);
  return Object.keys(value).every((key) => expected.has(key))
    && Object.keys(value).length === expected.size;
}

export function buildMediationFollowUpSafetyMarker({
  requestKind,
  questionScope,
  hasScreenedMediationCard,
}: BuildMediationFollowUpSafetyMarkerInput): ClearMediationFollowUpSafetyMarker | null {
  if (
    requestKind !== "mediation"
    || questionScope !== "W1_wedding_adjacent"
    || !hasScreenedMediationCard
  ) return null;
  return { ...CLEAR_MARKER };
}

export function readClearMediationFollowUpSafetyMarker(
  value: unknown,
): ClearMediationFollowUpSafetyMarker | null {
  if (
    !isRecord(value)
    || !hasOnlyKeys(value)
    || value.version !== MEDIATION_FOLLOW_UP_SAFETY_VERSION
    || value.violence !== false
    || value.coercion !== false
    || value.privateSafetyHold !== false
    || value.contextComplete !== true
  ) return null;
  return { ...CLEAR_MARKER };
}
