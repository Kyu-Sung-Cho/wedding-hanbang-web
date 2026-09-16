// 이동·인증·전송은 호출부가 소유한다. 아모라 질문 컨트롤의 표시만 공유한다.
const AMORA_ACTION_BASE = "inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-xl border border-[var(--hb-amora-line,#8F6662)] bg-[var(--hb-amora-surface,#FBF8F2)] text-[var(--hb-amora-ink,#7D5753)] transition-colors duration-150 hover:bg-[var(--hb-amora-hover,#EADDD8)] active:bg-[var(--hb-amora-hover,#EADDD8)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hb-focus-ring)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-[var(--hb-amora-surface,#FBF8F2)] motion-reduce:transition-none";

export const AMORA_ACTION_CLASS = `${AMORA_ACTION_BASE} px-4 py-2 text-sm font-medium`;

export const AMORA_FAB_CLASS = "inline-flex items-center justify-center rounded-full border border-[var(--hb-amora-line,#8F6662)] bg-[var(--hb-amora-surface,#FBF8F2)] text-[var(--hb-amora-ink,#7D5753)] shadow-lg transition-colors hover:bg-[var(--hb-amora-hover,#EADDD8)] active:bg-[var(--hb-amora-hover,#EADDD8)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hb-focus-ring)] focus-visible:ring-offset-2 motion-reduce:transition-none";

// 2026-09-16 파운더 결정: 체크리스트·예절 가이드의 아모라 버튼에서 테두리를 뺀다.
// 원문: "아모라 버튼에 있는 거 테두리 라인은 빼고 … 옆에 아이콘이랑 크기 다 맞추고
// 아모라만 커 이상해". 그 두 화면의 형제 컨트롤(가이드 아이콘·번호 배지)은 선 없는
// 연한 칩이라, 테두리를 두른 44px 아모라만 한 단계 큰 물건으로 읽혔다.
//
// 글자가 함께 있는 `AMORA_ACTION_CLASS` 와 플로팅 `AMORA_FAB_CLASS` 는 테두리를 유지한다 —
// 그곳에서는 테두리가 "누를 수 있는 것"의 유일한 경계다. 테두리 있는 아이콘 전용
// 변형(`AMORA_ICON_ACTION_CLASS`)은 쓰는 곳이 없어져 함께 지웠다.
const AMORA_QUIET_BASE = "inline-flex shrink-0 items-center justify-center bg-[var(--amora-low,#F1E8DA)] text-[var(--amora-rose-deep,#7D5753)] transition-colors duration-150 hover:bg-[var(--amora-rose-pale,#EADDD8)] active:bg-[var(--amora-rose-pale,#EADDD8)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hb-focus-ring)] focus-visible:ring-offset-2 motion-reduce:transition-none";

/**
 * 형제 아이콘과 같은 32px 칩. 체크리스트 카드처럼 **옆에 같은 급의 아이콘이 있는**
 * 자리에만 쓴다. 그 자리(md 이상에서만 보이는 카드 액션)는 마우스 대상이고
 * WCAG 2.5.8 의 AA 최소(24px) 위다.
 */
export const AMORA_QUIET_ICON_ACTION_CLASS = `${AMORA_QUIET_BASE} size-8 rounded-[7px]`;

/** 형제가 없는 자리의 선 없는 44px 칩. 예절 가이드 목록 카드가 쓴다. */
export const AMORA_QUIET_TOUCH_ACTION_CLASS = `${AMORA_QUIET_BASE} size-11 rounded-xl`;

/**
 * 손대상은 44px 로 두고 **보이는 칩만** 옆 배지에 맞추는 자리. 예절 가이드의 절 제목은
 * 30/34px 번호 배지 옆에 오므로, 칩을 그 크기로 맞추되 누르는 영역은 44px 을 지킨다.
 */
export const AMORA_QUIET_TARGET_CLASS = "group inline-flex size-11 shrink-0 items-center justify-center rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hb-focus-ring)] focus-visible:ring-offset-2";
export const AMORA_QUIET_CHIP_CLASS = "flex size-[30px] items-center justify-center rounded-[9px] bg-[var(--amora-low,#F1E8DA)] text-[var(--amora-rose-deep,#7D5753)] transition-colors duration-150 group-hover:bg-[var(--amora-rose-pale,#EADDD8)] motion-reduce:transition-none sm:size-[34px] sm:rounded-[10px]";
