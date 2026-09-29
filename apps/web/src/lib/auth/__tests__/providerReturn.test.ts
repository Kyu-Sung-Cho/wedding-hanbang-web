// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { getPostLoginRedirectPath } from "../safeRedirect";
import { resolvePostAuthLanding } from "../postAuthLanding";
import { buildSignupConsentServerEvidence } from "@hanbang/shared";

describe("제공자 로그인 복귀", () => {
  it.each(["/provider", "/business/register", "/business/inquiry"])("%s는 커플 온보딩을 요구하지 않는다", async (path) => {
    const requested = `?redirect=${encodeURIComponent(path)}`;
    expect(getPostLoginRedirectPath(requested, "https://hanbang.ai", false)).toBe(path);
    const read = vi.fn();
    const result = await resolvePostAuthLanding({
      user: { app_metadata: { signup_consent: buildSignupConsentServerEvidence({ termsAgreed: true, privacyAgreed: true, ageOver14Confirmed: true, marketingAgreed: false, consentPolicyVersion: "2026-09-28" }, "2026-09-28T00:00:00.000Z") } },
      readOnboardingProfile: read, pendingPath: path, completedPath: path,
    });
    expect(result).toEqual({ path, markOnboardingComplete: false });
    expect(read).not.toHaveBeenCalled();
  });
  it("제공자도 개인정보 동의를 건너뛸 수 없다", async () => {
    const result = await resolvePostAuthLanding({ user: { user_metadata: {} }, readOnboardingProfile: vi.fn(), pendingPath: "/provider", completedPath: "/provider" });
    expect(result.path).toBe("/consent?redirect=%2Fprovider");
  });
  it("구계정의 자기기입 동의만으로 제공자 권한을 받지 않는다", async () => {
    const result = await resolvePostAuthLanding({ user: { created_at: "2026-01-01T00:00:00.000Z", user_metadata: { terms_agreed: true, privacy_agreed: true } }, readOnboardingProfile: vi.fn(), pendingPath: "/provider", completedPath: "/provider" });
    expect(result.path).toBe("/consent?redirect=%2Fprovider");
  });
  it.each(["/provider-evil", "/provider/../chat", "//evil.test/provider", "/api/provider"])("%s는 예외로 취급하지 않는다", (path) => {
    expect(getPostLoginRedirectPath(`?redirect=${encodeURIComponent(path)}`, "https://hanbang.ai", false)).toMatch(/^\/wedding\/onboarding/);
  });
});
