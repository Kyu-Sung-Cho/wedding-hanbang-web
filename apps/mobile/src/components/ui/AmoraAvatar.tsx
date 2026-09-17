import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { amoraIdentity } from "@hanbang/design-tokens";
import AmoraMark from "./AmoraMark";

type AmoraAvatarProps = {
  size?: number;
  style?: StyleProp<ViewStyle>;
};

const FRAME_BORDER = 1;

// 테두리가 곧 나침반 고리다 — 표식의 고리는 빼고 별만 테두리 안쪽 가득 넣는다(amora.ts).
export default function AmoraAvatar({ size = 32, style }: AmoraAvatarProps) {
  return (
    <View style={[styles.frame, { width: size, height: size, borderRadius: size / 2 }, style]} accessible={false} pointerEvents="none">
      <AmoraMark size={size - 2 * FRAME_BORDER} ring={false} />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: FRAME_BORDER,
    borderColor: amoraIdentity.line,
    backgroundColor: amoraIdentity.surface,
  },
});
