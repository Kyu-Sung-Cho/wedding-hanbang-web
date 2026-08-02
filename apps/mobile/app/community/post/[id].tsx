// 게시글 상세 + 댓글 + 투표/북마크
import { useEffect, useState, useCallback, useRef } from "react";
import {
  View, Text, ScrollView, StyleSheet, Pressable, TextInput,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Animated,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, router, useFocusEffect } from "expo-router";
import { ChevronUp, MessageCircle, Send, Bookmark, FileText } from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";
import { apiFetch, apiJson } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import {
  getCachedCommunityComments,
  getCachedCommunityPost,
  getCommunityCacheOwnerRevision,
  isCommunityCacheOwner,
  putCachedCommunityComments,
  putCachedCommunityPost,
  setCommunityCacheOwner,
  type CachedCommunityPost,
} from "@/lib/communityPostCache";
import {
  CommunityAvatar,
  type CommunityAvatarRole,
} from "@/components/community/CommunityAvatar";
import { AppHeader, EmptyState, LoadingState } from "@/components/ui/AppUI";

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

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "방금";
  if (mins < 60) return `${mins}분 전`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.floor(hours / 24)}일 전`;
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

async function fetchPostFromApi(postId: string): Promise<PostDetail> {
  const data = await apiJson<PostDetail & { user_vote?: number | null; user_bookmarked?: boolean }>(
    `/api/community/posts/${postId}`
  );
  return {
    ...data,
    ad_disclosure: data.ad_disclosure ?? "general",
  };
}

async function fetchCommentsFromApi(postId: string): Promise<Comment[]> {
  const commentsData = await apiJson<{ comments: Comment[] }>(
    `/api/community/comments?postId=${postId}`
  );
  return commentsData.comments ?? [];
}

async function fetchSocialState(postId: string, userId: string): Promise<SocialState> {
  const [voteResult, bookmarkResult] = await Promise.all([
    supabase
      .from("community_votes")
      .select("vote_type")
      .eq("post_id", postId)
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("community_bookmarks")
      .select("id")
      .eq("post_id", postId)
      .eq("user_id", userId)
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
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [authResolved, setAuthResolved] = useState(false);
  const [post, setPost] = useState<PostDetail | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
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

  useEffect(() => {
    let mounted = true;
    let authEventVersion = 0;
    let renderedOwnerId: string | null = null;

    function applyOwner(nextOwnerId: string | null) {
      setCommunityCacheOwner(nextOwnerId);
      if (!mounted) return;

      if (renderedOwnerId !== nextOwnerId) {
        setPost(null);
        setComments([]);
        setCommentText("");
        setUserVote(0);
        setBookmarked(false);
        setActionNotice(null);
        setLoading(Boolean(nextOwnerId));
        setCommentsLoading(false);
        renderedOwnerId = nextOwnerId;
      }
      setViewerId(nextOwnerId);
      setAuthResolved(true);
    }

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      authEventVersion += 1;
      applyOwner(session?.user.id ?? null);
    });

    const versionBeforeSessionRead = authEventVersion;
    const ownerRevisionBeforeSessionRead = getCommunityCacheOwnerRevision();
    void supabase.auth.getSession().then(({ data: sessionData }) => {
      if (
        !mounted
        || authEventVersion !== versionBeforeSessionRead
        || getCommunityCacheOwnerRevision() !== ownerRevisionBeforeSessionRead
      ) return;
      applyOwner(sessionData.session?.user.id ?? null);
    });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

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
    if (!postId || !viewerId || !isCommunityCacheOwner(viewerId)) return;
    if (!options?.silent) setCommentsLoading(true);

    try {
      const nextComments = await fetchCommentsFromApi(postId);

      if (!isCommunityCacheOwner(viewerId)) return;
      setComments(nextComments);
      putCachedCommunityComments(viewerId, postId, nextComments);
    } catch {
      // 댓글 로드 실패는 본문 표시를 막지 않는다.
    } finally {
      if (isCommunityCacheOwner(viewerId)) setCommentsLoading(false);
    }
  }, [postId, viewerId]);

  const refreshAuxiliaryState = useCallback((options?: { silentComments?: boolean }) => {
    if (!postId || !viewerId || !isCommunityCacheOwner(viewerId)) return;

    loadComments({ silent: options?.silentComments });
    fetchSocialState(postId, viewerId)
      .then((state) => {
        if (!isCommunityCacheOwner(viewerId)) return;
        setUserVote(state.userVote);
        setBookmarked(state.bookmarked);
      })
      .catch(() => {});
    apiFetch(`/api/community/posts/${postId}/view`, { method: "POST" }).catch(() => {});
  }, [loadComments, postId, viewerId]);

  const loadPost = useCallback(async () => {
    if (!authResolved) return;
    if (!postId || !viewerId || !isCommunityCacheOwner(viewerId)) {
      setLoading(false);
      return;
    }

    const cachedPost = getCachedCommunityPost(viewerId, postId);
    const cachedComments = getCachedCommunityComments(viewerId, postId);
    const hadCachedPost = Boolean(cachedPost);
    if (cachedComments) {
      setComments(cachedComments);
      setCommentsLoading(false);
    }
    if (cachedPost) {
      setPost(fromCachedPost(cachedPost));
      setLoading(false);
      refreshAuxiliaryState({ silentComments: Boolean(cachedComments) });
    } else {
      setLoading(true);
    }

    try {
      const nextPost = await fetchPostFromApi(postId);

      if (!isCommunityCacheOwner(viewerId)) return;
      setPost(nextPost);
      putCachedCommunityPost(viewerId, toCachedPost(nextPost));
      setLoading(false);

      if (!hadCachedPost) {
        refreshAuxiliaryState({ silentComments: Boolean(cachedComments) });
      }
    } catch {
      if (!isCommunityCacheOwner(viewerId)) return;
      if (!cachedPost) setPost(null);
    } finally {
      if (isCommunityCacheOwner(viewerId)) setLoading(false);
    }
  }, [authResolved, postId, refreshAuxiliaryState, viewerId]);

  useFocusEffect(
    useCallback(() => {
      loadPost();
    }, [loadPost])
  );

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
      const result = await apiJson<unknown>(`/api/community/posts/${postId}/vote`, {
        method: "POST",
        body: JSON.stringify({ voteType: newVote }),
      });
      if (
        typeof result !== "object"
        || result === null
        || !("upvote_count" in result)
        || typeof result.upvote_count !== "number"
        || !Number.isInteger(result.upvote_count)
        || result.upvote_count < 0
      ) {
        throw new Error("COMMUNITY_VOTE_RESPONSE_INVALID");
      }
      const canonicalUpvoteCount = result.upvote_count;
      setPost((current) => current
        ? { ...current, upvote_count: canonicalUpvoteCount, downvote_count: 0 }
        : current);
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
      const result = await apiJson<unknown>(`/api/community/posts/${postId}/bookmark`, { method: "POST" });
      if (
        typeof result !== "object"
        || result === null
        || !("bookmarked" in result)
        || typeof result.bookmarked !== "boolean"
        || !("bookmark_count" in result)
        || typeof result.bookmark_count !== "number"
        || !Number.isInteger(result.bookmark_count)
        || result.bookmark_count < 0
      ) {
        throw new Error("invalid bookmark response");
      }

      setBookmarked(result.bookmarked);
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
        <LoadingState label="게시글을 불러오고 있어요" />
      </SafeAreaView>
    );
  }

  if (!post) {
    return (
      <SafeAreaView style={styles.container}>
        <AppHeader title="게시글" onBack={() => router.back()} />
        <EmptyState
          icon={<FileText size={48} color={colors.textTertiary} />}
          title="게시글을 찾을 수 없어요"
          description="삭제됐거나 접근 권한이 없는 글일 수 있어요."
        />
      </SafeAreaView>
    );
  }

  const votes = post.upvote_count;
  const adBadge = AD_LABELS[post.ad_disclosure];
  const catLabel = CATEGORY_LABELS[post.category] ?? post.category;
  const authorName = post.author?.nickname ?? "익명";

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <AppHeader
        title="게시글"
        onBack={() => router.back()}
        right={
          <Animated.View style={{ transform: [{ scale: bookmarkScale }] }}>
            <Pressable
              onPress={handleBookmark}
              hitSlop={12}
              disabled={bookmarkSyncing}
              style={bookmarkSyncing && styles.actionDisabled}
              accessibilityRole="button"
              accessibilityLabel={bookmarked ? "북마크 해제" : "북마크"}
            >
              <Bookmark
                size={22}
                color={bookmarked ? colors.rose[500] : colors.taupe[400]}
                fill={bookmarked ? colors.rose[500] : "none"}
              />
            </Pressable>
          </Animated.View>
        }
      />

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
  content: { padding: 20, paddingBottom: 40 },

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
