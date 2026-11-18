import { useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  BLANK_MARK,
  FIRST_CHAT_COPY,
  FIRST_CHAT_INPUT_COPY,
  type FirstChatModel,
  type InvitationRouteKey,
  type PreparationStartStage,
} from "@hanbang/shared/invitation";
import { Text } from "@/components/ui/AppText";
import AmoraOrb from "@/components/ui/AmoraOrb";
import InvitationBackButton from "./InvitationBackButton";
import InvitationButton from "./InvitationButton";
import InvitationCard from "./InvitationCard";
import { invitationTabBarClearance } from "./InvitationTabBar";
import { hitSlopFor, lineHeight, opaqueScroll, palette, paragraph17, shadow, typo } from "./invitationStyle";

/**
 * 실제 커플의 첫 대화(조건 묻기, 2026-11-17). 주면 고른 값은 부모가 들고 저장도 부모가 한다.
 * 아티팩트는 다 고른 뒤의 모습이라, 실제 커플에게는 고른 답이 생긴 뒤에만 사람 말풍선을 그린다
 * (아티팩트의 사람 말풍선 자리에 고른 답이 들어간다). 지역은 공유 목록에서, 하객 수는 정해진 칩에서 고른다.
 */
export type FirstChatLive = {
  stage: PreparationStartStage | null;
  month: number | null;
  /** 지역 공유 목록. 비어 있으면 지역 고르기 칩을 그리지 않는다. */
  regions: readonly string[];
  region: string | null;
  guests: number | null;
  onStage: (stage: PreparationStartStage) => void;
  onMonth: (month: number) => void;
  onRegion: (region: string) => void;
  onGuests: (guests: number) => void;
  /** "좋아요, 홀 찾아 주세요". 저장은 부모가 한다. */
  onConfirm: () => void;
  canConfirm: boolean;
  saving: boolean;
  failed: boolean;
  /**
   * "나중에 할게요"(`FIRST_CHAT_INPUT_COPY.later`). 이미 쓰던 커플이 새 질문에 갇히지 않게 홈으로 간다.
   * 주면 아래 단추 묶음 밑에 글자 단추로 둔다(편지 시트의 "나중에 할게요"와 같은 모양).
   */
  onLater?: () => void;
};

type Props = {
  model: FirstChatModel;
  onBack: () => void;
  onNavigate: (route: InvitationRouteKey) => void;
  /** 처음 고른 단계와 달. 아티팩트는 "이제 시작해요"와 5월. */
  initialStage?: PreparationStartStage;
  initialMonth?: number;
  onStageChange?: (stage: PreparationStartStage) => void;
  onMonthChange?: (month: number) => void;
  /** "고칠게요". 없으면 위로 올라가 다시 고르게 한다. */
  onEdit?: () => void;
  topInset?: number;
  /** 실제 커플(조건 묻기). 없으면 예시 커플의 아티팩트 화면 그대로다. */
  live?: FirstChatLive;
  /** 떠 있는 하단 메뉴가 함께 있으면(로그인한 커플의 홈 탭) 아래 단추 묶음을 메뉴 위로 올린다. */
  withTabBar?: boolean;
};

function liveAnswer(live: FirstChatLive): string | null {
  if (live.region && live.guests !== null) return FIRST_CHAT_COPY.regionGuestsAnswer(live.region, live.guests);
  if (live.guests !== null) return FIRST_CHAT_INPUT_COPY.guestChoiceLabel(live.guests);
  return live.region;
}

/**
 * 아모라와 첫 대화(`Chat.dc`, 390×960). 말풍선 없는 대화(아모라 글은 그냥 문단, 사람 답만 돌빛 말풍선)와
 * 달 고르기, 청첩장 초안. 고른 단계와 달은 화면 안 상태다(실제 커플은 `live` 가 든다).
 */
