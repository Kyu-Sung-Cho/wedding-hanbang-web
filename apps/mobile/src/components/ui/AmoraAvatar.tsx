import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { amoraIdentity } from "@hanbang/design-tokens";
import AmoraMark from "./AmoraMark";

type AmoraAvatarProps = {
  size?: number;
  style?: StyleProp<ViewStyle>;
};

export default function AmoraAvatar({ size = 32, style }: AmoraAvatarProps) {
  return (
    <View style={[styles.frame, { width: size, height: size, borderRadius: size / 2 }, style]} accessible={false} pointerEvents="none">
      <AmoraMark size={size * 0.68} />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: amoraIdentity.line,
    backgroundColor: amoraIdentity.surface,
  },
});
