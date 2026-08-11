// 앱 가이드 — 첫 실행 시 표시되는 풀스크린 스와이프 온보딩
// 실제 앱 화면을 축소한 MOCK UI 프리뷰 포함
import { useCallback, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  FlatList,
  Platform,
  useWindowDimensions,
  type ViewToken,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  Heart,
  MessageCircle,
  Users,
  Sparkles,
  Wallet,
  CalendarDays,
  ChevronUp,
  MessageSquare,
  AlertTriangle,
  Check,
  Circle,
  Crown,
} from "lucide-react-native";
import { colors, spacing, radius, fontSize } from "@hanbang/design-tokens";

const MAX_GUIDE_WIDTH = 430;
const ASYNC_KEY = "@hanbang/app_guide_seen";

interface MockSlideProps {
  mockWidth: number;
}

// ─────────────────────────────────────────────
// Slide 1: Welcome
// ─────────────────────────────────────────────
function WelcomeSlide() {
  return (
    <View style={styles.slideInner}>
      {/* 메인 아이콘 */}
      <View style={styles.welcomeIconCircle}>
        <Heart size={40} color="#FFFFFF" />
      </View>

      <Text style={styles.welcomeTitle}>웨딩한방</Text>
      <Text style={styles.welcomeSubtitle}>
        결혼 준비, 아모라와 처음부터 끝까지
      </Text>

      {/* 피처 배지 3개 */}
      <View style={styles.badgeRow}>
        {["아모라", "할 일·일정", "예산"].map((label) => (
          <View key={label} style={styles.badge}>
            <Text style={styles.badgeText}>{label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────
// Slide 2: 홈 화면 Mock
// ─────────────────────────────────────────────
function HomeSlide({ mockWidth }: MockSlideProps) {
  return (
    <View style={styles.slideInner}>
      {/* 목업 컨테이너 */}
      <View style={[styles.mockContainer, { width: mockWidth }]}>
        {/* D-day 카드 */}
        <View style={styles.homeDdayCard}>
          <Text style={styles.homeDdayLabel}>예시 · 우리의 결혼식</Text>
          <Text style={styles.homeDdayNumber}>일정 입력</Text>
          <Text style={styles.homeDdayDate}>직접 저장한 날짜</Text>

          {/* 프로그레스 바 */}
          <View style={styles.homeProgressContainer}>
            <View style={styles.homeProgressBg}>
              <View style={styles.homeProgressFill} />
            </View>
            <Text style={styles.homeProgressText}>준비 상태 동기화</Text>
          </View>
        </View>

        {/* 퀵 액션 */}
        <View style={styles.homeQuickRow}>
          {[
            { icon: MessageCircle, label: "아모라", color: colors.rose[500] },
            { icon: Wallet, label: "예산", color: colors.gold.DEFAULT },
            { icon: CalendarDays, label: "일정", color: colors.noir.soft },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <View key={item.label} style={styles.homeQuickItem}>
                <View
                  style={[
                    styles.homeQuickCircle,
                    { backgroundColor: item.color },
                  ]}
                >
                  <Icon size={18} color="#FFFFFF" />
                </View>
                <Text style={styles.homeQuickLabel}>{item.label}</Text>
              </View>
            );
          })}
        </View>
      </View>

      <Text style={styles.mockCaption}>
        D-day와 해야 할 일을 한눈에
      </Text>
    </View>
  );
}

// ─────────────────────────────────────────────
// Slide 3: AI 아모라 Mock
// ─────────────────────────────────────────────
function ChatSlide({ mockWidth }: MockSlideProps) {
  return (
    <View style={styles.slideInner}>
      <View style={[styles.mockContainer, { width: mockWidth }]}>
        {/* 채팅 헤더 */}
        <View style={styles.chatHeader}>
          <View style={styles.chatAvatarSmall}>
            <Sparkles size={12} color="#FFFFFF" />
          </View>
          <Text style={styles.chatHeaderName}>아모라</Text>
          <View style={styles.chatOnlineDot} />
        </View>

        {/* 채팅 대화 */}
        <View style={styles.chatBody}>
          {/* 유저 메시지 */}
          <View style={styles.chatRowUser}>
            <View style={styles.chatBubbleUser}>
              <Text style={styles.chatBubbleUserText}>
                웨딩 사진 촬영 업체 상담이 다음 주 토요일이야
              </Text>
            </View>
          </View>

          {/* AI 메시지 */}
          <View style={styles.chatRowAi}>
            <View style={styles.chatAiAvatar}>
              <Sparkles size={10} color="#FFFFFF" />
            </View>
            <View style={styles.chatBubbleAi}>
              <Text style={styles.chatBubbleAiText}>
                다음 주 토요일 일정에 추가할까요? 확인한 뒤에만 반영해요.
              </Text>
            </View>
          </View>

          {/* 추천 필 버튼 */}
          <View style={styles.chatPillRow}>
            <View style={styles.chatPill}>
              <Text style={styles.chatPillText}>할 일에 남기기</Text>
            </View>
            <View style={styles.chatPill}>
              <Text style={styles.chatPillText}>일정에 추가</Text>
            </View>
          </View>
        </View>
      </View>

      <Text style={styles.mockCaption}>
        말하면 할 일·일정·예산으로 이어져요
      </Text>
    </View>
  );
}

// ─────────────────────────────────────────────
// Slide 4: 커뮤니티 Mock
// ─────────────────────────────────────────────
function CommunitySlide({ mockWidth }: MockSlideProps) {
  return (
    <View style={styles.slideInner}>
      <View style={[styles.mockContainer, { width: mockWidth }]}>
        {/* 게시글 카드 */}
        <View style={styles.communityPostCard}>
          {/* 작성자 */}
          <View style={styles.communityAuthorRow}>
            <View style={styles.communityAvatarCircle}>
              <Text style={styles.communityAvatarText}>J</Text>
            </View>
            <View style={styles.communityAuthorInfo}>
              <View style={styles.communityNameRow}>
                <Text style={styles.communityNickname}>샘플 커플</Text>
                <View style={styles.communityRankBadge}>
                  <Crown size={8} color={colors.gold.DEFAULT} />
                  <Text style={styles.communityRankText}>예시</Text>
                </View>
              </View>
              <Text style={styles.communityTime}>샘플 게시글</Text>
            </View>
          </View>

          {/* 게시글 본문 */}
          <Text style={styles.communityPostTitle}>웨딩 사진 촬영 업체 비교 후기</Text>
          <Text style={styles.communityPostPreview}>
            받는 사진 파일 수와 밝기·색을 다듬어 주는 사진 수를 같은 기준으로 비교했어요.
          </Text>

          {/* 투표 + 댓글 */}
          <View style={styles.communityMetaRow}>
            <View style={styles.communityVote}>
              <ChevronUp size={14} color={colors.rose[500]} />
              <Text style={styles.communityVoteText}>공감</Text>
            </View>
            <View style={styles.communityComment}>
              <MessageSquare size={12} color={colors.textSecondary} />
              <Text style={styles.communityCommentText}>댓글</Text>
            </View>
          </View>
        </View>

        {/* 동기방 배너 */}
        <View style={styles.communityCohortBanner}>
          <View style={styles.communityCohortLeft}>
            <Users size={16} color={colors.rose[500]} />
            <View style={styles.communityCohortTextWrap}>
              <Text style={styles.communityCohortTitle}>
                샘플 동기방
              </Text>
              <Text style={styles.communityCohortSub}>예시 화면</Text>
            </View>
          </View>
          <View style={styles.communityCohortJoin}>
            <Text style={styles.communityCohortJoinText}>참여중</Text>
          </View>
        </View>
      </View>

      <Text style={styles.mockCaption}>
        같은 시기 커플들과 정보 공유
      </Text>
    </View>
  );
}

// ─────────────────────────────────────────────
// Slide 5: 예산 & 일정 Mock
// ─────────────────────────────────────────────
function BudgetScheduleSlide({ mockWidth }: MockSlideProps) {
  return (
    <View style={styles.slideInner}>
      <View style={[styles.mockContainer, { width: mockWidth }]}>
        {/* 예산 미니 */}
        <View style={styles.budgetCard}>
          <Text style={styles.budgetLabel}>총 예산</Text>
          <Text style={styles.budgetTotal}>직접 입력</Text>

          {/* 예산 프로그레스 */}
          <View style={styles.budgetProgressBg}>
            <View style={styles.budgetProgressFill} />
          </View>
          <Text style={styles.budgetUsed}>저장한 지출과 잔여 예산 확인</Text>

          {/* 카테고리 행 */}
          <View style={styles.budgetCategoryRow}>
            <View style={styles.budgetCatDot} />
            <Text style={styles.budgetCatName}>사진·의상·메이크업</Text>
            <Text style={styles.budgetCatAmount}>입력한 금액</Text>
          </View>
          <View style={styles.budgetCategoryRow}>
            <View
              style={[
                styles.budgetCatDot,
                { backgroundColor: colors.gold.DEFAULT },
              ]}
            />
            <Text style={styles.budgetCatName}>결혼식장</Text>
            <View style={styles.budgetCatAmountRow}>
              <Text style={styles.budgetCatAmount}>포함 항목 확인</Text>
              <View style={styles.budgetWarningBadge}>
                <AlertTriangle size={10} color={colors.danger} />
              </View>
            </View>
          </View>
        </View>

        {/* 체크리스트 미니 */}
        <View style={styles.checklistCard}>
          <Text style={styles.checklistTitle}>다음 할 일</Text>

          {/* 완료 항목 */}
          <View style={styles.checklistItem}>
            <View style={styles.checkDone}>
              <Check size={10} color="#FFFFFF" />
            </View>
            <Text style={styles.checklistTextDone}>결혼식장 계약 내용 확인</Text>
          </View>
          <View style={styles.checklistItem}>
            <View style={styles.checkDone}>
              <Check size={10} color="#FFFFFF" />
            </View>
            <Text style={styles.checklistTextDone}>초대장 제작 업체 정하기</Text>
          </View>

          {/* 미완료 항목 */}
          <View style={styles.checklistItem}>
            <View style={styles.checkUndone}>
              <Circle size={10} color={colors.taupe[400]} />
            </View>
            <Text style={styles.checklistTextUndone}>
              사진·의상·메이크업 계약금 확인
            </Text>
          </View>
        </View>
      </View>

      <Text style={styles.mockCaption}>
        예상 금액과 실제로 쓴 금액, 해야 할 일과 날짜를 함께 확인
      </Text>
    </View>
  );
}

// ─────────────────────────────────────────────
// Slide 6: 시작하기
// ─────────────────────────────────────────────
function StartSlide({ onStart, onNeverShow }: {
  onStart: () => void;
  onNeverShow: () => void;
}) {
  return (
    <View style={styles.slideInner}>
      {/* 스파클 아이콘 */}
      <View style={styles.startSparkleOuter}>
        <View style={styles.startSparkleInner}>
          <Sparkles size={36} color={colors.gold.DEFAULT} />
        </View>
      </View>

      <Text style={styles.startTitle}>아모라에게 지금 상황을 말해보세요</Text>
      <Text style={styles.startSubtitle}>
        확인한 내용만 할 일·일정·예산에 반영해요
      </Text>

      {/* 시작하기 버튼 */}
      <Pressable
        style={({ pressed }) => [
          styles.startButton,
          pressed && styles.startButtonPressed,
        ]}
        onPress={onStart}
      >
        <Text style={styles.startButtonText}>시작하기</Text>
      </Pressable>

      {/* 다시 보지 않기 */}
      <Pressable onPress={onNeverShow} hitSlop={12}>
        <Text style={styles.neverAgainText}>다시 보지 않기</Text>
      </Pressable>
    </View>
  );
}

// ─────────────────────────────────────────────
// 메인 컴포넌트
// ─────────────────────────────────────────────
const SLIDE_COUNT = 6;

interface AppGuideProps {
  onClose: () => void;
}

export default function AppGuide({ onClose }: AppGuideProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const flatListRef = useRef<FlatList>(null);
  const { width } = useWindowDimensions();
  const guideWidth = Platform.OS === "web" ? Math.min(width, MAX_GUIDE_WIDTH) : width;
  const mockWidth = Math.max(0, guideWidth - spacing[16]);

  const isLastSlide = currentIndex === SLIDE_COUNT - 1;

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (viewableItems.length > 0 && viewableItems[0]?.index != null) {
        setCurrentIndex(viewableItems[0].index);
      }
    }
  ).current;

  const viewConfigRef = useRef({
    viewAreaCoveragePercentThreshold: 50,
  }).current;

  const goToNext = useCallback(() => {
    if (isLastSlide) {
      onClose();
      return;
    }
    flatListRef.current?.scrollToIndex({
      index: currentIndex + 1,
      animated: true,
    });
  }, [currentIndex, isLastSlide, onClose]);

  // 다시 보지 않기: AsyncStorage에 플래그 저장 후 닫기
  const handleNeverShow = useCallback(async () => {
    try {
      await AsyncStorage.setItem(ASYNC_KEY, "true");
    } catch {
      // 저장 실패해도 닫기
    }
    onClose();
  }, [onClose]);

  const slideIds = ["welcome", "home", "ai", "community", "budget", "start"];

  const renderSlide = useCallback(
    ({ index }: { item: string; index: number }) => (
      <View style={[styles.slide, { width: guideWidth }]}>
        {index === 0 && <WelcomeSlide />}
        {index === 1 && <HomeSlide mockWidth={mockWidth} />}
        {index === 2 && <ChatSlide mockWidth={mockWidth} />}
        {index === 3 && <CommunitySlide mockWidth={mockWidth} />}
        {index === 4 && <BudgetScheduleSlide mockWidth={mockWidth} />}
        {index === 5 && (
          <StartSlide onStart={onClose} onNeverShow={handleNeverShow} />
        )}
      </View>
    ),
    [guideWidth, mockWidth, onClose, handleNeverShow]
  );

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={[styles.guideFrame, { width: guideWidth }]}>
      {/* 건너뛰기 (마지막 슬라이드에선 숨김) */}
      {!isLastSlide && (
        <Pressable style={styles.skipButton} onPress={onClose} hitSlop={12}>
          <Text style={styles.skipText}>건너뛰기</Text>
        </Pressable>
      )}

      {/* 슬라이드 */}
      <FlatList
        ref={flatListRef}
        data={slideIds}
        renderItem={renderSlide}
        keyExtractor={(item) => item}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        bounces={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewConfigRef}
        extraData={guideWidth}
        style={{ width: guideWidth }}
        getItemLayout={(_, index) => ({
          length: guideWidth,
          offset: guideWidth * index,
          index,
        })}
      />

      {/* 하단: 도트 + 다음 버튼 */}
      <View style={styles.bottomArea}>
        {/* 도트 인디케이터 */}
        <View style={styles.dotsContainer}>
          {slideIds.map((id, index) => (
            <View
              key={id}
              style={[
                styles.dot,
                index === currentIndex ? styles.dotActive : styles.dotInactive,
              ]}
            />
          ))}
        </View>

        {/* 다음 버튼 (마지막 슬라이드에서는 숨김 — 슬라이드 내부에 시작하기 버튼 있음) */}
        {!isLastSlide && (
          <Pressable
            style={({ pressed }) => [
              styles.nextButton,
              pressed && styles.nextButtonPressed,
            ]}
            onPress={goToNext}
          >
            <Text style={styles.nextButtonText}>다음</Text>
          </Pressable>
        )}
      </View>
      </View>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────
// 스타일
// ─────────────────────────────────────────────
const MOCK_SHADOW = {
  shadowColor: "#000",
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.08,
  shadowRadius: 12,
  elevation: 6,
} as const;

const MOCK_SHADOW_LIGHT = {
  shadowColor: "#000",
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.05,
  shadowRadius: 8,
  elevation: 3,
} as const;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: "center",
  },
  guideFrame: {
    flex: 1,
    position: "relative",
  },

  // ── 건너뛰기 ──
  skipButton: {
    position: "absolute",
    top: 60,
    right: spacing[5],
    zIndex: 10,
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[3],
  },
  skipText: {
    fontSize: fontSize.sm,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
  },

  // ── 슬라이드 공통 ──
  slide: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: spacing[8],
    paddingTop: 96,
    paddingBottom: 156,
  },
  slideInner: {
    alignItems: "center",
    width: "100%",
    marginTop: -spacing[6],
  },

  // ── 목업 컨테이너 (공통 wrapper) ──
  mockContainer: {
    backgroundColor: colors.ivory[100],
    borderRadius: radius["2xl"],
    padding: spacing[4],
    gap: spacing[3],
    ...MOCK_SHADOW,
  },

  // ── 목업 아래 캡션 ──
  mockCaption: {
    marginTop: spacing[6],
    fontSize: fontSize.base,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
    textAlign: "center",
    lineHeight: 24,
  },

  // ══════════════════════════════════════
  //  SLIDE 1: Welcome
  // ══════════════════════════════════════
  welcomeIconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.rose[500],
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing[6],
    ...MOCK_SHADOW,
  },
  welcomeTitle: {
    fontSize: fontSize["4xl"],
    fontFamily: "NotoSerifKR_500Medium",
    color: colors.noir[800],
    textAlign: "center",
    letterSpacing: 0,
    marginBottom: spacing[2],
  },
  welcomeSubtitle: {
    fontSize: fontSize.lg,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
    textAlign: "center",
    lineHeight: 26,
    marginBottom: spacing[8],
  },
  badgeRow: {
    flexDirection: "row",
    gap: spacing[2],
  },
  badge: {
    backgroundColor: colors.ivory[200],
    borderRadius: radius.full,
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[4],
    borderWidth: 1,
    borderColor: colors.border,
  },
  badgeText: {
    fontSize: fontSize.sm,
    fontFamily: "NotoSansKR_500Medium",
    color: colors.noir[800],
  },

  // ══════════════════════════════════════
  //  SLIDE 2: 홈 화면 Mock
  // ══════════════════════════════════════
  homeDdayCard: {
    backgroundColor: colors.noir[800],
    borderRadius: radius.xl,
    padding: spacing[5],
    alignItems: "center",
  },
  homeDdayLabel: {
    fontSize: fontSize.xs,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.rose.light,
    marginBottom: spacing[1],
    letterSpacing: 0,
  },
  homeDdayNumber: {
    fontSize: fontSize["5xl"],
    fontFamily: "CormorantGaramond_600SemiBold",
    color: "#FFFFFF",
    letterSpacing: 0,
    lineHeight: 56,
  },
  homeDdayDate: {
    fontSize: fontSize.sm,
    fontFamily: "CormorantGaramond_400Regular",
    color: colors.taupe[400],
    marginTop: spacing[1],
    letterSpacing: 0,
  },
  homeProgressContainer: {
    width: "100%",
    marginTop: spacing[4],
    alignItems: "center",
  },
  homeProgressBg: {
    width: "100%",
    height: 6,
    backgroundColor: colors.noir.soft,
    borderRadius: radius.full,
    overflow: "hidden",
  },
  homeProgressFill: {
    width: "35%",
    height: "100%",
    backgroundColor: colors.rose[500],
    borderRadius: radius.full,
  },
  homeProgressText: {
    fontSize: fontSize.xs,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.taupe[400],
    marginTop: spacing[1],
  },
  homeQuickRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: spacing[8],
    paddingVertical: spacing[2],
  },
  homeQuickItem: {
    alignItems: "center",
    gap: spacing[1],
  },
  homeQuickCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    ...MOCK_SHADOW_LIGHT,
  },
  homeQuickLabel: {
    fontSize: fontSize.xs,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
  },

  // ══════════════════════════════════════
  //  SLIDE 3: AI 아모라 Mock
  // ══════════════════════════════════════
  chatHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingBottom: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing[2],
  },
  chatAvatarSmall: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.noir[800],
    alignItems: "center",
    justifyContent: "center",
  },
  chatHeaderName: {
    fontSize: fontSize.sm,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.noir[800],
    flex: 1,
  },
  chatOnlineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.success,
  },
  chatBody: {
    paddingTop: spacing[3],
    gap: spacing[3],
  },

  // 유저 메시지 (오른쪽)
  chatRowUser: {
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  chatBubbleUser: {
    backgroundColor: colors.noir[800],
    borderRadius: radius.xl,
    borderBottomRightRadius: radius.sm,
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[4],
    maxWidth: "75%",
  },
  chatBubbleUserText: {
    fontSize: fontSize.sm,
    fontFamily: "NotoSansKR_400Regular",
    color: "#FFFFFF",
    lineHeight: 20,
  },

  // AI 메시지 (왼쪽)
  chatRowAi: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing[2],
  },
  chatAiAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.rose[500],
    alignItems: "center",
    justifyContent: "center",
  },
  chatBubbleAi: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderBottomLeftRadius: radius.sm,
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[4],
    maxWidth: "70%",
    ...MOCK_SHADOW_LIGHT,
  },
  chatBubbleAiText: {
    fontSize: fontSize.sm,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.noir[800],
    lineHeight: 20,
  },

  // 추천 필 버튼
  chatPillRow: {
    flexDirection: "row",
    gap: spacing[2],
    marginLeft: 32, // 아바타 + 갭 만큼 들여쓰기
  },
  chatPill: {
    borderWidth: 1,
    borderColor: colors.rose[500],
    borderRadius: radius.full,
    paddingVertical: 6,
    paddingHorizontal: spacing[3],
  },
  chatPillText: {
    fontSize: fontSize.xs,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.rose[500],
  },

  // ══════════════════════════════════════
  //  SLIDE 4: 커뮤니티 Mock
  // ══════════════════════════════════════
  communityPostCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing[4],
    ...MOCK_SHADOW_LIGHT,
  },
  communityAuthorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    marginBottom: spacing[3],
  },
  communityAvatarCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.rose.pale,
    alignItems: "center",
    justifyContent: "center",
  },
  communityAvatarText: {
    fontSize: fontSize.sm,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.rose[600],
  },
  communityAuthorInfo: {
    flex: 1,
  },
  communityNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
  },
  communityNickname: {
    fontSize: fontSize.sm,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.noir[800],
  },
  communityRankBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    backgroundColor: colors.ivory[200],
    borderRadius: radius.full,
    paddingVertical: 2,
    paddingHorizontal: 6,
  },
  communityRankText: {
    fontSize: 10,
    fontFamily: "NotoSansKR_500Medium",
    color: colors.gold.DEFAULT,
  },
  communityTime: {
    fontSize: fontSize.xs,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textTertiary,
    marginTop: 1,
  },
  communityPostTitle: {
    fontSize: fontSize.base,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.noir[800],
    marginBottom: spacing[1],
  },
  communityPostPreview: {
    fontSize: fontSize.sm,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
    lineHeight: 20,
    marginBottom: spacing[3],
  },
  communityMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[4],
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing[2],
  },
  communityVote: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
  },
  communityVoteText: {
    fontSize: fontSize.sm,
    fontFamily: "NotoSansKR_500Medium",
    color: colors.rose[500],
  },
  communityComment: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
  },
  communityCommentText: {
    fontSize: fontSize.sm,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
  },

  // 동기방 배너
  communityCohortBanner: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing[4],
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    ...MOCK_SHADOW_LIGHT,
  },
  communityCohortLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
  },
  communityCohortTextWrap: {
    gap: 1,
  },
  communityCohortTitle: {
    fontSize: fontSize.sm,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.noir[800],
  },
  communityCohortSub: {
    fontSize: fontSize.xs,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textTertiary,
  },
  communityCohortJoin: {
    backgroundColor: colors.rose.glow,
    borderRadius: radius.full,
    paddingVertical: 4,
    paddingHorizontal: spacing[3],
  },
  communityCohortJoinText: {
    fontSize: fontSize.xs,
    fontFamily: "NotoSansKR_500Medium",
    color: colors.rose[500],
  },

  // ══════════════════════════════════════
  //  SLIDE 5: 예산 & 일정 Mock
  // ══════════════════════════════════════
  budgetCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing[4],
    ...MOCK_SHADOW_LIGHT,
  },
  budgetLabel: {
    fontSize: fontSize.xs,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textTertiary,
    marginBottom: 2,
  },
  budgetTotal: {
    fontSize: fontSize["2xl"],
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.noir[800],
    marginBottom: spacing[3],
  },
  budgetProgressBg: {
    width: "100%",
    height: 8,
    backgroundColor: colors.ivory[200],
    borderRadius: radius.full,
    overflow: "hidden",
    marginBottom: spacing[1],
  },
  budgetProgressFill: {
    width: "41%",
    height: "100%",
    backgroundColor: colors.rose[500],
    borderRadius: radius.full,
  },
  budgetUsed: {
    fontSize: fontSize.xs,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
    marginBottom: spacing[3],
  },
  budgetCategoryRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing[2],
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing[2],
  },
  budgetCatDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.rose[500],
  },
  budgetCatName: {
    flex: 1,
    fontSize: fontSize.sm,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textPrimary,
  },
  budgetCatAmountRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
  },
  budgetCatAmount: {
    fontSize: fontSize.sm,
    fontFamily: "NotoSansKR_500Medium",
    color: colors.noir[800],
  },
  budgetWarningBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "rgba(239, 68, 68, 0.1)",
    alignItems: "center",
    justifyContent: "center",
  },

  // 체크리스트
  checklistCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing[4],
    ...MOCK_SHADOW_LIGHT,
  },
  checklistTitle: {
    fontSize: fontSize.sm,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.noir[800],
    marginBottom: spacing[3],
  },
  checklistItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    paddingVertical: 6,
  },
  checkDone: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.success,
    alignItems: "center",
    justifyContent: "center",
  },
  checkUndone: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.ivory[200],
    alignItems: "center",
    justifyContent: "center",
  },
  checklistTextDone: {
    fontSize: fontSize.sm,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textTertiary,
    textDecorationLine: "line-through",
  },
  checklistTextUndone: {
    fontSize: fontSize.sm,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textPrimary,
  },

  // ══════════════════════════════════════
  //  SLIDE 6: 시작하기
  // ══════════════════════════════════════
  startSparkleOuter: {
    width: 96,
    height: 96,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing[6],
  },
  startSparkleInner: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.ivory[200],
    alignItems: "center",
    justifyContent: "center",
  },
  startTitle: {
    fontSize: fontSize["3xl"],
    fontFamily: "NotoSerifKR_500Medium",
    color: colors.noir[800],
    textAlign: "center",
    letterSpacing: 0,
    marginBottom: spacing[2],
  },
  startSubtitle: {
    fontSize: fontSize.base,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
    textAlign: "center",
    lineHeight: 24,
    marginBottom: spacing[10],
  },
  startButton: {
    backgroundColor: colors.noir[800],
    borderRadius: radius.xl,
    paddingVertical: spacing[4],
    width: "100%",
    alignItems: "center",
    marginBottom: spacing[3],
    ...MOCK_SHADOW,
  },
  startButtonPressed: {
    backgroundColor: colors.noir[900],
  },
  startButtonText: {
    fontSize: fontSize.lg,
    fontFamily: "NotoSansKR_600SemiBold",
    color: "#FFFFFF",
  },
  neverAgainText: {
    fontSize: fontSize.xs,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textTertiary,
    textDecorationLine: "underline",
  },

  // ══════════════════════════════════════
  //  하단 영역 (도트 + 다음 버튼)
  // ══════════════════════════════════════
  bottomArea: {
    position: "absolute",
    bottom: 60,
    left: 0,
    right: 0,
    alignItems: "center",
    paddingHorizontal: spacing[8],
  },
  dotsContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[2],
    marginBottom: spacing[6],
  },
  dot: {
    borderRadius: radius.full,
  },
  dotActive: {
    width: 24,
    height: 8,
    backgroundColor: colors.rose[500],
    borderRadius: radius.full,
  },
  dotInactive: {
    width: 8,
    height: 8,
    backgroundColor: colors.ivory[200],
    borderRadius: radius.full,
  },
  nextButton: {
    backgroundColor: colors.noir[800],
    borderRadius: radius.xl,
    paddingVertical: spacing[4],
    paddingHorizontal: spacing[16],
    width: "100%",
    alignItems: "center",
  },
  nextButtonPressed: {
    backgroundColor: colors.noir[900],
  },
  nextButtonText: {
    fontSize: fontSize.base,
    fontFamily: "NotoSansKR_600SemiBold",
    color: "#FFFFFF",
  },
});
