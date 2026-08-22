import { hasRecordedSignupConsent } from "@hanbang/shared";

/**
 * 앱을 열었을 때 어디로 보낼지.
 *
 * 컴포넌트에서 떼어낸 이유: 이 판정에는 **순서가 계약**인 자리가 있는데
 * (동의 관문이 프로필 조회보다 앞), React 화면 안에 있으면 그 순서를
 * 테스트로 고정할 방법이 없다. 실제로 모바일에는 화면 렌더 테스트가 없다.
 */
export type RootDestination = "login" | "consent" | "onboarding" | "dashboard";

export type RootGateInput = Readonly<{
  /** 세션이 없으면 로그인. user_metadata 는 getSession() 에 실려 온다. */
  session: { user: { user_metadata?: unknown } } | null;
  /**
   * 프로필. **동의 관문을 통과한 뒤에만 조회한다** — 아래 needsProfile 이
   * false 를 돌려주면 호출부는 조회 자체를 하지 않는다.
   */
  profile: { onboarding_completed?: boolean | null } | null;
}>;

/**
 * 프로필을 조회해야 하는 상태인가.
 *
 * 소셜 로그인 계정은 동의 기록이 없어 어차피 동의 화면으로 간다. 그 전에
 * 프로필을 읽으면 왕복이 하나 늘고, 조회가 실패하면 동의 관문에 닿기도 전에
 * 오류 화면으로 새어 나간다.
 */
// 제네릭 타입 가드로 둔다. 구체 타입으로 좁히면 호출부가 들고 있는 Supabase
// 세션의 나머지 필드(user.id 등)를 잃는다.
export function rootGateNeedsProfile<T extends { user: { user_metadata?: unknown } }>(
  session: T | null,
): session is T {
  if (!session) return false;
  return hasRecordedSignupConsent(session.user.user_metadata);
}

export function resolveRootDestination(input: RootGateInput): RootDestination {
  if (!input.session) return "login";

  // 소셜 로그인은 Supabase 가 계정을 직접 만들어 가입 화면을 거치지 않는다.
  // 동의 화면을 본 적도 기록도 없는 계정이 여기 도착한다. 그리고
  // /api/onboarding 은 모든 클라이언트에 동의를 요구하므로, 이 관문이 없으면
  // 온보딩 제출에서 막힌 채 나갈 길이 없다.
  if (!hasRecordedSignupConsent(input.session.user.user_metadata)) return "consent";

  if (!input.profile || input.profile.onboarding_completed !== true) return "onboarding";
  return "dashboard";
}
