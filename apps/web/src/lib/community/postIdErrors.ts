/**
 * 주소의 글 id 가 UUID 가 아닐 때 Postgres 가 내는 오류를 가려낸다.
 *
 * `22P02` 는 `invalid_text_representation` 이다. `community_posts.id` 는 uuid 라
 * `/wedding/community/post/1` 같은 주소는 **비교 자체가 불가능**해서 여기로 온다.
 *
 * 이것을 "읽기 실패" 로 다루면 화면이 「글을 불러오지 못했어요 · 잠시 뒤 다시 시도해
 * 주세요」를 띄우는데, 그 주소는 다시 시도해도 영원히 같다. 행이 없는 것과 같은
 * 답 — 「글을 찾을 수 없어요」 — 이 사실이다.
 *
 * 읽는 쪽이 로그인 상태냐 아니냐에 따라 다른 클라이언트를 타므로(뷰어 클라이언트 /
 * 공개 로더) 판정이 한 곳에 있어야 두 화면이 갈리지 않는다.
 */
const INVALID_TEXT_REPRESENTATION = "22P02";

export function isMalformedPostIdError(error: unknown): boolean {
  return (
    typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === INVALID_TEXT_REPRESENTATION
  );
}

/**
 * `community_posts.id` 가 될 수 있는 모양인가.
 *
 * 오류를 **받은 뒤에** 판정하면, 그 오류가 나기까지 지나온 인증·서비스 클라이언트
 * 단계 중 하나가 먼저 던질 수 있다. 그러면 없는 글 주소가 404 가 아니라 500 이 된다 —
 * 2026-09-02 운영 실측에서 `/api/community/posts/1` 이 실제로 그랬다.
 *
 * 그래서 **아무것도 하기 전에** 모양부터 본다. 이 모양이 아니면 어떤 행과도 비교될 수
 * 없으므로 누구에게도 없는 글이다.
 *
 * 버전·variant 비트는 보지 않는다. 여기서 그것까지 요구하면 uuid 생성 방식이 바뀌는
 * 날 **살아 있는 글이 404** 가 된다 — 이 검사가 막으려는 것보다 나쁜 사고다.
 */
const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export function couldBePostId(value: unknown): value is string {
  return typeof value === "string" && CANONICAL_UUID.test(value);
}
