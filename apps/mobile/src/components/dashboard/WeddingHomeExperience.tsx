import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { Animated, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Text } from "@/components/ui/AppText";
import { router } from "expo-router";
import {
  ArrowRight,
  CalendarCheck,
  CalendarDays,
  FileCheck2,
  Heart,
  ReceiptText,
  ShieldCheck,
  Split,
  UsersRound,
  WalletCards,
} from "lucide-react-native";
import { colors, radius, spacing } from "@hanbang/design-tokens";
import {
  HOME_SERVICES,
  buildDashboardFocus,
  getWeddingMomentMessage,
  type DashboardBookingOutcomeTask,
  type DashboardFocus,
  type DashboardHomeService,
  type DashboardHomeServiceKey,
  type DashboardTodayTask,
  type DashboardUrgentTask,
} from "@/lib/dashboardExperience.mjs";
import { LOUNGE_CONTENT_BOTTOM_PADDING } from "@/lib/firstRunTutorial";
import { AppText, SectionHeader, appShadow } from "@/components/ui/AppUI";
import { SummaryPill, summaryColors } from "@/components/ui/FeatureSummary";
import {
  FirstRunAnchor,
  useFirstRunAnchorScroller,
} from "@/components/lounge/FirstRunAnchors";

interface PartnerActivity {
  partnerName: string;
  recentCategories: string[];
}

export interface WeddingHomeData {
  name: string | null;
  weddingDate: string | null;
  progressPercent: number;
  todayTasks: DashboardTodayTask[];
  dday: number | null;
  urgentTasks: DashboardUrgentTask[];
  bookingOutcomeTasks: DashboardBookingOutcomeTask[];
  partnerActivity: PartnerActivity | null;
}

interface WeddingHomeExperienceProps {
  data: WeddingHomeData | null;
  loading: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  /**
   * 파트너가 무엇을 바꿨는지 알리는 줄. 시간에 민감하고 누를 것이 있어서
   * 첫 도착 카드보다 위, 화면 맨 앞에 온다.
   */
  partnerChanges?: ReactNode;
  todayOneCare?: ReactNode;
  /**
   * 아모라가 챙기기로 한 것. 사용자가 승인해서 저장된 것이므로 선제 케어(todayOneCare)
   * 보다 뒤, 준비 도구보다 앞에 온다 — 이미 약속한 일이 도구 목록에 밀리면 안 된다.
   */
  amoraActions?: ReactNode;
  /**
   * 첫 도착 카드들(확인했어요 · 다음 걸음 · 초대). 두 사람이 만든 데이터가 아직 없을
   * 때만 라운지가 넣어준다. 이 화면은 언제 보일지 판단하지 않는다 — 판단이 두 곳에
   * 있으면 한쪽만 고쳐진다.
   */
  firstArrival?: ReactNode;
  /** 왜 아직 비어 있는지 한 줄. 빈 준비 도구 격자 바로 위에 붙는다. */
  emptyNote?: ReactNode;
}

const SERVICE_ICONS = {
  checklist: FileCheck2,
  schedule: CalendarDays,
  budget: WalletCards,
  prices: FileCheck2,
  quote: ReceiptText,
  bookings: CalendarCheck,
  community: UsersRound,
} as const;

const SERVICE_COLORS: Record<
  DashboardHomeServiceKey,
  { icon: string; background: string }
> = {
  checklist: { icon: colors.noir[800], background: colors.sage.pale },
  schedule: { icon: colors.rose[600], background: colors.rose.glow },
  budget: { icon: colors.noir[800], background: colors.ivory[200] },
  prices: { icon: colors.sage.deep, background: colors.sage.pale },
  quote: { icon: colors.rose[600], background: colors.rose.pale },
  bookings: { icon: colors.paper.tapeInk, background: colors.gold.light },
  community: { icon: colors.noir.soft, background: colors.ivory[100] },
};

function formatDday(dday: number | null): string {
  if (dday === null) return "결혼식 날짜 설정";
  if (dday === 0) return "D-DAY";
  if (dday > 0) return `D-${dday}`;
  return `D+${Math.abs(dday)}`;
}

function formatWeddingDate(dateValue: string | null): string {
  if (!dateValue) return "결혼식 날짜 미정";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateValue);
  if (!match) return "저장한 결혼식 날짜";
  return `${match[1]}년 ${Number(match[2])}월 ${Number(match[3])}일`;
}

