// 프로필/설정 화면
import { useEffect, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  Alert,
  Linking,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import {
  ChevronRight,
  LogOut,
  Shield,
  FileText,
  HelpCircle,
  TrendingUp,
  BookOpen,
  Store,
  Settings,
  MessageCircle,
  CalendarCheck,
  Bookmark,
  Star,
} from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";
import { supabase } from "@/lib/supabase";
import Constants from "expo-constants";

interface ProfileData {
  name: string | null;
  email: string | null;
  role: string | null;
  weddingDate: string | null;
  dday: number | null;
  upcomingBookings: number;
}

function calcDday(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const wedding = new Date(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  wedding.setHours(0, 0, 0, 0);
  return Math.ceil(
    (wedding.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  );
}

function formatWeddingDate(dateStr: string): string {
  const d = new Date(dateStr);
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  const day = d.getDate();
  return `${year}년 ${month}월 ${day}일`;
}

function formatDdayLabel(dday: number): string {
  if (dday === 0) return "D-Day";
  if (dday > 0) return `D-${dday}`;
  return `D+${Math.abs(dday)}`;
}

export default function ProfileScreen() {
  const [profile, setProfile] = useState<ProfileData | null>(null);

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .from("profiles")
        .select("name, role, couple_id")
        .eq("id", user.id)
        .single();

      let weddingDate: string | null = null;
      let upcomingBookings = 0;
      if (data?.couple_id) {
        const { data: journey } = await supabase
          .from("wedding_journeys")
          .select("wedding_date")
          .eq("couple_id", data.couple_id)
          .single();
        weddingDate = journey?.wedding_date ?? null;

        // 예정된 예약 수
        const today = new Date().toISOString().split("T")[0];
        const { count } = await supabase
          .from("vendor_bookings")
          .select("id", { count: "exact", head: true })
          .eq("couple_id", data.couple_id)
          .neq("status", "cancelled")
          .gte("booking_date", today);
        upcomingBookings = count ?? 0;
      }

      setProfile({
        name: data?.name ?? null,
        email: user.email ?? null,
        role: data?.role ?? null,
        weddingDate,
        dday: calcDday(weddingDate),
        upcomingBookings,
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

  const roleLabel =
    profile?.role === "bride"
      ? "신부"
      : profile?.role === "groom"
        ? "신랑"
        : null;
  const initial = profile?.name?.charAt(0) ?? "?";

  const appVersion =
    Constants.expoConfig?.version ?? "1.0.0";
  const buildNumber =
    Constants.expoConfig?.ios?.buildNumber ??
    Constants.expoConfig?.android?.versionCode?.toString() ??
    "1";

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
            <Text style={styles.name}>
              {profile?.name ?? "게스트"}
            </Text>
            <Text style={styles.sub}>
              {[roleLabel, profile?.email].filter(Boolean).join(" · ")}
            </Text>
            {profile?.weddingDate && (
              <Text style={styles.weddingDateText}>
                {formatWeddingDate(profile.weddingDate)}
                {profile.dday != null && (
                  <Text style={styles.ddayBadge}>
                    {"  "}
                    {formatDdayLabel(profile.dday)}
                  </Text>
                )}
              </Text>
            )}
          </View>
        </View>

        {/* 예약 요약 */}
        {profile != null && profile.upcomingBookings > 0 && (
          <Pressable
            style={({ pressed }) => [
              styles.bookingSummary,
              pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] },
            ]}
            onPress={() => router.push({ pathname: "/bookings/index" })}
          >
            <CalendarCheck size={18} color={colors.rose[500]} />
            <Text style={styles.bookingSummaryText}>
              예정된 예약 {profile.upcomingBookings}건
            </Text>
            <ChevronRight size={16} color={colors.textTertiary} />
          </Pressable>
        )}

        {/* 서비스 메뉴 */}
        <Text style={styles.menuSectionTitle}>서비스</Text>
        <View style={styles.menuSection}>
          <MenuItem
            icon={CalendarCheck}
            label="내 예약"
            onPress={() => router.push({ pathname: "/bookings/index" })}
          />
          <MenuItem
            icon={FileText}
            label="내가 쓴 글"
            onPress={() => router.push({ pathname: "/community/my-posts" })}
          />
          <MenuItem
            icon={Bookmark}
            label="북마크"
            onPress={() => router.push({ pathname: "/community/my-bookmarks" })}
          />
          <MenuItem
            icon={Star}
            label="15초 후기 작성"
            onPress={() => router.push({ pathname: "/community/quick-review" })}
          />
          <MenuItem
            icon={TrendingUp}
            label="시세 정보"
            onPress={() => router.push({ pathname: "/market-prices" })}
          />
          <MenuItem
            icon={BookOpen}
            label="예절 가이드"
            onPress={() => router.push({ pathname: "/etiquette" })}
          />
          <MenuItem
            icon={Store}
            label="업체 탐색"
            onPress={() => router.push({ pathname: "/vendors" })}
          />
          <MenuItem
            icon={Settings}
            label="설정"
            onPress={() => router.push({ pathname: "/settings" })}
            isLast
          />
        </View>

        {/* 고객지원 메뉴 */}
        <Text style={styles.menuSectionTitle}>고객지원</Text>
        <View style={styles.menuSection}>
          <MenuItem
            icon={MessageCircle}
            label="고객센터 · 문의하기"
            onPress={() =>
              Linking.openURL("https://hanbang.ai/support")
            }
          />
          <MenuItem
            icon={HelpCircle}
            label="도움말"
            onPress={() => Linking.openURL("https://hanbang.ai/help")}
          />
          <MenuItem
            icon={FileText}
            label="이용약관"
            onPress={() =>
              Linking.openURL("https://hanbang.ai/terms")
            }
          />
          <MenuItem
            icon={Shield}
            label="개인정보처리방침"
            onPress={() =>
              Linking.openURL("https://hanbang.ai/privacy")
            }
            isLast
          />
        </View>

        {/* 로그아웃 */}
        <Pressable
          style={({ pressed }) => [
            styles.logoutBtn,
            pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] },
          ]}
          onPress={handleLogout}
        >
          <LogOut size={18} color={colors.danger} />
          <Text style={styles.logoutText}>로그아웃</Text>
        </Pressable>

        {/* 앱 버전 */}
        <Text style={styles.version}>
          웨딩한방 v{appVersion} ({buildNumber})
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function MenuItem({
  icon: Icon,
  label,
  onPress,
  isLast = false,
}: {
  icon: typeof Settings;
  label: string;
  onPress: () => void;
  isLast?: boolean;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.menuItem,
        !isLast && styles.menuItemBorder,
        pressed && { opacity: 0.85, backgroundColor: colors.ivory[50] },
      ]}
      onPress={onPress}
    >
      <Icon size={20} color={colors.textSecondary} />
      <Text style={styles.menuLabel}>{label}</Text>
      <ChevronRight size={16} color={colors.textTertiary} />
    </Pressable>
  );
}

