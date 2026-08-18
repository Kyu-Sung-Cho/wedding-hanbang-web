export const AMORA_SOURCE_DISCLOSURE_CONTRACT_VERSION = 1;

const INPUT_KEYS = Object.freeze([
  "version",
  "sourceType",
  "commercialRelationship",
  "checkedAt",
  "asOfDate",
]);

const OUTPUT_KEYS = Object.freeze([
  "version",
  "sourceType",
  "commercialRelationship",
  "checkedAt",
  "badgeLabel",
  "statusLabel",
  "commercialRelationshipLabel",
  "checkedAtLabel",
  "limitation",
  "stateEffect",
  "rankingPolicy",
]);

const SOURCE_PRESENTATIONS = Object.freeze({
  canonical_record: Object.freeze({
    badgeLabel: "확인·저장한 준비 기록",
    statusLabel: "준비에 반영된 기록",
    limitation: "사용자가 확인해 저장한 기록이에요. 현재 상태가 바뀌면 최신 기록을 다시 확인해요.",
    stateEffect: "already_recorded",
    checkedAtSuffix: null,
    checkedAtRequired: false,
    allowedCommercialRelationships: Object.freeze(["none"]),
  }),
  amora_proposal: Object.freeze({
    badgeLabel: "아모라 제안",
    statusLabel: "아직 준비에 반영 전",
    limitation: "사용자가 확인하고 승인하기 전에는 일정·예산·행동에 반영되지 않아요.",
    stateEffect: "requires_user_confirmation",
    checkedAtSuffix: null,
    checkedAtRequired: false,
    allowedCommercialRelationships: Object.freeze(["none"]),
  }),
  reviewed_guidance: Object.freeze({
    badgeLabel: "검수 가이드",
    statusLabel: "참고 정보",
    limitation: "검토한 범위 안의 확인 절차예요. 업체별 최신 서면과 직접 대조해야 해요.",
    stateEffect: "none",
    checkedAtSuffix: "검토",
    checkedAtRequired: true,
    allowedCommercialRelationships: Object.freeze(["none"]),
  }),
  official_reference: Object.freeze({
    badgeLabel: "공식 자료",
    statusLabel: "참고 정보",
    limitation: "표시된 확인일과 적용 범위 기준이에요. 중요한 내용은 최신 원문을 다시 확인해야 해요.",
    stateEffect: "none",
    checkedAtSuffix: "확인",
    checkedAtRequired: true,
    allowedCommercialRelationships: Object.freeze(["none"]),
  }),
  vendor_public_info: Object.freeze({
    badgeLabel: "업체 공개정보",
    statusLabel: "참고 정보",
    limitation: "업체가 공개한 정보예요. 품질·자격·예약·최종 가격을 보장하지 않아요.",
    stateEffect: "none",
    checkedAtSuffix: "확인",
    checkedAtRequired: true,
    allowedCommercialRelationships: Object.freeze(["source_vendor"]),
  }),
  community_experience: Object.freeze({
    badgeLabel: "다른 사용자 경험",
    statusLabel: "참고 정보",
    limitation: "한 사람의 경험이에요. 같은 결과나 일반적인 조건을 뜻하지 않아요.",
    stateEffect: "none",
    checkedAtSuffix: null,
    checkedAtRequired: false,
    allowedCommercialRelationships: Object.freeze([
      "none",
      "sponsored_benefit",
      "vendor_affiliation",
      "unknown",
    ]),
  }),
  sponsored_placement: Object.freeze({
    badgeLabel: "광고·혜택",
    statusLabel: "광고 정보",
    limitation: "광고 또는 혜택 관계가 있는 정보예요. 일반 추천 순위와 분리해 보여줘요.",
    stateEffect: "none",
    checkedAtSuffix: null,
    checkedAtRequired: false,
    allowedCommercialRelationships: Object.freeze([
      "paid_advertisement",
      "sponsored_benefit",
      "vendor_affiliation",
    ]),
  }),
});

const COMMERCIAL_RELATIONSHIP_LABELS = Object.freeze({
  none: "표시된 상업 관계 없음",
  source_vendor: "해당 업체가 공개한 정보",
  paid_advertisement: "유료 광고",
  sponsored_benefit: "제품·서비스·할인 혜택 있음",
  vendor_affiliation: "업체 이해관계 있음",
  unknown: "상업 관계 확인 안 됨",
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

function isIsoCalendarDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime())
    && parsed.toISOString().slice(0, 10) === value;
}

function formatCheckedAt(value, suffix) {
  return `${value.replaceAll("-", ".")} ${suffix}`;
}

export function buildAmoraSourceDisclosure(value) {
  if (!isRecord(value) || !hasExactKeys(value, INPUT_KEYS)) return null;
  if (value.version !== AMORA_SOURCE_DISCLOSURE_CONTRACT_VERSION) return null;
  if (!isIsoCalendarDate(value.asOfDate)) return null;
  if (!Object.prototype.hasOwnProperty.call(SOURCE_PRESENTATIONS, value.sourceType)) return null;
  if (
    !Object.prototype.hasOwnProperty.call(
      COMMERCIAL_RELATIONSHIP_LABELS,
      value.commercialRelationship,
    )
  ) return null;

  const presentation = SOURCE_PRESENTATIONS[value.sourceType];
  if (!presentation.allowedCommercialRelationships.includes(value.commercialRelationship)) {
    return null;
  }

  if (presentation.checkedAtRequired) {
    if (!isIsoCalendarDate(value.checkedAt) || value.checkedAt > value.asOfDate) return null;
  } else if (value.checkedAt !== null) {
    return null;
  }

  return Object.freeze({
    version: AMORA_SOURCE_DISCLOSURE_CONTRACT_VERSION,
    sourceType: value.sourceType,
    commercialRelationship: value.commercialRelationship,
    checkedAt: value.checkedAt,
    badgeLabel: presentation.badgeLabel,
    statusLabel: presentation.statusLabel,
    commercialRelationshipLabel:
      COMMERCIAL_RELATIONSHIP_LABELS[value.commercialRelationship],
    checkedAtLabel: presentation.checkedAtRequired
      ? formatCheckedAt(value.checkedAt, presentation.checkedAtSuffix)
      : null,
    limitation: presentation.limitation,
    stateEffect: presentation.stateEffect,
    rankingPolicy: "disclosure_only",
  });
}

export function parseAmoraSourceDisclosure(value, asOfDate) {
  if (!isRecord(value) || !hasExactKeys(value, OUTPUT_KEYS)) return null;
  const canonical = buildAmoraSourceDisclosure({
    version: value.version,
    sourceType: value.sourceType,
    commercialRelationship: value.commercialRelationship,
    checkedAt: value.checkedAt,
    asOfDate,
  });
  if (!canonical) return null;
  return OUTPUT_KEYS.every((key) => value[key] === canonical[key])
    ? canonical
    : null;
}
