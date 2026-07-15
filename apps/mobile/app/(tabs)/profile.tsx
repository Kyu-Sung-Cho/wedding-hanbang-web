// 프로필/설정 화면
import { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  Alert,
  Linking,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, type Href } from "expo-router";
import {
  ChevronRight,
  LogOut,
  HelpCircle,
  TrendingUp,
  Settings,
  MessageCircle,
  CalendarCheck,
  Bookmark,
  Heart,
  Wallet,
  PenSquare,
  ThumbsUp,
  Info,
  EyeOff,
} from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";
import { supabase } from "@/lib/supabase";
import { readMySafeProfile } from "@/lib/safeProfile";
import * as Application from "expo-application";
import { ActionRow, IconBadge, LoadingState } from "@/components/ui/AppUI";
import ErrorRetry from "@/components/ErrorRetry";

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

type ProfileLoadSource = "auth" | "profile" | "journey" | "partner";

class ProfileLoadError extends Error {
  constructor(
    readonly source: ProfileLoadSource,
    message: string,
  ) {
    super(message);
    this.name = "ProfileLoadError";
  }
}

function profileLoadMessage(source: ProfileLoadSource): string {
  switch (source) {
    case "auth":
      return "로그인 상태를 확인하지 못했어요.";
    case "profile":
      return "내 프로필을 불러오지 못했어요.";
    case "journey":
      return "결혼 준비 정보를 불러오지 못했어요.";
    case "partner":
      return "파트너 연결 정보를 불러오지 못했어요.";
  }
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
  const [statsError, setStatsError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadIssue, setLoadIssue] = useState<ProfileLoadSource | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    try {
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();
      if (authError) throw new ProfileLoadError("auth", "authenticated_user_lookup_failed");
      if (!user) {
        router.replace("/(auth)/login");
        return;
      }

      const { data, error: profileError } = await readMySafeProfile();
      if (profileError || !data) {
        throw new ProfileLoadError("profile", "profile_lookup_failed");
      }

      let weddingDate: string | null = null;
      let partnerName: string | null = null;

      if (data.couple_id) {
        const { data: journey, error: journeyError } = await supabase
          .from("wedding_journeys")
          .select("wedding_date")
          .eq("couple_id", data.couple_id)
          .single();
        if (journeyError || !journey) {
          throw new ProfileLoadError("journey", "journey_lookup_failed");
        }
        weddingDate = journey.wedding_date ?? null;

        const { data: partners, error: partnerError } = await supabase.rpc(
          "get_my_partner_public"
        );
        if (partnerError) {
          throw new ProfileLoadError("partner", "partner_lookup_failed");
        }
        if (partners?.[0]) partnerName = partners[0].name ?? null;
      }

      const { data: activityStatsRows, error: activityStatsError } = await supabase.rpc(
        "get_my_community_activity_stats"
      );
      const activityStats = activityStatsRows?.[0] as
        | {
            post_count?: number | null;
            comment_count?: number | null;
            total_upvotes_received?: number | null;
          }
        | undefined;

      const { count: bookmarkCount, error: bookmarkError } = await supabase
        .from("community_bookmarks")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id);

      if (activityStatsError || bookmarkError) {
        setStatsError(true);
      } else {
        setStats({
          postCount: activityStats?.post_count ?? 0,
          commentCount: activityStats?.comment_count ?? 0,
          bookmarkCount: bookmarkCount ?? 0,
          totalUpvotes: activityStats?.total_upvotes_received ?? 0,
        });
        setStatsError(false);
      }

      const nextProfile: ProfileData = {
        name: data.name ?? null,
        email: user.email ?? null,
        role: data.role ?? null,
        weddingDate,
        dday: calcDday(weddingDate),
        coupleId: data.couple_id ?? null,
        partnerName,
      };
      setProfile(nextProfile);
      setLoadIssue(null);
    } catch (error) {
      setLoadIssue(error instanceof ProfileLoadError ? error.source : "profile");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadProfile();
    setRefreshing(false);
  }, [loadProfile]);

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

  const appVersion = Application.nativeApplicationVersion ?? "1.0.0";
  const buildNumber = Application.nativeBuildVersion ?? "1";

  if (loading && !profile) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <LoadingState label="내 정보를 불러오고 있어요" />
      </SafeAreaView>
    );
  }

  if (loadIssue && !profile) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <ErrorRetry
          message={profileLoadMessage(loadIssue)}
          onRetry={() => void loadProfile()}
        />
      </SafeAreaView>
    );
  }

  if (!profile) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <LoadingState label="로그인 상태를 확인하고 있어요" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {loadIssue && profile && (
          <View style={styles.profileLoadWarning} accessibilityRole="alert">
            <Text style={styles.statsErrorTitle}>마지막으로 확인한 내 정보를 표시하고 있어요</Text>
            <Text style={styles.statsErrorBody}>{profileLoadMessage(loadIssue)}</Text>
            <Pressable
              onPress={() => void loadProfile()}
              disabled={loading}
              accessibilityRole="button"
              accessibilityLabel="내 정보 다시 불러오기"
              style={styles.statsRetryButton}
            >
              <Text style={styles.statsRetryText}>{loading ? "확인 중" : "다시 불러오기"}</Text>
            </Pressable>
          </View>
        )}
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
                  {profile.name ?? "이름 미설정"}
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
          {statsError ? (
            <View style={styles.statsErrorCard} accessibilityRole="alert">
              <Text style={styles.statsErrorTitle}>활동 통계를 불러오지 못했어요.</Text>
              <Text style={styles.statsErrorBody}>0건으로 표시하지 않고 이전 값을 숨겼어요.</Text>
              <Pressable
                onPress={() => void loadProfile()}
                accessibilityRole="button"
                accessibilityLabel="활동 통계 다시 불러오기"
                style={styles.statsRetryButton}
              >
                <Text style={styles.statsRetryText}>다시 불러오기</Text>
              </Pressable>
            </View>
          ) : (
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
              label="받은 공감"
              value={stats.totalUpvotes}
            />
            </View>
          )}
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
            <MenuItem
              icon={TrendingUp}
              label="시세 정보"
              onPress={() => router.push({ pathname: "/market-prices" })}
              isLast
            />
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
              icon={EyeOff}
              label="숨긴 작성자"
              onPress={() => router.push("/community/muted-authors" as Href)}
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
              label="문의 안내"
              onPress={() =>
                Linking.openURL("https://hanbang.ai/support")
              }
            />
            <MenuItem
              icon={Info}
              label={`앱 버전 v${appVersion} (${buildNumber})`}
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
        >
          <LogOut size={18} color={colors.danger} />
          <Text style={styles.logoutText}>로그아웃</Text>
        </Pressable>

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
  onPress?: () => void;
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
  profileLoadWarning: {
    marginHorizontal: 20,
    marginVertical: 12,
    backgroundColor: "#FFF4F2",
    borderColor: "#E8B4AB",
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  statsErrorCard: {
    minHeight: 112,
    justifyContent: "center",
    backgroundColor: "#FFF4F2",
    borderColor: "#E8B4AB",
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    ...CARD_SHADOW,
  },
  statsErrorTitle: {
    fontSize: 14,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.danger,
  },
  statsErrorBody: {
    marginTop: 4,
    fontSize: 12,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
  },
  statsRetryButton: {
    minHeight: 44,
    alignSelf: "flex-start",
    justifyContent: "center",
    marginTop: 4,
    paddingHorizontal: 4,
  },
  statsRetryText: {
    fontSize: 12,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.danger,
    textDecorationLine: "underline",
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
