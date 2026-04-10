// 대시보드 — D-day, 진행률, 오늘의 할 일 (Supabase 실데이터)
import { useEffect, useState, useCallback } from "react";
import { View, Text, ScrollView, StyleSheet, Pressable, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Calendar, CheckCircle2, ChevronRight, Sparkles, Wallet, ClipboardList, Store } from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";
import { supabase } from "@/lib/supabase";

interface DashboardData {
  name: string | null;
  weddingDate: string | null;
  totalBudget: number;
  progress: Record<string, unknown>;
  progressPercent: number;
  todayTasks: { title: string; categoryKey: string }[];
  dday: number | null;
}

function calcDday(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const wedding = new Date(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  wedding.setHours(0, 0, 0, 0);
  return Math.ceil((wedding.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
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

export default function DashboardScreen() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profile } = await supabase
        .from("profiles")
        .select("name, couple_id")
        .eq("id", user.id)
        .single();

      if (!profile?.couple_id) {
        setData({
          name: profile?.name ?? null,
          weddingDate: null,
          totalBudget: 0,
          progress: {},
          progressPercent: 0,
          todayTasks: [],
          dday: null,
        });
        return;
      }

      const { data: journey } = await supabase
        .from("wedding_journeys")
        .select("wedding_date, total_budget, progress")
        .eq("couple_id", profile.couple_id)
        .single();

      const progress = (journey?.progress as Record<string, unknown>) ?? {};
      const progressPercent = calcProgress(progress);

      // 오늘 할 일: 이벤트 중 오늘 날짜인 것
      const today = new Date().toISOString().slice(0, 10);
      const events = ((progress as Record<string, unknown>).__events as Array<{
        date: string;
        title: string;
        categoryKey?: string;
      }>) ?? [];
      const todayTasks = events
        .filter((e) => e.date === today)
        .map((e) => ({ title: e.title, categoryKey: e.categoryKey ?? "" }));

      setData({
        name: profile.name,
        weddingDate: journey?.wedding_date ?? null,
        totalBudget: journey?.total_budget ?? 0,
        progress,
        progressPercent,
        todayTasks,
        dday: calcDday(journey?.wedding_date ?? null),
      });
    } catch (err) {
      console.error("Dashboard load error:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  function onRefresh() {
    setRefreshing(true);
    loadData();
  }

  const greeting = data?.name ? `${data.name}님, 안녕하세요` : "안녕하세요";

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.rose[500]} />
        }
      >
        {/* 인사 */}
        <Text style={styles.greeting}>{greeting}</Text>
        <Text style={styles.brandTitle}>웨딩한방</Text>

        {/* D-day 카드 */}
        <View style={styles.ddayCard}>
          <View style={styles.ddayRow}>
            <View>
              <Text style={styles.ddayLabel}>결혼까지</Text>
              <Text style={styles.ddayValue}>{formatDday(data?.dday ?? null)}</Text>
            </View>
            {data?.weddingDate && (
              <Text style={styles.ddayDate}>
                {new Date(data.weddingDate).toLocaleDateString("ko-KR", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </Text>
            )}
          </View>
          {!data?.weddingDate && (
            <Text style={styles.ddayHint}>결혼 예정일을 설정해보세요</Text>
          )}
        </View>

        {/* 진행률 */}
        <View style={styles.card}>
          <View style={styles.cardRow}>
            <Text style={styles.cardLabel}>전체 진행률</Text>
            <Text style={styles.progressPct}>{data?.progressPercent ?? 0}%</Text>
          </View>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${data?.progressPercent ?? 0}%` }]} />
          </View>
        </View>

        {/* 오늘의 할 일 */}
        <View style={styles.card}>
          <View style={styles.cardRow}>
            <Text style={styles.cardTitle}>오늘의 할 일</Text>
            <Calendar size={18} color={colors.textTertiary} />
          </View>
          {(data?.todayTasks?.length ?? 0) > 0 ? (
            data?.todayTasks.map((task, i) => (
              <View key={i} style={styles.taskRow}>
                <CheckCircle2 size={18} color={colors.rose[500]} />
                <Text style={styles.taskText}>{task.title}</Text>
              </View>
            ))
          ) : (
            <Text style={styles.cardEmpty}>
              {loading ? "불러오는 중..." : "오늘 예정된 할 일이 없어요"}
            </Text>
          )}
        </View>

        {/* 빠른 액션 */}
        <Text style={styles.sectionLabel}>바로가기</Text>
        <View style={styles.actionsRow}>
          <Pressable
            style={({ pressed }) => [styles.actionCard, pressed && { opacity: 0.8 }]}
            onPress={() => router.push("/(tabs)/chat")}
          >
            <View style={styles.actionIcon}>
              <Sparkles size={20} color={colors.gold.DEFAULT} />
            </View>
            <Text style={styles.actionTitle}>아모라</Text>
            <Text style={styles.actionDesc}>AI 상담</Text>
            <ChevronRight size={16} color={colors.textTertiary} style={styles.actionArrow} />
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.actionCard, pressed && { opacity: 0.8 }]}
            onPress={() => router.push("/schedule/index")}
          >
            <View style={[styles.actionIcon, { backgroundColor: colors.ivory[200] }]}>
              <ClipboardList size={20} color={colors.rose[500]} />
            </View>
            <Text style={styles.actionTitle}>체크리스트</Text>
            <Text style={styles.actionDesc}>일정 관리</Text>
            <ChevronRight size={16} color={colors.textTertiary} style={styles.actionArrow} />
          </Pressable>
        </View>

        <View style={[styles.actionsRow, { marginTop: 12 }]}>
          <Pressable
            style={({ pressed }) => [styles.actionCard, pressed && { opacity: 0.8 }]}
            onPress={() => router.push("/budget/index")}
          >
            <View style={[styles.actionIcon, { backgroundColor: colors.ivory[200] }]}>
              <Wallet size={20} color={colors.gold.DEFAULT} />
            </View>
            <Text style={styles.actionTitle}>예산</Text>
            <Text style={styles.actionDesc}>지출 현황</Text>
            <ChevronRight size={16} color={colors.textTertiary} style={styles.actionArrow} />
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.actionCard, pressed && { opacity: 0.8 }]}
            onPress={() => router.push("/vendors/index" as never)}
          >
            <View style={[styles.actionIcon, { backgroundColor: colors.ivory[200] }]}>
              <Store size={20} color={colors.rose[500]} />
            </View>
            <Text style={styles.actionTitle}>업체 탐색</Text>
            <Text style={styles.actionDesc}>업체 찾기</Text>
            <ChevronRight size={16} color={colors.textTertiary} style={styles.actionArrow} />
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingBottom: 40 },

  greeting: { fontSize: 14, color: colors.textSecondary, marginBottom: 4 },
  brandTitle: {
    fontSize: 32,
    fontFamily: "NotoSerifKR_500Medium",
    color: colors.noir[800],
    marginBottom: 24,
    letterSpacing: -0.5,
  },

  // D-day
  ddayCard: {
    backgroundColor: colors.noir[800],
    borderRadius: 28,
    padding: 24,
    marginBottom: 16,
  },
  ddayRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  ddayLabel: { fontSize: 13, color: colors.taupe[400], marginBottom: 6 },
  ddayValue: { fontSize: 48, fontFamily: "CormorantGaramond_400Regular", color: "#FFFFFF" },
  ddayDate: { fontSize: 13, color: colors.taupe[400], marginBottom: 8 },
  ddayHint: { fontSize: 13, color: colors.taupe[400], marginTop: 8 },

  // 카드 공통
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 24,
    padding: 20,
    marginBottom: 16,
  },
  cardRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  cardLabel: { fontSize: 13, color: colors.textSecondary },
  cardTitle: { fontSize: 16, fontWeight: "600", color: colors.noir[800] },
  cardEmpty: { fontSize: 13, color: colors.textTertiary },

  // 진행률
  progressPct: { fontSize: 28, fontFamily: "CormorantGaramond_600SemiBold", color: colors.noir[800] },
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
  taskText: { fontSize: 14, color: colors.noir[800], flex: 1 },

  // 바로가기
  sectionLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.textSecondary,
    marginBottom: 12,
    marginTop: 8,
  },
  actionsRow: { flexDirection: "row", gap: 12 },
  actionCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 20,
    padding: 16,
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
  actionTitle: { fontSize: 15, fontWeight: "600", color: colors.noir[800] },
  actionDesc: { fontSize: 12, color: colors.textTertiary, marginTop: 2 },
  actionArrow: { position: "absolute", top: 16, right: 16 },
});
