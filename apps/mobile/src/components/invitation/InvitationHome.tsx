import { useState, type ReactElement, type ReactNode } from "react";
import { Image, Pressable, ScrollView, StyleSheet, View, type RefreshControlProps } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  HOME_COPY,
  INVITATION_FIELD_COUNT,
  filledInvitationFieldCount,
  invitationBlankCount,
  type DecisionItem,
  type DecisionOwner,
  type HomeModel,
  type InvitationRouteKey,
} from "@hanbang/shared/invitation";
import { Text } from "@/components/ui/AppText";
import AmoraOrb from "@/components/ui/AmoraOrb";
import InvitationButton from "./InvitationButton";
import InvitationCard from "./InvitationCard";
import { INVITATION_BACKDROP } from "./invitationPhotos";
import { INVITATION_TAB_BAR_HEIGHT, invitationTabBarBottom } from "./InvitationTabBar";
import { glass, hitSlopFor, lineHeight, palette, paragraph17, photoFill, shadow, typo } from "./invitationStyle";

type Props = {
  model: HomeModel;
  onNavigate: (route: InvitationRouteKey) => void;
  /** 화면 위 안전 영역. 사진은 그 아래까지 깔고 글자만 내린다. 위에 다른 띠가 있으면 0. */
  topInset?: number;
  /** 떠 있는 하단 메뉴를 함께 그리면 그 높이만큼 아래 여백을 둔다(아티팩트 110px). */
  withTabBar?: boolean;
  /**
   * 실제 커플의 알림 자리(상대가 바꾼 것, 합류 직후 안내, 첫 도착 안내). 청첩장 아래, 아모라 소식 위에 둔다.
   * 할 말이 없으면 각 알림이 아무것도 그리지 않아 자리도 생기지 않는다. 예시 커플은 넘기지 않는다.
   */
  notices?: ReactNode;
  /** 실제 커플: 오른쪽 위 머리글자 묶음을 누르면 여는 곳(내 정보). 없으면 누를 수 없는 장식이다(예시). */
  peopleAction?: { label: string; hint?: string; onPress: () => void };
  /**
   * 두 분이 정할 것(서버가 준 줄)이 비었을 때(또는 읽지 못했을 때) 목록 아래 한 줄. 없으면 빈 목록은 그 칸을
   * 그리지 않는다(예시 커플은 늘 목록이 있다). `leadDecision` 이 있으면 그 줄 아래에 온다.
   */
  decisionsNote?: string | null;
  refreshControl?: ReactElement<RefreshControlProps>;
  /** 메뉴 위에 떠 있는 것(아모라 버튼과 말풍선)이 있으면 그 높이만큼 아래 여백을 더한다. */
  bottomExtra?: number;
  /**
   * 실제 커플: "무엇을 했나요?" 각 줄을 누가 했는지(아모라·담당자·두 분). 소식의 줄과 같은 순서다. 주면 줄 앞에
   * 작게 붙인다 — 담당자가 한 일이 아모라가 한 일로 읽히지 않게 한다. 없으면 붙이지 않는다(예시).
   */
  stepActors?: readonly (string | null)[];
  /**
   * 실제 커플: "두 분이 정할 것" 맨 앞에 더하는 한 줄(조건이 비었을 때 첫 대화를 다시 여는 줄). 모양은 다른 줄과
   * 같고, 누르면 `onPress` 를 부른다. 없으면 그리지 않는다(예시).
   */
  leadDecision?: { id: string; title: string; sub: string | null; owner: DecisionOwner; onPress: () => void };
};

/**
 * 청첩장 홈(`Home.dc`, 390×1000). 보케 위 빈칸 있는 청첩장, 아모라 소식, 두 분이 정할 것.
 * 모델만 읽는다 — 예시 커플과 실제 커플이 같은 화면을 그린다.
 */
