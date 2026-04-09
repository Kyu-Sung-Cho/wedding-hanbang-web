import { View, Text, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Sparkles } from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";

export default function ChatScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.center}>
        <View style={styles.logoCircle}>
          <Sparkles size={28} color={colors.gold.DEFAULT} />
        </View>
        <Text style={styles.title}>아모라</Text>
        <Text style={styles.subtitle}>
          AI 웨딩 플래너와 대화하세요{"\n"}Phase 1에서 스트리밍 채팅이 열려요
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24 },
  logoCircle: {
    width: 64,
    height: 64,
    borderRadius: 22,
    backgroundColor: colors.noir[800],
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: "500",
    color: colors.noir[800],
    marginBottom: 8,
    letterSpacing: -0.5,
  },
  subtitle: { fontSize: 14, color: colors.textSecondary, textAlign: "center", lineHeight: 22 },
});
