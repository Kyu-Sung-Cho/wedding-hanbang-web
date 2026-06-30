// 커뮤니티 홈 — 프리미엄 웨딩 SNS
import { useEffect, useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  FlatList,
  ScrollView,
  StyleSheet,
  Pressable,
  RefreshControl,
  Animated,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import {
  MessageCircle,
  ChevronUp,
  Eye,
  PenSquare,
  MessageSquarePlus,
  Users,
  ChevronRight,
  Bookmark,
  FileText,
  Zap,
  Search,
} from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";
import { apiJson } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import ErrorRetry from "@/components/ErrorRetry";
import {
  CommunityAvatar,
  type CommunityAvatarRole,
} from "@/components/community/CommunityAvatar";

/* ───── 타입 ───── */

interface PostItem {
  id: string;
  title: string;
  content: string;
  category: string;
  upvote_count: number;
  downvote_count: number;
  comment_count: number;
  view_count: number;
  image_urls?: string[] | null;
  created_at: string;
  author: { nickname: string; rank: string; role?: CommunityAvatarRole | null } | null;
}

interface CohortRoom {
  id: string;
  name: string;
  year: number;
  month: number;
  member_count: number;
  message_count: number;
  is_active: boolean;
}

interface MyCohort {
  room_id: string;
  room: CohortRoom;
}

/* ───── 상수 ───── */

const CATEGORY_LABELS: Record<string, string> = {
  is_normal: "이거 정상이야?",
  tour_review: "투어/후기",
  tips_v2: "꿀팁",
  ama: "AMA",
  free: "자유",
};

const CATEGORIES = ["all", "is_normal", "tour_review", "tips_v2", "ama", "free"];

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "방금";
  if (mins < 60) return `${mins}분 전`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}일 전`;
  return `${Math.floor(days / 30)}달 전`;
}

/* ───── 스켈레톤 ───── */

function SkeletonCard({ index }: { index: number }) {
  const fadeAnim = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(fadeAnim, { toValue: 0.8, duration: 800, useNativeDriver: true }),
        Animated.timing(fadeAnim, { toValue: 0.3, duration: 800, useNativeDriver: true }),
      ])
    ).start();
  }, [fadeAnim]);

  const titleWidths = ["85%" as const, "70%" as const, "90%" as const];
  const previewWidths = ["65%" as const, "55%" as const, "75%" as const];

  return (
    <Animated.View style={[styles.postCard, styles.postCardShadow, { opacity: fadeAnim }]}>
      <View style={styles.skeletonMeta}>
        <View style={[styles.skeletonBar, { width: 60 }]} />
        <View style={[styles.skeletonBar, { width: 44 }]} />
        <View style={[styles.skeletonBar, { width: 32 }]} />
      </View>
      <View style={[styles.skeletonBar, { width: titleWidths[index % 3], height: 18, marginBottom: 10 }]} />
      <View style={[styles.skeletonBar, { width: previewWidths[index % 3], height: 12, marginBottom: 6 }]} />
      <View style={[styles.skeletonBar, { width: "40%", height: 12, marginBottom: 14 }]} />
      <View style={styles.skeletonActions}>
        <View style={[styles.skeletonBar, { width: 36, height: 12 }]} />
        <View style={[styles.skeletonBar, { width: 36, height: 12 }]} />
        <View style={[styles.skeletonBar, { width: 36, height: 12 }]} />
      </View>
    </Animated.View>
  );
}

/* ───── 내 동기방 카드 ───── */

function MyCohortCard({ cohort }: { cohort: MyCohort }) {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <Pressable
        style={({ pressed }) => [
          styles.myCohortCard,
          pressed && { transform: [{ scale: 0.98 }] },
        ]}
        onPress={() =>
          router.push({ pathname: "/community/cohort/[id]", params: { id: cohort.room_id } })
        }
        onPressIn={() =>
          Animated.spring(scaleAnim, { toValue: 0.97, useNativeDriver: true }).start()
        }
        onPressOut={() =>
          Animated.spring(scaleAnim, { toValue: 1, friction: 3, useNativeDriver: true }).start()
        }
      >
        {/* 좌측 아이콘 */}
        <View style={styles.myCohortIcon}>
          <Users size={20} color={colors.gold.DEFAULT} />
        </View>

        <View style={styles.myCohortInfo}>
          <Text style={styles.myCohortName} numberOfLines={1}>
            {cohort.room.name}
          </Text>
          <View style={styles.myCohortMeta}>
            <View style={styles.myCohortActiveDot} />
            <Text style={styles.myCohortMetaText}>
              {cohort.room.member_count}명 참여 중
            </Text>
          </View>
        </View>

        <ChevronRight size={20} color={colors.taupe[400]} />
      </Pressable>
    </Animated.View>
  );
}

/* ───── 동기방 찾기 CTA ───── */

function CohortJoinCTA() {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.cohortCta,
        pressed && { transform: [{ scale: 0.98 }] },
      ]}
      onPress={() => router.push("/community/cohort-discovery")}
    >
      <View style={styles.cohortCtaIcon}>
        <Search size={18} color={colors.rose[500]} />
      </View>
      <View style={styles.cohortCtaTextWrap}>
        <Text style={styles.cohortCtaTitle}>동기방 찾기</Text>
        <Text style={styles.cohortCtaSub}>같은 달에 결혼하는 동기들과 소통하세요</Text>
      </View>
      <ChevronRight size={18} color={colors.taupe[400]} />
    </Pressable>
  );
}

/* ───── 동기방 탐색 수평 스크롤 ───── */

function CohortExploreSection({ rooms }: { rooms: CohortRoom[] }) {
  if (rooms.length === 0) return null;

  return (
    <View style={styles.exploreSection}>
      <View style={styles.exploreTitleRow}>
        <Text style={styles.exploreSectionTitle}>동기방 둘러보기</Text>
        <Pressable
          onPress={() => router.push("/community/cohort-discovery")}
          hitSlop={12}
        >
          <Text style={styles.exploreMore}>전체보기</Text>
        </Pressable>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.exploreScroll}
      >
        {rooms.map((room) => (
          <Pressable
            key={room.id}
            style={({ pressed }) => [
              styles.exploreCard,
              pressed && { transform: [{ scale: 0.97 }] },
            ]}
            onPress={() =>
              router.push({ pathname: "/community/cohort/[id]", params: { id: room.id } })
            }
          >
            <Text style={styles.exploreMonth}>
              {room.year}년 {Math.ceil(room.month / 3)}분기
            </Text>
            <Text style={styles.exploreRoomName} numberOfLines={1}>
              {room.name}
            </Text>
            <View style={styles.exploreStats}>
              <View style={styles.exploreStat}>
                <Users size={12} color={colors.taupe[400]} />
                <Text style={styles.exploreStatText}>{room.member_count}명</Text>
              </View>
              <View style={styles.exploreStat}>
                <MessageCircle size={12} color={colors.taupe[400]} />
                <Text style={styles.exploreStatText}>{room.message_count}</Text>
              </View>
            </View>
            <View style={styles.exploreEnterBtn}>
              <Text style={styles.exploreEnterText}>입장</Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

/* ───── 퀵 액션 바 ───── */

function QuickActionsBar() {
  const actions = [
    {
      icon: <Zap size={14} color={colors.rose[500]} />,
      label: "15초 후기",
      onPress: () => router.push("/community/quick-review"),
    },
    {
      icon: <FileText size={14} color={colors.noir[800]} />,
      label: "내가 쓴 글",
      onPress: () => router.push("/community/my-posts"),
    },
    {
      icon: <Bookmark size={14} color={colors.gold.DEFAULT} />,
      label: "북마크",
      onPress: () => router.push("/community/my-bookmarks"),
    },
  ];

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.quickActionsScroll}
    >
      {actions.map((action) => (
        <Pressable
          key={action.label}
          style={({ pressed }) => [
            styles.quickActionPill,
            pressed && { backgroundColor: colors.ivory[200] },
          ]}
          onPress={action.onPress}
        >
          {action.icon}
          <Text style={styles.quickActionLabel}>{action.label}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

/* ───── 메인 화면 ───── */

export default function CommunityScreen() {
  const [posts, setPosts] = useState<PostItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [category, setCategory] = useState("all");
  const [myCohort, setMyCohort] = useState<MyCohort | null>(null);
  const [cohortRooms, setCohortRooms] = useState<CohortRoom[]>([]);
  const [cohortLoading, setCohortLoading] = useState(true);
  const fabScale = useRef(new Animated.Value(1)).current;

  // 게시글 로드
  const loadPosts = useCallback(async (cat: string) => {
    try {
      setError(false);
      const params = cat === "all" ? "" : `&category=${cat}`;
      const data = await apiJson<{ posts: PostItem[] }>(
        `/api/community/posts?sort=new&limit=30${params}`
      );
      setPosts(data.posts ?? []);
    } catch {
      setPosts([]);
      setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // 동기방 로드
  const loadCohortData = useCallback(async () => {
    try {
      // 내 동기방
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user?.id;

      if (userId) {
        const { data: membership } = await supabase
          .from("cohort_members")
          .select("room_id, room:cohort_rooms(*)")
          .eq("user_id", userId)
          .limit(1)
          .maybeSingle();

        if (membership?.room) {
          setMyCohort({
            room_id: membership.room_id,
            room: membership.room as unknown as CohortRoom,
          });
        }
      }

      // 동기방 목록
      const { data: rooms } = await supabase
        .from("cohort_rooms")
        .select("*")
        .eq("is_active", true)
        .order("year")
        .order("month")
        .limit(10);

      setCohortRooms((rooms as CohortRoom[]) ?? []);
    } catch {
      // 동기방 로드 실패 시 무시
    } finally {
      setCohortLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    loadPosts(category);
  }, [category, loadPosts]);

  useEffect(() => {
    loadCohortData();
  }, [loadCohortData]);

  function handleFabPressIn() {
    Animated.spring(fabScale, { toValue: 0.92, useNativeDriver: true }).start();
  }

  function handleFabPressOut() {
    Animated.spring(fabScale, { toValue: 1, friction: 3, useNativeDriver: true }).start();
  }

  function handleRefresh() {
    setRefreshing(true);
    loadPosts(category);
    loadCohortData();
  }

  /* ── PostCard 렌더 ── */

  function renderPost({ item }: { item: PostItem }) {
    const catLabel = CATEGORY_LABELS[item.category] ?? item.category;
    const preview = item.content.replace(/<[^>]*>/g, "").slice(0, 100);
    const votes = item.upvote_count - item.downvote_count;
    const nickname = item.author?.nickname ?? "익명";
    const hasImage = item.image_urls && item.image_urls.length > 0;

    return (
      <Pressable
        style={({ pressed }) => [
          styles.postCard,
          styles.postCardShadow,
          pressed && { transform: [{ scale: 0.98 }] },
        ]}
        onPress={() =>
          router.push({ pathname: "/community/post/[id]", params: { id: item.id } })
        }
      >
        <View style={styles.postBody}>
          <View style={styles.postBodyLeft}>
            {/* 작성자 아바타 + 메타 */}
            <View style={styles.postMeta}>
              <CommunityAvatar nickname={nickname} role={item.author?.role} size={24} />
              <View style={styles.postCatBadge}>
                <Text style={styles.postCat}>{catLabel}</Text>
              </View>
              <Text style={styles.postDot}>·</Text>
              <Text style={styles.postAuthor}>{nickname}</Text>
              <Text style={styles.postDot}>·</Text>
              <Text style={styles.postTime}>{timeAgo(item.created_at)}</Text>
            </View>

            {/* 제목 */}
            <Text style={styles.postTitle} numberOfLines={2}>
              {item.title}
            </Text>

            {/* 미리보기 */}
            {preview.length > 0 && (
              <Text style={styles.postPreview} numberOfLines={2}>
                {preview}
              </Text>
            )}
          </View>

          {/* 이미지 썸네일 */}
          {hasImage && (
            <View style={styles.postThumbWrap}>
              <Image
                source={{ uri: item.image_urls?.[0] }}
                style={styles.postThumb}
                resizeMode="cover"
              />
            </View>
          )}
        </View>

        {/* 액션 바 */}
        <View style={styles.postActions}>
          <View style={styles.actionGroup}>
            <ChevronUp size={16} color={colors.taupe[400]} />
            <Text style={styles.actionText}>{votes}</Text>
          </View>
          <View style={styles.actionGroup}>
            <MessageCircle size={16} color={colors.taupe[400]} />
            <Text style={styles.actionText}>{item.comment_count}</Text>
          </View>
          <View style={styles.actionGroup}>
            <Eye size={16} color={colors.taupe[400]} />
            <Text style={styles.actionText}>{item.view_count}</Text>
          </View>
        </View>
      </Pressable>
    );
  }

  /* ── 상단 헤더 컨텐츠 (FlatList ListHeaderComponent) ── */

  function renderHeader() {
    return (
      <View>
        {/* 내 동기방 또는 찾기 CTA */}
        <View style={styles.cohortSection}>
          {cohortLoading ? null : myCohort ? (
            <MyCohortCard cohort={myCohort} />
          ) : (
            <CohortJoinCTA />
          )}
        </View>

        {/* 동기방 탐색 */}
        {!cohortLoading && <CohortExploreSection rooms={cohortRooms} />}

        {/* 퀵 액션 바 */}
        <QuickActionsBar />

        {/* 카테고리 칩 */}
        <View style={styles.chipRow}>
          <FlatList
            horizontal
            showsHorizontalScrollIndicator={false}
            data={CATEGORIES}
            keyExtractor={(c) => c}
            contentContainerStyle={{ paddingHorizontal: 20, gap: 8 }}
            renderItem={({ item: cat }) => {
              const active = category === cat;
              return (
                <Pressable
                  style={({ pressed }) => [
                    styles.chip,
                    active && styles.chipActive,
                    pressed && { transform: [{ scale: 0.96 }] },
                  ]}
                  onPress={() => setCategory(cat)}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {cat === "all" ? "전체" : (CATEGORY_LABELS[cat] ?? cat)}
                  </Text>
                  {active && <View style={styles.chipActiveDot} />}
                </Pressable>
              );
            }}
          />
        </View>

        {/* 피드 제목 */}
        <View style={styles.feedTitleRow}>
          <Text style={styles.feedTitle}>게시판</Text>
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      {/* 헤더 */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>커뮤니티</Text>
      </View>

      {/* 피드 */}
      {loading ? (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.feedList}>
          {renderHeader()}
          <SkeletonCard index={0} />
          <SkeletonCard index={1} />
          <SkeletonCard index={2} />
          <SkeletonCard index={3} />
        </ScrollView>
      ) : error ? (
        <View style={{ flex: 1 }}>
          {renderHeader()}
          <ErrorRetry
            message="게시글을 불러올 수 없어요"
            onRetry={() => {
              setLoading(true);
              loadPosts(category);
            }}
          />
        </View>
      ) : (
        <FlatList
          data={posts}
          keyExtractor={(p) => p.id}
          renderItem={renderPost}
          ListHeaderComponent={renderHeader}
          contentContainerStyle={styles.feedList}
          removeClippedSubviews
          maxToRenderPerBatch={10}
          windowSize={5}
          initialNumToRender={10}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={colors.rose[500]}
            />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <View style={styles.emptyIconWrap}>
                <MessageSquarePlus size={40} color={colors.rose[500]} />
              </View>
              <Text style={styles.emptyTitle}>아직 작성된 글이 없어요</Text>
              <Text style={styles.emptyText}>첫 번째 글의 주인공이 되어보세요!</Text>
            </View>
          }
        />
      )}

      {/* 글쓰기 FAB */}
      <Animated.View style={[styles.fab, { transform: [{ scale: fabScale }] }]}>
        <Pressable
          style={styles.fabInner}
          onPress={() => router.push({ pathname: "/community/post/write" })}
          onPressIn={handleFabPressIn}
          onPressOut={handleFabPressOut}
        >
          <PenSquare size={22} color="#FFFFFF" />
        </Pressable>
      </Animated.View>
    </SafeAreaView>
  );
}

/* ───── 스타일 ───── */

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },

  header: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  headerTitle: {
    fontSize: 22,
    fontFamily: "NotoSerifKR_500Medium",
    color: colors.noir[800],
  },

  // 내 동기방 섹션
  cohortSection: { paddingHorizontal: 20, paddingTop: 16 },

  myCohortCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    gap: 14,
    borderWidth: 1,
    borderColor: colors.gold.DEFAULT + "30",
    shadowColor: colors.gold.DEFAULT,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
  myCohortIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: colors.gold.DEFAULT + "15",
    alignItems: "center",
    justifyContent: "center",
  },
  myCohortInfo: { flex: 1 },
  myCohortName: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.noir[800],
    marginBottom: 4,
  },
  myCohortMeta: { flexDirection: "row", alignItems: "center", gap: 6 },
  myCohortActiveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.success,
  },
  myCohortMetaText: { fontSize: 13, color: colors.textSecondary },

  // 동기방 찾기 CTA
  cohortCta: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    gap: 14,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 2,
  },
  cohortCtaIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: colors.rose.glow,
    alignItems: "center",
    justifyContent: "center",
  },
  cohortCtaTextWrap: { flex: 1 },
  cohortCtaTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.noir[800],
    marginBottom: 2,
  },
  cohortCtaSub: { fontSize: 12, color: colors.textSecondary },

  // 동기방 탐색 섹션
  exploreSection: { paddingTop: 20 },
  exploreTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  exploreSectionTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: colors.noir[800],
  },
  exploreMore: {
    fontSize: 13,
    color: colors.rose[500],
    fontWeight: "500",
  },
  exploreScroll: { paddingHorizontal: 20, gap: 12 },
  exploreCard: {
    width: 160,
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  exploreMonth: {
    fontSize: 12,
    fontWeight: "500",
    color: colors.rose[500],
    marginBottom: 4,
  },
  exploreRoomName: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.noir[800],
    marginBottom: 10,
  },
  exploreStats: { flexDirection: "row", gap: 12, marginBottom: 12 },
  exploreStat: { flexDirection: "row", alignItems: "center", gap: 4 },
  exploreStatText: {
    fontSize: 12,
    color: colors.taupe[400],
    fontFamily: "CormorantGaramond_400Regular",
  },
  exploreEnterBtn: {
    backgroundColor: colors.noir[800],
    borderRadius: 10,
    paddingVertical: 8,
    alignItems: "center",
  },
  exploreEnterText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#FFFFFF",
  },

  // 퀵 액션 바
  quickActionsScroll: { paddingHorizontal: 20, paddingTop: 16, gap: 10 },
  quickActionPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  quickActionLabel: {
    fontSize: 13,
    fontWeight: "500",
    color: colors.noir[800],
  },

  // 카테고리 칩
  chipRow: { paddingVertical: 12 },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
  },
  chipActive: {
    backgroundColor: colors.noir[800],
    borderColor: colors.noir[800],
  },
  chipText: { fontSize: 13, color: colors.textSecondary },
  chipTextActive: { color: "#FFFFFF", fontWeight: "600" },
  chipActiveDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.rose[500],
    marginTop: 4,
  },

  // 피드 제목
  feedTitleRow: { paddingHorizontal: 20, paddingBottom: 4 },
  feedTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.textSecondary,
  },

  // 피드 리스트
  feedList: { paddingBottom: 100 },

  // PostCard
  postCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 20,
    padding: 16,
    marginHorizontal: 16,
    marginTop: 12,
  },
  postCardShadow: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 2,
  },
  postBody: { flexDirection: "row", gap: 12 },
  postBodyLeft: { flex: 1 },
  postMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 10,
    flexWrap: "wrap",
  },
  postCatBadge: {
    backgroundColor: colors.rose.glow,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  postCat: { fontSize: 12, fontWeight: "700", color: colors.rose[500] },
  postDot: { fontSize: 12, color: colors.taupe[400] },
  postAuthor: { fontSize: 12, fontWeight: "500", color: colors.noir[800] },
  postTime: { fontSize: 12, color: colors.taupe[400] },

  postTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: colors.noir[800],
    lineHeight: 24,
  },
  postPreview: {
    fontSize: 13,
    color: colors.textTertiary,
    lineHeight: 20,
    marginTop: 6,
  },

  postThumbWrap: {
    width: 72,
    height: 72,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: colors.ivory[200],
  },
  postThumb: {
    width: 72,
    height: 72,
  },

  postActions: {
    flexDirection: "row",
    gap: 16,
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  actionGroup: { flexDirection: "row", alignItems: "center", gap: 4 },
  actionText: {
    fontSize: 12,
    color: colors.taupe[400],
    fontFamily: "CormorantGaramond_400Regular",
  },

  // 빈 상태
  empty: { alignItems: "center", paddingTop: 80, gap: 8 },
  emptyIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.rose.glow,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: colors.noir[800],
    fontFamily: "NotoSerifKR_500Medium",
  },
  emptyText: { fontSize: 14, color: colors.textTertiary },

  // FAB
  fab: {
    position: "absolute",
    right: 20,
    bottom: 100,
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
    backgroundColor: colors.noir[800],
    alignItems: "center",
    justifyContent: "center",
  },

  // 스켈레톤
  skeletonMeta: { flexDirection: "row", gap: 8, marginBottom: 14 },
  skeletonBar: {
    height: 10,
    backgroundColor: colors.ivory[200],
    borderRadius: 6,
  },
  skeletonActions: { flexDirection: "row", gap: 20, marginTop: 4 },
});
