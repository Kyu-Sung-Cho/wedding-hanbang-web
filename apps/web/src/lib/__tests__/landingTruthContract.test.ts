import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("public landing truth contract", () => {
  it("shows neutral empty-state product examples instead of invented customer metrics", () => {
    const solutions = read("src/components/customer-landing/CustomerSolutions.tsx");

    expect(solutions).toContain("총 예산 미입력");
    expect(solutions).toContain("직접 등록한 일정");
    expect(solutions).not.toMatch(/D-120|D-150|D-90|D-60|2\/4 완료/);
    expect(solutions).not.toMatch(/12,500,000|4,000,000|280만|200만|120만|60만|68%/);
    expect(solutions).not.toContain("지은님, 민수님");
  });

  it("does not turn generic checklist timing into a promised personal deadline", () => {
    const scenarios = read("src/components/customer-landing/CustomerTestimonials.tsx");
    const comparison = read("src/components/customer-landing/CustomerComparison.tsx");

    expect(scenarios).not.toMatch(/D-120|D-day 기준 체크리스트/);
    expect(comparison).not.toContain("D-day 체크리스트");
  });

  it("describes only implemented setup, research, and question-organizing flows", () => {
    const how = read("src/components/customer-landing/CustomerHowItWorks.tsx");
    const comparison = read("src/components/customer-landing/CustomerComparison.tsx");
    const scenarios = read("src/components/customer-landing/CustomerTestimonials.tsx");

    expect(how).toContain("준비 정보 설정");
    expect(how).not.toContain("AI 온보딩");
    expect(comparison).toContain("후기·질문을 저장하고 업체에 확인할 문장을 정리");
    expect(comparison).not.toContain("후보와 비교 질문");
    expect(scenarios).toContain("계약 질문 정리");
    expect(scenarios).not.toContain("냉정한 비교");
  });

  it("does not advertise an account price before public account operation is approved", () => {
    const comparison = read("src/components/landing/CompareToHumanPlanner.tsx");
    const research = read("src/constants/beta.ts");

    expect(comparison).toContain("공개 운영 전 · 계정·이용료 정책 미확정");
    expect(comparison).not.toContain("현재 베타 계정 별도 이용료 없음");
    expect(research).toContain("불편 사항과 필요한 기능을 개선 우선순위 검토에 활용");
    expect(research).not.toContain("개선에 직접 반영");
  });

  it("states that implemented feature and scenario cards are not currently open", () => {
    const features = read("src/components/customer-landing/CustomerFeatures.tsx");
    const scenarios = read("src/components/customer-landing/CustomerTestimonials.tsx");
    const how = read("src/components/customer-landing/CustomerHowItWorks.tsx");

    expect(features).toContain(
      "현재 계정·앱 기능은 열려 있지 않으며, 아래는 구현 범위 설명입니다.",
    );
    expect(scenarios).toContain(
      "현재 계정·앱 기능은 열려 있지 않습니다. 아래는 구현된 활용 예시입니다.",
    );
    expect(how).toContain(
      "현재 계정·앱 기능은 열려 있지 않습니다. 아래는 구현된 4단계 흐름입니다.",
    );
    expect(features).not.toContain("실제 제공을 보장하지 않습니다");
    expect(scenarios).not.toContain("실제 제공 여부는 베타 안내를 기준으로 합니다");
    expect(how).not.toContain("실제 제공을 보장하지 않습니다");
  });

  it("explains official research scope without turning snapshot sums into price anchors", () => {
    const research = read("src/components/landing/OfficialPriceResearch.tsx");
    const stats = read("src/components/customer-landing/CustomerStats.tsx");

    expect(research).toContain("조사월을 함께 봅니다");
    expect(research).toContain("항목을 나눠 봅니다");
    expect(research).toContain("포함 범위와 추가 조건은 업체 원문과 계약서로 확인");
    expect(research).not.toMatch(/₩|20,910,000|35,990,000|2,091만원|3,599만원/);
    expect(stats).toContain("선택 가능한 준비 항목");
    expect(stats).toContain("필요한 항목만 골라서");
  });
});
