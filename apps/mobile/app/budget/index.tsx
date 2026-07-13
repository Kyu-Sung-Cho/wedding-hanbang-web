// 예산 관리 — 웹과 동일한 wedding_journeys.progress 기반
// budget/spent/cost 필드를 progress 객체에서 읽고 씀 (별도 테이블 없음)
import { useEffect, useState, useCallback, useRef } from "react";
import {
  View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator,
  RefreshControl, Modal, TextInput, Alert, KeyboardAvoidingView, Platform,
  Animated,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";
import { TrendingDown, TrendingUp, Wallet, Edit3, Check, X, AlertTriangle } from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";
import { storedMoneyToWon } from "@hanbang/shared";
import { supabase } from "@/lib/supabase";
import { apiFetch } from "@/lib/api";
import ErrorRetry from "@/components/ErrorRetry";
import { AppHeader, LoadingState, StatusPill, Surface } from "@/components/ui/AppUI";

// 분담 타입 (웹과 동일)
type PayerType = "couple" | "bride_parents" | "groom_parents" | "both_parents";

const PAYER_OPTIONS: { value: PayerType; label: string; emoji: string }[] = [
  { value: "couple", label: "커플", emoji: "\uD83D\uDC6B" },
  { value: "bride_parents", label: "신부측", emoji: "\uD83D\uDC70" },
  { value: "groom_parents", label: "신랑측", emoji: "\uD83E\uDD35" },
  { value: "both_parents", label: "양가", emoji: "\uD83E\uDD1D" },
];

// 숨겨진 추가 비용 경고 데이터 (웹과 동일)
const HIDDEN_COSTS: Record<string, { warning: string; extra: string }> = {
  studio: { warning: "원본 USB, 앨범 추가, 보정본 추가", extra: "견적서에서 금액 확인" },
  dress: { warning: "속옷, 글러브, 베일, 슈즈 별도", extra: "견적서에서 금액 확인" },
  makeup: { warning: "리허설, 어머니 메이크업, 피부관리", extra: "견적서에서 금액 확인" },
  venue: { warning: "사회자, 축가, 영상, 꽃장식, 폐백실", extra: "견적서에서 금액 확인" },
  honeymoon: { warning: "여행자보험, 쇼핑, 액티비티", extra: "예약 조건에서 금액 확인" },
  hanbok: { warning: "맞춤 수선, 소품, 세탁", extra: "견적서에서 금액 확인" },
  gift: { warning: "포장, 배송비, 추가 세트", extra: "견적서에서 금액 확인" },
  snap: { warning: "DVD 편집, 스냅 원본, 액자", extra: "견적서에서 금액 확인" },
  ham: { warning: "함진아비 비용, 이바지 포장", extra: "견적서에서 금액 확인" },
  bouquet: { warning: "부케 보존, 부토니에, 양가 꽃", extra: "견적서에서 금액 확인" },
};

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
  payer?: PayerType;
  [key: string]: unknown;
}

type RiskTone = "neutral" | "rose" | "warning" | "danger";

interface BudgetRisk {
  id: string;
  title: string;
  detail: string;
  tone: RiskTone;
  categoryKey?: string;
}

function formatWon(n: number): string {
  if (n >= 100000000) return `${(n / 100000000).toFixed(1)}억`;
  if (n >= 10000) return `${Math.round(n / 10000).toLocaleString()}만원`;
  if (n > 0) return `${n.toLocaleString()}원`;
  return "—";
}

