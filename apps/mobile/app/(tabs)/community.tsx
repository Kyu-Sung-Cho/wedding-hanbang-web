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
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";
import {
  MessageCircle,
  ChevronUp,
  Eye,
  MessageSquarePlus,
  Bookmark,
  FileText,
} from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";
import { communityHtmlToPlainText } from "@hanbang/shared";
import { apiJson } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import {
  getCachedCommunityFeed,
  putCachedCommunityPost,
  putCachedCommunityFeed,
  putCachedCommunityPosts,
} from "@/lib/communityPostCache";
import ErrorRetry from "@/components/ErrorRetry";
import { CommunityAvatar } from "@/components/community/CommunityAvatar";
import {
  hasTrustedCommunityActor,
  type MobileCommunityAuthor,
} from "@/lib/communityPublicPayload";

/* ───── 타입 ───── */

interface PostItem {
  id: string;
  author_id: string;
  viewer_is_author: boolean;
  title: string;
  content: string;
  category: string;
  ad_disclosure?: string | null;
  upvote_count: number;
  downvote_count: number;
  comment_count: number;
  view_count: number;
  visibility: "public" | "members" | "draft";
  under_review: boolean;
  created_at: string;
  author: MobileCommunityAuthor;
}

type ApiPostItem = PostItem;

/* ───── 상수 ───── */

const CATEGORY_LABELS: Record<string, string> = {
  is_normal: "계약·추가금 질문",
  tour_review: "투어/후기",
  tips_v2: "꿀팁",
  ama: "AMA",
  free: "자유",
};
const AD_LABELS: Record<string, string> = {
  sponsored: "협찬",
  ad: "광고",
};

const CATEGORIES = ["all", "is_normal", "tour_review", "tips_v2", "ama", "free"];
const POSTS_INITIAL_LIMIT = 12;

async function fetchPostsFromApi(cat: string): Promise<PostItem[]> {
  const params = cat === "all" ? "" : `&category=${cat}`;
  const data = await apiJson<{ posts: PostItem[] }>(
    `/api/community/posts?sort=new&limit=${POSTS_INITIAL_LIMIT}${params}`
  );
  const posts = data.posts ?? [];
  if (!Array.isArray(posts) || !posts.every(hasTrustedCommunityActor)) {
    throw new Error("community_actor_payload_invalid");
  }
  return posts as ApiPostItem[];
}

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

