import { Redirect } from "expo-router";

/**
 * 결혼 예절 안내 — 웹 화면을 앱 안에서 연다.
 *
 * 이 화면은 2026-07-26에 지웠다가 다시 만든 것이다. 그때 지운 이유는 "그 페이지가
 * 제거돼 메뉴가 404 웹뷰를 열고 있어서"였는데, 안내 25편이 `/wedding/manners`로
 * 복구되면서 그 전제가 사라졌다.
 *
 * 네이티브로 다시 그리지 않고 웹을 여는 이유 — 안내 본문은 지금 `apps/web`에만 있고
 * (`packages/shared`에는 없다), 25편을 앱에서 직접 그리려면 데이터부터 옮겨야 한다.
 * 그건 따로 판단할 일이고, 그 사이에 앱 사용자가 안내를 못 보는 상태로 두지 않는다.
 *
 * 주소는 `/manners`가 아니라 `/wedding/manners`다. 앞의 것은 307로 한 번 튄다.
 */
const SITE = process.env.EXPO_PUBLIC_SITE_URL || "https://hanbang.ai";

export default function EtiquetteScreen() {
  return <Redirect href={`/webview?url=${encodeURIComponent(`${SITE}/wedding/manners`)}`} />;
}
