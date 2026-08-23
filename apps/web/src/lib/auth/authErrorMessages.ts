/**
 * 로그인 화면이 보여줄 오류 문장.
 *
 * 예전에는 URL 의 `?error=` 값을 **그대로** 화면에 붙였다. 그래서
 * `로그인 오류: no_code`, `로그인 오류: Not a valid PKCE flow url.` 같은 내부
 * 표현이 사용자에게 노출됐고, 값이 URL 에서 오므로 **누구나 아무 문장이나
 * 띄울 수 있었다**(링크만 보내면 된다).
 *
 * 그래서 아는 코드만 우리말로 옮기고, 모르는 값은 **버린다.** 원문은 서버 로그에
 * 남기고 화면에는 올리지 않는다.
 */

export const AUTH_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  no_code: "로그인을 마치지 못했어요. 다시 시도해주세요.",
  no_user: "로그인 정보를 확인하지 못했어요. 다시 시도해주세요.",
  session_failed: "로그인을 마치지 못했어요. 다시 시도해주세요.",
  // 메일 링크 계열 — 사용자가 할 수 있는 다음 행동을 문장 안에 넣는다.
  link_invalid: "이 링크로는 확인할 수 없어요. 메일에 있는 버튼을 다시 눌러주세요.",
  link_expired: "링크의 유효 시간이 지났어요. 새 메일을 받아 다시 시도해주세요.",
  // 가입 확인 링크가 이미 쓰인 경우. **계정은 인증이 끝났을 가능성이 높다** —
  // 메일 앱이 링크를 앱 안에서 먼저 열어 토큰을 태우는 일이 흔하다. 그 사람에게
  // "새 메일을 받으세요"는 틀린 안내다. 할 일 순서대로 말한다.
  signup_link_used: "이미 인증이 끝난 링크예요. 아래에서 바로 로그인해 주세요. 로그인이 안 되면 새 메일을 받아 다시 시도해주세요.",
  verify_failed: "인증을 마치지 못했어요. 새 메일을 받아 다시 시도해주세요.",
  access_denied: "인증이 취소됐어요. 다시 시도해주세요.",
};

/** 아는 코드가 아닐 때 쓰는 문장. 원인을 추측해서 말하지 않는다. */
export const AUTH_ERROR_FALLBACK = "로그인을 마치지 못했어요. 잠시 후 다시 시도해주세요.";

/**
 * 화면에 띄울 문장. 오류가 없으면 null.
 *
 * 모르는 코드에도 폴백 문장을 준다 — 무언가 잘못됐다는 사실 자체는 알려야 한다.
 * 다만 **그 코드의 원문은 절대 섞지 않는다.**
 */
export function authErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  return AUTH_ERROR_MESSAGES[code] ?? AUTH_ERROR_FALLBACK;
}
