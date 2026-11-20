// 청첩장 홈 맨 아래 "서비스 메뉴" 줄. 2026-11-20 파운더 결정 4(부모 세션 질문 "앱 업데이트 전 결정 둘(서비스 메뉴
// 줄, 뒤로 가기)을 권하는 대로 할까요?"에 파운더 답 "권하는 대로").
//
// 웹 청첩장 홈 맨 아래 줄(apps/web/src/components/invitation/live/liveRoutes.ts 의 LIVE_MORE_LINKS)과 같은 이름,
// 같은 순서로 다섯 칸만 둔다. 웹 줄의 일정·설정은 파운더께 여쭌 목록에 없어 넣지 않고, 커뮤니티는 웹처럼 넣지 않는다.
// 이름이 웹과 갈라지지 않게 homeServiceMenu.test.mjs 가 두 표를 맞대어 본다.
//
// 홈은 탭 안 화면이고 다섯 화면은 루트 스택 화면이라, 누르면 홈 위에 쌓아 연다(뒤로 가면 홈으로 돌아온다).

export const HOME_SERVICE_MENU_LABEL = "서비스 메뉴";

export const HOME_SERVICE_MENU = Object.freeze([
  Object.freeze({ href: "/budget", label: "예산" }),
  Object.freeze({ href: "/checklist", label: "웨딩 체크리스트" }),
  Object.freeze({ href: "/wedding-code", label: "웨딩코드" }),
  Object.freeze({ href: "/quote-check", label: "견적 확인 도구" }),
  Object.freeze({ href: "/etiquette", label: "예절 가이드" }),
]);
