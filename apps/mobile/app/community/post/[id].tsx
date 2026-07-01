// 게시글 상세 + 댓글 + 투표/북마크
import { useEffect, useState, useCallback, useRef } from "react";
import {
  View, Text, ScrollView, StyleSheet, Pressable, TextInput,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Animated,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, router } from "expo-router";
import { ArrowLeft, ChevronUp, MessageCircle, Send, Bookmark, FileText } from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";
import { apiFetch, apiJson } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import {
  getCachedCommunityComments,
  getCachedCommunityPost,
  putCachedCommunityComments,
  putCachedCommunityPost,
  type CachedCommunityComment,
  type CachedCommunityPost,
} from "@/lib/communityPostCache";
import {
  CommunityAvatar,
  type CommunityAvatarRole,
} from "@/components/community/CommunityAvatar";

interface PostDetail {
  id: string;
  title: string;
  content: string;
  category: string;
  ad_disclosure: string;
  upvote_count: number;
  downvote_count: number;
  comment_count: number;
  view_count: number;
  created_at: string;
  author: { nickname: string; rank: string; role?: CommunityAvatarRole | null } | null;
}

interface Comment {
  id: string;
  content: string;
  created_at: string;
  author: { nickname: string; rank: string; role?: CommunityAvatarRole | null } | null;
}

type CommunityPostRow = {
  id: string;
  author_id: string | null;
  category: string;
  title: string;
  content: string;
  ad_disclosure: string | null;
  visibility: string | null;
  under_review: boolean | null;
  upvote_count: number | null;
  downvote_count: number | null;
  comment_count: number | null;
  view_count: number | null;
  created_at: string;
};

type CommunityCommentRow = {
  id: string;
  author_id: string | null;
  content: string;
  created_at: string;
};

type CommunityAuthorRow = {
  user_id: string;
  nickname: string | null;
  rank: string | null;
};

type SocialState = {
  userVote: number;
  bookmarked: boolean;
};

const AD_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  sponsored: { label: "협찬", color: "#EAB308", bg: "rgba(234,179,8,0.12)" },
  ad: { label: "광고", color: "#EF4444", bg: "rgba(239,68,68,0.12)" },
};

const CATEGORY_LABELS: Record<string, string> = {
  is_normal: "이거 정상이야?",
  tour_review: "투어/후기",
  tips_v2: "꿀팁",
  ama: "AMA",
  free: "자유",
};

