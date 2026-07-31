import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

describe("legal pages reflect the current product", () => {
  const terms = source("src/app/terms/page.tsx");
  const privacy = source("src/app/privacy/page.tsx");
  const aiPolicy = source("src/app/ai-policy/page.tsx");

  it("does not claim an unshipped marketplace, payment processor, or legal entity", () => {
    const legalPages = `${terms}\n${privacy}`;

    expect(terms).toContain("현재 웨딩한방은 업체 계약 신청, 예약 또는 결제를 중개하지 않습니다");
    expect(privacy).toContain("현재 웨딩한방은 업체 계약·예약·결제를 중개하지 않으므로");

    for (const unsupportedCurrentFact of [
      "통신판매중개자의 지위",
      "통신판매중개자</strong>",
      "토스페이먼츠",
      "플랫폼 내 업체 예약·결제",
      "주식회사 웨딩한방",
      "결제 내역 및 거래 기록",
    ]) {
      expect(legalPages).not.toContain(unsupportedCurrentFact);
    }
  });

  it("uses the current AI law name and gives members an approval boundary", () => {
    expect(terms).toContain("인공지능 발전과 신뢰 기반 조성 등에 관한 기본법");
    expect(terms).toContain("실행 전에 회원의 확인을 받습니다");
    expect(terms).not.toContain("인공지능 발전 및 신뢰 기반 조성 등에 관한 법률");
    expect(aiPolicy).toContain("인공지능 발전과 신뢰 기반 조성 등에 관한 기본법");
    expect(aiPolicy).toContain("사용자가 실행 전에 확인합니다");
    expect(aiPolicy).not.toContain("Couple Memory");
    expect(aiPolicy).not.toContain("감정적 지원은 제공");
  });

  it("does not take promotional rights or impose an operator-only court", () => {
    expect(terms).toContain("광고나 외부 홍보 자료로 사용하려면 작성자의 별도 동의");
    expect(terms).toContain("민사소송법 등 관계 법령");
    expect(terms).not.toContain("회사의 본점 소재지를 관할");
    expect(terms).not.toContain("홍보, 개선의 목적으로 해당 콘텐츠를 무상");
  });

  it("does not pretend unverified retention and overseas processing are complete", () => {
    expect(privacy).toContain("출시 전에 확정하여 고지");
    expect(privacy).toContain("별도 국외 이전 고지가 완료되기 전에는");
    expect(privacy).toContain("질문·답변·첨부 파일·도구 입력값 원문을 복제하지 않습니다");
    expect(privacy).not.toContain("웹사이트 방문 기록: <strong>3개월</strong>");
  });

  it("keeps the obsolete contact-collecting research survey closed", () => {
    const surveyPage = source("src/app/customersurvey/page.tsx");
    const surveyApi = source("src/app/api/survey/route.ts");

    expect(surveyPage).toContain("notFound()");
    expect(surveyApi).toContain("status: 410");
    expect(surveyApi).toContain('"Cache-Control": "no-store"');
    expect(surveyApi).not.toContain("customer_survey_responses");
    expect(surveyApi).not.toContain("q23_contact");
  });

  it("does not advertise nonexistent contract sharing or market distributions", () => {
    const vendorPage = source("src/app/price/vendor/[slug]/page.tsx");

    expect(vendorPage).not.toContain("실거래 분포");
    expect(vendorPage).not.toContain("내 계약 정보를 공유");
    expect(vendorPage).not.toContain("내 견적 확인하고 공유하기");
    expect(vendorPage).not.toContain("marketPriceProvider");
  });

  it("only exposes notification preferences that change current app behavior", () => {
    const settingsPage = source("src/app/(app)/settings/page.tsx");
    const notifications = source("src/hooks/useNotifications.ts");

    expect(settingsPage).toContain("앱 안 알림 목록");
    expect(settingsPage).not.toContain("맞춤 추천 알림");
    expect(settingsPage).not.toContain("마케팅 알림");
    expect(settingsPage).not.toContain("카톡·문자 케어");
    expect(settingsPage).not.toContain("아모라 먼저 챙기기 · 내 동의");
    expect(settingsPage).toContain('href: "/terms"');
    expect(settingsPage).toContain('href: "/privacy"');
    expect(settingsPage).toContain("mailto:${CONTACT.email}");
    expect(settingsPage).not.toContain("v1.0.0");
    expect(notifications).not.toContain("marketing: boolean");
  });
});
