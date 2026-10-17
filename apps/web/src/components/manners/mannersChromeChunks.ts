// 로그인한 사람에게만 필요한 예절 가이드 틀의 두 조각(사이드바 자리·상단 바 자리)을 불러오는 함수.
// `MannersChrome` 이 쓰고, 앱 틀이 미리 받아 둘 때도 쓴다.
export const loadSignedInAside = () => import("./MannersSignedInAside");
export const loadSignedInTopBar = () => import("./MannersSignedInTopBar");

/**
 * 로그인한 앱 안에서 예절 가이드로 넘어가기 전에 두 조각을 미리 받아 둔다.
 *
 * 앱에서 메뉴를 눌러 넘어오는 사람은 이 화면이 열리는 순간 이미 로그인 상태인데, 조각이 아직
 * 없으면 받는 동안 공개 사이드바(웨딩코드가 없고 커뮤니티가 있는 모양)가 잠깐 그려졌다가
 * 바뀐다. 앱 틀이 한가할 때 먼저 불러 두면 그 사이가 없다. 실패해도 아무 일도 없다 —
 * 화면이 열릴 때 다시 시도한다.
 */
export function preloadMannersSignedInChrome(): void {
  void loadSignedInAside().catch(() => undefined);
  void loadSignedInTopBar().catch(() => undefined);
}
