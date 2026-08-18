import type { AmoraSourceDisclosure } from "./amoraSourceDisclosure.mjs";

export const AMORA_OFFICIAL_REFERENCE_SCOPE_CONTRACT_VERSION: 1;

export type AmoraOfficialReferenceId = "kca_wedding_service_price_2025_11";

export type AmoraOfficialReferenceRegionScope =
  | "national"
  | "seoul"
  | "gyeonggi_incheon"
  | "busan"
  | "daegu"
  | "other_regions";

export type AmoraOfficialReferenceApplicabilityKey = "studio" | "dress" | "makeup";

export interface AmoraOfficialReferenceScopeInput {
  version: 1;
  referenceId: AmoraOfficialReferenceId;
  regionScope: AmoraOfficialReferenceRegionScope;
  applicabilityKey: AmoraOfficialReferenceApplicabilityKey;
  asOfDate: string;
}

export interface AmoraOfficialReferenceScope {
  version: 1;
  referenceId: AmoraOfficialReferenceId;
  sourceDisclosure: Readonly<AmoraSourceDisclosure>;
  sourceName: "한국소비자원 참가격";
  sourceUrl: "https://price.go.kr/tprice/portal/board/boardInfoMgr.do?boardTypeCode=0090000122";
  sourcePeriod: "2025-11";
  sourcePeriodLabel: "2025년 11월";
  regionScope: AmoraOfficialReferenceRegionScope;
  regionLabel: string;
  applicabilityKey: AmoraOfficialReferenceApplicabilityKey;
  applicabilityScopeLabel: string;
  referenceEffect: "context_only";
}

export function buildAmoraOfficialReferenceScope(
  value: unknown,
): Readonly<AmoraOfficialReferenceScope> | null;

export function parseAmoraOfficialReferenceScope(
  value: unknown,
  asOfDate: unknown,
): Readonly<AmoraOfficialReferenceScope> | null;
