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
  Store,
  Heart,
  AlertTriangle,
  Users,
} from "lucide-react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { colors } from "@hanbang/design-tokens";
import { supabase } from "@/lib/supabase";
import { CATEGORY_CHECKLISTS } from "@/constants/checklists";
import ErrorRetry from "@/components/ErrorRetry";
import AppGuide from "@/components/AppGuide";
import { AppText, SectionHeader, StatusPill, Surface } from "@/components/ui/AppUI";

const APP_GUIDE_KEY = "@hanbang/app_guide_seen";

interface UrgentTask {
  categoryKey: string;
  categoryLabel: string;
  ddayDeadline: number; // 결혼 며칠 전까지 해야 하는지
  remainingDays: number; // 현재 기준 마감까지 남은 일수
  urgency: "overdue" | "soon" | "ontrack";
}

interface PartnerActivity {
  partnerName: string;
  recentCategories: string[]; // 최근 변경된 카테고리 라벨 목록
}

interface BookingOutcomeTask {
  id: string;
  vendorName: string;
  categoryLabel: string;
  bookingDate: string;
  isPast: boolean;
}

interface DashboardData {
  name: string | null;
  weddingDate: string | null;
  totalBudget: number;
  progress: Record<string, unknown>;
  progressPercent: number;
  todayTasks: { title: string; categoryKey: string }[];
  dday: number | null;
  urgentTasks: UrgentTask[];
  bookingOutcomeTasks: BookingOutcomeTask[];
  partnerActivity: PartnerActivity | null;
}

// 매일 바뀌는 동기부여 문구
const DAILY_QUOTES = [
  "완벽한 결혼 준비, 함께할게요",
  "한 걸음씩, 아름다운 결혼을 향해",
  "당신의 특별한 날을 위해",
  "사랑으로 빛나는 그 날까지",
  "설레는 마음, 완벽한 준비",
  "두 사람의 이야기가 시작돼요",
  "소중한 순간을 함께 만들어요",
];

const CATEGORY_LABEL_BY_KEY = Object.fromEntries(
  CATEGORY_CHECKLISTS.map((category) => [category.key, category.label])
) as Record<string, string>;

function readAmount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+(\.\d+)?$/.test(value)) {
    const amount = Number(value);
    return Number.isFinite(amount) ? amount : null;
  }
  return null;
}

function parseBookingDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  if (year && month && day) {
    return new Date(year, month - 1, day);
  }
  return new Date(dateStr);
}

function getTodayStart(): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function formatBookingOutcomeDate(dateStr: string): string {
  const date = parseBookingDate(dateStr);
  if (Number.isNaN(date.getTime())) return "날짜 확인 필요";
  return `${date.getMonth() + 1}월 ${date.getDate()}일`;
}

function getCategoryLabel(category: unknown): string {
  if (typeof category !== "string" || category.length === 0) {
    return "업체";
  }
  return CATEGORY_LABEL_BY_KEY[category] ?? category;
}

function toSingleRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function isOutcomeNeededBooking(row: Record<string, unknown>, today: Date): boolean {
  const status = String(row.status ?? "");
  if (status === "cancelled") return false;

  const actualAmount = readAmount(row.actual_amount);
  if (actualAmount !== null && actualAmount > 0) return false;

  const bookingDate = parseBookingDate(String(row.booking_date ?? ""));
  const isPast = !Number.isNaN(bookingDate.getTime()) && bookingDate < today;
  return status === "completed" || isPast;
}

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

function calcProgress(progress: Record<string, unknown>): number {
  // progress 객체에서 완료된 항목 비율 계산
  let total = 0;
  let done = 0;
  for (const [key, val] of Object.entries(progress)) {
    if (key.startsWith("__")) continue; // __events 등 메타 키 스킵
    if (typeof val === "object" && val !== null) {
      const items = val as Record<string, boolean>;
      for (const v of Object.values(items)) {
        total++;
        if (v === true) done++;
      }
    }
  }
  return total > 0 ? Math.round((done / total) * 100) : 0;
}

