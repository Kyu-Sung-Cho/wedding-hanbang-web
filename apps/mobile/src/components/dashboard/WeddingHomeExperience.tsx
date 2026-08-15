import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Animated,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router } from "expo-router";
import * as Crypto from "expo-crypto";
import {
  ArrowRight,
  CalendarCheck,
  CalendarDays,
  CircleHelp,
  FileCheck2,
  Heart,
  MessageCircleHeart,
  ReceiptText,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  UsersRound,
  WalletCards,
} from "lucide-react-native";
import { colors, radius, spacing } from "@hanbang/design-tokens";
import type { AmoraPreparationOverview } from "@hanbang/shared/amora-preparation-map";
import {
  HOME_SERVICES,
  applyDashboardActionOutcomeFeedback,
  buildCompanionHomeBrief,
  buildDashboardFocus,
  buildDashboardRecommendationDisclosure,
  getWeddingMomentMessage,
  resolveDashboardServiceRoute,
  type DashboardBookingOutcomeTask,
  type DashboardActionOutcomeFeedback,
  type DashboardFocus,
  type DashboardHomeService,
  type DashboardHomeServiceKey,
  type DashboardOpenAction,
  type DashboardTodayTask,
  type DashboardUrgentTask,
} from "@/lib/dashboardExperience.mjs";
import { stageCompanionChatHandoff } from "@/lib/companionChatHandoff.mjs";
import { buildPreparationHomeSectionModel } from "@/lib/preparationMapPresentation.mjs";
import type { AmoraPersonalizationPreferences } from "@/lib/amoraPersonalization.mjs";
import type { AmoraCoreCriterion } from "@hanbang/shared/amora-core-criterion";
import type { AmoraCoupleCriterionResponse } from "@hanbang/shared/amora-couple-criterion";
import { AppText, SectionHeader, StatusPill, appShadow } from "@/components/ui/AppUI";
import AmoraRecommendationWhySheet from "@/components/dashboard/AmoraRecommendationWhySheet";

interface PartnerActivity {
  partnerName: string;
  recentCategories: string[];
}

export interface WeddingHomeData {
  ownerUserId: string;
  coupleId: string | null;
  name: string | null;
  weddingDate: string | null;
  progressPercent: number;
  preparationOverview: Readonly<AmoraPreparationOverview> | null;
  todayTasks: DashboardTodayTask[];
  dday: number | null;
  urgentTasks: DashboardUrgentTask[];
  bookingOutcomeTasks: DashboardBookingOutcomeTask[];
  openAction: DashboardOpenAction | null;
  receiptActionId: string | null;
  actionFeedback: DashboardActionOutcomeFeedback | null;
  partnerActivity: PartnerActivity | null;
  personalization: Readonly<AmoraPersonalizationPreferences> | null;
  coupleCriterionLoaded: boolean;
  coupleCriterion: Readonly<AmoraCoupleCriterionResponse> | null;
  coreCriterionLoaded: boolean;
  coreCriterion: Readonly<AmoraCoreCriterion> | null;
}

interface WeddingHomeExperienceProps {
  data: WeddingHomeData | null;
  loading: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  renderTodayOneCare?: (fallback: ReactNode, focus: DashboardFocus) => ReactNode;
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
  prices: { icon: colors.sage[500], background: colors.sage.pale },
  quote: { icon: colors.rose[600], background: colors.rose.pale },
  bookings: { icon: colors.gold.DEFAULT, background: colors.gold.light },
  community: { icon: colors.noir.soft, background: colors.ivory[100] },
};

const PREPARATION_SUMMARY_COLORS = {
  active: { background: colors.rose.pale, text: colors.rose[600] },
  success: { background: colors.sage.pale, text: colors.sage[500] },
  warning: { background: colors.gold.light, text: colors.noir[800] },
  neutral: { background: colors.ivory[200], text: colors.textSecondary },
  muted: { background: colors.ivory[100], text: colors.textTertiary },
} as const;

