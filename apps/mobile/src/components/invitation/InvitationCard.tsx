import { Fragment } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Line } from "react-native-svg";
import {
  BLANK_MARK,
  INVITATION_TEXT,
  invitationDateParts,
  invitationNames,
  isVenuePending,
  type InvitationFacts,
} from "@hanbang/shared/invitation";
import { Text } from "@/components/ui/AppText";
import { em, lineHeight, palette, shadow, typo } from "./invitationStyle";

/**
 * 빈칸이 있는 청첩장 카드. 아티팩트 메모: "홈은 빈칸이 있는 청첩장. 일이 진행될수록 날짜와 장소가 채워져요."
 * - home: 홈 보케 위 카드(`Home.dc` article). 바깥 위치는 부모가 정한다.
 * - draft: 첫 대화의 청첩장 초안(`Chat.dc` article). `line` 은 "서울 어딘가에서, 200명의 하객과 함께".
 * 모르는 칸은 짐작하지 않고 흐린 밑줄(`__`)로 둔다.
 */
type Props =
  | { variant: "home"; facts: InvitationFacts; style?: StyleProp<ViewStyle> }
  | { variant: "draft"; facts: InvitationFacts; line: string; style?: StyleProp<ViewStyle> };

function DateLine({ facts, size, spacing, height, blankColor }: {
  facts: InvitationFacts;
  size: number;
  spacing: number;
  height: number;
  blankColor: string;
}) {
  const parts = invitationDateParts(facts);
  // 읽어 줄 때는 빈칸 밑줄을 빼고 아는 부분만 읽는다.
  const spoken = parts.filter((part) => !part.blank).map((part) => part.text).join(". ");
  return (
    <Text
      accessibilityLabel={spoken || undefined}
      style={[typo.numeralMedium, styles.center, { fontSize: size, letterSpacing: spacing, lineHeight: height }]}
    >
      {parts.map((part, index) => (
        <Fragment key={index}>
          <Text style={part.blank ? { color: blankColor } : undefined}>{part.text}</Text>
          {index < parts.length - 1 ? ". " : ""}
        </Fragment>
      ))}
    </Text>
  );
}

/** 아티팩트의 `border-bottom: 1px dashed`. 네이티브는 한쪽 점선을 못 그려 선을 따로 그린다. */
function DashedUnderline({ color }: { color: string }) {
  return (
    <Svg width="100%" height={1} style={styles.dash} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Line x1="0" y1="0.5" x2="100%" y2="0.5" stroke={color} strokeWidth={1} strokeDasharray="3 3" />
    </Svg>
  );
}

export default function InvitationCard(props: Props) {
  const { facts } = props;
  const names = invitationNames(facts);
  if (props.variant === "draft") {
    return (
      <View style={[styles.draftCard, props.style]}>
        <View style={styles.draftInner}>
          <Text style={[typo.serif, styles.center, { fontSize: 15 }, !names && { color: palette.blankSoft }]}>
            {names ?? BLANK_MARK}
          </Text>
          <DateLine facts={facts} size={34} spacing={em(34, 0.04)} height={lineHeight(34, 1.15)} blankColor={palette.blankSoft} />
          <View style={[styles.rule, { marginVertical: 4 }]} />
          <Text style={[typo.sans, styles.center, { fontSize: 13, color: palette.muted }]}>{props.line}</Text>
        </View>
      </View>
    );
  }
  const pending = isVenuePending(facts);
  return (
    <View style={[styles.homeCard, props.style]}>
      <View style={styles.homeInner}>
        <Text style={[typo.sans, styles.center, styles.eyebrow]}>{INVITATION_TEXT.eyebrow}</Text>
        <Text style={[typo.serif, styles.center, styles.homeNames, !names && { color: palette.blank }]}>
          {names ?? BLANK_MARK}
        </Text>
        <DateLine facts={facts} size={40} spacing={em(40, 0.04)} height={lineHeight(40, 1.1)} blankColor={palette.blank} />
        {facts.timeLabel ? (
          <Text style={[typo.serif, styles.center, { fontSize: 14, color: palette.muted }]}>{facts.timeLabel}</Text>
        ) : null}
        <View style={[styles.rule, { marginVertical: 6 }]} />
        {pending ? (
          <View style={styles.pending}>
            <Text style={[typo.sans, styles.center, { fontSize: 13, color: palette.faint }]}>{INVITATION_TEXT.venuePending}</Text>
            <DashedUnderline color={palette.blank} />
          </View>
        ) : (
          <Text style={[typo.sans, styles.center, { fontSize: 13 }]}>{facts.venueName}</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { textAlign: "center" },
  homeCard: {
    backgroundColor: palette.white,
    borderRadius: 6,
    padding: 8,
    boxShadow: shadow.invitationCard,
  },
  homeInner: {
    borderWidth: 1,
    borderColor: palette.goldLine,
    paddingTop: 28,
    paddingHorizontal: 18,
    paddingBottom: 22,
    alignItems: "center",
    gap: 8,
  },
  eyebrow: { fontSize: 11, letterSpacing: em(11, 0.18), color: palette.goldInk },
  homeNames: { fontSize: 22, lineHeight: lineHeight(22, 1.4) },
  rule: { width: 24, height: 1, backgroundColor: palette.goldRule },
  // 아티팩트는 글자 아래 2px 여백 뒤에 1px 점선이다. 점선을 맨 아래 1px 에 그리므로 3 을 둔다.
  pending: { paddingBottom: 3 },
  dash: { position: "absolute", left: 0, right: 0, bottom: 0 },
  draftCard: {
    borderRadius: 22,
    backgroundColor: palette.white,
    boxShadow: shadow.draftCard,
    padding: 6,
  },
  draftInner: {
    borderWidth: 1,
    borderColor: palette.goldLine,
    borderRadius: 17,
    paddingVertical: 20,
    paddingHorizontal: 16,
    alignItems: "center",
    gap: 6,
  },
});
