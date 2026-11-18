/**
 * 첫 실행 튜토리얼 — 앱 쪽 배선.
 *
 * ## 왜 판정이 화면이 아니라 여기 있나
 *
 * 안내는 이미 두 벌 있었는데 아무 데서도 실행되지 않았다(`src/components/AppGuide.tsx`는
 * import하는 파일이 0개였다). 화면을 또 만드는 것보다 "언제 뜨는가"를 소유하는 자리가
 * 필요했고, 그 자리는 화면 안이 아니라 밖이어야 한다 — 라운지 화면은 `node --test`에서
 * 돌지 않아서, 조건이 그 안에 있으면 조건은 영영 테스트 밖에 남는다.
 *
 * 그래서 이 모듈은 react-native를 import하지 않는다. Supabase도, AsyncStorage도 직접
 * 부르지 않고 호출하는 쪽이 넘긴 함수·저장소로만 일한다.
 *
 * ## 왜 읽기 실패가 "아직 안 봤다"인가
 *
 * `supabase/migrations/20260819090000_first_run_tutorial_state.sql`은 아직 운영 DB에
 * 적용되지 않았다. 그 상태에서 컬럼을 select하면 42703으로 실패하는데, 그걸 일반 오류로
 * 다루면 라운지 첫 화면이 통째로 오류가 된다. 안내 플래그 하나 때문에.
 *
 * 그래서 어떤 실패든 "아직 안 봤다"로 떨어진다. 이 방향의 최악은 "안내를 한 번 더 본다"
 * 이고, 반대 방향은 "처음 온 사람이 아무 안내도 못 받는다"다.
 */

import {
  FIRST_RUN_TUTORIAL_SESSION_KEY,
  FIRST_RUN_TUTORIAL_VERSION,
  isMissingFirstRunTutorialColumn,
  parseFirstRunTutorialState,
  type FirstRunTutorialState,
} from "@hanbang/shared";

/** 하단 메뉴와 FAB 사이 숨 쉬는 간격. */
export const AMORA_FAB_GAP = 20;

/** 아모라 FAB의 지름. `AmoraFab.tsx`의 button 스타일과 같아야 한다. */
export const AMORA_FAB_SIZE = 58;

/**
 * 말풍선이 떠 있을 때 FAB 위로 더 차지하는 높이.
 *
 * 세 줄(13/20) 60 + 위아래 padding 12·2 + 테두리 1·2 + 버튼과의 간격 12 = 98.
 * 말풍선은 첫마디가 놓이는 자리라, 콘텐츠 여백을 잴 때 없는 것처럼 다루면 처음 온 사람의
 * 마지막 카드가 정확히 그 순간 가려진다.
 */
export const AMORA_FAB_BUBBLE_HEIGHT = 98;

/**
 * FAB이 화면 바닥에서 얼마나 떠 있어야 하는가.
 *
 * 2026-11-17(파운더 디자인 아티팩트, 원문: 이 디자인 완전 같아야해)부터 하단 메뉴는 화면 위에 겹쳐 떠 있다
 * (`InvitationTabBar`: 높이 64, 화면 아래에서 22px 또는 홈 표시줄 안전 영역). 예전에는 탭바가 레이아웃
 * 공간을 차지해(static) 화면 컨테이너의 bottom 이 이미 탭바 위였고 간격 하나만 더하면 됐다. 이제 탭 화면은
 * 메뉴 아래까지 뻗으므로 버튼은 메뉴가 차지한 높이 위에 간격 하나를 두고 뜬다.
 *
 * 메뉴 높이를 이 파일에 다시 적지 않는다. 부르는 쪽이 메뉴에서 잰 값(`invitationTabBarClearance`)을 넘긴다 —
 * 두 곳에 리터럴을 두면 한쪽만 고쳐져 버튼이 메뉴 위에 걸친다.
 */
export function getAmoraFabBottomOffset(tabBarClearance: number): number {
  return tabBarClearance + AMORA_FAB_GAP;
}

/**
 * 라운지 스크롤 콘텐츠의 아래 여백 중 FAB 몫(메뉴 위로 더 비워야 하는 높이).
 *
 * 마지막 카드가 FAB이나 말풍선 뒤에 숨으면, 처음 온 사람은 자기가 눌러야 할 카드를 못 본다.
 * 리터럴로 적어두면 FAB이 커질 때 조용히 어긋나므로 실제 상수로 셈한다. 메뉴 높이는 화면이 따로 더한다.
 */
export const LOUNGE_CONTENT_BOTTOM_PADDING =
  AMORA_FAB_GAP + AMORA_FAB_SIZE + AMORA_FAB_BUBBLE_HEIGHT;

/** AsyncStorage와 같은 모양. 이 모듈은 저장소를 직접 import하지 않는다. */
export interface FirstRunTutorialSessionStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

