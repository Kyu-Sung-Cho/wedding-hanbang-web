import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd(), "../..");

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), "utf8");
}

describe("booking request public hard-disable contract", () => {
  it("physically retires vendor submission screens and keeps write APIs closed", () => {
    const webVendor = read("apps/web/src/app/(app)/vendors/[id]/page.tsx");
    const mobileVendor = read("apps/mobile/app/vendors/[id].tsx");
    const webUnavailable = read("apps/web/src/components/app/PublicBetaUnavailable.tsx");
    const mobileUnavailable = read("apps/mobile/src/components/PublicBetaUnavailable.tsx");
    const messageRoute = read("apps/web/src/app/api/messages/route.ts");
    const bookingRoute = read("apps/web/src/app/api/bookings/route.ts");
    const outcomeRoute = read("apps/web/src/app/api/bookings/[id]/outcome/route.ts");

    expect(webVendor).toContain('<PublicBetaUnavailable feature="vendor" />');
    expect(mobileVendor).toContain('<PublicBetaUnavailable feature="vendor" />');
    for (const retiredScreen of [webVendor, mobileVendor]) {
      expect(retiredScreen).not.toMatch(/supabase|apiFetch|BOOKING_REQUESTS_ENABLED|VENDOR_MESSAGES_ENABLED|remaining|bookingVisible/);
    }
    expect(webUnavailable).toContain("업체 탐색은 현재 제공하지 않아요");
    expect(webUnavailable).toContain("출처·최신성·연결 가능 여부를 검증하지 못해 제공하지 않습니다");
    expect(mobileUnavailable).toContain("업체 탐색은 현재 제공하지 않아요");

    expect(messageRoute).toContain("const VENDOR_MESSAGES_ENABLED = false");
    expect(messageRoute).toContain("code: VENDOR_MESSAGES_DISABLED_CODE");
    expect(messageRoute).not.toMatch(/createClient|createAdminClient|supabase|auth\.getUser|\.from\(/);
    expect(bookingRoute).toContain('"Cache-Control": "no-store, max-age=0"');
    expect(outcomeRoute).toContain("const BOOKING_OUTCOMES_ENABLED = false");
    expect(outcomeRoute).toContain("code: BOOKING_OUTCOMES_DISABLED_CODE");
    expect(outcomeRoute).toContain('"Cache-Control": "no-store, max-age=0"');
  });

  it("physically retires booking screens and outcome work from the mobile dashboard", () => {
    const webBookings = read("apps/web/src/app/(app)/bookings/page.tsx");
    const mobileBookings = read("apps/mobile/app/bookings/index.tsx");
    const mobileDashboard = read("apps/mobile/app/(tabs)/dashboard.tsx");
    const webUnavailable = read("apps/web/src/components/app/PublicBetaUnavailable.tsx");
    const mobileUnavailable = read("apps/mobile/src/components/PublicBetaUnavailable.tsx");
    const settings = read("apps/web/src/app/(app)/settings/page.tsx");

    expect(webBookings).toContain('<PublicBetaUnavailable feature="booking" />');
    expect(mobileBookings).toContain('<PublicBetaUnavailable feature="booking" />');
    for (const retiredScreen of [webBookings, mobileBookings]) {
      expect(retiredScreen).not.toMatch(/vendor_bookings|supabase|BOOKING_OUTCOMES_ENABLED|actual_amount|만족도/);
    }
    expect(webUnavailable).toContain("웨딩한방에서는 예약을 받지 않아요");
    expect(webUnavailable).toContain("업체가 발급한 안내와 계약서를 기준으로 직접 확인");
    expect(mobileUnavailable).toContain("웨딩한방에서는 예약을 받지 않아요");
    expect(mobileUnavailable).toContain("업체 안내와 계약서를 기준으로 직접 확인");
    expect(mobileDashboard).not.toMatch(/vendor_bookings|BOOKING_OUTCOMES_ENABLED|bookingOutcomeTasks|실결제 입력 필요/);
    expect(settings).not.toContain("PUBLIC_BETA_CAPABILITIES.vendorCatalog");
    expect(settings).not.toContain("PUBLIC_BETA_CAPABILITIES.pushNotifications");
    expect(settings).toContain("Boolean(profile?.has_phone)");
    expect(settings).toContain("현재 사용하거나 외부에 전송하지 않습니다.");
    expect(settings).not.toContain("업체 상담 예약 요청 시 연락받을 번호입니다");
  });

  it("retires the historical list before authentication, PII, or database access", () => {
    const mineRoute = read("apps/web/src/app/api/bookings/mine/route.ts");

    expect(mineRoute).toContain("booking_requests_retired");
    expect(mineRoute).toContain("status: 410");
    expect(mineRoute).not.toMatch(/createClient|supabase|auth\.getUser|vendor_bookings|bride_name|groom_name|contact_phone|memo/);
  });

  it("removes unsupported marketing numbers and active delivery claims", () => {
    const features = read("apps/web/src/components/customer-landing/CustomerFeatures.tsx");
    const painPoints = read("apps/web/src/components/customer-landing/CustomerPainPoints.tsx");
    const footer = read("apps/web/src/components/landing/Footer.tsx");

    expect(features).toContain("웨딩한방에서 업체로 문의는 전송되지 않습니다.");
    expect(features).not.toContain("문의가 가능한 업체에는 질문을 보내고 전송 결과를 확인");
    expect(painPoints).toContain("포함 항목·추가 조건을 계약 전에 확인");
    expect(painPoints).not.toMatch(/174만원|346만원/);
    expect(painPoints).not.toContain("364만원");
    expect(painPoints).not.toContain("50여 개");
    expect(footer).toContain("상담 요청이나 문의는 업체에 전송하지 않습니다");
    expect(footer).not.toContain("Hanbang Group");
  });

  it("documents an unconfirmed operator and blocks public PII beta until the full loop exists", () => {
    const terms = read("apps/web/src/app/terms/page.tsx");
    const privacy = read("apps/web/src/app/privacy/page.tsx");
    const standard = read("WEDDINGHANBANG_SERVICE_DOC.md");
    const audit = read("docs/CONSUMER_JOURNEY_AND_RELEASE_AUDIT_2026-07-11.md");

    for (const policy of [terms, privacy]) {
      expect(policy).toContain("웨딩한방 운영자");
      expect(policy).not.toContain("주식회사 웨딩한방");
    }
    expect(privacy).toContain("현재 새 상담 요청의 이름·휴대폰 번호·희망 일시·메모를 저장하거나 업체에 제공하지 않습니다");
    expect(privacy).not.toContain("직책: 대표이사");

    expect(standard).toContain("소비자용 구현을 제거했다");
    expect(standard).toContain("안정된 `410` 코드");
    expect(standard).toContain("물리적 퇴역 계약");

    for (const document of [standard, audit]) {
      expect(document).toContain("실제 업체 전달");
      expect(document).toContain("수락·거절·변경·취소");
      expect(document).toContain("연락처 보존·철회");
      expect(document).toContain("정식 법적 주체");
      expect(document).toContain("완료 증빙");
      expect(document).toContain("추가 PII를 처리하는 공개 베타를 차단");
    }
  });
});
