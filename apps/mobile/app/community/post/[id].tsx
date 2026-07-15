// 게시글 상세 + 댓글 + 투표/북마크
import { useEffect, useState, useCallback, useRef } from "react";
import {
  View, Text, ScrollView, StyleSheet, Pressable,
  ActivityIndicator, Alert, Animated, Linking,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, router, useFocusEffect } from "expo-router";
import { ChevronUp, MessageCircle, Bookmark, FileText, EyeOff } from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";
import { communityHtmlToPlainText } from "@hanbang/shared";
import { apiFetch, apiJson } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import {
  clearCommunityCaches,
  getCachedCommunityComments,
  getCachedCommunityPost,
  putCachedCommunityComments,
  putCachedCommunityPost,
  type CachedCommunityPost,
} from "@/lib/communityPostCache";
import { muteCommunityAuthor } from "@/lib/communityMutes";
import { CommunityAvatar } from "@/components/community/CommunityAvatar";
import {
  hasTrustedCommunityActor,
  type MobileCommunityAuthor,
} from "@/lib/communityPublicPayload";
import { AppHeader, EmptyState, LoadingState } from "@/components/ui/AppUI";
import ErrorRetry from "@/components/ErrorRetry";

interface PostDetail {
  id: string;
  author_id: string;
  viewer_is_author: boolean;
  title: string;
  content: string;
  category: string;
  ad_disclosure: string;
  sponsorship_detail: string | null;
  upvote_count: number;
  downvote_count: number;
  comment_count: number;
  view_count: number;
  visibility: "public" | "members" | "draft";
  under_review: boolean;
  created_at: string;
  author: MobileCommunityAuthor;
}

interface Comment {
  id: string;
  author_id: string;
  viewer_is_author: boolean;
  content: string;
  created_at: string;
  upvote_count?: number;
  author: MobileCommunityAuthor;
}

class CommunityPostUnavailableError extends Error {
  constructor() {
    super("community_post_unavailable");
    this.name = "CommunityPostUnavailableError";
  }
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
  is_normal: "계약·추가금 질문",
  tour_review: "투어/후기",
  tips_v2: "꿀팁",
  ama: "AMA",
  free: "자유",
};

const MOBILE_COMMUNITY_WEB_BASE = (
  process.env.EXPO_PUBLIC_SITE_URL || "https://hanbang.ai"
).replace(/\/$/, "");

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
    author_id: post.author_id,
    ad_disclosure: post.ad_disclosure ?? "general",
    sponsorship_detail: post.sponsorship_detail ?? null,
  };
}

function toCachedPost(post: PostDetail): CachedCommunityPost {
  return {
    id: post.id,
    author_id: post.author_id,
    viewer_is_author: post.viewer_is_author,
    title: post.title,
    content: post.content,
    category: post.category,
    ad_disclosure: post.ad_disclosure,
    sponsorship_detail: post.sponsorship_detail,
    upvote_count: post.upvote_count,
    downvote_count: post.downvote_count,
    comment_count: post.comment_count,
    view_count: post.view_count,
    visibility: post.visibility,
    under_review: post.under_review,
    created_at: post.created_at,
    author: post.author,
  };
}

async function fetchPostFromApi(postId: string): Promise<PostDetail> {
  const response = await apiFetch(`/api/community/posts/${postId}`);
  const body = await response.json().catch(() => null) as (
    PostDetail & {
      error?: string;
      user_vote?: number | null;
      user_bookmarked?: boolean;
    }
  ) | null;
  if (response.status === 404) {
    throw new CommunityPostUnavailableError();
  }
  if (!response.ok || !body) {
    throw new Error(body?.error ?? "게시글을 불러오지 못했습니다.");
  }
  if (!hasTrustedCommunityActor(body)) {
    throw new Error("게시글 작성자 정보를 확인하지 못했습니다.");
  }
  return {
    ...body,
    ad_disclosure: body.ad_disclosure ?? "general",
    sponsorship_detail: body.sponsorship_detail ?? null,
  };
}

