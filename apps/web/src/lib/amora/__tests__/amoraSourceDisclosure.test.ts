import { describe, expect, it } from "vitest";

import {
  AMORA_SOURCE_DISCLOSURE_CONTRACT_VERSION,
  buildAmoraSourceDisclosure,
  parseAmoraSourceDisclosure,
} from "@hanbang/shared/amora-source-disclosure";

const AS_OF_DATE = "2026-08-18";

function input(
  sourceType:
    | "canonical_record"
    | "amora_proposal"
    | "reviewed_guidance"
    | "official_reference"
    | "vendor_public_info"
    | "community_experience"
    | "sponsored_placement",
  commercialRelationship:
    | "none"
    | "source_vendor"
    | "paid_advertisement"
    | "sponsored_benefit"
    | "vendor_affiliation"
    | "unknown",
  checkedAt: string | null,
) {
  return {
    version: 1,
    sourceType,
    commercialRelationship,
    checkedAt,
    asOfDate: AS_OF_DATE,
  } as const;
}

describe("Amora source disclosure contract", () => {
  it("separates canonical records, proposals, references, experiences, and ads without ranking authority", () => {
    expect(AMORA_SOURCE_DISCLOSURE_CONTRACT_VERSION).toBe(1);

    const cases = [
      {
        value: input("canonical_record", "none", null),
        expected: {
          badgeLabel: "확인·저장한 준비 기록",
          statusLabel: "준비에 반영된 기록",
          commercialRelationshipLabel: "표시된 상업 관계 없음",
          checkedAtLabel: null,
          limitation: "사용자가 확인해 저장한 기록이에요. 현재 상태가 바뀌면 최신 기록을 다시 확인해요.",
          stateEffect: "already_recorded",
        },
      },
      {
        value: input("amora_proposal", "none", null),
        expected: {
          badgeLabel: "아모라 제안",
          statusLabel: "아직 준비에 반영 전",
          commercialRelationshipLabel: "표시된 상업 관계 없음",
          checkedAtLabel: null,
          limitation: "사용자가 확인하고 승인하기 전에는 일정·예산·행동에 반영되지 않아요.",
          stateEffect: "requires_user_confirmation",
        },
      },
      {
        value: input("reviewed_guidance", "none", "2026-08-17"),
        expected: {
          badgeLabel: "검수 가이드",
          statusLabel: "참고 정보",
          commercialRelationshipLabel: "표시된 상업 관계 없음",
          checkedAtLabel: "2026.08.17 검토",
          limitation: "검토한 범위 안의 확인 절차예요. 업체별 최신 서면과 직접 대조해야 해요.",
          stateEffect: "none",
        },
      },
      {
        value: input("official_reference", "none", "2026-08-18"),
        expected: {
          badgeLabel: "공식 자료",
          statusLabel: "참고 정보",
          commercialRelationshipLabel: "표시된 상업 관계 없음",
          checkedAtLabel: "2026.08.18 확인",
          limitation: "표시된 확인일과 적용 범위 기준이에요. 중요한 내용은 최신 원문을 다시 확인해야 해요.",
          stateEffect: "none",
        },
      },
      {
        value: input("vendor_public_info", "source_vendor", "2026-08-16"),
        expected: {
          badgeLabel: "업체 공개정보",
          statusLabel: "참고 정보",
          commercialRelationshipLabel: "해당 업체가 공개한 정보",
          checkedAtLabel: "2026.08.16 확인",
          limitation: "업체가 공개한 정보예요. 품질·자격·예약·최종 가격을 보장하지 않아요.",
          stateEffect: "none",
        },
      },
      {
        value: input("community_experience", "none", null),
        expected: {
          badgeLabel: "다른 사용자 경험",
          statusLabel: "참고 정보",
          commercialRelationshipLabel: "표시된 상업 관계 없음",
          checkedAtLabel: null,
          limitation: "한 사람의 경험이에요. 같은 결과나 일반적인 조건을 뜻하지 않아요.",
          stateEffect: "none",
        },
      },
      {
        value: input("sponsored_placement", "paid_advertisement", null),
        expected: {
          badgeLabel: "광고·혜택",
          statusLabel: "광고 정보",
          commercialRelationshipLabel: "유료 광고",
          checkedAtLabel: null,
          limitation: "광고 또는 혜택 관계가 있는 정보예요. 일반 추천 순위와 분리해 보여줘요.",
          stateEffect: "none",
        },
      },
    ] as const;

    for (const { value, expected } of cases) {
      const result = buildAmoraSourceDisclosure(value);
      expect(result).toEqual({
        version: 1,
        sourceType: value.sourceType,
        commercialRelationship: value.commercialRelationship,
        checkedAt: value.checkedAt,
        ...expected,
        rankingPolicy: "disclosure_only",
      });
      expect(Object.keys(result ?? {})).toEqual([
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
      expect(result).not.toHaveProperty("rank");
      expect(result).not.toHaveProperty("score");
      expect(result).not.toHaveProperty("action");
    }
  });

  it.each([
    ["extra authority", { ...input("canonical_record", "none", null), rank: 1 }],
    ["wrong version", { ...input("canonical_record", "none", null), version: 2 }],
    ["future checked date", input("vendor_public_info", "source_vendor", "2026-08-19")],
    ["impossible checked date", input("vendor_public_info", "source_vendor", "2026-02-30")],
    ["missing reviewed date", input("reviewed_guidance", "none", null)],
    ["canonical date overclaim", input("canonical_record", "none", "2026-08-18")],
    ["proposal commercial mix", input("amora_proposal", "sponsored_benefit", null)],
    ["vendor relationship missing", input("vendor_public_info", "none", "2026-08-18")],
    ["ad relationship missing", input("sponsored_placement", "none", null)],
    ["paid experience must be an ad", input("community_experience", "paid_advertisement", null)],
    ["malformed as-of date", { ...input("official_reference", "none", "2026-08-18"), asOfDate: "2026-8-18" }],
  ])("fails closed for %s", (_label, value) => {
    expect(buildAmoraSourceDisclosure(value)).toBeNull();
  });

  it("accepts disclosed benefits and unknown affiliation only on bounded reference types", () => {
    expect(
      buildAmoraSourceDisclosure(input("community_experience", "sponsored_benefit", null))
        ?.commercialRelationshipLabel,
    ).toBe("제품·서비스·할인 혜택 있음");
    expect(
      buildAmoraSourceDisclosure(input("community_experience", "vendor_affiliation", null))
        ?.commercialRelationshipLabel,
    ).toBe("업체 이해관계 있음");
    expect(
      buildAmoraSourceDisclosure(input("community_experience", "unknown", null))
        ?.commercialRelationshipLabel,
    ).toBe("상업 관계 확인 안 됨");
    expect(
      buildAmoraSourceDisclosure(input("sponsored_placement", "sponsored_benefit", null))
        ?.commercialRelationshipLabel,
    ).toBe("제품·서비스·할인 혜택 있음");
  });

  it("revalidates persisted disclosure output and rejects copy or authority tampering", () => {
    const disclosure = buildAmoraSourceDisclosure(
      input("vendor_public_info", "source_vendor", "2026-08-16"),
    );

    expect(parseAmoraSourceDisclosure(disclosure, AS_OF_DATE)).toEqual(disclosure);
    expect(parseAmoraSourceDisclosure({
      ...disclosure,
      badgeLabel: "웨딩한방 인증 업체",
    }, AS_OF_DATE)).toBeNull();
    expect(parseAmoraSourceDisclosure({
      ...disclosure,
      stateEffect: "already_recorded",
    }, AS_OF_DATE)).toBeNull();
    expect(parseAmoraSourceDisclosure({
      ...disclosure,
      rankingPolicy: "boost",
    }, AS_OF_DATE)).toBeNull();
    expect(parseAmoraSourceDisclosure(disclosure, "2026-08-15")).toBeNull();
  });
});
