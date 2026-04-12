// 예산 관리 — 웹과 동일한 wedding_journeys.progress 기반
// budget/spent/cost 필드를 progress 객체에서 읽고 씀 (별도 테이블 없음)
import { useEffect, useState, useCallback, useRef } from "react";
import {
  View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator,
  RefreshControl, Modal, TextInput, Alert, KeyboardAvoidingView, Platform,
  Animated,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { ArrowLeft, TrendingDown, TrendingUp, Wallet, Edit3, Check, X } from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";
import { supabase } from "@/lib/supabase";

// 웹과 동일한 카테고리 비율 상수
const CATEGORY_RATIOS = [
  { key: "meeting", label: "상견례", ratio: 0.01 },
  { key: "venue", label: "예식장", ratio: 0.20 },
  { key: "studio", label: "스튜디오", ratio: 0.10 },
  { key: "dress", label: "드레스/턱시도", ratio: 0.07 },
  { key: "makeup", label: "메이크업", ratio: 0.05 },
  { key: "snap", label: "본식 스냅/영상", ratio: 0.04 },
  { key: "ring", label: "예물", ratio: 0.12 },
  { key: "yedan", label: "예단", ratio: 0.05 },
  { key: "hanbok", label: "한복", ratio: 0.03 },
  { key: "shoes", label: "웨딩 구두", ratio: 0.01 },
  { key: "bouquet", label: "부케/꽃장식", ratio: 0.01 },
  { key: "honeymoon", label: "신혼여행", ratio: 0.12 },
  { key: "houseware", label: "혼수", ratio: 0.07 },
  { key: "housing", label: "신혼집", ratio: 0.00 },
  { key: "invitation", label: "청첩장", ratio: 0.02 },
  { key: "gift", label: "답례품", ratio: 0.02 },
  { key: "mc", label: "사회/축가", ratio: 0.01 },
  { key: "ham", label: "함", ratio: 0.01 },
  { key: "pyebaek", label: "폐백", ratio: 0.01 },
  { key: "reserve", label: "예비비", ratio: 0.05 },
];

interface ProgressItem {
  status?: string;
  budget?: number;
  spent?: number;
  cost?: number;
  [key: string]: unknown;
}

function formatWon(n: number): string {
  if (n >= 100000000) return `${(n / 100000000).toFixed(1)}억`;
  if (n >= 10000) return `${Math.round(n / 10000).toLocaleString()}만원`;
  if (n > 0) return `${n.toLocaleString()}원`;
  return "—";
}

function normalizeCost(cost: unknown): number {
  if (typeof cost === "number") return cost;
  if (typeof cost === "string") return parseInt(cost, 10) || 0;
  return 0;
}

export default function BudgetScreen() {
  const [totalBudget, setTotalBudget] = useState(0);
  const [progress, setProgress] = useState<Record<string, ProgressItem>>({});
  const [coupleId, setCoupleId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [editingTotal, setEditingTotal] = useState(false);
  const [totalInput, setTotalInput] = useState("");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [spentInput, setSpentInput] = useState("");
  const [budgetInput, setBudgetInput] = useState("");
  const [saving, setSaving] = useState(false);
  const progressAnim = useRef(new Animated.Value(0)).current;

  const loadData = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase.from("profiles").select("couple_id").eq("id", user.id).single();
      if (!profile?.couple_id) return;
      setCoupleId(profile.couple_id);
      const { data: journey } = await supabase.from("wedding_journeys").select("total_budget, progress").eq("couple_id", profile.couple_id).single();
      setTotalBudget(journey?.total_budget ?? 0);
      setProgress((journey?.progress as Record<string, ProgressItem>) ?? {});
    } catch (err) { console.error("Budget load:", err); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  function getCatBudget(key: string): number {
    const item = progress[key];
    if (item?.budget && item.budget > 0) return item.budget;
    const cost = normalizeCost(item?.cost);
    if (cost > 0) return cost;
    const r = CATEGORY_RATIOS.find((c) => c.key === key);
    return r ? Math.round(totalBudget * r.ratio) : 0;
  }
  function getCatSpent(key: string): number {
    const item = progress[key];
    if (item?.spent !== undefined) return item.spent;
    return normalizeCost(item?.cost);
  }
  function getCatStatus(key: string): string {
    const s = progress[key]?.status ?? "not_started";
    return s === "completed" ? "완료" : s === "in_progress" ? "진행중" : "예정";
  }

  const totalSpent = CATEGORY_RATIOS.reduce((s, c) => s + getCatSpent(c.key), 0);
  const remaining = totalBudget - totalSpent;
  const spentPct = totalBudget > 0 ? Math.min(100, Math.round((totalSpent / totalBudget) * 100)) : 0;

  useEffect(() => {
    Animated.timing(progressAnim, { toValue: spentPct, duration: 800, useNativeDriver: false }).start();
  }, [spentPct, progressAnim]);

  async function saveTotalBudget() {
    if (!coupleId) return;
    const num = parseInt(totalInput, 10);
    if (isNaN(num) || num < 0) { Alert.alert("알림", "올바른 금액을 입력해주세요 (만원)"); return; }
    await supabase.from("wedding_journeys").update({ total_budget: num * 10000 }).eq("couple_id", coupleId);
    setEditingTotal(false);
    loadData();
  }

  async function saveCategoryEdit() {
    if (!coupleId || !editingKey) return;
    setSaving(true);
    try {
      const { data: journey } = await supabase.from("wedding_journeys").select("progress").eq("couple_id", coupleId).single();
      const cur = { ...(journey?.progress as Record<string, ProgressItem>) ?? {} };
      const ex = cur[editingKey] ?? {};
      const sv = spentInput ? parseInt(spentInput, 10) * 10000 : undefined;
      const bv = budgetInput ? parseInt(budgetInput, 10) * 10000 : undefined;
      cur[editingKey] = { ...ex, category: editingKey, ...(sv !== undefined ? { spent: sv } : {}), ...(bv !== undefined ? { budget: bv } : {}) };
      await supabase.from("wedding_journeys").update({ progress: cur }).eq("couple_id", coupleId);
      setEditingKey(null);
      loadData();
    } catch { Alert.alert("오류", "저장에 실패했어요"); }
    finally { setSaving(false); }
  }

  function openEdit(key: string) {
    setBudgetInput(getCatBudget(key) > 0 ? String(Math.round(getCatBudget(key) / 10000)) : "");
    setSpentInput(getCatSpent(key) > 0 ? String(Math.round(getCatSpent(key) / 10000)) : "");
    setEditingKey(key);
  }

  if (loading) return <SafeAreaView style={s.container}><ActivityIndicator color={colors.rose[500]} style={{ marginTop: 40 }} /></SafeAreaView>;

  return (
    <SafeAreaView style={s.container} edges={["top"]}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}><ArrowLeft size={24} color={colors.noir[800]} /></Pressable>
        <Text style={s.headerTitle}>예산 관리</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadData(); }} tintColor={colors.rose[500]} />}>

        {/* 총 예산 */}
        <View style={s.totalCard}>
          <Text style={s.totalLabel}>총 예산</Text>
          {editingTotal ? (
            <View style={s.editRow}>
              <TextInput style={s.totalEditInput} value={totalInput} onChangeText={setTotalInput} keyboardType="number-pad" autoFocus placeholder="0" placeholderTextColor={colors.taupe[400]} />
              <Text style={s.totalUnit}>만원</Text>
              <Pressable onPress={saveTotalBudget}><Check size={22} color={colors.rose[500]} /></Pressable>
              <Pressable onPress={() => setEditingTotal(false)}><X size={22} color={colors.taupe[400]} /></Pressable>
            </View>
          ) : (
            <Pressable style={s.totalRow} onPress={() => { setTotalInput(totalBudget > 0 ? String(Math.round(totalBudget / 10000)) : ""); setEditingTotal(true); }}>
              <Text style={s.totalValue}>{totalBudget > 0 ? formatWon(totalBudget) : "설정해주세요"}</Text>
              <Edit3 size={16} color={colors.taupe[400]} />
            </Pressable>
          )}
          {totalBudget > 0 && (
            <View style={s.progSection}>
              <View style={s.progBar}>
                <Animated.View style={[s.progFill, { width: progressAnim.interpolate({ inputRange: [0, 100], outputRange: ["0%", "100%"] }), backgroundColor: remaining >= 0 ? colors.rose[500] : "#EF4444" }]} />
              </View>
              <View style={s.progLabels}>
                <Text style={s.progLabel}>지출 {formatWon(totalSpent)}</Text>
                <Text style={[s.progLabel, remaining < 0 && { color: "#EF4444" }]}>잔여 {formatWon(Math.abs(remaining))}{remaining < 0 ? " 초과" : ""}</Text>
              </View>
            </View>
          )}
        </View>

        {/* 요약 */}
        <View style={s.sumRow}>
          <View style={s.sumCard}><Wallet size={16} color={colors.textTertiary} /><Text style={s.sumLabel}>배정</Text><Text style={s.sumVal}>{formatWon(CATEGORY_RATIOS.reduce((a, c) => a + getCatBudget(c.key), 0))}</Text></View>
          <View style={s.sumCard}><TrendingDown size={16} color={colors.rose[500]} /><Text style={s.sumLabel}>지출</Text><Text style={[s.sumVal, { color: colors.rose[500] }]}>{formatWon(totalSpent)}</Text></View>
          <View style={s.sumCard}><TrendingUp size={16} color={remaining >= 0 ? colors.textSecondary : "#EF4444"} /><Text style={s.sumLabel}>잔여</Text><Text style={[s.sumVal, remaining < 0 && { color: "#EF4444" }]}>{formatWon(Math.abs(remaining))}</Text></View>
        </View>

        {/* 카테고리 목록 */}
        {CATEGORY_RATIOS.map((cat) => {
          const b = getCatBudget(cat.key), sp = getCatSpent(cat.key), st = getCatStatus(cat.key);
          const pct = b > 0 ? Math.min(100, Math.round((sp / b) * 100)) : 0;
          return (
            <Pressable key={cat.key} style={({ pressed }) => [s.catCard, pressed && { transform: [{ scale: 0.98 }] }]} onPress={() => openEdit(cat.key)}>
              <View style={s.catHead}>
                <Text style={s.catLabel}>{cat.label}</Text>
                <View style={[s.badge, st === "완료" && s.badgeDone, st === "진행중" && s.badgeProg]}>
                  <Text style={[s.badgeText, st === "완료" && s.badgeTextDone, st === "진행중" && s.badgeTextProg]}>{st}</Text>
                </View>
              </View>
              <View style={s.catBar}><View style={[s.catFill, { width: `${pct}%`, backgroundColor: sp > b && b > 0 ? "#EF4444" : colors.rose[500] }]} /></View>
              <View style={s.catFoot}>
                <Text style={s.catSpent}>지출 {formatWon(sp)}</Text>
                <Text style={s.catBudget}>/ {formatWon(b)}</Text>
                <Text style={s.catPct}>{pct}%</Text>
              </View>
            </Pressable>
          );
        })}
        <Text style={s.hint}>카테고리를 탭하면 예산/지출을 수정할 수 있어요</Text>
      </ScrollView>

      {/* 편집 모달 */}
      <Modal visible={!!editingKey} animationType="slide" transparent onRequestClose={() => setEditingKey(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={s.modalOv}>
          <View style={s.modalCon}>
            <View style={s.modalHandle} />
            <View style={s.modalHead}><Text style={s.modalTitle}>{CATEGORY_RATIOS.find((c) => c.key === editingKey)?.label ?? ""} 수정</Text><Pressable onPress={() => setEditingKey(null)}><X size={24} color={colors.textTertiary} /></Pressable></View>
            <Text style={s.fLabel}>예산 (만원)</Text>
            <TextInput style={s.fInput} value={budgetInput} onChangeText={setBudgetInput} keyboardType="number-pad" placeholder="0" placeholderTextColor={colors.taupe[400]} />
            <Text style={s.fLabel}>지출 (만원)</Text>
            <TextInput style={s.fInput} value={spentInput} onChangeText={setSpentInput} keyboardType="number-pad" placeholder="0" placeholderTextColor={colors.taupe[400]} />
            <Pressable style={s.saveBtn} onPress={saveCategoryEdit} disabled={saving}>{saving ? <ActivityIndicator color="#FFF" /> : <Text style={s.saveTxt}>저장</Text>}</Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  headerTitle: { fontSize: 18, fontFamily: "NotoSerifKR_500Medium", color: colors.noir[800] },
  content: { padding: 20, paddingBottom: 40 },
  totalCard: { backgroundColor: colors.noir[800], borderRadius: 24, padding: 24, marginBottom: 16, shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.12, shadowRadius: 16, elevation: 4 },
  totalLabel: { fontSize: 13, fontFamily: "NotoSansKR_400Regular", color: colors.taupe[400], marginBottom: 8 },
  totalRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  totalValue: { fontSize: 32, fontFamily: "CormorantGaramond_600SemiBold", color: "#FFFFFF" },
  editRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  totalEditInput: { flex: 1, fontSize: 24, fontFamily: "CormorantGaramond_600SemiBold", color: "#FFFFFF", borderBottomWidth: 1, borderBottomColor: colors.rose[500], paddingVertical: 4 },
  totalUnit: { fontSize: 14, color: colors.taupe[400] },
  progSection: { marginTop: 16 },
  progBar: { height: 6, backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 3, overflow: "hidden" },
  progFill: { height: "100%", borderRadius: 3 },
  progLabels: { flexDirection: "row", justifyContent: "space-between", marginTop: 8 },
  progLabel: { fontSize: 12, color: colors.taupe[400] },
  sumRow: { flexDirection: "row", gap: 10, marginBottom: 20 },
  sumCard: { flex: 1, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 16, padding: 14, alignItems: "center", gap: 6 },
  sumLabel: { fontSize: 11, color: colors.textTertiary },
  sumVal: { fontSize: 15, fontFamily: "CormorantGaramond_600SemiBold", color: colors.noir[800] },
  catCard: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 10 },
  catHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  catLabel: { fontSize: 15, fontFamily: "NotoSansKR_600SemiBold", color: colors.noir[800] },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, backgroundColor: colors.ivory[200] },
  badgeDone: { backgroundColor: "rgba(196,150,126,0.15)" },
  badgeProg: { backgroundColor: "rgba(201,169,110,0.15)" },
  badgeText: { fontSize: 11, color: colors.textTertiary },
  badgeTextDone: { color: colors.rose[500] },
  badgeTextProg: { color: colors.gold.DEFAULT },
  catBar: { height: 4, backgroundColor: colors.ivory[200], borderRadius: 2, overflow: "hidden", marginBottom: 8 },
  catFill: { height: "100%", borderRadius: 2 },
  catFoot: { flexDirection: "row", alignItems: "center", gap: 4 },
  catSpent: { fontSize: 13, fontFamily: "NotoSansKR_500Medium", color: colors.noir[800] },
  catBudget: { fontSize: 12, color: colors.textTertiary, flex: 1 },
  catPct: { fontSize: 13, fontFamily: "CormorantGaramond_600SemiBold", color: colors.rose[500] },
  hint: { fontSize: 12, color: colors.textTertiary, textAlign: "center", marginTop: 12 },
  modalOv: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  modalCon: { backgroundColor: colors.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 24, paddingTop: 12, paddingBottom: 36 },
  modalHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: "center", marginBottom: 16 },
  modalHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
  modalTitle: { fontSize: 18, fontFamily: "NotoSerifKR_500Medium", color: colors.noir[800] },
  fLabel: { fontSize: 13, fontFamily: "NotoSansKR_600SemiBold", color: colors.textSecondary, marginBottom: 8, marginTop: 16 },
  fInput: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, fontFamily: "CormorantGaramond_400Regular", color: colors.noir[800] },
  saveBtn: { backgroundColor: colors.noir[800], borderRadius: 16, paddingVertical: 16, alignItems: "center", marginTop: 24 },
  saveTxt: { fontSize: 16, fontFamily: "NotoSansKR_600SemiBold", color: "#FFF" },
});