const CARD_SHADOW = {
  shadowColor: "#000" as const,
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.04,
  shadowRadius: 12,
  elevation: 2,
};

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
    borderRadius: 24,
    padding: 20,
    marginBottom: 28,
    ...CARD_SHADOW,
    shadowOpacity: 0.06,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.noir[800],
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontSize: 22,
    fontFamily: "NotoSerifKR_500Medium",
    color: "#FFFFFF",
  },
  name: {
    fontSize: 18,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.noir[800],
  },
  sub: {
    fontSize: 13,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textTertiary,
    marginTop: 2,
  },
  weddingDateText: {
    fontSize: 13,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
    marginTop: 4,
  },
  ddayBadge: {
    fontFamily: "CormorantGaramond_600SemiBold",
    fontSize: 13,
    color: colors.rose[500],
  },

  bookingSummary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.rose.glow,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 24,
  },
  bookingSummaryText: {
    flex: 1,
    fontSize: 14,
    fontFamily: "NotoSansKR_500Medium",
    color: colors.rose[500],
  },

  menuSectionTitle: {
    fontSize: 12,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.textTertiary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
    marginLeft: 4,
  },
  menuSection: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    overflow: "hidden",
    marginBottom: 24,
    ...CARD_SHADOW,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 15,
  },
  menuItemBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  menuLabel: {
    flex: 1,
    fontSize: 15,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.noir[800],
  },

  logoutBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 16,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.15)",
    ...CARD_SHADOW,
    shadowOpacity: 0.02,
  },
  logoutText: {
    fontSize: 15,
    fontFamily: "NotoSansKR_500Medium",
    color: colors.danger,
  },

  version: {
    fontSize: 12,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textTertiary,
    textAlign: "center",
    marginTop: 24,
  },
});
