// 동기방 탐색 — 풀스크린
import { useEffect, useState, useCallback } from "react";
import { View, ScrollView, StyleSheet, Pressable, ActivityIndicator, RefreshControl, Alert } from "react-native";
import { Text } from "@/components/ui/AppText";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import {
  Users,
  MessageCircle,
  Calendar,
} from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";
import { supabase } from "@/lib/supabase";
import { apiFetch } from "@/lib/api";
import { AppHeader, EmptyState, LoadingState, PrimaryButton } from "@/components/ui/AppUI";

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

/* ───── 동기방 카드 ───── */

function RoomCard({
  room,
  onJoin,
  joining,
}: {
  room: CohortRoom;
  onJoin: (room: CohortRoom) => void;
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

      <PrimaryButton
        style={styles.joinButton}
        onPress={(e) => {
          e.stopPropagation?.();
          onJoin(room);
        }}
        disabled={isJoining}
        icon={isJoining ? <ActivityIndicator size="small" color="#FFFFFF" /> : undefined}
      >
        {isJoining ? "입장 중" : "입장하기"}
      </PrimaryButton>
    </Pressable>
  );
}

/* ───── 분기별 그룹 섹션 ───── */

function getQuarterLabel(month: number): string {
  if (month <= 3) return "1분기 (1~3월)";
  if (month <= 6) return "2분기 (4~6월)";
  if (month <= 9) return "3분기 (7~9월)";
  return "4분기 (10~12월)";
}

function MonthlySection({
  rooms,
  onJoin,
  joining,
}: {
  rooms: CohortRoom[];
  onJoin: (room: CohortRoom) => void;
  joining: string | null;
}) {
  // 연도+분기별로 그룹핑
  const grouped = rooms.reduce<Record<string, CohortRoom[]>>((acc, room) => {
    const key = `${room.year}년 ${getQuarterLabel(room.month)}`;
    if (!acc[key]) acc[key] = [];
    acc[key].push(room);
    return acc;
  }, {});

  const sections = Object.entries(grouped);

  if (sections.length === 0) {
    return (
      <EmptyState
        icon={<Calendar size={40} color={colors.taupe[400]} />}
        title="활성화된 동기방이 없어요"
        description="현재 들어갈 수 있는 방이 없어요. 나중에 다시 확인해주세요."
      />
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

/* ───── 메인 ───── */

export default function CohortDiscoveryScreen() {
  const [rooms, setRooms] = useState<CohortRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [joining, setJoining] = useState<string | null>(null);

  const loadRooms = useCallback(async () => {
    try {
      setLoadError(null);
      const { data, error } = await supabase
        .from("cohort_rooms")
        .select("*")
        .eq("is_active", true)
        .order("year")
        .order("month");
      if (error) throw error;

      setRooms((data as CohortRoom[]) ?? []);
    } catch {
      setLoadError("동기방을 불러오지 못했어요. 연결을 확인한 뒤 다시 시도해주세요.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadRooms();
  }, [loadRooms]);

  // 동기방 입장 — 멤버십 쓰기는 서버 전용(20260615090000 하드닝):
  // 클라 직접 INSERT는 트리거가 차단하므로, 웹 API(POST /api/community/cohort)가
  // 배정·정원(30명)·member_count 갱신을 service-role로 처리한다.
  async function handleJoin(room: CohortRoom) {
    setJoining(room.id);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user?.id;
      if (!userId) {
        router.push("/(auth)/login");
        return;
      }

      // 이미 이 방의 활성 멤버면 바로 입장 (SELECT는 클라 허용)
      const { data: existing } = await supabase
        .from("cohort_members")
        .select("id")
        .eq("room_id", room.id)
        .eq("user_id", userId)
        .eq("is_active", true)
        .maybeSingle();

      if (existing) {
        router.push({ pathname: "/community/cohort/[id]", params: { id: room.id } });
        return;
      }

      const res = await apiFetch("/api/community/cohort", {
        method: "POST",
        body: JSON.stringify({ year: room.year, month: room.month }),
      });
      const data = (await res.json().catch(() => ({}))) as { room_id?: string; error?: string };
      if (!res.ok || !data.room_id) {
        Alert.alert("입장 실패", data.error ?? "동기방 입장에 실패했어요. 잠시 후 다시 시도해주세요.");
        return;
      }

      // 서버가 같은 분기 내 정원 여유 방으로 배정 — 응답의 room_id로 이동
      router.push({ pathname: "/community/cohort/[id]", params: { id: data.room_id } });
    } catch (err) {
      console.error("동기방 입장 에러:", err);
      // 세션 만료는 apiFetch가 이미 Alert+재로그인 이동을 처리 — 중복 알림 방지
      if (!(err instanceof Error && err.message.includes("세션"))) {
        Alert.alert("입장 실패", "동기방 입장에 실패했어요. 잠시 후 다시 시도해주세요.");
      }
    } finally {
      setJoining(null);
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <AppHeader title="동기방 찾기" onBack={() => router.back()} />

      {/* 컨텐츠 */}
      {loading ? (
        <LoadingState label="동기방을 불러오는 중이에요" />
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
          {loadError ? (
            <View style={styles.errorState}>
              <EmptyState
                icon={<Users size={40} color={colors.taupe[400]} />}
                title="동기방을 열지 못했어요"
                description={loadError}
              />
              <PrimaryButton
                tone="rose"
                onPress={() => {
                  setLoading(true);
                  void loadRooms();
                }}
              >
                다시 시도
              </PrimaryButton>
            </View>
          ) : (
            <MonthlySection
              rooms={rooms}
              onJoin={handleJoin}
              joining={joining}
            />
          )}

          {/* 하단 CTA */}
          <View style={styles.bottomCta}>
            <View style={styles.bottomCtaLine} />
            <Text style={styles.bottomCtaText}>
              나만의 동기방이 없다면?{"\n"}
              결혼 예정일을 설정한 뒤 같은 분기의 방을 골라 입장하세요
            </Text>
            <PrimaryButton
              tone="rose"
              style={styles.bottomCtaButton}
              onPress={() => router.push("/(tabs)/profile")}
            >
              결혼 예정일 설정하기
            </PrimaryButton>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

/* ───── 스타일 ───── */

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },

  // 스크롤 컨텐츠
  scrollContent: { paddingBottom: 40 },
  errorState: {
    paddingHorizontal: 20,
    paddingTop: 32,
    gap: 16,
  },

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

  joinButton: {
    minHeight: 44,
    borderRadius: 12,
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
  bottomCtaButton: {
    alignSelf: "stretch",
    shadowColor: colors.rose[500],
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 4,
  },
});
