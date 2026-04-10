// 커뮤니티 피드 — 게시글 목록 (5개 게시판)
import { useEffect, useState, useCallback, useRef } from "react";
import {
  View, Text, FlatList, StyleSheet, Pressable, RefreshControl, Animated,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { MessageCircle, ChevronUp, Eye, PenSquare, MessageSquarePlus } from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";
import { apiJson } from "@/lib/api";

interface PostItem {
  id: string;
  title: string;
  content: string;
  category: string;
  upvote_count: number;
  downvote_count: number;
  comment_count: number;
  view_count: number;
  created_at: string;
  author: { nickname: string; rank: string } | null;
}

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

// 로딩 스켈레톤 카드 — 다양한 너비로 실감나게
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

export default function CommunityScreen() {
  const [posts, setPosts] = useState<PostItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [category, setCategory] = useState("all");
  const fabScale = useRef(new Animated.Value(1)).current;

  const loadPosts = useCallback(async (cat: string) => {
    try {
      const params = cat === "all" ? "" : `&category=${cat}`;
      const data = await apiJson<{ posts: PostItem[] }>(
        `/api/community/posts?sort=new&limit=30${params}`
      );
      setPosts(data.posts ?? []);
    } catch (err) {
      // API 에러 시 조용히 빈 리스트 — 크래시 방지
      setPosts([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    loadPosts(category);
  }, [category, loadPosts]);

  function handleFabPressIn() {
    Animated.spring(fabScale, {
      toValue: 0.92,
      useNativeDriver: true,
    }).start();
  }

  function handleFabPressOut() {
    Animated.spring(fabScale, {
      toValue: 1,
      friction: 3,
      useNativeDriver: true,
    }).start();
  }

  function renderPost({ item }: { item: PostItem }) {
    const catLabel = CATEGORY_LABELS[item.category] ?? item.category;
    const preview = item.content.replace(/<[^>]*>/g, "").slice(0, 100);
    const votes = item.upvote_count - item.downvote_count;

    return (
      <Pressable
        style={({ pressed }) => [
          styles.postCard,
          styles.postCardShadow,
          pressed && { transform: [{ scale: 0.98 }] },
        ]}
        onPress={() => router.push(`/community/post/${item.id}` as never)}
      >
        {/* 메타 */}
        <View style={styles.postMeta}>
          <View style={styles.postCatBadge}>
            <Text style={styles.postCat}>{catLabel}</Text>
          </View>
          <Text style={styles.postDot}>·</Text>
          <Text style={styles.postAuthor}>{item.author?.nickname ?? "익명"}</Text>
          <Text style={styles.postDot}>·</Text>
          <Text style={styles.postTime}>{timeAgo(item.created_at)}</Text>
        </View>

        {/* 제목 */}
        <Text style={styles.postTitle} numberOfLines={2}>{item.title}</Text>

        {/* 미리보기 */}
        {preview.length > 0 && (
          <Text style={styles.postPreview} numberOfLines={2}>{preview}</Text>
        )}

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

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      {/* 헤더 */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>커뮤니티</Text>
      </View>

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

      {/* 피드 */}
      {loading ? (
        <View style={styles.feedList}>
          <SkeletonCard index={0} />
          <SkeletonCard index={1} />
          <SkeletonCard index={2} />
          <SkeletonCard index={3} />
        </View>
      ) : (
        <FlatList
          data={posts}
          keyExtractor={(p) => p.id}
          renderItem={renderPost}
          contentContainerStyle={styles.feedList}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); loadPosts(category); }}
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
          onPress={() => router.push("/community/post/write" as never)}
          onPressIn={handleFabPressIn}
          onPressOut={handleFabPressOut}
        >
          <PenSquare size={22} color="#FFFFFF" />
        </Pressable>
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    fontSize: 22,
    fontFamily: "NotoSerifKR_500Medium",
    color: colors.noir[800],
  },

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

  feedList: { padding: 16, gap: 12, paddingBottom: 100 },

  postCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 20,
    padding: 16,
  },
  postCardShadow: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 2,
  },
  postMeta: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 },
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

  postActions: { flexDirection: "row", gap: 16, marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border },
  actionGroup: { flexDirection: "row", alignItems: "center", gap: 4 },
  actionText: { fontSize: 12, color: colors.taupe[400], fontFamily: "CormorantGaramond_400Regular" },

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
