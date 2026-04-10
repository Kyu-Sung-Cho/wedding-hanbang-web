// 프로필/설정 화면
import { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, Alert, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { ChevronRight, LogOut, Globe, Shield, FileText, HelpCircle, TrendingUp, BookOpen, Store } from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";
import { supabase } from "@/lib/supabase";

interface ProfileData {
  name: string | null;
  email: string | null;
  role: string | null;
  weddingDate: string | null;
}

export default function ProfileScreen() {
  const [profile, setProfile] = useState<ProfileData | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .from("profiles")
        .select("name, role, couple_id")
        .eq("id", user.id)
        .single();

      let weddingDate: string | null = null;
      if (data?.couple_id) {
        const { data: journey } = await supabase
          .from("wedding_journeys")
          .select("wedding_date")
          .eq("couple_id", data.couple_id)
          .single();
        weddingDate = journey?.wedding_date ?? null;
      }

      setProfile({
        name: data?.name ?? null,
        email: user.email ?? null,
        role: data?.role ?? null,
        weddingDate,
      });
    })();
  }, []);

  async function handleLogout() {
    Alert.alert("로그아웃", "정말 로그아웃 하시겠어요?", [
      { text: "취소", style: "cancel" },
      {
        text: "로그아웃",
        style: "destructive",
        onPress: async () => {
          await supabase.auth.signOut();
          router.replace("/(auth)/login");
        },
      },
    ]);
  }

  const roleLabel = profile?.role === "bride" ? "신부" : profile?.role === "groom" ? "신랑" : null;
  const initial = profile?.name?.charAt(0) ?? "?";

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>내 정보</Text>

        {/* 프로필 카드 */}
        <View style={styles.profileCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{profile?.name ?? "게스트"}</Text>
            <Text style={styles.sub}>
              {[roleLabel, profile?.email].filter(Boolean).join(" · ")}
            </Text>
            {profile?.weddingDate && (
              <Text style={styles.sub}>
                결혼 예정일: {new Date(profile.weddingDate).toLocaleDateString("ko-KR")}
              </Text>
            )}
          </View>
        </View>

        {/* 메뉴 목록 */}
        <View style={styles.menuSection}>
          <MenuItem icon={TrendingUp} label="시세 정보" onPress={() => router.push("/market-prices" as never)} />
          <MenuItem icon={BookOpen} label="예절 가이드" onPress={() => router.push("/etiquette" as never)} />
          <MenuItem icon={Store} label="업체 탐색" onPress={() => router.push("/vendors" as never)} />
          <MenuItem icon={Globe} label="웹에서 편집" onPress={() => Linking.openURL("https://hanbang.ai/settings")} />
          <MenuItem icon={FileText} label="이용약관" onPress={() => Linking.openURL("https://hanbang.ai/terms")} />
          <MenuItem icon={Shield} label="개인정보처리방침" onPress={() => Linking.openURL("https://hanbang.ai/privacy")} />
          <MenuItem icon={HelpCircle} label="도움말" onPress={() => Linking.openURL("https://hanbang.ai")} />
        </View>

        {/* 로그아웃 */}
        <Pressable
          style={({ pressed }) => [styles.logoutBtn, pressed && { opacity: 0.7 }]}
          onPress={handleLogout}
        >
          <LogOut size={18} color="#EF4444" />
          <Text style={styles.logoutText}>로그아웃</Text>
        </Pressable>

        <Text style={styles.version}>웨딩한방 v1.0.0</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function MenuItem({ icon: Icon, label, onPress }: { icon: typeof Globe; label: string; onPress: () => void }) {
  return (
    <Pressable style={({ pressed }) => [styles.menuItem, pressed && { opacity: 0.7 }]} onPress={onPress}>
      <Icon size={20} color={colors.textSecondary} />
      <Text style={styles.menuLabel}>{label}</Text>
      <ChevronRight size={18} color={colors.textTertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingBottom: 40 },
  title: {
    fontSize: 32,
    fontFamily: "NotoSerifKR_500Medium",
    color: colors.noir[800],
    marginBottom: 24,
  },

  profileCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 24,
    padding: 20,
    marginBottom: 24,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.ivory[200],
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 22, color: colors.noir[800], fontWeight: "500" },
  name: { fontSize: 18, fontWeight: "600", color: colors.noir[800] },
  sub: { fontSize: 13, color: colors.textTertiary, marginTop: 2 },

  menuSection: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 20,
    overflow: "hidden",
    marginBottom: 24,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  menuLabel: { flex: 1, fontSize: 15, color: colors.noir[800] },

  logoutBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 16,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 16,
  },
  logoutText: { fontSize: 15, fontWeight: "500", color: "#EF4444" },

  version: {
    fontSize: 12,
    color: colors.textTertiary,
    textAlign: "center",
    marginTop: 24,
  },
});
