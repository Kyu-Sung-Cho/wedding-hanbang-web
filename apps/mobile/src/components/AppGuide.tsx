// 앱 가이드 — 첫 실행 시 표시되는 풀스크린 스와이프 온보딩
import { useCallback, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  FlatList,
  Dimensions,
  type ViewToken,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  Heart,
  Home,
  MessageCircle,
  Users,
  BarChart3,
  Sparkles,
} from "lucide-react-native";
import { colors, spacing, radius, fontSize } from "@hanbang/design-tokens";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

interface SlideData {
  id: string;
  icon: React.ComponentType<{ size: number; color: string }>;
  iconBg: string;
  title: string;
  description: string;
  subdescription: string;
}

const SLIDES: SlideData[] = [
  {
    id: "welcome",
    icon: Heart,
    iconBg: colors.rose[500],
    title: "웨딩한방에 오신 것을\n환영해요!",
    description: "결혼 준비의 모든 것, 한곳에서",
    subdescription: "AI 아모라가 24시간 함께합니다",
  },
  {
    id: "home",
    icon: Home,
    iconBg: colors.noir[800],
    title: "홈 화면",
    description: "D-day와 지금 해야 할 것을 한눈에",
    subdescription: "파트너의 활동도 실시간으로 확인",
  },
  {
    id: "ai",
    icon: MessageCircle,
    iconBg: colors.gold.DEFAULT,
    title: "AI 아모라",
    description: "궁금한 건 뭐든 물어보세요",
    subdescription: "업체 추천, 견적 분석, 예산 상담까지",
  },
  {
    id: "community",
    icon: Users,
    iconBg: colors.rose[600],
    title: "커뮤니티",
    description: "같은 시기 결혼하는 동기들과 함께",
    subdescription: "후기, 비용 공유, 고민 상담",
  },
  {
    id: "budget",
    icon: BarChart3,
    iconBg: colors.noir.soft,
    title: "예산 & 일정",
    description: "카테고리별 예산 관리",
    subdescription: "숨은 비용 경고와 양가 분담 추적",
  },
  {
    id: "start",
    icon: Sparkles,
    iconBg: colors.gold.DEFAULT,
    title: "시작하기",
    description: "준비되셨나요?",
    subdescription: "",
  },
];

interface AppGuideProps {
  onClose: () => void;
}

export default function AppGuide({ onClose }: AppGuideProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const flatListRef = useRef<FlatList>(null);

  const isLastSlide = currentIndex === SLIDES.length - 1;

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (viewableItems.length > 0 && viewableItems[0]?.index != null) {
        setCurrentIndex(viewableItems[0].index);
      }
    }
  ).current;

  const viewConfigRef = useRef({ viewAreaCoveragePercentThreshold: 50 }).current;

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

  const renderSlide = useCallback(
    ({ item, index }: { item: SlideData; index: number }) => {
      const Icon = item.icon;
      const isLast = index === SLIDES.length - 1;

      return (
        <View style={styles.slide}>
          <View style={styles.slideContent}>
            {/* 아이콘 영역 */}
            <View style={[styles.iconCircle, { backgroundColor: item.iconBg }]}>
              <Icon size={36} color="#FFFFFF" />
            </View>

            {/* 제목 */}
            <Text style={styles.slideTitle}>{item.title}</Text>

            {/* 설명 */}
            <Text style={styles.slideDescription}>{item.description}</Text>

            {/* 부제 */}
            {item.subdescription !== "" && (
              <Text style={styles.slideSubdescription}>
                {item.subdescription}
              </Text>
            )}

            {/* 마지막 슬라이드: 시작하기 버튼 + 다시 보지 않기 */}
            {isLast && (
              <View style={styles.lastSlideActions}>
                <Pressable
                  style={({ pressed }) => [
                    styles.startButton,
                    pressed && styles.startButtonPressed,
                  ]}
                  onPress={onClose}
                >
                  <Text style={styles.startButtonText}>시작하기</Text>
                </Pressable>
                <Text style={styles.neverAgainText}>다시 보지 않기</Text>
              </View>
            )}
          </View>
        </View>
      );
    },
    [onClose]
  );

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      {/* 건너뛰기 버튼 (마지막 슬라이드에서는 숨김) */}
      {!isLastSlide && (
        <Pressable
          style={styles.skipButton}
          onPress={onClose}
          hitSlop={12}
        >
          <Text style={styles.skipText}>건너뛰기</Text>
        </Pressable>
      )}

      {/* 슬라이드 리스트 */}
      <FlatList
        ref={flatListRef}
        data={SLIDES}
        renderItem={renderSlide}
        keyExtractor={(item) => item.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        bounces={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewConfigRef}
        getItemLayout={(_, index) => ({
          length: SCREEN_WIDTH,
          offset: SCREEN_WIDTH * index,
          index,
        })}
      />

      {/* 하단: 도트 인디케이터 + 다음 버튼 */}
      <View style={styles.bottomArea}>
        {/* 도트 인디케이터 */}
        <View style={styles.dotsContainer}>
          {SLIDES.map((slide, index) => (
            <View
              key={slide.id}
              style={[
                styles.dot,
                index === currentIndex ? styles.dotActive : styles.dotInactive,
              ]}
            />
          ))}
        </View>

        {/* 다음/시작하기 버튼 */}
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },

  // 건너뛰기
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

  // 슬라이드
  slide: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: spacing[8],
  },
  slideContent: {
    alignItems: "center",
    marginTop: -spacing[16],
  },

  // 아이콘
  iconCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing[8],
  },

  // 제목
  slideTitle: {
    fontSize: fontSize["2xl"],
    fontFamily: "NotoSerifKR_500Medium",
    color: colors.noir[800],
    textAlign: "center",
    lineHeight: 36,
    marginBottom: spacing[4],
    letterSpacing: -0.5,
  },

  // 설명
  slideDescription: {
    fontSize: fontSize.base,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
    textAlign: "center",
    lineHeight: 24,
    marginBottom: spacing[2],
  },

  // 부제
  slideSubdescription: {
    fontSize: fontSize.sm,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textTertiary,
    textAlign: "center",
    lineHeight: 22,
  },

  // 마지막 슬라이드 액션
  lastSlideActions: {
    alignItems: "center",
    marginTop: spacing[10],
    width: "100%",
  },
  startButton: {
    backgroundColor: colors.noir[800],
    borderRadius: radius.xl,
    paddingVertical: spacing[4],
    paddingHorizontal: spacing[16],
    width: "100%",
    alignItems: "center",
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
    marginTop: spacing[3],
  },

  // 하단 영역
  bottomArea: {
    position: "absolute",
    bottom: 60,
    left: 0,
    right: 0,
    alignItems: "center",
    paddingHorizontal: spacing[8],
  },

  // 도트
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

  // 다음 버튼
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
