export interface MutedCommunityAuthor {
  id: string;
  nickname: string;
  mutedAt: string;
}

type ApiFetcher = (path: string, options?: RequestInit) => Promise<Response>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMutedCommunityAuthor(value: unknown): value is MutedCommunityAuthor {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    UUID_PATTERN.test(value.id) &&
    typeof value.nickname === "string" &&
    value.nickname.trim().length > 0 &&
    typeof value.mutedAt === "string" &&
    Number.isFinite(Date.parse(value.mutedAt))
  );
}

export async function listMutedCommunityAuthors(
  apiFetch: ApiFetcher,
): Promise<MutedCommunityAuthor[]> {
  const response = await apiFetch("/api/community/mutes");
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok) {
    const error = isRecord(body) && typeof body.error === "string"
      ? body.error
      : "숨긴 작성자 목록을 불러오지 못했습니다.";
    throw new Error(error);
  }
  if (
    !isRecord(body) ||
    !Array.isArray(body.users) ||
    !body.users.every(isMutedCommunityAuthor)
  ) {
    throw new Error("숨긴 작성자 목록 상태를 확인하지 못했습니다.");
  }
  return body.users;
}

async function updateCommunityAuthorMute(
  userId: string,
  apiFetch: ApiFetcher,
  options: {
    method: "POST" | "DELETE";
    expectedMuted: boolean;
    invalidUserMessage: string;
    requestFailureMessage: string;
    confirmationFailureMessage: string;
  },
): Promise<void> {
  if (!UUID_PATTERN.test(userId)) {
    throw new Error(options.invalidUserMessage);
  }
  const response = await apiFetch("/api/community/mutes", {
    method: options.method,
    body: JSON.stringify({ userId }),
  });
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok) {
    const error = isRecord(body) && typeof body.error === "string"
      ? body.error
      : options.requestFailureMessage;
    throw new Error(error);
  }
  if (!isRecord(body) || body.muted !== options.expectedMuted) {
    throw new Error(options.confirmationFailureMessage);
  }
}

export async function muteCommunityAuthor(
  userId: string,
  apiFetch: ApiFetcher,
): Promise<void> {
  return updateCommunityAuthorMute(userId, apiFetch, {
    method: "POST",
    expectedMuted: true,
    invalidUserMessage: "숨길 작성자를 확인해주세요.",
    requestFailureMessage: "작성자를 숨기지 못했습니다.",
    confirmationFailureMessage: "작성자 숨김 상태를 확인하지 못했습니다.",
  });
}

export async function unmuteCommunityAuthor(
  userId: string,
  apiFetch: ApiFetcher,
): Promise<void> {
  return updateCommunityAuthorMute(userId, apiFetch, {
    method: "DELETE",
    expectedMuted: false,
    invalidUserMessage: "숨김을 해제할 작성자를 확인해주세요.",
    requestFailureMessage: "작성자 숨김을 해제하지 못했습니다.",
    confirmationFailureMessage: "작성자 숨김 해제 상태를 확인하지 못했습니다.",
  });
}
