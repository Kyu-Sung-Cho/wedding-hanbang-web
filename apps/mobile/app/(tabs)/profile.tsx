import { View, Text, Pressable, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { colors } from "@hanbang/design-tokens";
import { supabase } from "@/lib/supabase";

export default function ProfileScreen() {
  async function handleLogout() {
    await supabase.auth.signOut();
    router.replace("/(auth)/login");
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.content}>
        <Text style={styles.title}>내 정보</Text>

        <View style={styles.profileCard}>
          <View style={styles.profileRow}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>웨</Text>
            </View>
            <View>
              <Text style={styles.name}>게스트</Text>
              <Text style={styles.hint}>로그인이 필요해요</Text>
            </View>
          </View>
        </View>

        <Pressable
          style={({ pressed }) => [styles.logoutBtn, pressed && { opacity: 0.7 }]}
          onPress={handleLogout}
        >
          <Text style={styles.logoutText}>로그아웃</Text>
        </Pressable>

        <Text style={styles.version}>웨딩한방 v1.0.0 · Phase 0</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { flex: 1, paddingHorizontal: 20, paddingTop: 24 },
  title: {
    fontSize: 32,
    fontWeight: "500",
    color: colors.noir[800],
    marginBottom: 32,
    letterSpacing: -0.5,
  },
  profileCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 28,
    padding: 24,
    marginBottom: 16,
  },
  profileRow: { flexDirection: "row", alignItems: "center", gap: 16 },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.ivory[200],
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 22, color: colors.noir[800], fontWeight: "500" },
  name: { fontSize: 16, fontWeight: "600", color: colors.noir[800] },
  hint: { fontSize: 12, color: colors.textTertiary, marginTop: 2 },
  logoutBtn: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  logoutText: { fontSize: 14, color: colors.noir[800] },
  version: {
    fontSize: 12,
    color: colors.textTertiary,
    textAlign: "center",
    marginTop: "auto",
    marginBottom: 16,
  },
});
