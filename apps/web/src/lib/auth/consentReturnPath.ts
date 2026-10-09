import { SIGNUP_CONSENT_PATH } from "@hanbang/shared";

import { getRequestedAuthRedirectPath } from "./safeRedirect";

const DEFAULT_DESTINATION = "/wedding";

function consentPath(destination: string): string {
  return `${SIGNUP_CONSENT_PATH}?${new URLSearchParams({ redirect: destination })}`;
}

export const DEFAULT_CONSENT_RETURN_PATH = consentPath(DEFAULT_DESTINATION);

/** 동의 후 공개 도구로 돌아갈 주소만 보존하고 인증 판정은 바꾸지 않는다. */
export function buildConsentReturnPath(destination: string, origin: string): string {
  const requested = getRequestedAuthRedirectPath(
    new URLSearchParams({ redirect: destination }).toString(),
    origin,
  );
  if (!requested) return DEFAULT_CONSENT_RETURN_PATH;

  try {
    // 인코딩된 경로 이름도 확인한다. 쿼리와 fragment는 원래 값으로 돌려준다.
    const pathname = decodeURIComponent(new URL(requested, origin).pathname);
    if (pathname === SIGNUP_CONSENT_PATH || pathname.startsWith(`${SIGNUP_CONSENT_PATH}/`)) {
      return DEFAULT_CONSENT_RETURN_PATH;
    }
    if (!getRequestedAuthRedirectPath(
      new URLSearchParams({ redirect: pathname }).toString(),
      origin,
    )) {
      return DEFAULT_CONSENT_RETURN_PATH;
    }
    return consentPath(requested);
  } catch {
    return DEFAULT_CONSENT_RETURN_PATH;
  }
}
