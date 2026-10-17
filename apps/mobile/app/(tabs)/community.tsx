// 커뮤니티 홈 — 프리미엄 웨딩 SNS
import { useEffect, useState, useCallback, useRef } from "react";
import { View, FlatList, ScrollView, StyleSheet, Pressable, RefreshControl, Animated, Image } from "react-native";
import { Text } from "@/components/ui/AppText";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";
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
import { communityContentText } from "@hanbang/shared/community-content-text";
import {
  parseCommunityDecisionFeed,
  parseCommunityDecisionInbox,
  type CommunityDecisionFeed,
  type CommunityDecisionFeedMode,
  type CommunityDecisionInbox,
} from "@hanbang/shared/community-decision-feed";
import { apiJson, optionalAuthGetJson } from "@/lib/api";
import {
  captureCommunityCacheScope,
  getCachedCommunityCohort,
  getCachedCommunityFeed,
  isCommunityCacheScopeCurrent,
  putCachedCommunityCohort,
  putCachedCommunityPost,
  putCachedCommunityFeed,
  putCachedCommunityPosts,
} from "@/lib/communityPostCache";
import ErrorRetry from "@/components/ErrorRetry";
import {
  CommunityAvatar,
  type CommunityAvatarRole,
} from "@/components/community/CommunityAvatar";
import { CommunityTrustBadges } from "@/components/community/CommunityTrustBadges";
import {
  parseCommunityPostTrust,
  type CommunityAdDisclosure,
  type CommunityContentOrigin,
} from "@/lib/communityTrust.mjs";
import {
  AppHeader,
  EmptyState,
  SectionHeader,
} from "@/components/ui/AppUI";

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
  content_origin: CommunityContentOrigin;
  ad_disclosure: CommunityAdDisclosure;
  sponsorship_detail: string | null;
  is_resolved: boolean;
  under_review: boolean;
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

type ApiPostItem = PostItem & {
  images?: string[] | null;
};

/* ───── 상수 ───── */

const CATEGORY_LABELS: Record<string, string> = {
  is_normal: "이거 정상이야?",
  tour_review: "투어/후기",
  tips_v2: "꿀팁",
  ama: "AMA",
  free: "자유",
};

const CATEGORIES = ["all", "is_normal", "tour_review", "tips_v2", "ama", "free"];
const POSTS_INITIAL_LIMIT = 12;

const DECISION_MODE_LABELS: Record<CommunityDecisionFeedMode, string> = {
  for_you: "둘러보기",
  needs_help: "내 경험 필요",
  outcomes: "결과",
};

const DECISION_STATE_LABELS: Record<string, string> = {
  open: "경험 답변 기다리는 중",
  answered: "경험 답변 도착",
  resolved: "실행해 보는 중",
  followup_scheduled: "결과 기다리는 중",
  completed: "결과 기록됨",
  closed: "마감",
};

const DECISION_STAGE_LABELS: Record<string, string> = {
  vendor_search: "업체 탐색",
  contract_review: "계약 검토",
  contracted: "계약 후",
  dispute_or_cancellation: "분쟁·취소",
};

async function fetchPostsFromApi(cat: string): Promise<PostItem[]> {
  const params = cat === "all" ? "" : `&category=${cat}`;
  const data = await optionalAuthGetJson<{ posts?: unknown }>(
    `/api/community/posts?sort=new&limit=${POSTS_INITIAL_LIMIT}${params}`
  );
  if (!Array.isArray(data.posts)) throw new Error("community feed contract invalid");

  return data.posts.map((rawPost) => {
    const trust = parseCommunityPostTrust(rawPost);
    if (!trust || !rawPost || typeof rawPost !== "object" || Array.isArray(rawPost)) {
      throw new Error("community feed trust metadata invalid");
    }
    const post = rawPost as ApiPostItem;
    return {
      ...post,
      content_origin: trust.contentOrigin,
      ad_disclosure: trust.adDisclosure,
      sponsorship_detail: trust.sponsorshipDetail,
      is_resolved: trust.isResolved,
      under_review: trust.underReview,
      image_urls: post.image_urls ?? post.images ?? [],
    };
  });
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
          <Users size={20} color={colors.paper.tapeInk} />
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

        <ChevronRight size={20} color={colors.textTertiary} />
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
        <Text style={styles.cohortCtaSub}>결혼식 분기별로 방이 나뉘어 있어요</Text>
      </View>
      <ChevronRight size={18} color={colors.textTertiary} />
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
            <Text style={styles.exploreRoomName} numberOfLines={2}>
              {room.name}
            </Text>
            <View style={styles.exploreStats}>
              <View style={styles.exploreStat}>
                <Users size={12} color={colors.textTertiary} />
                <Text style={styles.exploreStatText}>{room.member_count}명</Text>
              </View>
              <View style={styles.exploreStat}>
                <MessageCircle size={12} color={colors.textTertiary} />
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
      icon: <MessageSquarePlus size={14} color={colors.rose[500]} />,
      label: "자유 글쓰기",
      onPress: () => router.push({ pathname: "/community/post/write" }),
    },
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
      icon: <Bookmark size={14} color={colors.paper.tapeInk} />,
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

