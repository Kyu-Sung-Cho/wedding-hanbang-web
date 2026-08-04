// 프로필/설정 화면
import { useState, useCallback } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  Alert,
  Linking,
  RefreshControl,
  Platform,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";
import * as Application from "expo-application";
import {
  ChevronRight,
  LogOut,
  HelpCircle,
  Store,
  Settings,
  MessageCircle,
  CalendarCheck,
  Bookmark,
  Heart,
  Wallet,
  PenSquare,
  Users,
  ThumbsUp,
  Info,
  Ban,
} from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";
import { supabase } from "@/lib/supabase";
import { apiJson } from "@/lib/api";
import { signOut } from "@/lib/auth";
import Constants from "expo-constants";
import { ActionRow, IconBadge } from "@/components/ui/AppUI";

interface ProfileData {
  name: string | null;
  email: string | null;
  role: string | null;
  weddingDate: string | null;
  dday: number | null;
  coupleId: string | null;
  partnerName: string | null;
}

interface ActivityStats {
  postCount: number;
  commentCount: number;
  bookmarkCount: number;
  totalUpvotes: number;
}

interface CommunityProfileStats {
  post_count?: number | null;
  comment_count?: number | null;
  total_upvotes_received?: number | null;
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

function formatDdayLabel(dday: number): string {
  if (dday === 0) return "D-Day";
  if (dday > 0) return `D-${dday}`;
  return `D+${Math.abs(dday)}`;
}

export default function ProfileScreen() {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [stats, setStats] = useState<ActivityStats>({
    postCount: 0,
    commentCount: 0,
    bookmarkCount: 0,
    totalUpvotes: 0,
  });
  const [refreshing, setRefreshing] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);

