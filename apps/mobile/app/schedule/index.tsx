// 체크리스트/일정 화면 — 카테고리별 체크리스트 + 체크 토글
import { useEffect, useState, useCallback } from "react";
import {
  View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator, RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { ArrowLeft, ChevronDown, ChevronUp, CheckCircle2, Circle } from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";
import { supabase } from "@/lib/supabase";

interface ChecklistItem {
  id: string;
  label: string;
  done: boolean;
}

interface Category {
  key: string;
  label: string;
  ddayStart: number;
  ddayDeadline: number;
  items: ChecklistItem[];
}

export default function ScheduleScreen() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [progress, setProgress] = useState<Record<string, Record<string, boolean>>>({});
  const [coupleId, setCoupleId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

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

      // progress 객체에서 카테고리별 아이템 추출
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

          cats.push({
            key,
            label: key.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()),
            ddayStart: 0,
            ddayDeadline: 0,
            items: checkItems,
          });

          progMap[key] = items;
        }
      }

      setCategories(cats);
      setProgress(progMap);
    } catch (err) {
      console.error("Schedule load error:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  async function toggleItem(categoryKey: string, itemId: string, currentDone: boolean) {
    if (!coupleId) return;

    // 낙관적 업데이트
    setProgress((prev) => ({
      ...prev,
      [categoryKey]: {
        ...prev[categoryKey],
        [itemId]: !currentDone,
      },
    }));

    // Supabase 업데이트
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
  }

  function getCategoryStats(key: string) {
    const items = progress[key] ?? {};
    const total = Object.keys(items).length;
    const done = Object.values(items).filter(Boolean).length;
    return { total, done, percent: total > 0 ? Math.round((done / total) * 100) : 0 };
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
        <Text style={styles.headerTitle}>체크리스트</Text>
        <View style={{ width: 24 }} />
      </View>

      {/* 전체 진행률 */}
      <View style={styles.summaryCard}>
        <Text style={styles.summaryLabel}>전체 진행률</Text>
        <Text style={styles.summaryPercent}>
          {categories.length > 0
            ? Math.round(
                categories.reduce((sum, c) => sum + getCategoryStats(c.key).percent, 0) /
                  categories.length
              )
            : 0}
          %
        </Text>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadData(); }} tintColor={colors.rose[500]} />
        }
      >
        {categories.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>체크리스트가 아직 없어요.</Text>
            <Text style={styles.emptyHint}>웹에서 온보딩을 완료하면 자동 생성됩니다.</Text>
          </View>
        ) : (
          categories.map((cat) => {
            const stats = getCategoryStats(cat.key);
            const expanded = expandedKey === cat.key;

            return (
              <View key={cat.key} style={styles.catCard}>
                <Pressable
                  style={styles.catHeader}
                  onPress={() => setExpandedKey(expanded ? null : cat.key)}
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

                {/* 진행 바 */}
                <View style={styles.catBar}>
                  <View style={[styles.catBarFill, { width: `${stats.percent}%` }]} />
                </View>

                {/* 펼친 아이템 */}
                {expanded && (
                  <View style={styles.itemList}>
                    {(progress[cat.key] ? Object.entries(progress[cat.key]) : []).map(([id, done]) => (
                      <Pressable
                        key={id}
                        style={styles.itemRow}
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
  summaryCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    margin: 20,
    marginBottom: 8,
    padding: 20,
    backgroundColor: colors.noir[800],
    borderRadius: 20,
  },
  summaryLabel: { fontSize: 14, color: colors.taupe[400] },
  summaryPercent: { fontSize: 32, fontFamily: "CormorantGaramond_600SemiBold", color: "#FFFFFF" },
  list: { padding: 20, gap: 12, paddingBottom: 40 },
  empty: { alignItems: "center", paddingTop: 60 },
  emptyText: { fontSize: 16, fontWeight: "500", color: colors.noir[800], marginBottom: 8 },
  emptyHint: { fontSize: 13, color: colors.textTertiary },

  catCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 20,
    padding: 16,
  },
  catHeader: { flexDirection: "row", alignItems: "center" },
  catLabel: { fontSize: 16, fontWeight: "600", color: colors.noir[800] },
  catStat: { fontSize: 12, color: colors.textTertiary, marginTop: 2 },
  catRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  catPercent: { fontSize: 14, fontWeight: "600", color: colors.rose[500] },
  catBar: {
    height: 4,
    backgroundColor: colors.ivory[200],
    borderRadius: 999,
    marginTop: 12,
    overflow: "hidden",
  },
  catBarFill: { height: "100%", backgroundColor: colors.rose[500], borderRadius: 999 },

  itemList: { marginTop: 16, gap: 12 },
  itemRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  itemLabel: { fontSize: 14, color: colors.noir[800], flex: 1 },
  itemDone: { textDecorationLine: "line-through", color: colors.textTertiary },
});
