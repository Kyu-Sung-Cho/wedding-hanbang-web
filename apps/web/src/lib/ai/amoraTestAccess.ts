const AUTH_USER_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** 서버에서 auth.getUser()로 검증한 ID만 전달한다. 관리자 권한은 부여하지 않는다. */
export function isAmoraTestUser(userId: string | null | undefined): boolean {
  if (!userId || !AUTH_USER_ID_PATTERN.test(userId)) return false;
  const configuredIds = process.env.AMORA_TEST_USER_IDS ?? "";
  const normalizedUserId = userId.toLowerCase();
  return configuredIds.split(/[,\r\n]/).some((entry) => {
    const candidate = entry.trim();
    return AUTH_USER_ID_PATTERN.test(candidate)
      && candidate.toLowerCase() === normalizedUserId;
  });
}