/**
 * 이번 앱 실행에서 이미 띄웠는가.
 *
 * AsyncStorage에는 브라우저 sessionStorage 같은 "세션" 개념이 없다. 그래서 실행 중에는
 * 이 메모리 플래그가, 실행이 끊긴 뒤에는 저장된 값이 같은 역할을 한다. 정본은 어느 쪽도
 * 아니고 `profiles.first_run_tutorial_completed_at`이다 — 이 값들은 프로필 쓰기가
 * 실패했을 때 같은 사람에게 같은 안내를 반복하지 않기 위한 보조 장치일 뿐이다.
 */
let shownInThisRun = false;

/** 테스트가 실행 간 상태를 격리할 때 쓴다. */
export function resetFirstRunTutorialRunState(): void {
  shownInThisRun = false;
}

export async function hasShownFirstRunTutorialOnDevice(
  storage: FirstRunTutorialSessionStorage | null,
): Promise<boolean> {
  if (shownInThisRun) return true;
  if (!storage) return false;
  try {
    const raw = await storage.getItem(FIRST_RUN_TUTORIAL_SESSION_KEY);
    return typeof raw === "string" && raw.length > 0;
  } catch {
    // 읽지 못하면 "아직 안 띄웠다"로 본다. 최악이 한 번 더 보는 것이다.
    return false;
  }
}

/**
 * 안내를 **여는 순간**의 표식. 메모리에만 남기고 기기 저장소는 건드리지 않는다.
 *
 * 여기서 막고 싶은 것은 "같은 실행에서 화면이 다시 그려져 안내가 두 번 뜨는 것"뿐이다.
 * 그 목적에는 메모리 플래그로 충분하고, 이 플래그는 앱이 죽으면 같이 사라진다.
 *
 * 예전에는 이 자리에서 AsyncStorage에 영구 플래그를 적었다. 그런데 그 값을 지우는 경로가
 * 저장소 전체에 하나도 없어서, 안내 도중 전화를 받거나 OS가 앱을 회수하면 프로필에는
 * 완료가 없는데 기기 플래그만 남았다. 그 사람은 그 기기에서 다시는 안내도, 안내 종료
 * 핸들러가 만드는 아모라의 첫마디도 받지 못했다 — 가장 조용한 영구 실패다.
 */
export function noteFirstRunTutorialOpened(): void {
  shownInThisRun = true;
}

/**
 * 안내가 **끝났다**는 기기 표식. 프로필 쓰기가 실패했을 때만 의미가 있는 보조 장치다.
 *
 * 반드시 종료 시점에만 부른다. 여는 시점에 부르면 중간에 끊긴 사람이 영영 안내를 잃는다.
 */
export async function rememberFirstRunTutorialShown(
  storage: FirstRunTutorialSessionStorage | null,
  now: number = Date.now(),
): Promise<void> {
  shownInThisRun = true;
  if (!storage) return;
  try {
    await storage.setItem(
      FIRST_RUN_TUTORIAL_SESSION_KEY,
      new Date(now).toISOString(),
    );
  } catch {
    // 저장 실패는 이번 실행 안에서 메모리 플래그가 대신 막는다.
  }
}

/**
 * 프로필 한 행을 읽고 쓰는 통로. 호출하는 쪽이 Supabase 질의를 만들어 넘긴다.
 *
 * 새 RPC를 만들지 않는다 — profiles에는 이미 본인 행만 허용하는 UPDATE 정책
 * (`profiles_update_own`)이 있고, 이 값은 사용자가 자기 화면에서 안내를 끝냈다는 자기
 * 신고라 남의 행이나 공유 자원을 건드리지 않는다.
 */
export interface FirstRunTutorialProfileGateway {
  readState(): Promise<{ data?: unknown; error?: unknown }>;
  writeCompletion(patch: {
    first_run_tutorial_completed_at: string;
    first_run_tutorial_version: number;
  }): Promise<{ error?: unknown }>;
}

export interface FirstRunTutorialRead {
  state: FirstRunTutorialState;
  /**
   * 컬럼이 아직 없는 배포인가.
   *
   * 그렇다면 완료 기록도 시도하지 않는다 — 같은 이유로 반드시 실패하는 UPDATE를 보내
   * 로그만 더럽힐 이유가 없다. 마이그레이션이 적용되면 다음 사람부터 정상 경로를 탄다.
   */
  columnsMissing: boolean;
}

const NOT_SEEN: FirstRunTutorialState = { completedAt: null, version: null };

export async function loadFirstRunTutorialState(
  gateway: FirstRunTutorialProfileGateway,
): Promise<FirstRunTutorialRead> {
  try {
    const { data, error } = await gateway.readState();
    if (error) {
      return { state: NOT_SEEN, columnsMissing: isMissingFirstRunTutorialColumn(error) };
    }
    return { state: parseFirstRunTutorialState(data), columnsMissing: false };
  } catch {
    // 네트워크가 끊겼거나 통로가 던졌다. 판정 없이 "아직 안 봤다"로 둔다.
    return { state: NOT_SEEN, columnsMissing: false };
  }
}

