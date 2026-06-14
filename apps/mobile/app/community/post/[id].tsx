// 게시글 상세 + 댓글 + 투표/북마크
import { useEffect, useState, useCallback, useRef } from "react";
import {
  View, Text, ScrollView, StyleSheet, Pressable, TextInput,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Animated,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, router } from "expo-router";
import { ArrowLeft, ChevronUp, MessageCircle, Send, Bookmark, FileText } from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";
import { apiFetch, apiJson } from "@/lib/api";
import { supabase } from "@/lib/supabase";

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
  author: { nickname: string; rank: string } | null;
}

interface Comment {
  id: string;
  content: string;
  created_at: string;
  author: { nickname: string; rank: string } | null;
}

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

// 아바타 컴포넌트 — 닉네임 첫 글자
function AvatarCircle({ name, size = 36 }: { name: string; size?: number }) {
  const initial = name.charAt(0) || "?";
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.avatarText, { fontSize: size * 0.4 }]}>{initial}</Text>
    </View>
  );
}

export default function PostDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [post, setPost] = useState<PostDetail | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [commentText, setCommentText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [commentFocused, setCommentFocused] = useState(false);

  // 투표 상태: 1 = upvote, -1 = downvote, 0 = none
  const [userVote, setUserVote] = useState<number>(0);
  // 북마크 상태
  const [bookmarked, setBookmarked] = useState(false);

  // 애니메이션
  const upScale = useRef(new Animated.Value(1)).current;
  const bookmarkScale = useRef(new Animated.Value(1)).current;

  const loadPost = useCallback(async () => {
    try {
      const data = await apiJson<PostDetail>(`/api/community/posts/${id}`);
      setPost(data);

      // 조회수 증가 (실패 무시)
      apiFetch(`/api/community/posts/${id}/view`, { method: "POST" }).catch(() => {});

      // 댓글 (실패해도 게시글은 표시)
      try {
        const commentsData = await apiJson<{ comments: Comment[] }>(
          `/api/community/comments?postId=${id}`
        );
        setComments(commentsData.comments ?? []);
      } catch { /* 댓글 로드 실패 무시 */ }

      // 투표/북마크 상태 (실패 무시)
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data: voteData } = await supabase
            .from("community_votes")
            .select("vote_type")
            .eq("post_id", id)
            .eq("user_id", user.id)
            .maybeSingle();
          if (voteData) setUserVote(voteData.vote_type);

          const { data: bmData } = await supabase
            .from("community_bookmarks")
            .select("id")
            .eq("post_id", id)
            .eq("user_id", user.id)
            .maybeSingle();
          setBookmarked(!!bmData);
        }
      } catch { /* 투표/북마크 로드 실패 무시 */ }
    } catch (err) {
      // 게시글 자체 로드 실패만 표시
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { loadPost(); }, [loadPost]);

  function animatePress(scaleRef: Animated.Value) {
    Animated.sequence([
      Animated.timing(scaleRef, { toValue: 1.3, duration: 100, useNativeDriver: true }),
      Animated.spring(scaleRef, { toValue: 1, friction: 3, useNativeDriver: true }),
    ]).start();
  }

  // 투표 처리
  async function handleVote() {
    if (!post) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      Alert.alert("로그인 필요", "투표하려면 로그인이 필요합니다.");
      return;
    }

    animatePress(upScale);

    const newVote = userVote === 1 ? 0 : 1;
    const prevVote = userVote;

    // 낙관적 업데이트
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
        p_post_id: id,
        p_vote_type: newVote,
      });
    } catch {
      setUserVote(prevVote);
      loadPost();
    }
  }

  // 북마크 처리
  async function handleBookmark() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      Alert.alert("로그인 필요", "북마크하려면 로그인이 필요합니다.");
      return;
    }

    animatePress(bookmarkScale);

    const wasBookmarked = bookmarked;
    setBookmarked(!wasBookmarked);

    try {
      if (wasBookmarked) {
        await supabase
          .from("community_bookmarks")
          .delete()
          .eq("post_id", id)
          .eq("user_id", user.id);
      } else {
        await supabase
          .from("community_bookmarks")
          .upsert({ post_id: id, user_id: user.id });
      }
    } catch {
      setBookmarked(wasBookmarked);
    }
  }

  async function handleComment() {
    if (!commentText.trim() || submitting) return;
    setSubmitting(true);
    try {
      await apiFetch("/api/community/comments", {
        method: "POST",
        body: JSON.stringify({ post_id: id, content: commentText.trim() }),
      });
      setCommentText("");
      loadPost();
    } catch {
      Alert.alert("오류", "댓글 작성에 실패했어요. 잠시 후 다시 시도해주세요.");
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
          <Pressable onPress={handleBookmark} hitSlop={12}>
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
            <AvatarCircle name={authorName} size={40} />
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
                  style={[styles.voteBtn, userVote === 1 && styles.voteBtnActive]}
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
          <View style={styles.commentsSection}>
            <Text style={styles.commentsTitle}>댓글 {comments.length}개</Text>
            {comments.map((c) => {
              const cName = c.author?.nickname ?? "익명";
              return (
                <View key={c.id} style={styles.commentCard}>
                  <View style={styles.commentHeader}>
                    <AvatarCircle name={cName} size={30} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.commentAuthor}>{cName}</Text>
                      <Text style={styles.commentTime}>{timeAgo(c.created_at)}</Text>
                    </View>
                  </View>
                  <Text style={styles.commentBody}>{c.content}</Text>
                </View>
              );
            })}
            {comments.length === 0 && (
              <View style={styles.noCommentsWrap}>
                <MessageCircle size={28} color={colors.textTertiary} />
                <Text style={styles.noComments}>아직 댓글이 없어요. 첫 댓글을 남겨보세요!</Text>
              </View>
            )}
          </View>
        </ScrollView>

        {/* 댓글 입력 */}
        <View style={styles.commentBar}>
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
  avatar: {
    backgroundColor: colors.ivory[200],
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  avatarText: { fontWeight: "700", color: colors.noir[800] },
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
