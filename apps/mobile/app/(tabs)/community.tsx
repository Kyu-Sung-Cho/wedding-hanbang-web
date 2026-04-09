import { View, Text, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Users } from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";

export default function CommunityScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.center}>
        <View style={styles.logoCircle}>
          <Users size={28} color={colors.rose[500]} />
        </View>
        <Text style={styles.title}>커뮤니티</Text>
        <Text style={styles.subtitle}>
          동기방과 게시판이 여기에 열려요{"\n"}Phase 2 예정
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
    backgroundColor: colors.ivory[200],
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