function getGreeting(name: string | null): string {
  const hour = new Date().getHours();
  const timeLabel = hour < 12 ? "좋은 아침이에요" : hour < 18 ? "좋은 오후에요" : "좋은 저녁이에요";
  return name ? `${name}님, ${timeLabel}` : timeLabel;
}

function getFocusPill(focus: DashboardFocus): {
  label: string;
  tone: "neutral" | "rose" | "success" | "warning" | "danger";
} {
  switch (focus.kind) {
    case "urgent":
      return { label: "먼저 확인", tone: "danger" };
    case "setup":
      return { label: "첫 준비", tone: "rose" };
    case "booking":
      return { label: "기록할 일", tone: "warning" };
    case "calm":
      return { label: "순조로워요", tone: "success" };
    default:
      return { label: "준비 포커스", tone: "rose" };
  }
}

function openFocus(focus: DashboardFocus) {
  switch (focus.route) {
    case "/settings":
      router.push("/settings");
      return;
    case "/schedule":
      router.push("/schedule");
      return;
    case "/checklist":
      router.push("/checklist");
      return;
    case "/bookings":
      router.push({
        pathname: "/bookings",
        params: focus.bookingId ? { bookingId: focus.bookingId } : {},
      });
      return;
    case "/(tabs)/chat":
      // 히어로 카드에서 온 사람은 "오늘 확인 항목이 없다"는 말을 방금 읽은 사람이다.
      // 그 맥락을 들고 가야 대화가 다른 문들과 같은 자리에서 시작하지 않는다.
      router.push("/(tabs)/chat?entry=lounge_focus_calm");
  }
}

function openService(service: DashboardHomeService) {
  switch (service.route) {
    case "/schedule":
      router.push("/schedule");
      return;
    case "/checklist":
      router.push("/checklist");
      return;
    case "/budget":
      router.push("/budget");
      return;
    case "/market-prices":
      router.push("/market-prices");
      return;
    case "/quote-check":
      router.push("/quote-check");
      return;
    case "/bookings":
      router.push("/bookings");
      return;
    case "/(tabs)/community":
      router.push("/(tabs)/community");
  }
}

function WeddingRings() {
  return (
    <View style={styles.ringCluster} pointerEvents="none" accessibilityElementsHidden>
      <View style={[styles.ring, styles.ringLeft]} />
      <View style={[styles.ring, styles.ringRight]} />
      <View style={styles.ringSpark}>
        <Heart size={10} color={summaryColors.surface} fill={summaryColors.surface} />
      </View>
    </View>
  );
}

function HomeLoadingState() {
  return (
    <View style={styles.loadingWrap}>
      <View style={styles.loadingHeader}>
        <View style={[styles.loadingLine, { width: 112 }]} />
        <View style={[styles.loadingLine, { width: 190, height: 24 }]} />
      </View>
      <View style={styles.loadingHero}>
        <View style={[styles.loadingLineDark, { width: 92 }]} />
        <View style={[styles.loadingLineDark, { width: 156, height: 52 }]} />
        <View style={[styles.loadingLineDark, { width: "86%" }]} />
        <View style={styles.loadingDivider} />
        <View style={[styles.loadingLineDark, { width: 104 }]} />
        <View style={[styles.loadingLineDark, { width: "74%", height: 24 }]} />
        <View style={[styles.loadingLineDark, { width: "90%" }]} />
      </View>
      <View style={[styles.loadingLine, { width: 154, height: 24 }]} />
      <View style={styles.loadingGrid}>
        {Array.from({ length: 4 }, (_, index) => (
          <View key={index} style={styles.loadingTile} />
        ))}
      </View>
    </View>
  );
}