function formatDday(d: number | null): string {
  if (d === null) return "D-—";
  if (d === 0) return "D-Day";
  if (d > 0) return `D-${d}`;
  return `D+${Math.abs(d)}`;
}

// 긴급 할 일 계산: 결혼일 기준 마감이 지났거나 임박한 미완료 카테고리 TOP 3
function calcUrgentTasks(
  dday: number | null,
  progress: Record<string, unknown>
): UrgentTask[] {
  if (dday === null || dday <= 0) return [];

  const tasks: UrgentTask[] = [];

  for (const cat of CATEGORY_CHECKLISTS) {
    // 해당 카테고리의 완료 여부 확인
    const catData = progress[cat.key] as {
      status?: string;
      checklist?: Array<{ id: string; done: boolean }>;
      [key: string]: unknown;
    } | undefined;

    // "completed" 상태이면 건너뛰기
    if (catData?.status === "completed") continue;

    // 체크리스트 전체 완료 여부 (레거시 플랫 구조 호환)
    let allDone = false;
    if (catData?.checklist && Array.isArray(catData.checklist)) {
      allDone = catData.checklist.length > 0 && catData.checklist.every((i) => i.done);
    } else if (catData && typeof catData === "object") {
      const boolValues = Object.entries(catData).filter(([, v]) => typeof v === "boolean");
      if (boolValues.length > 0) {
        allDone = boolValues.every(([, v]) => v === true);
      }
    }
    if (allDone) continue;

    // 마감까지 남은 일수 = 현재 D-day - 카테고리 마감 D-day
    // 예: D-day=120, ddayDeadline=150이면 → 이미 30일 지남 (overdue)
    // 예: D-day=120, ddayDeadline=90이면 → 30일 남음
    const remainingDays = dday - cat.ddayDeadline;

    let urgency: UrgentTask["urgency"];
    if (remainingDays < 0) {
      urgency = "overdue";
    } else if (remainingDays <= 14) {
      urgency = "soon";
    } else {
      urgency = "ontrack";
    }

    // ddayStart 기준으로 아직 시작할 시기가 아닌 것은 제외
    // 예: D-day=200, ddayStart=180 → 아직 시작 안 해도 됨
    if (dday > cat.ddayStart) continue;

    tasks.push({
      categoryKey: cat.key,
      categoryLabel: cat.label,
      ddayDeadline: cat.ddayDeadline,
      remainingDays,
      urgency,
    });
  }

  // 긴급도 순 정렬: overdue → soon → ontrack, 같은 레벨이면 남은 일수 적은 순
  const urgencyOrder = { overdue: 0, soon: 1, ontrack: 2 };
  tasks.sort((a, b) => {
    const orderDiff = urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
    if (orderDiff !== 0) return orderDiff;
    return a.remainingDays - b.remainingDays;
  });

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
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profile } = await supabase
        .from("profiles")
        .select("name, couple_id")
        .eq("id", user.id)
        .single();

      coupleIdRef.current = profile?.couple_id ?? null;

      if (!profile?.couple_id) {
        setData({
          name: profile?.name ?? null,
          weddingDate: null,
          totalBudget: 0,
          progress: {},
          progressPercent: 0,
          todayTasks: [],
          dday: null,
          urgentTasks: [],
          bookingOutcomeTasks: [],
          partnerActivity: null,
        });
        return;
      }

      const { data: journey } = await supabase
        .from("wedding_journeys")
        .select("wedding_date, total_budget, progress")
        .eq("couple_id", profile.couple_id)
        .single();

      const progress =
        (journey?.progress as Record<string, unknown>) ?? {};
      const progressPercent = calcProgress(progress);

      // 오늘 할 일: 이벤트 중 오늘 날짜인 것
      const today = new Date().toISOString().slice(0, 10);
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

      // 긴급 할 일 계산
      const urgentTasks = calcUrgentTasks(dday, progress);

      const todayStart = getTodayStart();
      const todayIso = todayStart.toISOString().slice(0, 10);
      let bookingOutcomeTasks: BookingOutcomeTask[] = [];
      try {
        const { data: bookingRows, error: bookingError } = await supabase
          .from("vendor_bookings")
          .select("id, booking_date, status, actual_amount, vendor:vendors(name, category)")
          .eq("couple_id", profile.couple_id)
          .neq("status", "cancelled")
          .or(`status.eq.completed,booking_date.lt.${todayIso}`)
          .or("actual_amount.is.null,actual_amount.eq.0")
          .order("booking_date", { ascending: false })
          .limit(3);

        if (bookingError) throw bookingError;

        const rows = (bookingRows ?? []) as Array<Record<string, unknown>>;
        bookingOutcomeTasks = rows
          .filter((row) => isOutcomeNeededBooking(row, todayStart))
          .map((row) => {
            const vendor = toSingleRelation(
              row.vendor as { name?: unknown; category?: unknown } | { name?: unknown; category?: unknown }[] | null
            );
            const bookingDate = String(row.booking_date ?? "");
            const parsedDate = parseBookingDate(bookingDate);
            const isPast = !Number.isNaN(parsedDate.getTime()) && parsedDate < todayStart;

            return {
              id: String(row.id ?? ""),
              vendorName:
                typeof vendor?.name === "string" && vendor.name.length > 0
                  ? vendor.name
                  : "업체 미정",
              categoryLabel: getCategoryLabel(vendor?.category),
              bookingDate,
              isPast,
            };
          })
          .filter((task) => task.id.length > 0)
          .slice(0, 3);
      } catch {
        // 예약 결과 조회 실패는 홈 진입을 막지 않음
      }

      // 파트너 활동 감지
      let partnerActivity: PartnerActivity | null = null;
      try {
        const { data: partners } = await supabase
          .from("couple_profile_directory")
          .select("name")
          .eq("couple_id", profile.couple_id)
          .neq("id", user.id);

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
        todayTasks,
        dday,
        urgentTasks,
        bookingOutcomeTasks,
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
        })
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'vendor_bookings',
          filter: `couple_id=eq.${cid}`,
        }, () => {
          loadData();
        })
        .subscribe();

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

  const isUrgent = data?.dday != null && data.dday > 0 && data.dday <= 30;

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
      title: "업체 탐색",
      desc: "업체 찾기",
      icon: Store,
      iconColor: colors.rose[500],
      iconBg: colors.ivory[200],
      route: "/vendors" as const,
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
              label={isUrgent ? "집중 관리" : "진행 중"}
              tone={isUrgent ? "danger" : "rose"}
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
              결혼 예정일을 설정하면 오늘 할 일이 더 정확해져요
            </AppText>
          )}

          <View style={styles.commandProgressRow}>
            <AppText variant="caption" style={styles.commandProgressLabel}>
              전체 진행률
            </AppText>
            <Text style={styles.commandProgressValue}>
              {data?.progressPercent ?? 0}%
            </Text>
          </View>
          <View style={styles.commandProgressTrack}>
            <Animated.View
              style={[styles.commandProgressFill, { width: progressWidth }]}
            />
          </View>
        </Surface>

        {/* 예약 결과 기록 */}
        {(data?.bookingOutcomeTasks?.length ?? 0) > 0 && (
          <View style={styles.outcomeSection}>
            <View style={styles.urgentHeader}>
              <CalendarCheck size={18} color={colors.rose[500]} />
              <Text style={styles.urgentTitle}>예약 결과 기록</Text>
              <View style={styles.outcomeCountPill}>
                <Text style={styles.outcomeCountText}>
                  {data?.bookingOutcomeTasks.length ?? 0}건
                </Text>
              </View>
            </View>
            <Text style={styles.outcomeIntro}>
              실제 결제금액과 만족도를 남기면 추가금 기억과 다음 업체 추천이 더 정확해져요.
            </Text>
            {data?.bookingOutcomeTasks.map((task) => (
              <Pressable
                key={task.id}
                style={({ pressed }) => [
                  styles.outcomeRow,
                  pressed && { transform: [{ scale: 0.98 }] },
                ]}
                onPress={() =>
                  router.push({
                    pathname: "/bookings",
                    params: { bookingId: task.id },
                  })
                }
                accessibilityRole="button"
                accessibilityLabel={`${task.vendorName} 실제 결제금액 기록하기`}
              >
                <View style={styles.outcomeIcon}>
                  <Wallet size={17} color={colors.rose[500]} />
                </View>
                <View style={styles.urgentContent}>
                  <View style={styles.urgentTopRow}>
                    <Text style={styles.urgentCategoryLabel} numberOfLines={1}>
                      {task.vendorName}
                    </Text>
                    <View style={styles.outcomeBadge}>
                      <Text style={styles.outcomeBadgeText}>
                        {task.isPast ? "방문 후" : "완료"}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.urgentDeadline}>
                    {formatBookingOutcomeDate(task.bookingDate)} · {task.categoryLabel} · 실결제 입력 필요
                  </Text>
                </View>
                <ChevronRight size={16} color={colors.textTertiary} />
              </Pressable>
            ))}
          </View>
        )}

        {/* 지금 해야 할 것 */}
        {(data?.urgentTasks?.length ?? 0) > 0 && (
          <View style={styles.urgentSection}>
            <View style={styles.urgentHeader}>
              <AlertTriangle size={18} color={colors.warning} />
              <Text style={styles.urgentTitle}>지금 해야 할 것</Text>
            </View>
            {data?.urgentTasks.map((task) => {
              const urgencyColor =
                task.urgency === "overdue"
                  ? "#EF4444"
                  : task.urgency === "soon"
                    ? "#F59E0B"
                    : "#22C55E";
              const urgencyLabel =
                task.urgency === "overdue"
                  ? "마감 지남"
                  : task.urgency === "soon"
                    ? "곧 마감"
                    : "진행 중";
              return (
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
                      { backgroundColor: urgencyColor },
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
                          { backgroundColor: urgencyColor + "1A" },
                        ]}
                      >
                        <Text
                          style={[
                            styles.urgentBadgeText,
                            { color: urgencyColor },
                          ]}
                        >
                          {urgencyLabel}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.urgentDeadline}>
                      {task.remainingDays < 0
                        ? `${Math.abs(task.remainingDays)}일 전까지 완료 권장`
                        : task.remainingDays === 0
                          ? "오늘까지 완료 권장"
                          : `D-${task.ddayDeadline}일 전까지 권장`}
                    </Text>
                  </View>
                  <ChevronRight
                    size={16}
                    color={colors.textTertiary}
                  />
                </Pressable>
              );
            })}
          </View>
        )}

        {/* 파트너 활동 배너 */}
        {data?.partnerActivity && (
          <View style={styles.partnerBanner}>
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
          </View>
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

  // 예약 결과 기록
  outcomeSection: {
    backgroundColor: colors.surface,
    borderRadius: 24,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.rose.glow,
    ...CARD_SHADOW,
  },
  outcomeIntro: {
    fontSize: 13,
    lineHeight: 20,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
    marginBottom: 4,
  },
  outcomeCountPill: {
    marginLeft: "auto",
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: colors.rose.glow,
  },
  outcomeCountText: {
    fontSize: 11,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.rose[600],
  },
  outcomeRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: 14,
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  outcomeIcon: {
    width: 34,
    height: 34,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
    backgroundColor: colors.rose.glow,
  },
  outcomeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: colors.ivory[200],
  },
  outcomeBadgeText: {
    fontSize: 11,
    fontFamily: "NotoSansKR_600SemiBold",
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
