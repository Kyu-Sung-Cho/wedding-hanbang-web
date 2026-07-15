import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd(), "../..");
const read = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

describe("residual trust and roadmap promise boundary", () => {
  it("does not market the disabled vendor connection as an upcoming feature", () => {
    const publicBoundaries = [
      "apps/web/src/components/app/PublicBetaUnavailable.tsx",
      "apps/mobile/src/components/PublicBetaUnavailable.tsx",
      "apps/web/src/components/landing/Footer.tsx",
      "apps/web/src/app/terms/page.tsx",
      "apps/web/src/app/(community)/community/vendor/[name]/page.tsx",
      "apps/web/src/components/app/ServiceGuide.tsx",
      "apps/web/src/app/api/bookings/route.ts",
      "apps/web/src/app/api/messages/route.ts",
    ].map(read).join("\n");

    expect(publicBoundaries).not.toContain("업체 연결 준비 중");
    expect(publicBoundaries).toContain("재개 여부와 시점");
    expect(publicBoundaries).toContain("상담 요청은 업체에 전송되지");
  });

  it("keeps search metadata inside the public survey scope", () => {
    const metadata = read("apps/web/src/app/(community)/market-prices/layout.tsx");

    expect(metadata).toContain("결혼서비스 공식 가격 조사 (조사월 기준)");
    expect(metadata).toContain("조사 범위와 함께");
    expect(metadata).toContain("전체 결혼비용을 판정하는 자료가 아닙니다");
    expect(metadata).not.toContain("웨딩 평균 가격 공개");
  });

  it("uses neutral budget-preference labels instead of unproved value or quality claims", () => {
    const preferences = [
      "apps/web/src/components/onboarding/WeddingStylePreferences.tsx",
      "apps/mobile/app/onboarding/index.tsx",
      "apps/web/src/app/(app)/settings/page.tsx",
    ].map(read).join("\n");

    expect(preferences).toContain("비용 우선");
    expect(preferences).toContain("경험 우선");
    expect(preferences).not.toContain("가성비");
    expect(preferences).not.toContain("최고의 퀄리티");
    expect(preferences).not.toContain("절약형");
  });

  it("separates plan, contract and paid records in public examples", () => {
    const solutions = read("apps/web/src/components/customer-landing/CustomerSolutions.tsx");
    const scenarios = read("apps/web/src/components/customer-landing/CustomerTestimonials.tsx");

    expect(solutions).toContain("계획 금액, 서명한 계약 총액, 지금까지 낸 금액");
    expect(scenarios).toContain("계획 금액·계약 총액·낸 금액을 구분");
    expect(scenarios).toContain("결제 증빙을 대신하지는 않아요");
    expect(solutions).not.toContain("예산과 실제 지출을 직접 기록");
  });

  it("does not present an AI notice as completed regulatory compliance", () => {
    const terms = read("apps/web/src/app/terms/page.tsx");
    const policy = read("apps/web/src/app/ai-policy/page.tsx");
    const chatDisclosure = [
      "apps/web/src/components/app/chat/ChatContent.tsx",
      "apps/web/src/components/app/chat/ChatBubble.tsx",
    ].map(read).join("\n");

    expect(terms).not.toContain("AI 기본법");
    expect(terms).toContain("규제 준수가 완료됐다고 주장하지 않습니다");
    expect(policy).toContain("법률 검토나 규제 준수 완료를");
    expect(policy).toContain("증명하는 문서가 아닙니다");
    expect(chatDisclosure).toContain("생성형 AI 응답");
    expect(chatDisclosure).not.toContain("AI 기본법");
    expect(chatDisclosure).not.toContain("표시 의무");
  });

  it("does not imply that a disabled vendor catalog has already been verified", () => {
    const apiBoundary = read("apps/web/src/lib/publicBetaApi.ts");

    expect(apiBoundary).toContain("출처·최신성·연결 가능 여부를 확인한 업체 카탈로그");
    expect(apiBoundary).not.toContain("검증된 업체 카탈로그");
  });

  it("keeps synthetic vendor seeds physically retired instead of dormant", () => {
    const seedRoutes = [
      "apps/web/src/app/api/admin/seed-vendors/route.ts",
      "apps/web/src/app/api/admin/seed-venues/route.ts",
      "apps/web/src/app/api/admin/seed-makeup/route.ts",
      "apps/web/src/app/api/admin/seed-studios/route.ts",
    ].map(read).join("\n");

    expect(seedRoutes.match(/synthetic_vendor_seed_retired/g)).toHaveLength(4);
    expect(seedRoutes.match(/status: 410/g)).toHaveLength(4);
    expect(seedRoutes).not.toMatch(
      /verifyAdmin|getServiceClient|seedGate|\.from\(|\.insert\(|priceMin|priceMax|address:|phone:/,
    );
  });

  it("documents the retired write endpoints with their actual fail-closed status", () => {
    const service = read("WEDDINGHANBANG_SERVICE_DOC.md");

    expect(service).toContain("`POST /api/bookings`, `POST /api/messages`, `PATCH /api/bookings/[id]/outcome`");
    expect(service).toContain("각각 안정된 `410` 코드를 반환한다");
    expect(service).not.toContain("각각 안정된 503 코드를 반환한다");
  });
});
