// 네트워크 에러 시 "다시 시도" UI
import { View, Text, Pressable, StyleSheet } from "react-native";
import { WifiOff, RefreshCw } from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";

interface Props {
  message?: string;
  onRetry: () => void;
}

export default function ErrorRetry({ message, onRetry }: Props) {
  return (
    <View style={styles.container}>
      <WifiOff size={40} color={colors.textTertiary} />
      <Text style={styles.message}>{message ?? "데이터를 불러올 수 없어요"}</Text>
      <Pressable style={styles.retryBtn} onPress={onRetry}>
        <RefreshCw size={16} color="#FFF" />
        <Text style={styles.retryText}>다시 시도</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 16,
  },
  message: {
    fontSize: 15,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
    textAlign: "center",
    lineHeight: 22,
  },
  retryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: colors.noir[800],
  },
  retryText: {
    fontSize: 14,
    fontFamily: "NotoSansKR_600SemiBold",
    color: "#FFF",
  },
});
