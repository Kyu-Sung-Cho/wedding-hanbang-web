/**
 * 로그인 앱 사이드바(`Sidebar.tsx`)와 로그인 없이 읽는 예절 가이드 사이드바
 * (`app/manners/layout.tsx`)가 쓰는 모양 한 벌.
 *
 * ## 왜 한 곳에 두나
 *
 * 사이드바가 페이지마다 다른 모양으로 그려졌다. 라운지·체크리스트·예산·일정·웨딩코드는 너비
 * 216px에 항목 간격 2px, 아모라는 220px에 4px, 설정 같은 나머지는 256px에 항목이 전부 굵은
 * 글씨였다. 메뉴를 하나씩 눌러 볼 때마다 목록의 간격·굵기·크기가 바뀌어 보인 까닭이다.
 * 예절 가이드는 아예 다른 레이아웃이라 같은 모양을 손으로 한 번 더 적어 두었고, 그 사본이
 * 앱 쪽과 어긋나 있었다.
 *
 * 모양을 값으로 내보내 두 사이드바가 같은 문자열을 쓰게 하면, 한쪽만 고쳐서 다시 갈라지는
 * 일이 없다. 색은 `.amora-workspace` 가 정의하는 토큰만 쓴다. 이 토큰은 그 클래스나
 * `.planning-workspace` 가 붙은 요소 안에서만 값이 있으므로, 둘 다 없는 화면에서도 같은 색이
 * 나오도록 로그인 사이드바가 `amora-workspace` 를 직접 단다(예절 가이드 루트는 후자를 단다).
 */

/** 사이드바 너비. 본문 왼쪽 여백(`SIDEBAR_OFFSET_CLASS`)과 같은 숫자여야 한다. */
export const SIDEBAR_WIDTH_CLASS = "w-[220px]";

/** 데스크톱에서 사이드바 오른쪽 본문이 비켜 서는 폭. */
export const SIDEBAR_OFFSET_CLASS = "md:ml-[220px]";

/** 메뉴 항목 하나. 활성이 아니어도 같은 크기·굵기이고, 활성만 굵어진다. */
export const SIDEBAR_ITEM_CLASS =
  "flex min-h-11 items-center gap-[11px] rounded-[9px] px-3 py-[10px] text-[14.5px] transition-colors";

export const SIDEBAR_ITEM_IDLE_CLASS =
  "text-[var(--amora-soft)] hover:bg-[var(--amora-warm)] hover:text-[var(--amora-ink)]";

export const SIDEBAR_ITEM_ACTIVE_CLASS =
  "bg-[var(--amora-selected-bg)] font-semibold text-[var(--amora-selected-text)] ring-1 ring-inset ring-[var(--amora-selected-line)]";

/** 항목 사이 세로 간격. */
export const SIDEBAR_LIST_CLASS = "flex flex-col gap-1";
