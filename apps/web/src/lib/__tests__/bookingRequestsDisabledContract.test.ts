import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd(), "../..");

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), "utf8");
}

describe("booking request public hard-disable contract", () => {
  it("keeps web and mobile submission affordances disabled with honest copy", () => {
    const webVendor = read("apps/web/src/app/(app)/vendors/[id]/page.tsx");
    const mobileVendor = read("apps/mobile/app/vendors/[id].tsx");
    const messageRoute = read("apps/web/src/app/api/messages/route.ts");
    const outcomeRoute = read("apps/web/src/app/api/bookings/[id]/outcome/route.ts");

    expect(webVendor).toContain("const BOOKING_REQUESTS_ENABLED = false");
    expect(webVendor).toContain("const VENDOR_MESSAGES_ENABLED = false");
    expect(webVendor).toContain("disabled={!BOOKING_REQUESTS_ENABLED || selectedSlot === null || booked || booking}");
    expect(webVendor).toContain("업체 연결 준비 중입니다. 현재 상담 요청과 문의는 업체에 전송되지 않습니다.");
    expect(webVendor).toContain("VENDOR_MESSAGES_ENABLED && showMessageBox");
    expect(webVendor).toContain("공개된 운영시간을 확인하고 있어요");
    expect(webVendor).not.toContain("실제 잔여 시간을 확인하고 있어요");
    expect(webVendor).not.toContain("잔여 {remaining}석");

    expect(mobileVendor).toContain("const BOOKING_REQUESTS_ENABLED = false");
    expect(mobileVendor).toContain("disabled={!BOOKING_REQUESTS_ENABLED}");
    expect(mobileVendor).toContain("현재 상담 요청은 업체에 전송되지 않습니다.");
    expect(mobileVendor).toContain("visible={BOOKING_REQUESTS_ENABLED && bookingVisible}");

    expect(messageRoute).toContain("const VENDOR_MESSAGES_ENABLED = false");
    expect(messageRoute).toContain("code: VENDOR_MESSAGES_DISABLED_CODE");
    expect(outcomeRoute).toContain("const BOOKING_OUTCOMES_ENABLED = false");
    expect(outcomeRoute).toContain("code: BOOKING_OUTCOMES_DISABLED_CODE");
  });

  it("keeps historical lists while removing every empty-state prompt to create a new request", () => {
    const webBookings = read("apps/web/src/app/(app)/bookings/page.tsx");
    const mobileBookings = read("apps/mobile/app/bookings/index.tsx");
    const mobileDashboard = read("apps/mobile/app/(tabs)/dashboard.tsx");
    const settings = read("apps/web/src/app/(app)/settings/page.tsx");

    expect(webBookings).toContain("과거·예시 요청 기록");
    expect(webBookings).toContain("신규 상담 요청은 현재 받지 않습니다");
    expect(webBookings).not.toContain("첫 상담 예약 요청을 보내보세요");
    expect(mobileBookings).toContain("과거·예시 요청 기록");
    expect(mobileBookings).toContain("신규 상담 요청은 현재 받지 않아요");
    expect(mobileBookings).toContain("BOOKING_OUTCOMES_ENABLED && completed");
    expect(mobileBookings).toContain("결과 저장과 공개 후기도 현재 지원하지 않아요");
    expect(mobileBookings).not.toContain("업체 상세에서 상담 날짜와 상품을 선택하면 예약이 여기에 모여요");
    expect(mobileBookings).not.toContain("업체 탐색하기");
    expect(mobileDashboard).toContain("const BOOKING_OUTCOMES_ENABLED = false");
    expect(mobileDashboard).toContain("BOOKING_OUTCOMES_ENABLED && (data?.bookingOutcomeTasks?.length ?? 0) > 0");
    expect(mobileDashboard).toMatch(
      /if \(BOOKING_OUTCOMES_ENABLED\)[\s\S]*?\.from\("vendor_bookings"\)/,
    );
    expect(settings).toContain("업체 연결 준비 중에는 상담 요청에 사용하거나 업체에 전송하지 않으며");
    expect(settings).not.toContain("업체 상담 예약 요청 시 연락받을 번호입니다");
  });

  it("keeps historical list responses free of request contact PII", () => {
    const mineRoute = read("apps/web/src/app/api/bookings/mine/route.ts");

    expect(mineRoute).not.toContain('.select("*")');
    expect(mineRoute).not.toMatch(/\.select\([^\n]*(?:bride_name|groom_name|contact_phone|memo)/);
    expect(mineRoute).toContain('contactPhone: ""');
    expect(mineRoute).toContain("과거 요청 기록을 불러오지 못했습니다.");
  });

  it("removes unsupported marketing numbers and active delivery claims", () => {
    const features = read("apps/web/src/components/customer-landing/CustomerFeatures.tsx");
    const painPoints = read("apps/web/src/components/customer-landing/CustomerPainPoints.tsx");
    const footer = read("apps/web/src/components/landing/Footer.tsx");

    expect(features).toContain("업체 연결은 준비 중이며 현재 상담 요청은 전송되지 않습니다.");
    expect(features).not.toContain("문의가 가능한 업체에는 질문을 보내고 전송 결과를 확인");
    expect(painPoints).toContain("스드메 기본금 346만원");
    expect(painPoints).not.toContain("364만원");
    expect(painPoints).not.toContain("50여 개");
    expect(footer).toContain("현재 상담 요청이나 문의를 업체에 전송하지 않습니다");
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

    for (const document of [standard, audit]) {
      expect(document).toContain("BOOKING_REQUESTS_ENABLED=false");
      expect(document).toContain("VENDOR_MESSAGES_ENABLED=false");
      expect(document).toContain("BOOKING_OUTCOMES_ENABLED=false");
      expect(document).toContain("실제 업체 전달");
      expect(document).toContain("수락·거절·변경·취소");
      expect(document).toContain("연락처 보존·철회");
      expect(document).toContain("정식 법적 주체");
      expect(document).toContain("검증된 완료");
    }
  });
});
