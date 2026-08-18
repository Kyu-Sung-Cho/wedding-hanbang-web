import { buildAmoraSourceDisclosure } from "./amoraSourceDisclosure.mjs";

export const AMORA_OFFICIAL_REFERENCE_SCOPE_CONTRACT_VERSION = 1;

const INPUT_KEYS = Object.freeze([
  "version",
  "referenceId",
  "regionScope",
  "applicabilityKey",
  "asOfDate",
]);

const OUTPUT_KEYS = Object.freeze([
  "version",
  "referenceId",
  "sourceDisclosure",
  "sourceName",
  "sourceUrl",
  "sourcePeriod",
  "sourcePeriodLabel",
  "regionScope",
  "regionLabel",
  "applicabilityKey",
  "applicabilityScopeLabel",
  "referenceEffect",
]);

const REFERENCES = Object.freeze({
  kca_wedding_service_price_2025_11: Object.freeze({
    sourceName: "한국소비자원 참가격",
    sourceUrl:
      "https://price.go.kr/tprice/portal/board/boardInfoMgr.do?boardTypeCode=0090000122",
    sourcePeriod: "2025-11",
    sourcePeriodLabel: "2025년 11월",
    checkedAt: "2026-07-27",
  }),
});

const REGION_LABELS = Object.freeze({
  national: "전국",
  seoul: "서울",
  gyeonggi_incheon: "경기/인천",
  busan: "부산",
  daegu: "대구",
  other_regions: "기타 지역",
});

const APPLICABILITY_LABELS = Object.freeze({
  studio: "사진 촬영 공시 기본가 하한 참고",
  dress: "웨딩드레스 공시 기본가 하한 참고",
  makeup: "헤어·메이크업 공시 기본가 하한 참고",
});

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

export function buildAmoraOfficialReferenceScope(value) {
  if (!isRecord(value) || !hasExactKeys(value, INPUT_KEYS)) return null;
  if (value.version !== AMORA_OFFICIAL_REFERENCE_SCOPE_CONTRACT_VERSION) return null;
  if (!Object.prototype.hasOwnProperty.call(REFERENCES, value.referenceId)) return null;
  if (!Object.prototype.hasOwnProperty.call(REGION_LABELS, value.regionScope)) return null;
  if (!Object.prototype.hasOwnProperty.call(APPLICABILITY_LABELS, value.applicabilityKey)) {
    return null;
  }

  const reference = REFERENCES[value.referenceId];
  const sourceDisclosure = buildAmoraSourceDisclosure({
    version: 1,
    sourceType: "official_reference",
    commercialRelationship: "none",
    checkedAt: reference.checkedAt,
    asOfDate: value.asOfDate,
  });
  if (!sourceDisclosure) return null;

  return Object.freeze({
    version: AMORA_OFFICIAL_REFERENCE_SCOPE_CONTRACT_VERSION,
    referenceId: value.referenceId,
    sourceDisclosure,
    sourceName: reference.sourceName,
    sourceUrl: reference.sourceUrl,
    sourcePeriod: reference.sourcePeriod,
    sourcePeriodLabel: reference.sourcePeriodLabel,
    regionScope: value.regionScope,
    regionLabel: REGION_LABELS[value.regionScope],
    applicabilityKey: value.applicabilityKey,
    applicabilityScopeLabel: APPLICABILITY_LABELS[value.applicabilityKey],
    referenceEffect: "context_only",
  });
}

export function parseAmoraOfficialReferenceScope(value, asOfDate) {
  if (!isRecord(value) || !hasExactKeys(value, OUTPUT_KEYS)) return null;
  const canonical = buildAmoraOfficialReferenceScope({
    version: value.version,
    referenceId: value.referenceId,
    regionScope: value.regionScope,
    applicabilityKey: value.applicabilityKey,
    asOfDate,
  });
  if (!canonical) return null;
  return OUTPUT_KEYS.every((key) => {
    if (key !== "sourceDisclosure") return value[key] === canonical[key];
    if (!isRecord(value.sourceDisclosure)) return false;
    return Object.keys(canonical.sourceDisclosure).every(
      (nestedKey) => value.sourceDisclosure[nestedKey] === canonical.sourceDisclosure[nestedKey],
    ) && Object.keys(value.sourceDisclosure).length === Object.keys(canonical.sourceDisclosure).length;
  })
    ? canonical
    : null;
}