function QuickActionsBar() {
  const actions = [
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
  const [cacheOwnerId, setCacheOwnerId] = useState<string | null>(null);
  const [posts, setPosts] = useState<PostItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [ownerRetryNonce, setOwnerRetryNonce] = useState(0);
  const [category, setCategory] = useState("all");
  const hasFocusedRef = useRef(false);

  useEffect(() => {
    let active = true;

    void supabase.auth.getUser()
      .then(({ data: { user }, error: authError }) => {
        if (authError || !user) {
          throw authError ?? new Error("authenticated user not found");
        }
        if (!active) return;

        setCacheOwnerId(user.id);
      })
      .catch(() => {
        if (!active) return;
        setPosts([]);
        setError(true);
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [ownerRetryNonce]);

  // 게시글 로드
  const loadPosts = useCallback(async (
    ownerId: string,
    cat: string,
    options?: { silent?: boolean },
  ) => {
    try {
      setError(false);
      const nextPosts = await fetchPostsFromApi(cat);

      putCachedCommunityFeed(ownerId, cat, nextPosts);
      putCachedCommunityPosts(ownerId, nextPosts);
      setPosts(nextPosts);
    } catch {
      if (!options?.silent) setPosts([]);
      setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // 동기방 로드
  useEffect(() => {
    if (!cacheOwnerId) return;

    const cachedPosts = getCachedCommunityFeed<PostItem>(cacheOwnerId, category);
    if (cachedPosts) {
      setPosts(cachedPosts);
      setLoading(false);
      setError(false);
      loadPosts(cacheOwnerId, category, { silent: true });
      return;
    }

    setLoading(true);
    loadPosts(cacheOwnerId, category);
  }, [cacheOwnerId, category, loadPosts]);

  useFocusEffect(
    useCallback(() => {
      if (!cacheOwnerId) return;
      if (!hasFocusedRef.current) {
        hasFocusedRef.current = true;
        return;
      }

      loadPosts(cacheOwnerId, category, { silent: true });
    }, [cacheOwnerId, category, loadPosts])
  );

  function handleRefresh() {
    if (!cacheOwnerId) return;
    setRefreshing(true);
    loadPosts(cacheOwnerId, category);
  }

  /* ── PostCard 렌더 ── */

  function renderPost({ item }: { item: PostItem }) {
    const catLabel = CATEGORY_LABELS[item.category] ?? item.category;
    const preview = communityHtmlToPlainText(item.content).slice(0, 100);
    const votes = item.upvote_count - item.downvote_count;
    const nickname = item.author.nickname;
    const adLabel = AD_LABELS[item.ad_disclosure ?? "general"];

    return (
      <Pressable
        style={({ pressed }) => [
          styles.postCard,
          styles.postCardShadow,
          pressed && { transform: [{ scale: 0.98 }] },
        ]}
        onPress={() => {
          if (cacheOwnerId) putCachedCommunityPost(cacheOwnerId, item);
          router.push({ pathname: "/community/post/[id]", params: { id: item.id } });
        }}
      >
        <View style={styles.postBody}>
          <View style={styles.postBodyLeft}>
            {/* 작성자 아바타 + 메타 */}
            <View style={styles.postMeta}>
              <CommunityAvatar
                nickname={nickname}
                avatarUrl={item.author.avatar_url}
                size={24}
              />
              {adLabel && (
                <View style={styles.postAdBadge}>
                  <Text style={styles.postAdText}>{adLabel}</Text>
                </View>
              )}
              <View style={styles.postCatBadge}>
                <Text style={styles.postCat}>{catLabel}</Text>
              </View>
              <Text style={styles.postDot}>·</Text>
              <Text style={styles.postAuthor} numberOfLines={1}>{nickname}</Text>
              <Text style={styles.postDot}>·</Text>
              <Text style={styles.postTime} numberOfLines={1}>{timeAgo(item.created_at)}</Text>
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
              setError(false);
              if (cacheOwnerId) {
                loadPosts(cacheOwnerId, category);
              } else {
                setOwnerRetryNonce((value) => value + 1);
              }
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
              <Text style={styles.emptyText}>새 글이 등록되면 여기에서 확인할 수 있어요.</Text>
            </View>
          }
        />
      )}

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
  quickActionsScroll: { paddingHorizontal: 20, paddingTop: 14, gap: 10 },
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
  chipRow: { paddingVertical: 10 },
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
    fontSize: 16,
    fontWeight: "700",
    color: colors.noir[800],
  },

  // 피드 리스트
  feedList: { paddingBottom: 144 },

  // PostCard
  postCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 18,
    padding: 15,
    marginHorizontal: 18,
    marginTop: 10,
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
    flexWrap: "wrap",
    alignItems: "center",
    gap: 6,
    marginBottom: 10,
  },
  postCatBadge: {
    backgroundColor: colors.rose.glow,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  postCat: { fontSize: 12, fontWeight: "700", color: colors.rose[500] },
  postAdBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.danger,
    backgroundColor: "rgba(217,95,95,0.08)",
  },
  postAdText: { fontSize: 11, fontWeight: "700", color: colors.danger },
  postDot: { fontSize: 12, color: colors.taupe[400] },
  postAuthor: {
    fontSize: 12,
    fontWeight: "500",
    color: colors.noir[800],
    flexShrink: 1,
    maxWidth: 110,
  },
  postTime: { fontSize: 12, color: colors.taupe[400], flexShrink: 0 },

  postTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.noir[800],
    lineHeight: 23,
  },
  postPreview: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 22,
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
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  actionGroup: { flexDirection: "row", alignItems: "center", gap: 4 },
  actionText: {
    fontSize: 12,
    color: colors.textSecondary,
    fontFamily: "NotoSansKR_500Medium",
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

  // 스켈레톤
  skeletonMeta: { flexDirection: "row", gap: 8, marginBottom: 14 },
  skeletonBar: {
    height: 10,
    backgroundColor: colors.ivory[200],
    borderRadius: 6,
  },
  skeletonActions: { flexDirection: "row", gap: 20, marginTop: 4 },
});
