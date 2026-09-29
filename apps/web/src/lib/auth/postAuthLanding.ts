/**
 * 인증을 마친 사람이 **어디로 가는가** — 한 곳에서만 정한다.
 *
 * 이 판정은 원래 `/api/auth/callback` 안에만 있었다. 메일 링크를 받는
 * `/api/auth/confirm` 이 생기면서 같은 판정이 두 곳에 필요해졌는데, 이 저장소는
 * **같은 판정을 두 곳에 복제했다가 두 판정이 갈려 사람이 두 화면 사이에 갇힌**
 * 전례가 있다(`app/page.tsx` 주석 참조). 그래서 복제하지 않고 여기로 뽑았다.
 *
 * 순서에 이유가 있다: 동의가 온보딩보다 **앞**이다. 온보딩은 이미 제품 사용이라,
 * 동의 기록 없이 온보딩을 시키면 동의 전에 개인정보를 받는 셈이 된다.
 */

import { SIGNUP_CONSENT_PATH, hasRecordedSignupConsent, type SignupConsentUser } from "@hanbang/shared";
import { hasWebSignupConsentAccess } from "./signupConsentAccess";
import { isProviderAuthDestination } from "./safeRedirect";

/**
 * 프로필 한 줄을 읽어 오는 함수. Supabase 클라이언트 전체를 요구하지 않는 이유는
 * 두 가지다 — 테스트가 SDK 를 흉내 내지 않아도 되고, 클라이언트의 깊은 제네릭이
 * 이 호출부에서 추론 폭발(TS2589)을 일으키지 않는다.
 */
export type OnboardingProfileRead = () => PromiseLike<{
  data: { onboarding_completed?: boolean | null } | null;
  error: { message: string } | null;
}>;

export type PostAuthLanding = {
  /** 보낼 곳(같은 출처 경로). */
  path: string;
  /** 온보딩까지 마친 사람에게만 굽는 편의 쿠키를 세울지. */
  markOnboardingComplete: boolean;
};

export async function resolvePostAuthLanding({
  readOnboardingProfile,
  user,
  pendingPath,
  completedPath,
}: {
  readOnboardingProfile: OnboardingProfileRead;
  user: SignupConsentUser;
  /** 아직 온보딩 전인 사람이 갈 곳. */
  pendingPath: string;
  /** 온보딩까지 마친 사람이 갈 곳. */
  completedPath: string;
}): Promise<PostAuthLanding> {
  // 1) 동의가 먼저다. 소셜 가입은 Supabase 가 계정을 직접 만들어 가입 화면을
  //    거치지 않으므로, 그 경로로 온 사람은 동의 기록이 없다.
  const providerDestination = isProviderAuthDestination(completedPath) && pendingPath === completedPath;
  if (!(providerDestination ? hasRecordedSignupConsent(user.app_metadata) : hasWebSignupConsentAccess(user))) {
    const consent = new URLSearchParams({ redirect: pendingPath });
    return { path: `${SIGNUP_CONSENT_PATH}?${consent}`, markOnboardingComplete: false };
  }

  if (providerDestination) {
    return { path: completedPath, markOnboardingComplete: false };
  }

  // 2) 온보딩. 조회에 실패하면 **아직 안 마친 쪽으로 기운다** — 마쳤다고 잘못 보면
  //    프로필 없는 사람을 제품 안으로 들여보내게 된다.
  const { data: profile, error } = await readOnboardingProfile();

  if (error) console.error("인증 후 착지: 프로필 조회 실패:", error.message);

  if (!profile || !profile.onboarding_completed) {
    return { path: pendingPath, markOnboardingComplete: false };
  }

  return { path: completedPath, markOnboardingComplete: true };
}