const PREPARATION_ROW_DOT_COLORS = {
  active: colors.rose[500],
  warning: colors.gold.DEFAULT,
  neutral: colors.taupe[400],
} as const;

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

function openFocus(
  focus: DashboardFocus,
  ownerUserId: string,
  coupleId: string | null,
  companionBrief: ReturnType<typeof buildCompanionHomeBrief>,
) {
  switch (focus.route) {
    case "/onboarding":
      router.push("/onboarding");
      return;
    case "/settings":
      router.push({
        pathname: "/settings",
        params: { focus: focus.settingsFocus },
      });
      return;
    case "/schedule":
      router.push("/schedule");
      return;
    case "/checklist":
      router.push({
        pathname: "/checklist",
        params: focus.categoryKey ? { category: focus.categoryKey } : {},
      });
      return;
    case "/budget":
      router.push({
        pathname: "/budget",
        params: focus.categoryKey ? { category: focus.categoryKey } : {},
      });
      return;
    case "/bookings":
      router.push({
        pathname: "/bookings",
        params: focus.bookingId ? { bookingId: focus.bookingId } : {},
      });
      return;
    case "/(tabs)/chat":
      openCompanionChat(ownerUserId, coupleId, companionBrief);
  }
}

function openAlternateFocus(
  alternateAction: NonNullable<DashboardFocus["alternateAction"]>,
) {
  router.push({
    pathname: "/settings",
    params: { focus: alternateAction.settingsFocus },
  });
}

function openCompanionChat(
  ownerUserId: string,
  coupleId: string | null,
  companionBrief: ReturnType<typeof buildCompanionHomeBrief>,
) {
  if (!coupleId) {
    router.push("/onboarding");
    return;
  }
  const companionHandoff = stageCompanionChatHandoff({
    handoffId: Crypto.randomUUID(),
    ownerUserId,
    coupleId,
    brief: companionBrief,
  });
  if (!companionHandoff) {
    router.push("/(tabs)/chat");
    return;
  }
  router.push({
    pathname: "/(tabs)/chat",
    params: { companionHandoff },
  });
}