type DecisionFeedItem = CommunityDecisionFeed["items"][number];
type DecisionCommercialRelationship = DecisionFeedItem["commercialRelationship"];

const DECISION_COMMERCIAL_RELATIONSHIP_LABELS: Record<
  DecisionCommercialRelationship,
  string
> = {
  none: "없음",
  gift: "제품·서비스 제공",
  discount: "할인·혜택 제공",
  refund: "비용 환급",
  affiliate: "제휴 수익 발생",
  paid: "원고료·광고비 지급",
  employee: "업체 임직원",
  owner_or_family: "업체 소유주·가족",
  platform_research_compensation: "플랫폼 조사 참여 보상",
};

function commercialRelationshipSummary(
  relationship: DecisionCommercialRelationship,
  sponsorshipDetail: string | null,
) {
  const detail = sponsorshipDetail?.trim();
  return [
    DECISION_COMMERCIAL_RELATIONSHIP_LABELS[relationship],
    detail ? `상세 ${detail}` : null,
  ].filter((value): value is string => value !== null).join(" · ");
}

function DecisionThreadCard({ item }: { item: DecisionFeedItem }) {
  const condition = [
    item.coarseRegion,
    DECISION_STAGE_LABELS[item.preparationStage] ?? item.preparationStage,
  ].filter(Boolean).join(" · ");
  const totalAnswers =
    item.qualifiedPeerAnswerCount + item.qualifiedProfessionalAnswerCount;
  const questionDisclosure = item.commercialRelationship !== "none"
    || Boolean(item.sponsorshipDetail?.trim())
    ? `질문 이해관계 공개 · ${commercialRelationshipSummary(
        item.commercialRelationship,
        item.sponsorshipDetail,
      )}`
    : null;
  const outcomeDisclosure = item.outcome
    ? `결과 이해관계 공개 · ${commercialRelationshipSummary(
        item.outcome.commercialRelationship,
        item.outcome.sponsorshipDetail,
      )}`
    : null;
  const accessibilityParts = [
    item.title,
    DECISION_STATE_LABELS[item.state] ?? item.state,
    condition || "조건 정보 없음",
    `찾는 답 ${item.desiredAnswer}`,
  ];
  if (questionDisclosure) accessibilityParts.push(questionDisclosure);
  if (item.outcome) {
    accessibilityParts.push(
      `작성자가 돌아와 남긴 결과 ${item.outcome.resultSummary}`,
      `적용 조건 ${item.outcome.applicableConditions}`,
    );
  }
  if (outcomeDisclosure) accessibilityParts.push(outcomeDisclosure);
  accessibilityParts.push(totalAnswers > 0
    ? `자격·조건 확인 답변 ${totalAnswers}개`
    : "자격·조건 확인 답변을 기다리는 중");

  return (
    <Pressable
      style={({ pressed }) => [
        styles.decisionCard,
        pressed && styles.decisionCardPressed,
      ]}
      onPress={() => router.push({
        pathname: "/community/decision/[id]" as never,
        params: { id: item.threadId },
      })}
      accessibilityRole="button"
      accessibilityLabel={accessibilityParts.join(". ")}
    >
      <View style={styles.decisionMetaRow}>
        <View style={styles.decisionStateBadge}>
          <Text style={styles.decisionStateText}>
            {DECISION_STATE_LABELS[item.state] ?? item.state}
          </Text>
        </View>
        <Text style={styles.decisionOrigin}>회원 작성 · {item.author.nickname}</Text>
      </View>

      <Text style={styles.decisionTitle} numberOfLines={2}>{item.title}</Text>
      <Text style={styles.decisionCondition} numberOfLines={1}>
        {condition || "조건 정보 없음"}
      </Text>

      <View style={styles.decisionQuestionBox}>
        <Text style={styles.decisionQuestionLabel}>이 답을 찾고 있어요</Text>
        <Text style={styles.decisionQuestionText} numberOfLines={2}>
          {item.desiredAnswer}
        </Text>
      </View>

      {questionDisclosure && (
        <Text
          style={styles.decisionDisclosure}
          numberOfLines={3}
          accessibilityLabel={questionDisclosure}
        >
          {questionDisclosure}
        </Text>
      )}

      {item.outcome && (
        <View style={styles.decisionOutcomeBox}>
          <Text style={styles.decisionOutcomeLabel}>작성자가 돌아와 남긴 결과</Text>
          <Text style={styles.decisionOutcomeText} numberOfLines={3}>
            {item.outcome.resultSummary}
          </Text>
          <Text style={styles.decisionOutcomeCondition} numberOfLines={2}>
            적용 조건 · {item.outcome.applicableConditions}
          </Text>
          {outcomeDisclosure && (
            <Text
              style={[styles.decisionDisclosure, styles.decisionOutcomeDisclosure]}
              numberOfLines={3}
              accessibilityLabel={outcomeDisclosure}
            >
              {outcomeDisclosure}
            </Text>
          )}
        </View>
      )}

      <View style={styles.decisionFooterRow}>
        <Text style={styles.decisionAnswerCount}>
          {totalAnswers > 0
            ? `자격·조건 확인 답변 ${totalAnswers}개`
            : "자격·조건 확인 답변을 기다리는 중"}
        </Text>
        <ChevronRight size={17} color={colors.textTertiary} />
      </View>
    </Pressable>
  );
}

