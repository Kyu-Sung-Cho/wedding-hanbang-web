// 체크리스트/일정 화면 — 카테고리 체크 + 일정 CRUD
import { useEffect, useState, useCallback, useRef } from "react";
import {
  View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator,
  RefreshControl, Modal, TextInput, Alert, KeyboardAvoidingView, Platform,
  Animated, LayoutAnimation,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import {
  ChevronDown, ChevronUp, CheckCircle2, Circle,
  Plus, X, CalendarDays, Clock, Trash2, AlertTriangle,
} from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";
import { formatLocalDateOnly } from "@hanbang/shared";
import { supabase } from "@/lib/supabase";
import { apiFetch } from "@/lib/api";
import { CATEGORY_CHECKLISTS } from "@/constants/checklists";
import ErrorRetry from "@/components/ErrorRetry";
import {
  AppHeader,
  AppText,
  LoadingState,
  StatusPill,
  Surface,
} from "@/components/ui/AppUI";

/* ───── types ───── */
interface ChecklistItem {
  id: string;
  label: string;
  done: boolean;
}

interface Category {
  key: string;
  label: string;
  items: ChecklistItem[];
}

interface ScheduleEvent {
  id?: string;
  date: string;
  title: string;
  time?: string;
  categoryKey?: string;
  sourceKey?: string;
  momentType?: string;
  memo?: string;
  createdAt?: string;
  updatedAt?: string;
}

type ActionUrgency = "overdue" | "urgent" | "soon" | "active";

interface WeeklyAction {
  categoryKey: string;
  categoryLabel: string;
  nextItemLabel: string;
  urgency: ActionUrgency;
  deadlineLabel: string;
  daysUntilDeadline: number | null;
  percent: number;
}

const CATEGORY_OPTIONS = [
  "예식장", "스드메", "스튜디오", "드레스", "메이크업", "예복",
  "한복", "예물", "혼수", "허니문", "청첩장", "부케",
  "답례품", "스냅", "영상", "축가", "사회자", "기타",
];

function applyChecklistState(
  categories: Category[],
  progress: Record<string, Record<string, boolean>>,
  categoryKey: string,
  itemId: string,
  done: boolean,
) {
  return {
    categories: categories.map((category) =>
      category.key === categoryKey
        ? {
            ...category,
            items: category.items.map((item) =>
              item.id === itemId ? { ...item, done } : item
            ),
          }
        : category
    ),
    progress: {
      ...progress,
      [categoryKey]: { ...progress[categoryKey], [itemId]: done },
    },
  };
}

/* ───── helpers ───── */
function getUpcomingDays(n: number): string[] {
  const days: string[] = [];
  const today = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    days.push(formatLocalDateOnly(d));
  }
  return days;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function calcDday(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const wedding = new Date(`${dateStr}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  wedding.setHours(0, 0, 0, 0);
  return Math.ceil((wedding.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function formatDday(dday: number | null): string {
  if (dday === null) return "D-—";
  if (dday === 0) return "D-Day";
  return dday > 0 ? `D-${dday}` : `D+${Math.abs(dday)}`;
}

function getPhaseLabel(dday: number | null): string {
  if (dday === null) return "결혼 예정일 설정 필요";
  if (dday < 0) return "본식 이후 정리";
  if (dday <= 30) return "최종 점검";
  if (dday <= 90) return "마무리 준비";
  if (dday <= 180) return "세부 준비";
  if (dday <= 300) return "핵심 계약";
  return "초기 준비";
}

function getUrgencyLabel(urgency: ActionUrgency): string {
  if (urgency === "overdue") return "마감 지남";
  if (urgency === "urgent") return "이번 주";
  if (urgency === "soon") return "곧 마감";
  return "진행 권장";
}

function getUrgencyTone(urgency: ActionUrgency): "neutral" | "rose" | "warning" | "danger" {
  if (urgency === "overdue") return "danger";
  if (urgency === "urgent") return "warning";
  if (urgency === "soon") return "rose";
  return "neutral";
}

function getDayLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  return days[d.getDay()] ?? "";
}

function createEventId(): string {
  return `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function normalizeScheduleEvent(event: ScheduleEvent): ScheduleEvent {
  const now = new Date().toISOString();
  return {
    ...event,
    id: event.id ?? createEventId(),
    createdAt: event.createdAt ?? now,
    updatedAt: event.updatedAt ?? now,
  };
}

/* ───── main screen ───── */
export default function ScheduleScreen() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [progress, setProgress] = useState<Record<string, Record<string, boolean>>>({});
  const [events, setEvents] = useState<ScheduleEvent[]>([]);
  const [weddingDate, setWeddingDate] = useState<string | null>(null);
  const [coupleId, setCoupleId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [hasLoadedData, setHasLoadedData] = useState(false);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  // 진행률 애니메이션
  const progressAnim = useRef(new Animated.Value(0)).current;
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // event modal
  const [modalVisible, setModalVisible] = useState(false);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [formTitle, setFormTitle] = useState("");
  const [formDate, setFormDate] = useState("");
  const [formTime, setFormTime] = useState("");
  const [formCategoryKey, setFormCategoryKey] = useState("");
  const [formMemo, setFormMemo] = useState("");
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    try {
      setLoadError(false);
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) throw authError ?? new Error("authenticated user not found");

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("couple_id")
        .eq("id", user.id)
        .single();

      if (profileError || !profile?.couple_id) {
        throw profileError ?? new Error("couple profile not found");
      }
      setCoupleId(profile.couple_id);

      const { data: journey, error: journeyError } = await supabase
        .from("wedding_journeys")
        .select("wedding_date, progress")
        .eq("couple_id", profile.couple_id)
        .single();
      if (journeyError || !journey) {
        throw journeyError ?? new Error("wedding journey not found");
      }

      setWeddingDate(journey?.wedding_date ?? null);
      const prog = (journey?.progress as Record<string, unknown>) ?? {};

      // 웹과 동일한 progress 구조:
      // progress[catKey] = { category, status, checklist: [{id, label, done}, ...], cost?, budget? }
      // CATEGORY_CHECKLISTS 상수가 소스 → DB의 checklist 배열에서 done 상태만 오버레이
      const cats: Category[] = [];
      const progMap: Record<string, Record<string, boolean>> = {};

      for (const cat of CATEGORY_CHECKLISTS) {
        const dbCatData = prog[cat.key] as {
          status?: string;
          checklist?: Array<{ id: string; label?: string; done: boolean }>;
          [key: string]: unknown;
        } | undefined;

        // DB의 checklist 배열에서 done 상태 매핑
        const dbDoneMap: Record<string, boolean> = {};
        if (dbCatData?.checklist && Array.isArray(dbCatData.checklist)) {
          for (const item of dbCatData.checklist) {
            dbDoneMap[item.id] = !!item.done;
          }
        }
        // 레거시: 플랫 구조 { meeting_01: true } 호환
        if (!dbCatData?.checklist && dbCatData && typeof dbCatData === "object") {
          for (const [k, v] of Object.entries(dbCatData)) {
            if (typeof v === "boolean") dbDoneMap[k] = v;
          }
        }

        const itemStates: Record<string, boolean> = {};
        const checkItems: ChecklistItem[] = cat.items.map((item) => {
          const done = dbDoneMap[item.id] ?? false;
          itemStates[item.id] = done;
          return { id: item.id, label: item.label, done };
        });

        cats.push({ key: cat.key, label: cat.label, items: checkItems });
        progMap[cat.key] = itemStates;
      }

      setCategories(cats);
      setProgress(progMap);

      // 전체 진행률 애니메이션
      if (cats.length > 0) {
        const totalPercent = Math.round(
          cats.reduce((sum, c) => {
            const total = Object.keys(progMap[c.key] ?? {}).length;
            const done = Object.values(progMap[c.key] ?? {}).filter(Boolean).length;
            return sum + (total > 0 ? (done / total) * 100 : 0);
          }, 0) / cats.length
        );
        Animated.timing(progressAnim, {
          toValue: totalPercent,
          duration: 800,
          useNativeDriver: false,
        }).start();
      }

      // 이벤트 추출
      const evts = ((prog.__events as ScheduleEvent[]) ?? []).map(normalizeScheduleEvent);
      setEvents(evts);
      setHasLoadedData(true);
    } catch (err) {
      console.error("일정 로드 오류:", err);
      setLoadError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [progressAnim]);

  useEffect(() => {
    loadData().then(() => {
      // coupleId가 세팅된 후 Realtime 구독
      // setCoupleId는 loadData 안에서 호출되므로 state 대신 직접 참조 불가
      // loadData가 완료된 뒤 다음 렌더에서 coupleId가 설정됨
    });
  }, [loadData]);

  // Realtime: 웹에서 체크리스트 변경 시 자동 갱신
  useEffect(() => {
    if (!coupleId) return;

    const channel = supabase.channel(`schedule:${coupleId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'wedding_journeys',
        filter: `couple_id=eq.${coupleId}`,
      }, () => {
        loadData();
      })
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [coupleId, loadData]);

  /* ── 체크 토글 ── */
  async function toggleItem(categoryKey: string, itemId: string, currentDone: boolean) {
    if (!coupleId) return;

    const nextDone = !currentDone;
    const previousCategories = categories;
    const previousProgress = progress;

    // 레이아웃 애니메이션
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);

    const optimistic = applyChecklistState(
      previousCategories,
      previousProgress,
      categoryKey,
      itemId,
      nextDone,
    );
    setCategories(optimistic.categories);
    setProgress(optimistic.progress);

    // 웹과 동일한 구조로 DB 업데이트
    try {
      const { data: journey } = await supabase
        .from("wedding_journeys")
        .select("progress")
        .eq("couple_id", coupleId)
        .single();

      if (!journey) {
        throw new Error("journey not found");
      }

      const currentProgress = { ...(journey.progress as Record<string, unknown>) };
      const catTemplate = CATEGORY_CHECKLISTS.find((c) => c.key === categoryKey);
      if (!catTemplate) {
        throw new Error("category template not found");
      }

      // 기존 DB의 카테고리 데이터
      const existing = currentProgress[categoryKey] as Record<string, unknown> | undefined;
      const existingChecklist = (existing?.checklist as Array<{ id: string; label: string; done: boolean }>) ?? [];

      // 체크리스트 배열 업데이트 (없으면 상수에서 생성)
      const updatedChecklist = catTemplate.items.map((item) => {
        const dbItem = existingChecklist.find((c) => c.id === item.id);
        const done = item.id === itemId ? nextDone : (dbItem?.done ?? false);
        return { id: item.id, label: item.label, done };
      });

      // 전체 완료 상태 계산
      const allDone = updatedChecklist.every((i) => i.done);
      const anyDone = updatedChecklist.some((i) => i.done);
      const status = allDone ? "completed" : anyDone ? "in_progress" : "not_started";

      currentProgress[categoryKey] = {
        ...(existing ?? {}),
        category: categoryKey,
        status,
        checklist: updatedChecklist,
      };

      const res = await apiFetch("/api/journey", {
        method: "PATCH",
        body: JSON.stringify({ progress_patch: { [categoryKey]: currentProgress[categoryKey] } }),
      });

      if (!res.ok) {
        throw new Error("checklist save failed");
      }
    } catch {
      setCategories(previousCategories);
      setProgress(previousProgress);
      Alert.alert("오류", "체크 상태를 저장하지 못했어요. 다시 시도해주세요.");
    }
  }

  function getCategoryStats(key: string) {
    const items = progress[key] ?? {};
    const total = Object.keys(items).length;
    const done = Object.values(items).filter(Boolean).length;
    return { total, done, percent: total > 0 ? Math.round((done / total) * 100) : 0 };
  }

  function getWeeklyActions(dday: number | null): WeeklyAction[] {
    if (dday !== null && dday < 0) return [];

    const actionCandidates = CATEGORY_CHECKLISTS.flatMap((template) => {
      const stats = getCategoryStats(template.key);
      if (stats.percent >= 100) return [];

      if (dday !== null && dday > template.ddayStart) return [];

      const category = categories.find((c) => c.key === template.key);
      const nextItem = category?.items.find((item) => !item.done);
      const daysUntilDeadline = dday === null ? null : dday - template.ddayDeadline;

      let urgency: ActionUrgency = "active";
      if (daysUntilDeadline !== null) {
        if (daysUntilDeadline < 0) urgency = "overdue";
        else if (daysUntilDeadline <= 7) urgency = "urgent";
        else if (daysUntilDeadline <= 30) urgency = "soon";
      }

      const deadlineLabel =
        daysUntilDeadline === null
          ? "결혼 예정일을 넣으면 마감이 계산돼요"
          : daysUntilDeadline < 0
            ? `${Math.abs(daysUntilDeadline)}일 지났어요`
            : daysUntilDeadline === 0
              ? "오늘까지 권장"
              : `${daysUntilDeadline}일 남음`;

      return [{
        categoryKey: template.key,
        categoryLabel: template.label,
        nextItemLabel: nextItem?.label ?? `${template.label} 체크리스트 점검`,
        urgency,
        deadlineLabel,
        daysUntilDeadline,
        percent: stats.percent,
      }];
    });

    const urgencyRank: Record<ActionUrgency, number> = {
      overdue: 0,
      urgent: 1,
      soon: 2,
      active: 3,
    };

    return actionCandidates
      .sort((a, b) => {
        const urgencyDiff = urgencyRank[a.urgency] - urgencyRank[b.urgency];
        if (urgencyDiff !== 0) return urgencyDiff;
        if (a.daysUntilDeadline !== null && b.daysUntilDeadline !== null) {
          return a.daysUntilDeadline - b.daysUntilDeadline;
        }
        return a.percent - b.percent;
      })
      .slice(0, 3);
  }

  /* ── 이벤트 모달 ── */
  function openAddEventModal() {
    setEditingIdx(null);
    const today = formatLocalDateOnly(new Date());
    setFormTitle("");
    setFormDate(today);
    setFormTime("");
    setFormCategoryKey("");
    setFormMemo("");
    setModalVisible(true);
  }

  function openEditEventModal(idx: number) {
    const evt = events[idx];
    setEditingIdx(idx);
    setFormTitle(evt.title);
    setFormDate(evt.date);
    setFormTime(evt.time ?? "");
    setFormCategoryKey(evt.categoryKey ?? "");
    setFormMemo(evt.memo ?? "");
    setModalVisible(true);
  }

  async function saveEvent() {
    if (!coupleId) return;
    if (!formTitle.trim()) {
      Alert.alert("오류", "일정 제목을 입력해주세요");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(formDate)) {
      Alert.alert("오류", "날짜를 YYYY-MM-DD 형식으로 입력해주세요");
      return;
    }

    setSaving(true);
    try {
      const { data: journey } = await supabase
        .from("wedding_journeys")
        .select("progress")
        .eq("couple_id", coupleId)
        .single();

      const currentProgress = (journey?.progress as Record<string, unknown>) ?? {};
      const currentEvents = (currentProgress.__events as ScheduleEvent[]) ?? [];

      const now = new Date().toISOString();
      const existingEvent = editingIdx !== null ? currentEvents[editingIdx] : null;
      const newEvent: ScheduleEvent = {
        ...(existingEvent ?? {}),
        id: existingEvent?.id ?? createEventId(),
        date: formDate,
        title: formTitle.trim(),
        time: formTime.trim() || undefined,
        categoryKey: formCategoryKey || undefined,
        memo: formMemo.trim() || undefined,
        createdAt: existingEvent?.createdAt ?? now,
        updatedAt: now,
      };

      let updatedEvents: ScheduleEvent[];
      if (editingIdx !== null) {
        updatedEvents = [...currentEvents];
        updatedEvents[editingIdx] = newEvent;
      } else {
        updatedEvents = [...currentEvents, newEvent];
      }

      updatedEvents.sort((a, b) => a.date.localeCompare(b.date));

      const updatedProgress = { ...currentProgress, __events: updatedEvents };
      const res = await apiFetch("/api/journey", {
        method: "PATCH",
        body: JSON.stringify({ progress_patch: { __events: updatedProgress.__events } }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "저장에 실패했어요");
      }

      setModalVisible(false);
      loadData();
    } catch {
      Alert.alert("오류", "저장에 실패했어요. 다시 시도해주세요.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteEvent() {
    if (editingIdx === null || !coupleId) return;
    Alert.alert("삭제 확인", "이 일정을 삭제할까요?", [
      { text: "취소", style: "cancel" },
      {
        text: "삭제",
        style: "destructive",
        onPress: async () => {
          const { data: journey } = await supabase
            .from("wedding_journeys")
            .select("progress")
            .eq("couple_id", coupleId)
            .single();

          const currentProgress = (journey?.progress as Record<string, unknown>) ?? {};
          const currentEvents = (currentProgress.__events as ScheduleEvent[]) ?? [];
          const updatedEvents = currentEvents.filter((_, i) => i !== editingIdx);
          const updatedProgress = { ...currentProgress, __events: updatedEvents };

          const res = await apiFetch("/api/journey", {
            method: "PATCH",
            body: JSON.stringify({ progress_patch: { __events: updatedProgress.__events } }),
          });
          if (!res.ok) {
            Alert.alert("오류", "삭제에 실패했어요. 다시 시도해주세요.");
            return;
          }

          setModalVisible(false);
          loadData();
        },
      },
    ]);
  }

  function handleExpandToggle(key: string) {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedKey(expandedKey === key ? null : key);
  }

  /* ── 임박 일정 (7일 이내) ── */
  const next7Days = getUpcomingDays(7);
  const upcomingEvents = events
    .filter((e) => next7Days.includes(e.date))
    .sort((a, b) => a.date.localeCompare(b.date));

  // 전체 진행률 계산
  const overallPercent = categories.length > 0
    ? Math.round(
        categories.reduce((sum, c) => sum + getCategoryStats(c.key).percent, 0) /
          categories.length
      )
    : 0;
  const dday = calcDday(weddingDate);
  const weeklyActions = getWeeklyActions(dday);
  const overdueCount = weeklyActions.filter((action) => action.urgency === "overdue").length;

  // 진행바 width 보간
  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 100],
    outputRange: ["0%", "100%"],
  });

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <LoadingState label="체크리스트를 정리하고 있어요" />
      </SafeAreaView>
    );
  }

  if (loadError && !hasLoadedData) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <AppHeader title="체크리스트" onBack={() => router.back()} />
        <ErrorRetry
          message="체크리스트와 일정을 불러오지 못했어요"
          onRetry={() => { setLoading(true); loadData(); }}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <AppHeader
        title="체크리스트"
        subtitle="일정과 준비 항목을 같이 관리해요"
        onBack={() => router.back()}
        right={
          <Pressable onPress={openAddEventModal} hitSlop={12} accessibilityRole="button" accessibilityLabel="일정 추가">
            <Plus size={22} color={colors.rose[500]} />
          </Pressable>
        }
      />

      {loadError && hasLoadedData ? (
        <Pressable
          style={({ pressed }) => [styles.loadWarning, pressed && styles.loadWarningPressed]}
          onPress={loadData}
          accessibilityRole="button"
          accessibilityLabel="체크리스트 최신 정보 다시 불러오기"
        >
          <AlertTriangle size={16} color={colors.danger} />
          <Text style={styles.loadWarningText}>최신 체크리스트를 불러오지 못했어요</Text>
          <Text style={styles.loadWarningAction}>다시 시도</Text>
        </Pressable>
      ) : null}

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); loadData(); }}
            tintColor={colors.rose[500]}
          />
        }
      >
        <Surface tone="noir" style={styles.opsCard}>
          <View style={styles.opsTop}>
            <View>
              <AppText variant="caption" style={styles.opsLabel}>
                이번 주 준비 모드
              </AppText>
              <Text style={styles.opsDday}>{formatDday(dday)}</Text>
            </View>
            <StatusPill
              label={
                overdueCount > 0
                  ? `${overdueCount}개 지연`
                  : dday === null
                    ? "날짜 필요"
                    : getPhaseLabel(dday)
              }
              tone={overdueCount > 0 ? "danger" : "rose"}
            />
          </View>
          <AppText variant="body" style={styles.opsCopy}>
            {weddingDate
              ? `${getPhaseLabel(dday)} 단계예요. 이번 주에는 마감이 가까운 항목부터 정리하세요.`
              : "결혼 예정일을 설정하면 D-day 기준으로 이번 주 할 일을 자동 정렬해요."}
          </AppText>
          <View style={styles.summaryTop}>
            <Text style={styles.summaryLabel}>전체 진행률</Text>
            <Text style={styles.summaryPercent}>{overallPercent}%</Text>
          </View>
          <View style={styles.summaryBar}>
            <Animated.View style={[styles.summaryBarFill, { width: progressWidth }]} />
          </View>
        </Surface>

        <Surface style={styles.weeklySection}>
          <View style={styles.weeklyHeader}>
            <View>
              <AppText variant="eyebrow">WEEKLY ACTION</AppText>
              <AppText variant="subtitle">이번 주 추천 행동</AppText>
            </View>
            <CalendarDays size={18} color={colors.rose[500]} />
          </View>
          {weeklyActions.length > 0 ? (
            weeklyActions.map((action) => (
              <Pressable
                key={action.categoryKey}
                style={({ pressed }) => [
                  styles.weeklyActionRow,
                  pressed && styles.rowPressed,
                ]}
                onPress={() => {
                  setExpandedKey(action.categoryKey);
                }}
              >
                <View
                  style={[
                    styles.weeklyActionIcon,
                    action.urgency === "overdue" && styles.weeklyActionIconDanger,
                  ]}
                >
                  {action.urgency === "overdue" ? (
                    <AlertTriangle size={17} color={colors.danger} />
                  ) : (
                    <Circle size={17} color={colors.rose[500]} />
                  )}
                </View>
                <View style={styles.weeklyActionBody}>
                  <View style={styles.weeklyActionTitleRow}>
                    <Text style={styles.weeklyActionTitle} numberOfLines={1}>
                      {action.categoryLabel}
                    </Text>
                    <StatusPill
                      label={getUrgencyLabel(action.urgency)}
                      tone={getUrgencyTone(action.urgency)}
                    />
                  </View>
                  <Text style={styles.weeklyActionDesc} numberOfLines={2}>
                    {action.nextItemLabel} · {action.deadlineLabel}
                  </Text>
                </View>
              </Pressable>
            ))
          ) : (
            <View style={styles.weeklyEmpty}>
              <CheckCircle2 size={24} color={colors.rose[500]} />
              <AppText variant="bodyStrong">이번 주에 급한 준비가 없어요</AppText>
              <AppText variant="caption" style={styles.weeklyEmptyText}>
                아래 체크리스트를 점검하거나 새 일정을 추가해두면 파트너와 함께 동기화돼요.
              </AppText>
            </View>
          )}
        </Surface>

        {/* 임박 알림 섹션 */}
        {upcomingEvents.length > 0 && (
          <View style={styles.upcomingSection}>
            <View style={styles.upcomingHeader}>
              <CalendarDays size={18} color={colors.rose[500]} />
              <Text style={styles.upcomingTitle}>임박 일정</Text>
            </View>
            {upcomingEvents.map((evt, i) => (
              <Pressable
                key={`${evt.date}-${evt.title}-${i}`}
                style={({ pressed }) => [
                  styles.eventCard,
                  pressed && { transform: [{ scale: 0.98 }] },
                ]}
                onPress={() => {
                  const idx = events.findIndex(
                    (e) => e.date === evt.date && e.title === evt.title
                  );
                  if (idx >= 0) openEditEventModal(idx);
                }}
              >
                <View style={styles.eventDateBadge}>
                  <Text style={styles.eventDateNum}>{formatDate(evt.date)}</Text>
                  <Text style={styles.eventDateDay}>{getDayLabel(evt.date)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.eventTitle}>{evt.title}</Text>
                  <View style={styles.eventMeta}>
                    {evt.time ? (
                      <View style={styles.eventMetaRow}>
                        <Clock size={12} color={colors.textTertiary} />
                        <Text style={styles.eventMetaText}>{evt.time}</Text>
                      </View>
                    ) : null}
                    {evt.categoryKey ? (
                      <View style={styles.eventCatBadge}>
                        <Text style={styles.eventCatText}>{evt.categoryKey}</Text>
                      </View>
                    ) : null}
                  </View>
                </View>
              </Pressable>
            ))}
          </View>
        )}

        {/* 카테고리 체크리스트 — 웹 상수 기반, 항상 20개 카테고리 표시 */}
        {(
          categories.map((cat) => {
            const stats = getCategoryStats(cat.key);
            const expanded = expandedKey === cat.key;

            return (
              <View key={cat.key} style={styles.catCard}>
                <Pressable
                  style={styles.catHeader}
                  onPress={() => handleExpandToggle(cat.key)}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.catLabel}>{cat.label}</Text>
                    <Text style={styles.catStat}>{stats.done}/{stats.total} 완료</Text>
                  </View>
                  <View style={styles.catRight}>
                    <Text style={styles.catPercent}>{stats.percent}%</Text>
                    {expanded
                      ? <ChevronUp size={20} color={colors.textTertiary} />
                      : <ChevronDown size={20} color={colors.textTertiary} />
                    }
                  </View>
                </Pressable>

                <View style={styles.catBar}>
                  <View style={[styles.catBarFill, { width: `${stats.percent}%` }]} />
                </View>

                {expanded && (
                  <View style={styles.itemList}>
                    {cat.items.map((item) => (
                      <Pressable
                        key={item.id}
                        style={({ pressed }) => [
                          styles.itemRow,
                          pressed && { transform: [{ scale: 0.98 }] },
                        ]}
                        onPress={() => toggleItem(cat.key, item.id, item.done)}
                      >
                        {item.done
                          ? <CheckCircle2 size={22} color={colors.rose[500]} />
                          : <Circle size={22} color={colors.taupe[400]} />
                        }
                        <Text style={[styles.itemLabel, item.done && styles.itemDone]}>
                          {item.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                )}
              </View>
            );
          })
        )}

        {/* 전체 일정 목록 */}
        {events.length > 0 && (
          <View style={styles.allEventsSection}>
            <Text style={styles.allEventsTitle}>전체 일정</Text>
            {events.map((evt, i) => (
              <Pressable
                key={`all-${evt.date}-${evt.title}-${i}`}
                style={({ pressed }) => [
                  styles.allEventRow,
                  pressed && { transform: [{ scale: 0.98 }] },
                ]}
                onPress={() => openEditEventModal(i)}
              >
                <Text style={styles.allEventDate}>{formatDate(evt.date)}</Text>
                <Text style={styles.allEventTitle}>{evt.title}</Text>
                {evt.time ? <Text style={styles.allEventTime}>{evt.time}</Text> : null}
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>

      {/* 일정 추가/수정 모달 */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {editingIdx !== null ? "일정 수정" : "일정 추가"}
              </Text>
              <Pressable onPress={() => setModalVisible(false)} hitSlop={12}>
                <X size={24} color={colors.textTertiary} />
              </Pressable>
            </View>

            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
              <Text style={styles.fieldLabel}>제목</Text>
              <TextInput
                style={styles.input}
                value={formTitle}
                onChangeText={setFormTitle}
                placeholder="예: 드레스 피팅"
                placeholderTextColor={colors.textTertiary}
              />

              <Text style={styles.fieldLabel}>날짜 (YYYY-MM-DD)</Text>
              <TextInput
                style={styles.input}
                value={formDate}
                onChangeText={setFormDate}
                placeholder="2026-06-15"
                placeholderTextColor={colors.textTertiary}
                keyboardType="numbers-and-punctuation"
              />

              <Text style={styles.fieldLabel}>시간 (선택)</Text>
              <TextInput
                style={styles.input}
                value={formTime}
                onChangeText={setFormTime}
                placeholder="14:00"
                placeholderTextColor={colors.textTertiary}
              />

              <Text style={styles.fieldLabel}>카테고리 (선택)</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
                <Pressable
                  style={[styles.chip, !formCategoryKey && styles.chipActive]}
                  onPress={() => setFormCategoryKey("")}
                >
                  <Text style={[styles.chipText, !formCategoryKey && styles.chipTextActive]}>없음</Text>
                </Pressable>
                {CATEGORY_OPTIONS.map((cat) => (
                  <Pressable
                    key={cat}
                    style={[styles.chip, formCategoryKey === cat && styles.chipActive]}
                    onPress={() => setFormCategoryKey(cat)}
                  >
                    <Text style={[styles.chipText, formCategoryKey === cat && styles.chipTextActive]}>
                      {cat}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>

              <Text style={styles.fieldLabel}>메모 (선택)</Text>
              <TextInput
                style={[styles.input, { height: 60, textAlignVertical: "top" }]}
                value={formMemo}
                onChangeText={setFormMemo}
                placeholder="메모"
                placeholderTextColor={colors.textTertiary}
                multiline
              />
            </ScrollView>

            <View style={styles.modalActions}>
              {editingIdx !== null && (
                <Pressable
                  style={({ pressed }) => [styles.deleteBtn, pressed && { transform: [{ scale: 0.96 }] }]}
                  onPress={deleteEvent}
                >
                  <Trash2 size={18} color="#EF4444" />
                  <Text style={styles.deleteBtnText}>삭제</Text>
                </Pressable>
              )}
              <Pressable
                style={({ pressed }) => [
                  styles.saveBtn,
                  pressed && { transform: [{ scale: 0.98 }] },
                  { flex: 1 },
                ]}
                onPress={saveEvent}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.saveBtnText}>
                    {editingIdx !== null ? "수정 완료" : "추가하기"}
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  loadWarning: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 20, marginTop: 12, paddingHorizontal: 14, borderRadius: 14, backgroundColor: "rgba(239, 68, 68, 0.08)" },
  loadWarningPressed: { opacity: 0.78 },
  loadWarningText: { flex: 1, fontSize: 12, fontFamily: "NotoSansKR_400Regular", color: colors.textSecondary },
  loadWarningAction: { fontSize: 12, fontFamily: "NotoSansKR_600SemiBold", color: colors.danger },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: colors.noir[800],
    fontFamily: "NotoSerifKR_500Medium",
  },

  opsCard: {
    padding: 18,
  },
  opsTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
    marginBottom: 10,
  },
  opsLabel: {
    color: colors.gold.light,
    marginBottom: 2,
  },
  opsDday: {
    fontSize: 42,
    lineHeight: 48,
    fontFamily: "NotoSansKR_700Bold",
    color: "#FFFFFF",
  },
  opsCopy: {
    color: colors.gold.light,
    lineHeight: 22,
    marginBottom: 16,
  },
  weeklySection: {
    paddingVertical: 16,
  },
  weeklyHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  weeklyEmpty: {
    alignItems: "center",
    paddingVertical: 18,
    gap: 6,
  },
  weeklyEmptyText: {
    textAlign: "center",
  },
  weeklyActionRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  weeklyActionIcon: {
    width: 30,
    height: 30,
    borderRadius: 12,
    backgroundColor: colors.rose.glow,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  weeklyActionIconDanger: {
    backgroundColor: "rgba(217,95,95,0.12)",
  },
  weeklyActionBody: {
    flex: 1,
    minWidth: 0,
  },
  weeklyActionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  weeklyActionTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: 16,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.noir[800],
  },
  weeklyActionDesc: {
    fontSize: 14,
    lineHeight: 21,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
  },
  rowPressed: {
    opacity: 0.78,
    transform: [{ scale: 0.99 }],
  },
  summaryTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  summaryLabel: { fontSize: 14, color: colors.gold.light },
  summaryPercent: { fontSize: 32, fontFamily: "NotoSansKR_700Bold", color: "#FFFFFF" },
  summaryBar: {
    height: 6,
    backgroundColor: "rgba(255,255,255,0.15)",
    borderRadius: 3,
    overflow: "hidden",
    marginBottom: 12,
  },
  summaryBarFill: {
    height: "100%",
    backgroundColor: colors.rose[500],
    borderRadius: 3,
  },

  list: { padding: 20, gap: 14, paddingBottom: 128 },

  // 임박 일정
  upcomingSection: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 24,
    padding: 16,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 2,
  },
  upcomingHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  upcomingTitle: { fontSize: 16, fontWeight: "700", color: colors.noir[800] },
  eventCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  eventDateBadge: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: colors.rose.glow,
    alignItems: "center",
    justifyContent: "center",
  },
  eventDateNum: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.rose[500],
    fontFamily: "CormorantGaramond_600SemiBold",
  },
  eventDateDay: { fontSize: 10, color: colors.rose[600] },
  eventTitle: { fontSize: 14, fontWeight: "600", color: colors.noir[800] },
  eventMeta: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  eventMetaRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  eventMetaText: { fontSize: 11, color: colors.textTertiary },
  eventCatBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: colors.ivory[200],
  },
  eventCatText: { fontSize: 10, color: colors.textSecondary },

  // 카테고리 체크리스트
  empty: { alignItems: "center", paddingTop: 60 },
  emptyIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.rose.glow,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  emptyText: { fontSize: 16, fontWeight: "600", color: colors.noir[800], marginBottom: 8 },
  emptyHint: { fontSize: 13, color: colors.textTertiary },

  catCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 20,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 2,
  },
  catHeader: { flexDirection: "row", alignItems: "center", minHeight: 44 },
  catLabel: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.noir[800],
    fontFamily: "NotoSerifKR_500Medium",
  },
  catStat: { fontSize: 12, color: colors.textTertiary, marginTop: 2 },
  catRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  catPercent: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.rose[500],
    fontFamily: "CormorantGaramond_600SemiBold",
  },
  catBar: {
    height: 4,
    backgroundColor: colors.ivory[200],
    borderRadius: 999,
    marginTop: 12,
    overflow: "hidden",
  },
  catBarFill: { height: "100%", backgroundColor: colors.rose[500], borderRadius: 999 },

  itemList: { marginTop: 16, gap: 14 },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 44,
    paddingVertical: 4,
  },
  itemLabel: { fontSize: 14, color: colors.noir[800], flex: 1 },
  itemDone: { textDecorationLine: "line-through", color: colors.textTertiary },

  // 전체 일정 목록
  allEventsSection: { marginTop: 8 },
  allEventsTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.noir[800],
    marginBottom: 12,
    fontFamily: "NotoSerifKR_500Medium",
  },
  allEventRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 14,
    marginBottom: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 2,
  },
  allEventDate: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.rose[500],
    width: 44,
    fontFamily: "CormorantGaramond_600SemiBold",
  },
  allEventTitle: { fontSize: 14, color: colors.noir[800], flex: 1 },
  allEventTime: { fontSize: 12, color: colors.textTertiary },

  // 모달
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  modalContent: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 36,
    maxHeight: "85%",
  },
  modalHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.ivory[200],
    alignSelf: "center",
    marginBottom: 12,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.noir[800],
    fontFamily: "NotoSerifKR_500Medium",
  },

  fieldLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.textSecondary,
    marginBottom: 8,
    marginTop: 16,
  },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: colors.noir[800],
  },
  chipScroll: { flexDirection: "row", marginBottom: 4 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: colors.ivory[200],
    marginRight: 8,
  },
  chipActive: { backgroundColor: colors.noir[800] },
  chipText: { fontSize: 13, color: colors.textSecondary },
  chipTextActive: { color: "#fff", fontWeight: "600" },

  modalActions: {
    flexDirection: "row",
    gap: 12,
    marginTop: 20,
  },
  deleteBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#EF4444",
  },
  deleteBtnText: { fontSize: 14, fontWeight: "600", color: "#EF4444" },
  saveBtn: {
    backgroundColor: colors.rose[500],
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: "center",
  },
  saveBtnText: { fontSize: 16, fontWeight: "600", color: "#fff" },
});
