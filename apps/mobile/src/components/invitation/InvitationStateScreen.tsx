import type { ReactElement, ReactNode } from "react";
import { ScrollView, StyleSheet, View, type RefreshControlProps } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "@/components/ui/AppText";
import AmoraOrb from "@/components/ui/AmoraOrb";
import InvitationBackButton from "./InvitationBackButton";
import InvitationButton from "./InvitationButton";
import { invitationTabBarClearance } from "./InvitationTabBar";
import { lineHeight, opaqueScroll, palette, paragraph17, typo } from "./invitationStyle";

type Action = { label: string; onPress: () => void; tone?: "ink" | "outline" };

type Props = {
  /** 아모라의 한 줄(17px 문단). 불러오는 중에는 비우고 도는 오브만 둔다. */
  title?: string | null;
  sub?: string | null;
  actions?: readonly Action[];
  back?: { label: string; onPress: () => void };
  /** 불러오는 중. 오브가 일하는 모양(`working`)으로 돈다. */
  busy?: boolean;
  topInset?: number;
  /** 떠 있는 하단 메뉴가 함께 있으면(로그인한 커플의 탭) 단추를 메뉴 위에 둔다. */
  withTabBar?: boolean;
  /** 당겨서 다시 불러오기(불러오지 못했을 때). */
  refreshControl?: ReactElement<RefreshControlProps>;
  /**
   * 단추 아래에 두는 것(실제 커플: 받은 답 붙여 넣기, D-83 1단계). 화면 너비로 펼친다. 없으면 그리지 않는다.
   * 입력칸이 들어오므로 이때만 키보드를 피하고(iOS), 키보드가 떠 있어도 단추가 한 번에 눌리게 한다.
   */
  footer?: ReactNode;
};

/**
 * 아티팩트가 그리지 않은 순간(불러오는 중, 불러오지 못함, 아직 비어 있음)의 화면. 실제 커플만 만난다.
 * 같은 말투로 둔다: 흰 바탕, 아모라 오브, 말풍선 없는 17px 문단, 잉크 알약 단추(`Chat.dc`·`Compare.dc` 값).
 * 글자는 부르는 쪽이 `@hanbang/shared/invitation` 에서 골라 넘긴다.
 */
export default function InvitationStateScreen({
  title,
  sub,
  actions = [],
  back,
  busy = false,
  topInset,
  withTabBar = false,
  refreshControl,
  footer,
}: Props) {
  const insets = useSafeAreaInsets();
  const top = topInset ?? insets.top;
  const bottom = withTabBar ? invitationTabBarClearance(insets) + 24 : Math.max(26, insets.bottom);
  const hasFooter = footer !== undefined && footer !== null && footer !== false;
  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: 16 + top }]}>
        {back ? <InvitationBackButton label={back.label} onPress={back.onPress} /> : <View style={styles.headerSpace} />}
      </View>
      <ScrollView
        style={[styles.flex, opaqueScroll]}
        contentContainerStyle={[styles.body, { paddingBottom: bottom }]}
        refreshControl={refreshControl}
        automaticallyAdjustKeyboardInsets={hasFooter ? true : undefined}
        keyboardShouldPersistTaps={hasFooter ? "handled" : undefined}
      >
        <AmoraOrb size={64} mood={busy ? "working" : "calm"} />
        {title ? (
          <Text accessibilityLiveRegion="polite" style={[paragraph17, styles.center]}>{title}</Text>
        ) : null}
        {sub ? <Text style={[typo.sans, styles.center, styles.sub]}>{sub}</Text> : null}
        {actions.length > 0 ? (
          <View style={styles.actions}>
            {actions.map((action) => (
              <InvitationButton
                key={action.label}
                label={action.label}
                onPress={action.onPress}
                variant={action.tone === "outline" ? "outline" : "ink"}
                height={46}
                paddingHorizontal={22}
                fontSize={14}
                weight={action.tone === "outline" ? "400" : "700"}
              />
            ))}
          </View>
        ) : null}
        {hasFooter ? <View style={styles.footer}>{footer}</View> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.white },
  flex: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", paddingRight: 16, paddingLeft: 10 },
  headerSpace: { height: 44 },
  body: { flexGrow: 1, alignItems: "center", justifyContent: "center", gap: 14, paddingHorizontal: 30, paddingTop: 12 },
  center: { textAlign: "center" },
  sub: { fontSize: 14, lineHeight: lineHeight(14, 1.6), color: palette.muted },
  actions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8, marginTop: 6 },
  footer: { alignSelf: "stretch", marginTop: 10 },
});
