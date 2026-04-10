// 게시글 상세 + 댓글
import { useEffect, useState, useCallback } from "react";
import {
  View, Text, ScrollView, StyleSheet, Pressable, TextInput,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, router } from "expo-router";
import { ArrowLeft, ChevronUp, ChevronDown, MessageCircle, Send, Bookmark } from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";
import { apiFetch, apiJson } from "@/lib/api";

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

const AD_LABELS: Record<string, { label: string; color: string }> = {
  sponsored: { label: "협찬", color: "#EAB308" },
  ad: { label: "광고", color: "#EF4444" },
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

export default function PostDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [post, setPost] = useState<PostDetail | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [commentText, setCommentText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const loadPost = useCallback(async () => {
    try {
      const data = await apiJson<PostDetail>(`/api/community/posts/${id}`);
      setPost(data);

      // 조회수 증가
      apiFetch(`/api/community/posts/${id}/view`, { method: "POST" }).catch(() => {});

      // 댓글
      const commentsData = await apiJson<{ comments: Comment[] }>(
        `/api/community/comments?post_id=${id}`
      );
      setComments(commentsData.comments ?? []);
    } catch (err) {
      console.error("Post load error:", err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { loadPost(); }, [loadPost]);

  async function handleComment() {
    if (!commentText.trim() || submitting) return;
    setSubmitting(true);
    try {
      await apiFetch("/api/community/comments", {
        method: "POST",
        body: JSON.stringify({ post_id: id, content: commentText.trim() }),
      });
      setCommentText("");
      loadPost(); // 새로고침
    } catch (err) {
      Alert.alert("오류", "댓글 작성에 실패했어요");
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
        </View>
        <View style={{ alignItems: "center", marginTop: 60 }}>
          <Text style={{ color: colors.textTertiary }}>게시글을 찾을 수 없어요</Text>
        </View>
      </SafeAreaView>
    );
  }

  const votes = post.upvote_count - post.downvote_count;
  const adBadge = AD_LABELS[post.ad_disclosure];

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      {/* 헤더 */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <ArrowLeft size={24} color={colors.noir[800]} />
        </Pressable>
        <Text style={styles.headerTitle}>게시글</Text>
        <Bookmark size={22} color={colors.taupe[400]} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
          {/* 광고 배지 */}
          {adBadge && (
            <View style={[styles.adBadge, { backgroundColor: adBadge.color + "20" }]}>
              <View style={[styles.adDot, { backgroundColor: adBadge.color }]} />
              <Text style={[styles.adText, { color: adBadge.color }]}>{adBadge.label}</Text>
            </View>
          )}

          {/* 제목 */}
          <Text style={styles.title}>{post.title}</Text>

          {/* 작성자 */}
          <View style={styles.meta}>
            <Text style={styles.author}>{post.author?.nickname ?? "익명"}</Text>
            <Text style={styles.dot}>·</Text>
            <Text style={styles.time}>{timeAgo(post.created_at)}</Text>
            <Text style={styles.dot}>·</Text>
            <Text style={styles.time}>조회 {post.view_count}</Text>
          </View>

          {/* 본문 */}
          <Text style={styles.body}>{post.content.replace(/<[^>]*>/g, "")}</Text>

          {/* 액션 바 */}
          <View style={styles.actions}>
            <View style={styles.actionGroup}>
              <ChevronUp size={20} color={colors.taupe[400]} />
              <Text style={styles.voteCount}>{votes}</Text>
              <ChevronDown size={20} color={colors.taupe[400]} />
            </View>
            <View style={styles.actionGroup}>
              <MessageCircle size={18} color={colors.taupe[400]} />
              <Text style={styles.actionLabel}>댓글 {post.comment_count}</Text>
            </View>
          </View>

          {/* 댓글 목록 */}
          <View style={styles.commentsSection}>
            <Text style={styles.commentsTitle}>댓글 {comments.length}개</Text>
            {comments.map((c) => (
              <View key={c.id} style={styles.commentCard}>
                <View style={styles.commentMeta}>
                  <Text style={styles.commentAuthor}>{c.author?.nickname ?? "익명"}</Text>
                  <Text style={styles.commentTime}>{timeAgo(c.created_at)}</Text>
                </View>
                <Text style={styles.commentBody}>{c.content}</Text>
              </View>
            ))}
            {comments.length === 0 && (
              <Text style={styles.noComments}>아직 댓글이 없어요. 첫 댓글을 남겨보세요!</Text>
            )}
          </View>
        </ScrollView>

        {/* 댓글 입력 */}
        <View style={styles.commentBar}>
          <TextInput
            style={styles.commentInput}
            value={commentText}
            onChangeText={setCommentText}
            placeholder="댓글을 입력하세요..."
            placeholderTextColor={colors.taupe[400]}
            maxLength={1000}
          />
          <Pressable
            style={[styles.sendBtn, (!commentText.trim() || submitting) && { opacity: 0.4 }]}
            onPress={handleComment}
            disabled={!commentText.trim() || submitting}
          >
            <Send size={18} color="#FFF" />
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
  headerTitle: { fontSize: 18, fontWeight: "600", color: colors.noir[800] },
  content: { padding: 20, paddingBottom: 40 },

  adBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    marginBottom: 12,
  },
  adDot: { width: 6, height: 6, borderRadius: 3 },
  adText: { fontSize: 12, fontWeight: "600" },

  title: { fontSize: 22, fontWeight: "700", color: colors.noir[800], lineHeight: 30, marginBottom: 12 },
  meta: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 20 },
  author: { fontSize: 14, fontWeight: "500", color: colors.noir[800] },
  dot: { fontSize: 14, color: colors.taupe[400] },
  time: { fontSize: 13, color: colors.taupe[400] },

  body: { fontSize: 15, color: colors.noir[800], lineHeight: 26, marginBottom: 24 },

  actions: {
    flexDirection: "row",
    gap: 20,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  actionGroup: { flexDirection: "row", alignItems: "center", gap: 6 },
  voteCount: { fontSize: 15, fontWeight: "600", color: colors.noir[800], minWidth: 20, textAlign: "center" },
  actionLabel: { fontSize: 13, color: colors.taupe[400] },

  commentsSection: { marginTop: 24 },
  commentsTitle: { fontSize: 16, fontWeight: "600", color: colors.noir[800], marginBottom: 16 },
  commentCard: {
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  commentMeta: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  commentAuthor: { fontSize: 13, fontWeight: "600", color: colors.noir[800] },
  commentTime: { fontSize: 12, color: colors.taupe[400] },
  commentBody: { fontSize: 14, color: colors.noir[800], lineHeight: 22 },
  noComments: { fontSize: 13, color: colors.textTertiary, textAlign: "center", paddingVertical: 20 },

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
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.rose[500],
    alignItems: "center",
    justifyContent: "center",
  },
});
