// 판정·요청 조립은 @hanbang/shared 에 있다. 웹과 모바일이 같은 구현을 쓰지
// 않으면 한쪽만 중립이 되는 상태가 생긴다 — 실제로 그랬다.
export {
  buildNeutralPreparationPrefill,
  buildNeutralPreparationSpaceSubmission,
  isValidWeddingDateInput,
  isWeddingPriorityValue,
  parseNeutralPreparationSpaceCapability,
  type NeutralPreparationSpaceSubmission,
} from "@hanbang/shared";

import { getAuthRedirectPath } from "@/lib/auth/safeRedirect";

const NEUTRAL_CHAT_DESTINATION = "/wedding/chat?source=neutral_onboarding";

/**
 * 초안을 붙인다. 초안은 자동 전송이 아니라 입력창 텍스트라서, 사용자가
 * 보내기를 눌러야 나간다 — "확인한 것만 저장"을 지키는 지점이다.
 *
 * 사용자가 명시적으로 요청한 목적지(redirect)에는 붙이지 않는다. 그 사람은
 * 대화를 하러 온 게 아니다.
 */
function withPrefill(destination: string, prefill?: string | null): string {
  if (!prefill) return destination;
  const separator = destination.includes("?") ? "&" : "?";
  return `${destination}${separator}prefill=${encodeURIComponent(prefill)}`;
}

// 리다이렉트만 웹 전용이다 — 모바일은 라우터 경로가 다르다.
export function resolveNeutralPreparationSpaceRedirect(input: {
  search: string;
  origin: string;
  prefill?: string | null;
}): string {
  const requested = new URLSearchParams(input.search).get("redirect");
  if (requested === null) {
    return withPrefill(NEUTRAL_CHAT_DESTINATION, input.prefill);
  }
  const resolved = getAuthRedirectPath(input.search, input.origin);
  if (resolved === "/wedding/lounge" && requested !== "/wedding/lounge") {
    return withPrefill(NEUTRAL_CHAT_DESTINATION, input.prefill);
  }
  return resolved;
}
