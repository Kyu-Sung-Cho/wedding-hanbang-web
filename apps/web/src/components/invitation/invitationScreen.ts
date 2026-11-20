import type { InvitationRouteKey } from "@hanbang/shared/invitation";

/**
 * 청첩장 디자인(2026-11-17) 웹 화면들이 함께 쓰는 값.
 * 정본은 파운더 디자인 아티팩트다(원문: "이 디자인 완전 같아야해").
 */

/**
 * 화면 사이 이동. 모델은 이름(`InvitationRouteKey`)만 들고, 쓰는 쪽(예시 커플·실제 커플)이
 * 이름을 주소로 바꾼다. 같은 화면이 두 주소 체계를 함께 쓴다.
 */
export type InvitationRouteResolver = (key: InvitationRouteKey) => string;

/**
 * 모델의 사진 값을 그릴 주소로 바꾼다. 예시 커플은 사진 이름을, 실제 커플은 주소를 넣는다.
 * 바꿀 수 없으면 null 을 돌려주고, 화면은 그 사진을 그리지 않는다.
 */
export type InvitationPhotoResolver = (photo: string) => string | null;

/** 홈과 웹 준비 공간 머리의 보케 사진. 커플 데이터가 아니라 화면 바탕이다. */
export const INVITATION_BACKDROP_SRC = "/images/amora/bokeh-blush.webp";

/** 기본 사진 해석. 같은 사이트 경로와 https 주소만 그대로 쓰고, 나머지는 그리지 않는다. */
export function defaultInvitationPhotoSrc(photo: string): string | null {
  if (photo.startsWith("/") && !photo.startsWith("//")) return photo;
  if (photo.startsWith("https://")) return photo;
  return null;
}

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/**
 * 아티팩트의 글 흐름. 아티팩트는 브라우저 기본값이라 한글을 음절 사이에서 줄바꿈하고
 * ("맞는 웨/딩홀"), 긴 낱말을 억지로 끊지 않는다. 앱 전역 규칙은 body 에 낱말 단위 줄바꿈을,
 * 글 요소마다 아무 데서나 끊기를 걸어 두어서, 뿌리에서 줄바꿈을 기본값으로 되돌리고
 * 안쪽 요소의 끊기 규칙도 기본값으로 덮는다(전역 규칙이 레이어 밖이라 덮을 때 important 가 필요하다).
 */
export const INVITATION_TEXT_FLOW = "break-normal [&_*]:[overflow-wrap:normal]!";

/**
 * 안쪽 요소의 끊기 규칙만 기본값으로 덮는다. 다른 화면(실제 아모라 대화)을 끼워 넣는 칸이 있는
 * 화면은 뿌리 대신 자기가 그리는 부분에만 이것을 건다. 끼운 화면은 앱 기본 글 흐름을 그대로 쓴다.
 */
export const INVITATION_DESCENDANT_WRAP = "[&_*]:[overflow-wrap:normal]!";

/**
 * 폰 화면 뿌리. 아티팩트 화면 틀은 높이가 정해진 세로 단이다(흰 바탕, Noto Sans KR, 먹색 글자,
 * 넘친 것은 잘림). 웹에서는 부모가 준 높이를 채우고, 가운데 칸만 스크롤하며, 아래 행동은 바닥에 붙는다.
 * 줄 높이는 아티팩트처럼 브라우저 기본값으로 되돌린다. 앱 본문은 1.6 이라 그대로 두면 글줄이 길어진다.
 */
export const INVITATION_SCREEN_ROOT = [
  "relative flex min-h-0 flex-1 flex-col overflow-hidden bg-inv-white font-inv-sans leading-[normal] text-inv-ink",
  INVITATION_TEXT_FLOW,
].join(" ");

/**
 * 폰 화면의 가운데 칸. 아티팩트에서는 넘친 내용이 잘리는 칸(`flex: 1; overflow: hidden`)이라,
 * 웹에서는 같은 자리에서 스크롤한다. 스크롤 막대는 폰 화면처럼 숨긴다(막대가 칸 폭을 줄이면
 * 줄바꿈이 아티팩트와 달라진다). 바탕을 흰색으로 채운다. 바탕이 투명한 스크롤 칸은 크롬이 글자를
 * 다른 방식으로 그려서(화면 비교에서 첫 대화의 글자 줄만 달랐다) 아티팩트와 픽셀이 어긋난다.
 */
export const INVITATION_SCROLL_MIDDLE = "min-h-0 flex-1 overflow-y-auto scrollbar-hide bg-inv-white";

/**
 * 아티팩트가 글자색을 적지 않은 단추의 색. 브라우저 기본 단추 글자색(검정)으로 그려지므로 같은
 * 시스템 색을 쓴다(상담 확정의 사진 위 칩, "다른 시간 묻기", 웹 제안 칩). 공유 버튼 변형의 먹색을 덮는다.
 */
export const INVITATION_BUTTON_TEXT = "text-[color:buttontext]!";

/** 링크 줄과 아이콘 링크의 포커스 링. 공유 버튼과 같은 값이다. */
export const INVITATION_FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hb-focus-ring)] focus-visible:ring-offset-2";

/**
 * 아티팩트의 글자 링크는 먹색이고 올리면 흐려진다(아티팩트 전역 링크 규칙).
 * 줄 전체가 링크인 자리와 뒤로 가기 아이콘이 이 규칙을 따른다.
 */
export const INVITATION_LINK_TONE = "text-inv-ink hover:text-inv-muted";
