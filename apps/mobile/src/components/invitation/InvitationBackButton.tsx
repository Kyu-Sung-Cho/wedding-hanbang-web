import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { ChevronBackIcon } from "./InvitationIcons";
import { glass, palette } from "./invitationStyle";

/**
 * 뒤로 단추(44×44). 흰 화면은 화살표만(22px), 상담 화면은 사진 위 반투명 원(20px)이다.
 */
export default function InvitationBackButton({
  label,
  onPress,
  tone = "plain",
  style,
}: {
  label: string;
  onPress: () => void;
  tone?: "plain" | "glass";
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[styles.base, tone === "glass" && styles.glass, style]}
    >
      {({ pressed }) => (
        <ChevronBackIcon size={tone === "glass" ? 20 : 22} color={pressed ? palette.muted : palette.ink} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  glass: { borderRadius: 22, backgroundColor: glass.back },
});
