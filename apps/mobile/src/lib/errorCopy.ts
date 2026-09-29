import { getPasswordErrorMessage } from "@hanbang/shared";

/**
 * 서버·SDK 가 영어로 던진 오류를 사용자가 읽을 수 있는 한국어로 바꾼다.
 *
 * ## 왜 필요했나
 *
 * 번역이 아예 없던 게 아니다. 설정 화면과 커뮤니티 글쓰기에 같은 블록이 복사돼 있었다.
 *
 *     message.includes("permission") ? "권한이 없습니다…"
 *     : message.includes("network")  ? "네트워크 오류가…"
 *     : message                       ← 못 잡으면 영어 원문을 그대로 띄운다
 *
 * 그런데 조건이 전부 소문자다. 실제로 오는 문구는 대문자로 시작한다.
 *
 *     "Network request failed"   → includes("network")    빗나감
 *     "Permission denied"        → includes("permission")  빗나감
 *
 * 즉 가장 흔한 두 오류가 정확히 번역을 비껴가고, 한국어 앱에서 영어 문장이 뜬다.
 * 비밀번호 변경은 번역 자체가 없어서 "New password should be different from the old
 * password." 를 그대로 보여줬다.
 *
 * ## 못 알아본 오류는 어떻게 하나
 *
 * 영어 원문을 그대로 띄우지 않는다. 사용자는 무엇이 잘못됐는지 추측해야 하고, 서비스가
 * 덜 만들어졌다는 인상만 남는다. 다만 **한글이 섞인 문구는 그대로 보낸다** — 그건 우리가
 * 쓴 문구이고, 대개 이 함수가 만들 수 있는 어떤 말보다 정확하다.
 */

/** 한글이 하나라도 있으면 우리가 쓴 문구로 본다. */
function hasHangul(value: string): boolean {
  return /[가-힣]/u.test(value);
}

const TRANSLATIONS: ReadonlyArray<readonly [RegExp, string]> = [
  // 네트워크. RN 의 fetch 실패는 "Network request failed" 로 온다.
  [/network|fetch failed|timeout|timed out/u, "네트워크가 불안정해요. 연결을 확인한 뒤 다시 시도해 주세요."],
  // 권한·인증. 토큰이 만료된 경우가 대부분이라 다시 로그인이 실제 해결책이다.
  [/permission|not authorized|unauthorized|jwt|token/u, "로그인이 만료됐어요. 다시 로그인한 뒤 시도해 주세요."],
  // 비밀번호 변경에서 실제로 오는 문구들.
  [/should be different from the old password/u, "지금 쓰는 비밀번호와 다른 비밀번호를 입력해 주세요."],
  [/password.*(?:at least|too short|6 characters)/u, "비밀번호는 6자 이상이어야 해요."],
  [/weak password|password is too weak/u, "더 안전한 비밀번호가 필요해요. 길게 쓰거나 숫자·기호를 섞어 주세요."],
  // 중복. 커뮤니티 글쓰기에서 쓰던 조건을 유지한다.
  [/duplicate/u, "이미 같은 내용이 저장돼 있어요."],
  // 용량·요청 한도.
  [/too large|payload/u, "보내려는 내용이 너무 커요. 길이를 줄여 주세요."],
  [/rate limit|too many requests/u, "잠시 뒤에 다시 시도해 주세요."],
];

const FALLBACK = "잠시 문제가 있었어요. 잠시 뒤 다시 시도해 주세요.";

/**
 * @param raw 잡은 오류의 메시지. 비어 있으면 fallback.
 * @param fallback 이 자리에 맞는 기본 문구가 따로 있으면 넘긴다.
 */
export function toKoreanErrorMessage(raw: unknown, fallback: string = FALLBACK): string {
  const passwordMessage = getPasswordErrorMessage(raw);
  if (passwordMessage) return passwordMessage;

  const message = raw instanceof Error ? raw.message : typeof raw === "string" ? raw : "";
  const trimmed = message.trim();
  if (trimmed === "") return fallback;

  // 우리가 쓴 한국어 문구는 손대지 않는다. 서버가 상황을 더 잘 안다.
  if (hasHangul(trimmed)) return trimmed;

  const lowered = trimmed.toLowerCase();
  for (const [pattern, korean] of TRANSLATIONS) {
    if (pattern.test(lowered)) return korean;
  }
  return fallback;
}
