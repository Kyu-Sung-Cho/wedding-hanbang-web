import InvitationTabBar from "@/components/invitation/InvitationTabBar";
import {
  INVITATION_TAB_SCREENS,
  invitationTabKeyForScreen,
  type InvitationTabRouteKey,
} from "@/lib/invitationRoutes.mjs";
import { useKeyboardShown } from "@/lib/useKeyboardShown";

/**
 * 로그인한 커플의 하단 메뉴(2026-11-17 파운더 디자인 아티팩트, 원문: 이 디자인 완전 같아야해).
 * `app/(tabs)/_layout.tsx` 의 `tabBar` 가 그린다. 모양은 예시와 같은 `InvitationTabBar` 그대로다.
 *
 * - 메뉴는 화면 위에 겹쳐 떠 있다. 탭 화면들은 그 높이만큼 아래를 비운다(`invitationTabBarClearance`).
 * - 키보드가 떠 있는 동안에는 그리지 않는다. 안드로이드에서는 창이 줄어 메뉴가 입력칸을 덮는다.
 * - 화면이 메뉴를 숨기는 길은 두지 않는다. 홈 탭의 첫 대화도 메뉴 위에 단추를 두고(`withTabBar`), 메뉴로
 *   다른 탭에 갈 수 있다. 첫 대화가 유일한 길이 되면 이미 쓰던 커플이 그 안에 갇힌다(2026-11-17).
 */
export default function InvitationTabsBar({
  focused,
  onSelect,
}: {
  /** 지금 보이는 탭 화면 이름(`lounge` 등). */
  focused: string | undefined;
  /** 탭 화면 이름으로 옮긴다(탭 네비게이터의 `navigate`). */
  onSelect: (screen: string) => void;
}) {
  const keyboardShown = useKeyboardShown();
  if (keyboardShown) return null;
  const active = invitationTabKeyForScreen(focused) ?? "home";
  return (
    <InvitationTabBar
      active={active}
      onNavigate={(key) => {
        // 메뉴 칸은 탭 넷뿐이다. 그 밖의 이름이 오면 옮기지 않는다.
        if (!Object.hasOwn(INVITATION_TAB_SCREENS, key)) return;
        onSelect(INVITATION_TAB_SCREENS[key as InvitationTabRouteKey]);
      }}
    />
  );
}
