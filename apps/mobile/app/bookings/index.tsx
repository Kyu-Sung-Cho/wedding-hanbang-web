// 내 예약 목록
import { useEffect, useState, useCallback } from "react";
import {
  View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator,
  RefreshControl, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { ArrowLeft, CalendarCheck } from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";
import { supabase } from "@/lib/supabase";

type BookingStatus = "pending" | "confirmed" | "cancelled";

interface Booking {
  id: string;
  booking_date: string;
  booking_time: string | null;
  status: BookingStatus;
  amount: number | null;
  vendor: { name: string; category: string } | null;
  product: { name: string; price: number | null } | null;
}

type TabKey = "all" | "upcoming" | "completed" | "cancelled";

const TABS: { key: TabKey; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "upcoming", label: "예정" },
  { key: "completed", label: "완료" },
  { key: "cancelled", label: "취소" },
];

const STATUS_MAP: Record<BookingStatus, { label: string; color: string; bg: string }> = {
  pending: { label: "대기중", color: colors.gold.DEFAULT, bg: "rgba(201,169,110,0.12)" },
  confirmed: { label: "확정", color: colors.success, bg: "rgba(34,197,94,0.10)" },
  cancelled: { label: "취소됨", color: colors.danger, bg: "rgba(239,68,68,0.10)" },
};

function formatWon(n: number): string {
  if (n >= 100000000) return `${(n / 100000000).toFixed(1)}억`;
  if (n >= 10000) return `${Math.round(n / 10000).toLocaleString()}만원`;
  if (n > 0) return `${n.toLocaleString()}원`;
  return "—";
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}.${m}.${day}`;
}

export default function BookingsScreen() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<TabKey>("all");

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

      const { data, error } = await supabase
        .from("vendor_bookings")
        .select("id, booking_date, booking_time, status, amount, vendor:vendors(name, category), product:vendor_products(name, price)")
        .eq("couple_id", profile.couple_id)
        .order("booking_date", { ascending: false });

      if (error) throw error;

      setBookings(
        (data ?? []).map((row: Record<string, unknown>) => ({
          id: row.id as string,
          booking_date: row.booking_date as string,
          booking_time: (row.booking_time as string) ?? null,
          status: row.status as BookingStatus,
          amount: (row.amount as number) ?? null,
          vendor: row.vendor as Booking["vendor"],
          product: row.product as Booking["product"],
        }))
      );
    } catch (err) {
      console.error("Bookings load:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  function filterBookings(list: Booking[]): Booking[] {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    switch (tab) {
      case "upcoming":
        return list.filter((b) => b.status !== "cancelled" && new Date(b.booking_date) >= today);
      case "completed":
        return list.filter((b) => b.status !== "cancelled" && new Date(b.booking_date) < today);
      case "cancelled":
        return list.filter((b) => b.status === "cancelled");
      default:
        return list;
    }
  }

  const filtered = filterBookings(bookings);

  function showDetail(b: Booking) {
    const lines = [
      `업체: ${b.vendor?.name ?? "—"}`,
      `카테고리: ${b.vendor?.category ?? "—"}`,
      `상품: ${b.product?.name ?? "—"}`,
      `날짜: ${formatDate(b.booking_date)}`,
      b.booking_time ? `시간: ${b.booking_time}` : null,
      `상태: ${STATUS_MAP[b.status].label}`,
      `금액: ${b.amount ? formatWon(b.amount) : "—"}`,
    ].filter(Boolean).join("\n");
    Alert.alert("예약 상세", lines);
  }

  if (loading) {
    return (
      <SafeAreaView style={s.container} edges={["top"]}>
        <ActivityIndicator color={colors.rose[500]} style={{ marginTop: 40 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.container} edges={["top"]}>
      {/* 헤더 */}
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <ArrowLeft size={24} color={colors.noir[800]} />
        </Pressable>
        <Text style={s.headerTitle}>내 예약</Text>
        <View style={{ width: 24 }} />
      </View>

      {/* 탭 필터 */}
      <View style={s.tabRow}>
        {TABS.map((t) => (
          <Pressable
            key={t.key}
            style={[s.tab, tab === t.key && s.tabActive]}
            onPress={() => setTab(t.key)}
          >
            <Text style={[s.tabText, tab === t.key && s.tabTextActive]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={s.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); loadData(); }}
            tintColor={colors.rose[500]}
          />
        }
      >
        {filtered.length === 0 ? (
          <View style={s.empty}>
            <CalendarCheck size={48} color={colors.taupe[400]} />
            <Text style={s.emptyText}>예약 내역이 없어요</Text>
          </View>
        ) : (
          filtered.map((b) => {
            const st = STATUS_MAP[b.status];
            return (
              <Pressable
                key={b.id}
                style={({ pressed }) => [s.card, pressed && { transform: [{ scale: 0.98 }] }]}
                onPress={() => showDetail(b)}
              >
                <View style={s.cardTop}>
                  <Text style={s.vendorName}>{b.vendor?.name ?? "업체 미정"}</Text>
                  <View style={[s.badge, { backgroundColor: st.bg }]}>
                    <Text style={[s.badgeText, { color: st.color }]}>{st.label}</Text>
                  </View>
                </View>
                <Text style={s.productName}>{b.product?.name ?? "—"}</Text>
                <View style={s.cardBottom}>
                  <Text style={s.dateText}>
                    {formatDate(b.booking_date)}
                    {b.booking_time ? ` ${b.booking_time}` : ""}
                  </Text>
                  {b.amount != null && b.amount > 0 && (
                    <Text style={s.amount}>{formatWon(b.amount)}</Text>
                  )}
                </View>
              </Pressable>
            );
          })
        )}
      </ScrollView>
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

const s = StyleSheet.create({
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
    fontFamily: "NotoSerifKR_500Medium",
    color: colors.noir[800],
  },

  // 탭 필터
  tabRow: {
    flexDirection: "row",
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 4,
    gap: 8,
  },
  tab: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: colors.ivory[200],
  },
  tabActive: {
    backgroundColor: colors.noir[800],
  },
  tabText: {
    fontSize: 13,
    fontFamily: "NotoSansKR_500Medium",
    color: colors.textSecondary,
  },
  tabTextActive: {
    color: "#FFFFFF",
  },

  content: { padding: 20, paddingBottom: 40 },

  // 카드
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 18,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
    ...CARD_SHADOW,
  },
  cardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  vendorName: {
    fontSize: 16,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.noir[800],
    flex: 1,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
  },
  badgeText: {
    fontSize: 12,
    fontFamily: "NotoSansKR_600SemiBold",
  },
  productName: {
    fontSize: 14,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
    marginBottom: 10,
  },
  cardBottom: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  dateText: {
    fontSize: 13,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textTertiary,
  },
  amount: {
    fontSize: 16,
    fontFamily: "CormorantGaramond_600SemiBold",
    color: colors.noir[800],
  },

  // 빈 상태
  empty: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 80,
    gap: 16,
  },
  emptyText: {
    fontSize: 15,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textTertiary,
  },
});
