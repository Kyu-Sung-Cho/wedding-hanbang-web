// 예산 화면 — FULL CRUD (추가/수정/삭제)
import { useEffect, useState, useCallback, useRef } from "react";
import {
  View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator,
  RefreshControl, Modal, TextInput, Alert, Animated, PanResponder,
  Switch, KeyboardAvoidingView, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import {
  ArrowLeft, TrendingDown, TrendingUp, Wallet, Plus, X, Trash2, Edit3,
} from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";
import { supabase } from "@/lib/supabase";

/* ───── types ───── */
interface BudgetItem {
  id: string;
  couple_id: string;
  category: string;
  item_name: string;
  estimated_cost: number;
  actual_cost: number | null;
  is_paid: boolean;
  notes: string | null;
}

interface BudgetData {
  totalBudget: number;
  items: BudgetItem[];
  totalEstimated: number;
  totalActual: number;
  totalPaid: number;
}

const CATEGORIES = [
  "예식장", "스드메", "스튜디오", "드레스", "메이크업", "예복",
  "한복", "예물", "혼수", "허니문", "청첩장", "부케",
  "답례품", "스냅", "영상", "축가", "사회자", "기타",
];

const DEFAULT_BUDGET_ITEMS = [
  { category: "예식장", item_name: "예식장 대관료", estimated_cost: 0 },
  { category: "예식장", item_name: "식대 (인당)", estimated_cost: 0 },
  { category: "스튜디오", item_name: "스튜디오 촬영", estimated_cost: 150 },
  { category: "드레스", item_name: "드레스 대여", estimated_cost: 100 },
  { category: "메이크업", item_name: "메이크업", estimated_cost: 80 },
  { category: "예복", item_name: "신랑 예복", estimated_cost: 30 },
  { category: "한복", item_name: "한복", estimated_cost: 50 },
  { category: "예물", item_name: "반지", estimated_cost: 200 },
  { category: "혼수", item_name: "혼수 (가전/가구)", estimated_cost: 0 },
  { category: "허니문", item_name: "신혼여행", estimated_cost: 300 },
  { category: "청첩장", item_name: "청첩장", estimated_cost: 20 },
  { category: "부케", item_name: "부케/꽃장식", estimated_cost: 15 },
  { category: "답례품", item_name: "답례품", estimated_cost: 10 },
  { category: "스냅", item_name: "본식 스냅/영상", estimated_cost: 80 },
  { category: "기타", item_name: "기타 비용", estimated_cost: 0 },
];

/* ───── helpers ───── */
function formatWon(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(n % 10000 === 0 ? 0 : 1)}억`;
  return `${n.toLocaleString()}만원`;
}

/* ───── SwipeableItem ───── */
function SwipeableItem({
  children,
  onDelete,
  onEdit,
}: {
  children: React.ReactNode;
  onDelete: () => void;
  onEdit: () => void;
}) {
  const translateX = useRef(new Animated.Value(0)).current;
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 10 && Math.abs(g.dy) < 20,
      onPanResponderMove: (_, g) => {
        if (g.dx < 0) translateX.setValue(Math.max(g.dx, -140));
      },
      onPanResponderRelease: (_, g) => {
        if (g.dx < -60) {
          Animated.spring(translateX, { toValue: -140, useNativeDriver: true, friction: 8 }).start();
        } else {
          Animated.spring(translateX, { toValue: 0, useNativeDriver: true, friction: 8 }).start();
        }
      },
    })
  ).current;

  const resetSwipe = () => {
    Animated.spring(translateX, { toValue: 0, useNativeDriver: true, friction: 8 }).start();
  };

  return (
    <View style={{ overflow: "hidden" }}>
      {/* 뒤쪽 액션 버튼 */}
      <View style={swipeStyles.actions}>
        <Pressable
          style={[swipeStyles.actionBtn, { backgroundColor: colors.rose[500] }]}
          onPress={() => { resetSwipe(); onEdit(); }}
        >
          <Edit3 size={18} color="#fff" />
          <Text style={swipeStyles.actionText}>수정</Text>
        </Pressable>
        <Pressable
          style={[swipeStyles.actionBtn, { backgroundColor: "#EF4444" }]}
          onPress={() => { resetSwipe(); onDelete(); }}
        >
          <Trash2 size={18} color="#fff" />
          <Text style={swipeStyles.actionText}>삭제</Text>
        </Pressable>
      </View>
      <Animated.View
        style={{ transform: [{ translateX }] }}
        {...panResponder.panHandlers}
      >
        {children}
      </Animated.View>
    </View>
  );
}

const swipeStyles = StyleSheet.create({
  actions: {
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 0,
    flexDirection: "row",
    alignItems: "center",
  },
  actionBtn: {
    width: 70,
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  actionText: { color: "#fff", fontSize: 11, fontWeight: "600" },
});

/* ───── main screen ───── */
export default function BudgetScreen() {
  const [data, setData] = useState<BudgetData | null>(null);
  const [coupleId, setCoupleId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const fabScale = useRef(new Animated.Value(1)).current;

  // modal
  const [modalVisible, setModalVisible] = useState(false);
  const [editingItem, setEditingItem] = useState<BudgetItem | null>(null);
  const [formCategory, setFormCategory] = useState(CATEGORIES[0]);
  const [formName, setFormName] = useState("");
  const [formEstimated, setFormEstimated] = useState("");
  const [formActual, setFormActual] = useState("");
  const [formIsPaid, setFormIsPaid] = useState(false);
  const [formNotes, setFormNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // budget edit
  const [editBudget, setEditBudget] = useState(false);
  const [budgetInput, setBudgetInput] = useState("");
  const [settingUp, setSettingUp] = useState(false);

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
        .select("total_budget")
        .eq("couple_id", profile.couple_id)
        .single();

      const { data: budgetRows } = await supabase
        .from("budget_items")
        .select("*")
        .eq("couple_id", profile.couple_id)
        .order("category");

      const items: BudgetItem[] = (budgetRows ?? []).map((r) => ({
        id: r.id,
        couple_id: r.couple_id,
        category: r.category ?? "",
        item_name: r.item_name ?? r.name ?? "",
        estimated_cost: r.estimated_cost ?? r.estimated ?? 0,
        actual_cost: r.actual_cost ?? r.actual ?? null,
        is_paid: r.is_paid ?? false,
        notes: r.notes ?? null,
      }));

      const totalEstimated = items.reduce((s, i) => s + i.estimated_cost, 0);
      const totalActual = items.reduce((s, i) => s + (i.actual_cost ?? 0), 0);
      const totalPaid = items.filter((i) => i.is_paid).reduce((s, i) => s + (i.actual_cost ?? i.estimated_cost), 0);

      setData({
        totalBudget: journey?.total_budget ?? 0,
        items,
        totalEstimated,
        totalActual,
        totalPaid,
      });
    } catch (err) {
      console.error("예산 로드 오류:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  /* ── 총 예산 수정 ── */
  async function saveTotalBudget() {
    if (!coupleId) return;
    const num = parseInt(budgetInput, 10);
    if (isNaN(num) || num < 0) {
      Alert.alert("오류", "올바른 금액을 입력하세요 (만원 단위)");
      return;
    }
    await supabase
      .from("wedding_journeys")
      .update({ total_budget: num })
      .eq("couple_id", coupleId);
    setEditBudget(false);
    loadData();
  }

  /* ── 기본 항목 세팅 ── */
  async function setupDefaultItems() {
    if (!coupleId) return;
    setSettingUp(true);
    try {
      const rows = DEFAULT_BUDGET_ITEMS.map((item) => ({
        couple_id: coupleId,
        category: item.category,
        item_name: item.item_name,
        estimated_cost: item.estimated_cost,
        actual_cost: null,
        is_paid: false,
        notes: null,
      }));
      const { error } = await supabase.from("budget_items").insert(rows);
      if (error) {
        Alert.alert("오류", "기본 항목 세팅에 실패했어요. 다시 시도해주세요.");
        console.error("기본 항목 세팅 오류:", error);
      } else {
        loadData();
      }
    } catch (err) {
      Alert.alert("오류", "기본 항목 세팅에 실패했어요.");
    } finally {
      setSettingUp(false);
    }
  }

  /* ── 항목 추가/수정 모달 열기 ── */
  function openAddModal() {
    setEditingItem(null);
    setFormCategory(CATEGORIES[0]);
    setFormName("");
    setFormEstimated("");
    setFormActual("");
    setFormIsPaid(false);
    setFormNotes("");
    setModalVisible(true);
  }

  function openEditModal(item: BudgetItem) {
    setEditingItem(item);
    setFormCategory(item.category || CATEGORIES[0]);
    setFormName(item.item_name);
    setFormEstimated(String(item.estimated_cost));
    setFormActual(item.actual_cost != null ? String(item.actual_cost) : "");
    setFormIsPaid(item.is_paid);
    setFormNotes(item.notes ?? "");
    setModalVisible(true);
  }

  /* ── 저장 ── */
  async function saveItem() {
    if (!coupleId) return;
    if (!formName.trim()) {
      Alert.alert("오류", "항목 이름을 입력해주세요");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        couple_id: coupleId,
        category: formCategory,
        item_name: formName.trim(),
        estimated_cost: parseInt(formEstimated, 10) || 0,
        actual_cost: formActual ? parseInt(formActual, 10) : null,
        is_paid: formIsPaid,
        notes: formNotes.trim() || null,
      };

      if (editingItem) {
        await supabase
          .from("budget_items")
          .update(payload)
          .eq("id", editingItem.id);
      } else {
        await supabase
          .from("budget_items")
          .insert(payload);
      }

      setModalVisible(false);
      loadData();
    } catch (err) {
      Alert.alert("오류", "저장에 실패했어요. 다시 시도해주세요.");
    } finally {
      setSaving(false);
    }
  }

  /* ── 삭제 ── */
  function confirmDelete(item: BudgetItem) {
    Alert.alert(
      "삭제 확인",
      `'${item.item_name}' 항목을 삭제할까요?`,
      [
        { text: "취소", style: "cancel" },
        {
          text: "삭제",
          style: "destructive",
          onPress: async () => {
            await supabase.from("budget_items").delete().eq("id", item.id);
            loadData();
          },
        },
      ]
    );
  }

  /* ── 카테고리별 그룹핑 ── */
  const grouped = data?.items.reduce<Record<string, BudgetItem[]>>((acc, item) => {
    const key = item.category || "기타";
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {}) ?? {};

  const remaining = (data?.totalBudget ?? 0) - (data?.totalActual ?? 0);

  function handleFabPressIn() {
    Animated.spring(fabScale, { toValue: 0.92, useNativeDriver: true }).start();
  }
  function handleFabPressOut() {
    Animated.spring(fabScale, { toValue: 1, friction: 3, useNativeDriver: true }).start();
  }

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
        <Text style={styles.headerTitle}>예산 관리</Text>
        <Pressable onPress={openAddModal} hitSlop={12}>
          <Plus size={24} color={colors.rose[500]} />
        </Pressable>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); loadData(); }}
            tintColor={colors.rose[500]}
          />
        }
      >
        {/* 요약 카드 — 노아 배경에 서브틀 그래디언트 */}
        <View style={styles.summaryRow}>
          <Pressable
            style={[styles.summaryCard, styles.summaryCardNoir]}
            onPress={() => {
              setBudgetInput(String(data?.totalBudget ?? 0));
              setEditBudget(true);
            }}
          >
            <Wallet size={18} color={colors.rose[500]} />
            <Text style={styles.summaryLabelLight}>총 예산</Text>
            {editBudget ? (
              <View style={styles.budgetEditRow}>
                <TextInput
                  style={styles.budgetEditInput}
                  value={budgetInput}
                  onChangeText={setBudgetInput}
                  keyboardType="number-pad"
                  autoFocus
                  onBlur={saveTotalBudget}
                  onSubmitEditing={saveTotalBudget}
                />
                <Text style={styles.budgetEditUnit}>만원</Text>
              </View>
            ) : (
              <Text style={styles.summaryValueNoir}>
                {data?.totalBudget ? formatWon(data.totalBudget) : "설정"}
              </Text>
            )}
          </Pressable>

          <View style={[styles.summaryCard, styles.summaryCardShadow]}>
            <TrendingDown size={18} color={colors.rose[500]} />
            <Text style={styles.summaryLabel}>지출</Text>
            <Text style={[styles.summaryValue, { color: colors.rose[500] }]}>
              {data?.totalActual ? formatWon(data.totalActual) : "—"}
            </Text>
          </View>

          <View style={[styles.summaryCard, styles.summaryCardShadow]}>
            <TrendingUp size={18} color={remaining >= 0 ? colors.textSecondary : "#EF4444"} />
            <Text style={styles.summaryLabel}>잔여</Text>
            <Text style={[styles.summaryValue, remaining < 0 && { color: "#EF4444" }]}>
              {data?.totalBudget ? formatWon(remaining) : "—"}
            </Text>
          </View>
        </View>

        {/* 카테고리별 목록 */}
        {Object.keys(grouped).length === 0 ? (
          <View style={styles.emptyCard}>
            <View style={styles.emptyIconWrap}>
              <Wallet size={36} color={colors.rose[500]} />
            </View>
            <Text style={styles.emptyText}>등록된 예산 항목이 없어요</Text>
            <Text style={styles.emptyHint}>
              기본 예산 항목을 자동으로 세팅해드릴까요?{"\n"}
              예식장, 스튜디오, 드레스, 메이크업 등{"\n"}
              15개 기본 카테고리가 추가됩니다.
            </Text>
            <Pressable
              style={({ pressed }) => [
                styles.setupBtn,
                pressed && { transform: [{ scale: 0.97 }] },
              ]}
              onPress={setupDefaultItems}
              disabled={settingUp}
            >
              {settingUp ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.setupBtnText}>기본 항목 세팅하기</Text>
              )}
            </Pressable>
            <Text style={styles.emptyOrText}>또는</Text>
            <Pressable onPress={openAddModal}>
              <Text style={styles.emptyAddLink}>직접 항목 추가하기</Text>
            </Pressable>
          </View>
        ) : (
          Object.entries(grouped).map(([category, items]) => {
            const catTotal = items.reduce((s, i) => s + (i.actual_cost ?? i.estimated_cost), 0);
            return (
              <View key={category} style={styles.catSection}>
                <View style={styles.catHeader}>
                  <Text style={styles.catLabel}>{category}</Text>
                  <Text style={styles.catTotal}>{formatWon(catTotal)}</Text>
                </View>
                {items.map((item) => (
                  <SwipeableItem
                    key={item.id}
                    onDelete={() => confirmDelete(item)}
                    onEdit={() => openEditModal(item)}
                  >
                    <Pressable
                      style={({ pressed }) => [
                        styles.itemRow,
                        pressed && { transform: [{ scale: 0.98 }] },
                      ]}
                      onPress={() => openEditModal(item)}
                      onLongPress={() => confirmDelete(item)}
                    >
                      <View style={[styles.paidDot, item.is_paid && styles.paidDotActive]} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.itemName}>{item.item_name}</Text>
                        {item.notes ? <Text style={styles.itemNotes}>{item.notes}</Text> : null}
                      </View>
                      <View style={styles.itemCosts}>
                        <Text style={styles.itemActual}>
                          {item.actual_cost != null ? formatWon(item.actual_cost) : "—"}
                        </Text>
                        {item.estimated_cost > 0 && (
                          <Text style={styles.itemEstimated}>
                            예상 {formatWon(item.estimated_cost)}
                          </Text>
                        )}
                      </View>
                    </Pressable>
                  </SwipeableItem>
                ))}
              </View>
            );
          })
        )}
      </ScrollView>

      {/* FAB */}
      <Animated.View style={[styles.fab, { transform: [{ scale: fabScale }] }]}>
        <Pressable
          style={styles.fabInner}
          onPress={openAddModal}
          onPressIn={handleFabPressIn}
          onPressOut={handleFabPressOut}
        >
          <Plus size={28} color="#fff" />
        </Pressable>
      </Animated.View>

      {/* 추가/수정 모달 */}
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
            {/* 모달 핸들 */}
            <View style={styles.modalHandle} />

            {/* 모달 헤더 */}
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {editingItem ? "항목 수정" : "항목 추가"}
              </Text>
              <Pressable onPress={() => setModalVisible(false)} hitSlop={12}>
                <X size={24} color={colors.textTertiary} />
              </Pressable>
            </View>

            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
              {/* 카테고리 선택 */}
              <Text style={styles.fieldLabel}>카테고리</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
                {CATEGORIES.map((cat) => (
                  <Pressable
                    key={cat}
                    style={[styles.chip, formCategory === cat && styles.chipActive]}
                    onPress={() => setFormCategory(cat)}
                  >
                    <Text style={[styles.chipText, formCategory === cat && styles.chipTextActive]}>
                      {cat}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>

              {/* 항목 이름 */}
              <Text style={styles.fieldLabel}>항목 이름</Text>
              <TextInput
                style={styles.input}
                value={formName}
                onChangeText={setFormName}
                placeholder="예: 예식장 대관료"
                placeholderTextColor={colors.textTertiary}
              />

              {/* 비용 섹션 */}
              <View style={styles.costSection}>
                <Text style={styles.sectionLabel}>비용 정보</Text>
                <View style={styles.costRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabelSmall}>예상 비용 (만원)</Text>
                    <TextInput
                      style={styles.input}
                      value={formEstimated}
                      onChangeText={setFormEstimated}
                      keyboardType="number-pad"
                      placeholder="0"
                      placeholderTextColor={colors.textTertiary}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabelSmall}>실제 비용 (만원)</Text>
                    <TextInput
                      style={styles.input}
                      value={formActual}
                      onChangeText={setFormActual}
                      keyboardType="number-pad"
                      placeholder="미정"
                      placeholderTextColor={colors.textTertiary}
                    />
                  </View>
                </View>
              </View>

              {/* 결제 완료 */}
              <View style={styles.switchRow}>
                <Text style={styles.fieldLabel}>결제 완료</Text>
                <Switch
                  value={formIsPaid}
                  onValueChange={setFormIsPaid}
                  trackColor={{ false: colors.ivory[200], true: colors.rose[500] }}
                  thumbColor="#fff"
                />
              </View>

              {/* 메모 */}
              <Text style={styles.fieldLabel}>메모</Text>
              <TextInput
                style={[styles.input, { height: 60, textAlignVertical: "top" }]}
                value={formNotes}
                onChangeText={setFormNotes}
                placeholder="선택사항"
                placeholderTextColor={colors.textTertiary}
                multiline
              />
            </ScrollView>

            {/* 저장 버튼 */}
            <Pressable
              style={({ pressed }) => [
                styles.saveBtn,
                pressed && { transform: [{ scale: 0.98 }] },
              ]}
              onPress={saveItem}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.saveBtnText}>
                  {editingItem ? "수정 완료" : "추가하기"}
                </Text>
              )}
            </Pressable>
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
  scrollContent: { padding: 20, paddingBottom: 100 },

  summaryRow: { flexDirection: "row", gap: 10, marginBottom: 24 },
  summaryCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 20,
    padding: 14,
    alignItems: "center",
    gap: 6,
  },
  summaryCardNoir: {
    backgroundColor: colors.noir[800],
    borderColor: colors.noir[800],
  },
  summaryCardShadow: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 2,
  },
  summaryLabel: { fontSize: 11, color: colors.textTertiary },
  summaryLabelLight: { fontSize: 11, color: colors.taupe[400] },
  summaryValue: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.noir[800],
    fontFamily: "CormorantGaramond_600SemiBold",
  },
  summaryValueNoir: {
    fontSize: 16,
    fontWeight: "700",
    color: "#FFFFFF",
    fontFamily: "CormorantGaramond_600SemiBold",
  },

  budgetEditRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  budgetEditInput: {
    fontSize: 14,
    fontWeight: "700",
    color: "#FFFFFF",
    borderBottomWidth: 1,
    borderBottomColor: colors.rose[500],
    paddingVertical: 2,
    minWidth: 50,
    textAlign: "center",
  },
  budgetEditUnit: { fontSize: 11, color: colors.taupe[400] },

  emptyCard: {
    alignItems: "center",
    paddingTop: 32,
    paddingBottom: 32,
    paddingHorizontal: 24,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 24,
    gap: 8,
  },
  emptyIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.rose.glow,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  emptyText: { fontSize: 17, fontWeight: "600", color: colors.noir[800], marginTop: 4 },
  emptyHint: { fontSize: 13, color: colors.textTertiary, textAlign: "center", lineHeight: 20 },
  setupBtn: {
    backgroundColor: colors.rose[500],
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 32,
    marginTop: 8,
  },
  setupBtnText: { fontSize: 15, fontWeight: "600", color: "#fff" },
  emptyOrText: { fontSize: 12, color: colors.textTertiary, marginTop: 4 },
  emptyAddLink: { fontSize: 14, fontWeight: "600", color: colors.rose[500] },

  catSection: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 20,
    padding: 16,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 2,
  },
  catHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  catLabel: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.noir[800],
    fontFamily: "NotoSerifKR_500Medium",
  },
  catTotal: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.rose[500],
    fontFamily: "CormorantGaramond_600SemiBold",
  },

  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  paidDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.ivory[200],
  },
  paidDotActive: { backgroundColor: colors.rose[500] },
  itemName: { fontSize: 14, fontWeight: "500", color: colors.noir[800] },
  itemNotes: { fontSize: 11, color: colors.textTertiary, marginTop: 2 },
  itemCosts: { alignItems: "flex-end" },
  itemActual: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.noir[800],
    fontFamily: "CormorantGaramond_600SemiBold",
  },
  itemEstimated: {
    fontSize: 11,
    color: colors.textTertiary,
    marginTop: 2,
    fontFamily: "CormorantGaramond_400Regular",
  },

  // FAB
  fab: {
    position: "absolute",
    bottom: 32,
    right: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 8,
  },
  fabInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.rose[500],
    alignItems: "center",
    justifyContent: "center",
  },

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
  fieldLabelSmall: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textSecondary,
    marginBottom: 6,
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.noir[800],
    marginBottom: 12,
    marginTop: 20,
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
  costSection: { marginTop: 4 },
  costRow: { flexDirection: "row", gap: 12 },
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

  switchRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 16,
  },

  saveBtn: {
    backgroundColor: colors.rose[500],
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 20,
  },
  saveBtnText: { fontSize: 16, fontWeight: "600", color: "#fff" },
});