export default function InvitationFirstChat({
  model,
  onBack,
  onNavigate,
  initialStage = "start",
  initialMonth = 5,
  onStageChange,
  onMonthChange,
  onEdit,
  topInset,
  live,
  withTabBar = false,
}: Props) {
  const insets = useSafeAreaInsets();
  const footerBottom = withTabBar ? invitationTabBarClearance(insets) + 12 : Math.max(26, insets.bottom);
  const scroll = useRef<ScrollView>(null);
  const [ownStage, setStage] = useState<PreparationStartStage>(initialStage);
  const [ownMonth, setMonth] = useState(initialMonth);
  const stage = live ? live.stage : ownStage;
  const month = live ? live.month : ownMonth;
  const current = live
    ? FIRST_CHAT_COPY.stages.find((item) => item.id === stage) ?? null
    : FIRST_CHAT_COPY.stages.find((item) => item.id === stage) ?? FIRST_CHAT_COPY.stages[0];
  const months = FIRST_CHAT_COPY.months;
  const monthRows = [months.slice(0, 4), months.slice(4, 8)];
  const facts = {
    firstName: model.names.first,
    secondName: model.names.second,
    year: model.year,
    month,
    day: null,
    timeLabel: null,
    venueName: null,
  };
  const answer = live ? liveAnswer(live) : FIRST_CHAT_COPY.regionGuestsAnswer(model.region, model.guests);
  const draftLine = live
    ? live.region && live.guests !== null ? FIRST_CHAT_COPY.draftLine(live.region, live.guests) : BLANK_MARK
    : FIRST_CHAT_COPY.draftLine(model.region, model.guests);
  const confirmReady = !live || (live.canConfirm && !live.saving);
  const confirmButton = (
    <InvitationButton
      label={live?.saving ? FIRST_CHAT_INPUT_COPY.saving : FIRST_CHAT_COPY.confirm}
      onPress={live ? (confirmReady ? live.onConfirm : undefined) : () => onNavigate("home")}
      variant="ink"
      height={54}
      fontSize={15}
      weight="700"
      style={[styles.flex, !confirmReady && styles.unavailable]}
    />
  );
  const editButton = (
    <InvitationButton
      label={FIRST_CHAT_COPY.edit}
      onPress={onEdit ?? (() => scroll.current?.scrollTo({ y: 0, animated: true }))}
      variant="stone"
      height={54}
      paddingHorizontal={20}
      fontSize={15}
      weight="500"
    />
  );

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: 16 + (topInset ?? insets.top) }]}>
        <InvitationBackButton
          label={FIRST_CHAT_COPY.back}
          onPress={onBack}
          style={[styles.back, { top: 16 + (topInset ?? insets.top) }]}
        />
        <AmoraOrb size={64} mood="calm" />
        <Text style={[typo.sans, styles.listening]}>{FIRST_CHAT_COPY.listening}</Text>
      </View>

      <ScrollView ref={scroll} style={[styles.flex, opaqueScroll]} contentContainerStyle={styles.content}>
        <Text style={paragraph17}>{FIRST_CHAT_COPY.greeting}</Text>
        <View style={styles.chips}>
          {FIRST_CHAT_COPY.stages.map((item) => {
            const on = item.id === stage;
            return (
              <Pressable
                key={item.id}
                onPress={() => {
                  if (live) {
                    live.onStage(item.id);
                    return;
                  }
                  setStage(item.id);
                  onStageChange?.(item.id);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                hitSlop={hitSlopFor(42)}
                style={[styles.chip, on ? styles.chipOn : styles.chipOff]}
              >
                <Text style={[typo.sans, styles.chipText, on && styles.chipTextOn]}>{item.label}</Text>
              </Pressable>
            );
          })}
        </View>
        {current ? (
          <View style={styles.bubble}>
            <Text style={[typo.sans, styles.bubbleText]}>{current.answer}</Text>
          </View>
        ) : null}

        <Text style={paragraph17}>{FIRST_CHAT_COPY.askWhen}</Text>
        <View style={styles.monthCard}>
          <View style={styles.monthHead}>
            <Text style={[typo.numeralMedium, styles.year]}>{String(model.year)}</Text>
            <Text style={[typo.sans, styles.monthNote]}>{FIRST_CHAT_COPY.monthsNote}</Text>
          </View>
          <View style={styles.grid}>
            {monthRows.map((row, rowIndex) => (
              <View key={rowIndex} style={styles.gridRow}>
                {row.map((value) => {
                  const on = value === month;
                  return (
                    <Pressable
                      key={value}
                      onPress={() => {
                        if (live) {
                          live.onMonth(value);
                          return;
                        }
                        setMonth(value);
                        onMonthChange?.(value);
                      }}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      style={[styles.month, on && styles.monthOn]}
                    >
                      <Text style={[typo.sans, styles.monthText, on && styles.monthTextOn]}>
                        {FIRST_CHAT_COPY.monthLabel(value)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </View>
        </View>

        {live ? (
          <>
            <Text style={paragraph17}>{FIRST_CHAT_INPUT_COPY.askWhereAndGuests}</Text>
            {live.regions.length > 0 ? (
              <ChoiceGroup
                label={FIRST_CHAT_INPUT_COPY.regionLabel}
                choices={live.regions.map((region) => ({
                  key: region,
                  label: region,
                  on: region === live.region,
                  onPress: () => live.onRegion(region),
                }))}
              />
            ) : null}
            <ChoiceGroup
              label={FIRST_CHAT_INPUT_COPY.guestsLabel}
              choices={FIRST_CHAT_INPUT_COPY.guestChoices.map((guests) => ({
                key: String(guests),
                label: FIRST_CHAT_INPUT_COPY.guestChoiceLabel(guests),
                on: guests === live.guests,
                onPress: () => live.onGuests(guests),
              }))}
            />
          </>
        ) : null}
        {answer ? (
          <View style={styles.bubble}>
            <Text style={[typo.sans, styles.bubbleText]}>{answer}</Text>
          </View>
        ) : null}

        <Text style={paragraph17}>{FIRST_CHAT_COPY.draftIntro}</Text>
        <InvitationCard variant="draft" facts={facts} line={draftLine} />
      </ScrollView>

      {live?.failed ? (
        <Text accessibilityLiveRegion="polite" style={[typo.sans, styles.failed]}>{FIRST_CHAT_INPUT_COPY.saveFailed}</Text>
      ) : null}
      {live?.onLater ? (
        <View style={[styles.footerColumn, { paddingBottom: footerBottom }]}>
          <View style={styles.footerRow}>
            {confirmButton}
            {editButton}
          </View>
          <InvitationButton label={FIRST_CHAT_INPUT_COPY.later} onPress={live.onLater} variant="plain" height={44} fontSize={14} />
        </View>
      ) : (
        <View style={[styles.footer, { paddingBottom: footerBottom }]}>
          {confirmButton}
          {editButton}
        </View>
      )}
    </View>
  );
}

/** 실제 커플의 지역·하객 수 칩. 단계 칩(42px 알약)과 같은 모양에 작은 이름표를 단다. */
function ChoiceGroup({
  label,
  choices,
}: {
  label: string;
  choices: readonly { key: string; label: string; on: boolean; onPress: () => void }[];
}) {
  return (
    <View style={styles.choiceGroup}>
      <Text style={[typo.sans, styles.choiceLabel]}>{label}</Text>
      <View style={styles.chips}>
        {choices.map((choice) => (
          <Pressable
            key={choice.key}
            onPress={choice.onPress}
            accessibilityRole="button"
            accessibilityLabel={`${label} ${choice.label}`}
            accessibilityState={{ selected: choice.on }}
            hitSlop={hitSlopFor(42)}
            style={[styles.chip, choice.on ? styles.chipOn : styles.chipOff]}
          >
            <Text style={[typo.sans, styles.chipText, choice.on && styles.chipTextOn]}>{choice.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.white },
  flex: { flex: 1 },
  header: { alignItems: "center", paddingHorizontal: 20, paddingBottom: 8 },
  back: { position: "absolute", left: 10 },
  listening: { fontSize: 12, color: palette.muted, marginTop: 4 },
  content: { gap: 18, paddingTop: 12, paddingHorizontal: 22, paddingBottom: 12 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { height: 42, paddingHorizontal: 16, borderRadius: 21, justifyContent: "center" },
  chipOn: { backgroundColor: palette.ink },
  chipOff: { borderWidth: 1, borderColor: palette.chipLine, backgroundColor: palette.white },
  chipText: { fontSize: 14 },
  chipTextOn: { color: palette.white, fontWeight: "500" },
  bubble: {
    alignSelf: "flex-end",
    maxWidth: 260,
    backgroundColor: palette.stone,
    borderRadius: 20,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  bubbleText: { fontSize: 15, lineHeight: lineHeight(15, 1.5) },
  monthCard: {
    borderRadius: 24,
    backgroundColor: palette.paper,
    boxShadow: shadow.insetRing,
    paddingTop: 18,
    paddingHorizontal: 18,
    paddingBottom: 16,
    gap: 14,
  },
  monthHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  year: { fontSize: 30, lineHeight: 30 },
  monthNote: { fontSize: 12, color: palette.muted },
  grid: { gap: 6 },
  gridRow: { flexDirection: "row", gap: 6 },
  month: { flex: 1, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  monthOn: { backgroundColor: palette.ink },
  monthText: { fontSize: 14, color: palette.body },
  monthTextOn: { color: palette.white, fontWeight: "700" },
  footer: { flexDirection: "row", gap: 8, paddingTop: 12, paddingHorizontal: 16 },
  // 실제 커플: 같은 두 단추 줄 아래 "나중에 할게요" 글자 단추(편지 시트의 단추 묶음과 같은 간격 4).
  footerColumn: { gap: 4, paddingTop: 12, paddingHorizontal: 16 },
  footerRow: { flexDirection: "row", gap: 8 },
  // 아래는 실제 커플(조건 묻기)에만 쓰인다. 아티팩트 값(12px 흐린 이름표, 13px 안내)에 맞춘다.
  choiceGroup: { gap: 8 },
  choiceLabel: { fontSize: 12, color: palette.muted },
  failed: { fontSize: 13, lineHeight: lineHeight(13, 1.6), color: palette.body, paddingTop: 10, paddingHorizontal: 22 },
  unavailable: { opacity: 0.4 },
});
