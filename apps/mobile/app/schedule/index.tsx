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
import { formatLocalDateOnly, getJourneyProgressCounts } from "@hanbang/shared";
import { supabase } from "@/lib/supabase";
import { readMySafeProfile } from "@/lib/safeProfile";
import { apiFetch } from "@/lib/api";
import {
  mutateScheduleEvent,
  ScheduleEventConflictError,
  type MobileScheduleEvent,
} from "@/lib/scheduleEvents";
import {
  mutateChecklistItem,
  ChecklistItemConflictError,
} from "@/lib/checklistItems";
import {
  getStartedScheduleActions,
  partitionScheduleCategories,
} from "@/lib/scheduleRecommendations";
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

interface IdentifiedScheduleEvent extends ScheduleEvent {
  id: string;
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

function getDayLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  return days[d.getDay()] ?? "";
}

function createEventId(): string {
  return `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function isScheduleEvent(value: unknown): value is ScheduleEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  return typeof event.date === "string" && typeof event.title === "string";
}

function scheduleEventFingerprint(event: ScheduleEvent): string {
  return JSON.stringify([
    event.date,
    event.title,
    event.time ?? null,
    event.categoryKey ?? null,
    event.sourceKey ?? null,
    event.momentType ?? null,
    event.memo ?? null,
    event.createdAt ?? null,
  ]);
}

function hashScheduleEventFingerprint(value: string): string {
  let primary = 0x811c9dc5;
  let secondary = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    primary = Math.imul(primary ^ code, 0x01000193);
    secondary = Math.imul(secondary ^ code, 0x85ebca6b);
  }
  return `${(primary >>> 0).toString(36)}${(secondary >>> 0).toString(36)}`;
}

function normalizeScheduleEvents(value: unknown): IdentifiedScheduleEvent[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || !value.every(isScheduleEvent)) {
    throw new Error("invalid schedule events");
  }

  const fingerprintOccurrences = new Map<string, number>();
  const eventIds = new Set<string>();
  return value.map((event) => {
    let id: string;
    if (typeof event.id === "string" && event.id.length > 0) {
      id = event.id;
    } else {
      const fingerprint = scheduleEventFingerprint(event);
      const occurrence = fingerprintOccurrences.get(fingerprint) ?? 0;
      fingerprintOccurrences.set(fingerprint, occurrence + 1);
      id = `evt_legacy_${hashScheduleEventFingerprint(fingerprint)}_${occurrence}`;
    }

    if (eventIds.has(id)) {
      throw new Error("duplicate schedule event id");
    }
    eventIds.add(id);
    return { ...event, id };
  });
}

/* ───── main screen ───── */
export default function ScheduleScreen() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [progress, setProgress] = useState<Record<string, Record<string, boolean>>>({});
  const [journeyProgress, setJourneyProgress] = useState<Record<string, unknown>>({});
  const [events, setEvents] = useState<IdentifiedScheduleEvent[]>([]);
  const [weddingDate, setWeddingDate] = useState<string | null>(null);
  const [coupleId, setCoupleId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [hasLoadedData, setHasLoadedData] = useState(false);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [showOptionalCategories, setShowOptionalCategories] = useState(false);

  // 진행률 애니메이션
  const progressAnim = useRef(new Animated.Value(0)).current;
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // event modal
  const [modalVisible, setModalVisible] = useState(false);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [editingEventUpdatedAt, setEditingEventUpdatedAt] = useState<string | null>(null);
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

      const { data: profile, error: profileError } = await readMySafeProfile();

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
      setJourneyProgress(prog);

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

      // 이벤트 추출
      const evts = normalizeScheduleEvents(prog.__events);
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

    const applyAuthoritativeCategory = (authoritativeProgress: Record<string, unknown>) => {
      const category = authoritativeProgress[categoryKey] as
        | { checklist?: ChecklistItem[] }
        | undefined;
      if (!Array.isArray(category?.checklist)) return false;
      setJourneyProgress(authoritativeProgress);
      const canonicalItems = category.checklist;
      setCategories((current) => current.map((entry) =>
        entry.key === categoryKey ? { ...entry, items: canonicalItems } : entry
      ));
      setProgress((current) => ({
        ...current,
        [categoryKey]: Object.fromEntries(
          canonicalItems.map((item) => [item.id, item.done]),
        ),
      }));
      return true;
    };

    try {
      const result = await mutateChecklistItem({
        categoryKey,
        itemId,
        done: nextDone,
        expectedDone: currentDone,
      }, apiFetch);
      if (!applyAuthoritativeCategory(result.progress)) {
        throw new Error("authoritative checklist missing");
      }
    } catch (error) {
      if (
        error instanceof ChecklistItemConflictError &&
        applyAuthoritativeCategory(error.progress)
      ) {
        Alert.alert("최신 상태 반영", "다른 기기에서 먼저 바꾼 체크 상태를 반영했어요.");
        return;
      }
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

  /* ── 이벤트 모달 ── */
  function openAddEventModal() {
    setEditingEventId(null);
    setEditingEventUpdatedAt(null);
    const today = formatLocalDateOnly(new Date());
    setFormTitle("");
    setFormDate(today);
    setFormTime("");
    setFormCategoryKey("");
    setFormMemo("");
    setModalVisible(true);
  }

  function openEditEventModal(eventId: string) {
    const evt = events.find((event) => event.id === eventId);
    if (!evt) {
      Alert.alert("일정을 다시 불러와주세요", "선택한 일정이 최신 목록에 없어요.");
      return;
    }
    if (evt.id.startsWith("evt_legacy_") || !evt.createdAt || !evt.updatedAt) {
      Alert.alert(
        "일정을 수정할 수 없어요",
        "이전 형식으로 저장된 일정입니다. 내용을 확인한 뒤 새 일정으로 다시 등록해주세요.",
      );
      return;
    }
    setEditingEventId(eventId);
    setEditingEventUpdatedAt(evt.updatedAt);
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
      const now = new Date().toISOString();
      const existingEvent = editingEventId === null
        ? null
        : events.find((event) => event.id === editingEventId);
      const newEvent: MobileScheduleEvent = {
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

      let result;
      if (editingEventId === null) {
        result = await mutateScheduleEvent({ operation: "add", event: newEvent }, apiFetch);
      } else {
        if (!existingEvent || !editingEventUpdatedAt) {
          throw new Error("event changed before edit");
        }
        result = await mutateScheduleEvent({
          operation: "update",
          eventId: existingEvent.id,
          event: newEvent,
          expectedUpdatedAt: editingEventUpdatedAt,
        }, apiFetch);
      }

      setEvents(normalizeScheduleEvents(result.progress.__events));
      setModalVisible(false);
      setEditingEventUpdatedAt(null);
    } catch (error) {
      if (error instanceof ScheduleEventConflictError) {
        setEvents(normalizeScheduleEvents(error.progress.__events));
        setModalVisible(false);
        setEditingEventUpdatedAt(null);
        Alert.alert(
          "일정이 변경되었어요",
          "다른 기기에서 먼저 변경한 최신 내용을 불러왔어요. 확인한 뒤 다시 시도해주세요.",
        );
        return;
      }
      Alert.alert("오류", "저장에 실패했어요. 다시 시도해주세요.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteEvent() {
    if (editingEventId === null || !coupleId) return;
    Alert.alert("삭제 확인", "이 일정을 삭제할까요?", [
      { text: "취소", style: "cancel" },
      {
        text: "삭제",
        style: "destructive",
        onPress: async () => {
          try {
            const existingEvent = events.find((event) => event.id === editingEventId);
            if (!existingEvent || !editingEventUpdatedAt) {
              throw new Error("event changed before delete");
            }
            const result = await mutateScheduleEvent({
              operation: "delete",
              eventId: existingEvent.id,
              expectedUpdatedAt: editingEventUpdatedAt,
            }, apiFetch);

            setEvents(normalizeScheduleEvents(result.progress.__events));
            setModalVisible(false);
            setEditingEventUpdatedAt(null);
          } catch (error) {
            if (error instanceof ScheduleEventConflictError) {
              setEvents(normalizeScheduleEvents(error.progress.__events));
              setModalVisible(false);
              setEditingEventUpdatedAt(null);
              Alert.alert(
                "일정이 변경되었어요",
                "다른 기기에서 먼저 변경한 최신 내용을 불러왔어요. 확인한 뒤 다시 시도해주세요.",
              );
              return;
            }
            Alert.alert("오류", "삭제에 실패했어요. 다시 시도해주세요.");
          }
        },
      },
    ]);
  }

  function handleExpandToggle(key: string) {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedKey(expandedKey === key ? null : key);
  }

  function renderCategoryCard(cat: Category, optional = false) {
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
            <Text style={styles.catStat}>
              {optional ? "선택 참고 · 필요한 경우만" : `${stats.done}/${stats.total} 완료`}
            </Text>
          </View>
          <View style={styles.catRight}>
            <Text style={styles.catPercent}>{optional ? "선택" : `${stats.percent}%`}</Text>
            {expanded
              ? <ChevronUp size={20} color={colors.textTertiary} />
              : <ChevronDown size={20} color={colors.textTertiary} />
            }
          </View>
        </Pressable>

        {!optional ? (
          <View style={styles.catBar}>
            <View style={[styles.catBarFill, { width: `${stats.percent}%` }]} />
          </View>
        ) : null}

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
  }

  /* ── 임박 일정 (7일 이내) ── */
  const next7Days = getUpcomingDays(7);
  const upcomingEvents = events
    .filter((e) => next7Days.includes(e.date))
    .sort((a, b) => a.date.localeCompare(b.date));

  const progressCounts = getJourneyProgressCounts(journeyProgress);
  const overallPercent = progressCounts.total > 0
    ? Math.round((progressCounts.done / progressCounts.total) * 100)
    : 0;
  const dday = calcDday(weddingDate);
  const weeklyActions = getStartedScheduleActions(categories, journeyProgress);
  const categoryGroups = partitionScheduleCategories(categories, journeyProgress);

  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: overallPercent,
      duration: 500,
      useNativeDriver: false,
    }).start();
  }, [overallPercent, progressAnim]);

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
                내가 정한 예식일
              </AppText>
              <Text style={styles.opsDday}>{formatDday(dday)}</Text>
            </View>
            <StatusPill
              label={dday === null ? "일정 미설정" : "일정 연결됨"}
              tone="neutral"
            />
          </View>
          <AppText variant="body" style={styles.opsCopy}>
            {weddingDate
              ? "예식일은 내가 정한 일정을 한눈에 보는 기준이에요. 날짜만으로 체크리스트에 마감이나 긴급 상태를 만들지 않아요."
              : "예식일을 정하지 않아도 필요한 항목만 골라 시작할 수 있어요."}
          </AppText>
          <View style={styles.summaryTop}>
            <Text style={styles.summaryLabel}>시작한 항목 완료율</Text>
            <Text style={styles.summaryPercent}>
              {progressCounts.total > 0 ? `${overallPercent}%` : "기록 없음"}
            </Text>
          </View>
          <View style={styles.summaryBar}>
            <Animated.View style={[styles.summaryBarFill, { width: progressWidth }]} />
          </View>
        </Surface>

        <Surface style={styles.weeklySection}>
          <View style={styles.weeklyHeader}>
            <View>
              <AppText variant="eyebrow">MY NEXT STEP</AppText>
              <AppText variant="subtitle">시작한 항목의 다음 확인</AppText>
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
                  style={styles.weeklyActionIcon}
                >
                  <Circle size={17} color={colors.rose[500]} />
                </View>
                <View style={styles.weeklyActionBody}>
                  <View style={styles.weeklyActionTitleRow}>
                    <Text style={styles.weeklyActionTitle} numberOfLines={1}>
                      {action.categoryLabel}
                    </Text>
                    <StatusPill label="직접 시작" tone="rose" />
                  </View>
                  <Text style={styles.weeklyActionDesc} numberOfLines={2}>
                    {action.nextItemLabel} · 필요한 경우 직접 일정을 추가하세요
                  </Text>
                </View>
              </Pressable>
            ))
          ) : (
            <View style={styles.weeklyEmpty}>
              <CheckCircle2 size={24} color={colors.rose[500]} />
              <AppText variant="bodyStrong">시작한 항목 중 다음 확인이 없어요</AppText>
              <AppText variant="caption" style={styles.weeklyEmptyText}>
                필요한 항목을 직접 고르면 그때부터 다음 확인을 보여드려요.
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
            {upcomingEvents.map((evt) => (
              <Pressable
                key={evt.id}
                style={({ pressed }) => [
                  styles.eventCard,
                  pressed && { transform: [{ scale: 0.98 }] },
                ]}
                onPress={() => openEditEventModal(evt.id)}
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

        <View style={styles.checklistSectionHeader}>
          <Text style={styles.checklistSectionTitle}>내가 시작한 준비</Text>
          <Text style={styles.checklistSectionCopy}>
            직접 시작한 항목만 완료율에 포함돼요.
          </Text>
        </View>

        {categoryGroups.started.length > 0 ? (
          categoryGroups.started.map((category) => renderCategoryCard(category))
        ) : (
          <Surface style={styles.startedEmptyCard}>
            <AppText variant="bodyStrong">아직 시작한 준비가 없어요</AppText>
            <AppText variant="caption" style={styles.weeklyEmptyText}>
              아래 참고 항목에서 필요한 것만 골라 시작하세요.
            </AppText>
          </Surface>
        )}

        <Pressable
          style={({ pressed }) => [
            styles.optionalToggle,
            pressed && styles.rowPressed,
          ]}
          onPress={() => setShowOptionalCategories((current) => !current)}
          accessibilityRole="button"
          accessibilityState={{ expanded: showOptionalCategories }}
          accessibilityLabel="선택 가능한 참고 항목 보기"
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.optionalToggleTitle}>
              선택 가능한 참고 항목 {categoryGroups.optional.length}개
            </Text>
            <Text style={styles.optionalToggleCopy}>모두 할 필요 없어요</Text>
          </View>
          {showOptionalCategories
            ? <ChevronUp size={20} color={colors.textTertiary} />
            : <ChevronDown size={20} color={colors.textTertiary} />
          }
        </Pressable>

        {showOptionalCategories
          ? categoryGroups.optional.map((category) => renderCategoryCard(category, true))
          : null}

        {/* 전체 일정 목록 */}
        {events.length > 0 && (
          <View style={styles.allEventsSection}>
            <Text style={styles.allEventsTitle}>전체 일정</Text>
            {events.map((evt) => (
              <Pressable
                key={evt.id}
                style={({ pressed }) => [
                  styles.allEventRow,
                  pressed && { transform: [{ scale: 0.98 }] },
                ]}
                onPress={() => openEditEventModal(evt.id)}
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
                {editingEventId !== null ? "일정 수정" : "일정 추가"}
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
              {editingEventId !== null && (
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
                    {editingEventId !== null ? "수정 완료" : "추가하기"}
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

  checklistSectionHeader: {
    marginTop: 8,
    gap: 3,
  },
  checklistSectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.noir[800],
    fontFamily: "NotoSerifKR_500Medium",
  },
  checklistSectionCopy: {
    fontSize: 13,
    lineHeight: 19,
    color: colors.textSecondary,
  },
  startedEmptyCard: {
    alignItems: "center",
    gap: 6,
    paddingVertical: 20,
  },
  optionalToggle: {
    minHeight: 68,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.ivory[100],
  },
  optionalToggleTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.noir[800],
  },
  optionalToggleCopy: {
    marginTop: 2,
    fontSize: 12,
    color: colors.textTertiary,
  },

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
