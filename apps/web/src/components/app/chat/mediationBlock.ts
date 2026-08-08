import {
  AMORA_USER_REQUESTED_MEDIATION_V2,
  readUserRequestedMediationV2,
} from "@/lib/ai/mediation";

export interface MediationBlock {
  empathy?: string;
  translation?: string;
  data?: string;
  resolution?: string;
  origin?: "user_requested";
  evidenceScope?: "requester_summary_only";
  schemaVersion?: 2;
  proposalVersion?: string;
  rosterFingerprint?: string;
}

export interface ExpectedMediationRevision {
  expectedProposalVersion: string;
  expectedRosterFingerprint: string;
}

const MAX_FIELD_LENGTH = 2_000;
const MAX_RESOLUTION_LENGTH = 500;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROSTER_FINGERPRINT_PATTERN = /^[a-f0-9]{32}$/;

function normalizedField(value: unknown, maxLength = MAX_FIELD_LENGTH): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) return undefined;
  return normalized;
}

export function normalizeMediationBlock(value: unknown): MediationBlock | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const block: MediationBlock = {
    empathy: normalizedField(candidate.empathy),
    translation: normalizedField(candidate.translation),
    data: normalizedField(candidate.data),
    resolution: normalizedField(candidate.resolution, MAX_RESOLUTION_LENGTH),
    origin: candidate.origin === AMORA_USER_REQUESTED_MEDIATION_V2.origin
      ? AMORA_USER_REQUESTED_MEDIATION_V2.origin
      : undefined,
    evidenceScope:
      candidate.evidenceScope === AMORA_USER_REQUESTED_MEDIATION_V2.evidenceScope
        ? AMORA_USER_REQUESTED_MEDIATION_V2.evidenceScope
        : undefined,
    schemaVersion:
      candidate.schemaVersion === AMORA_USER_REQUESTED_MEDIATION_V2.schemaVersion
        ? AMORA_USER_REQUESTED_MEDIATION_V2.schemaVersion
        : undefined,
    proposalVersion: typeof candidate.proposalVersion === "string"
      && UUID_PATTERN.test(candidate.proposalVersion)
      ? candidate.proposalVersion.toLowerCase()
      : undefined,
    rosterFingerprint: typeof candidate.rosterFingerprint === "string"
      && ROSTER_FINGERPRINT_PATTERN.test(candidate.rosterFingerprint)
      ? candidate.rosterFingerprint
      : undefined,
  };

  return Object.values(block).some(Boolean) ? block : null;
}

export function getExpectedMediationRevision(
  block: MediationBlock,
): ExpectedMediationRevision | null {
  if (
    !isRequesterSummaryMediationV2(block)
    || typeof block.proposalVersion !== "string"
    || !UUID_PATTERN.test(block.proposalVersion)
    || typeof block.rosterFingerprint !== "string"
    || !ROSTER_FINGERPRINT_PATTERN.test(block.rosterFingerprint)
  ) return null;

  return {
    expectedProposalVersion: block.proposalVersion.toLowerCase(),
    expectedRosterFingerprint: block.rosterFingerprint,
  };
}

export function isRequesterSummaryMediationV2(block: MediationBlock): boolean {
  return readUserRequestedMediationV2(block) !== null;
}