export default function InvitationHome({
  model,
  onNavigate,
  topInset,
  withTabBar = false,
  notices,
  peopleAction,
  decisionsNote,
  refreshControl,
  bottomExtra = 0,
  stepActors,
  leadDecision,
}: Props) {
  const insets = useSafeAreaInsets();
  const rows: { item: Pick<DecisionItem, "id" | "title" | "sub" | "owner">; onPress?: () => void }[] = [
    ...(leadDecision ? [{ item: leadDecision, onPress: leadDecision.onPress }] : []),
    ...model.decisions.map((item) => {
      const target = item.target;
      return { item, onPress: target ? () => onNavigate(target) : undefined };
    }),
  ];
  // 서버가 준 줄이 없을 때만 한 줄로 말한다(맨 앞 줄이 있어도 "불러오지 못했어요"는 남는다).
  const showDecisionsNote = model.decisions.length === 0 && Boolean(decisionsNote);
  const top = topInset ?? insets.top;
  const bottom = (withTabBar ? invitationTabBarBottom(insets) + INVITATION_TAB_BAR_HEIGHT + 24 : Math.max(22, insets.bottom)) + bottomExtra;
  const facts = model.invitation;
  const filled = filledInvitationFieldCount(facts);
  const people = (
    <View style={styles.people}>
      {model.people.map((person, index) => (
        <View key={`${person.name}-${index}`} style={[styles.person, index === 0 ? styles.personFirst : styles.personNext]}>
          <Text accessibilityLabel={person.name} style={[typo.sansBold, styles.personInitial]}>
            {person.initial}
          </Text>
        </View>
      ))}
    </View>
  );

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ paddingBottom: bottom }} refreshControl={refreshControl}>
      <View style={[styles.hero, { height: 470 + top }]}>
        <Image
          source={INVITATION_BACKDROP}
          resizeMode="cover"
          style={photoFill}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
        <View style={[styles.topBar, { top: 18 + top }]}>
          <Text style={[typo.numeralMediumItalic, styles.wordmark]}>{HOME_COPY.wordmark}</Text>
          {peopleAction ? (
            <Pressable
              onPress={peopleAction.onPress}
              accessibilityRole="button"
              accessibilityLabel={peopleAction.label}
              accessibilityHint={peopleAction.hint}
              hitSlop={{ ...hitSlopFor(34), left: 6, right: 6 }}
            >
              {people}
            </Pressable>
          ) : (
            people
          )}
        </View>
        <InvitationCard variant="home" facts={facts} style={[styles.card, { top: 78 + top }]} />
        <View style={styles.blanks}>
          <Text style={[typo.sansMedium, styles.blanksText]}>{HOME_COPY.blanksLeft(invitationBlankCount(facts))}</Text>
          <View style={styles.bars} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {Array.from({ length: INVITATION_FIELD_COUNT }, (_, index) => (
              <View key={index} style={[styles.bar, { backgroundColor: index < filled ? palette.white : glass.barEmpty }]} />
            ))}
          </View>
        </View>
      </View>

      <View style={styles.content}>
        {notices}
        {model.update ? <UpdateSection update={model.update} onNavigate={onNavigate} stepActors={stepActors} /> : null}
        {rows.length > 0 || showDecisionsNote ? (
          <View>
            <Text accessibilityRole="header" style={[typo.serifBold, styles.decisionsHeading]}>
              {HOME_COPY.decisionsHeading}
            </Text>
            {rows.map(({ item, onPress }, index) => (
              <DecisionRow key={item.id} item={item} last={index === rows.length - 1} onPress={onPress} />
            ))}
            {showDecisionsNote ? <Text style={[typo.sans, styles.decisionsNote]}>{decisionsNote}</Text> : null}
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}

function UpdateSection({
  update,
  onNavigate,
  stepActors,
}: {
  update: NonNullable<HomeModel["update"]>;
  onNavigate: (route: InvitationRouteKey) => void;
  stepActors?: readonly (string | null)[];
}) {
  const [open, setOpen] = useState(false);
  const primary = update.primary;
  return (
    <View style={styles.update}>
      <View style={styles.updateHead}>
        <AmoraOrb size={36} mood={update.mood} />
        <Text style={[typo.sans, styles.updateTime]}>{update.timeLabel}</Text>
      </View>
      <Text style={paragraph17}>{update.text}</Text>
      {open ? (
        <View style={styles.steps}>
          {update.steps.map((step, index) => (
            <View key={step} style={styles.step}>
              <Text style={[typo.sans, styles.stepText, styles.stepMarker]}>{`${index + 1}.`}</Text>
              <Text style={[typo.sans, styles.stepText, styles.stepBody]}>
                {stepActors?.[index] ? <Text style={styles.stepActor}>{`${stepActors[index]} · `}</Text> : null}
                {step}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      {primary || update.steps.length > 0 ? (
        <View style={styles.actions}>
          {primary ? (
            <InvitationButton
              label={primary.label}
              onPress={() => onNavigate(primary.target)}
              variant="ink"
              height={46}
              paddingHorizontal={22}
              fontSize={14}
              weight="700"
            />
          ) : null}
          {update.steps.length > 0 ? (
            <Pressable
              onPress={() => setOpen((value) => !value)}
              accessibilityRole="button"
              accessibilityState={{ expanded: open }}
              style={styles.toggle}
            >
              {({ pressed }) => (
                <Text style={[typo.sans, styles.toggleText, pressed && { color: palette.muted }]}>
                  {open ? HOME_COPY.fold : HOME_COPY.whatDidYouDo}
                </Text>
              )}
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function DecisionRow({
  item,
  last,
  onPress,
}: {
  item: Pick<DecisionItem, "title" | "sub" | "owner">;
  last: boolean;
  /** 누르면 할 일. 없으면 누를 수 없는 줄이다(모델의 `target` 이 null 인 줄). */
  onPress?: () => void;
}) {
  const together = item.owner.kind === "together";
  const content = (pressed: boolean) => (
    <>
      <View style={styles.decisionText}>
        <Text style={[typo.sansMedium, styles.decisionTitle, pressed && { color: palette.muted }]}>{item.title}</Text>
        {item.sub ? <Text style={[typo.sans, styles.decisionSub]}>{item.sub}</Text> : null}
      </View>
      <View style={[styles.owner, { backgroundColor: together ? palette.blush : palette.stone }]}>
        <Text style={[typo.sans, styles.ownerText]}>
          {item.owner.kind === "together" ? HOME_COPY.together : item.owner.name}
        </Text>
      </View>
    </>
  );
  const rowStyle = [styles.decision, !last && styles.decisionDivider];
  if (!onPress) return <View style={rowStyle}>{content(false)}</View>;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={rowStyle}>
      {({ pressed }) => content(pressed)}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.white },
  hero: {
    overflow: "hidden",
    borderBottomLeftRadius: 36,
    borderBottomRightRadius: 36,
  },
  topBar: {
    position: "absolute",
    left: 18,
    right: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  wordmark: { fontSize: 26, color: palette.white },
  people: { flexDirection: "row" },
  person: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  personFirst: { backgroundColor: glass.chip },
  personNext: { marginLeft: -8, backgroundColor: palette.white, boxShadow: shadow.avatarHalo },
  personInitial: { fontSize: 12 },
  card: { position: "absolute", left: 34, right: 34 },
  blanks: {
    position: "absolute",
    left: 34,
    right: 34,
    bottom: 22,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  blanksText: { fontSize: 13, color: palette.white },
  bars: { flexDirection: "row", gap: 4 },
  bar: { width: 18, height: 3, borderRadius: 2 },
  content: { gap: 24, paddingTop: 22, paddingHorizontal: 22 },
  update: { gap: 12 },
  updateHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  updateTime: { fontSize: 13, color: palette.muted },
  steps: {
    paddingVertical: 14,
    paddingRight: 16,
    paddingLeft: 16,
    backgroundColor: palette.paperSoft,
    borderRadius: 18,
    gap: 8,
  },
  step: { flexDirection: "row" },
  stepText: { fontSize: 14, lineHeight: lineHeight(14, 1.55), color: palette.body },
  // 아티팩트 ol 의 번호는 왼쪽 34px 여백 안쪽 끝에 붙는다. 16 + 14 + 4 = 34.
  stepMarker: { width: 14, marginRight: 4, textAlign: "right" },
  stepBody: { flex: 1 },
  // 실제 커플의 "누가 했는지" 꼬리표. 줄 글자와 같은 크기에 흐린 색으로 붙인다(아티팩트에는 없는 값).
  stepActor: { color: palette.muted },
  actions: { flexDirection: "row", alignItems: "center", gap: 8 },
  toggle: { height: 46, paddingHorizontal: 16, borderRadius: 23, justifyContent: "center" },
  toggleText: { fontSize: 14, color: palette.body },
  decisionsHeading: { fontSize: 18, marginBottom: 6 },
  // 아티팩트에 없는 빈 목록 한 줄. 할 일 줄의 보조 글자(13px, 흐린 색)와 같은 말투로 둔다.
  decisionsNote: { fontSize: 14, lineHeight: lineHeight(14, 1.55), color: palette.muted, paddingVertical: 13 },
  decision: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 13 },
  decisionDivider: { borderBottomWidth: 1, borderBottomColor: palette.divider },
  decisionText: { flex: 1, gap: 3 },
  decisionTitle: { fontSize: 15 },
  decisionSub: { fontSize: 13, color: palette.muted },
  owner: { paddingVertical: 5, paddingHorizontal: 10, borderRadius: 999 },
  ownerText: { fontSize: 12 },
});
