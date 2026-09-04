/**
 * 항목별 비중 — 도넛 하나와 목록 하나. 웹 `BudgetShareChart` 의 모바일 짝이다.
 *
 * ## 웹과 같아야 하는 것 / 달라야 하는 것
 *
 * **같아야 하는 것은 숫자다.** 비중을 나누는 계산은 두 앱이
 * `@hanbang/shared/budget-share` 한 곳을 부른다 — 각자 계산하면 같은 커플에게 두
 * 화면이 다른 숫자를 말한다.
 *
 * **달라야 하는 것은 색과 서체다.** 모바일은 `@hanbang/design-tokens` 의
 * noir·rose·sage·gold 를 쓰고 웹 제품 화면은 종이·잉크 토큰을 쓴다. 웹의 CSS 변수를
 * 여기로 옮기지 마라 — 이 화면만 주변과 다른 색이 된다.
 *
 * ## 숫자는 여기서 만들지 않는다
 *
 * 조각은 화면(`app/budget/index.tsx`)이 **자기 합계를 만든 그대로** 넘긴다. 여기서
 * `progress` 를 다시 읽어 세면 도넛 총액과 위 카드 총액이 갈린다.
 */

import { View, Text, StyleSheet } from "react-native";
import Svg, { Circle, G } from "react-native-svg";
import { colors } from "@hanbang/design-tokens";
import {
  formatManwon,
  formatPercentCell,
  withPercents,
} from "@hanbang/shared/budget-share";

export type BudgetShareSlice = {
  key: string;
  label: string;
  amount: number;
};

/**
 * 큰 조각일수록 진하다. 조각은 금액 내림차순이라 색이 자연히 어두운 쪽에서 밝은
 * 쪽으로 흐른다.
 *
 * 뒤쪽 셋(`sage.pale`·`rose.light`·`gold.light`)은 서로 밝기가 가깝다. 그 자리는 늘
 * 가장 작은 조각들이고, 무엇인지는 **목록의 글자**가 말한다 — 색이 뜻을 지지 않는다.
 */
const SLICE_COLORS = [
  colors.noir[800],
  colors.rose[500],
  colors.sage[500],
  colors.gold.DEFAULT,
  colors.sage.pale,
  colors.rose.light,
  colors.gold.light,
] as const;

/** `기타` 는 이름 있는 일곱 색 어느 것과도 달라야 한다. */
const REST_COLOR = colors.taupe[500];

