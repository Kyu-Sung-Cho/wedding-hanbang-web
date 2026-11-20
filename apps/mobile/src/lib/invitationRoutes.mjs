// 청첩장 디자인(2026-11-17 파운더 디자인 아티팩트, 원문: 이 디자인 완전 같아야해)의 화면 이름 → 로그인한
// 커플의 앱 주소.
//
// 화면 컴포넌트는 `InvitationRouteKey`(home·chat·journey·compare·letter·status)만 들고, 주소는 플랫폼이
// 정한다(`@hanbang/shared/invitation` types.ts). 예시 커플 스택의 표는 `ExampleCouple.tsx` 의
// `EXAMPLE_ROUTES` 다. 이 표는 로그인한 커플의 것이다.
//
// 이동 방법은 어디서 부르느냐로 갈린다.
//   - 탭 안(하단 메뉴·홈·준비 순서·일정)에서 탭으로: `navigate`. 탭만 바꾸고 화면을 쌓지 않는다.
//   - 루트 스택 화면(웨딩홀 비교·편지·상담)에서 탭으로: `dismissTo`. push 는 (tabs) 를 한 벌 더 쌓는다
//     (`rootStackChatNavigation.test.mjs` 가 같은 이유로 지킨다).
//   - 웨딩홀 비교와 편지는 루트 스택 화면이다. 탭에서는 push 로 쌓고, 웨딩홀 스택 안에서 비교로 갈 때는
//     아래에 있는 비교로 돌아간다(`dismissTo`, 없으면 그 자리를 비교로 바꾼다).

export const INVITATION_LIVE_ROUTES = Object.freeze({
  home: "/(tabs)/lounge",
  chat: "/(tabs)/chat",
  journey: "/(tabs)/journey",
  compare: "/halls",
  letter: "/halls/letter",
  status: "/(tabs)/schedule",
});

/** 하단 메뉴 칸 → 탭 화면 파일 이름(`app/(tabs)/<이름>.tsx`). */
export const INVITATION_TAB_SCREENS = Object.freeze({
  home: "lounge",
  chat: "chat",
  journey: "journey",
  status: "schedule",
});

export function isInvitationRouteKey(value) {
  return typeof value === "string" && Object.hasOwn(INVITATION_LIVE_ROUTES, value);
}

export function invitationLiveHref(key) {
  if (!isInvitationRouteKey(key)) throw new Error(`unknown invitation route: ${String(key)}`);
  return INVITATION_LIVE_ROUTES[key];
}

/** 탭 화면 이름 → 메뉴 칸. 탭 화면이 아니면 null. */
export function invitationTabKeyForScreen(name) {
  for (const [key, screen] of Object.entries(INVITATION_TAB_SCREENS)) {
    if (screen === name) return key;
  }
  return null;
}

/**
 * 화면 이름으로 옮겨 간다. `from` 은 부르는 화면이 탭 안(`"tabs"`)인지 루트 스택 화면(`"stack"`)인지다.
 * `router` 는 expo-router 의 `router`(시험에서는 기록하는 가짜)다.
 */
export function navigateInvitationRoute(router, key, from) {
  const href = invitationLiveHref(key);
  if (Object.hasOwn(INVITATION_TAB_SCREENS, key)) {
    if (from === "stack") router.dismissTo(href);
    else router.navigate(href);
    return;
  }
  if (key === "compare" && from === "stack") {
    router.dismissTo(href);
    return;
  }
  router.push(href);
}
