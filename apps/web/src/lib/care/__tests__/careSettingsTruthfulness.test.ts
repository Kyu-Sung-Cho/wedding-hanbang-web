import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/app/(app)/settings/page.tsx"),
  "utf8",
);
const dashboardSource = readFileSync(
  resolve(process.cwd(), "src/app/(app)/dashboard/page.tsx"),
  "utf8",
);
const onboardingSource = readFileSync(
  resolve(process.cwd(), "src/components/onboarding/WeddingDetails.tsx"),
  "utf8",
);

describe("web proactive-care settings truthfulness", () => {
  it("uses the authenticated profile API availability instead of guessing delivery state", () => {
    expect(source).toContain('fetch("/api/profile"');
    expect(source).toContain("parseCareAvailability");
    expect(source).toContain("careAvailability?.emailVerified");
    expect(source).toContain("canChangeCareConsent");
  });

  it("distinguishes preparation, pause, and unverified-email states", () => {
    expect(source).toContain("현재 준비 중이에요");
    expect(source).toContain("발송이 일시중지됐어요");
    expect(source).toContain("가입 이메일 인증을 마치면 이메일 안내도 받을 수 있어요");
  });

  it("does not promise proactive delivery before feature availability and consent are known", () => {
    for (const publicSource of [dashboardSource, onboardingSource]) {
      expect(publicSource).not.toContain("3일 전부터 먼저 챙겨드릴 수 있어요");
      expect(publicSource).not.toContain("3일 전·전날·다음날에 아모라가 먼저 챙겨드려요");
    }
    expect(dashboardSource).toContain("알림 수신 여부는 설정에서 따로 선택");
    expect(onboardingSource).toContain("알림은 기능 제공 상태와 수신 설정에 따라 별도로 안내");
  });
});
