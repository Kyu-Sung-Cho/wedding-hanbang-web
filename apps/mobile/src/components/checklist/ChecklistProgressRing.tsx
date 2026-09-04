/**
 * 진행률 고리 — 시안의 머리 왼쪽에 있는 것.
 *
 * 웹은 `conic-gradient` 한 겹으로 그리지만 React Native 에는 그런 배경이 없다.
 * 같은 그림을 `react-native-svg` 의 원 하나와 `strokeDasharray` 로 만든다 —
 * 예산 도넛(`components/budget/BudgetShareChart.tsx`)과 같은 수법이다.
 *
 * 가운데 숫자는 **글자로 나간다.** 고리는 `accessibilityRole="progressbar"` 로
 * 읽히고, 색만으로 진행률을 말하지 않는다.
 */

import { View, Text, StyleSheet } from "react-native";
import Svg, { Circle, G } from "react-native-svg";
import { colors } from "@hanbang/design-tokens";

const SIZE = 52;
const RADIUS = 21;
const STROKE = 6;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export default function ChecklistProgressRing({
  percent,
  label,
  centerText,
}: {
  /** 0~100. 분야를 껐으면 0을 준다. */
  percent: number;
  /** 스크린리더가 읽을 이름. 「결혼식장 완료율」 처럼. */
  label: string;
  /** 가운데 글자. 껐을 때는 숫자 대신 줄표가 온다. */
  centerText: string;
}) {
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = (clamped / 100) * CIRCUMFERENCE;

  return (
    <View
      style={s.wrap}
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: clamped }}
    >
      <Svg width={SIZE} height={SIZE}>
        {/* 원은 3시에서 시작하므로 돌려서 12시부터 시계방향으로 채운다. */}
        <G rotation={-90} originX={SIZE / 2} originY={SIZE / 2}>
          <Circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke={colors.ivory[200]}
            strokeWidth={STROKE}
          />
          {filled > 0 ? (
            <Circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              stroke={colors.rose[500]}
              strokeWidth={STROKE}
              strokeLinecap="round"
              strokeDasharray={`${filled} ${CIRCUMFERENCE - filled}`}
            />
          ) : null}
        </G>
      </Svg>
      <Text style={s.center}>{centerText}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { width: SIZE, height: SIZE, alignItems: "center", justifyContent: "center" },
  center: {
    position: "absolute",
    fontSize: 12,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.noir[800],
  },
});
