// 예산 화면 — 읽기 전용 (편집은 웹에서)
import { useEffect, useState, useCallback } from "react";
import {
  View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator, RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { ArrowLeft, TrendingDown, TrendingUp, Wallet } from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";
import { supabase } from "@/lib/supabase";

interface BudgetItem {
  id: string;
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

function formatWon(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(n % 10000 === 0 ? 0 : 1)}억`;
  return `${n.toLocaleString()}만원`;
}

export default function BudgetScreen() {
  const [data, setData] = useState<BudgetData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

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

      // 예산 총액
      const { data: journey } = await supabase
        .from("wedding_journeys")
        .select("total_budget")
        .eq("couple_id", profile.couple_id)
        .single();

      // 예산 항목
      const { data: budgetRows } = await supabase
        .from("budget_items")
        .select("*")
        .eq("couple_id", profile.couple_id)
        .order("category");

      const items: BudgetItem[] = (budgetRows ?? []).map((r) => ({
        id: r.id,
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
      console.error("Budget load error:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // 카테고리별 그룹핑
  const grouped = data?.items.reduce<Record<string, BudgetItem[]>>((acc, item) => {
    const key = item.category || "기타";
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {}) ?? {};

  const remaining = (data?.totalBudget ?? 0) - (data?.totalActual ?? 0);

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
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadData(); }} tintColor={colors.rose[500]} />
        }
      >
        {/* 요약 카드 3개 */}
        <View style={styles.summaryRow}>
          <View style={styles.summaryCard}>
            <Wallet size={18} color={colors.textTertiary} />
            <Text style={styles.summaryLabel}>총 예산</Text>
            <Text style={styles.summaryValue}>
              {data?.totalBudget ? formatWon(data.totalBudget) : "—"}
            </Text>
          </View>
          <View style={styles.summaryCard}>
            <TrendingDown size={18} color={colors.rose[500]} />
            <Text style={styles.summaryLabel}>지출</Text>
            <Text style={[styles.summaryValue, { color: colors.rose[500] }]}>
              {data?.totalActual ? formatWon(data.totalActual) : "—"}
            </Text>
          </View>
          <View style={styles.summaryCard}>
            <TrendingUp size={18} color={remaining >= 0 ? colors.textSecondary : "#EF4444"} />
            <Text style={styles.summaryLabel}>잔여</Text>
            <Text style={[styles.summaryValue, remaining < 0 && { color: "#EF4444" }]}>
              {data?.totalBudget ? formatWon(remaining) : "—"}
            </Text>
          </View>
        </View>

        {/* 카테고리별 목록 */}
        {Object.keys(grouped).length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>등록된 예산 항목이 없어요</Text>
            <Text style={styles.emptyHint}>웹에서 예산을 설정하면 여기에 표시됩니다</Text>
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
                  <View key={item.id} style={styles.itemRow}>
                    <View style={[styles.paidDot, item.is_paid && styles.paidDotActive]} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.itemName}>{item.item_name}</Text>
                      {item.notes && <Text style={styles.itemNotes}>{item.notes}</Text>}
                    </View>
                    <View style={styles.itemCosts}>
                      <Text style={styles.itemActual}>
                        {item.actual_cost ? formatWon(item.actual_cost) : "—"}
                      </Text>
                      {item.estimated_cost > 0 && (
                        <Text style={styles.itemEstimated}>
                          예상 {formatWon(item.estimated_cost)}
                        </Text>
                      )}
                    </View>
                  </View>
                ))}
              </View>
            );
          })
        )}

        <Text style={styles.webHint}>상세 편집은 hanbang.ai 웹에서 가능합니다</Text>
      </ScrollView>
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
  headerTitle: { fontSize: 18, fontWeight: "600", color: colors.noir[800] },
  content: { padding: 20, paddingBottom: 40 },

  summaryRow: { flexDirection: "row", gap: 10, marginBottom: 20 },
  summaryCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    alignItems: "center",
    gap: 6,
  },
  summaryLabel: { fontSize: 11, color: colors.textTertiary },
  summaryValue: { fontSize: 16, fontWeight: "700", color: colors.noir[800] },

  empty: { alignItems: "center", paddingTop: 60 },
  emptyText: { fontSize: 16, fontWeight: "500", color: colors.noir[800], marginBottom: 8 },
  emptyHint: { fontSize: 13, color: colors.textTertiary },

  catSection: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 20,
    padding: 16,
    marginBottom: 12,
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
  catLabel: { fontSize: 16, fontWeight: "600", color: colors.noir[800] },
  catTotal: { fontSize: 14, fontWeight: "600", color: colors.rose[500] },

  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  paidDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.ivory[200],
  },
  paidDotActive: { backgroundColor: colors.rose[500] },
  itemName: { fontSize: 14, color: colors.noir[800] },
  itemNotes: { fontSize: 11, color: colors.textTertiary, marginTop: 2 },
  itemCosts: { alignItems: "flex-end" },
  itemActual: { fontSize: 14, fontWeight: "600", color: colors.noir[800] },
  itemEstimated: { fontSize: 11, color: colors.textTertiary, marginTop: 2 },

  webHint: {
    fontSize: 12,
    color: colors.textTertiary,
    textAlign: "center",
    marginTop: 24,
  },
});
