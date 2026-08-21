// 판정·요청 조립은 @hanbang/shared 에 있다. 웹과 모바일이 같은 구현을 쓰지
// 않으면 한쪽만 중립이 되는 상태가 생긴다 — 실제로 그랬다.
export {
  buildNeutralPreparationSpaceSubmission,
  parseNeutralPreparationSpaceCapability,
  type NeutralPreparationSpaceSubmission,
} from "@hanbang/shared";

import { getAuthRedirectPath } from "@/lib/auth/safeRedirect";

// 리다이렉트만 웹 전용이다 — 모바일은 라우터 경로가 다르다.
export function resolveNeutralPreparationSpaceRedirect(input: {
  search: string;
  origin: string;
}): string {
  const requested = new URLSearchParams(input.search).get("redirect");
  if (requested === null) {
    return "/wedding/chat?source=neutral_onboarding";
  }
  const resolved = getAuthRedirectPath(input.search, input.origin);
  if (resolved === "/wedding/lounge" && requested !== "/wedding/lounge") {
    return "/wedding/chat?source=neutral_onboarding";
  }
  return resolved;
}
