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
  ArrowLeft, ChevronDown, ChevronUp, CheckCircle2, Circle,
  Plus, X, CalendarDays, Clock, Trash2, ListChecks,
} from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";
import { supabase } from "@/lib/supabase";

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
  date: string;
  title: string;
  time?: string;
  categoryKey?: string;
  memo?: string;
}

const CATEGORY_OPTIONS = [
  "예식장", "스드메", "스튜디오", "드레스", "메이크업", "예복",
  "한복", "예물", "혼수", "허니문", "청첩장", "부케",
  "답례품", "스냅", "영상", "축가", "사회자", "기타",
];

/* ───── helpers ───── */
function getUpcomingDays(n: number): string[] {
  const days: string[] = [];
  const today = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function getDayLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  return days[d.getDay()] ?? "";
}

/* ───── main screen ───── */
export default function ScheduleScreen() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [progress, setProgress] = useState<Record<string, Record<string, boolean>>>({});
  const [events, setEvents] = useState<ScheduleEvent[]>([]);
  const [coupleId, setCoupleId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  // 진행률 애니메이션
  const progressAnim = useRef(new Animated.Value(0)).current;

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
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profile } = await supabase
        .from("profiles")
        .select("couple_id")
        .eq("id", user.id)
        .single();

      if (!profile?.couple_id) return;
      setCoupleId(profile.couple_id);

      const { data: journey } = await supabase
        .from("wedding_journeys")
        .select("progress")
        .eq("couple_id", profile.couple_id)
        .single();

      const prog = (journey?.progress as Record<string, unknown>) ?? {};

      // 카테고리별 체크리스트 추출
      const cats: Category[] = [];
      const progMap: Record<string, Record<string, boolean>> = {};

      for (const [key, val] of Object.entries(prog)) {
        if (key.startsWith("__")) continue;
        if (typeof val === "object" && val !== null) {
          const items = val as Record<string, boolean>;
          const checkItems: ChecklistItem[] = Object.entries(items).map(([id, done]) => ({
            id,
            label: id.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()),
            done: !!done,
          }));

          cats.push({ key, label: key.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()), items: checkItems });
          progMap[key] = items;
        }
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
      const evts = (prog.__events as ScheduleEvent[]) ?? [];
      setEvents(evts);
    } catch (err) {
      console.error("일정 로드 오류:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [progressAnim]);

  useEffect(() => { loadData(); }, [loadData]);

  /* ── 체크 토글 ── */
  async function toggleItem(categoryKey: string, itemId: string, currentDone: boolean) {
    if (!coupleId) return;

    // 레이아웃 애니메이션
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);

    setProgress((prev) => ({
      ...prev,
      [categoryKey]: { ...prev[categoryKey], [itemId]: !currentDone },
    }));

    const { data: journey } = await supabase
      .from("wedding_journeys")
      .select("progress")
      .eq("couple_id", coupleId)
      .single();

    if (journey) {
      const updatedProgress = { ...(journey.progress as Record<string, unknown>) };
      const cat = updatedProgress[categoryKey] as Record<string, boolean>;
      if (cat) {
        cat[itemId] = !currentDone;
        await supabase
          .from("wedding_journeys")
          .update({ progress: updatedProgress })
          .eq("couple_id", coupleId);
      }
    }

    // 진행률 재계산
    loadData();
  }

  function getCategoryStats(key: string) {
    const items = progress[key] ?? {};
    const total = Object.keys(items).length;
    const done = Object.values(items).filter(Boolean).length;
    return { total, done, percent: total > 0 ? Math.round((done / total) * 100) : 0 };
  }

  /* ── 이벤트 모달 ── */
  function openAddEventModal() {
    setEditingIdx(null);
    const today = new Date().toISOString().slice(0, 10);
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

      const newEvent: ScheduleEvent = {
        date: formDate,
        title: formTitle.trim(),
        ...(formTime ? { time: formTime.trim() } : {}),
        ...(formCategoryKey ? { categoryKey: formCategoryKey } : {}),
        ...(formMemo.trim() ? { memo: formMemo.trim() } : {}),
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
      await supabase
        .from("wedding_journeys")
        .update({ progress: updatedProgress })
        .eq("couple_id", coupleId);

      setModalVisible(false);
      loadData();
    } catch (err) {
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

          await supabase
            .from("wedding_journeys")
            .update({ progress: updatedProgress })
            .eq("couple_id", coupleId);

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

  // 진행바 width 보간
  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 100],
    outputRange: ["0%", "100%"],
  });

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={colors.rose[500]} style={{ marginTop: 40 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      {/* 헤더 */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <ArrowLeft size={24} color={colors.noir[800]} />
        </Pressable>
        <Text style={styles.headerTitle}>체크리스트</Text>
        <Pressable onPress={openAddEventModal} hitSlop={12}>
          <Plus size={24} color={colors.rose[500]} />
        </Pressable>
      </View>

      {/* 전체 진행률 — 프리미엄 카드 */}
      <View style={styles.summaryCard}>
        <View style={styles.summaryTop}>
          <Text style={styles.summaryLabel}>전체 진행률</Text>
          <Text style={styles.summaryPercent}>{overallPercent}%</Text>
        </View>
        <View style={styles.summaryBar}>
          <Animated.View style={[styles.summaryBarFill, { width: progressWidth }]} />
        </View>
        <Text style={styles.summaryHint}>
          {overallPercent >= 100 ? "모든 준비가 완료되었어요!" :
           overallPercent >= 50 ? "절반 이상 완료! 잘 하고 있어요" :
           "차근차근 준비해봐요"}
        </Text>
      </View>

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

        {/* 카테고리 체크리스트 */}
        {categories.length === 0 && events.length === 0 ? (
          <View style={styles.empty}>
            <View style={styles.emptyIconWrap}>
              <ListChecks size={40} color={colors.rose[500]} />
            </View>
            <Text style={styles.emptyText}>체크리스트가 아직 없어요</Text>
            <Text style={styles.emptyHint}>웹에서 온보딩을 완료하면 자동 생성됩니다</Text>
          </View>
        ) : (
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
                    {(progress[cat.key] ? Object.entries(progress[cat.key]) : []).map(([id, done]) => (
                      <Pressable
                        key={id}
                        style={({ pressed }) => [
                          styles.itemRow,
                          pressed && { transform: [{ scale: 0.98 }] },
                        ]}
                        onPress={() => toggleItem(cat.key, id, done)}
                      >
                        {done
                          ? <CheckCircle2 size={22} color={colors.rose[500]} />
                          : <Circle size={22} color={colors.taupe[400]} />
                        }
                        <Text style={[styles.itemLabel, done && styles.itemDone]}>
                          {id.replace(/_\d+$/, "").replace(/_/g, " ")}
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

  summaryCard: {
    margin: 20,
    marginBottom: 8,
    padding: 24,
    backgroundColor: colors.noir[800],
    borderRadius: 24,
  },
  summaryTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  summaryLabel: { fontSize: 14, color: colors.taupe[400] },
  summaryPercent: { fontSize: 36, fontFamily: "CormorantGaramond_600SemiBold", color: "#FFFFFF" },
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
  summaryHint: { fontSize: 12, color: colors.taupe[400] },

  list: { padding: 20, gap: 12, paddingBottom: 40 },

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
  catHeader: { flexDirection: "row", alignItems: "center" },
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
  itemRow: { flexDirection: "row", alignItems: "center", gap: 12 },
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
