// 첫 대화(조건 묻기)의 "나중에 할게요"를 사람마다 기억한다(2026-11-17).
//
// 이미 쓰던 커플 대부분은 지역·하객 수가 비어 있다. 조건이 비었다고 첫 대화만 보이면 그 커플은 홈에 갇힌다.
// 그래서 건너뛸 수 있게 하고, 건너뛴 사실을 이 기기에 사람마다 적는다(값은 건너뛴 시각뿐이다).
//   - 저장소를 못 읽으면 건너뛴 것으로 본다. 홈이 열린다(갇히는 쪽으로 실패하지 않는다).
//   - 저장소에 못 적으면 그 실행 동안만 기억한다(화면 상태). 다음 실행에서 한 번 더 묻는 것이 최악이다.
//   - 누구인지 모르면 묻지 않는다. 다른 사람이 건너뛴 기록을 이 사람에게 쓰지 않는다.
// 건너뛴 뒤에도 홈의 "두 분이 정할 것" 한 줄(`ASK_CONDITIONS_COPY`)이 첫 대화를 다시 연다.

export const FIRST_CHAT_SKIP_KEY_PREFIX = "@hanbang/invitation_first_chat_later.v1:";

const OWNER_ID = /^[A-Za-z0-9-]{1,64}$/u;

/** 사람마다의 저장 키. 사람 ID 꼴이 아니면 null. */
export function firstChatSkipKey(ownerId) {
  if (typeof ownerId !== "string" || !OWNER_ID.test(ownerId)) return null;
  return `${FIRST_CHAT_SKIP_KEY_PREFIX}${ownerId.toLowerCase()}`;
}

/** 이 사람이 첫 대화를 건너뛰었는가. 저장소가 실패하거나 누구인지 모르면 true(홈을 연다). */
export async function hasSkippedFirstChat(storage, ownerId) {
  const key = firstChatSkipKey(ownerId);
  if (!key) return true;
  try {
    return (await storage.getItem(key)) !== null;
  } catch {
    return true;
  }
}

/** 건너뛴 것을 적는다. 적었으면 true, 못 적었으면 false(던지지 않는다). */
export async function rememberFirstChatSkip(storage, ownerId, nowMs = Date.now()) {
  const key = firstChatSkipKey(ownerId);
  if (!key) return false;
  try {
    await storage.setItem(key, new Date(nowMs).toISOString());
    return true;
  } catch {
    return false;
  }
}
