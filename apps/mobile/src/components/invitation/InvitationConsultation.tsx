import type { ReactNode } from "react";
import { Image, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { STATUS_COPY, type ConsultationModel, type InvitationRouteKey } from "@hanbang/shared/invitation";
import { Text } from "@/components/ui/AppText";
import AmoraOrb from "@/components/ui/AmoraOrb";
import InvitationBackButton from "./InvitationBackButton";
import InvitationButton from "./InvitationButton";
import { invitationTabBarClearance } from "./InvitationTabBar";
import { invitationPhotoSource } from "./invitationPhotos";
import { BROWSER_BUTTON_TEXT, em, lineHeight, palette, paragraph17, photoFill, shadow, typo } from "./invitationStyle";

type Props = {
  model: ConsultationModel;
  onNavigate: (route: InvitationRouteKey) => void;
  /** 뒤로. 없으면 홈으로 간다(아티팩트 링크). */
  onBack?: () => void;
  /** "캘린더에 있어요". 없으면 눌리지 않는다. */
  onOpenCalendar?: () => void;
  /**
   * 사진 위 첫 단추의 글자. 없으면 아티팩트의 "캘린더에 있어요"다. 실제 커플은 상담이 아직 일정에 없으면
   * "일정에 넣기"로 바꾼다(없는 일을 있다고 말하지 않는다).
   */
  calendarLabel?: string;
  /** "준호 님과 공유". 없으면 눌리지 않는다. */
  onShare?: () => void;
  /** 아모라 소식 아래 단추(모델 `updateActions` 순서). 없으면 눌리지 않는다. */
  onUpdateAction?: (index: number) => void;
  topInset?: number;
  /** 떠 있는 하단 메뉴가 함께 있으면(로그인한 커플의 일정 탭) 마지막 칸을 메뉴 위까지 올린다. */
  withTabBar?: boolean;
  /** 물어볼 것 아래에 두는 것(실제 커플: 전체 일정으로 가는 길). 없으면 그리지 않는다(예시). */
  footer?: ReactNode;
  /**
   * `footer` 에 입력칸이 들어올 때(실제 커플: 받은 답 붙여 넣기, D-83 1단계). 키보드를 피하고(iOS), 키보드가 떠 있어도
   * 단추가 한 번에 눌리게 한다. 없으면 오늘과 같다.
   */
  keyboardAware?: boolean;
};

/**
 * 답장과 상담 확정(`Status.dc`, 390×1000). 사진 위 확정 카드, 아모라 소식, 상담에서 물어볼 것.
 */
export default function InvitationConsultation({
  model,
  onNavigate,
  onBack,
  onOpenCalendar,
  calendarLabel = STATUS_COPY.inCalendar,
  onShare,
  onUpdateAction,
  topInset,
  withTabBar = false,
  footer,
  keyboardAware = false,
}: Props) {
  const insets = useSafeAreaInsets();
  const top = topInset ?? insets.top;
  const photo = invitationPhotoSource(model.photo);
  const update = model.update;
  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={{ paddingBottom: withTabBar ? invitationTabBarClearance(insets) + 24 : Math.max(24, insets.bottom) }}
      automaticallyAdjustKeyboardInsets={keyboardAware ? true : undefined}
      keyboardShouldPersistTaps={keyboardAware ? "handled" : undefined}
    >
      <View style={[styles.hero, { height: 430 + top }]}>
        {photo ? (
          <Image
            source={photo}
            resizeMode="cover"
            style={photoFill}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
        ) : null}
        <InvitationBackButton
          label={STATUS_COPY.back}
          onPress={onBack ?? (() => onNavigate("home"))}
          tone="glass"
          style={[styles.back, { top: 14 + top }]}
        />
        <View style={[styles.card, { top: 76 + top }]}>
          <View style={styles.cardInner}>
            <Text style={[typo.sans, styles.center, styles.eyebrow]}>{STATUS_COPY.eyebrow}</Text>
            <Text style={[typo.numeralMedium, styles.center, styles.date]}>{model.dateLabel}</Text>
            <Text style={[typo.serif, styles.center, styles.time]}>{model.timeLabel}</Text>
            <View style={styles.rule} />
            <Text style={[typo.serifBold, styles.center, styles.venue]}>{model.venue}</Text>
            <Text style={[typo.sans, styles.center, styles.place]}>{model.place}</Text>
          </View>
        </View>
        <View style={styles.heroActions}>
          <InvitationButton
            label={calendarLabel}
            onPress={onOpenCalendar}
            variant="glass"
            height={40}
            paddingHorizontal={16}
            fontSize={13}
            weight="500"
            color={BROWSER_BUTTON_TEXT}
          />
          {model.partnerName ? (
            <InvitationButton
              label={STATUS_COPY.shareWith(model.partnerName)}
              onPress={onShare}
              variant="glass"
              height={40}
              paddingHorizontal={16}
              fontSize={13}
              weight="500"
              color={BROWSER_BUTTON_TEXT}
            />
          ) : null}
        </View>
      </View>

      <View style={styles.content}>
        {update ? (
          <View style={styles.update}>
            <View style={styles.updateHead}>
              <AmoraOrb size={40} mood={update.mood} />
              <Text style={[typo.sans, styles.updateTime]}>{update.timeLabel}</Text>
            </View>
            <Text style={paragraph17}>{update.text}</Text>
            {model.updateActions.length > 0 ? (
              <View style={styles.updateActions}>
                {model.updateActions.map((action, index) => (
                  <InvitationButton
                    key={action.label}
                    label={action.label}
                    onPress={onUpdateAction ? () => onUpdateAction(index) : undefined}
                    variant={action.tone === "ink" ? "ink" : "outline"}
                    height={46}
                    paddingHorizontal={action.tone === "ink" ? 20 : 18}
                    fontSize={14}
                    weight={action.tone === "ink" ? "700" : "400"}
                    color={action.tone === "ink" ? undefined : BROWSER_BUTTON_TEXT}
                  />
                ))}
              </View>
            ) : null}
          </View>
        ) : null}

        {model.questions.length > 0 ? (
          <View style={styles.questions}>
            <Text accessibilityRole="header" style={[typo.serifBold, styles.questionsHeading]}>
              {STATUS_COPY.questionsHeading(model.venue)}
            </Text>
            <View style={styles.questionList}>
              {model.questions.map((question, index) => (
                <View key={question} style={styles.question}>
                  <Text style={[typo.numeral, styles.questionNumber]}>{String(index + 1)}</Text>
                  <Text style={[typo.sans, styles.questionText]}>{question}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}
        {footer}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.white },
  center: { textAlign: "center" },
  hero: { overflow: "hidden", borderBottomLeftRadius: 36, borderBottomRightRadius: 36, backgroundColor: palette.stone },
  back: { position: "absolute", left: 12 },
  card: {
    position: "absolute",
    left: 40,
    right: 40,
    backgroundColor: palette.white,
    borderRadius: 6,
    padding: 8,
    boxShadow: shadow.statusCard,
  },
  cardInner: {
    borderWidth: 1,
    borderColor: palette.goldLine,
    paddingTop: 24,
    paddingHorizontal: 16,
    paddingBottom: 20,
    alignItems: "center",
    gap: 6,
  },
  eyebrow: { fontSize: 11, letterSpacing: em(11, 0.18), color: palette.goldInk },
  date: { fontSize: 52, lineHeight: lineHeight(52, 1.05), letterSpacing: em(52, 0.03) },
  time: { fontSize: 15 },
  rule: { width: 24, height: 1, backgroundColor: palette.goldRule, marginVertical: 8 },
  venue: { fontSize: 18 },
  place: { fontSize: 12, color: palette.muted },
  heroActions: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 20,
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
  },
  content: { gap: 22, paddingTop: 22, paddingHorizontal: 22 },
  update: { gap: 12 },
  updateHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  updateTime: { fontSize: 13, color: palette.muted },
  updateActions: { flexDirection: "row", gap: 8 },
  questions: { backgroundColor: palette.paperSoft, borderRadius: 24, padding: 20, gap: 12 },
  questionsHeading: { fontSize: 17 },
  questionList: { gap: 10 },
  question: { flexDirection: "row", gap: 12 },
  // 목록의 줄 높이 1.5 는 비율로 물려받아 17px 번호는 25.5px 줄을 가진다(아티팩트 그대로).
  questionNumber: { width: 14, fontSize: 17, color: palette.goldInk, lineHeight: lineHeight(17, 1.5) },
  questionText: { flex: 1, fontSize: 15, lineHeight: lineHeight(15, 1.5) },
});
