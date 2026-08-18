export const AMORA_SOURCE_DISCLOSURE_CONTRACT_VERSION: 1;

export type AmoraSourceDisclosureType =
  | "canonical_record"
  | "amora_proposal"
  | "reviewed_guidance"
  | "official_reference"
  | "vendor_public_info"
  | "community_experience"
  | "sponsored_placement";

export type AmoraSourceCommercialRelationship =
  | "none"
  | "source_vendor"
  | "paid_advertisement"
  | "sponsored_benefit"
  | "vendor_affiliation"
  | "unknown";

export type AmoraSourceDisclosureStateEffect =
  | "already_recorded"
  | "requires_user_confirmation"
  | "none";

export interface AmoraSourceDisclosureInput {
  version: 1;
  sourceType: AmoraSourceDisclosureType;
  commercialRelationship: AmoraSourceCommercialRelationship;
  checkedAt: string | null;
  asOfDate: string;
}

export interface AmoraSourceDisclosure {
  version: 1;
  sourceType: AmoraSourceDisclosureType;
  commercialRelationship: AmoraSourceCommercialRelationship;
  checkedAt: string | null;
  badgeLabel: string;
  statusLabel: string;
  commercialRelationshipLabel: string;
  checkedAtLabel: string | null;
  limitation: string;
  stateEffect: AmoraSourceDisclosureStateEffect;
  rankingPolicy: "disclosure_only";
}

export function buildAmoraSourceDisclosure(
  value: unknown,
): Readonly<AmoraSourceDisclosure> | null;

export function parseAmoraSourceDisclosure(
  value: unknown,
  asOfDate: unknown,
): Readonly<AmoraSourceDisclosure> | null;
