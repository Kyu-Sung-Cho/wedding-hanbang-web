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

  it("does not pretend unverified retention is complete", () => {
    expect(privacy).toContain("출시 전에 확정하여 고지");
    expect(privacy).toContain("질문·답변·첨부 파일·도구 입력값 원문을 복제하지 않습니다");
    expect(privacy).not.toContain("웹사이트 방문 기록: <strong>3개월</strong>");
  });

  // ⚠️ 여기 있던 단언은 `expect(privacy).toContain("별도 국외 이전 고지가 완료되기
  // 전에는")` 이었다. 그 문장의 전문은 "…국외 이전 기능을 운영 환경에서 켜지
  // 않습니다" 인데, 프로덕션에는 미국 PostHog·Sentry 가 켜져 있었고 원본 DB 도
  // 국외에 있다. **테스트가 거짓 문장을 붙잡아 두고 있었다.**
  //
  // 그래서 문장을 고정하는 대신 **약속과 현실이 어긋나는지**를 본다.
  it("국외 이전을 하면서 '안 켰다'고 말하지 않는다", () => {
    for (const falseClaim of [
      "국외 이전 기능을 운영 환경에서 켜지 않습니다",
      "국외로 이전하지 않습니다",
      "국외 이전은 하지 않습니다",
    ]) {
      expect(privacy, falseClaim).not.toContain(falseClaim);
    }
    // 실제로 일어나는 일을 말하고, 원치 않는 사람이 할 수 있는 것을 준다.
    expect(privacy).toContain("개인정보가 국외로 이전됩니다");
    expect(privacy).toContain("국외 이전을 원하지 않으시면");
  });

  it("탈퇴 창구를 앱이 실제로 여는 곳과 같게 말한다", () => {
    // 접수 스위치가 꺼져 있으면 앱은 "support@hanbang.ai 로 요청해 주세요"라고
    // 답한다(api/auth/delete/route.ts). 문서만 "설정 페이지에서"라고 말하면
    // 사용자는 없는 버튼을 찾아다닌다.
    const intakeOpen = process.env.ACCOUNT_DELETION_INTAKE_ENABLED === "true";
    if (intakeOpen) return;

    for (const doc of [terms, privacy]) {
      expect(doc).not.toContain("설정 페이지에서 탈퇴");
      expect(doc).not.toContain("설정 페이지에서 탈퇴를 신청");
    }
    expect(terms).toContain("고객센터");
    expect(privacy).toContain("탈퇴는 현재 고객센터");
  });

  it("keeps the obsolete contact-collecting research survey closed", () => {
    const surveyPage = source("src/app/customersurvey/page.tsx");
    const surveyApi = source("src/app/api/survey/route.ts");

    expect(surveyPage).toContain("notFound()");
    // notFound() 만으로는 부족하다. 이 선언이 없으면 Next 가 닫힌 페이지를
    // 미리 렌더해 200 으로 서빙하고, 검색엔진이 그것을 색인한다.
    expect(surveyPage).toContain('dynamic = "force-dynamic"');
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
