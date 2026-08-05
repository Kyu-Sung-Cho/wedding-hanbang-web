const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const SHARED_ACTION_ACTOR_MISMATCH = "AMORA_SHARED_ACTION_ACTOR_MISMATCH";

/**
 * 공동 승인은 "누가 눌렀는가"가 곧 동의의 주체다. 버튼을 누른 사용자와 요청이 실제로
 * 나가는 시점의 세션 주인이 다르면, 누르지 않은 사람의 동의가 기록된다.
 *
 * 그래서 이 검사는 요청을 보내기 **전에** 실행하고, 조금이라도 확신이 없으면 거부한다.
 * 어느 한쪽이 비어 있거나 사용자 ID 형태가 아니면 같은 값이라도 신원으로 인정하지 않는다.
 *
 * 이것은 클라이언트 containment다. 서버의 actor-bound command와 DB 검증을 대신하지
 * 않는다(handoff §8.6).
 */
export function assertSharedActionActor(expectedUserId, sessionUserId) {
  if (
    typeof expectedUserId !== "string"
    || typeof sessionUserId !== "string"
    || !UUID_PATTERN.test(expectedUserId)
    || !UUID_PATTERN.test(sessionUserId)
    || expectedUserId.toLowerCase() !== sessionUserId.toLowerCase()
  ) {
    throw new Error(SHARED_ACTION_ACTOR_MISMATCH);
  }
}

/**
 * 같은 규칙이 공동 승인 말고도 필요하다. 채팅 전송은 "보내는 문장의 주인"이 걸린
 * 문제이고(P0-1), 승인과 똑같이 전송 시점 세션을 다시 읽는 구조였다. 규칙이 하나여야
 * 한쪽만 고쳐지는 일이 생기지 않으므로 별도 구현을 만들지 않고 이 이름을 함께 쓴다.
 */
export const assertAmoraRequestActor = assertSharedActionActor;
