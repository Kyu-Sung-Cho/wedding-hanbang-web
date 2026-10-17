import { decodeHTML } from "entities";

/**
 * 정화된 게시글 HTML을 React/React Native Text에 표시할 평문으로 바꾼다.
 * 태그를 먼저 제거하고 엔티티는 한 번만 해독한다. 반환값을 HTML sink나 저장 입력에 쓰지 않는다.
 */
export function communityContentText(html, tagSeparator = "") {
  return decodeHTML(html.replace(/<[^>]*>/g, tagSeparator));
}
