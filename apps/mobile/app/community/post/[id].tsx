// 게시글 상세 + 댓글 + 투표/북마크
import { useEffect, useState, useCallback, useRef } from "react";
import { toKoreanErrorMessage } from "@/lib/errorCopy";
import { View, ScrollView, StyleSheet, Pressable, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Animated } from "react-native";
import { Text, TextInput } from "@/components/ui/AppText";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, router, useFocusEffect } from "expo-router";
import * as Crypto from "expo-crypto";
import { ChevronUp, MessageCircle, Send, Bookmark, FileText, MoreHorizontal } from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";
import {
  apiFetchForExpectedUser,
  publicApiFetch,
} from "@/lib/api";
import { supabase } from "@/lib/supabase";
import {
  clearCommunityCaches,
  putCachedCommunityComments,
  putCachedCommunityPost,
  setCommunityCacheViewer,
  type CachedCommunityPost,
} from "@/lib/communityPostCache";
import {
  CommunityPostMutationError,
  createCommunityCommentIdempotencyStore,
  createCommunityPostActionGate,
  fetchCommunityPostSocialState,
  setCommunityBookmark,
  submitCommunityVote,
  type CommunityPostActionToken,
  type CommunityIdentityToken,
} from "@/lib/communityPostMutations.mjs";
import {
  CommunityAvatar,
  type CommunityAvatarRole,
} from "@/components/community/CommunityAvatar";
import { CommunityCommentItem } from "@/components/community/CommunityCommentItem";
import { CommunityTrustBadges } from "@/components/community/CommunityTrustBadges";
import ErrorRetry from "@/components/ErrorRetry";
import {
  communityPostLoadFailure,
  parseCommunityPostTrust,
  type CommunityAdDisclosure,
  type CommunityContentOrigin,
  type CommunityPostLoadFailure,
} from "@/lib/communityTrust.mjs";
import { readDecisionThreadIdFromPost } from "@/lib/communityDecisionThread.mjs";
import {
  countVisibleCommunityComments,
  hideCommunityCommentsByAuthor,
  parseCommunityCommentThread,
  type CommunityThreadComment,
} from "@/lib/communityCommentThread.mjs";
import { ActionRow, AppHeader, EmptyState, LoadingState } from "@/components/ui/AppUI";
import {
  CommunitySafetySheet,
  type CommunityReportReason,
  type CommunitySafetyTarget,
} from "@/components/community/CommunitySafetySheet";

interface PostDetail {
  id: string;
  decisionThreadId?: string;
  author_id: string;
  title: string;
  content: string;
  category: string;
  content_origin: CommunityContentOrigin;
  ad_disclosure: CommunityAdDisclosure;
  sponsorship_detail: string | null;
  is_resolved: boolean;
  under_review: boolean;
  upvote_count: number;
  downvote_count: number;
  comment_count: number;
  view_count: number;
  created_at: string;
  author: { nickname: string; rank: string; role?: CommunityAvatarRole | null } | null;
}

type Comment = CommunityThreadComment;

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

function toCachedPost(post: PostDetail): CachedCommunityPost {
  return {
    id: post.id,
    author_id: post.author_id,
    title: post.title,
    content: post.content,
    category: post.category,
    content_origin: post.content_origin,
    ad_disclosure: post.ad_disclosure,
    sponsorship_detail: post.sponsorship_detail,
    is_resolved: post.is_resolved,
    under_review: post.under_review,
    upvote_count: post.upvote_count,
    downvote_count: post.downvote_count,
    comment_count: post.comment_count,
    view_count: post.view_count,
    created_at: post.created_at,
    author: post.author,
  };
}

class CommunityPostLoadError extends Error {
  constructor(readonly kind: CommunityPostLoadFailure) {
    super(kind);
  }
}

