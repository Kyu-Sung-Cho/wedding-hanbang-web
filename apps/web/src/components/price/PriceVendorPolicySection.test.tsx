import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { PublicVendorPolicy } from "@/lib/vendors/publicVendorPriceData";

import { PriceVendorPolicySection } from "./PriceVendorPolicySection";

const policy = (overrides: Partial<PublicVendorPolicy> = {}): PublicVendorPolicy => ({
  id: "policy-1",
  semanticType: "penalty",
  scope: "vendor",
  title: null,
  contentVerbatim: "촬영일 30일 전 취소 시 상품가의 100%",
  sourceAgency: "가대행사",
  ...overrides,
});

describe("계약 전 확인 · 위약금과 환불", () => {
  it("원문이 없어도 섹션과 명시적 빈 상태를 남긴다", () => {
    const html = renderToStaticMarkup(
      <PriceVendorPolicySection policies={[]} categoryLabel="결혼식장" />,
    );

    // 조용한 빈자리는 "공시가 없다"와 "고장났다"를 구분할 수 없게 만든다.
    expect(html).toContain("계약 전 확인 · 위약금과 환불");
    expect(html).toContain('data-policy-state="empty"');
    expect(html).toContain("이 경로 위약금·환불 공시 항목 없음");
    // 없음의 주어는 공시 항목이다. 이 줄이 빠지면 "위약금 없음"으로 읽히고,
    // 그건 우리가 확인하지 못한 계약 조건을 단정하는 거짓 진술이 된다.
    expect(html).toContain("위약금이 없다는 뜻은 아니에요");
    expect(html).toContain("결혼식장의 공시 문서에서 위약금·환불 규정을 확인하지 못했어요");
  });

  it("빈 상태 문구는 목록 카드가 쓰는 집안 형식과 같은 모양이다", () => {
    // PriceVendorCard 는 "추가금 공시 항목 없음" + "추가금이 없다는 뜻은 아니에요"
    // 를 이미 쓴다. 같은 제품 표면에서 없음을 두 가지 말투로 말하지 않는다.
    const html = renderToStaticMarkup(
      <PriceVendorPolicySection policies={[]} categoryLabel="스튜디오" />,
    );

    expect(html).toMatch(/위약금·환불 공시 항목 없음/);
    expect(html).toMatch(/없다는 뜻은 아니에요/);
  });

  it("원문이 있으면 종류 라벨과 원문을 그대로 보여준다", () => {
    const html = renderToStaticMarkup(
      <PriceVendorPolicySection
        policies={[policy(), policy({ id: "policy-2", semanticType: "refund", contentVerbatim: "계약금 환불 불가", sourceAgency: "나대행사" })]}
        categoryLabel="스튜디오"
      />,
    );

    expect(html).toContain('data-policy-state="present"');
    expect(html).toContain("위약금");
    expect(html).toContain("환불");
    expect(html).toContain("촬영일 30일 전 취소 시 상품가의 100%");
    expect(html).toContain("계약금 환불 불가");
    expect(html).toContain("가대행사 공시");
    expect(html).not.toContain("공시 항목 없음");
    // 문구가 다른 공시가 둘이면 그 사실을 말한다 — 해석이 아니라 관찰이다.
    expect(html).toContain("대행사 2곳이 서로 다른 문구로 공시했어요");
  });

  it("예식장 문서 규정에는 없는 대행사를 지어 붙이지 않는다", () => {
    const html = renderToStaticMarkup(
      <PriceVendorPolicySection
        policies={[policy({
          id: "hall-1",
          scope: "hall_document",
          sourceAgency: null,
          contentVerbatim: "예식 30일 전 ~ 예식 당일 총 비용의 10% 위약금",
        })]}
        categoryLabel="결혼식장"
      />,
    );

    expect(html).toContain('data-policy-state="present"');
    expect(html).toContain("예식 30일 전 ~ 예식 당일 총 비용의 10% 위약금");
    expect(html).toContain("공시 문서 공통 규정");
    expect(html).not.toContain("공시</span>");
    // 문구가 한 갈래뿐이면 여러 곳이 갈렸다는 안내를 띄우지 않는다.
    expect(html).not.toContain("서로 다른 문구로 공시했어요");
  });

  it("refund_policy도 환불로 읽는다", () => {
    const html = renderToStaticMarkup(
      <PriceVendorPolicySection
        policies={[policy({
          id: "hall-2",
          semanticType: "refund_policy",
          scope: "hall_document",
          sourceAgency: null,
          contentVerbatim: "계약 체결일 기준 15일 이내 90% 환불",
        })]}
        categoryLabel="결혼식장"
      />,
    );

    expect(html).toContain("환불");
    expect(html).not.toContain("기타 계약 조건");
  });
});
