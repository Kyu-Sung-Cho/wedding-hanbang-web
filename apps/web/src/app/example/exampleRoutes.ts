import { EXAMPLE_PHOTO_KEYS, type InvitationRouteKey } from "@hanbang/shared/invitation";

/**
 * 예시 커플 화면의 주소. 화면은 이름(`InvitationRouteKey`)으로만 이동하고 여기서 주소가 된다.
 * 실제 커플 화면은 같은 이름을 자기 주소로 바꾼다.
 */
export const EXAMPLE_ROUTES: Readonly<Record<InvitationRouteKey, string>> = {
  home: "/example",
  chat: "/example/chat",
  journey: "/example/journey",
  compare: "/example/halls",
  letter: "/example/halls/letter",
  status: "/example/consultation",
};

export function exampleRoute(key: InvitationRouteKey): string {
  return EXAMPLE_ROUTES[key];
}

const PHOTO_KEYS: ReadonlySet<string> = new Set(EXAMPLE_PHOTO_KEYS);

/** 예시 커플 모델의 사진 이름을 웹 자산 주소로 바꾼다. 모르는 이름은 그리지 않는다. */
export function examplePhotoSrc(photo: string): string | null {
  return PHOTO_KEYS.has(photo) ? `/images/amora/${photo}.webp` : null;
}

/**
 * 탭 제목. 아티팩트 화면 파일의 제목을 그대로 쓴다(홈은 예시 커플 기본 제목).
 * 화면에 보이는 글자가 아니라 브라우저 탭에만 나온다.
 */
export const EXAMPLE_PAGE_TITLES = {
  chat: "아모라와 첫 대화",
  journey: "준비 순서",
  compare: "웨딩홀 비교",
  letter: "보내기 전 확인",
  status: "답장과 상담 확정",
} as const satisfies Partial<Record<InvitationRouteKey, string>>;