export default function BudgetScreen() {
  const [totalBudget, setTotalBudget] = useState(0);
  const [progress, setProgress] = useState<Record<string, ProgressItem>>({});
  const [coupleId, setCoupleId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [hasLoadedData, setHasLoadedData] = useState(false);
  const [editingTotal, setEditingTotal] = useState(false);
  const [totalInput, setTotalInput] = useState("");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [spentInput, setSpentInput] = useState("");
  const [budgetInput, setBudgetInput] = useState("");
  const [payerInput, setPayerInput] = useState<PayerType>("couple");
  const [saving, setSaving] = useState(false);
  const progressAnim = useRef(new Animated.Value(0)).current;
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

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
        .select("total_budget, progress")
        .eq("couple_id", profile.couple_id)
        .single();
      if (journeyError || !journey) {
        throw journeyError ?? new Error("wedding journey not found");
      }
      setTotalBudget(journey?.total_budget ?? 0);
      setProgress((journey?.progress as Record<string, ProgressItem>) ?? {});
      setHasLoadedData(true);
    } catch (err) {
      console.error("Budget load:", err);
      setLoadError(true);
    }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  useEffect(() => {
    if (!coupleId) return;

    const channel = supabase.channel(`budget:${coupleId}`)
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "wedding_journeys",
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

  function getCatBudget(key: string): number {
    const item = progress[key];
    if (item?.budget && item.budget > 0) return item.budget;
    const cost = storedMoneyToWon(item?.cost);
    if (cost > 0) return cost;
    const r = CATEGORY_RATIOS.find((c) => c.key === key);
    return r ? Math.round(totalBudget * r.ratio) : 0;
  }
  function getCatSpent(key: string): number {
    const item = progress[key];
    if (item?.spent !== undefined) return item.spent;
    return storedMoneyToWon(item?.cost);
  }
  function getCatStatus(key: string): string {
    const s = progress[key]?.status ?? "not_started";
    return s === "completed" ? "완료" : s === "in_progress" ? "진행중" : "예정";
  }
  function getCatPayer(key: string): PayerType {
    return progress[key]?.payer ?? "couple";
  }

  // 분담별 지출 합계
  const payerSummary = CATEGORY_RATIOS.reduce(
    (acc, c) => {
      const payer = getCatPayer(c.key);
      const spent = getCatSpent(c.key);
      acc[payer] = (acc[payer] ?? 0) + spent;
      return acc;
    },
    {} as Record<PayerType, number>,
  );

  const totalSpent = CATEGORY_RATIOS.reduce((s, c) => s + getCatSpent(c.key), 0);
  const remaining = totalBudget - totalSpent;
  const spentPct = totalBudget > 0 ? Math.min(100, Math.round((totalSpent / totalBudget) * 100)) : 0;
  const allocatedBudget = CATEGORY_RATIOS.reduce((a, c) => a + getCatBudget(c.key), 0);
  const payerBreakdown = PAYER_OPTIONS.map((opt) => {
    const amount = payerSummary[opt.value] ?? 0;
    const pct = totalSpent > 0 ? Math.round((amount / totalSpent) * 100) : 0;
    return { ...opt, amount, pct };
  }).sort((a, b) => b.amount - a.amount);
  const leadPayer = payerBreakdown[0];

  const categoryOverruns = CATEGORY_RATIOS
    .map((cat) => {
      const budget = getCatBudget(cat.key);
      const spent = getCatSpent(cat.key);
      return {
        ...cat,
        budget,
        spent,
        overrun: budget > 0 ? spent - budget : 0,
      };
    })
    .filter((cat) => cat.overrun > 0)
    .sort((a, b) => b.overrun - a.overrun);

  const hiddenCostWatch = CATEGORY_RATIOS
    .filter((cat) => HIDDEN_COSTS[cat.key] && getCatStatus(cat.key) !== "완료")
    .map((cat) => {
      const budget = getCatBudget(cat.key);
      const spent = getCatSpent(cat.key);
      const useRate = budget > 0 ? spent / budget : 0;
      return { ...cat, budget, spent, useRate };
    })
    .filter((cat) => cat.spent > 0 || cat.useRate >= 0.7)
    .sort((a, b) => b.useRate - a.useRate);

  const budgetRisks: BudgetRisk[] = [
    ...(totalBudget <= 0
      ? [{
          id: "missing-total",
          title: "총 예산을 먼저 정해야 해요",
          detail: "카테고리별 기준 예산과 초과 위험을 계산하려면 총 예산이 필요해요.",
          tone: "warning" as const,
        }]
      : []),
    ...(remaining < 0
      ? [{
          id: "total-overrun",
          title: `총 예산 ${formatWon(Math.abs(remaining))} 초과`,
          detail: "지출 확정 전 카테고리별 초과 항목을 먼저 조정하세요.",
          tone: "danger" as const,
        }]
      : []),
    ...categoryOverruns.map((cat) => ({
      id: `overrun-${cat.key}`,
      title: `${cat.label} 예산 초과`,
      detail: `${formatWon(cat.overrun)} 초과 · 배정 ${formatWon(cat.budget)} / 지출 ${formatWon(cat.spent)}`,
      tone: "danger" as const,
      categoryKey: cat.key,
    })),
    ...(leadPayer && leadPayer.amount > 0 && leadPayer.pct >= 70
      ? [{
          id: "payer-imbalance",
          title: `${leadPayer.label} 분담 비중이 커요`,
          detail: `${formatWon(leadPayer.amount)} · 전체 지출의 ${leadPayer.pct}%예요.`,
          tone: "warning" as const,
        }]
      : []),
    ...hiddenCostWatch.map((cat) => {
      const hidden = HIDDEN_COSTS[cat.key]!;
      return {
        id: `hidden-${cat.key}`,
        title: `${cat.label} 숨은 비용 체크`,
        detail: `${hidden.warning} · 예상 ${hidden.extra}`,
        tone: "warning" as const,
        categoryKey: cat.key,
      };
    }),
  ].slice(0, 3);

  const budgetStatus =
    totalBudget <= 0
      ? { label: "설정 필요", tone: "warning" as const }
      : remaining < 0
        ? { label: "초과", tone: "danger" as const }
        : budgetRisks.length > 0
          ? { label: "주의", tone: "warning" as const }
          : { label: "안정", tone: "success" as const };

  useEffect(() => {
    Animated.timing(progressAnim, { toValue: spentPct, duration: 800, useNativeDriver: false }).start();
  }, [spentPct, progressAnim]);

  async function saveTotalBudget() {
    if (!coupleId) return;
    const num = parseInt(totalInput, 10);
    if (isNaN(num) || num < 0) { Alert.alert("알림", "올바른 금액을 입력해주세요 (만원)"); return; }
    const res = await apiFetch("/api/journey", {
      method: "PATCH",
      body: JSON.stringify({ total_budget: num * 10000 }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      Alert.alert("오류", err.error || "총 예산 저장에 실패했어요");
      return;
    }
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
      cur[editingKey] = { ...ex, category: editingKey, ...(sv !== undefined ? { spent: sv } : {}), ...(bv !== undefined ? { budget: bv } : {}), payer: payerInput };
      const res = await apiFetch("/api/journey", {
        method: "PATCH",
        body: JSON.stringify({ progress_patch: { [editingKey]: cur[editingKey] } }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "저장에 실패했어요");
      }
      setEditingKey(null);
      loadData();
    } catch { Alert.alert("오류", "저장에 실패했어요"); }
    finally { setSaving(false); }
  }

  function openEdit(key: string) {
    setBudgetInput(getCatBudget(key) > 0 ? String(Math.round(getCatBudget(key) / 10000)) : "");
    setSpentInput(getCatSpent(key) > 0 ? String(Math.round(getCatSpent(key) / 10000)) : "");
    setPayerInput(getCatPayer(key));
    setEditingKey(key);
  }

  function showHiddenCostAlert(key: string) {
    const data = HIDDEN_COSTS[key];
    if (!data) return;
    const label = CATEGORY_RATIOS.find((c) => c.key === key)?.label ?? key;
    Alert.alert(
      `⚠️ ${label} 추가 비용 주의`,
      `${data.warning}\n\n예상 추가금: ${data.extra}`,
      [{ text: "확인" }],
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={s.container}>
        <LoadingState label="예산 현황을 불러오고 있어요" />
      </SafeAreaView>
    );
  }

  if (loadError && !hasLoadedData) {
    return (
      <SafeAreaView style={s.container} edges={["top"]}>
        <AppHeader title="예산 관리" onBack={() => router.back()} />
        <ErrorRetry
          message="예산 정보를 불러오지 못했어요"
          onRetry={() => { setLoading(true); loadData(); }}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.container} edges={["top"]}>
      <AppHeader
        title="예산 관리"
        subtitle="지출, 분담, 숨은 비용을 함께 봐요"
        onBack={() => router.back()}
      />

      {loadError && hasLoadedData ? (
        <Pressable
          style={({ pressed }) => [s.loadWarning, pressed && s.loadWarningPressed]}
          onPress={loadData}
          accessibilityRole="button"
          accessibilityLabel="예산 최신 정보 다시 불러오기"
        >
          <AlertTriangle size={16} color={colors.danger} />
          <Text style={s.loadWarningText}>최신 예산을 불러오지 못했어요</Text>
          <Text style={s.loadWarningAction}>다시 시도</Text>
        </Pressable>
      ) : null}

      <ScrollView style={{ flex: 1 }} contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadData(); }} tintColor={colors.rose[500]} />}>

        {/* 총 예산 */}
        <View style={s.totalCard}>
          <View style={s.totalTop}>
            <Text style={s.totalLabel}>예산 운영 상태</Text>
            <StatusPill label={budgetStatus.label} tone={budgetStatus.tone} />
          </View>
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

        <Surface style={s.riskPanel}>
          <View style={s.riskHeader}>
            <View>
              <Text style={s.riskEyebrow}>BUDGET RISK</Text>
              <Text style={s.riskTitle}>지금 먼저 볼 돈 문제</Text>
            </View>
            <AlertTriangle
              size={18}
              color={budgetStatus.tone === "danger" ? colors.danger : colors.gold.DEFAULT}
            />
          </View>

          {budgetRisks.length > 0 ? (
            budgetRisks.map((risk) => (
              <Pressable
                key={risk.id}
                style={({ pressed }) => [
                  s.riskRow,
                  pressed && risk.categoryKey && { transform: [{ scale: 0.98 }] },
                ]}
                onPress={() => {
                  if (risk.categoryKey) openEdit(risk.categoryKey);
                }}
                disabled={!risk.categoryKey}
              >
                <View style={[s.riskDot, s[`riskDot_${risk.tone}`]]} />
                <View style={s.riskCopy}>
                  <Text style={s.riskRowTitle}>{risk.title}</Text>
                  <Text style={s.riskRowDetail}>{risk.detail}</Text>
                </View>
                <StatusPill
                  label={risk.tone === "danger" ? "위험" : "점검"}
                  tone={risk.tone}
                />
              </Pressable>
            ))
          ) : (
            <View style={s.safeBudgetBox}>
              <Check size={18} color={colors.rose[500]} />
              <Text style={s.safeBudgetTitle}>현재 큰 예산 위험은 없어요</Text>
              <Text style={s.safeBudgetText}>
                계약 전에는 카테고리별 숨은 비용과 시장가를 한 번 더 확인해두세요.
              </Text>
            </View>
          )}

          <Pressable
            style={({ pressed }) => [s.marketLink, pressed && { opacity: 0.7 }]}
            onPress={() => router.push("/market-prices")}
          >
            <Text style={s.marketLinkText}>시장가 기준 확인하기</Text>
            <TrendingUp size={14} color={colors.rose[500]} />
          </Pressable>
        </Surface>

        {/* 요약 */}
        <View style={s.sumRow}>
          <View style={s.sumCard}><Wallet size={16} color={colors.textTertiary} /><Text style={s.sumLabel}>배정</Text><Text style={s.sumVal}>{formatWon(allocatedBudget)}</Text></View>
          <View style={s.sumCard}><TrendingDown size={16} color={colors.rose[500]} /><Text style={s.sumLabel}>지출</Text><Text style={[s.sumVal, { color: colors.rose[500] }]}>{formatWon(totalSpent)}</Text></View>
          <View style={s.sumCard}><TrendingUp size={16} color={remaining >= 0 ? colors.textSecondary : "#EF4444"} /><Text style={s.sumLabel}>잔여</Text><Text style={[s.sumVal, remaining < 0 && { color: "#EF4444" }]}>{formatWon(Math.abs(remaining))}</Text></View>
        </View>

        {/* 분담 현황 */}
        {totalSpent > 0 && (
          <View style={s.payerSection}>
            <Text style={s.payerTitle}>분담 현황</Text>
            <View style={s.payerGrid}>
              {PAYER_OPTIONS.map((opt) => {
                const amount = payerSummary[opt.value] ?? 0;
                const pct = totalSpent > 0 ? Math.round((amount / totalSpent) * 100) : 0;
                return (
                  <View key={opt.value} style={s.payerCard}>
                    <Text style={s.payerEmoji}>{opt.emoji}</Text>
                    <Text style={s.payerLabel}>{opt.label}</Text>
                    <Text style={s.payerAmount}>{formatWon(amount)}</Text>
                    {pct > 0 && <Text style={s.payerPct}>{pct}%</Text>}
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {/* 카테고리 목록 */}
        {CATEGORY_RATIOS.map((cat) => {
          const b = getCatBudget(cat.key), sp = getCatSpent(cat.key), st = getCatStatus(cat.key);
          const pct = b > 0 ? Math.min(100, Math.round((sp / b) * 100)) : 0;
          const hasHidden = !!HIDDEN_COSTS[cat.key];
          const payerInfo = PAYER_OPTIONS.find((p) => p.value === getCatPayer(cat.key));
          return (
            <Pressable key={cat.key} style={({ pressed }) => [s.catCard, pressed && { transform: [{ scale: 0.98 }] }]} onPress={() => openEdit(cat.key)}>
              <View style={s.catHead}>
                <View style={s.catLabelRow}>
                  <Text style={s.catLabel}>{cat.label}</Text>
                  {hasHidden && (
                    <Pressable
                      onPress={(e) => { e.stopPropagation?.(); showHiddenCostAlert(cat.key); }}
                      hitSlop={8}
                      style={s.hiddenCostBtn}
                    >
                      <AlertTriangle size={12} color="#D97706" />
                    </Pressable>
                  )}
                </View>
                <View style={s.catHeadRight}>
                  {payerInfo && payerInfo.value !== "couple" && (
                    <View style={s.payerBadge}>
                      <Text style={s.payerBadgeText}>{payerInfo.emoji} {payerInfo.label}</Text>
                    </View>
                  )}
                  <View style={[s.badge, st === "완료" && s.badgeDone, st === "진행중" && s.badgeProg]}>
                    <Text style={[s.badgeText, st === "완료" && s.badgeTextDone, st === "진행중" && s.badgeTextProg]}>{st}</Text>
                  </View>
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
            <Text style={s.fLabel}>분담</Text>
            <View style={s.payerRow}>
              {PAYER_OPTIONS.map((opt) => (
                <Pressable
                  key={opt.value}
                  style={[s.payerOption, payerInput === opt.value && s.payerOptionActive]}
                  onPress={() => setPayerInput(opt.value)}
                >
                  <Text style={s.payerOptionEmoji}>{opt.emoji}</Text>
                  <Text style={[s.payerOptionLabel, payerInput === opt.value && s.payerOptionLabelActive]}>{opt.label}</Text>
                </Pressable>
              ))}
            </View>
            {editingKey && HIDDEN_COSTS[editingKey] && (
              <View style={s.hiddenCostBanner}>
                <AlertTriangle size={14} color="#D97706" />
                <View style={s.hiddenCostBannerText}>
                  <Text style={s.hiddenCostTitle}>추가 비용 주의</Text>
                  <Text style={s.hiddenCostDesc}>{HIDDEN_COSTS[editingKey].warning}</Text>
                  <Text style={s.hiddenCostExtra}>{HIDDEN_COSTS[editingKey].extra}</Text>
                </View>
              </View>
            )}
            <Pressable style={s.saveBtn} onPress={saveCategoryEdit} disabled={saving}>{saving ? <ActivityIndicator color="#FFF" /> : <Text style={s.saveTxt}>저장</Text>}</Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  loadWarning: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 20, marginTop: 12, paddingHorizontal: 14, borderRadius: 14, backgroundColor: "rgba(239, 68, 68, 0.08)" },
  loadWarningPressed: { opacity: 0.78 },
  loadWarningText: { flex: 1, fontSize: 12, fontFamily: "NotoSansKR_400Regular", color: colors.textSecondary },
  loadWarningAction: { fontSize: 12, fontFamily: "NotoSansKR_600SemiBold", color: colors.danger },
  content: { padding: 20, paddingBottom: 40 },
  totalCard: { backgroundColor: colors.noir[800], borderRadius: 24, padding: 24, marginBottom: 16, shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.12, shadowRadius: 16, elevation: 4 },
  totalTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 8 },
  totalLabel: { fontSize: 13, fontFamily: "NotoSansKR_400Regular", color: colors.taupe[400] },
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
  riskPanel: { paddingVertical: 18, marginBottom: 16 },
  riskHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 10 },
  riskEyebrow: { fontSize: 11, fontFamily: "NotoSansKR_600SemiBold", color: colors.textTertiary, marginBottom: 2 },
  riskTitle: { fontSize: 17, fontFamily: "NotoSansKR_600SemiBold", color: colors.noir[800] },
  riskRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.border },
  riskDot: { width: 4, height: 36, borderRadius: 2 },
  riskDot_neutral: { backgroundColor: colors.taupe[400] },
  riskDot_rose: { backgroundColor: colors.rose[500] },
  riskDot_warning: { backgroundColor: colors.gold.DEFAULT },
  riskDot_danger: { backgroundColor: colors.danger },
  riskCopy: { flex: 1, gap: 2 },
  riskRowTitle: { fontSize: 14, fontFamily: "NotoSansKR_600SemiBold", color: colors.noir[800] },
  riskRowDetail: { fontSize: 12, fontFamily: "NotoSansKR_400Regular", color: colors.textSecondary, lineHeight: 18 },
  safeBudgetBox: { alignItems: "center", paddingVertical: 18, gap: 6, borderTopWidth: 1, borderTopColor: colors.border },
  safeBudgetTitle: { fontSize: 14, fontFamily: "NotoSansKR_600SemiBold", color: colors.noir[800] },
  safeBudgetText: { fontSize: 12, fontFamily: "NotoSansKR_400Regular", color: colors.textSecondary, textAlign: "center", lineHeight: 18 },
  marketLink: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 8, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border },
  marketLinkText: { fontSize: 13, fontFamily: "NotoSansKR_600SemiBold", color: colors.rose[500] },
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

  // 숨겨진 비용 경고
  catLabelRow: { flexDirection: "row", alignItems: "center", gap: 6, flex: 1 },
  catHeadRight: { flexDirection: "row", alignItems: "center", gap: 6 },
  hiddenCostBtn: { width: 20, height: 20, borderRadius: 10, backgroundColor: "rgba(217,119,6,0.1)", alignItems: "center", justifyContent: "center" },
  hiddenCostBanner: { flexDirection: "row", alignItems: "flex-start", gap: 10, backgroundColor: "rgba(217,119,6,0.08)", borderRadius: 12, padding: 12, marginTop: 16 },
  hiddenCostBannerText: { flex: 1 },
  hiddenCostTitle: { fontSize: 12, fontFamily: "NotoSansKR_600SemiBold", color: "#D97706", marginBottom: 2 },
  hiddenCostDesc: { fontSize: 12, fontFamily: "NotoSansKR_400Regular", color: colors.textSecondary, lineHeight: 18 },
  hiddenCostExtra: { fontSize: 13, fontFamily: "NotoSansKR_600SemiBold", color: "#D97706", marginTop: 4 },

  // 분담(Payer) 선택
  payerRow: { flexDirection: "row", gap: 8 },
  payerOption: { flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: 12, backgroundColor: colors.ivory[200], borderWidth: 1, borderColor: "transparent" },
  payerOptionActive: { backgroundColor: "rgba(196,150,126,0.12)", borderColor: colors.rose[500] },
  payerOptionEmoji: { fontSize: 16, marginBottom: 2 },
  payerOptionLabel: { fontSize: 11, fontFamily: "NotoSansKR_400Regular", color: colors.textTertiary },
  payerOptionLabelActive: { color: colors.rose[500], fontFamily: "NotoSansKR_600SemiBold" },
  payerBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: "rgba(196,150,126,0.1)" },
  payerBadgeText: { fontSize: 10, fontFamily: "NotoSansKR_400Regular", color: colors.rose[500] },

  // 분담 현황 섹션
  payerSection: { marginBottom: 20 },
  payerTitle: { fontSize: 13, fontFamily: "NotoSansKR_600SemiBold", color: colors.noir[800], marginBottom: 10 },
  payerGrid: { flexDirection: "row", gap: 8 },
  payerCard: { flex: 1, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 10, alignItems: "center", gap: 2 },
  payerEmoji: { fontSize: 16 },
  payerLabel: { fontSize: 10, fontFamily: "NotoSansKR_400Regular", color: colors.textTertiary },
  payerAmount: { fontSize: 13, fontFamily: "CormorantGaramond_600SemiBold", color: colors.noir[800] },
  payerPct: { fontSize: 10, fontFamily: "NotoSansKR_400Regular", color: colors.rose[500] },
});