  const loadProfile = useCallback(async () => {
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
    let partnerName: string | null = null;

    if (data?.couple_id) {
      // 결혼일
      const { data: journey } = await supabase
        .from("wedding_journeys")
        .select("wedding_date")
        .eq("couple_id", data.couple_id)
        .single();
      weddingDate = journey?.wedding_date ?? null;

      // 파트너 이름
      const { data: partners } = await supabase
        .from("couple_profile_directory")
        .select("name")
        .eq("couple_id", data.couple_id)
        .neq("id", user.id);
      if (partners?.[0]) {
        partnerName = partners[0].name ?? null;
      }
    }

    // 커뮤니티 활동 통계
    let communityProfile: CommunityProfileStats | null = null;
    let actualPostCount = 0;
    try {
      const payload = await apiJson<{
        profile: CommunityProfileStats | null;
        actualPostCount?: number;
      }>("/api/community/profile");
      communityProfile = payload.profile;
      actualPostCount = payload.actualPostCount ?? 0;
    } catch (error) {
      console.warn("[profile] community stats unavailable", error);
    }

    // 북마크 수
    const { count: bookmarkCount } = await supabase
      .from("community_bookmarks")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id);

    setStats({
      postCount: actualPostCount || communityProfile?.post_count || 0,
      commentCount: communityProfile?.comment_count ?? 0,
      bookmarkCount: bookmarkCount ?? 0,
      totalUpvotes: communityProfile?.total_upvotes_received ?? 0,
    });

    setProfile({
      name: data?.name ?? null,
      email: user.email ?? null,
      role: data?.role ?? null,
      weddingDate,
      dday: calcDday(weddingDate),
      coupleId: data?.couple_id ?? null,
      partnerName,
    });
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadProfile();
    }, [loadProfile]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadProfile();
    setRefreshing(false);
  }, [loadProfile]);

  async function performLogout() {
    if (loggingOut) return;

    setLoggingOut(true);
    setLogoutError(null);
    try {
      await signOut();
      router.replace("/(auth)/login");
    } catch {
      const message = "로그아웃하지 못했어요. 연결을 확인하고 다시 시도해주세요.";
      setLogoutError(message);
      if (Platform.OS !== "web") {
        Alert.alert("로그아웃 실패", message);
      }
    } finally {
      setLoggingOut(false);
    }
  }

  function handleLogout() {
    if (Platform.OS === "web") {
      void performLogout();
      return;
    }

    Alert.alert("로그아웃", "정말 로그아웃 하시겠어요?", [
      { text: "취소", style: "cancel" },
      {
        text: "로그아웃",
        style: "destructive",
        onPress: () => void performLogout(),
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
    Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? "1.0.0";
  const buildNumber = Application.nativeBuildVersion ?? "개발";

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* 상단 프로필 영역 (다크 배경) */}
        <View style={styles.heroSection}>
          <Text style={styles.heroTitle}>내 정보</Text>

          {/* 아바타 + 이름 + 역할 */}
          <View style={styles.avatarRow}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initial}</Text>
            </View>
            <View style={styles.profileInfo}>
              <View style={styles.nameRow}>
                <Text style={styles.name}>
                  {profile?.name ?? "게스트"}
                </Text>
                {roleLabel && (
                  <View style={styles.roleBadge}>
                    <Text style={styles.roleBadgeText}>{roleLabel}</Text>
                  </View>
                )}
              </View>
              {profile?.email && (
                <Text style={styles.email}>{profile.email}</Text>
              )}
              {profile?.partnerName && (
                <View style={styles.partnerRow}>
                  <Heart size={12} color={colors.rose[500]} />
                  <Text style={styles.partnerText}>
                    커플 연동됨: {profile.partnerName}
                  </Text>
                </View>
              )}
            </View>
          </View>

          {/* D-day 디스플레이 */}
          {profile?.dday != null && (
            <View style={styles.ddayContainer}>
              <Text style={styles.ddayNumber}>
                {formatDdayLabel(profile.dday)}
              </Text>
              <Text style={styles.ddaySubtext}>
                {profile.dday > 0
                  ? "결혼식까지"
                  : profile.dday === 0
                    ? "축하합니다!"
                    : "결혼식 이후"}
              </Text>
            </View>
          )}
        </View>

        {/* 활동 통계 카드 */}
        <View style={styles.statsContainer}>
          <View style={styles.statsRow}>
            <StatCard
              icon={PenSquare}
              label="작성글"
              value={stats.postCount}
              onPress={() => router.push({ pathname: "/community/my-posts" })}
            />
            <StatCard
              icon={MessageCircle}
              label="댓글"
              value={stats.commentCount}
            />
            <StatCard
              icon={Bookmark}
              label="북마크"
              value={stats.bookmarkCount}
              onPress={() => router.push({ pathname: "/community/my-bookmarks" })}
            />
            <StatCard
              icon={ThumbsUp}
              label="받은 추천"
              value={stats.totalUpvotes}
            />
          </View>
        </View>

        {/* 웨딩 준비 메뉴 */}
        <View style={styles.menuWrapper}>
          <Text style={styles.menuSectionTitle}>웨딩 준비</Text>
          <View style={styles.menuSection}>
            <MenuItem
              icon={CalendarCheck}
              label="일정 관리"
              onPress={() => router.push({ pathname: "/schedule" as const })}
            />
            <MenuItem
              icon={Wallet}
              label="예산 관리"
              onPress={() => router.push({ pathname: "/budget" as const })}
            />
            {/* 웹은 "업체 공시가"가 이제 기본가·추가금만이 아니라 위약금 원문까지
                싣는다. 라벨이 "업체 탐색"이면 앱 사용자는 그게 있는 줄 모른다. */}
            <MenuItem
              icon={Store}
              label="공시가·위약금 보기"
              onPress={() => router.push({ pathname: "/market-prices" })}
              isLast
            />
            {/* "예절 가이드"(→ hanbang.ai/etiquette)는 지웠다. 그 페이지는 2026-07-26에
                제거됐고(가족·지역마다 답이 달라 일반 안내보다 아모라가 상황을 듣고
                정리하는 쪽이 맞다는 판단), 메뉴만 남아 404 웹뷰를 열고 있었다.
                같은 주제는 아모라 채팅 탭에서 다룬다. */}
          </View>

          {/* 커뮤니티 메뉴 */}
          <Text style={styles.menuSectionTitle}>커뮤니티</Text>
          <View style={styles.menuSection}>
            <MenuItem
              icon={PenSquare}
              label="내 글"
              onPress={() => router.push({ pathname: "/community/my-posts" })}
            />
            <MenuItem
              icon={Bookmark}
              label="내 북마크"
              onPress={() => router.push({ pathname: "/community/my-bookmarks" })}
            />
            <MenuItem
              icon={Users}
              label="내 동기방"
              onPress={() => router.push({ pathname: "/community/cohort-discovery" })}
            />
            <MenuItem
              icon={Ban}
              label="차단 관리"
              onPress={() => router.push({ pathname: "/community/blocked-users" as never })}
              isLast
            />
          </View>

          {/* 기타 메뉴 */}
          <Text style={styles.menuSectionTitle}>기타</Text>
          <View style={styles.menuSection}>
            <MenuItem
              icon={Settings}
              label="설정"
              onPress={() => router.push({ pathname: "/settings" })}
            />
            <MenuItem
              icon={HelpCircle}
              label="고객센터"
              onPress={() =>
                Linking.openURL("mailto:ceo@hanbang.ai")
              }
            />
            <MenuItem
              icon={Info}
              label={`앱 버전 v${appVersion} (${buildNumber})`}
              onPress={() => {}}
              isLast
              hideChevron
            />
          </View>
        </View>

        {/* 로그아웃 */}
        <Pressable
          style={({ pressed }) => [
            styles.logoutBtn,
            pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] },
          ]}
          onPress={handleLogout}
          disabled={loggingOut}
        >
          {loggingOut ? (
            <ActivityIndicator size="small" color={colors.danger} />
          ) : (
            <LogOut size={18} color={colors.danger} />
          )}
          <Text style={styles.logoutText}>
            {loggingOut ? "로그아웃 중" : "로그아웃"}
          </Text>
        </Pressable>
        {logoutError ? (
          <Text style={styles.logoutError} accessibilityRole="alert">
            {logoutError}
          </Text>
        ) : null}

        {/* 하단 약관 링크 */}
        <View style={styles.footerLinks}>
          <Pressable onPress={() => Linking.openURL("https://hanbang.ai/terms")}>
            <Text style={styles.footerLinkText}>이용약관</Text>
          </Pressable>
          <Text style={styles.footerDivider}>|</Text>
          <Pressable onPress={() => Linking.openURL("https://hanbang.ai/privacy")}>
            <Text style={styles.footerLinkText}>개인정보처리방침</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