async function fetchCommentsFromApi(postId: string): Promise<Comment[]> {
  const commentsData = await apiJson<{ comments: Comment[] }>(
    `/api/community/comments?postId=${postId}`
  );
  const comments = commentsData.comments ?? [];
  if (!Array.isArray(comments) || !comments.every(hasTrustedCommunityActor)) {
    throw new Error("댓글 작성자 정보를 확인하지 못했습니다.");
  }
  return comments;
}

async function fetchSocialState(postId: string): Promise<SocialState> {
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
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

  if (voteResult.error || bookmarkResult.error) {
    throw voteResult.error ?? bookmarkResult.error;
  }

  return {
    userVote: voteResult.data?.vote_type ?? 0,
    bookmarked: Boolean(bookmarkResult.data),
  };
}

export default function PostDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const postId = typeof id === "string" ? id : "";
  const [cacheOwnerId, setCacheOwnerId] = useState<string | null>(null);
  const [post, setPost] = useState<PostDetail | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [postLoadError, setPostLoadError] = useState(false);
  const [ownerRetryNonce, setOwnerRetryNonce] = useState(0);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsLoadError, setCommentsLoadError] = useState(false);
  const [voteSyncing, setVoteSyncing] = useState(false);
  const [bookmarkSyncing, setBookmarkSyncing] = useState(false);
  const [muteSubmitting, setMuteSubmitting] = useState(false);
  const [socialStateLoaded, setSocialStateLoaded] = useState(false);
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
        setPost(null);
        setComments([]);
        setPostLoadError(true);
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [ownerRetryNonce]);

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
    if (!cacheOwnerId || !postId) return;
    setCommentsLoadError(false);
    if (!options?.silent) setCommentsLoading(true);

    try {
      const nextComments = await fetchCommentsFromApi(postId);

      setComments(nextComments);
      putCachedCommunityComments(cacheOwnerId, postId, nextComments);
      setCommentsLoadError(false);
    } catch {
      setCommentsLoadError(true);
    } finally {
      setCommentsLoading(false);
    }
  }, [cacheOwnerId, postId]);

  const refreshAuxiliaryState = useCallback((options?: { silentComments?: boolean }) => {
    if (!postId) return;

    loadComments({ silent: options?.silentComments });
    setSocialStateLoaded(false);
    fetchSocialState(postId)
      .then((state) => {
        setUserVote(state.userVote);
        setBookmarked(state.bookmarked);
        setSocialStateLoaded(true);
      })
      .catch(() => {
        setSocialStateLoaded(false);
      });
    apiFetch(`/api/community/posts/${postId}/view`, { method: "POST" }).catch(() => {});
  }, [loadComments, postId]);

  const loadPost = useCallback(async () => {
    setPostLoadError(false);
    if (!postId) {
      setLoading(false);
      return;
    }
    if (!cacheOwnerId) return;

    const cachedPost = getCachedCommunityPost(cacheOwnerId, postId);
    const cachedComments = getCachedCommunityComments(cacheOwnerId, postId);
    const hadCachedPost = Boolean(cachedPost);
    if (cachedPost) {
      setPost(fromCachedPost(cachedPost));
      if (cachedComments) setComments(cachedComments);
      setLoading(false);
      refreshAuxiliaryState({ silentComments: Boolean(cachedComments) });
    } else {
      setLoading(true);
    }

    try {
      const nextPost = await fetchPostFromApi(postId);

      setPost(nextPost);
      putCachedCommunityPost(cacheOwnerId, toCachedPost(nextPost));
      setPostLoadError(false);
      setLoading(false);

      if (!hadCachedPost) {
        refreshAuxiliaryState({ silentComments: Boolean(cachedComments) });
      }
    } catch (error) {
      if (error instanceof CommunityPostUnavailableError) {
        clearCommunityCaches();
        setPost(null);
        setComments([]);
        setPostLoadError(false);
      } else {
        if (!cachedPost) setPost(null);
        setPostLoadError(true);
      }
    } finally {
      setLoading(false);
    }
  }, [cacheOwnerId, postId, refreshAuxiliaryState]);

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
    if (!socialStateLoaded) {
      showActionNotice("좋아요 상태를 확인하지 못했어요. 다시 불러온 뒤 시도해주세요.");
      refreshAuxiliaryState({ silentComments: true });
      return;
    }
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
      const response = await apiFetch(`/api/community/posts/${postId}/vote`, {
        method: "POST",
        body: JSON.stringify({ voteType: newVote }),
      });
      const body = await response.json().catch(() => ({}));
      if (
        !response.ok ||
        typeof body.upvote_count !== "number" ||
        !Number.isSafeInteger(body.upvote_count) ||
        body.upvote_count < 0 ||
        typeof body.downvote_count !== "number" ||
        !Number.isSafeInteger(body.downvote_count) ||
        body.downvote_count < 0
      ) {
        throw new Error(body.error ?? "좋아요 저장 결과를 확인하지 못했습니다.");
      }
      setPost((current) => current ? {
        ...current,
        upvote_count: body.upvote_count,
        downvote_count: body.downvote_count,
      } : current);
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
    if (!socialStateLoaded) {
      showActionNotice("북마크 상태를 확인하지 못했어요. 다시 불러온 뒤 시도해주세요.");
      refreshAuxiliaryState({ silentComments: true });
      return;
    }
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
      const response = await apiFetch(`/api/community/posts/${postId}/bookmark`, {
        method: "POST",
        body: JSON.stringify({ bookmarked: !wasBookmarked }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.bookmarked !== !wasBookmarked) {
        throw new Error(body.error ?? "북마크 저장에 실패했습니다.");
      }
      setBookmarked(body.bookmarked);
    } catch {
      setBookmarked(wasBookmarked);
      showActionNotice("북마크를 저장하지 못했어요. 연결을 확인하고 다시 시도해주세요.");
    } finally {
      setBookmarkSyncing(false);
    }
  }

  async function openFullPostInWeb() {
    try {
      await Linking.openURL(`${MOBILE_COMMUNITY_WEB_BASE}/community/post/${encodeURIComponent(postId)}`);
    } catch {
      Alert.alert(
        "웹 페이지를 열 수 없어요",
        "브라우저에서 hanbang.ai에 접속해 게시글 전체 내용과 관리 기능을 확인해주세요."
      );
    }
  }

  async function handleMuteAuthor() {
    if (
      !post?.author_id ||
      !cacheOwnerId ||
      post.viewer_is_author ||
      muteSubmitting
    ) return;

    setMuteSubmitting(true);
    try {
      await muteCommunityAuthor(post.author_id, apiFetch);
      clearCommunityCaches();
      Alert.alert(
        "작성자를 숨겼어요",
        "이 작성자의 게시글과 댓글은 내 커뮤니티에서 보이지 않아요. 프로필 > 숨긴 작성자에서 언제든 해제할 수 있어요.",
        [{
          text: "확인",
          onPress: () => router.replace("/(tabs)/community"),
        }],
      );
    } catch (error) {
      Alert.alert(
        "작성자를 숨기지 못했어요",
        error instanceof Error
          ? error.message
          : "연결을 확인하고 다시 시도해주세요.",
      );
    } finally {
      setMuteSubmitting(false);
    }
  }

  function confirmMuteAuthor() {
    if (!post?.author_id || post.viewer_is_author || muteSubmitting) return;
    Alert.alert(
      "이 작성자의 글을 숨길까요?",
      "이 작성자의 게시글과 댓글이 내 커뮤니티에서 보이지 않아요. 작성자에게 알림은 가지 않아요. 프로필 > 숨긴 작성자에서 언제든 해제할 수 있어요.",
      [
        { text: "취소", style: "cancel" },
        {
          text: "숨기기",
          style: "destructive",
          onPress: () => void handleMuteAuthor(),
        },
      ],
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <LoadingState label="게시글을 불러오고 있어요" />
      </SafeAreaView>
    );
  }

  if (postLoadError && !post) {
    return (
      <SafeAreaView style={styles.container}>
        <AppHeader title="게시글" onBack={() => router.back()} />
        <ErrorRetry
          message="게시글을 불러오지 못했어요. 연결 오류일 수 있어 삭제된 것으로 판단하지 않았어요."
          onRetry={() => {
            setLoading(true);
            setPostLoadError(false);
            if (cacheOwnerId) {
              loadPost();
            } else {
              setOwnerRetryNonce((value) => value + 1);
            }
          }}
        />
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
          description="올바른 게시글 주소인지 확인해주세요."
        />
      </SafeAreaView>
    );
  }

  const votes = post.upvote_count;
  const adBadge = AD_LABELS[post.ad_disclosure];
  const catLabel = CATEGORY_LABELS[post.category] ?? post.category;
  const authorName = post.author.nickname;

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

      <View style={{ flex: 1 }}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
          {postLoadError && (
            <View style={styles.actionNotice}>
              <Text style={styles.actionNoticeText}>
                최신 글을 불러오지 못해 저장된 미리보기를 표시하고 있어요.
              </Text>
            </View>
          )}

          <View style={styles.readOnlyNotice}>
            <Text style={styles.readOnlyNoticeTitle}>
              모바일 커뮤니티는 현재 읽기 중심으로 제공해요
            </Text>
            <Text style={styles.readOnlyNoticeBody}>
              게시글 신고·수정·삭제와 기존 투표 결과 확인은 웹에서 이용해주세요.
            </Text>
            <Text style={styles.readOnlyNoticeBoundary}>
              새 댓글과 답글 작성은 현재 받지 않아요. 기존 댓글은 계속 읽을 수 있어요. 작성자는 기존 댓글을 웹에서 수정·삭제할 수 있어요.
            </Text>
            <Text style={styles.readOnlyNoticeBoundary}>
              댓글 단위 신고는 현재 제공하지 않아요. 작성자 글 숨기기는 이 화면에서 이용할 수 있어요. 불편한 내용은 웹의 게시글 신고로 접수해주세요.
            </Text>
            <Pressable
              onPress={openFullPostInWeb}
              accessibilityRole="link"
              accessibilityLabel="웹에서 게시글 전체 내용과 관리 기능 열기"
              style={({ pressed }) => [
                styles.readOnlyNoticeLink,
                pressed && { opacity: 0.72 },
              ]}
            >
              <Text style={styles.readOnlyNoticeLinkText}>웹에서 전체 글 보기</Text>
            </Pressable>
          </View>

          {/* 광고 배지 */}
          {adBadge && (
            <View style={[styles.adBadge, { backgroundColor: adBadge.bg, borderColor: adBadge.color + "40" }]}>
              <View style={[styles.adDot, { backgroundColor: adBadge.color }]} />
              <Text style={[styles.adText, { color: adBadge.color }]}>{adBadge.label}</Text>
            </View>
          )}

          {post.ad_disclosure === "sponsored" && post.sponsorship_detail ? (
            <View style={styles.sponsorshipNotice}>
              <Text style={styles.sponsorshipNoticeTitle}>작성자가 밝힌 협찬 혜택</Text>
              <Text style={styles.sponsorshipNoticeBody}>{post.sponsorship_detail}</Text>
            </View>
          ) : null}

          {/* 카테고리 */}
          <View style={styles.catBadge}>
            <Text style={styles.catBadgeText}>{catLabel}</Text>
          </View>

          {/* 제목 */}
          <Text style={styles.title}>{post.title}</Text>

          {/* 작성자 섹션 — 아바타 포함 */}
          <View style={styles.authorSection}>
            <CommunityAvatar
              nickname={authorName}
              avatarUrl={post.author.avatar_url}
              size={40}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.authorName}>{authorName}</Text>
              <View style={styles.meta}>
                <Text style={styles.time}>{timeAgo(post.created_at)}</Text>
                <Text style={styles.dot}>·</Text>
                <Text style={styles.time}>조회 {post.view_count}</Text>
              </View>
            </View>
            {post.author_id && cacheOwnerId && !post.viewer_is_author ? (
              <Pressable
                onPress={confirmMuteAuthor}
                disabled={muteSubmitting}
                accessibilityRole="button"
                accessibilityLabel={`${authorName} 작성자 글 숨기기`}
                accessibilityHint="이 작성자의 게시글과 댓글을 내 커뮤니티에서 숨깁니다"
                accessibilityState={{ disabled: muteSubmitting, busy: muteSubmitting }}
                style={({ pressed }) => [
                  styles.muteAuthorButton,
                  (pressed || muteSubmitting) && styles.muteAuthorButtonPressed,
                ]}
              >
                {muteSubmitting ? (
                  <ActivityIndicator size="small" color={colors.textSecondary} />
                ) : (
                  <EyeOff size={15} color={colors.textSecondary} />
                )}
                <Text style={styles.muteAuthorButtonText}>
                  {muteSubmitting ? "숨기는 중" : "작성자 글 숨기기"}
                </Text>
              </Pressable>
            ) : null}
          </View>

          {/* 본문 */}
          <Text style={styles.body}>
            {communityHtmlToPlainText(post.content, { preserveParagraphs: true })}
          </Text>

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
            {commentsLoadError && (
              <View style={styles.actionNotice}>
                <Text style={styles.actionNoticeText}>
                  {comments.length > 0
                    ? "최신 댓글을 불러오지 못해 저장된 댓글을 표시하고 있어요."
                    : "댓글을 불러오지 못했어요. 댓글이 없는 것으로 판단하지 않았어요."}
                </Text>
                <Pressable
                  onPress={() => loadComments()}
                  accessibilityRole="button"
                  accessibilityLabel="댓글 다시 불러오기"
                >
                  <Text style={styles.commentsRetryText}>다시 시도</Text>
                </Pressable>
              </View>
            )}
            {comments.map((c) => {
              const cName = c.author.nickname;
              return (
                <View key={c.id} style={styles.commentCard}>
                  <View style={styles.commentHeader}>
                    <CommunityAvatar
                      nickname={cName}
                      avatarUrl={c.author.avatar_url}
                      size={30}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.commentAuthor}>{cName}</Text>
                      <Text style={styles.commentTime}>{timeAgo(c.created_at)}</Text>
                    </View>
                  </View>
                  <Text style={styles.commentBody}>{c.content}</Text>
                  <Text style={styles.commentVoteCount}>
                    좋아요 {typeof c.upvote_count === "number" ? c.upvote_count : 0}
                  </Text>
                </View>
              );
            })}
            {!commentsLoading && !commentsLoadError && comments.length === 0 && (
              <View style={styles.noCommentsWrap}>
                <MessageCircle size={28} color={colors.textTertiary} />
                <Text style={styles.noComments}>아직 등록된 댓글이 없어요.</Text>
              </View>
            )}
          </View>
        </ScrollView>

      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingBottom: 40 },

  readOnlyNotice: {
    padding: 14,
    marginBottom: 18,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.ivory[100],
  },
  readOnlyNoticeTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.noir[800],
    marginBottom: 6,
  },
  readOnlyNoticeBody: {
    fontSize: 13,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  readOnlyNoticeBoundary: {
    marginTop: 6,
    fontSize: 12,
    lineHeight: 18,
    color: colors.textTertiary,
  },
  readOnlyNoticeLink: {
    alignSelf: "flex-start",
    marginTop: 10,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: colors.noir[800],
  },
  readOnlyNoticeLinkText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#FFFFFF",
  },

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
  sponsorshipNotice: {
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#FDE68A",
    borderRadius: 12,
    backgroundColor: "#FFFBEB",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  sponsorshipNoticeTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: "#92400E",
  },
  sponsorshipNoticeBody: {
    marginTop: 3,
    fontSize: 13,
    lineHeight: 19,
    color: "#78350F",
  },

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
  muteAuthorButton: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  muteAuthorButtonPressed: { opacity: 0.58 },
  muteAuthorButtonText: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textSecondary,
  },
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
  commentVoteCount: {
    marginTop: 6,
    marginLeft: 40,
    fontSize: 12,
    color: colors.textTertiary,
  },
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
  commentsRetryText: {
    marginTop: 8,
    fontSize: 13,
    fontWeight: "700",
    color: colors.rose[500],
  },

});
