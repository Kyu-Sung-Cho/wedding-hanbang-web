import { describe, expect, it } from "vitest";

import {
  AMORA_OFFICIAL_REFERENCE_SCOPE_CONTRACT_VERSION,
  buildAmoraOfficialReferenceScope,
  parseAmoraOfficialReferenceScope,
} from "@hanbang/shared/amora-official-reference-scope";

const input = {
  version: 1 as const,
  referenceId: "kca_wedding_service_price_2025_11" as const,
  regionScope: "seoul" as const,
  applicabilityKey: "studio" as const,
  asOfDate: "2026-08-18",
};

describe("아모라 공식 근거 source-date-region 계약", () => {
  it("정본 source id에서 원문·확인일·공시 기간·지역·적용 범위를 함께 만든다", () => {
    const result = buildAmoraOfficialReferenceScope(input);

    expect(AMORA_OFFICIAL_REFERENCE_SCOPE_CONTRACT_VERSION).toBe(1);
    expect(result).toEqual({
      version: 1,
      referenceId: "kca_wedding_service_price_2025_11",
      sourceDisclosure: {
        version: 1,
        sourceType: "official_reference",
        commercialRelationship: "none",
        checkedAt: "2026-07-27",
        badgeLabel: "공식 자료",
        statusLabel: "참고 정보",
        commercialRelationshipLabel: "표시된 상업 관계 없음",
        checkedAtLabel: "2026.07.27 확인",
        limitation: "표시된 확인일과 적용 범위 기준이에요. 중요한 내용은 최신 원문을 다시 확인해야 해요.",
        stateEffect: "none",
        rankingPolicy: "disclosure_only",
      },
      sourceName: "한국소비자원 참가격",
      sourceUrl: "https://price.go.kr/tprice/portal/board/boardInfoMgr.do?boardTypeCode=0090000122",
      sourcePeriod: "2025-11",
      sourcePeriodLabel: "2025년 11월",
      regionScope: "seoul",
      regionLabel: "서울",
      applicabilityKey: "studio",
      applicabilityScopeLabel: "사진 촬영 공시 기본가 하한 참고",
      referenceEffect: "context_only",
    });
  });

  it.each([
    ["national", "전국"],
    ["seoul", "서울"],
    ["gyeonggi_incheon", "경기/인천"],
    ["busan", "부산"],
    ["daegu", "대구"],
    ["other_regions", "기타 지역"],
  ] as const)("지역 scope %s를 정본 표시 %s로 제한한다", (regionScope, regionLabel) => {
    expect(buildAmoraOfficialReferenceScope({ ...input, regionScope })?.regionLabel)
      .toBe(regionLabel);
  });

  it.each([
    ["studio", "사진 촬영 공시 기본가 하한 참고"],
    ["dress", "웨딩드레스 공시 기본가 하한 참고"],
    ["makeup", "헤어·메이크업 공시 기본가 하한 참고"],
  ] as const)("적용 범위 %s를 정본 문구로 제한한다", (applicabilityKey, label) => {
    expect(buildAmoraOfficialReferenceScope({ ...input, applicabilityKey })?.applicabilityScopeLabel)
      .toBe(label);
  });

  it.each([
    ["missing reference id", { ...input, referenceId: undefined }],
    ["unknown reference id", { ...input, referenceId: "unknown" }],
    ["unknown region", { ...input, regionScope: "korea" }],
    ["unsupported aggregate", { ...input, applicabilityKey: "sdm_package" }],
    ["future verification", { ...input, asOfDate: "2026-07-26" }],
    ["malformed as-of", { ...input, asOfDate: "2026-8-18" }],
    ["extra authority", { ...input, sourceUrl: "https://example.com" }],
  ])("%s이면 공식 근거를 만들지 않는다", (_name, value) => {
    expect(buildAmoraOfficialReferenceScope(value)).toBeNull();
  });

  it("persisted 결과를 정본으로 재계산하고 원문·확인일·지역·범위 손상을 모두 거절한다", () => {
    const canonical = buildAmoraOfficialReferenceScope(input);
    expect(canonical).not.toBeNull();
    expect(parseAmoraOfficialReferenceScope(canonical, "2026-08-18")).toEqual(canonical);

    const cases = [
      { ...canonical, sourceName: "공식 가격" },
      { ...canonical, sourceUrl: "https://example.com" },
      { ...canonical, sourcePeriod: "2026-07" },
      { ...canonical, regionLabel: "전국" },
      { ...canonical, applicabilityScopeLabel: "평균 적정가" },
      { ...canonical, referenceEffect: "recommended" },
      {
        ...canonical,
        sourceDisclosure: { ...canonical?.sourceDisclosure, checkedAt: "2026-08-18" },
      },
      { ...canonical, extra: true },
    ];

    for (const value of cases) {
      expect(parseAmoraOfficialReferenceScope(value, "2026-08-18")).toBeNull();
    }
  });
});
