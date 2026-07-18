import { describe, expect, it } from "vitest";
import {
  buildVendorSearchLinks,
  deriveApprovedFittingFeeSuggestion,
  isSafeDisclosureObjectKey,
  mergePrivateEnrichmentAttributes,
  normalizeVendorCategory,
  parseAgencyPackageReviewSubmission,
  parseEnrichmentSubmission,
  parsePriceReviewSubmission,
  sourceFileLabel,
  sourceFileLabels,
  validationIssueLabel,
  vendorRegionLabel,
} from "../vendorWorkspace";

describe("vendor admin workspace contracts", () => {
  it("requires scoped, traceable evidence before approving an agency package", () => {
    const invalid = parseAgencyPackageReviewSubmission({
      action: "approve",
      expected_review_version: 0,
      package_name: "샘플 패키지",
      category_scope: [],
      price_min_krw: 3_000_000,
      price_max_krw: 4_000_000,
      vat_note: null,
      price_note: null,
      source_quote: "샘플 패키지 300만원부터",
      confidence: 0.8,
      options: [{
        name: "샘플 본식 드레스",
        price_min_krw: null,
        price_max_krw: null,
        unit: null,
        condition: null,
        raw_text: null,
        source_quote: null,
      }],
    });

    expect(invalid.success).toBe(false);
  });

  it("normalizes a complete agency package review into exact RPC fields", () => {
    const result = parseAgencyPackageReviewSubmission({
      action: "save",
      expected_review_version: 3,
      package_name: " 샘플 패키지 ",
      category_scope: ["studio", "dress", "venue"],
      price_min_krw: 3_000_000,
      price_max_krw: 4_000_000,
      vat_note: "부가세 별도",
      price_note: null,
      source_quote: "샘플 패키지 300만원부터",
      confidence: 0.8,
      options: [{
        name: "샘플 본식 드레스",
        price_min_krw: null,
        price_max_krw: null,
        unit: null,
        condition: null,
        raw_text: "샘플 드레스 포함",
        source_quote: "샘플 본식 드레스 포함",
      }],
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.package_name).toBe("샘플 패키지");
    expect(result.data.expected_review_version).toBe(3);
    expect(result.data.category_scope).toEqual(["studio", "dress", "venue"]);
    expect(Object.keys(result.data.options[0]).sort()).toEqual([
      "condition", "name", "price_max_krw", "price_min_krw", "raw_text", "source_quote", "unit",
    ].sort());
  });

  it("rejects package approval when neither the package nor its options has a price", () => {
    expect(parseAgencyPackageReviewSubmission({
      action: "approve",
      expected_review_version: 0,
      package_name: "샘플 가격 미확인 패키지",
      category_scope: ["studio"],
      price_min_krw: null,
      price_max_krw: null,
      vat_note: null,
      price_note: null,
      source_quote: "샘플 패키지 구성",
      confidence: 0.7,
      options: [],
    }).success).toBe(false);
  });

  it("requires traceable evidence before a price can be approved", () => {
    const result = parsePriceReviewSubmission({
      action: "approve",
      expected_review_version: 0,
      category: "studio",
      item_name: "샘플 기본 촬영",
      price_min_krw: 1_200_000,
      price_max_krw: 1_500_000,
      source_quote: "",
      confidence: 0.9,
    });

    expect(result.success).toBe(false);
  });

  it("blocks approval when an edited option has no evidence", () => {
    const result = parsePriceReviewSubmission({
      action: "approve",
      expected_review_version: 0,
      category: "studio",
      item_name: "샘플 기본 촬영",
      source_quote: "샘플 기본 촬영 120만원",
      confidence: 0.9,
      options: [{
        id: null,
        name: "샘플 야외 추가",
        price_min_krw: 200_000,
        price_max_krw: 200_000,
        unit: null,
        condition: null,
        raw_text: null,
        source_quote: null,
        confidence: null,
      }],
    });

    expect(result.success).toBe(false);
  });

  it("rejects an unknown official price category", () => {
    expect(parsePriceReviewSubmission({
      action: "save",
      expected_review_version: 0,
      category: "studoi",
      item_name: "샘플 오타 분류",
      options: [],
    }).success).toBe(false);
  });

  it("requires a safe integer review version on every review submission", () => {
    const base = {
      action: "save" as const,
      category: "studio" as const,
      item_name: "샘플",
      options: [],
    };

    expect(parsePriceReviewSubmission(base).success).toBe(false);
    expect(parsePriceReviewSubmission({
      ...base,
      expected_review_version: Number.MAX_SAFE_INTEGER + 1,
    }).success).toBe(false);
  });

  it("accepts unique alias proposals only for approval and rejects unsafe selections", () => {
    const proposalId = "00000000-0000-4000-8000-000000000041";
    const base = {
      expected_review_version: 0,
      category: "studio" as const,
      item_name: "샘플",
      source_quote: "샘플 가격 100만원",
      confidence: 0.9,
      options: [],
    };

    const approved = parsePriceReviewSubmission({
      ...base,
      action: "approve",
      selected_alias_proposal_ids: [proposalId],
    });
    expect(approved.success).toBe(true);
    if (approved.success) {
      expect(approved.data.selected_alias_proposal_ids).toEqual([proposalId]);
    }

    expect(parsePriceReviewSubmission({
      ...base,
      action: "save",
      selected_alias_proposal_ids: [proposalId],
    }).success).toBe(false);
    expect(parsePriceReviewSubmission({
      ...base,
      action: "approve",
      selected_alias_proposal_ids: [proposalId, proposalId],
    }).success).toBe(false);
    expect(parsePriceReviewSubmission({
      ...base,
      action: "approve",
      selected_alias_proposal_ids: ["not-a-uuid"],
    }).success).toBe(false);
  });

  it("separates private notes and price band from public vendor attributes", () => {
    const result = parseEnrichmentSubmission("studio", {
      action: "save",
      official_url: "https://sample.example.com",
      instagram_url: null,
      naver_place_url: null,
      attributes: {
        price_band: "mid",
        shoot_locations: ["indoor"],
        notes_internal: "샘플 담당자 확인 필요",
      },
      tag_ids: ["00000000-0000-4000-8000-000000000001"],
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.publicAttributes).toEqual({
      shoot_locations: ["indoor"],
    });
    expect(result.data.priceBand).toBe("mid");
    expect(result.data.notesInternal).toBe("샘플 담당자 확인 필요");
  });

  it("folds the private price band into admin attributes without reviving legacy private fields", () => {
    expect(mergePrivateEnrichmentAttributes({
      shoot_locations: ["indoor"],
      price_band: "luxury",
      notes_internal: "legacy leak",
    }, "mid")).toEqual({
      shoot_locations: ["indoor"],
      price_band: "mid",
    });
    expect(mergePrivateEnrichmentAttributes({ price_band: "luxury" }, null)).toEqual({});
  });

  it("rejects non-https URLs and fields that could store copied vendor content", () => {
    const unsafeUrl = parseEnrichmentSubmission("hall", {
      action: "save",
      official_url: "file:///C:/private/source.xlsx",
      attributes: {},
      tag_ids: [],
    });
    const copiedContent = parseEnrichmentSubmission("hall", {
      action: "save",
      attributes: {},
      tag_ids: [],
      portfolio_text: "복사한 소개문",
    });

    expect(unsafeUrl.success).toBe(false);
    expect(parseEnrichmentSubmission("hall", {
      action: "save",
      official_url: "http://sample.example.com",
      attributes: {},
      tag_ids: [],
    }).success).toBe(false);
    expect(copiedContent.success).toBe(false);
    for (const malformed of ["not a url", "::::", "https://[invalid"]) {
      expect(() => parseEnrichmentSubmission("hall", {
        action: "save",
        official_url: malformed,
        instagram_url: malformed,
        naver_place_url: malformed,
        attributes: {},
        tag_ids: [],
      })).not.toThrow();
      expect(parseEnrichmentSubmission("hall", {
        action: "save",
        official_url: malformed,
        instagram_url: malformed,
        naver_place_url: malformed,
        attributes: {},
        tag_ids: [],
      }).success).toBe(false);
    }
  });

  it("keeps Instagram and Naver trust labels on their real hostname boundaries", () => {
    const valid = parseEnrichmentSubmission("hall", {
      action: "save",
      official_url: "https://sample.example.com",
      instagram_url: "https://www.instagram.com/sample.vendor/",
      naver_place_url: "https://m.place.naver.com/place/123",
      attributes: {},
      tag_ids: [],
    });
    expect(valid.success).toBe(true);

    for (const [field, value] of [
      ["instagram_url", "https://instagram.com.evil.example/sample"],
      ["instagram_url", "https://evil.example/sample"],
      ["naver_place_url", "https://naver.com.evil.example/place/123"],
      ["naver_place_url", "https://evil.example/place/123"],
    ] as const) {
      expect(parseEnrichmentSubmission("hall", {
        action: "save",
        [field]: value,
        attributes: {},
        tag_ids: [],
      }).success).toBe(false);
    }
  });

  it("creates search-helper links without embedding fetchable API state", () => {
    const links = buildVendorSearchLinks("샘플 웨딩홀", "서울 강남");

    expect(links.naverSearch).toBe(
      "https://search.naver.com/search.naver?query=%EC%83%98%ED%94%8C+%EC%9B%A8%EB%94%A9%ED%99%80+%EC%84%9C%EC%9A%B8+%EA%B0%95%EB%82%A8",
    );
    expect(links.naverMap).toContain("https://map.naver.com/p/search/");
    expect(links.instagram).toContain("https://www.instagram.com/explore/search/keyword/");
    expect(JSON.stringify(links)).not.toContain("api/admin");
  });

  it("maps internal region codes to readable Korean search labels", () => {
    expect(vendorRegionLabel("seoul_gangnam3")).toBe("서울 강남권");
    expect(vendorRegionLabel("gyeonggi")).toBe("경기");
    expect(vendorRegionLabel("future_internal_code")).toBe("");
  });

  it("explains validation issue codes conservatively and never hides unknown codes", () => {
    expect(validationIssueLabel("low_confidence")).toBe("추출 신뢰도가 낮거나 모델이 검토를 요청함");
    expect(validationIssueLabel("source_quote_requires_visual_review")).toBe("PDF·이미지 원본 직접 대조 필요");
    expect(validationIssueLabel("future_validation_rule")).toBe("정의되지 않은 검증 이슈 — 원본 직접 확인 필요");
  });

  it("accepts a schema-compliant hall enrichment draft from the editor", () => {
    const result = parseEnrichmentSubmission("hall", {
      action: "save",
      official_url: "https://example.com",
      instagram_url: null,
      naver_place_url: null,
      attributes: {
        hall_type: "hotel",
        guarantee_min: 120,
        meal_type: ["course"],
        parking: "valet",
        notes_internal: "샘플 내부 확인 메모",
      },
      tag_ids: ["00000000-0000-4000-8000-000000000031"],
    });

    expect(result.success).toBe(true);
  });

  it("maps the DB venue category to the hall attribute schema", () => {
    expect(normalizeVendorCategory("venue")).toBe("hall");
    expect(normalizeVendorCategory("hall")).toBe("hall");
    expect(normalizeVendorCategory("other")).toBeNull();
  });

  it("suggests a dress fitting fee only from one unambiguous approved evidence value", () => {
    expect(deriveApprovedFittingFeeSuggestion([
      {
        id: "00000000-0000-4000-8000-000000000041",
        review_status: "approved",
        options: [{
          id: "00000000-0000-4000-8000-000000000042",
          name: "샘플 기본 피팅비",
          raw_text: "샘플 기본 피팅비 5만원",
          price_min_krw: 50_000,
          price_max_krw: 50_000,
          source_quote: "샘플 기본 피팅비 5만원",
        }],
      },
      {
        id: "00000000-0000-4000-8000-000000000043",
        review_status: "pending",
        options: [{
          id: "00000000-0000-4000-8000-000000000044",
          name: "피팅",
          price_min_krw: 90_000,
          price_max_krw: 90_000,
          source_quote: "검수 전 값",
        }],
      },
    ])).toEqual({
      value_krw: 50_000,
      source_quote: "샘플 기본 피팅비 5만원",
      price_id: "00000000-0000-4000-8000-000000000041",
      option_id: "00000000-0000-4000-8000-000000000042",
    });
  });

  it("does not guess a fitting fee from conflicting, ranged, pending, or unsupported evidence", () => {
    const approved = (value: number, id: string) => ({
      id,
      review_status: "approved",
      options: [{
        id,
        name: "피팅비",
        price_min_krw: value,
        price_max_krw: value,
        source_quote: `샘플 피팅비 ${value}원`,
      }],
    });
    expect(deriveApprovedFittingFeeSuggestion([
      approved(50_000, "00000000-0000-4000-8000-000000000051"),
      approved(70_000, "00000000-0000-4000-8000-000000000052"),
    ])).toBeNull();
    expect(deriveApprovedFittingFeeSuggestion([{
      id: "00000000-0000-4000-8000-000000000053",
      review_status: "approved",
      options: [{
        id: "00000000-0000-4000-8000-000000000054",
        name: "피팅비",
        price_min_krw: 50_000,
        price_max_krw: 80_000,
        source_quote: "샘플 피팅비 5~8만원",
      }],
    }])).toBeNull();
  });

  it("never exposes a local source path as a display label", () => {
    expect(sourceFileLabel("C:\\private\\raw\\샘플 공시.xlsx")).toBe("샘플 공시.xlsx");
    expect(sourceFileLabel("../../raw/샘플 공시.pdf")).toBe("샘플 공시.pdf");
    expect(sourceFileLabels('["서울/샘플 1.pdf","서울/샘플 2.xlsx"]')).toEqual([
      "샘플 1.pdf",
      "샘플 2.xlsx",
    ]);
  });

  it("accepts only lowercase content-addressed disclosure object basenames", () => {
    const sha = "a".repeat(64);
    expect(isSafeDisclosureObjectKey(`${sha}.pdf`)).toBe(true);
    expect(isSafeDisclosureObjectKey(`${sha}.xlsx`)).toBe(true);
    expect(isSafeDisclosureObjectKey(`${sha}.json`)).toBe(true);
    expect(isSafeDisclosureObjectKey(`2026Q3/${sha}.pdf`)).toBe(false);
    expect(isSafeDisclosureObjectKey(`${sha.toUpperCase()}.pdf`)).toBe(false);
    expect(isSafeDisclosureObjectKey(`${sha}.PDF`)).toBe(false);
    expect(isSafeDisclosureObjectKey("sample.pdf")).toBe(false);
    expect(isSafeDisclosureObjectKey(`${sha}.jpg`)).toBe(false);
    expect(isSafeDisclosureObjectKey("C:\\private\\sample.pdf")).toBe(false);
    expect(isSafeDisclosureObjectKey("../../private/sample.pdf")).toBe(false);
    expect(isSafeDisclosureObjectKey("https://example.com/sample.pdf")).toBe(false);
    expect(isSafeDisclosureObjectKey("/absolute/sample.pdf")).toBe(false);
  });
});
