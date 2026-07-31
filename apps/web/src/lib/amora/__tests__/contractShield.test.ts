import { describe, expect, it } from "vitest";

import { analyzeContractReadiness } from "@/lib/amora/contractShield";

const STUDIO_CLAUSE_IDS = [
  "written_contract",
  "total_amount",
  "payment_schedule",
  "cancellation_refund",
  "change_policy",
  "vendor_identity",
  "original_data",
  "retouch_delivery",
  "copyright_usage",
];

describe("계약 전 문서 확인", () => {
  it("근거 없는 금액 가중치 없이 같은 문서 상태를 같은 결과로 정리한다", () => {
    const small = analyzeContractReadiness({
      category: "studio",
      contractAmountManwon: 100,
      checkedClauseIds: STUDIO_CLAUSE_IDS,
    });
    const large = analyzeContractReadiness({
      category: "studio",
      contractAmountManwon: 10_000,
      checkedClauseIds: STUDIO_CLAUSE_IDS,
    });

    expect(small.riskLevel).toBe("low");
    expect(large.riskLevel).toBe(small.riskLevel);
    expect(large.blockers).toEqual(small.blockers);
    expect(large.warnings).toEqual(small.warnings);
  });

  it("공개 결과는 업계 용어 대신 구체적인 확인 질문과 한계를 보여준다", () => {
    const result = analyzeContractReadiness({
      category: "sdm_package",
      hasWrittenContract: false,
    });
    const publicCopy = [
      result.categoryLabel,
      result.riskLabel,
      result.summaryTitle,
      result.summaryText,
      ...result.blockers.flatMap((item) => [item.label, item.reason, item.question]),
      ...result.warnings.flatMap((item) => [item.label, item.reason, item.question]),
      ...result.vendorQuestions,
      result.sourceNote,
      result.disclaimer,
    ].join("\n");

    expect(publicCopy).not.toMatch(
      /스드메|본식|스냅|원본 데이터|수정본|헬퍼비|얼리스타트|피팅비|혼주|폐백/,
    );
    expect(result.vendorQuestions.every((question) => question.endsWith("?"))).toBe(true);
    expect(result.sourceNote).toContain("실제 계약서의 내용");
    expect(result.sourceNote).toContain("판정하지 않습니다");
    expect(result.disclaimer).toContain("법률 자문이 아닙니다");
  });

  it("계약서가 없다고 입력하면 계약 전 문서 확인 필요로 표시한다", () => {
    const result = analyzeContractReadiness({
      category: "venue",
      hasWrittenContract: false,
    });

    expect(result.riskLevel).toBe("high");
    expect(result.riskLabel).toBe("계약 전 문서 확인 필요");
    expect(result.summaryTitle).toContain("먼저 문서로 확인할 항목");
  });
});