/**
 * 완료 시각과 판을 프로필에 적는다. 건너뛰기도 여기로 온다 — 건너뛴 사람에게 매번
 * 다시 띄우는 건 안내가 아니라 방해다.
 *
 * 실패해도 던지지 않는다. 안내를 다 본 사람이 기록 실패 때문에 오류 화면을 보는 것은
 * 얻는 것 없이 잃기만 하는 일이고, 그 실행에서는 기기 저장소가 반복을 막는다.
 */
export async function markFirstRunTutorialCompleted(
  gateway: FirstRunTutorialProfileGateway,
  now: number = Date.now(),
): Promise<boolean> {
  try {
    const { error } = await gateway.writeCompletion({
      first_run_tutorial_completed_at: new Date(now).toISOString(),
      first_run_tutorial_version: FIRST_RUN_TUTORIAL_VERSION,
    });
    return !error;
  } catch {
    return false;
  }
}

/** 강조 구멍이 요소보다 조금 넉넉해야 테두리가 글자에 붙지 않는다. */
export const COACH_MARK_HOLE_PADDING = 8;
/** 구멍과 말풍선 사이. */
export const COACH_MARK_TOOLTIP_GAP = 14;
/**
 * 말풍선이 들어갈 최소 높이(제목 + 두 줄 + 버튼). 실제 높이는 글자 수에 따라 달라지지만,
 * 위/아래 중 어디에 놓을지는 그리기 전에 정해야 해서 보수적인 값을 쓴다.
 */
export const COACH_MARK_TOOLTIP_MIN_HEIGHT = 200;
/** 화면 가장자리에서 띄우는 여백. */
export const COACH_MARK_EDGE_MARGIN = 16;

export interface CoachMarkRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CoachMarkPlacement {
  /** 오버레이 기준 좌표의 강조 구멍. */
  hole: { left: number; top: number; width: number; height: number };
  /** 말풍선을 구멍 아래에 놓을 때의 top. 위에 놓으면 null. */
  tooltipTop: number | null;
  /** 말풍선을 구멍 위에 놓을 때의 bottom. 아래에 놓으면 null. */
  tooltipBottom: number | null;
}

/**
 * 창 좌표로 잰 요소를 오버레이 좌표의 강조 구멍과 말풍선 자리로 바꾼다.
 *
 * 요소가 화면 밖이면 null이다 — 보이지 않는 것을 가리키는 안내는 사람을 헷갈리게만 한다.
 * 부르는 쪽은 그때 그 단계를 조용히 건너뛴다.
 */
export function buildCoachMarkPlacement(
  anchor: CoachMarkRect,
  overlay: CoachMarkRect,
): CoachMarkPlacement | null {
  if (overlay.width <= 0 || overlay.height <= 0) return null;
  if (anchor.width <= 0 || anchor.height <= 0) return null;

  const left = anchor.x - overlay.x;
  const top = anchor.y - overlay.y;
  if (top + anchor.height <= 0 || top >= overlay.height) return null;
  if (left + anchor.width <= 0 || left >= overlay.width) return null;

  const holeLeft = Math.max(left - COACH_MARK_HOLE_PADDING, 0);
  const holeTop = Math.max(top - COACH_MARK_HOLE_PADDING, 0);
  const holeRight = Math.min(
    left + anchor.width + COACH_MARK_HOLE_PADDING,
    overlay.width,
  );
  const holeBottom = Math.min(
    top + anchor.height + COACH_MARK_HOLE_PADDING,
    overlay.height,
  );

  const hole = {
    left: holeLeft,
    top: holeTop,
    width: Math.max(holeRight - holeLeft, 0),
    height: Math.max(holeBottom - holeTop, 0),
  };

  const roomBelow = overlay.height - (holeBottom + COACH_MARK_TOOLTIP_GAP);
  if (roomBelow >= COACH_MARK_TOOLTIP_MIN_HEIGHT) {
    return {
      hole,
      tooltipTop: holeBottom + COACH_MARK_TOOLTIP_GAP,
      tooltipBottom: null,
    };
  }

  const roomAbove = holeTop - COACH_MARK_TOOLTIP_GAP;
  if (roomAbove >= COACH_MARK_TOOLTIP_MIN_HEIGHT) {
    return {
      hole,
      tooltipTop: null,
      tooltipBottom: overlay.height - holeTop + COACH_MARK_TOOLTIP_GAP,
    };
  }

  // 위아래 어디에도 자리가 없다(요소가 화면을 거의 다 차지). 겹치더라도 아래쪽에 붙여
  // 보이게 한다 — 말풍선이 화면 밖으로 나가는 것보다 겹치는 편이 낫다.
  return { hole, tooltipTop: null, tooltipBottom: COACH_MARK_EDGE_MARGIN };
}
