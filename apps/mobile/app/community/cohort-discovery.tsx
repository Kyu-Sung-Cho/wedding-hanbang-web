// 동기방 탐색 — 풀스크린
import { useEffect, useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  Animated,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import {
  ArrowLeft,
  Users,
  MessageCircle,
  MapPin,
  Wallet,
  Calendar,
} from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";
import { supabase } from "@/lib/supabase";

/* ───── 타입 ───── */

interface CohortRoom {
  id: string;
  name: string;
  year: number;
  month: number;
  member_count: number;
  message_count: number;
  is_active: boolean;
}

type FilterTab = "monthly" | "region" | "budget";

const FILTER_TABS: { key: FilterTab; label: string; icon: typeof Calendar }[] = [
  { key: "monthly", label: "월별", icon: Calendar },
  { key: "region", label: "지역별", icon: MapPin },
  { key: "budget", label: "예산별", icon: Wallet },
];

/* ───── 동기방 카드 ───── */

function RoomCard({
  room,
  onJoin,
  joining,
}: {
  room: CohortRoom;
  onJoin: (roomId: string) => void;
  joining: string | null;
}) {
  const isJoining = joining === room.id;

  return (
    <Pressable
      style={({ pressed }) => [
        styles.roomCard,
        pressed && { transform: [{ scale: 0.98 }] },
      ]}
      onPress={() =>
        router.push({ pathname: "/community/cohort/[id]", params: { id: room.id } })
      }
    >
      <View style={styles.roomCardTop}>
        <View style={styles.roomIconWrap}>
          <Users size={20} color={colors.rose[500]} />
        </View>
        <View style={styles.roomCardInfo}>
          <Text style={styles.roomCardName} numberOfLines={1}>
            {room.name}
          </Text>
          <Text style={styles.roomCardSub}>
            {room.member_count}명이 준비 중
          </Text>
        </View>
      </View>

      <View style={styles.roomCardStats}>
        <View style={styles.roomStat}>
          <Users size={14} color={colors.taupe[400]} />
          <Text style={styles.roomStatText}>{room.member_count}</Text>
        </View>
        <View style={styles.roomStat}>
          <MessageCircle size={14} color={colors.taupe[400]} />
          <Text style={styles.roomStatText}>{room.message_count}</Text>
        </View>
      </View>

      <Pressable
        style={({ pressed }) => [
          styles.joinBtn,
          pressed && { backgroundColor: colors.noir.soft },
          isJoining && { backgroundColor: colors.taupe[400] },
        ]}
        onPress={(e) => {
          e.stopPropagation?.();
          onJoin(room.id);
        }}
        disabled={isJoining}
      >
        {isJoining ? (
          <ActivityIndicator size="small" color="#FFFFFF" />
        ) : (
          <Text style={styles.joinBtnText}>입장하기</Text>
        )}
      </Pressable>
    </Pressable>
  );
}

/* ───── 월별 그룹 섹션 ───── */

function MonthlySection({
  rooms,
  onJoin,
  joining,
}: {
  rooms: CohortRoom[];
  onJoin: (roomId: string) => void;
  joining: string | null;
}) {
  // 연-월로 그룹핑
  const grouped = rooms.reduce<Record<string, CohortRoom[]>>((acc, room) => {
    const key = `${room.year}년 ${room.month}월`;
    if (!acc[key]) acc[key] = [];
    acc[key].push(room);
    return acc;
  }, {});

  const sections = Object.entries(grouped);

  if (sections.length === 0) {
    return (
      <View style={styles.emptyState}>
        <Calendar size={40} color={colors.taupe[400]} />
        <Text style={styles.emptyTitle}>활성화된 동기방이 없어요</Text>
        <Text style={styles.emptyText}>곧 새로운 동기방이 열릴 예정이에요</Text>
      </View>
    );
  }

  return (
    <View style={styles.sectionList}>
      {sections.map(([sectionTitle, sectionRooms]) => (
        <View key={sectionTitle} style={styles.monthSection}>
          <Text style={styles.monthSectionTitle}>{sectionTitle}</Text>
          {sectionRooms.map((room) => (
            <RoomCard
              key={room.id}
              room={room}
              onJoin={onJoin}
              joining={joining}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

/* ───── 준비 중 플레이스홀더 ───── */

function ComingSoonSection({
  icon: Icon,
  message,
}: {
  icon: typeof MapPin;
  message: string;
}) {
  return (
    <View style={styles.comingSoonWrap}>
      <View style={styles.comingSoonIcon}>
        <Icon size={32} color={colors.rose[500]} />
      </View>
      <Text style={styles.comingSoonTitle}>{message}</Text>
      <Text style={styles.comingSoonSub}>
        더 나은 매칭을 위해 열심히 준비하고 있어요
      </Text>
    </View>
  );
}

/* ───── 메인 ───── */

export default function CohortDiscoveryScreen() {
  const [rooms, setRooms] = useState<CohortRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<FilterTab>("monthly");
  const [joining, setJoining] = useState<string | null>(null);
  const indicatorAnim = useRef(new Animated.Value(0)).current;

  const loadRooms = useCallback(async () => {
    try {
      const { data } = await supabase
        .from("cohort_rooms")
        .select("*")
        .eq("is_active", true)
        .order("year")
        .order("month");

      setRooms((data as CohortRoom[]) ?? []);
    } catch {
      // 조용히 실패
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadRooms();
  }, [loadRooms]);

  // 탭 전환 애니메이션
  useEffect(() => {
    const idx = FILTER_TABS.findIndex((t) => t.key === activeTab);
    Animated.spring(indicatorAnim, {
      toValue: idx,
      useNativeDriver: true,
      friction: 6,
    }).start();
  }, [activeTab, indicatorAnim]);

  // 동기방 입장
  async function handleJoin(roomId: string) {
    setJoining(roomId);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user?.id;
      if (!userId) {
        router.push("/(auth)/login");
        return;
      }

      // 이미 멤버인지 확인
      const { data: existing } = await supabase
        .from("cohort_members")
        .select("id")
        .eq("room_id", roomId)
        .eq("user_id", userId)
        .maybeSingle();

      if (!existing) {
        // RPC로 자동 배정 또는 직접 삽입
        const { error } = await supabase.from("cohort_members").insert({
          room_id: roomId,
          user_id: userId,
        });
        if (error) {
          console.error("동기방 입장 에러:", error);
          setJoining(null);
          return;
        }

        // member_count 증가
        await supabase.rpc("increment_cohort_member_count", { rid: roomId });
      }

      router.push({ pathname: "/community/cohort/[id]", params: { id: roomId } });
    } catch (err) {
      console.error("동기방 입장 에러:", err);
    } finally {
      setJoining(null);
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      {/* 헤더 */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <ArrowLeft size={24} color={colors.noir[800]} />
        </Pressable>
        <Text style={styles.headerTitle}>동기방 찾기</Text>
        <View style={{ width: 24 }} />
      </View>

      {/* 필터 탭 */}
      <View style={styles.tabRow}>
        {FILTER_TABS.map((tab) => {
          const active = activeTab === tab.key;
          const Icon = tab.icon;
          return (
            <Pressable
              key={tab.key}
              style={[styles.tab, active && styles.tabActive]}
              onPress={() => setActiveTab(tab.key)}
            >
              <Icon
                size={16}
                color={active ? colors.noir[800] : colors.taupe[400]}
              />
              <Text style={[styles.tabText, active && styles.tabTextActive]}>
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* 컨텐츠 */}
      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.rose[500]} size="large" />
          <Text style={styles.loadingText}>동기방을 불러오는 중...</Text>
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                loadRooms();
              }}
              tintColor={colors.rose[500]}
            />
          }
        >
          {activeTab === "monthly" && (
            <MonthlySection
              rooms={rooms}
              onJoin={handleJoin}
              joining={joining}
            />
          )}

          {activeTab === "region" && (
            <ComingSoonSection
              icon={MapPin}
              message="같은 지역 동기방은 곧 추가됩니다"
            />
          )}

          {activeTab === "budget" && (
            <ComingSoonSection
              icon={Wallet}
              message="같은 예산대 동기방은 곧 추가됩니다"
            />
          )}

          {/* 하단 CTA */}
          <View style={styles.bottomCta}>
            <View style={styles.bottomCtaLine} />
            <Text style={styles.bottomCtaText}>
              나만의 동기방이 없다면?{"\n"}
              결혼 예정월을 설정하면 자동으로 배정돼요
            </Text>
            <Pressable
              style={({ pressed }) => [
                styles.bottomCtaBtn,
                pressed && { backgroundColor: colors.rose[600] },
              ]}
              onPress={() => router.push("/(tabs)/profile")}
            >
              <Text style={styles.bottomCtaBtnText}>결혼 예정일 설정하기</Text>
            </Pressable>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

/* ───── 스타일 ───── */

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },

  // 헤더
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: colors.noir[800],
    fontFamily: "NotoSerifKR_500Medium",
  },

  // 필터 탭
  tabRow: {
    flexDirection: "row",
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 10,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabActive: {
    backgroundColor: colors.surface,
    borderColor: colors.noir[800],
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  tabText: { fontSize: 14, color: colors.taupe[400] },
  tabTextActive: { color: colors.noir[800], fontWeight: "600" },

  // 로딩
  loadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  loadingText: { fontSize: 14, color: colors.textSecondary },

  // 스크롤 컨텐츠
  scrollContent: { paddingBottom: 40 },

  // 월별 섹션
  sectionList: { paddingHorizontal: 20, paddingTop: 16 },
  monthSection: { marginBottom: 24 },
  monthSectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.noir[800],
    marginBottom: 12,
    fontFamily: "NotoSerifKR_500Medium",
  },

  // 방 카드
  roomCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 2,
  },
  roomCardTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 12,
  },
  roomIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: colors.rose.glow,
    alignItems: "center",
    justifyContent: "center",
  },
  roomCardInfo: { flex: 1 },
  roomCardName: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.noir[800],
    marginBottom: 2,
  },
  roomCardSub: { fontSize: 13, color: colors.textSecondary },

  roomCardStats: {
    flexDirection: "row",
    gap: 16,
    marginBottom: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  roomStat: { flexDirection: "row", alignItems: "center", gap: 6 },
  roomStatText: {
    fontSize: 13,
    color: colors.taupe[400],
    fontFamily: "CormorantGaramond_400Regular",
  },

  joinBtn: {
    backgroundColor: colors.noir[800],
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  joinBtnText: { fontSize: 14, fontWeight: "600", color: "#FFFFFF" },

  // 빈 상태
  emptyState: {
    alignItems: "center",
    paddingTop: 80,
    gap: 10,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: colors.noir[800],
    marginTop: 8,
  },
  emptyText: { fontSize: 14, color: colors.textTertiary },

  // Coming Soon
  comingSoonWrap: {
    alignItems: "center",
    paddingTop: 60,
    paddingHorizontal: 40,
    gap: 12,
  },
  comingSoonIcon: {
    width: 72,
    height: 72,
    borderRadius: 24,
    backgroundColor: colors.rose.glow,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  comingSoonTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: colors.noir[800],
    textAlign: "center",
    fontFamily: "NotoSerifKR_500Medium",
  },
  comingSoonSub: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: "center",
    lineHeight: 22,
  },

  // 하단 CTA
  bottomCta: {
    alignItems: "center",
    paddingTop: 32,
    paddingHorizontal: 40,
    gap: 12,
  },
  bottomCtaLine: {
    width: 40,
    height: 2,
    backgroundColor: colors.border,
    borderRadius: 1,
    marginBottom: 8,
  },
  bottomCtaText: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: "center",
    lineHeight: 22,
  },
  bottomCtaBtn: {
    backgroundColor: colors.rose[500],
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 28,
    shadowColor: colors.rose[500],
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 4,
  },
  bottomCtaBtnText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#FFFFFF",
  },
});
