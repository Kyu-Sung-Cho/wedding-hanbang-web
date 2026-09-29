/** SDK 버전이나 실행 환경에 관계없이 구조화된 비밀번호 오류만 안내한다. */
export function getPasswordErrorMessage(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;

  const code = "code" in error ? error.code : undefined;
  if (code === "same_password") {
    return "지금 쓰는 비밀번호와 다른 비밀번호를 입력해 주세요.";
  }
  const isWeakPassword = typeof code === "string"
    ? code === "weak_password"
    : "name" in error && error.name === "AuthWeakPasswordError";
  if (!isWeakPassword) return null;

  const reasons = "reasons" in error ? error.reasons : undefined;
  if (Array.isArray(reasons) && reasons.includes("pwned")) {
    return "유출된 적이 있는 비밀번호는 사용할 수 없어요. 다른 사이트에서 쓰지 않는 새 비밀번호를 입력해 주세요.";
  }
  return "보안 기준에 맞지 않는 비밀번호예요. 더 길고 추측하기 어려운 새 비밀번호를 입력해 주세요.";
}
