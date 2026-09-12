/**
 * 양측 분담 — 신부 측이 얼마, 신랑 측이 얼마, 함께가 얼마.
 * 웹 `BudgetSideSplit` 의 모바일 짝이다.
 *
 * 접는 규칙(`payer` 네 값 → 세 기둥)과 왜 새 `payer` 값을 만들지 않았는지는
 * `@hanbang/shared/budget-share` 의 `foldPayerSides` 머리말에 있다. **두 앱이 그 함수
 * 하나를 부른다** — 각자 접으면 같은 커플에게 다른 기둥을 말한다.
 *
 * 접은 것을 펴서 볼 자리(원래의 네 칸)는 이 컴포넌트 아래에 그대로 남는다.
 *
 * 색은 뜻을 지지 않는다. 어느 기둥이 어느 색인지는 임의고, 뜻은 글자가 진다.
 */
import { View, StyleSheet } from "react-native";
import { Text } from "@/components/ui/AppText";
import { colors } from "@hanbang/design-tokens";
import {
  formatManwon,
  formatPercentCell,
  withPercents,
} from "@hanbang/shared/budget-share";

const SIDE_COLORS: Record<string, string> = {
  bride: colors.rose[500],
  shared: colors.taupe[400],
  groom: colors.sage[500],
};

export default function BudgetSideSplit({
  brideSide,
  groomSide,
  shared,
}: {
  brideSide: number;
  groomSide: number;
  shared: number;
}) {
  const total = brideSide + groomSide + shared;
  if (total <= 0) return null;

  const rows = withPercents(
    [
      { key: "bride", label: "신부 측", amount: brideSide },
      { key: "shared", label: "함께", amount: shared },
      { key: "groom", label: "신랑 측", amount: groomSide },
    ],
    total,
  );

  return (
    <View style={s.wrap}>
      <View style={s.bar}>
        {rows.map((row) =>
          row.amount > 0 ? (
            <View
              key={row.key}
              // 폭을 반올림한 비중이 아니라 **금액 비율**로 준다. 비중으로 그리면
              // `1% 미만` 조각이 0% 라 사라지는데 목록에는 금액이 남는다.
              style={{
                flexGrow: row.amount,
                flexBasis: 0,
                backgroundColor: SIDE_COLORS[row.key],
              }}
            />
          ) : null,
        )}
      </View>

      <View style={s.columns}>
        {rows.map((row) => (
          <View key={row.key} style={s.column}>
            <View style={s.labelRow}>
              <View style={[s.dot, { backgroundColor: SIDE_COLORS[row.key] }]} />
              <Text style={s.label} numberOfLines={1}>
                {row.label}
              </Text>
            </View>
            <Text style={s.amount} numberOfLines={1}>
              {formatManwon(row.amount)}
            </Text>
            <Text style={s.pct}>{formatPercentCell(row.percent, row.amount)}</Text>
          </View>
        ))}
      </View>

      <Text style={s.note}>
        ‘함께’는 두 사람과 두 가족이 함께 내는 몫이라 어느 한쪽으로 세지 않았어요.
        분담을 아직 정하지 않은 항목은 ‘두 사람’으로 셉니다.
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginBottom: 14 },
  bar: {
    flexDirection: "row",
    height: 10,
    borderRadius: 5,
    overflow: "hidden",
    backgroundColor: colors.ivory[200],
  },
  columns: { flexDirection: "row", gap: 8, marginTop: 10 },
  column: { flex: 1, minWidth: 0 },
  labelRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  dot: { width: 7, height: 7, borderRadius: 3.5 },
  label: {
    flex: 1,
    fontSize: 11,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
  },
  amount: {
    marginTop: 5,
    fontSize: 15,
    fontFamily: "CormorantGaramond_600SemiBold",
    color: colors.noir[800],
  },
  pct: {
    marginTop: 2,
    fontSize: 11,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textTertiary,
  },
  note: {
    marginTop: 10,
    fontSize: 11,
    lineHeight: 17,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textTertiary,
  },
});