const NAMED_SLICE_LIMIT = 7;
const SIZE = 152;
const RADIUS = 48;
const STROKE = 16;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export default function BudgetShareChart({
  slices,
  basis,
}: {
  slices: readonly BudgetShareSlice[];
  /** 무엇을 나눠 그린 것인지. 기록 지출이 아직 없으면 배정 예산으로 그린다. */
  basis: "spent" | "budget";
}) {
  const counted = slices
    .filter((slice) => slice.amount > 0)
    .sort((a, b) => b.amount - a.amount);

  const total = counted.reduce((sum, slice) => sum + slice.amount, 0);
  if (total <= 0) return null;

  const named = counted.slice(0, NAMED_SLICE_LIMIT);
  const rest = counted.slice(NAMED_SLICE_LIMIT);
  const restAmount = rest.reduce((sum, slice) => sum + slice.amount, 0);

  const grouped: BudgetShareSlice[] = restAmount > 0
    ? [...named, { key: "__rest", label: `기타 ${rest.length}개`, amount: restAmount }]
    : named;

  const rows = withPercents(grouped, total).map((row, index) => ({
    ...row,
    color: row.key === "__rest" ? REST_COLOR : SLICE_COLORS[index % SLICE_COLORS.length],
  }));

  // 조각 사이를 살짝 벌려 경계를 만든다. 하나뿐이면 벌릴 곳이 없다.
  const gap = rows.length > 1 ? 1.5 : 0;
  const arcLength = (amount: number) => (amount / total) * CIRCUMFERENCE;

  const basisLabel = basis === "spent" ? "기록 지출" : "배정 예산";

  return (
    <View style={s.section}>
      <Text style={s.title}>항목별 비중</Text>
      <Text style={s.caption}>
        {basisLabel} {formatManwon(total)}을 항목별로 나눈 비중이에요.
      </Text>

      <View style={s.donutWrap}>
        <Svg width={SIZE} height={SIZE} viewBox="0 0 120 120">
          {/* 원은 3시에서 시작하므로 통째로 돌려 12시에서 시계방향으로 흐르게 한다. */}
          <G rotation={-90} originX={60} originY={60}>
            <Circle
              cx={60}
              cy={60}
              r={RADIUS}
              fill="none"
              stroke={colors.ivory[200]}
              strokeWidth={STROKE}
            />
            {rows.map((row, index) => {
              // 앞 조각들의 길이만큼 밀어 시작점을 잡는다. 누적 변수를 쓰지 않는
              // 이유는 웹 짝과 같다 — 렌더 중 바깥 변수를 바꾸지 않는다.
              const start = rows
                .slice(0, index)
                .reduce((sum, previous) => sum + arcLength(previous.amount), 0);
              // 아주 작은 조각은 간격을 빼면 사라진다. 최소 길이를 남긴다.
              const dash = Math.max(arcLength(row.amount) - gap, 0.6);
              return (
                <Circle
                  key={row.key}
                  cx={60}
                  cy={60}
                  r={RADIUS}
                  fill="none"
                  stroke={row.color}
                  strokeWidth={STROKE}
                  strokeDasharray={`${dash} ${CIRCUMFERENCE - dash}`}
                  // 웹 짝은 `-start` 를 쓴다. 여기서 양수로 적는 이유는 값이 달라서가
                  // 아니라 — 점선 무늬가 둘레마다 되풀이되므로 `C - start` 와 `-start`
                  // 는 같은 자리다 — 음수 dashoffset 이 안드로이드에서 말썽을 낸 적이
                  // 있어서다. 시뮬레이터로 눈으로 못 보는 자리라 안전한 쪽을 고른다.
                  strokeDashoffset={CIRCUMFERENCE - start}
                />
              );
            })}
          </G>
        </Svg>
        <View style={s.donutCenter} pointerEvents="none">
          <Text style={s.donutTotal}>{formatManwon(total)}</Text>
          <Text style={s.donutBasis}>{basisLabel}</Text>
        </View>
      </View>

      <View style={s.legend}>
        {rows.map((row) => (
          <View key={row.key} style={s.legendRow}>
            <View style={[s.dot, { backgroundColor: row.color }]} />
            <Text style={s.legendLabel} numberOfLines={1}>
              {row.label}
            </Text>
            <Text style={s.legendAmount}>{formatManwon(row.amount)}</Text>
            <Text style={s.legendPct}>{formatPercentCell(row.percent, row.amount)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  section: { marginBottom: 20 },
  title: {
    fontSize: 13,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.noir[800],
    marginBottom: 4,
  },
  caption: {
    fontSize: 11,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textTertiary,
    marginBottom: 12,
  },
  donutWrap: { alignItems: "center", justifyContent: "center", marginBottom: 14 },
  donutCenter: { position: "absolute", alignItems: "center", justifyContent: "center" },
  donutTotal: {
    fontSize: 18,
    fontFamily: "CormorantGaramond_600SemiBold",
    color: colors.noir[800],
  },
  donutBasis: {
    fontSize: 10,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textTertiary,
    marginTop: 2,
  },
  legend: { gap: 8 },
  legendRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  legendLabel: {
    flex: 1,
    fontSize: 12,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
  },
  legendAmount: {
    fontSize: 12,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.noir[800],
  },
  // 폭을 고정해 비중이 세로로 줄을 맞춘다. `1% 미만` 이 가장 긴 값이다.
  legendPct: {
    width: 54,
    textAlign: "right",
    fontSize: 12,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textTertiary,
  },
});