function DecisionInboxLink({
  label,
  count,
  targetId,
}: {
  label: string;
  count: number;
  targetId: string;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.decisionInboxLink,
        pressed && styles.decisionInboxLinkPressed,
      ]}
      onPress={() => router.push({
        pathname: "/community/decision/[id]" as never,
        params: { id: targetId },
      })}
      accessibilityRole="button"
      accessibilityLabel={`${label} ${count}개`}
    >
      <View style={styles.decisionInboxTextWrap}>
        <Text style={styles.decisionInboxLabel}>{label}</Text>
        <Text style={styles.decisionInboxCount}>{count}</Text>
      </View>
      <ChevronRight size={16} color={colors.textTertiary} />
    </Pressable>
  );
}

/* ───── 메인 화면 ───── */

export default function CommunityScreen() {
  const [initialCohortCache] = useState(() =>
    getCachedCommunityCohort<MyCohort, CohortRoom>(),
  );
  const [posts, setPosts] = useState<PostItem[]>(() => getCachedCommunityFeed<PostItem>("all") ?? []);
  const [loading, setLoading] = useState(() => !getCachedCommunityFeed<PostItem>("all"));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [category, setCategory] = useState("all");
  const [myCohort, setMyCohort] = useState<MyCohort | null>(initialCohortCache?.myCohort ?? null);
  const [cohortRooms, setCohortRooms] = useState<CohortRoom[]>(initialCohortCache?.cohortRooms ?? []);
  const [cohortLoading, setCohortLoading] = useState(() => !initialCohortCache);
  const [decisionMode, setDecisionMode] = useState<CommunityDecisionFeedMode>("for_you");
  const [decisionFeed, setDecisionFeed] = useState<CommunityDecisionFeed | null>(null);
  const [decisionInbox, setDecisionInbox] = useState<CommunityDecisionInbox | null>(null);
  const [decisionInboxError, setDecisionInboxError] = useState(false);
  const [decisionLoading, setDecisionLoading] = useState(true);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const feedListRef = useRef<FlatList<PostItem>>(null);
  const fabScale = useRef(new Animated.Value(1)).current;
  const hasFocusedRef = useRef(false);
  const decisionRequestSequence = useRef(0);

  // 게시글 로드
  const loadPosts = useCallback(async (cat: string, options?: { silent?: boolean }) => {
    const cacheScope = captureCommunityCacheScope();
    try {
      setError(false);
      const nextPosts = await fetchPostsFromApi(cat);

      if (!isCommunityCacheScopeCurrent(cacheScope)) return;

      putCachedCommunityFeed(cat, nextPosts, cacheScope);
      putCachedCommunityPosts(nextPosts, cacheScope);
      setPosts(nextPosts);
    } catch {
      if (!isCommunityCacheScopeCurrent(cacheScope)) return;
      if (!options?.silent) setPosts([]);
      if (!options?.silent) setError(true);
    } finally {
      if (isCommunityCacheScopeCurrent(cacheScope)) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  // 동기방 로드
  const loadCohortData = useCallback(async (options?: { silent?: boolean }) => {
    const cacheScope = captureCommunityCacheScope();
    const cachedCohort = getCachedCommunityCohort<MyCohort, CohortRoom>();
    if (cachedCohort && !options?.silent) {
      setMyCohort(cachedCohort.myCohort);
      setCohortRooms(cachedCohort.cohortRooms);
      setCohortLoading(false);
      return;
    }

    try {
      const cohortData = await apiJson<{
        room: CohortRoom | null;
        availableRooms?: CohortRoom[];
      }>("/api/community/cohort");
      if (!isCommunityCacheScopeCurrent(cacheScope)) return;

      const nextMyCohort = cohortData.room
        ? {
            room_id: cohortData.room.id,
            room: cohortData.room,
          }
        : null;
      const nextRooms = cohortData.availableRooms ?? [];

      putCachedCommunityCohort({
        myCohort: nextMyCohort,
        cohortRooms: nextRooms,
      }, cacheScope);

      setMyCohort(nextMyCohort);
      setCohortRooms(nextRooms);
    } catch {
      // 동기방 로드 실패 시 무시
    } finally {
      if (isCommunityCacheScopeCurrent(cacheScope)) {
        setCohortLoading(false);
      }
    }
  }, []);

  const loadDecisionData = useCallback(async (
    mode: CommunityDecisionFeedMode,
    options?: { silent?: boolean },
  ) => {
    const requestSequence = ++decisionRequestSequence.current;
    const cacheScope = captureCommunityCacheScope();
    if (!options?.silent) {
      setDecisionFeed(null);
      setDecisionError(null);
      setDecisionInboxError(false);
      setDecisionLoading(true);
    }

    const [feedResult, inboxResult] = await Promise.allSettled([
      optionalAuthGetJson<unknown>(`/api/community/decision-threads?mode=${mode}&limit=6`),
      apiJson<unknown>("/api/community/decision-threads/inbox"),
    ]);
    if (
      requestSequence !== decisionRequestSequence.current
      || !isCommunityCacheScopeCurrent(cacheScope)
    ) return;

    if (feedResult.status === "fulfilled") {
      const parsedFeed = parseCommunityDecisionFeed(feedResult.value, mode);
      if (parsedFeed) {
        setDecisionFeed(parsedFeed);
        setDecisionError(null);
      } else if (!options?.silent) {
        setDecisionFeed(null);
        setDecisionError("결정 질문 응답을 확인하지 못했어요.");
      }
    } else if (!options?.silent) {
      setDecisionFeed(null);
      const message = feedResult.reason instanceof Error
        && feedResult.reason.message.includes("로그인")
        ? feedResult.reason.message
        : "결정 질문을 불러오지 못했어요.";
      setDecisionError(message);
    }

    if (inboxResult.status === "fulfilled") {
      const parsedInbox = parseCommunityDecisionInbox(inboxResult.value);
      if (parsedInbox) {
        setDecisionInbox(parsedInbox);
        setDecisionInboxError(false);
      } else {
        if (!options?.silent) setDecisionInbox(null);
        setDecisionInboxError(true);
      }
    } else {
      const guestWithoutSession = inboxResult.reason instanceof Error
        && inboxResult.reason.message === "로그인이 필요합니다.";
      if (guestWithoutSession) {
        setDecisionInbox(null);
        setDecisionInboxError(false);
      } else {
        if (!options?.silent) setDecisionInbox(null);
        setDecisionInboxError(true);
      }
    }
    setDecisionLoading(false);
  }, []);

  useEffect(() => {
    const cachedPosts = getCachedCommunityFeed<PostItem>(category);
    if (cachedPosts) {
      setPosts(cachedPosts);
      setLoading(false);
      setError(false);
      loadPosts(category, { silent: true });
      return;
    }

    setLoading(true);
    loadPosts(category);
  }, [category, loadPosts]);

  useEffect(() => {
    void loadDecisionData(decisionMode);
  }, [decisionMode, loadDecisionData]);

  useFocusEffect(
    useCallback(() => {
      if (!hasFocusedRef.current) {
        hasFocusedRef.current = true;
        return;
      }

      loadPosts(category, { silent: true });
      loadCohortData({ silent: true });
      void loadDecisionData(decisionMode, { silent: true });
    }, [category, decisionMode, loadCohortData, loadDecisionData, loadPosts])
  );

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
    loadCohortData({ silent: true });
    void loadDecisionData(decisionMode, { silent: true });
  }

  function handleDecisionModeChange(mode: CommunityDecisionFeedMode) {
    if (mode === decisionMode) return;
    decisionRequestSequence.current += 1;
    setDecisionFeed(null);
    setDecisionError(null);
    setDecisionLoading(true);
    setDecisionMode(mode);
  }

  /* ── PostCard 렌더 ── */

  function renderPost({ item }: { item: PostItem }) {
    const catLabel = CATEGORY_LABELS[item.category] ?? item.category;
    const preview = communityContentText(item.content).slice(0, 100);
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
        onPress={() => {
          putCachedCommunityPost(item);
          router.push({ pathname: "/community/post/[id]", params: { id: item.id } });
        }}
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
              <Text style={styles.postAuthor} numberOfLines={1}>{nickname}</Text>
              <Text style={styles.postDot}>·</Text>
              <Text style={styles.postTime} numberOfLines={1}>{timeAgo(item.created_at)}</Text>
            </View>

            <View style={styles.postTrustRow}>
              <CommunityTrustBadges
                contentOrigin={item.content_origin}
                adDisclosure={item.ad_disclosure}
                sponsorshipDetail={item.sponsorship_detail}
                isResolved={item.is_resolved}
                underReview={item.under_review}
              />
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
            <ChevronUp size={16} color={colors.textTertiary} />
            <Text style={styles.actionText}>{votes}</Text>
          </View>
          <View style={styles.actionGroup}>
            <MessageCircle size={16} color={colors.textTertiary} />
            <Text style={styles.actionText}>{item.comment_count}</Text>
          </View>
          <View style={styles.actionGroup}>
            <Eye size={16} color={colors.textTertiary} />
            <Text style={styles.actionText}>{item.view_count}</Text>
          </View>
        </View>
      </Pressable>
    );
  }

  /* ── 피드 우선 헤더 ── */

  function renderDecisionSection() {
    const inboxCount = decisionInbox
      ? decisionInbox.waitingReplies.count
        + decisionInbox.experienceNeeded.count
        + decisionInbox.returnedOutcomes.count
      : 0;
    const visibleDecisionFeed = decisionFeed?.mode === decisionMode
      ? decisionFeed
      : null;
    const hasItems = (visibleDecisionFeed?.items.length ?? 0) > 0;
    return (
      <View style={styles.decisionSection}>
        <SectionHeader
          eyebrow="계약 앞에서 망설여질 때"
          title="계약·추가비용 결정 질문"
        />
        <Text style={styles.decisionSectionCopy}>
          비슷한 조건의 실제 경험을 보고, 선택한 답이 어떤 결과로 이어졌는지까지 확인해요.
        </Text>

        {decisionInbox && inboxCount > 0 && (
          <View style={styles.decisionInbox}>
            <Text style={styles.decisionInboxTitle}>내 결정 알림</Text>
            {decisionInbox.waitingReplies.count > 0
              && decisionInbox.waitingReplies.targetQuestionId && (
                <DecisionInboxLink
                  label="답변을 기다리는 질문"
                  count={decisionInbox.waitingReplies.count}
                  targetId={decisionInbox.waitingReplies.targetQuestionId}
                />
              )}
            {decisionInbox.experienceNeeded.count > 0
              && decisionInbox.experienceNeeded.targetThreadId && (
                <DecisionInboxLink
                  label="내 경험이 필요한 질문"
                  count={decisionInbox.experienceNeeded.count}
                  targetId={decisionInbox.experienceNeeded.targetThreadId}
                />
              )}
            {decisionInbox.returnedOutcomes.count > 0
              && decisionInbox.returnedOutcomes.targetThreadId && (
                <DecisionInboxLink
                  label="내 답변 뒤 돌아온 결과"
                  count={decisionInbox.returnedOutcomes.count}
                  targetId={decisionInbox.returnedOutcomes.targetThreadId}
                />
              )}
          </View>
        )}

        {decisionInboxError && (
          <View style={styles.decisionInboxError} accessibilityRole="alert">
            <Text style={styles.decisionEmptyTitle}>내 결정 알림을 불러오지 못했어요.</Text>
            <Text style={styles.decisionEmptyCopy}>
              알림 없음으로 처리하지 않았어요. 잠시 후 새로고침해 주세요.
            </Text>
          </View>
        )}

        <View style={styles.decisionTabs} accessibilityRole="tablist">
          {(Object.keys(DECISION_MODE_LABELS) as CommunityDecisionFeedMode[])
            .map((mode) => {
              const active = decisionMode === mode;
              return (
                <Pressable
                  key={mode}
                  style={[
                    styles.decisionTab,
                    active && styles.decisionTabActive,
                  ]}
                  onPress={() => handleDecisionModeChange(mode)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[
                    styles.decisionTabText,
                    active && styles.decisionTabTextActive,
                  ]}>
                    {DECISION_MODE_LABELS[mode]}
                  </Text>
                </Pressable>
              );
            })}
        </View>

        {decisionLoading && !visibleDecisionFeed ? (
          <Text style={styles.decisionStatusText}>결정 질문을 확인하고 있어요.</Text>
        ) : decisionError ? (
          <View style={styles.decisionEmpty} accessibilityRole="alert">
            <Text style={styles.decisionEmptyTitle}>{decisionError}</Text>
            <Text style={styles.decisionEmptyCopy}>
              불러오기 실패를 활동 없음으로 표시하지 않았어요. 잠시 후 새로고침해 주세요.
            </Text>
          </View>
        ) : hasItems ? (
          <View style={styles.decisionCardList}>
            {visibleDecisionFeed?.items.map((item) => (
              <DecisionThreadCard key={item.threadId} item={item} />
            ))}
          </View>
        ) : (
          <View style={styles.decisionEmpty}>
            <Text style={styles.decisionEmptyTitle}>
              {decisionMode === "needs_help"
                ? "지금 내 경험이 필요한 배정 질문은 없어요."
                : decisionMode === "outcomes"
                  ? "검수를 마치고 공개된 결과가 아직 없어요."
                  : "공개된 결정 질문이 아직 없어요."}
            </Text>
            <Text style={styles.decisionEmptyCopy}>
              없는 활동을 꾸며 보여주지 않고, 실제 기록이 생기면 여기에 올라와요.
            </Text>
          </View>
        )}
      </View>
    );
  }

  function renderHeader() {
    return (
      <View>
        {renderDecisionSection()}
        <View style={styles.feedIntro}>
          <SectionHeader
            eyebrow="커뮤니티 최신글"
            title={category === "all" ? "지금 올라온 이야기" : (CATEGORY_LABELS[category] ?? category)}
          />
          <Text style={styles.feedIntroCopy}>
            회원 작성 여부와 이해관계를 확인하며, 자유롭게 묻고 경험을 나눌 수 있어요.
          </Text>
        </View>
      </View>
    );
  }

  function renderDiscoveryFooter() {
    return (
      <View style={styles.discoveryFooter}>
        <View style={styles.discoveryDivider} />
        <View style={styles.discoveryHeading}>
          <SectionHeader eyebrow="보조 탐색" title="주제와 동기방 더 보기" />
          <Text style={styles.discoveryCopy}>
            먼저 실제 글을 읽고, 더 필요한 주제나 같은 시기의 동기방을 찾아보세요.
          </Text>
        </View>

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
                  onPress={() => {
                    if (cat === category) return;
                    feedListRef.current?.scrollToOffset({ offset: 0, animated: true });
                    setCategory(cat);
                  }}
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

        <QuickActionsBar />

        <View style={styles.cohortSection}>
          {cohortLoading ? null : myCohort ? (
            <MyCohortCard cohort={myCohort} />
          ) : (
            <CohortJoinCTA />
          )}
        </View>

        {!cohortLoading && <CohortExploreSection rooms={cohortRooms} />}
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <AppHeader title="커뮤니티" subtitle="경험을 찾고 궁금한 걸 물어봐요" />

      {/* 피드 */}
      {loading ? (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.feedList}>
          {renderHeader()}
          <SkeletonCard index={0} />
          <SkeletonCard index={1} />
          <SkeletonCard index={2} />
          <SkeletonCard index={3} />
          {renderDiscoveryFooter()}
        </ScrollView>
      ) : error ? (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.feedList}>
          {renderHeader()}
          <ErrorRetry
            message="게시글을 불러올 수 없어요"
            onRetry={() => {
              setLoading(true);
              loadPosts(category);
            }}
          />
          {renderDiscoveryFooter()}
        </ScrollView>
      ) : (
        <FlatList
          ref={feedListRef}
          data={posts}
          keyExtractor={(p) => p.id}
          renderItem={renderPost}
          ListHeaderComponent={renderHeader}
          ListFooterComponent={renderDiscoveryFooter}
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
            <EmptyState
              icon={<MessageSquarePlus size={40} color={colors.rose[500]} />}
              title="아직 최신 글이 없어요"
              description="아래 자유 글쓰기에서 첫 이야기를 나눌 수 있어요. 결정 질문은 오른쪽 아래 버튼으로 시작해요."
            />
          }
        />
      )}

      {/* 글쓰기 FAB */}
      <Animated.View style={[styles.fab, { transform: [{ scale: fabScale }] }]}>
        <Pressable
          style={styles.fabInner}
          onPress={() => router.push("/community/decision/write" as never)}
          onPressIn={handleFabPressIn}
          onPressOut={handleFabPressOut}
          accessibilityRole="button"
          accessibilityLabel="경험 기반 결정 질문 쓰기"
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

  decisionSection: {
    paddingTop: 18,
    paddingBottom: 18,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  decisionSectionCopy: {
    marginTop: -6,
    paddingHorizontal: 20,
    fontSize: 13,
    lineHeight: 20,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
  },
  decisionInbox: {
    marginHorizontal: 20,
    marginTop: 14,
    padding: 12,
    gap: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.gold.DEFAULT + "35",
    backgroundColor: colors.gold.DEFAULT + "0D",
  },
  decisionInboxTitle: {
    marginBottom: 2,
    fontSize: 12,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.noir[800],
  },
  decisionInboxError: {
    marginHorizontal: 20,
    marginTop: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.rose[500] + "35",
    backgroundColor: colors.rose[500] + "0A",
  },
  decisionInboxLink: {
    minHeight: 40,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 10,
    backgroundColor: colors.surface,
  },
  decisionInboxLinkPressed: {
    opacity: 0.72,
  },
  decisionInboxTextWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  decisionInboxLabel: {
    fontSize: 13,
    fontFamily: "NotoSansKR_500Medium",
    color: colors.noir[800],
  },
  decisionInboxCount: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 11,
    overflow: "hidden",
    textAlign: "center",
    fontSize: 12,
    lineHeight: 22,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.rose[700],
    backgroundColor: colors.rose[500] + "14",
  },
  decisionTabs: {
    marginTop: 16,
    marginHorizontal: 20,
    padding: 4,
    flexDirection: "row",
    gap: 4,
    borderRadius: 13,
    backgroundColor: colors.ivory[200],
  },
  decisionTab: {
    flex: 1,
    minHeight: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
  },
  decisionTabActive: {
    backgroundColor: colors.surface,
    shadowColor: colors.noir[800],
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 1,
  },
  decisionTabText: {
    fontSize: 13,
    fontFamily: "NotoSansKR_500Medium",
    color: colors.taupe[500],
  },
  decisionTabTextActive: {
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.noir[800],
  },
  decisionCardList: {
    marginTop: 12,
    paddingHorizontal: 20,
    gap: 10,
  },
  decisionCard: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  decisionCardPressed: {
    opacity: 0.78,
    transform: [{ scale: 0.99 }],
  },
  decisionMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  decisionStateBadge: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: colors.rose[500] + "12",
  },
  decisionStateText: {
    fontSize: 11,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.rose[700],
  },
  decisionOrigin: {
    flexShrink: 1,
    fontSize: 11,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.taupe[500],
  },
  decisionTitle: {
    marginTop: 12,
    fontSize: 17,
    lineHeight: 24,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.noir[800],
  },
  decisionCondition: {
    marginTop: 5,
    fontSize: 12,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
  },
  decisionQuestionBox: {
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: colors.ivory[100],
  },
  decisionQuestionLabel: {
    fontSize: 11,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.taupe[500],
  },
  decisionQuestionText: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 20,
    fontFamily: "NotoSansKR_500Medium",
    color: colors.noir[800],
  },
  decisionOutcomeBox: {
    marginTop: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.gold.DEFAULT + "35",
    backgroundColor: colors.gold.DEFAULT + "0D",
  },
  decisionOutcomeLabel: {
    fontSize: 11,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.paper.tapeInk,
  },
  decisionOutcomeText: {
    marginTop: 5,
    fontSize: 13,
    lineHeight: 20,
    fontFamily: "NotoSansKR_500Medium",
    color: colors.noir[800],
  },
  decisionOutcomeCondition: {
    marginTop: 6,
    fontSize: 11,
    lineHeight: 17,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
  },
  decisionDisclosure: {
    marginTop: 10,
    fontSize: 11,
    lineHeight: 17,
    fontFamily: "NotoSansKR_500Medium",
    color: colors.rose[700],
  },
  decisionOutcomeDisclosure: {
    marginTop: 8,
  },
  decisionFooterRow: {
    marginTop: 13,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  decisionAnswerCount: {
    fontSize: 12,
    fontFamily: "NotoSansKR_500Medium",
    color: colors.textSecondary,
  },
  decisionStatusText: {
    paddingHorizontal: 20,
    paddingTop: 16,
    fontSize: 13,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
  },
  decisionEmpty: {
    marginHorizontal: 20,
    marginTop: 12,
    padding: 16,
    borderRadius: 14,
    backgroundColor: colors.ivory[100],
  },
  decisionEmptyTitle: {
    fontSize: 13,
    lineHeight: 20,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.noir[800],
  },
  decisionEmptyCopy: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
  },

  feedIntro: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 2,
  },
  feedIntroCopy: {
    marginTop: -6,
    fontSize: 13,
    lineHeight: 20,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
  },
  discoveryFooter: {
    paddingTop: 24,
    paddingBottom: 20,
  },
  discoveryDivider: {
    height: 1,
    marginHorizontal: 20,
    marginBottom: 24,
    backgroundColor: colors.border,
  },
  discoveryHeading: {
    paddingHorizontal: 20,
  },
  discoveryCopy: {
    marginTop: -6,
    fontSize: 13,
    lineHeight: 20,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
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
    shadowColor: colors.paper.ink,
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
  exploreSection: { paddingTop: 16 },
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
    color: colors.rose[700],
    fontWeight: "500",
  },
  exploreScroll: { paddingHorizontal: 20, gap: 12 },
  exploreCard: {
    width: 174,
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: colors.paper.ink,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  exploreMonth: {
    fontSize: 12,
    fontWeight: "500",
    color: colors.rose[700],
    marginBottom: 4,
  },
  exploreRoomName: {
    minHeight: 42,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "600",
    color: colors.noir[800],
    marginBottom: 8,
  },
  exploreStats: { flexDirection: "row", gap: 12, marginBottom: 12 },
  exploreStat: { flexDirection: "row", alignItems: "center", gap: 4 },
  exploreStatText: {
    fontSize: 12,
    color: colors.textSecondary,
    fontFamily: "NotoSansKR_500Medium",
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
    shadowColor: colors.paper.ink,
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
  },
  postCatBadge: {
    backgroundColor: colors.rose.glow,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  postCat: { fontSize: 12, fontWeight: "700", color: colors.rose[700] },
  postDot: { fontSize: 12, color: colors.paper.inkFaint },
  postAuthor: {
    fontSize: 12,
    fontWeight: "500",
    color: colors.noir[800],
    flexShrink: 1,
    maxWidth: 110,
  },
  postTime: { fontSize: 12, color: colors.paper.inkFaint, flexShrink: 0 },
  postTrustRow: { marginBottom: 9 },

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

  // FAB
  fab: {
    position: "absolute",
    right: 18,
    bottom: 112,
    shadowColor: colors.paper.ink,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 8,
  },
  fabInner: {
    width: 52,
    height: 52,
    borderRadius: 26,
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
