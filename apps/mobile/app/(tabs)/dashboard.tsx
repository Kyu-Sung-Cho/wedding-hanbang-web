// 대시보드 — D-day, 진행률, 오늘의 할 일 (Supabase 실데이터)
import { useEffect, useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  RefreshControl,
  Animated,
  Modal,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import {
  Calendar,
  CalendarCheck,
  CheckCircle2,
  ChevronRight,
  Sparkles,
  Wallet,
  ClipboardList,
  Heart,
  Users,
} from "lucide-react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { colors } from "@hanbang/design-tokens";
import {
  calculateJourneyProgressPercent,
  formatLocalDateOnly,
  getJourneyProgressCounts,
} from "@hanbang/shared";
import { supabase } from "@/lib/supabase";
import { readMySafeProfile } from "@/lib/safeProfile";
import { CATEGORY_CHECKLISTS } from "@/constants/checklists";
import ErrorRetry from "@/components/ErrorRetry";
import AppGuide from "@/components/AppGuide";
import { AppText, SectionHeader, StatusPill, Surface } from "@/components/ui/AppUI";

const APP_GUIDE_KEY = "@hanbang/app_guide_seen";
interface StartedTask {
  categoryKey: string;
  categoryLabel: string;
  remainingChecklistItems: number | null;
}

interface PartnerActivity {
  partnerName: string;
  recentCategories: string[]; // 최근 변경된 카테고리 라벨 목록
}

interface DashboardData {
  name: string | null;
  weddingDate: string | null;
  totalBudget: number;
  progress: Record<string, unknown>;
  progressPercent: number;
  progressItemTotal: number;
  todayTasks: { title: string; categoryKey: string }[];
  dday: number | null;
  startedTasks: StartedTask[];
  partnerActivity: PartnerActivity | null;
}

// 매일 바뀌는 동기부여 문구
const DAILY_QUOTES = [
  "우리에게 맞는 결혼 준비, 함께 정리해요",
  "한 걸음씩, 아름다운 결혼을 향해",
  "당신의 특별한 날을 위해",
  "사랑으로 빛나는 그 날까지",
  "설레는 마음, 차근차근 준비",
  "두 사람의 이야기가 시작돼요",
  "소중한 순간을 함께 만들어요",
];

function getGreetingByTime(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "좋은 아침이에요";
  if (hour < 18) return "좋은 오후에요";
  return "좋은 저녁이에요";
}

function getDailyQuote(): string {
  const dayOfYear = Math.floor(
    (Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) /
      (1000 * 60 * 60 * 24)
  );
  return DAILY_QUOTES[dayOfYear % DAILY_QUOTES.length] as string;
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

function formatDday(d: number | null): string {
  if (d === null) return "D-—";
  if (d === 0) return "D-Day";
  if (d > 0) return `D-${d}`;
  return `D+${Math.abs(d)}`;
}

// 사용자가 직접 시작했거나 체크한 준비만 보여준다. 템플릿 시기는 개인 마감으로 쓰지 않는다.
function getStartedTasks(progress: Record<string, unknown>): StartedTask[] {
  const tasks: StartedTask[] = [];

  for (const cat of CATEGORY_CHECKLISTS) {
    const catData = progress[cat.key] as {
      status?: string;
      checklist?: Array<{ id: string; done: boolean }>;
      [key: string]: unknown;
    } | undefined;

    if (!catData || catData.status === "not_applicable" || catData.status === "completed") continue;

    let remainingChecklistItems: number | null = null;
    let hasDirectActivity = catData.status === "in_progress";
    if (Array.isArray(catData.checklist) && catData.checklist.length > 0) {
      hasDirectActivity ||= catData.checklist.some((item) => item.done);
      remainingChecklistItems = catData.checklist.filter((item) => !item.done).length;
    } else {
      const booleanValues = Object.entries(catData)
        .filter(([, value]) => typeof value === "boolean")
        .map(([, value]) => value as boolean);
      if (booleanValues.length > 0) {
        hasDirectActivity ||= booleanValues.some(Boolean);
        remainingChecklistItems = booleanValues.filter((value) => !value).length;
      }
    }
    if (!hasDirectActivity || remainingChecklistItems === 0) continue;

    tasks.push({
      categoryKey: cat.key,
      categoryLabel: cat.label,
      remainingChecklistItems,
    });
  }

  return tasks.slice(0, 3);
}

export default function DashboardScreen() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);

  // 앱 가이드 (첫 실행 시 1회 표시)
  const [showGuide, setShowGuide] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(APP_GUIDE_KEY).then((value) => {
      if (value !== "true") {
        setShowGuide(true);
      }
    });
  }, []);

  const handleGuideClose = useCallback(async () => {
    setShowGuide(false);
    try {
      await AsyncStorage.setItem(APP_GUIDE_KEY, "true");
    } catch {
      // AsyncStorage 저장 실패 시 무시
    }
  }, []);

  // 진행률 바 애니메이션
  const progressAnim = useRef(new Animated.Value(0)).current;

  const coupleIdRef = useRef<string | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // 퀵 액션 스케일 애니메이션용
  const actionScales = useRef([
    new Animated.Value(1),
    new Animated.Value(1),
    new Animated.Value(1),
    new Animated.Value(1),
  ]).current;

  const loadData = useCallback(async () => {
    try {
      setError(false);
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!user) throw new Error("authenticated user unavailable");

      const { data: profile, error: profileError } = await readMySafeProfile();
      if (profileError) throw profileError;

      coupleIdRef.current = profile?.couple_id ?? null;

      if (!profile?.couple_id) {
        setData({
          name: profile?.name ?? null,
          weddingDate: null,
          totalBudget: 0,
          progress: {},
          progressPercent: 0,
          progressItemTotal: 0,
          todayTasks: [],
          dday: null,
          startedTasks: [],
          partnerActivity: null,
        });
        return;
      }

      const { data: journey, error: journeyError } = await supabase
        .from("wedding_journeys")
        .select("wedding_date, total_budget, progress")
        .eq("couple_id", profile.couple_id)
        .single();
      if (journeyError) throw journeyError;

      const progress =
        (journey?.progress as Record<string, unknown>) ?? {};
      const progressPercent = calculateJourneyProgressPercent(progress);
      const progressCounts = getJourneyProgressCounts(progress);

      // 오늘 할 일: 이벤트 중 오늘 날짜인 것
      const today = formatLocalDateOnly(new Date());
      const events =
        ((progress as Record<string, unknown>)?.__events as Array<{
          date: string;
          title: string;
          categoryKey?: string;
        }> | undefined) ?? [];
      const todayTasks = events
        .filter((e) => e.date === today)
        .map((e) => ({ title: e.title, categoryKey: e.categoryKey ?? "" }));

      const dday = calcDday(journey?.wedding_date ?? null);

      const startedTasks = getStartedTasks(progress);

      // 파트너 활동 감지
      let partnerActivity: PartnerActivity | null = null;
      try {
        const { data: partners } = await supabase.rpc("get_my_partner_public");

        if (partners && partners.length > 0) {
          const partnerName = partners[0]?.name ?? "파트너";

          // progress에서 최근 변경된 카테고리 확인
          // in_progress 상태인 카테고리 = 파트너가 작업 중일 수 있음
          const recentCategories: string[] = [];
          for (const cat of CATEGORY_CHECKLISTS) {
            const catData = progress[cat.key] as {
              status?: string;
              updated_by?: string;
              updated_at?: string;
              [key: string]: unknown;
            } | undefined;
            if (!catData) continue;

            // updated_by 필드가 파트너 ID이거나, 최근 변경된 in_progress 항목
            if (catData.updated_by && catData.updated_by !== user.id) {
              // 최근 7일 이내 변경만 표시
              if (catData.updated_at) {
                const updatedDate = new Date(catData.updated_at);
                const sevenDaysAgo = new Date();
                sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
                if (updatedDate >= sevenDaysAgo) {
                  recentCategories.push(cat.label);
                }
              } else {
                recentCategories.push(cat.label);
              }
            }
          }

          if (recentCategories.length > 0) {
            partnerActivity = { partnerName, recentCategories };
          }
        }
      } catch {
        // 파트너 활동 조회 실패 시 무시
      }

      const pct = progressPercent;
      setData({
        name: profile.name,
        weddingDate: journey?.wedding_date ?? null,
        totalBudget: journey?.total_budget ?? 0,
        progress,
        progressPercent: pct,
        progressItemTotal: progressCounts.total,
        todayTasks,
        dday,
        startedTasks,
        partnerActivity,
      });

      // 진행률 바 애니메이션
      progressAnim.setValue(0);
      Animated.timing(progressAnim, {
        toValue: pct,
        duration: 800,
        useNativeDriver: false,
      }).start();
    } catch (err) {
      console.error("Dashboard load error:", err);
      setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [progressAnim]);

  useEffect(() => {
    loadData().then(() => {
      const cid = coupleIdRef.current;
      if (!cid) return;

      // Realtime: 웹에서 변경 시 대시보드 자동 갱신
      const channel = supabase.channel(`dashboard:${cid}`)
        .on('postgres_changes', {
          event: 'UPDATE',
          schema: 'public',
          table: 'wedding_journeys',
          filter: `couple_id=eq.${cid}`,
        }, () => {
          loadData();
        });

      channel.subscribe();

      channelRef.current = channel;
    });

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [loadData]);

  // 데이터 변경 시 진행률 바 다시 애니메이션
  useEffect(() => {
    if (data?.progressPercent != null) {
      Animated.timing(progressAnim, {
        toValue: data.progressPercent,
        duration: 800,
        useNativeDriver: false,
      }).start();
    }
  }, [data?.progressPercent, progressAnim]);

  function onRefresh() {
    setRefreshing(true);
    loadData();
  }

  function handleActionPressIn(index: number) {
    Animated.spring(actionScales[index]!, {
      toValue: 0.96,
      useNativeDriver: true,
    }).start();
  }

  function handleActionPressOut(index: number) {
    Animated.spring(actionScales[index]!, {
      toValue: 1,
      friction: 3,
      tension: 120,
      useNativeDriver: true,
    }).start();
  }

  const timeGreeting = getGreetingByTime();
  const greeting = data?.name
    ? `${data.name}님, ${timeGreeting}`
    : timeGreeting;

  // 진행률 바 width interpolation
  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 100],
    outputRange: ["0%", "100%"],
  });

  const quickActions = [
    {
      title: "아모라",
      desc: "AI 상담",
      icon: Sparkles,
      iconColor: colors.gold.DEFAULT,
      iconBg: colors.noir[800],
      route: "/(tabs)/chat" as const,
    },
    {
      title: "체크리스트",
      desc: "일정 관리",
      icon: ClipboardList,
      iconColor: colors.rose[500],
      iconBg: colors.ivory[200],
      route: "/schedule" as const,
    },
    {
      title: "예산",
      desc: "지출 현황",
      icon: Wallet,
      iconColor: colors.gold.DEFAULT,
      iconBg: colors.ivory[200],
      route: "/budget" as const,
    },
    {
      title: "커뮤니티",
      desc: "경험과 질문",
      icon: Users,
      iconColor: colors.rose[500],
      iconBg: colors.ivory[200],
      route: "/(tabs)/community" as const,
    },
  ];

  if (error && !data) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <ErrorRetry
          message="대시보드를 불러올 수 없어요"
          onRetry={() => { setLoading(true); loadData(); }}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.rose[500]}
          />
        }
      >
        {/* 오늘의 지휘 카드 */}
        <View style={styles.intro}>
          <AppText variant="eyebrow">WEDDING OPS</AppText>
          <AppText variant="title" style={styles.introTitle}>
            {greeting}
          </AppText>
        </View>

        {error && data && (
          <View style={styles.staleBanner} accessibilityRole="alert">
            <Text style={styles.staleBannerText}>
              최신 정보를 불러오지 못했어요. 아래 내용은 마지막으로 확인한 정보예요.
            </Text>
            <Pressable
              onPress={() => {
                setRefreshing(true);
                void loadData();
              }}
              accessibilityRole="button"
              accessibilityLabel="대시보드 다시 불러오기"
            >
              <Text style={styles.staleBannerAction}>다시 불러오기</Text>
            </Pressable>
          </View>
        )}

        <Surface tone="noir" style={styles.commandCard}>
          <View style={styles.commandTop}>
            <View>
              <AppText variant="caption" style={styles.commandEyebrow}>
                결혼까지
              </AppText>
              <Text style={styles.commandDday}>
                {formatDday(data?.dday ?? null)}
              </Text>
            </View>
            <StatusPill
              label={data?.weddingDate ? "예식일 기록" : "예식일 미정"}
              tone="neutral"
            />
          </View>

          {data?.weddingDate ? (
            <AppText variant="body" style={styles.commandDate}>
              {new Date(data.weddingDate).toLocaleDateString("ko-KR", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </AppText>
          ) : (
            <AppText variant="body" style={styles.commandDate}>
              직접 정한 일정과 체크리스트를 한곳에서 확인할 수 있어요
            </AppText>
          )}

          <View style={styles.commandProgressRow}>
            <AppText variant="caption" style={styles.commandProgressLabel}>
              시작한 항목 완료율
            </AppText>
            <Text style={styles.commandProgressValue}>
              {(data?.progressItemTotal ?? 0) > 0 ? `${data?.progressPercent ?? 0}%` : "기록 없음"}
            </Text>
          </View>
          <View style={styles.commandProgressTrack}>
            <Animated.View
              style={[styles.commandProgressFill, { width: progressWidth }]}
            />
          </View>
        </Surface>

        {/* 사용자가 직접 시작한 준비만 사실 기반으로 표시 */}
        {(data?.startedTasks?.length ?? 0) > 0 && (
          <View style={styles.urgentSection}>
            <View style={styles.urgentHeader}>
              <CalendarCheck size={18} color={colors.rose[500]} />
              <Text style={styles.urgentTitle}>직접 시작한 준비</Text>
            </View>
            {data?.startedTasks.map((task) => (
                <Pressable
                  key={task.categoryKey}
                  style={({ pressed }) => [
                    styles.urgentCard,
                    pressed && { transform: [{ scale: 0.98 }] },
                  ]}
                  onPress={() => router.push("/schedule")}
                >
                  <View
                    style={[
                      styles.urgentIndicator,
                      { backgroundColor: colors.rose[500] },
                    ]}
                  />
                  <View style={styles.urgentContent}>
                    <View style={styles.urgentTopRow}>
                      <Text style={styles.urgentCategoryLabel}>
                        {task.categoryLabel}
                      </Text>
                      <View
                        style={[
                          styles.urgentBadge,
                          { backgroundColor: colors.ivory[200] },
                        ]}
                      >
                        <Text
                          style={[
                            styles.urgentBadgeText,
                            { color: colors.textSecondary },
                          ]}
                        >
                          직접 시작
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.urgentDeadline}>
                      {task.remainingChecklistItems === null
                        ? "일정과 체크리스트에서 현재 상태를 확인하세요"
                        : `체크리스트 ${task.remainingChecklistItems}개 남음`}
                    </Text>
                  </View>
                  <ChevronRight
                    size={16}
                    color={colors.textTertiary}
                  />
                </Pressable>
              ))}
          </View>
        )}

        {/* 파트너 활동 배너 */}
        {data?.partnerActivity && (
          <Pressable
            style={({ pressed }) => [
              styles.partnerBanner,
              pressed && styles.partnerBannerPressed,
            ]}
            onPress={() => router.push("/schedule")}
            accessibilityRole="button"
            accessibilityLabel={`${data.partnerActivity.partnerName}님의 최근 준비 변경사항 보기`}
          >
            <Users size={16} color={colors.rose[500]} />
            <Text style={styles.partnerBannerText}>
              {data.partnerActivity.partnerName}님이{" "}
              <Text style={styles.partnerBannerHighlight}>
                {data.partnerActivity.recentCategories.length > 2
                  ? `${data.partnerActivity.recentCategories.slice(0, 2).join(", ")} 외 ${data.partnerActivity.recentCategories.length - 2}건`
                  : data.partnerActivity.recentCategories.join(", ")}
              </Text>
              을(를) 변경했어요
            </Text>
            <ChevronRight size={14} color={colors.textTertiary} />
          </Pressable>
        )}

        {/* 오늘의 할 일 */}
        <Surface style={styles.card}>
          <SectionHeader
            title="오늘의 할 일"
            action={
              <View style={styles.sectionIcon}>
                <Calendar size={16} color={colors.textTertiary} />
              </View>
            }
          />
          {(data?.todayTasks?.length ?? 0) > 0 ? (
            data?.todayTasks.map((task, i) => (
              <View key={i} style={styles.taskRow}>
                <CheckCircle2 size={18} color={colors.rose[500]} />
                <Text style={styles.taskText}>{task.title}</Text>
              </View>
            ))
          ) : (
            <Text style={styles.cardEmpty}>
              {loading
                ? "불러오는 중..."
                : "오늘 예정된 할 일이 없어요"}
            </Text>
          )}
        </Surface>

        {/* 바로가기 */}
        <Text style={styles.sectionLabel}>바로가기</Text>
        <View style={styles.actionsRow}>
          {quickActions.slice(0, 2).map((action, idx) => {
            const Icon = action.icon;
            return (
              <Animated.View
                key={action.title}
                style={[
                  { flex: 1, transform: [{ scale: actionScales[idx]! }] },
                ]}
              >
                <Pressable
                  style={styles.actionCard}
                  onPress={() => router.push(action.route)}
                  onPressIn={() => handleActionPressIn(idx)}
                  onPressOut={() => handleActionPressOut(idx)}
                  accessibilityLabel={action.title}
                >
                  <View
                    style={[
                      styles.actionIcon,
                      { backgroundColor: action.iconBg },
                    ]}
                  >
                    <Icon size={20} color={action.iconColor} />
                  </View>
                  <Text style={styles.actionTitle}>{action.title}</Text>
                  <Text style={styles.actionDesc}>{action.desc}</Text>
                  <ChevronRight
                    size={16}
                    color={colors.textTertiary}
                    style={styles.actionArrow}
                  />
                </Pressable>
              </Animated.View>
            );
          })}
        </View>

        <View style={[styles.actionsRow, { marginTop: 12 }]}>
          {quickActions.slice(2, 4).map((action, idx) => {
            const Icon = action.icon;
            const scaleIdx = idx + 2;
            return (
              <Animated.View
                key={action.title}
                style={[
                  {
                    flex: 1,
                    transform: [{ scale: actionScales[scaleIdx]! }],
                  },
                ]}
              >
                <Pressable
                  style={styles.actionCard}
                  onPress={() => router.push(action.route)}
                  onPressIn={() => handleActionPressIn(scaleIdx)}
                  onPressOut={() => handleActionPressOut(scaleIdx)}
                  accessibilityLabel={action.title}
                >
                  <View
                    style={[
                      styles.actionIcon,
                      { backgroundColor: action.iconBg },
                    ]}
                  >
                    <Icon size={20} color={action.iconColor} />
                  </View>
                  <Text style={styles.actionTitle}>{action.title}</Text>
                  <Text style={styles.actionDesc}>{action.desc}</Text>
                  <ChevronRight
                    size={16}
                    color={colors.textTertiary}
                    style={styles.actionArrow}
                  />
                </Pressable>
              </Animated.View>
            );
          })}
        </View>

        {/* 동기부여 문구 */}
        <View style={styles.quoteCard}>
          <Heart size={14} color={colors.rose[500]} />
          <Text style={styles.quoteText}>{getDailyQuote()}</Text>
        </View>
      </ScrollView>

      {/* 앱 가이드 (첫 실행 시 풀스크린 모달) */}
      <Modal
        visible={showGuide}
        animationType="fade"
        statusBarTranslucent
        onRequestClose={handleGuideClose}
      >
        <AppGuide onClose={handleGuideClose} />
      </Modal>
    </SafeAreaView>
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
  content: { padding: 20, paddingBottom: 128 },

  intro: {
    marginBottom: 14,
    gap: 4,
  },
  introTitle: {
    maxWidth: 330,
    fontSize: 27,
    lineHeight: 35,
  },
  staleBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.ivory[100],
  },
  staleBannerText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
  },
  staleBannerAction: {
    fontSize: 12,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.rose[500],
  },
  commandCard: {
    marginBottom: 14,
    padding: 18,
  },
  commandTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
  },
  commandEyebrow: {
    color: colors.gold.light,
    marginBottom: 4,
  },
  commandDday: {
    fontSize: 50,
    lineHeight: 56,
    fontFamily: "NotoSansKR_700Bold",
    color: "#FFFFFF",
  },
  commandDate: {
    color: colors.gold.light,
    marginTop: 8,
    marginBottom: 18,
  },
  commandProgressRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  commandProgressLabel: {
    color: colors.gold.light,
  },
  commandProgressValue: {
    fontSize: 24,
    fontFamily: "NotoSansKR_700Bold",
    color: colors.gold.light,
  },
  commandProgressTrack: {
    height: 8,
    borderRadius: 999,
    overflow: "hidden",
    backgroundColor: "rgba(255, 255, 255, 0.12)",
  },
  commandProgressFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: colors.rose[500],
  },
  sectionIcon: {
    width: 32,
    height: 32,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.ivory[100],
  },

  greeting: {
    fontSize: 14,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
    marginBottom: 4,
  },
  brandTitle: {
    fontSize: 32,
    fontFamily: "NotoSerifKR_500Medium",
    color: colors.noir[800],
    marginBottom: 24,
    letterSpacing: 0,
  },

  // D-day 기본
  ddayCard: {
    backgroundColor: colors.noir[800],
    borderRadius: 24,
    padding: 24,
    marginBottom: 16,
    ...CARD_SHADOW,
    shadowOpacity: 0.08,
  },
  // D-day 긴급 (30일 이내)
  ddayCardUrgent: {
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.rose[500],
  },
  ddayRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  ddayLabel: {
    fontSize: 13,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.taupe[400],
    marginBottom: 6,
  },
  ddayLabelUrgent: {
    color: colors.textSecondary,
  },
  ddayValue: {
    fontSize: 48,
    fontFamily: "CormorantGaramond_600SemiBold",
    color: "#FFFFFF",
  },
  ddayValueUrgent: {
    color: colors.rose[500],
  },
  ddayDate: {
    fontSize: 13,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.taupe[400],
    marginBottom: 8,
  },
  ddayDateUrgent: {
    color: colors.textSecondary,
  },
  ddayHint: {
    fontSize: 13,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.taupe[400],
    marginTop: 8,
  },

  // 카드 공통
  card: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 18,
    marginBottom: 16,
    ...CARD_SHADOW,
  },
  cardRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  cardLabel: {
    fontSize: 13,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
  },
  cardTitle: {
    fontSize: 16,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.noir[800],
  },
  cardEmpty: {
    fontSize: 14,
    lineHeight: 21,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
  },

  // 진행률
  progressPct: {
    fontSize: 28,
    fontFamily: "CormorantGaramond_600SemiBold",
    color: colors.noir[800],
  },
  progressBar: {
    height: 8,
    backgroundColor: colors.ivory[200],
    borderRadius: 999,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: colors.rose[500],
    borderRadius: 999,
  },

  // 할 일
  taskRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  taskText: {
    fontSize: 14,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.noir[800],
    flex: 1,
  },

  // 바로가기
  sectionLabel: {
    fontSize: 14,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.noir[800],
    marginBottom: 12,
    marginTop: 8,
  },
  actionsRow: { flexDirection: "row", gap: 12 },
  actionCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 16,
    ...CARD_SHADOW,
  },
  actionIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: colors.noir[800],
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  actionTitle: {
    fontSize: 15,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.noir[800],
  },
  actionDesc: {
    fontSize: 12,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textTertiary,
    marginTop: 2,
  },
  actionArrow: { position: "absolute", top: 16, right: 16 },

  // 지금 해야 할 것
  urgentSection: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 18,
    marginBottom: 16,
    ...CARD_SHADOW,
  },
  urgentHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 14,
  },
  urgentTitle: {
    fontSize: 16,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.noir[800],
  },
  urgentCard: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  urgentIndicator: {
    width: 4,
    height: 36,
    borderRadius: 2,
    marginRight: 12,
  },
  urgentContent: {
    flex: 1,
  },
  urgentTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  urgentCategoryLabel: {
    fontSize: 15,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.noir[800],
  },
  urgentBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  urgentBadgeText: {
    fontSize: 11,
    fontFamily: "NotoSansKR_600SemiBold",
  },
  urgentDeadline: {
    fontSize: 13,
    lineHeight: 19,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
  },

  // 파트너 활동 배너
  partnerBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.rose.glow,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  partnerBannerPressed: {
    opacity: 0.78,
    transform: [{ scale: 0.99 }],
  },
  partnerBannerText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.noir[800],
  },
  partnerBannerHighlight: {
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.rose[500],
  },

  // 동기부여 문구
  quoteCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 24,
    paddingVertical: 16,
    paddingHorizontal: 20,
    backgroundColor: colors.ivory[200],
    borderRadius: 16,
  },
  quoteText: {
    fontSize: 13,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
    letterSpacing: 0,
  },
});
