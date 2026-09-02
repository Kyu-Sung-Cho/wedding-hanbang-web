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