async function fetchPostFromApi(
  postId: string,
  ownerId: string | null,
): Promise<PostDetail> {
  const path = `/api/community/posts/${postId}`;
  const response = ownerId
    ? await apiFetchForExpectedUser(ownerId, path)
    : await publicApiFetch(path);
  if (!response.ok) {
    throw new CommunityPostLoadError(communityPostLoadFailure(response.status));
  }
  const rawData = await response.json() as unknown;
  const trust = parseCommunityPostTrust(rawData);
  if (!trust || !rawData || typeof rawData !== "object" || Array.isArray(rawData)) {
    throw new CommunityPostLoadError("load_failed");
  }
  const decisionThreadId = readDecisionThreadIdFromPost(rawData);
  const data = rawData as PostDetail & {
    user_vote?: number | null;
    user_bookmarked?: boolean;
  };
  return {
    ...data,
    ...(decisionThreadId
      ? { decisionThreadId }
      : {}),
    content_origin: trust.contentOrigin,
    ad_disclosure: trust.adDisclosure,
    sponsorship_detail: trust.sponsorshipDetail,
    is_resolved: trust.isResolved,
    under_review: trust.underReview,
  };
}

async function fetchCommentsFromApi(
  postId: string,
  ownerId: string | null,
): Promise<Comment[]> {
  const path = `/api/community/comments?postId=${postId}`;
  const response = ownerId
    ? await apiFetchForExpectedUser(ownerId, path)
    : await publicApiFetch(path);
  if (!response.ok) throw new Error("comments not readable");
  const commentsData = await response.json() as { comments?: unknown };
  // 답글(`replies`)까지 읽는다. 작성 출처가 깨진 답변·답글이 하나라도 있으면 목록 전체를 실패로 둔다.
  return parseCommunityCommentThread(commentsData.comments);
}

