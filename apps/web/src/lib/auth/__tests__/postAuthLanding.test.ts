// @vitest-environment node

/**
 * 인증 후 착지 순서를 고정한다. 동의가 온보딩보다 **앞**이어야 한다 —
 * 온보딩은 이미 제품 사용이고 개인정보를 받는다.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolvePostAuthLanding } from "../postAuthLanding";

const CONSENTED = { terms_agreed: true, privacy_agreed: true };
const PENDING = "/wedding/onboarding";
const DONE = "/wedding/lounge";

function reader(onboardingCompleted: boolean | null, error: { message: string } | null = null) {
  return vi.fn().mockResolvedValue({
    data: error ? null : { onboarding_completed: onboardingCompleted },
    error,
  });
}

describe("인증 후 착지", () => {
  beforeEach(() => vi.stubEnv("SIGNUP_CONSENT_LEGACY_BEFORE", "2026-09-01T00:00:00.000Z"));
  it("동의 기록이 없으면 온보딩보다 먼저 동의로 보낸다", async () => {
    const read = reader(true);
    const landing = await resolvePostAuthLanding({
      readOnboardingProfile: read,
      user: { created_at: "2026-08-30T00:00:00.000Z", user_metadata: {} },
      pendingPath: PENDING,
      completedPath: DONE,
    });

    expect(landing.path.startsWith("/consent")).toBe(true);
    expect(landing.path).toContain(`redirect=${encodeURIComponent(PENDING)}`);
    expect(landing.markOnboardingComplete).toBe(false);
    // 동의 전에는 프로필을 읽을 이유가 없다.
    expect(read).not.toHaveBeenCalled();
  });

  it("필수 동의가 하나라도 빠지면 통과시키지 않는다", async () => {
    for (const metadata of [
      { terms_agreed: true },
      { privacy_agreed: true },
      { terms_agreed: true, privacy_agreed: false },
      null,
      undefined,
    ]) {
      const landing = await resolvePostAuthLanding({
        readOnboardingProfile: reader(true),
        user: { created_at: "2026-08-30T00:00:00.000Z", user_metadata: metadata },
        pendingPath: PENDING,
        completedPath: DONE,
      });
      expect(landing.path.startsWith("/consent"), JSON.stringify(metadata)).toBe(true);
    }
  });

  it("동의했고 온보딩 전이면 온보딩으로 보낸다", async () => {
    const landing = await resolvePostAuthLanding({
      readOnboardingProfile: reader(false),
      user: { created_at: "2026-08-30T00:00:00.000Z", user_metadata: CONSENTED },
      pendingPath: PENDING,
      completedPath: DONE,
    });
    expect(landing.path).toBe(PENDING);
    expect(landing.markOnboardingComplete).toBe(false);
  });

  it("다 마쳤으면 목적지로 보내고 그때만 완료 쿠키를 세운다", async () => {
    const landing = await resolvePostAuthLanding({
      readOnboardingProfile: reader(true),
      user: { created_at: "2026-08-30T00:00:00.000Z", user_metadata: CONSENTED },
      pendingPath: PENDING,
      completedPath: DONE,
    });
    expect(landing.path).toBe(DONE);
    expect(landing.markOnboardingComplete).toBe(true);
  });

  it("프로필을 못 읽으면 '마쳤다'가 아니라 '아직'으로 기운다", async () => {
    // 마쳤다고 잘못 보면 프로필 없는 사람을 제품 안으로 들여보낸다.
    const landing = await resolvePostAuthLanding({
      readOnboardingProfile: reader(null, { message: "boom" }),
      user: { created_at: "2026-08-30T00:00:00.000Z", user_metadata: CONSENTED },
      pendingPath: PENDING,
      completedPath: DONE,
    });
    expect(landing.path).toBe(PENDING);
    expect(landing.markOnboardingComplete).toBe(false);
  });
});