const MOBILE_POST_DETAIL_SELECT =
  "id, author_id, category, title, content, ad_disclosure, visibility, under_review, upvote_count, downvote_count, comment_count, view_count, created_at" as const;

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "방금";
  if (mins < 60) return `${mins}분 전`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.floor(hours / 24)}일 전`;
}

function readablePostOrFilter(viewerId: string): string {
  return [
    "and(visibility.eq.public,under_review.eq.false)",
    "and(visibility.eq.members,under_review.eq.false)",
    `and(visibility.eq.draft,author_id.eq.${viewerId})`,
    `and(under_review.eq.true,author_id.eq.${viewerId})`,
  ].join(",");
}

function canReadPost(row: CommunityPostRow, userId: string | null) {
  const isAuthor = Boolean(userId && row.author_id === userId);
  if (row.under_review === true) return isAuthor;
  if (row.visibility === "public") return true;
  if (row.visibility === "members") return Boolean(userId);
  if (row.visibility === "draft") return isAuthor;
  return false;
}

function fallbackAuthor(): PostDetail["author"] {
  return { nickname: "익명", rank: "sprout", role: null };
}

function fromCachedPost(post: CachedCommunityPost): PostDetail {
  return {
    ...post,
    ad_disclosure: post.ad_disclosure ?? "general",
  };
}

function toCachedPost(post: PostDetail): CachedCommunityPost {
  return {
    id: post.id,
    title: post.title,
    content: post.content,
    category: post.category,
    ad_disclosure: post.ad_disclosure,
    upvote_count: post.upvote_count,
    downvote_count: post.downvote_count,
    comment_count: post.comment_count,
    view_count: post.view_count,
    created_at: post.created_at,
    author: post.author,
  };
}

async function fetchAuthorMap(authorIds: string[]) {
  if (authorIds.length === 0) return {};

  const { data } = await supabase
    .from("community_profiles")
    .select("user_id, nickname, rank")
    .in("user_id", authorIds);

  return Object.fromEntries(
    ((data ?? []) as CommunityAuthorRow[]).map((author) => [
      author.user_id,
      {
        nickname: author.nickname ?? "익명",
        rank: author.rank ?? "sprout",
        role: null,
      },
    ])
  ) as Record<string, PostDetail["author"]>;
}

async function fetchPostFromApi(postId: string): Promise<PostDetail> {
  const data = await apiJson<PostDetail & { user_vote?: number | null; user_bookmarked?: boolean }>(
    `/api/community/posts/${postId}`
  );
  return {
    ...data,
    ad_disclosure: data.ad_disclosure ?? "general",
  };
}

async function fetchPostFromSupabase(postId: string): Promise<PostDetail> {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user?.id ?? null;

  let query = supabase
    .from("community_posts")
    .select(MOBILE_POST_DETAIL_SELECT)
    .eq("id", postId);

  query = userId
    ? query.or(readablePostOrFilter(userId))
    : query.eq("visibility", "public").eq("under_review", false);

  const { data, error } = await query.maybeSingle();
  if (error || !data) {
    throw error ?? new Error("post not found");
  }

  const row = data as CommunityPostRow;
  if (!canReadPost(row, userId)) {
    throw new Error("post not readable");
  }

  const authorMap = await fetchAuthorMap(row.author_id ? [row.author_id] : []);

  return {
    id: row.id,
    title: row.title,
    content: row.content,
    category: row.category,
    ad_disclosure: row.ad_disclosure ?? "general",
    upvote_count: row.upvote_count ?? 0,
    downvote_count: row.downvote_count ?? 0,
    comment_count: row.comment_count ?? 0,
    view_count: row.view_count ?? 0,
    created_at: row.created_at,
    author: row.author_id ? (authorMap[row.author_id] ?? fallbackAuthor()) : fallbackAuthor(),
  };
}

async function fetchCommentsFromApi(postId: string): Promise<Comment[]> {
  const commentsData = await apiJson<{ comments: Comment[] }>(
    `/api/community/comments?postId=${postId}`
  );
  return commentsData.comments ?? [];
}

async function fetchCommentsFromSupabase(postId: string): Promise<Comment[]> {
  const { data, error } = await supabase
    .from("community_comments")
    .select("id, author_id, content, created_at")
    .eq("post_id", postId)
    .eq("is_deleted", false)
    .is("parent_id", null)
    .order("created_at", { ascending: true });

  if (error) throw error;

  const rows = (data ?? []) as CommunityCommentRow[];
  const authorIds = [
    ...new Set(rows.map((comment) => comment.author_id).filter((id): id is string => Boolean(id))),
  ];
  const authorMap = await fetchAuthorMap(authorIds);

  return rows.map((comment) => ({
    id: comment.id,
    content: comment.content,
    created_at: comment.created_at,
    author: comment.author_id ? (authorMap[comment.author_id] ?? fallbackAuthor()) : fallbackAuthor(),
  }));
}

async function fetchSocialState(postId: string): Promise<SocialState> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { userVote: 0, bookmarked: false };

  const [voteResult, bookmarkResult] = await Promise.all([
    supabase
      .from("community_votes")
      .select("vote_type")
      .eq("post_id", postId)
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("community_bookmarks")
      .select("id")
      .eq("post_id", postId)
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  return {
    userVote: voteResult.data?.vote_type ?? 0,
    bookmarked: Boolean(bookmarkResult.data),
  };
}

export default function PostDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const postId = typeof id === "string" ? id : "";
  const initialPostRef = useRef<CachedCommunityPost | null>(
    postId ? getCachedCommunityPost(postId) : null
  );
  const initialCommentsRef = useRef<CachedCommunityComment[] | null>(
    postId ? getCachedCommunityComments(postId) : null
  );

  const [post, setPost] = useState<PostDetail | null>(() =>
    initialPostRef.current ? fromCachedPost(initialPostRef.current) : null
  );
  const [comments, setComments] = useState<Comment[]>(() => initialCommentsRef.current ?? []);
  const [loading, setLoading] = useState(() => !initialPostRef.current);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [commentFocused, setCommentFocused] = useState(false);
  const [voteSyncing, setVoteSyncing] = useState(false);
  const [bookmarkSyncing, setBookmarkSyncing] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  // 투표 상태: 1 = upvote, -1 = downvote, 0 = none
  const [userVote, setUserVote] = useState<number>(0);
  // 북마크 상태
  const [bookmarked, setBookmarked] = useState(false);

  // 애니메이션
  const upScale = useRef(new Animated.Value(1)).current;
  const bookmarkScale = useRef(new Animated.Value(1)).current;
  const actionNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (actionNoticeTimerRef.current) {
      clearTimeout(actionNoticeTimerRef.current);
    }
  }, []);

  function showActionNotice(message: string) {
    setActionNotice(message);
    if (actionNoticeTimerRef.current) {
      clearTimeout(actionNoticeTimerRef.current);
    }
    actionNoticeTimerRef.current = setTimeout(() => {
      setActionNotice(null);
      actionNoticeTimerRef.current = null;
    }, 3500);
  }

  const loadComments = useCallback(async (options?: { silent?: boolean }) => {
    if (!postId) return;
    if (!options?.silent) setCommentsLoading(true);

    try {
      let nextComments: Comment[];
      try {
        nextComments = await fetchCommentsFromSupabase(postId);
      } catch {
        nextComments = await fetchCommentsFromApi(postId);
      }

      setComments(nextComments);
      putCachedCommunityComments(postId, nextComments);
    } catch {
      // 댓글 로드 실패는 본문 표시를 막지 않는다.
    } finally {
      setCommentsLoading(false);
    }
  }, [postId]);

  const loadPost = useCallback(async () => {
    if (!postId) {
      setLoading(false);
      return;
    }

    const cachedPost = getCachedCommunityPost(postId);
    if (cachedPost) {
      setPost(fromCachedPost(cachedPost));
      setLoading(false);
    } else {
      setLoading(true);
    }

    try {
      let nextPost: PostDetail;
      try {
        nextPost = await fetchPostFromSupabase(postId);
      } catch {
        nextPost = await fetchPostFromApi(postId);
      }

      setPost(nextPost);
      putCachedCommunityPost(toCachedPost(nextPost));
      setLoading(false);

      apiFetch(`/api/community/posts/${postId}/view`, { method: "POST" }).catch(() => {});
      loadComments({ silent: Boolean(initialCommentsRef.current) });
      fetchSocialState(postId)
        .then((state) => {
          setUserVote(state.userVote);
          setBookmarked(state.bookmarked);
        })
        .catch(() => {});
    } catch {
      if (!cachedPost) setPost(null);
    } finally {
      setLoading(false);
    }
  }, [loadComments, postId]);

  useEffect(() => { loadPost(); }, [loadPost]);

  function animatePress(scaleRef: Animated.Value) {
    Animated.sequence([
      Animated.timing(scaleRef, { toValue: 1.3, duration: 100, useNativeDriver: true }),
      Animated.spring(scaleRef, { toValue: 1, friction: 3, useNativeDriver: true }),
    ]).start();
  }

  // 투표 처리
  async function handleVote() {
    if (!post || voteSyncing) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      Alert.alert("로그인 필요", "투표하려면 로그인이 필요합니다.");
      return;
    }

    animatePress(upScale);

    const newVote = userVote === 1 ? 0 : 1;
    const prevVote = userVote;
    const prevPost = post;

    // 낙관적 업데이트
    setVoteSyncing(true);
    setUserVote(newVote);
    setPost((prev) => {
      if (!prev) return prev;
      let up = prev.upvote_count;
      if (prevVote === 1) up--;
      if (newVote === 1) up++;
      return { ...prev, upvote_count: Math.max(0, up), downvote_count: 0 };
    });

    try {
      await supabase.rpc("community_vote_post", {
        p_user_id: user.id,
        p_post_id: postId,
        p_vote_type: newVote,
      });
    } catch {
      setUserVote(prevVote);
      setPost(prevPost);
      showActionNotice("좋아요를 저장하지 못했어요. 연결을 확인하고 다시 시도해주세요.");
      loadPost();
    } finally {
      setVoteSyncing(false);
    }
  }

  // 북마크 처리
  async function handleBookmark() {
    if (bookmarkSyncing) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      Alert.alert("로그인 필요", "북마크하려면 로그인이 필요합니다.");
      return;
    }

    animatePress(bookmarkScale);

    const wasBookmarked = bookmarked;
    setBookmarkSyncing(true);
    setBookmarked(!wasBookmarked);

    try {
      if (wasBookmarked) {
        await supabase
          .from("community_bookmarks")
          .delete()
          .eq("post_id", postId)
          .eq("user_id", user.id);
      } else {
        await supabase
          .from("community_bookmarks")
          .upsert({ post_id: postId, user_id: user.id });
      }
    } catch {
      setBookmarked(wasBookmarked);
      showActionNotice("북마크를 저장하지 못했어요. 연결을 확인하고 다시 시도해주세요.");
    } finally {
      setBookmarkSyncing(false);
    }
  }

  async function handleComment() {
    if (!commentText.trim() || submitting) return;
    setSubmitting(true);
    try {
      const res = await apiFetch("/api/community/comments", {
        method: "POST",
        body: JSON.stringify({ post_id: postId, content: commentText.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "댓글 작성에 실패했어요.");
      }
      setCommentText("");
      setPost((prev) =>
        prev ? { ...prev, comment_count: prev.comment_count + 1 } : prev
      );
      loadComments();
    } catch {
      showActionNotice("댓글 작성에 실패했어요. 입력한 내용은 유지했으니 다시 시도해주세요.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={colors.rose[500]} style={{ marginTop: 40 }} />
      </SafeAreaView>
    );
  }

  if (!post) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()}><ArrowLeft size={24} color={colors.noir[800]} /></Pressable>
          <Text style={styles.headerTitle}>게시글</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.notFoundWrap}>
          <FileText size={48} color={colors.textTertiary} />
          <Text style={styles.notFoundText}>게시글을 찾을 수 없어요</Text>
        </View>
      </SafeAreaView>
    );
  }

  const votes = post.upvote_count;
  const adBadge = AD_LABELS[post.ad_disclosure];
  const catLabel = CATEGORY_LABELS[post.category] ?? post.category;
  const authorName = post.author?.nickname ?? "익명";

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      {/* 헤더 */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <ArrowLeft size={24} color={colors.noir[800]} />
        </Pressable>
        <Text style={styles.headerTitle}>게시글</Text>
        <Animated.View style={{ transform: [{ scale: bookmarkScale }] }}>
          <Pressable
            onPress={handleBookmark}
            hitSlop={12}
            disabled={bookmarkSyncing}
            style={bookmarkSyncing && styles.actionDisabled}
          >
            <Bookmark
              size={22}
              color={bookmarked ? colors.rose[500] : colors.taupe[400]}
              fill={bookmarked ? colors.rose[500] : "none"}
            />
          </Pressable>
        </Animated.View>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
          {/* 광고 배지 */}
          {adBadge && (
            <View style={[styles.adBadge, { backgroundColor: adBadge.bg, borderColor: adBadge.color + "40" }]}>
              <View style={[styles.adDot, { backgroundColor: adBadge.color }]} />
              <Text style={[styles.adText, { color: adBadge.color }]}>{adBadge.label}</Text>
            </View>
          )}

          {/* 카테고리 */}
          <View style={styles.catBadge}>
            <Text style={styles.catBadgeText}>{catLabel}</Text>
          </View>

          {/* 제목 */}
          <Text style={styles.title}>{post.title}</Text>

          {/* 작성자 섹션 — 아바타 포함 */}
          <View style={styles.authorSection}>
            <CommunityAvatar nickname={authorName} role={post.author?.role} size={40} />
            <View style={{ flex: 1 }}>
              <Text style={styles.authorName}>{authorName}</Text>
              <View style={styles.meta}>
                <Text style={styles.time}>{timeAgo(post.created_at)}</Text>
                <Text style={styles.dot}>·</Text>
                <Text style={styles.time}>조회 {post.view_count}</Text>
              </View>
            </View>
          </View>

          {/* 본문 */}
          <Text style={styles.body}>{post.content.replace(/<[^>]*>/g, "")}</Text>

          {/* 액션 바 */}
          <View style={styles.actions}>
            <View style={styles.voteGroup}>
              <Animated.View style={{ transform: [{ scale: upScale }] }}>
                <Pressable
                  onPress={handleVote}
                  hitSlop={8}
                  disabled={voteSyncing}
                  style={[
                    styles.voteBtn,
                    userVote === 1 && styles.voteBtnActive,
                    voteSyncing && styles.actionDisabled,
                  ]}
                >
                  <ChevronUp
                    size={20}
                    color={userVote === 1 ? colors.rose[500] : colors.taupe[400]}
                  />
                </Pressable>
              </Animated.View>
              <Text style={[
                styles.voteCount,
                userVote === 1 && { color: colors.rose[500] },
              ]}>{votes}</Text>
            </View>
            <View style={styles.actionGroup}>
              <MessageCircle size={18} color={colors.taupe[400]} />
              <Text style={styles.actionLabel}>댓글 {post.comment_count}</Text>
            </View>
          </View>

          {/* 댓글 목록 */}
          {actionNotice ? (
            <View style={styles.actionNotice}>
              <Text style={styles.actionNoticeText}>{actionNotice}</Text>
            </View>
          ) : null}

          <View style={styles.commentsSection}>
            <Text style={styles.commentsTitle}>댓글 {comments.length}개</Text>
            {commentsLoading && comments.length === 0 && (
              <View style={styles.commentsLoadingWrap}>
                <ActivityIndicator size="small" color={colors.rose[500]} />
                <Text style={styles.commentsLoadingText}>댓글을 불러오는 중이에요</Text>
              </View>
            )}
            {comments.map((c) => {
              const cName = c.author?.nickname ?? "익명";
              return (
                <View key={c.id} style={styles.commentCard}>
                  <View style={styles.commentHeader}>
                    <CommunityAvatar nickname={cName} role={c.author?.role} size={30} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.commentAuthor}>{cName}</Text>
                      <Text style={styles.commentTime}>{timeAgo(c.created_at)}</Text>
                    </View>
                  </View>
                  <Text style={styles.commentBody}>{c.content}</Text>
                </View>
              );
            })}
            {!commentsLoading && comments.length === 0 && (
              <View style={styles.noCommentsWrap}>
                <MessageCircle size={28} color={colors.textTertiary} />
                <Text style={styles.noComments}>아직 댓글이 없어요. 첫 댓글을 남겨보세요!</Text>
              </View>
            )}
          </View>
        </ScrollView>

        {/* 댓글 입력 */}
        <View style={[styles.commentBar, { paddingBottom: Math.max(12, insets.bottom + 8) }]}>
          <TextInput
            style={[
              styles.commentInput,
              commentFocused && styles.commentInputFocused,
            ]}
            value={commentText}
            onChangeText={setCommentText}
            placeholder="댓글을 입력하세요..."
            placeholderTextColor={colors.taupe[400]}
            maxLength={1000}
            onFocus={() => setCommentFocused(true)}
            onBlur={() => setCommentFocused(false)}
          />
          <Pressable
            style={({ pressed }) => [
              styles.sendBtn,
              (!commentText.trim() || submitting) && { opacity: 0.4 },
              pressed && { transform: [{ scale: 0.92 }] },
            ]}
            onPress={handleComment}
            disabled={!commentText.trim() || submitting}
          >
            {submitting ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <Send size={18} color="#FFF" />
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
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
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: colors.noir[800],
    fontFamily: "NotoSerifKR_500Medium",
  },
  content: { padding: 20, paddingBottom: 40 },

  notFoundWrap: { alignItems: "center", paddingTop: 80, gap: 12 },
  notFoundText: { fontSize: 15, color: colors.textTertiary },

  adBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 12,
  },
  adDot: { width: 7, height: 7, borderRadius: 4 },
  adText: { fontSize: 13, fontWeight: "700" },

  catBadge: {
    alignSelf: "flex-start",
    backgroundColor: colors.rose.glow,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    marginBottom: 12,
  },
  catBadgeText: { fontSize: 13, fontWeight: "600", color: colors.rose[500] },

  title: {
    fontSize: 24,
    fontWeight: "700",
    color: colors.noir[800],
    lineHeight: 34,
    marginBottom: 16,
    fontFamily: "NotoSerifKR_500Medium",
  },

  authorSection: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 24,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  authorName: { fontSize: 15, fontWeight: "600", color: colors.noir[800] },
  meta: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  dot: { fontSize: 12, color: colors.taupe[400] },
  time: { fontSize: 13, color: colors.taupe[400] },

  body: { fontSize: 15, color: colors.noir[800], lineHeight: 28, marginBottom: 24 },

  actions: {
    flexDirection: "row",
    gap: 20,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    alignItems: "center",
  },
  voteGroup: { flexDirection: "row", alignItems: "center", gap: 4 },
  voteBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.ivory[100],
  },
  voteBtnActive: { backgroundColor: colors.rose.glow },
  actionGroup: { flexDirection: "row", alignItems: "center", gap: 6 },
  voteCount: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.noir[800],
    minWidth: 24,
    textAlign: "center",
    fontFamily: "CormorantGaramond_600SemiBold",
  },
  actionLabel: { fontSize: 13, color: colors.taupe[400] },
  actionDisabled: { opacity: 0.55 },
  actionNotice: {
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.rose.glow,
    backgroundColor: colors.ivory[100],
  },
  actionNoticeText: {
    fontSize: 13,
    lineHeight: 19,
    color: colors.noir[800],
  },

  commentsSection: { marginTop: 24 },
  commentsTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.noir[800],
    marginBottom: 16,
  },
  commentCard: {
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  commentHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 8,
  },
  commentAuthor: { fontSize: 14, fontWeight: "700", color: colors.noir[800] },
  commentTime: { fontSize: 11, color: colors.taupe[400], marginTop: 1 },
  commentBody: { fontSize: 14, color: colors.noir[800], lineHeight: 22, marginLeft: 40 },
  noCommentsWrap: {
    alignItems: "center",
    paddingVertical: 32,
    gap: 8,
  },
  noComments: { fontSize: 13, color: colors.textTertiary, textAlign: "center" },
  commentsLoadingWrap: {
    alignItems: "center",
    paddingVertical: 28,
    gap: 8,
  },
  commentsLoadingText: { fontSize: 13, color: colors.textTertiary },

  commentBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  commentInput: {
    flex: 1,
    minHeight: 40,
    maxHeight: 100,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.noir[800],
    backgroundColor: colors.bg,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  commentInputFocused: {
    borderColor: colors.rose[500],
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.rose[500],
    alignItems: "center",
    justifyContent: "center",
  },
});