/* 활동 통계 카드 컴포넌트 */
function StatCard({
  icon: Icon,
  label,
  value,
  onPress,
}: {
  icon: typeof PenSquare;
  label: string;
  value: number;
  onPress?: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.statCard,
        pressed && onPress && { opacity: 0.85, transform: [{ scale: 0.96 }] },
      ]}
      onPress={onPress}
      disabled={!onPress}
    >
      <Icon size={16} color={colors.rose[500]} />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </Pressable>
  );
}

/* 메뉴 아이템 컴포넌트 */
function MenuItem({
  icon: Icon,
  label,
  onPress,
  isLast = false,
  hideChevron = false,
}: {
  icon: typeof Settings;
  label: string;
  onPress: () => void;
  isLast?: boolean;
  hideChevron?: boolean;
}) {
  return (
    <View style={!isLast && styles.menuItemBorder}>
      <ActionRow
        icon={
          <IconBadge tone="ivory" size={36}>
            <Icon size={18} color={colors.textSecondary} />
          </IconBadge>
        }
        title={label}
        onPress={onPress}
        right={hideChevron ? null : <ChevronRight size={16} color={colors.textTertiary} />}
      />
    </View>
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
  scrollContent: { paddingBottom: 40 },

  /* 상단 히어로 영역 */
  heroSection: {
    backgroundColor: colors.noir[800],
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 28,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
  },
  heroTitle: {
    fontSize: 28,
    fontFamily: "NotoSerifKR_500Medium",
    color: "#FFFFFF",
    marginBottom: 24,
  },

  /* 아바타 영역 */
  avatarRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.rose[500],
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    borderColor: "rgba(255, 255, 255, 0.2)",
  },
  avatarText: {
    fontSize: 32,
    fontFamily: "NotoSerifKR_500Medium",
    color: "#FFFFFF",
  },
  profileInfo: {
    flex: 1,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  name: {
    fontSize: 22,
    fontFamily: "NotoSansKR_600SemiBold",
    color: "#FFFFFF",
  },
  roleBadge: {
    backgroundColor: colors.rose.glow,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: "rgba(196, 150, 126, 0.3)",
  },
  roleBadgeText: {
    fontSize: 11,
    fontFamily: "NotoSansKR_500Medium",
    color: colors.rose[500],
  },
  email: {
    fontSize: 13,
    fontFamily: "NotoSansKR_400Regular",
    color: "rgba(255, 255, 255, 0.5)",
    marginTop: 4,
  },
  partnerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 6,
  },
  partnerText: {
    fontSize: 12,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.rose.light,
  },

  /* D-day */
  ddayContainer: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 8,
    marginTop: 20,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  ddayNumber: {
    fontSize: 28,
    fontFamily: "CormorantGaramond_600SemiBold",
    color: colors.rose[500],
  },
  ddaySubtext: {
    fontSize: 13,
    fontFamily: "NotoSansKR_400Regular",
    color: "rgba(255, 255, 255, 0.6)",
  },

  /* 활동 통계 */
  statsContainer: {
    paddingHorizontal: 20,
    marginTop: -14,
  },
  statsRow: {
    flexDirection: "row",
    gap: 10,
  },
  statCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 8,
    alignItems: "center",
    gap: 4,
    ...CARD_SHADOW,
    shadowOpacity: 0.06,
  },
  statValue: {
    fontSize: 20,
    fontFamily: "CormorantGaramond_600SemiBold",
    color: colors.noir[800],
  },
  statLabel: {
    fontSize: 11,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
  },

  /* 메뉴 영역 */
  menuWrapper: {
    paddingHorizontal: 20,
    marginTop: 24,
  },
  menuSectionTitle: {
    fontSize: 12,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.textTertiary,
    textTransform: "uppercase",
    letterSpacing: 0,
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
  menuIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: colors.ivory[100],
    alignItems: "center",
    justifyContent: "center",
  },
  menuLabel: {
    flex: 1,
    fontSize: 15,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.noir[800],
  },

  /* 로그아웃 */
  logoutBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 16,
    marginHorizontal: 20,
    marginTop: 4,
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
  logoutError: {
    marginHorizontal: 24,
    marginTop: 10,
    fontSize: 13,
    lineHeight: 20,
    fontFamily: "NotoSansKR_500Medium",
    color: colors.danger,
    textAlign: "center",
  },

  /* 하단 약관 링크 */
  footerLinks: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
    marginTop: 20,
    marginBottom: 8,
  },
  footerLinkText: {
    fontSize: 12,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textTertiary,
  },
  footerDivider: {
    fontSize: 12,
    color: colors.textTertiary,
  },
});