function openService(service: DashboardHomeService, hasCouple: boolean) {
  switch (resolveDashboardServiceRoute(service, hasCouple)) {
    case "/onboarding":
      router.push("/onboarding");
      return;
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
  renderTodayOneCare,
}: WeddingHomeExperienceProps) {
  const progressAnim = useRef(new Animated.Value(0)).current;
  const [whySheetVisible, setWhySheetVisible] = useState(false);

  useEffect(() => {
    setWhySheetVisible(false);
  }, [data?.ownerUserId, data?.coupleId]);

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

  const focus = useMemo(() => {
    if (!data) return null;
    const groundedFocus = buildDashboardFocus({
      hasCouple: Boolean(data.coupleId),
      weddingDate: data.weddingDate,
      todayTasks: data.todayTasks,
      urgentTasks: data.urgentTasks,
      bookingOutcomeTasks: data.bookingOutcomeTasks,
      openAction: data.openAction,
      receiptActionId: data.receiptActionId,
    });
    return applyDashboardActionOutcomeFeedback({
      focus: groundedFocus,
      openAction: data.openAction,
      feedback: data.actionFeedback,
    });
  }, [data]);

  const preparationSection = useMemo(
    () => buildPreparationHomeSectionModel(data?.preparationOverview),
    [data?.preparationOverview],
  );

  const focusPill = focus ? getFocusPill(focus) : null;
  const companionBrief = useMemo(
    () =>
      focus
        ? buildCompanionHomeBrief({
            focus,
            partnerActivity: data?.partnerActivity ?? null,
            personalization: data?.personalization ?? null,
            ownerUserId: data?.ownerUserId ?? null,
            coupleCriterionLoaded: data?.coupleCriterionLoaded ?? false,
            coupleCriterion: data?.coupleCriterion ?? null,
            coreCriterionLoaded: data?.coreCriterionLoaded ?? false,
            coreCriterion: data?.coreCriterion ?? null,
          })
        : null,
    [
      data?.coreCriterion,
      data?.coreCriterionLoaded,
      data?.coupleCriterion,
      data?.coupleCriterionLoaded,
      data?.ownerUserId,
      data?.partnerActivity,
      data?.personalization,
      focus,
    ],
  );
  const recommendationDisclosure = useMemo(
    () => focus && companionBrief
      ? buildDashboardRecommendationDisclosure({
          focus,
          personalizationLabel: companionBrief.personalizationLabel,
          coreCriterionLabel: companionBrief.coreCriterionLabel,
          coupleCriterionLabel: companionBrief.coupleCriterionLabel,
          coreCriterionLoaded: data?.coreCriterionLoaded ?? false,
          coupleCriterionLoaded: data?.coupleCriterionLoaded ?? false,
        })
      : null,
    [
      companionBrief,
      data?.coreCriterionLoaded,
      data?.coupleCriterionLoaded,
      focus,
    ],
  );

  const companionFallback = companionBrief && focusPill && focus ? (
    <View style={styles.hero} accessibilityLabel="아모라 준비 포커스">
      <View style={styles.companionIdentityRow}>
        <View style={styles.amoraIcon}>
          <Sparkles size={22} color={colors.gold.light} />
        </View>
        <View style={styles.companionIdentityCopy}>
          <AppText variant="eyebrow" style={styles.amoraEyebrow}>
            AMORA
          </AppText>
          <Text style={styles.companionRole}>{companionBrief.identityLabel}</Text>
        </View>
        <StatusPill label={focusPill.label} tone={focusPill.tone} />
      </View>

      <AppText variant="eyebrow" style={styles.focusEyebrow}>
        {companionBrief.eyebrow}
      </AppText>
      <Text style={styles.focusTitle}>{companionBrief.priorityTitle}</Text>

      {focus.feedbackNotice ? (
        <View style={styles.feedbackNoticeRow}>
          <ShieldCheck size={15} color={colors.sage[500]} />
          <Text style={styles.feedbackNoticeText}>{focus.feedbackNotice}</Text>
        </View>
      ) : null}

      <View style={styles.whyBlock}>
        <Text style={styles.whyLabel}>왜 지금인지</Text>
        <Text style={styles.focusDescription}>{companionBrief.whyNow}</Text>
        {companionBrief.personalizationLabel
          || companionBrief.coupleCriterionLabel
          || companionBrief.coreCriterionLabel ? (
            <Text style={[styles.whyLabel, styles.personalizationContextHeading]}>
              아모라가 맞춰 돕는 방식
            </Text>
          ) : null}
        {companionBrief.personalizationLabel ? (
          <Text style={styles.personalizationLabel}>
            {companionBrief.personalizationLabel}
          </Text>
        ) : null}
        {companionBrief.coupleCriterionLabel ? (
          <Text style={styles.personalizationLabel}>
            {companionBrief.coupleCriterionLabel}
          </Text>
        ) : null}
        {companionBrief.coreCriterionLabel ? (
          <Text style={styles.personalizationLabel}>
            {companionBrief.coreCriterionLabel}
          </Text>
        ) : null}
      </View>

      {companionBrief.continuity ? (
        <View style={styles.continuityRow}>
          <Heart size={15} color={colors.rose.light} />
          <Text style={styles.continuityText}>{companionBrief.continuity}</Text>
        </View>
      ) : null}

      <Text style={styles.evidenceLabel}>{companionBrief.evidenceLabel}</Text>
      {recommendationDisclosure ? (
        <Pressable
          onPress={() => setWhySheetVisible(true)}
          style={({ pressed }) => [
            styles.whyDisclosureButton,
            pressed && styles.heroPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel="이 제안을 보여드린 이유와 개인화 범위 보기"
        >
          <CircleHelp size={15} color={colors.gold.light} />
          <Text style={styles.whyDisclosureText}>왜 이 제안인가요?</Text>
        </Pressable>
      ) : null}

      <View style={styles.companionActions}>
        <Pressable
          style={({ pressed }) => [
            styles.primaryCompanionAction,
            pressed && styles.heroPressed,
          ]}
          onPress={() =>
            openFocus(
              focus,
              data?.ownerUserId ?? "",
              data?.coupleId ?? null,
              companionBrief,
            )
          }
          accessibilityRole="button"
          accessibilityLabel={`${companionBrief.priorityTitle}. ${companionBrief.primaryActionLabel}`}
        >
          <Text style={styles.focusActionText}>
            {companionBrief.primaryActionLabel}
          </Text>
          <ArrowRight size={17} color={colors.noir[900]} />
        </Pressable>
        {data?.coupleId ? (
          <Pressable
            style={({ pressed }) => [
              styles.secondaryCompanionAction,
              pressed && styles.heroPressed,
            ]}
            onPress={() =>
              focus.alternateAction
                ? openAlternateFocus(focus.alternateAction)
                : companionBrief.criterionAction
                  ? router.push("/settings/amora-style")
                : openCompanionChat(
                    data.ownerUserId,
                    data.coupleId,
                    companionBrief,
                  )
            }
            accessibilityRole="button"
            accessibilityLabel={
              focus.alternateAction?.label
                ?? companionBrief.criterionAction?.label
                ?? companionBrief.chatActionLabel
            }
          >
            {focus.alternateAction ? (
              <CalendarDays size={17} color={colors.rose.light} />
            ) : companionBrief.criterionAction ? (
              <SlidersHorizontal size={17} color={colors.rose.light} />
            ) : (
              <MessageCircleHeart size={17} color={colors.rose.light} />
            )}
            <Text style={styles.secondaryCompanionActionText}>
              {focus.alternateAction?.label
                ?? companionBrief.criterionAction?.label
                ?? companionBrief.chatActionLabel}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  ) : null;

  return (
    <>
    <ScrollView
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
      ) : data && focus && focusPill && companionBrief ? (
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

          {renderTodayOneCare && focus
            ? renderTodayOneCare(companionFallback, focus)
            : companionFallback}

          <View style={styles.weddingContext} accessibilityRole="summary">
            <View style={styles.weddingContextTop}>
              <View style={styles.weddingDateContext}>
                <AppText variant="eyebrow" style={styles.contextEyebrow}>
                  OUR WEDDING
                </AppText>
                <Text
                  style={[
                    styles.contextDday,
                    data.dday === null && styles.contextDdayUnset,
                  ]}
                >
                  {formatDday(data.dday)}
                </Text>
                <Text style={styles.contextDate}>
                  {formatWeddingDate(data.weddingDate)}
                </Text>
              </View>
              <View style={styles.progressContext}>
                <View style={styles.contextProgressHeader}>
                  <Text style={styles.contextProgressLabel}>준비 진행</Text>
                  <Text style={styles.contextProgressValue}>
                    {data.progressPercent}%
                  </Text>
                </View>
                <View style={styles.contextProgressTrack}>
                  <Animated.View
                    style={[styles.contextProgressFill, { width: progressWidth }]}
                  />
                </View>
              </View>
            </View>
            <Text style={styles.contextMomentCopy}>
              {getWeddingMomentMessage(data.dday)}
            </Text>
          </View>

          {preparationSection ? (
            <View style={styles.section}>
              <SectionHeader
                eyebrow={preparationSection.eyebrow}
                title={preparationSection.title}
              />
              <Text style={styles.preparationDescription}>
                {preparationSection.description}
              </Text>
              <View
                style={styles.preparationSummary}
                accessibilityRole="summary"
                accessibilityLabel={preparationSection.summaryItems
                  .map((item) => `${item.label} ${item.count}개`)
                  .join(", ")}
              >
                {preparationSection.summaryItems.map((item) => {
                  const visual = PREPARATION_SUMMARY_COLORS[item.tone];
                  return (
                    <View
                      key={item.key}
                      style={[
                        styles.preparationSummaryItem,
                        { backgroundColor: visual.background },
                      ]}
                    >
                      <Text
                        style={[
                          styles.preparationSummaryLabel,
                          { color: visual.text },
                        ]}
                      >
                        {item.label} {item.count}
                      </Text>
                    </View>
                  );
                })}
              </View>
              {preparationSection.rows.length > 0 ? (
                <View style={styles.simpleList}>
                  {preparationSection.rows.map((topic, index) => (
                  <Pressable
                    key={topic.topicKey}
                    style={[
                      styles.simpleRow,
                      index > 0 && styles.simpleRowBorder,
                    ]}
                    onPress={() => router.push(topic.route)}
                    accessibilityRole="button"
                    accessibilityLabel={`${topic.title}, ${topic.statusLabel}. ${topic.reasonLabel}`}
                  >
                    <View
                      style={[
                        styles.taskDot,
                        {
                          backgroundColor:
                            PREPARATION_ROW_DOT_COLORS[topic.tone],
                        },
                      ]}
                    />
                    <View style={styles.simpleCopy}>
                      <View style={styles.preparationRowHeading}>
                        <Text style={styles.simpleTitle} numberOfLines={1}>
                          {topic.title}
                        </Text>
                        <Text style={styles.preparationStatusLabel}>
                          {topic.statusLabel}
                        </Text>
                      </View>
                      <Text style={styles.simpleDescription}>
                        {topic.reasonLabel}
                      </Text>
                    </View>
                    <ArrowRight size={16} color={colors.textTertiary} />
                  </Pressable>
                  ))}
                </View>
              ) : preparationSection.emptyMessage ? (
                <View style={styles.preparationEmpty}>
                  <ShieldCheck size={18} color={colors.sage[500]} />
                  <Text style={styles.preparationEmptyText}>
                    {preparationSection.emptyMessage}
                  </Text>
                </View>
              ) : null}
              <Pressable
                style={({ pressed }) => [
                  styles.preparationAllButton,
                  pressed && styles.tilePressed,
                ]}
                onPress={() => router.push(preparationSection.allTopicsAction.route)}
                accessibilityRole="button"
                accessibilityLabel="전체 결혼 준비 체크리스트 보기"
              >
                <Text style={styles.preparationAllButtonText}>
                  {preparationSection.allTopicsAction.label}
                </Text>
                <ArrowRight size={16} color={colors.noir[800]} />
              </Pressable>
            </View>
          ) : null}

          <View style={styles.section}>
            <SectionHeader
              eyebrow="PREPARATION TOOLS"
              title="필요할 때 바로 꺼내 쓰기"
            />
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
                    onPress={() => openService(service, Boolean(data.coupleId))}
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
          </View>

          <View style={styles.trustPromise}>
            <View style={styles.trustIcon}>
              <ShieldCheck size={20} color={colors.sage[500]} />
            </View>
            <View style={styles.trustCopy}>
              <Text style={styles.trustTitle}>확인된 기록과 제안을 섞지 않아요</Text>
              <Text style={styles.trustDescription}>
                사용자가 저장한 준비 기록과 아모라의 제안을 나눠 보여드려요.
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
    {recommendationDisclosure ? (
      <AmoraRecommendationWhySheet
        visible={whySheetVisible}
        disclosure={recommendationDisclosure}
        onClose={() => setWhySheetVisible(false)}
        onManageStyle={() => {
          setWhySheetVisible(false);
          router.push("/settings/amora-style");
        }}
        onManageMemory={() => {
          setWhySheetVisible(false);
          router.push("/settings/amora-memory");
        }}
      />
    ) : null}
    </>
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
    paddingBottom: 128,
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
    color: colors.rose[600],
  },
  greeting: {
    fontSize: 23,
    lineHeight: 30,
  },
  hero: {
    position: "relative",
    overflow: "hidden",
    borderRadius: radius["3xl"],
    padding: spacing[5],
    backgroundColor: colors.noir[800],
    borderWidth: 1,
    borderColor: colors.noir.soft,
    ...appShadow,
    shadowOpacity: 0.16,
  },
  companionIdentityRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    marginBottom: spacing[5],
  },
  companionIdentityCopy: {
    flex: 1,
  },
  companionRole: {
    marginTop: 1,
    fontSize: 13,
    lineHeight: 19,
    fontFamily: "NotoSansKR_500Medium",
    color: colors.gold.light,
  },
  heroPressed: {
    opacity: 0.96,
    transform: [{ scale: 0.995 }],
  },
  heroHeading: {
    paddingRight: 96,
  },
  heroEyebrow: {
    color: colors.gold.light,
    marginBottom: 2,
  },
  dday: {
    minHeight: 59,
    fontSize: 48,
    lineHeight: 58,
    fontFamily: "NotoSansKR_700Bold",
    color: colors.surface,
  },
  ddayUnset: {
    fontSize: 28,
    lineHeight: 42,
  },
  weddingDate: {
    color: colors.gold.light,
  },
  momentCopy: {
    marginTop: spacing[4],
    color: colors.surface,
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
  ringLeft: {
    left: 4,
    top: 12,
    borderColor: colors.rose.light,
  },
  ringRight: {
    right: 4,
    top: 12,
    borderColor: colors.gold.light,
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
    backgroundColor: colors.gold.light,
  },
  progressHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing[5],
    marginBottom: spacing[2],
  },
  heroMuted: {
    color: colors.gold.light,
  },
  progressValue: {
    fontSize: 15,
    fontFamily: "NotoSansKR_700Bold",
    color: colors.surface,
  },
  progressTrack: {
    height: 6,
    overflow: "hidden",
    borderRadius: radius.full,
    backgroundColor: "rgba(255, 255, 255, 0.14)",
  },
  progressFill: {
    height: "100%",
    borderRadius: radius.full,
    backgroundColor: colors.rose.light,
  },
  heroDivider: {
    height: 1,
    marginVertical: spacing[5],
    backgroundColor: "rgba(255, 255, 255, 0.14)",
  },
  focusHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[3],
    marginBottom: spacing[2],
  },
  focusEyebrow: {
    color: colors.rose.light,
    marginBottom: spacing[2],
  },
  focusTitle: {
    paddingRight: spacing[2],
    fontSize: 21,
    lineHeight: 29,
    fontFamily: "NotoSansKR_700Bold",
    color: colors.surface,
  },
  feedbackNoticeRow: {
    marginTop: spacing[3],
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[3],
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[2],
    borderRadius: radius.md,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
  },
  feedbackNoticeText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 19,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.surface,
  },
  focusDescription: {
    fontSize: 13,
    lineHeight: 20,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.gold.light,
  },
  personalizationLabel: {
    fontSize: 12,
    lineHeight: 18,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.surface,
  },
  personalizationContextHeading: {
    marginTop: spacing[2],
  },
  whyBlock: {
    marginTop: spacing[4],
    paddingLeft: spacing[3],
    borderLeftWidth: 2,
    borderLeftColor: colors.rose.light,
    gap: spacing[1],
  },
  whyLabel: {
    fontSize: 11,
    lineHeight: 17,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.rose.light,
  },
  continuityRow: {
    marginTop: spacing[4],
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[2],
  },
  continuityText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 19,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.surface,
  },
  evidenceLabel: {
    marginTop: spacing[3],
    fontSize: 11,
    lineHeight: 17,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.gold.light,
  },
  whyDisclosureButton: {
    minHeight: 44,
    alignSelf: "flex-start",
    paddingHorizontal: spacing[1],
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
  },
  whyDisclosureText: {
    fontSize: 12,
    lineHeight: 19,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.gold.light,
    textDecorationLine: "underline",
  },
  companionActions: {
    marginTop: spacing[4],
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[2],
  },
  primaryCompanionAction: {
    minHeight: 46,
    paddingHorizontal: spacing[4],
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[2],
    borderRadius: radius.full,
    backgroundColor: colors.surface,
  },
  secondaryCompanionAction: {
    minHeight: 46,
    paddingHorizontal: spacing[4],
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[2],
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.noir.soft,
    backgroundColor: colors.noir[900],
  },
  secondaryCompanionActionText: {
    fontSize: 13,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.surface,
  },
  weddingContext: {
    marginTop: spacing[4],
    paddingVertical: spacing[4],
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  weddingContextTop: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: spacing[5],
  },
  weddingDateContext: {
    flexShrink: 1,
  },
  contextEyebrow: {
    color: colors.rose[600],
  },
  contextDday: {
    marginTop: spacing[1],
    fontSize: 28,
    lineHeight: 36,
    fontFamily: "NotoSansKR_700Bold",
    color: colors.noir[800],
  },
  contextDdayUnset: {
    fontSize: 18,
    lineHeight: 28,
  },
  contextDate: {
    marginTop: 1,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
  },
  progressContext: {
    width: 132,
    paddingBottom: spacing[1],
  },
  contextProgressHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing[2],
  },
  contextProgressLabel: {
    fontSize: 11,
    lineHeight: 17,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
  },
  contextProgressValue: {
    fontSize: 13,
    lineHeight: 19,
    fontFamily: "NotoSansKR_700Bold",
    color: colors.noir[800],
  },
  contextProgressTrack: {
    height: 5,
    overflow: "hidden",
    borderRadius: radius.full,
    backgroundColor: colors.ivory[200],
  },
  contextProgressFill: {
    height: "100%",
    borderRadius: radius.full,
    backgroundColor: colors.rose[500],
  },
  contextMomentCopy: {
    marginTop: spacing[3],
    fontSize: 12,
    lineHeight: 19,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
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
    backgroundColor: colors.surface,
  },
  focusActionText: {
    fontSize: 13,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.noir[900],
  },
  section: {
    marginTop: spacing[8],
  },
  preparationDescription: {
    maxWidth: 520,
    fontSize: 13,
    lineHeight: 21,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
  },
  preparationSummary: {
    marginTop: spacing[3],
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[2],
  },
  preparationSummaryItem: {
    minHeight: 30,
    paddingHorizontal: spacing[3],
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
  },
  preparationSummaryLabel: {
    fontSize: 11,
    lineHeight: 17,
    fontFamily: "NotoSansKR_600SemiBold",
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
    marginTop: spacing[4],
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
  simpleCopy: {
    flex: 1,
  },
  preparationRowHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[3],
  },
  simpleTitle: {
    flex: 1,
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
  preparationStatusLabel: {
    fontSize: 11,
    lineHeight: 17,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.rose[600],
  },
  preparationAllButton: {
    minHeight: 44,
    marginTop: spacing[2],
    paddingHorizontal: spacing[2],
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
  },
  preparationAllButtonText: {
    fontSize: 13,
    lineHeight: 20,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.noir[800],
  },
  preparationEmpty: {
    minHeight: 64,
    marginTop: spacing[4],
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  preparationEmptyText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 21,
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
  amoraCard: {
    minHeight: 140,
    marginTop: spacing[6],
    padding: spacing[5],
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[4],
    borderRadius: radius["3xl"],
    backgroundColor: colors.noir[900],
  },
  amoraIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.xl,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.noir.soft,
  },
  amoraCopy: {
    flex: 1,
  },
  amoraEyebrow: {
    color: colors.rose.light,
    marginBottom: spacing[1],
  },
  amoraTitle: {
    fontSize: 17,
    lineHeight: 24,
    fontFamily: "NotoSansKR_700Bold",
    color: colors.surface,
  },
  amoraDescription: {
    marginTop: spacing[1],
    fontSize: 12,
    lineHeight: 19,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.gold.light,
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
    borderRadius: radius["3xl"],
    backgroundColor: colors.noir[800],
  },
  loadingLineDark: {
    height: 12,
    borderRadius: radius.full,
    backgroundColor: colors.noir.soft,
  },
  loadingDivider: {
    height: 1,
    marginVertical: spacing[2],
    backgroundColor: colors.noir.soft,
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
