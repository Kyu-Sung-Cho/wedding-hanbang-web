import { redirect } from "next/navigation";

/**
 * /community/my 는 "내 활동" 진입점.
 * 별도 UI는 두지 않고 기본 탭(내가 쓴 글)으로 즉시 보낸다.
 * 각 하위 페이지에서 좌측 사이드바로 북마크/좋아요 탭을 전환할 수 있다.
 */
export default function MyActivityIndex() {
  redirect("/community/my/posts");
}
