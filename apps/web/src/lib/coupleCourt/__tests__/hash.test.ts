import { describe, expect, it } from "vitest";
import { computeCourtInputHash } from "@/lib/coupleCourt/hash";
import type { CourtStatementInput } from "@/lib/coupleCourt/types";

const applicant: CourtStatementInput = {
  role: "applicant",
  facts: "드레스 옵션을 결제하기 전에 상의하기로 했습니다.",
  feelings: "상의 없이 결제되어 서운했습니다.",
};
const partner: CourtStatementInput = {
  role: "partner",
  facts: "피팅 마감이 임박해 먼저 결제했습니다.",
  feelings: "답변을 기다리기 어렵다고 느꼈습니다.",
};

describe("computeCourtInputHash", () => {
  it("normalizes whitespace and statement order", () => {
    const first = computeCourtInputHash({
      mode: "couple",
      category: "studio_dress_makeup",
      tone: "practical",
      preflightSafetyLevel: "normal",
      model: "gpt-5.6-terra",
      statements: [partner, applicant],
    });
    const second = computeCourtInputHash({
      mode: "couple",
      category: "studio_dress_makeup",
      tone: "practical",
      preflightSafetyLevel: "normal",
      model: "gpt-5.6-terra",
      statements: [
        { ...applicant, facts: "  드레스 옵션을 결제하기 전에   상의하기로 했습니다.  " },
        partner,
      ],
    });
    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });

  it("changes when the resolved model or judgment controls change", () => {
    const base = {
      mode: "couple" as const,
      category: "studio_dress_makeup" as const,
      tone: "practical" as const,
      preflightSafetyLevel: "normal" as const,
      model: "gpt-5.6-terra",
      statements: [applicant, partner],
    };
    const hash = computeCourtInputHash(base);
    expect(computeCourtInputHash({ ...base, model: "gpt-5.6-terra-next" })).not.toBe(hash);
    expect(computeCourtInputHash({ ...base, tone: "gentle" })).not.toBe(hash);
    expect(computeCourtInputHash({ ...base, category: "budget" })).not.toBe(hash);
    expect(computeCourtInputHash({ ...base, preflightSafetyLevel: "sensitive" })).not.toBe(hash);
  });
});