export default function WeddingHomeExperience({
  data,
  loading,
  refreshing,
  onRefresh,
  partnerChanges,
  todayOneCare,
  amoraActions,
  firstArrival,
  emptyNote,
}: WeddingHomeExperienceProps) {
  const progressAnim = useRef(new Animated.Value(0)).current;
  const scrollRef = useRef<ScrollView>(null);
  const registerFirstRunScroller = useFirstRunAnchorScroller();

  // 첫 실행 안내가 화면 아래 요소를 짚어야 할 때 이 스크롤을 빌려 쓴다. 안내가 없는
  // 화면에서는 등록만 되고 아무도 부르지 않는다.
  useEffect(() => {
    registerFirstRunScroller((y) => {
      scrollRef.current?.scrollTo({ y, animated: true });
    });
    return () => registerFirstRunScroller(null);
  }, [registerFirstRunScroller]);

  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: data?.progressPercent ?? 0,
      duration: 420,
      useNativeDriver: false,
    }).start();
  }, [data?.progressPercent, progressAnim]);

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 100],
    outputRange: ["0%", "100%"],
  });

  const focus = useMemo(
    () =>
      data
        ? buildDashboardFocus({
            weddingDate: data.weddingDate,
            todayTasks: data.todayTasks,
            urgentTasks: data.urgentTasks,
            bookingOutcomeTasks: data.bookingOutcomeTasks,
          })
        : null,
    [data],
  );

  const secondaryUrgentTasks = useMemo(() => {
    if (!data) return [];
    return focus?.kind === "urgent"
      ? data.urgentTasks.slice(1, 3)
      : data.urgentTasks.slice(0, 2);
  }, [data, focus?.kind]);

  const focusPill = focus ? getFocusPill(focus) : null;

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.scroll}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.rose[500]}
        />
      }
      showsVerticalScrollIndicator={false}
    >
      {loading && !data ? (
        <HomeLoadingState />
      ) : data && focus && focusPill ? (
        <>
          <View style={styles.intro}>
            <View style={styles.introMark}>
              <View style={styles.introMarkRing} />
              <View style={[styles.introMarkRing, styles.introMarkRingOffset]} />
            </View>
            <View style={styles.introCopy}>
              <AppText variant="eyebrow" style={styles.brandEyebrow}>
                WEDDING HANBANG
              </AppText>
              <AppText variant="title" style={styles.greeting}>
                {getGreeting(data.name)}
              </AppText>
            </View>
          </View>

          {/* 알림이 없으면 이 자식은 null 을 렌더한다. 감싸는 View 에 여백을 두면
              빈 틈이 늘 남으므로, 여백은 카드가 스스로 갖는다. */}
          {partnerChanges}

          {/* 첫 도착 카드들. 스크롤 콘텐츠의 직속 자식이어야 안내가 자리를 제대로 잰다. */}
          {firstArrival}

          {/* 첫 실행 안내의 "여기부터 보시면 돼요"가 가리키는 곳. */}
          <FirstRunAnchor id="lounge-focus">
          <Pressable
            style={({ pressed }) => [
              styles.hero,
              pressed && styles.heroPressed,
            ]}
            onPress={() => openFocus(focus)}
            accessibilityRole="button"
            accessibilityLabel={`${focus.title}. ${focus.ctaLabel}`}
          >
            <WeddingRings />

            <View style={styles.heroHeading}>
              <AppText variant="eyebrow" style={styles.heroEyebrow}>
                우리의 결혼식
              </AppText>
              <Text
                style={[
                  styles.dday,
                  data.dday === null && styles.ddayUnset,
                ]}
              >
                {formatDday(data.dday)}
              </Text>
              <AppText variant="body" style={styles.weddingDate}>
                {formatWeddingDate(data.weddingDate)}
              </AppText>
            </View>
            <AppText variant="body" style={styles.momentCopy}>
              {getWeddingMomentMessage(data.dday)}
            </AppText>

            <View style={styles.progressHeader}>
              <AppText variant="caption" style={styles.heroMuted}>
                함께 준비한 만큼
              </AppText>
              <Text style={styles.progressValue}>{data.progressPercent}%</Text>
            </View>
            <View style={styles.progressTrack}>
              <Animated.View style={[styles.progressFill, { width: progressWidth }]} />
            </View>

            <View style={styles.heroDivider} />

            <View style={styles.focusHeading}>
              <AppText variant="eyebrow" style={styles.focusEyebrow}>
                {focus.eyebrow}
              </AppText>
              <SummaryPill label={focusPill.label} tone={focusPill.tone} />
            </View>
            <Text style={styles.focusTitle}>{focus.title}</Text>
            <Text style={styles.focusDescription}>{focus.description}</Text>
            <View style={styles.focusAction}>
              <Text style={styles.focusActionText}>{focus.ctaLabel}</Text>
              <ArrowRight size={17} color={summaryColors.ink} />
            </View>
          </Pressable>
          </FirstRunAnchor>

          {todayOneCare ? (
            <View style={styles.todayOneSection}>{todayOneCare}</View>
          ) : null}

          {amoraActions ? (
            <View style={styles.todayOneSection}>{amoraActions}</View>
          ) : null}

          {/* 첫 실행 안내의 "준비는 여기서 이어가요"가 가리키는 곳. */}
          <FirstRunAnchor id="lounge-tools" style={styles.section}>
            <SectionHeader
              eyebrow="WEDDING TOOLS"
              title="준비의 모든 순간"
            />
            {emptyNote}
            <View style={styles.serviceGrid}>
              {HOME_SERVICES.map((service) => {
                const Icon = SERVICE_ICONS[service.key];
                const visual = SERVICE_COLORS[service.key];
                return (
                  <Pressable
                    key={service.key}
                    style={({ pressed }) => [
                      styles.serviceTile,
                      pressed && styles.tilePressed,
                    ]}
                    onPress={() => openService(service)}
                    accessibilityRole="button"
                    accessibilityLabel={`${service.title}, ${service.description}`}
                  >
                    <View
                      style={[
                        styles.serviceIcon,
                        { backgroundColor: visual.background },
                      ]}
                    >
                      <Icon size={20} color={visual.icon} />
                    </View>
                    <Text style={styles.serviceTitle} numberOfLines={1}>
                      {service.title}
                    </Text>
                    <Text style={styles.serviceDescription} numberOfLines={1}>
                      {service.description}
                    </Text>
                    <ArrowRight
                      size={15}
                      color={colors.textTertiary}
                      style={styles.serviceArrow}
                    />
                  </Pressable>
                );
              })}
            </View>
          </FirstRunAnchor>

          {secondaryUrgentTasks.length > 0 ? (
            <View style={styles.section}>
              <SectionHeader
                eyebrow="UP NEXT"
                title="다가오는 준비"
              />
              <View style={styles.simpleList}>
                {secondaryUrgentTasks.map((task, index) => (
                  <Pressable
                    key={task.categoryKey}
                    style={[
                      styles.simpleRow,
                      index > 0 && styles.simpleRowBorder,
                    ]}
                    onPress={() => router.push("/checklist")}
                    accessibilityRole="button"
                  >
                    <View
                      style={[
                        styles.taskDot,
                        task.urgency === "overdue"
                          ? styles.taskDotDanger
                          : task.urgency === "soon"
                            ? styles.taskDotWarning
                            : styles.taskDotSuccess,
                      ]}
                    />
                    <View style={styles.simpleCopy}>
                      <Text style={styles.simpleTitle}>{task.categoryLabel}</Text>
                      <Text style={styles.simpleDescription}>
                        {task.remainingDays < 0
                          ? `기본 확인 시점에서 ${Math.abs(task.remainingDays)}일 지남`
                          : task.remainingDays === 0
                            ? "오늘이 기본 확인 시점"
                            : `기본 확인 시점까지 ${task.remainingDays}일`}
                      </Text>
                    </View>
                    <ArrowRight size={16} color={colors.textTertiary} />
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}

          {data.partnerActivity ? (
            <Pressable
              style={({ pressed }) => [
                styles.partnerStrip,
                pressed && styles.tilePressed,
              ]}
              onPress={() => router.push("/checklist")}
              accessibilityRole="button"
            >
              <View style={styles.partnerIcon}>
                <Heart size={17} color={colors.rose[600]} />
              </View>
              <View style={styles.partnerCopy}>
                <Text style={styles.partnerTitle}>
                  {data.partnerActivity.partnerName}님도 함께 준비했어요
                </Text>
                <Text style={styles.partnerDescription} numberOfLines={2}>
                  {data.partnerActivity.recentCategories.join(", ")} 업데이트
                </Text>
              </View>
              <ArrowRight size={16} color={colors.textTertiary} />
            </Pressable>
          ) : null}

          {/*
            웨딩코드는 로그인 뒤 내비게이션에 넣지 않는다(2026-08-27 결정). 웹 라운지와
            같은 자리, 본문 참고 카드로만 둔다 — 탭에 올리면 준비 흐름의 한 단계처럼
            읽히는데 이건 해도 되고 안 해도 되는 대화거리다.
            누르면 `app/wedding-code/index.tsx` 가 웹과 같은 화면을 앱 안 웹뷰로 연다.
          */}
          <Pressable
            style={({ pressed }) => [
              styles.weddingCodeStrip,
              pressed && styles.tilePressed,
            ]}
            onPress={() => router.push("/wedding-code")}
            accessibilityRole="button"
          >
            {/*
              accessibilityLabel 을 달지 않는다. Pressable 은 기본이 accessible 이라
              라벨을 주면 그것이 **자식 글을 대신해** 읽히고, 카드가 무슨 말을 하는지는
              화면 낭독기에 영영 안 들린다. 바로 위 partnerStrip 도 같은 이유로 없다.
              그래서 화면에 보이는 글 자체가 이름이 되도록 "웨딩코드" 를 제목에 넣는다.
            */}
            <View style={styles.weddingCodeIcon}>
              <Split size={17} color={colors.paper.tapeInk} />
            </View>
            <View style={styles.partnerCopy}>
              <Text style={styles.partnerTitle}>
                웨딩코드 — 어디서 생각이 갈리는지 먼저 보기
              </Text>
              {/*
                줄 수를 제한하지 않는다. "점수나 궁합은 매기지 않아요" 는 제품 계약이
                요구하는 선 긋기인데, 글자 크기를 키워 쓰는 사람(시스템 글꼴 1.3배
                이상)에게는 세 줄로 잘려 **"…매기지" 에서 끊기고 "않아요" 가 사라진다.**
                부정문이 잘리면 정반대로 읽힌다. 카드는 minHeight 라 늘어나면 된다.
              */}
              <Text style={styles.partnerDescription}>
                결혼 준비 장면에 각자 답하고, 고른 문장을 나란히 봐요. 점수나 궁합은
                매기지 않아요.
              </Text>
            </View>
            <ArrowRight size={16} color={colors.textTertiary} />
          </Pressable>

          <View style={styles.trustPromise}>
            <View style={styles.trustIcon}>
              <ShieldCheck size={20} color={colors.sage.deep} />
            </View>
            <View style={styles.trustCopy}>
              <Text style={styles.trustTitle}>추천은 광고비로 움직이지 않아요</Text>
              <Text style={styles.trustDescription}>
                업체가 공개한 가격·추가금·위약금 원문과 AI 추천을 구분해 보여드려요.
              </Text>
            </View>
          </View>

          <View style={styles.closing}>
            <View style={styles.closingLine} />
            <Heart size={13} color={colors.rose[500]} />
            <Text style={styles.closingText}>막막한 결혼 준비, 함께 풀어가요</Text>
            <View style={styles.closingLine} />
          </View>
        </>
      ) : (
        <View style={styles.sessionEmpty}>
          <ShieldCheck size={28} color={colors.sage[500]} />
          <AppText variant="subtitle">다시 로그인해 주세요</AppText>
          <AppText variant="body" style={styles.sessionEmptyCopy}>
            두 사람의 결혼 준비를 안전하게 불러오려면 로그인이 필요해요.
          </AppText>
          <Pressable
            style={styles.sessionButton}
            onPress={() => router.replace("/(auth)/login")}
            accessibilityRole="button"
          >
            <Text style={styles.sessionButtonText}>로그인으로 이동</Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    paddingHorizontal: spacing[5],
    paddingTop: spacing[4],
    // 마지막 카드가 아모라 버튼이나 말풍선 뒤로 숨지 않도록, 그 둘이 실제로 차지하는 높이에서
    // 셈한다. 리터럴로 두면 버튼이 커지거나 말풍선이 붙을 때 조용히 어긋난다.
    paddingBottom: LOUNGE_CONTENT_BOTTOM_PADDING,
  },
  intro: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    marginBottom: spacing[3],
  },
  introMark: {
    width: 38,
    height: 38,
    position: "relative",
  },
  introMarkRing: {
    position: "absolute",
    left: 3,
    top: 7,
    width: 23,
    height: 23,
    borderRadius: radius.full,
    borderWidth: 2,
    borderColor: colors.rose[500],
  },
  introMarkRingOffset: {
    left: 13,
    top: 7,
    borderColor: colors.gold.DEFAULT,
  },
  introCopy: {
    flex: 1,
    gap: 2,
  },
  brandEyebrow: {
    color: colors.rose[700],
  },
  greeting: {
    fontSize: 23,
    lineHeight: 30,
  },
  // 라운지 첫 요약. 웹 라운지 「현재 준비 현황」과 같은 샴페인 요약 면이다
  // (`@/lib/featureSummaryPalette`). 예전 어두운 카드는 아래 도구 카드와 무게는 달랐지만
  // 금빛 보조 글자가 읽기 기준에 못 미쳤다. 글자색은 전부 요약 팔레트에서 온다.
  hero: {
    position: "relative",
    overflow: "hidden",
    borderRadius: radius.xl,
    padding: spacing[5],
    backgroundColor: summaryColors.surface,
    borderWidth: 1,
    borderTopWidth: 3,
    borderColor: summaryColors.line,
    borderTopColor: summaryColors.accent,
  },
  heroPressed: {
    opacity: 0.96,
    transform: [{ scale: 0.995 }],
  },
  heroHeading: {
    paddingRight: 96,
  },
  heroEyebrow: {
    color: summaryColors.label,
    marginBottom: 2,
  },
  dday: {
    minHeight: 59,
    fontSize: 48,
    lineHeight: 58,
    fontFamily: "NotoSansKR_700Bold",
    color: summaryColors.ink,
  },
  ddayUnset: {
    fontSize: 28,
    lineHeight: 42,
  },
  weddingDate: {
    color: summaryColors.label,
  },
  momentCopy: {
    marginTop: spacing[4],
    color: summaryColors.ink,
    fontFamily: "NotoSansKR_500Medium",
  },
  ringCluster: {
    position: "absolute",
    width: 98,
    height: 78,
    right: 10,
    top: 14,
    opacity: 0.88,
  },
  ring: {
    position: "absolute",
    width: 54,
    height: 54,
    borderRadius: radius.full,
    borderWidth: 2,
  },
  // 장식이다(스크린리더에서 숨김). 밝은 면 위에서도 모양이 보이도록 한 단계 진한 선을 쓴다.
  ringLeft: {
    left: 4,
    top: 12,
    borderColor: colors.rose[500],
  },
  ringRight: {
    right: 4,
    top: 12,
    borderColor: summaryColors.accent,
  },
  ringSpark: {
    position: "absolute",
    left: 43,
    top: 0,
    width: 22,
    height: 22,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: summaryColors.accent,
  },
  progressHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing[5],
    marginBottom: spacing[2],
  },
  heroMuted: {
    color: summaryColors.label,
  },
  progressValue: {
    fontSize: 15,
    fontFamily: "NotoSansKR_700Bold",
    color: summaryColors.ink,
  },
  progressTrack: {
    height: 6,
    overflow: "hidden",
    borderRadius: radius.full,
    backgroundColor: summaryColors.track,
  },
  progressFill: {
    height: "100%",
    borderRadius: radius.full,
    // 웹 라운지 요약의 체크리스트 진행 막대와 같은 세이지.
    backgroundColor: colors.sage[500],
  },
  heroDivider: {
    height: 1,
    marginVertical: spacing[5],
    backgroundColor: summaryColors.line,
  },
  focusHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[3],
    marginBottom: spacing[2],
  },
  focusEyebrow: {
    color: colors.rose[700],
  },
  focusTitle: {
    paddingRight: spacing[2],
    fontSize: 21,
    lineHeight: 29,
    fontFamily: "NotoSansKR_700Bold",
    color: summaryColors.ink,
  },
  focusDescription: {
    marginTop: spacing[2],
    fontSize: 13,
    lineHeight: 20,
    fontFamily: "NotoSansKR_400Regular",
    color: summaryColors.label,
  },
  focusAction: {
    alignSelf: "flex-start",
    minHeight: 36,
    marginTop: spacing[4],
    paddingHorizontal: spacing[3],
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: summaryColors.line,
    backgroundColor: colors.surface,
  },
  focusActionText: {
    fontSize: 13,
    fontFamily: "NotoSansKR_600SemiBold",
    color: summaryColors.ink,
  },
  section: {
    marginTop: spacing[8],
  },
  todayOneSection: {
    marginTop: spacing[5],
  },
  serviceGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[3],
  },
  serviceTile: {
    position: "relative",
    flexBasis: "45%",
    flexGrow: 1,
    minHeight: 132,
    padding: spacing[4],
    borderRadius: radius["2xl"],
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    ...appShadow,
    shadowOpacity: 0.05,
  },
  tilePressed: {
    opacity: 0.82,
    transform: [{ scale: 0.985 }],
  },
  serviceIcon: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.xl,
    marginBottom: spacing[3],
  },
  serviceTitle: {
    paddingRight: 18,
    fontSize: 15,
    lineHeight: 21,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.noir[800],
  },
  serviceDescription: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
  },
  serviceArrow: {
    position: "absolute",
    right: spacing[3],
    top: spacing[4],
  },
  simpleList: {
    paddingHorizontal: spacing[4],
    borderRadius: radius["2xl"],
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  simpleRow: {
    minHeight: 66,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    paddingVertical: spacing[3],
  },
  simpleRowBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  taskDot: {
    width: 8,
    height: 8,
    borderRadius: radius.full,
  },
  taskDotDanger: {
    backgroundColor: colors.danger,
  },
  taskDotWarning: {
    backgroundColor: colors.warning,
  },
  taskDotSuccess: {
    backgroundColor: colors.success,
  },
  simpleCopy: {
    flex: 1,
  },
  simpleTitle: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.noir[800],
  },
  simpleDescription: {
    marginTop: 1,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
  },
  partnerStrip: {
    minHeight: 78,
    marginTop: spacing[5],
    padding: spacing[4],
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    borderRadius: radius["2xl"],
    borderWidth: 1,
    borderColor: colors.rose.pale,
    backgroundColor: colors.rose.glow,
  },
  partnerIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  partnerCopy: {
    flex: 1,
  },
  partnerTitle: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.noir[800],
  },
  partnerDescription: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
  },
  weddingCodeStrip: {
    minHeight: 78,
    marginTop: spacing[5],
    padding: spacing[4],
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    borderRadius: radius["2xl"],
    borderWidth: 1,
    borderColor: colors.gold.light,
    backgroundColor: colors.surfaceLow,
  },
  weddingCodeIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  trustPromise: {
    marginTop: spacing[5],
    paddingVertical: spacing[4],
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[3],
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  trustIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.xl,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.sage.pale,
  },
  trustCopy: {
    flex: 1,
  },
  trustTitle: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.noir[800],
  },
  trustDescription: {
    marginTop: 3,
    fontSize: 12,
    lineHeight: 19,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
  },
  closing: {
    marginTop: spacing[8],
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[2],
  },
  closingLine: {
    width: 24,
    height: 1,
    backgroundColor: colors.border,
  },
  closingText: {
    fontSize: 12,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
  },
  sessionEmpty: {
    minHeight: 520,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[3],
    paddingHorizontal: spacing[5],
  },
  sessionEmptyCopy: {
    textAlign: "center",
  },
  sessionButton: {
    minHeight: 48,
    marginTop: spacing[2],
    paddingHorizontal: spacing[5],
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.xl,
    backgroundColor: colors.noir[800],
  },
  sessionButtonText: {
    fontSize: 14,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.surface,
  },
  loadingWrap: {
    gap: spacing[5],
  },
  loadingHeader: {
    minHeight: 58,
    justifyContent: "center",
    gap: spacing[2],
  },
  loadingLine: {
    height: 12,
    borderRadius: radius.full,
    backgroundColor: colors.ivory[200],
  },
  loadingHero: {
    minHeight: 360,
    padding: spacing[5],
    gap: spacing[4],
    borderRadius: radius.xl,
    borderWidth: 1,
    borderTopWidth: 3,
    borderColor: summaryColors.line,
    borderTopColor: summaryColors.accent,
    backgroundColor: summaryColors.surface,
  },
  loadingLineDark: {
    height: 12,
    borderRadius: radius.full,
    backgroundColor: summaryColors.track,
  },
  loadingDivider: {
    height: 1,
    marginVertical: spacing[2],
    backgroundColor: summaryColors.line,
  },
  loadingGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[3],
  },
  loadingTile: {
    flexBasis: "45%",
    flexGrow: 1,
    height: 124,
    borderRadius: radius["2xl"],
    backgroundColor: colors.ivory[100],
  },
});
