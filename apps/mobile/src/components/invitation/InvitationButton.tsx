import { Pressable, StyleSheet, type AccessibilityRole, type StyleProp, type ViewStyle } from "react-native";
import { Text } from "@/components/ui/AppText";
import { glass, hitSlopFor, palette, typo } from "./invitationStyle";

/**
 * 청첩장 디자인의 알약 단추. 아티팩트의 단추 모양 여섯 가지를 그대로 옮겼다.
 * - ink: 잉크 채움, 흰 글자(주 행동)
 * - stone: 돌빛 채움(첫 대화 "고칠게요")
 * - outline: 1px 칩 선, 흰 바탕
 * - dashed: 1px 점선(준비 순서 "넣기")
 * - glass: 반투명 흰색(상담 화면 사진 위)
 * - plain: 글자만(링크). 누르는 동안 글자가 아티팩트의 링크 hover 색이 된다.
 * 높이·좌우 여백·글자 크기·굵기는 화면마다 달라 그대로 받는다. 44pt 보다 낮으면 누를 자리를 넓힌다.
 */
export type InvitationButtonVariant = "ink" | "stone" | "outline" | "dashed" | "glass" | "plain";

type Props = {
  label: string;
  onPress?: () => void;
  variant: InvitationButtonVariant;
  height: number;
  paddingHorizontal?: number;
  radius?: number;
  fontSize: number;
  weight?: "400" | "500" | "700";
  /** 눌러 켜고 끄는 단추(아티팩트 aria-pressed). */
  selected?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
  accessibilityRole?: AccessibilityRole;
  style?: StyleProp<ViewStyle>;
  /** 단추 글자색을 바꿀 때(예: 편지의 금빛 "문구 고치기"). */
  color?: string;
  underline?: boolean;
};

const fills: Record<InvitationButtonVariant, ViewStyle> = {
  ink: { backgroundColor: palette.ink },
  stone: { backgroundColor: palette.stone },
  outline: { backgroundColor: palette.white, borderWidth: 1, borderColor: palette.chipLine },
  dashed: { backgroundColor: palette.white, borderWidth: 1, borderColor: palette.dashed, borderStyle: "dashed" },
  glass: { backgroundColor: glass.chip },
  plain: { backgroundColor: "transparent" },
};

export default function InvitationButton({
  label,
  onPress,
  variant,
  height,
  paddingHorizontal = 0,
  radius,
  fontSize,
  weight = "400",
  selected,
  disabled,
  accessibilityLabel,
  accessibilityRole = "button",
  style,
  color,
  underline = false,
}: Props) {
  const inactive = disabled || !onPress;
  const textColor = color ?? (variant === "ink" ? palette.white : palette.ink);
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      hitSlop={hitSlopFor(height)}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: inactive, selected }}
      style={[
        styles.base,
        fills[variant],
        { height, paddingHorizontal, borderRadius: radius ?? height / 2 },
        style,
      ]}
    >
      {({ pressed }) => (
        <Text
          style={[
            typo.sans,
            { fontSize, fontWeight: weight, color: textColor },
            underline && styles.underline,
            pressed && variant === "plain" && { color: palette.muted },
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: "center", justifyContent: "center", flexDirection: "row" },
  underline: { textDecorationLine: "underline" },
});
