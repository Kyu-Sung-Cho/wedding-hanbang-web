import { ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  JOURNEY_COPY,
  type InvitationRouteKey,
  type JourneyModel,
  type JourneyRow,
} from "@hanbang/shared/invitation";
import { Text } from "@/components/ui/AppText";
import AmoraOrb from "@/components/ui/AmoraOrb";
import InvitationBackButton from "./InvitationBackButton";
import InvitationButton from "./InvitationButton";
import { CheckIcon } from "./InvitationIcons";
import { invitationTabBarClearance } from "./InvitationTabBar";
import { lineHeight, opaqueScroll, palette, typo } from "./invitationStyle";

type Props = {
  model: JourneyModel;
  onBack: () => void;
  onNavigate: (route: InvitationRouteKey) => void;
  /** 뺄 수 있는 단계를 빼거나 다시 넣는다. 없으면 그 단추가 눌리지 않는다. */
  onToggleStage?: (key: string) => void;
  /** "반지와 예물 넣기"·"신혼집 준비 넣기". */
  onToggleAddOn?: (key: string) => void;
  /** "이 순서로 할게요". 없으면 홈으로 간다(아티팩트 링크). */
  onConfirm?: () => void;
  topInset?: number;
  /** 떠 있는 하단 메뉴가 함께 있으면(로그인한 커플의 탭) 아래 단추 묶음을 메뉴 위로 올린다. */
  withTabBar?: boolean;
  /** 저장하지 못했을 때처럼 단추 위에 한 줄로 알릴 말. 없으면 그리지 않는다(예시). */
  notice?: string | null;
};

/**
 * 준비 순서(`Journey.dc`, 390×960). 아홉 단계, 지금 단계는 분홍 면, 끝난 단계는 흐린 번호와 금빛 체크.
 * 뺄 수 있는 단계(첫인사와 상견례, 신혼여행)에만 "빼기"/"다시 넣기"가 붙는다.
 */
export default function InvitationJourney({
  model,
  onBack,
  onNavigate,
  onToggleStage,
  onToggleAddOn,
  onConfirm,
  topInset,
  withTabBar = false,
  notice,
}: Props) {
  const insets = useSafeAreaInsets();
  const footerBottom = withTabBar ? invitationTabBarClearance(insets) + 12 : Math.max(26, insets.bottom);
  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: 16 + (topInset ?? insets.top) }]}>
        <InvitationBackButton label={JOURNEY_COPY.back} onPress={onBack} />
        <AmoraOrb size={40} mood="calm" />
      </View>

      <ScrollView style={[styles.flex, opaqueScroll]}>
        <View style={styles.intro}>
          <Text accessibilityRole="header" style={[typo.serif, styles.title]}>{JOURNEY_COPY.title}</Text>
          <Text style={[typo.sans, styles.introText]}>{JOURNEY_COPY.intro}</Text>
        </View>
        <View style={styles.list}>
          {model.rows.map((row) => (
            <StageRow key={row.key} row={row} onToggle={onToggleStage} />
          ))}
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: footerBottom }]}>
        {notice ? (
          <Text accessibilityLiveRegion="polite" style={[typo.sans, styles.notice]}>{notice}</Text>
        ) : null}
        {model.addOns.length > 0 ? (
          <View style={styles.addOns}>
            {model.addOns.map((addOn) => (
              <InvitationButton
                key={addOn.key}
                label={addOn.button}
                onPress={onToggleAddOn ? () => onToggleAddOn(addOn.key) : undefined}
                // 아티팩트는 넣은 뒤의 모양을 그리지 않았다. 다른 칩처럼 켜지면 잉크로 채운다.
                variant={addOn.added ? "ink" : "dashed"}
                selected={addOn.added}
                height={44}
                radius={22}
                fontSize={14}
                style={styles.flex}
              />
            ))}
          </View>
        ) : null}
        <InvitationButton
          label={JOURNEY_COPY.confirm}
          onPress={onConfirm ?? (() => onNavigate("home"))}
          variant="ink"
          height={54}
          fontSize={15}
          weight="700"
        />
      </View>
    </View>
  );
}

function StageRow({ row, onToggle }: { row: JourneyRow; onToggle?: (key: string) => void }) {
  const now = row.state === "now";
  const done = row.state === "done";
  const action = row.off ? JOURNEY_COPY.restore : JOURNEY_COPY.remove;
  return (
    <View style={[styles.row, now ? styles.rowNow : styles.rowDivider]}>
      <Text style={[typo.numeralMedium, styles.number, { color: done ? palette.doneNumber : palette.goldInk }]}>
        {row.number}
      </Text>
      <View style={styles.rowText}>
        <Text
          style={[
            typo.sans,
            styles.rowTitle,
            row.off
              ? styles.rowTitleOff
              : done
                ? { color: palette.faint }
                : { fontWeight: now ? "700" : "500" },
          ]}
        >
          {row.title}
        </Text>
        <Text style={[typo.sans, styles.rowSub]}>{row.off ? JOURNEY_COPY.removedSub : row.sub}</Text>
      </View>
      {row.optional ? (
        <InvitationButton
          label={action}
          accessibilityLabel={`${row.title} ${action}`}
          onPress={onToggle ? () => onToggle(row.key) : undefined}
          variant="outline"
          height={34}
          paddingHorizontal={14}
          radius={17}
          fontSize={13}
        />
      ) : null}
      {done ? (
        <View accessible accessibilityRole="image" accessibilityLabel={JOURNEY_COPY.done}>
          <CheckIcon color={palette.goldInk} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.white },
  flex: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingRight: 16,
    paddingLeft: 10,
  },
  intro: { paddingTop: 8, paddingHorizontal: 26, paddingBottom: 20, gap: 8 },
  title: { fontSize: 28 },
  introText: { fontSize: 15, lineHeight: lineHeight(15, 1.65), color: palette.body },
  list: { paddingHorizontal: 26 },
  row: { flexDirection: "row", alignItems: "center", gap: 16, paddingVertical: 13, borderRadius: 18 },
  rowNow: { paddingHorizontal: 16, marginHorizontal: -16, backgroundColor: palette.stepNow },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: palette.rowLine },
  number: { width: 26, fontSize: 20 },
  rowText: { flex: 1, gap: 3 },
  rowTitle: { fontSize: 15 },
  rowTitleOff: { color: palette.offText, textDecorationLine: "line-through" },
  rowSub: { fontSize: 13, color: palette.muted },
  footer: { paddingTop: 12, paddingHorizontal: 22, gap: 10 },
  notice: { fontSize: 13, lineHeight: lineHeight(13, 1.6), color: palette.body },
  addOns: { flexDirection: "row", gap: 8 },
});
