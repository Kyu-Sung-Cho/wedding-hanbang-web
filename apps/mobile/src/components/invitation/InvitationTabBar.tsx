import type { ReactElement } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets, type EdgeInsets } from "react-native-safe-area-context";
import { HOME_COPY, type InvitationRouteKey } from "@hanbang/shared/invitation";
import { TabChatIcon, TabHomeIcon, TabJourneyIcon, TabScheduleIcon } from "./InvitationIcons";
import { glass, palette, shadow } from "./invitationStyle";

/** 메뉴 칸 넷. "일정"은 아티팩트에서 답장과 상담 확정 화면(`Status.dc`)으로 간다. */
export type InvitationTabKey = Extract<InvitationRouteKey, "home" | "chat" | "journey" | "status">;

const TABS: readonly { key: InvitationTabKey; label: string; Icon: (props: { color: string }) => ReactElement }[] = [
  { key: "home", label: HOME_COPY.nav.home, Icon: TabHomeIcon },
  { key: "chat", label: HOME_COPY.nav.chat, Icon: TabChatIcon },
  { key: "journey", label: HOME_COPY.nav.journey, Icon: TabJourneyIcon },
  { key: "status", label: HOME_COPY.nav.schedule, Icon: TabScheduleIcon },
];

/** 아티팩트 높이 64. */
export const INVITATION_TAB_BAR_HEIGHT = 64;

/**
 * 메뉴 아래 간격. 아티팩트는 화면 아래에서 22px 떠 있다. 홈 표시줄이 있는 기기에서는 안전 영역 안으로
 * 들어가지 않게 그보다 위에 둔다.
 */
export function invitationTabBarBottom(insets: Pick<EdgeInsets, "bottom">): number {
  return Math.max(22, insets.bottom);
}

/**
 * 화면 아래에서 메뉴 위쪽 끝까지의 높이. 메뉴는 화면 위에 겹쳐 그려지므로(로그인한 커플의 탭 4개), 그 아래로
 * 들어가면 안 되는 것(마지막 줄, 입력칸, 떠 있는 단추)은 이 높이 위에 둔다.
 */
export function invitationTabBarClearance(insets: Pick<EdgeInsets, "bottom">): number {
  return invitationTabBarBottom(insets) + INVITATION_TAB_BAR_HEIGHT;
}

/**
 * 떠 있는 하단 메뉴(`Home.dc` nav). 알약 64px, 아이콘 단추 52×48, 지금 화면은 잉크로 채운다.
 * 아티팩트의 `backdrop-filter: blur(20px)` 는 새 네이티브 모듈 없이 못 그려서 같은 반투명 흰색만 쓴다.
 */
export default function InvitationTabBar({
  active,
  onNavigate,
}: {
  active: InvitationTabKey;
  onNavigate: (route: InvitationRouteKey) => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={HOME_COPY.nav.label}
      style={[styles.bar, { bottom: invitationTabBarBottom(insets) }]}
    >
      {TABS.map(({ key, label, Icon }) => {
        const selected = key === active;
        return (
          <Pressable
            key={key}
            accessibilityRole="tab"
            accessibilityLabel={label}
            accessibilityState={{ selected }}
            onPress={() => {
              if (!selected) onNavigate(key);
            }}
            style={[styles.item, selected && styles.itemActive]}
          >
            <Icon color={selected ? palette.white : palette.body} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: "absolute",
    left: 16,
    right: 16,
    height: INVITATION_TAB_BAR_HEIGHT,
    borderRadius: 32,
    backgroundColor: glass.bar,
    boxShadow: shadow.tabBar,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    paddingHorizontal: 8,
  },
  item: { width: 52, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  itemActive: { backgroundColor: palette.ink },
});