export default function PostDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const postId = typeof id === "string" ? id : "";
  const [post, setPost] = useState<PostDetail | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [postLoadFailure, setPostLoadFailure] = useState<CommunityPostLoadFailure | null>(null);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsLoadFailed, setCommentsLoadFailed] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [commentFocused, setCommentFocused] = useState(false);
  const [voteSyncing, setVoteSyncing] = useState(false);
  const [bookmarkSyncing, setBookmarkSyncing] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [safetyTarget, setSafetyTarget] = useState<CommunitySafetyTarget | null>(null);
  const [safetyBusy, setSafetyBusy] = useState(false);
  const [safetyError, setSafetyError] = useState<string | null>(null);

  // 투표 상태: 1 = upvote, -1 = downvote, 0 = none
  const [userVote, setUserVote] = useState<number>(0);
  // 북마크 상태
  const [bookmarked, setBookmarked] = useState(false);

  // 애니메이션
  const upScale = useRef(new Animated.Value(1)).current;
  const bookmarkScale = useRef(new Animated.Value(1)).current;
  const actionNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const actionGateRef = useRef(createCommunityPostActionGate()).current;
  const commentIdempotencyRef = useRef(
    createCommunityCommentIdempotencyStore(() => Crypto.randomUUID()),
  ).current;
  const loadSequenceRef = useRef(0);

  const invalidateLoadsForMutation = useCallback(() => {
    loadSequenceRef.current += 1;
    setLoading(false);
    setCommentsLoading(false);
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

  const isLoadCurrent = useCallback((sequence: number, ownerId: string | null) => {
    if (loadSequenceRef.current !== sequence) return false;
    const identity = actionGateRef.capture();
    return ownerId === null ? identity === null : identity?.ownerId === ownerId;
  }, [actionGateRef]);

  const isLoadOwnerCurrent = useCallback(async (
    sequence: number,
    ownerId: string | null,
  ) => {
    if (!isLoadCurrent(sequence, ownerId)) return false;
    const { data } = await supabase.auth.getSession();
    const currentOwnerId = data.session?.user.id.toLowerCase() ?? null;
    const expectedOwnerId = ownerId?.toLowerCase() ?? null;
    return currentOwnerId === expectedOwnerId
      && isLoadCurrent(sequence, ownerId);
  }, [isLoadCurrent]);

  const loadComments = useCallback(async (
    ownerId: string | null,
    sequence: number,
    options?: { silent?: boolean },
  ) => {
    if (!postId || !isLoadCurrent(sequence, ownerId)) return;
    if (!options?.silent) setCommentsLoading(true);
    setCommentsLoadFailed(false);

    try {
      const nextComments = await fetchCommentsFromApi(postId, ownerId);
      if (!(await isLoadOwnerCurrent(sequence, ownerId))) return;
      setComments(nextComments);
      putCachedCommunityComments(postId, nextComments);
    } catch {
      if (await isLoadOwnerCurrent(sequence, ownerId)) {
        setCommentsLoadFailed(true);
      }
    } finally {
      if (isLoadCurrent(sequence, ownerId)) setCommentsLoading(false);
    }
  }, [isLoadCurrent, isLoadOwnerCurrent, postId]);

  const refreshAuxiliaryState = useCallback((
    ownerId: string | null,
    sequence: number,
  ) => {
    if (!postId || !isLoadCurrent(sequence, ownerId)) return;

    void loadComments(ownerId, sequence);
    if (ownerId) {
      void fetchCommunityPostSocialState({
        apiFetchForExpectedUser,
        ownerId,
        postId,
      }).then(async (state) => {
        if (!(await isLoadOwnerCurrent(sequence, ownerId))) return;
        setUserVote(state.userVote);
        setBookmarked(state.bookmarked);
        setPost((current) => current ? {
          ...current,
          upvote_count: state.upvoteCount,
          downvote_count: state.downvoteCount,
        } : current);
      }).catch(() => {});
    } else {
      setUserVote(0);
      setBookmarked(false);
    }
    if (ownerId) {
      void apiFetchForExpectedUser(
        ownerId,
        `/api/community/posts/${postId}/view`,
        { method: "POST" },
      ).catch(() => {});
    }
  }, [isLoadCurrent, isLoadOwnerCurrent, loadComments, postId]);

  const loadPost = useCallback(async () => {
    if (actionGateRef.hasActiveAction()) return;
    const sequence = loadSequenceRef.current + 1;
    loadSequenceRef.current = sequence;
    if (!postId) {
      setPostLoadFailure("unavailable");
      setLoading(false);
      return;
    }
    setLoading(true);
    setPostLoadFailure(null);

    let loadOwnerId: string | null | undefined;
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (loadSequenceRef.current !== sequence) return;
      const ownerId = sessionData.session?.user.id ?? null;
      loadOwnerId = ownerId;
      setCommunityCacheViewer(ownerId);
      const ownerChanged = actionGateRef.setOwner(ownerId);
      if (ownerChanged) {
        clearCommunityCaches();
        commentIdempotencyRef.clear();
        setPost(null);
        setComments([]);
        setPostLoadFailure(null);
        setCommentsLoadFailed(false);
        setUserVote(0);
        setBookmarked(false);
        setVoteSyncing(false);
        setBookmarkSyncing(false);
        setSubmitting(false);
        setCommentText("");
        setCommentFocused(false);
        setActionNotice(null);
        setSafetyTarget(null);
        setSafetyBusy(false);
        setSafetyError(null);
        if (actionNoticeTimerRef.current) {
          clearTimeout(actionNoticeTimerRef.current);
          actionNoticeTimerRef.current = null;
        }
      }
      if (!(await isLoadOwnerCurrent(sequence, ownerId))) return;

      const nextPost = await fetchPostFromApi(postId, ownerId);
      if (!(await isLoadOwnerCurrent(sequence, ownerId))) return;
      setPost(nextPost);
      putCachedCommunityPost(toCachedPost(nextPost));
      setLoading(false);
      refreshAuxiliaryState(ownerId, sequence);
    } catch (error) {
      if (
        loadOwnerId !== undefined
        && await isLoadOwnerCurrent(sequence, loadOwnerId)
      ) {
        setPost(null);
        setPostLoadFailure(
          error instanceof CommunityPostLoadError ? error.kind : "load_failed",
        );
      }
    } finally {
      if (loadSequenceRef.current === sequence) setLoading(false);
    }
  }, [actionGateRef, commentIdempotencyRef, isLoadOwnerCurrent, postId, refreshAuxiliaryState]);

  useEffect(() => {
    let disposed = false;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setCommunityCacheViewer(session?.user.id ?? null);
      const changed = actionGateRef.setOwner(session?.user.id ?? null);
      if (!changed) return;
      clearCommunityCaches();
      commentIdempotencyRef.clear();
      loadSequenceRef.current += 1;
      setPost(null);
      setComments([]);
      setPostLoadFailure(null);
      setCommentsLoadFailed(false);
      setUserVote(0);
      setBookmarked(false);
      setVoteSyncing(false);
      setBookmarkSyncing(false);
      setSubmitting(false);
      setCommentText("");
      setCommentFocused(false);
      setActionNotice(null);
      setSafetyTarget(null);
      setSafetyBusy(false);
      setSafetyError(null);
      if (actionNoticeTimerRef.current) {
        clearTimeout(actionNoticeTimerRef.current);
        actionNoticeTimerRef.current = null;
      }
      setLoading(true);
      setTimeout(() => {
        if (!disposed) void loadPost();
      }, 0);
    });
    return () => {
      disposed = true;
      loadSequenceRef.current += 1;
      actionGateRef.setOwner(null);
      commentIdempotencyRef.clear();
      subscription.unsubscribe();
    };
  }, [actionGateRef, commentIdempotencyRef, loadPost]);

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

  async function isActionOwnerCurrent(token: CommunityPostActionToken) {
    const { data } = await supabase.auth.getSession();
    return data.session?.user.id.toLowerCase() === token.ownerId
      && actionGateRef.isCurrent(token);
  }

  async function isIdentityOwnerCurrent(token: CommunityIdentityToken) {
    const { data } = await supabase.auth.getSession();
    return data.session?.user.id.toLowerCase() === token.ownerId
      && actionGateRef.isCurrent(token);
  }

  async function recoverSocialState(token: CommunityPostActionToken) {
    try {
      const state = await fetchCommunityPostSocialState({
        apiFetchForExpectedUser,
        ownerId: token.ownerId,
        postId,
      });
      if (!(await isActionOwnerCurrent(token))) return;
      setUserVote(state.userVote);
      setBookmarked(state.bookmarked);
      setPost((current) => current ? {
        ...current,
        upvote_count: state.upvoteCount,
        downvote_count: state.downvoteCount,
      } : current);
    } catch {
      // 이전 화면 상태를 유지하고 다음 새로고침에서 서버 상태를 다시 확인한다.
    }
  }

  function mutationNotice(error: unknown, fallback: string) {
    return error instanceof CommunityPostMutationError
      ? error.displayMessage
      : fallback;
  }

  // 투표 처리
  async function handleVote() {
    if (!post) return;
    const token = actionGateRef.begin("vote");
    if (!token) {
      if (!actionGateRef.capture()) {
        Alert.alert("로그인 필요", "투표하려면 로그인이 필요합니다.");
      }
      return;
    }
    invalidateLoadsForMutation();
    animatePress(upScale);

    const newVote = userVote === 1 ? 0 : 1;
    const prevVote = userVote;
    const previousCounts = {
      upvoteCount: post.upvote_count,
      downvoteCount: post.downvote_count,
    };

    // 낙관적 업데이트
    setVoteSyncing(true);
    setUserVote(newVote);
    setPost((prev) => {
      if (!prev) return prev;
      let up = prev.upvote_count;
      if (prevVote === 1) up--;
      if (newVote === 1) up++;
      return { ...prev, upvote_count: Math.max(0, up) };
    });

    try {
      const result = await submitCommunityVote({
        apiFetchForExpectedUser,
        ownerId: token.ownerId,
        postId,
        voteType: newVote,
      });
      if (!(await isActionOwnerCurrent(token))) return;
      setUserVote(result.userVote);
      setPost((current) => current ? {
        ...current,
        upvote_count: result.upvoteCount,
        downvote_count: result.downvoteCount,
      } : current);
    } catch (error) {
      if (!(await isActionOwnerCurrent(token))) return;
      setUserVote(prevVote);
      setPost((current) => current ? {
        ...current,
        upvote_count: previousCounts.upvoteCount,
        downvote_count: previousCounts.downvoteCount,
      } : current);
      showActionNotice(mutationNotice(
        error,
        "좋아요 저장 결과를 확인하지 못했어요. 최신 상태를 다시 확인합니다.",
      ));
      await recoverSocialState(token);
    } finally {
      const shouldCommit = await isActionOwnerCurrent(token);
      actionGateRef.finish(token);
      if (shouldCommit) setVoteSyncing(false);
    }
  }

  // 북마크 처리
  async function handleBookmark() {
    const token = actionGateRef.begin("bookmark");
    if (!token) {
      if (!actionGateRef.capture()) {
        Alert.alert("로그인 필요", "북마크하려면 로그인이 필요합니다.");
      }
      return;
    }
    invalidateLoadsForMutation();

    animatePress(bookmarkScale);

    const wasBookmarked = bookmarked;
    setBookmarkSyncing(true);
    setBookmarked(!wasBookmarked);

    try {
      const result = await setCommunityBookmark({
        apiFetchForExpectedUser,
        ownerId: token.ownerId,
        postId,
        bookmarked: !wasBookmarked,
      });
      if (!(await isActionOwnerCurrent(token))) return;
      setBookmarked(result.bookmarked);
    } catch (error) {
      if (!(await isActionOwnerCurrent(token))) return;
      setBookmarked(wasBookmarked);
      showActionNotice(mutationNotice(
        error,
        "북마크 저장 결과를 확인하지 못했어요. 최신 상태를 다시 확인합니다.",
      ));
      await recoverSocialState(token);
    } finally {
      const shouldCommit = await isActionOwnerCurrent(token);
      actionGateRef.finish(token);
      if (shouldCommit) setBookmarkSyncing(false);
    }
  }

  async function handleComment() {
    const content = commentText.trim();
    if (!content) return;
    const token = actionGateRef.begin("comment");
    if (!token) {
      if (!actionGateRef.capture()) {
        Alert.alert("로그인 필요", "댓글을 작성하려면 로그인이 필요합니다.");
      }
      return;
    }
    invalidateLoadsForMutation();
    setSubmitting(true);
    try {
      const idempotencyKey = commentIdempotencyRef.keyFor(
        token.ownerId,
        postId,
        content,
      );
      const res = await apiFetchForExpectedUser(token.ownerId, "/api/community/comments", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({ post_id: postId, content }),
      });
      const body = await res.json().catch(() => null) as unknown;
      if (!res.ok) {
        const serverMessage = body
          && typeof body === "object"
          && "error" in body
          && typeof body.error === "string"
          ? body.error
          : "댓글 작성에 실패했어요.";
        throw new Error(serverMessage);
      }
      if (
        !body
        || typeof body !== "object"
        || !("post_comment_count" in body)
        || !Number.isSafeInteger(body.post_comment_count)
        || (body.post_comment_count as number) < 0
      ) throw new Error("댓글 저장 결과를 확인하지 못했어요.");
      if (!(await isActionOwnerCurrent(token))) return;
      commentIdempotencyRef.clearIf(idempotencyKey);
      setCommentText("");
      setPost((prev) =>
        prev ? { ...prev, comment_count: body.post_comment_count as number } : prev
      );
      void loadComments(token.ownerId, loadSequenceRef.current, { silent: true });
    } catch (error) {
      if (!(await isActionOwnerCurrent(token))) return;
      // 길이만 보면 짧은 영어 문장이 그대로 통과한다("Network request failed").
      const message = toKoreanErrorMessage(error, "댓글 작성에 실패했어요.");
      showActionNotice(`${message} 입력한 내용은 유지했어요.`);
    } finally {
      const shouldCommit = await isActionOwnerCurrent(token);
      actionGateRef.finish(token);
      if (shouldCommit) setSubmitting(false);
    }
  }

  function openSafetyMenu(target: CommunitySafetyTarget) {
    const identity = actionGateRef.capture();
    if (!identity) {
      Alert.alert("로그인 필요", "신고하거나 차단하려면 로그인이 필요합니다.");
      return;
    }
    if (identity.ownerId === target.userId.toLowerCase()) return;
    setSafetyError(null);
    setSafetyTarget(target);
  }

  async function handleSafetyReport(reason: CommunityReportReason) {
    const identity = actionGateRef.capture();
    const target = safetyTarget;
    if (!identity || !target || safetyBusy) return;

    setSafetyBusy(true);
    setSafetyError(null);
    try {
      const path = target.kind === "post"
        ? `/api/community/posts/${target.contentId}/report`
        : `/api/community/comments/${target.contentId}/report`;
      const response = await apiFetchForExpectedUser(identity.ownerId, path, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      const body = await response.json().catch(() => ({})) as {
        error?: string;
      };
      if (!(await isIdentityOwnerCurrent(identity))) return;
      if (!response.ok) {
        setSafetyError(
          typeof body.error === "string"
            ? body.error
            : "신고를 접수하지 못했어요. 다시 시도해 주세요.",
        );
        return;
      }
      setSafetyTarget(null);
      showActionNotice(
        "신고를 접수했어요. 신고만으로 잘못을 확정하거나 바로 숨기지는 않아요.",
      );
    } catch {
      if (await isIdentityOwnerCurrent(identity)) {
        setSafetyError(
          "신고를 접수하지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요.",
        );
      }
    } finally {
      if (await isIdentityOwnerCurrent(identity)) setSafetyBusy(false);
    }
  }

  async function handleSafetyBlock() {
    const identity = actionGateRef.capture();
    const target = safetyTarget;
    if (!identity || !target || safetyBusy) return;

    setSafetyBusy(true);
    setSafetyError(null);
    try {
      const response = await apiFetchForExpectedUser(
        identity.ownerId,
        "/api/community/blocks",
        {
          method: "POST",
          body: JSON.stringify({
            blocked_user_id: target.userId,
            blocked: true,
          }),
        },
      );
      const body = await response.json().catch(() => ({})) as {
        ok?: boolean;
        blocked_user_id?: string;
        blocked?: boolean;
        changed?: boolean;
        error?: string;
      };
      if (!(await isIdentityOwnerCurrent(identity))) return;
      if (
        !response.ok
        || body.ok !== true
        || body.blocked_user_id?.toLowerCase() !== target.userId.toLowerCase()
        || body.blocked !== true
        || typeof body.changed !== "boolean"
      ) {
        setSafetyError(
          typeof body.error === "string"
            ? body.error
            : "차단 설정 결과를 확인하지 못했어요. 다시 시도해 주세요.",
        );
        return;
      }

      clearCommunityCaches();
      setSafetyTarget(null);
      if (target.kind === "post") {
        Alert.alert(
          "차단했어요",
          "로그인한 커뮤니티에서 서로의 활동과 새 연락을 숨겼어요.",
          [{
            text: "확인",
            onPress: () => router.replace("/(tabs)/community"),
          }],
        );
        return;
      }

      // 답글까지 숨긴다. 그 사람의 답변 아래 달린 답글도 함께 빠진다(웹과 같다).
      const { removedCount } = hideCommunityCommentsByAuthor(comments, target.userId);
      setComments((current) => hideCommunityCommentsByAuthor(current, target.userId).comments);
      setPost((current) => current ? {
        ...current,
        comment_count: Math.max(0, current.comment_count - removedCount),
      } : current);
      showActionNotice("차단한 회원의 답변을 숨겼어요. 차단 목록은 내 설정에서 바꿀 수 있어요.");
    } catch {
      if (await isIdentityOwnerCurrent(identity)) {
        setSafetyError(
          "차단 설정을 저장하지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요.",
        );
      }
    } finally {
      if (await isIdentityOwnerCurrent(identity)) setSafetyBusy(false);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <LoadingState label="게시글을 불러오고 있어요" />
      </SafeAreaView>
    );
  }

  if (postLoadFailure === "load_failed") {
    return (
      <SafeAreaView style={styles.container}>
        <AppHeader title="게시글" onBack={() => router.back()} />
        <ErrorRetry
          message="게시글을 불러오지 못했어요. 댓글이 없는 상태와는 다른 오류예요."
          onRetry={() => void loadPost()}
        />
      </SafeAreaView>
    );
  }

  if (!post) {
    const needsLogin = postLoadFailure === "auth_required";
    return (
      <SafeAreaView style={styles.container}>
        <AppHeader title="게시글" onBack={() => router.back()} />
        <EmptyState
          icon={<FileText size={48} color={colors.textTertiary} />}
          title={needsLogin ? "로그인이 필요한 글이에요" : "현재 볼 수 없는 게시글이에요"}
          description={needsLogin
            ? "로그인한 뒤 공개 범위를 다시 확인해 주세요."
            : "삭제·숨김 또는 공개 범위 제한일 수 있어요. 네트워크 오류로 처리된 것은 아니에요."}
        />
      </SafeAreaView>
    );
  }

  const votes = post.upvote_count;
  const catLabel = CATEGORY_LABELS[post.category] ?? post.category;
  const authorName = post.author?.nickname ?? "익명";
  const viewerIdentity = actionGateRef.capture();
  const canManagePostAuthor = Boolean(
    viewerIdentity
    && post.author_id
    && viewerIdentity.ownerId !== post.author_id.toLowerCase(),
  );

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <AppHeader
        title="게시글"
        onBack={() => router.back()}
        right={
          <View style={styles.headerActions}>
            <Animated.View style={{ transform: [{ scale: bookmarkScale }] }}>
              <Pressable
                onPress={handleBookmark}
                hitSlop={12}
                disabled={bookmarkSyncing || voteSyncing}
                style={(bookmarkSyncing || voteSyncing) && styles.actionDisabled}
                accessibilityRole="button"
                accessibilityLabel={bookmarked ? "북마크 해제" : "북마크"}
              >
                <Bookmark
                  size={22}
                  color={bookmarked ? colors.rose[700] : colors.textTertiary}
                  fill={bookmarked ? colors.rose[700] : "none"}
                />
              </Pressable>
            </Animated.View>
            {canManagePostAuthor ? (
              <Pressable
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="게시글 안전 메뉴"
                onPress={() => openSafetyMenu({
                  kind: "post",
                  contentId: post.id,
                  userId: post.author_id,
                  nickname: authorName,
                })}
              >
                <MoreHorizontal size={22} color={colors.textTertiary} />
              </Pressable>
            ) : null}
          </View>
        }
      />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
          <View style={styles.trustSummary}>
            <CommunityTrustBadges
              contentOrigin={post.content_origin}
              adDisclosure={post.ad_disclosure}
              sponsorshipDetail={post.sponsorship_detail}
              isResolved={post.is_resolved}
              underReview={post.under_review}
              showDisclosureDetail
            />
          </View>

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

          {post.decisionThreadId ? (
            <View style={styles.decisionThreadLink}>
              <ActionRow
                icon={<FileText size={18} color={colors.noir[800]} />}
                title="결정 흐름으로 보기"
                description="조건·사람 답변·다음 행동·결과를 이어서 봐요."
                onPress={() => router.push({
                  pathname: "/community/decision/[id]" as never,
                  params: { id: post.decisionThreadId } as never,
                })}
              />
            </View>
          ) : null}

          {/* 액션 바 */}
          <View style={styles.actions}>
            <View style={styles.voteGroup}>
              <Animated.View style={{ transform: [{ scale: upScale }] }}>
                <Pressable
                  onPress={handleVote}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={userVote === 1 ? "추천 취소" : "추천"}
                  accessibilityState={{ selected: userVote === 1, disabled: voteSyncing || bookmarkSyncing }}
                  disabled={voteSyncing || bookmarkSyncing}
                  style={[
                    styles.voteBtn,
                    userVote === 1 && styles.voteBtnActive,
                    (voteSyncing || bookmarkSyncing) && styles.actionDisabled,
                  ]}
                >
                  <ChevronUp
                    size={20}
                    color={userVote === 1 ? colors.rose[700] : colors.textTertiary}
                  />
                </Pressable>
              </Animated.View>
              <Text style={[
                styles.voteCount,
                userVote === 1 && { color: colors.rose[700] },
              ]}>{votes}</Text>
            </View>
            <View style={styles.actionGroup}>
              <MessageCircle size={18} color={colors.textTertiary} />
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
            <Text style={styles.commentsTitle}>댓글 {countVisibleCommunityComments(comments)}개</Text>
            {commentsLoading && comments.length === 0 && (
              <View style={styles.commentsLoadingWrap}>
                <ActivityIndicator size="small" color={colors.rose[500]} />
                <Text style={styles.commentsLoadingText}>댓글을 불러오는 중이에요</Text>
              </View>
            )}
            {comments.map((c) => (
              <CommunityCommentItem
                key={c.id}
                comment={c}
                viewerOwnerId={viewerIdentity?.ownerId ?? null}
                timeLabel={timeAgo}
                onOpenSafetyMenu={openSafetyMenu}
              />
            ))}
            {!commentsLoading && commentsLoadFailed && (
              <View style={styles.commentsErrorWrap}>
                <Text style={styles.commentsErrorText}>
                  댓글을 불러오지 못했어요. 아직 댓글이 없다는 뜻은 아니에요.
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="댓글 다시 불러오기"
                  style={styles.commentsRetryButton}
                  onPress={() => {
                    const identity = actionGateRef.capture();
                    void loadComments(identity?.ownerId ?? null, loadSequenceRef.current);
                  }}
                >
                  <Text style={styles.commentsRetryText}>다시 시도</Text>
                </Pressable>
              </View>
            )}
            {!commentsLoading && !commentsLoadFailed && comments.length === 0 && (
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
            placeholderTextColor={colors.paper.inkFaint}
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
            accessibilityRole="button"
            accessibilityLabel="댓글 등록"
            accessibilityState={{ disabled: !commentText.trim() || submitting, busy: submitting }}
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
      <CommunitySafetySheet
        target={safetyTarget}
        busy={safetyBusy}
        error={safetyError}
        onClose={() => {
          if (safetyBusy) return;
          setSafetyTarget(null);
          setSafetyError(null);
        }}
        onReport={(reason) => void handleSafetyReport(reason)}
        onBlock={() => void handleSafetyBlock()}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingBottom: 40 },
  trustSummary: { marginBottom: 12 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 18 },

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
  catBadgeText: { fontSize: 13, fontWeight: "600", color: colors.rose[700] },

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
  dot: { fontSize: 12, color: colors.paper.inkFaint },
  time: { fontSize: 13, color: colors.paper.inkFaint },

  body: { fontSize: 15, color: colors.noir[800], lineHeight: 28, marginBottom: 24 },

  decisionThreadLink: {
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
    marginBottom: 8,
  },

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
  actionLabel: { fontSize: 13, color: colors.paper.inkFaint },
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
  noCommentsWrap: {
    alignItems: "center",
    paddingVertical: 32,
    gap: 8,
  },
  noComments: { fontSize: 13, color: colors.paper.inkFaint, textAlign: "center" },
  commentsLoadingWrap: {
    alignItems: "center",
    paddingVertical: 28,
    gap: 8,
  },
  commentsLoadingText: { fontSize: 13, color: colors.paper.inkFaint },
  commentsErrorWrap: {
    alignItems: "center",
    paddingVertical: 28,
    paddingHorizontal: 16,
    gap: 12,
  },
  commentsErrorText: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 20,
    textAlign: "center",
  },
  commentsRetryButton: {
    minHeight: 44,
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 18,
    backgroundColor: colors.surface,
  },
  commentsRetryText: {
    color: colors.noir[800],
    fontSize: 13,
    fontWeight: "700",
  },

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
