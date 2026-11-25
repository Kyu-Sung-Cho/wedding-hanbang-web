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
  it("offers a new opt-in only through the control that hides itself when no care path can run", () => {
    // 2026-11-13 10장 P1: 동의 화면을 연다. 켤 수 있는 경로가 하나도 없으면 칸을 그리지
    // 않는다는 것은 AmoraCarePreferenceControl.test.tsx 가 렌더링으로 잰다. 여기서는 설정
    // 화면이 그 칸 말고 다른 길로 켜기를 내놓지 않는지 본다.
    expect(source).toContain(
      "<AmoraCarePreferenceControl onAvailabilityChange={setCareControlAvailable} />",
    );
    expect(source).not.toContain("care_notifications_enabled: true");
    expect(source).not.toContain("parseCareAvailability");
    expect(source).not.toContain("canChangeCareConsent");
    expect(source).not.toContain("아모라 먼저 챙기기");
    expect(source).not.toContain("이메일로 먼저 챙겨드려요");
  });

  it("preserves an opt-out only for users with a valid historical consent", () => {
    expect(source).toContain("profile?.care_notifications_enabled === true");
    expect(source).toContain("profile.care_notifications_consented_at.trim().length > 0");
    // 새 칸이 그려지면 켜기와 끄기를 그 칸이 맡는다. 그렇지 않을 때는 예전 해제 칸이 남는다.
    expect(source).toContain("hasLegacyCareConsent && !careControlAvailable &&");
    expect(source).toContain("care_notifications_enabled: false");
    expect(source).toContain("이전 이메일 수신 동의");
    expect(source).toContain("이메일 수신 동의 해제");
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
