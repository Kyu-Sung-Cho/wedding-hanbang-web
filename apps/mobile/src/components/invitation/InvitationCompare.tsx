import { Image, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  COMPARE_COPY,
  type CompareModel,
  type CompareSortId,
  type HallCard,
  type InvitationRouteKey,
} from "@hanbang/shared/invitation";
import { Text } from "@/components/ui/AppText";
import AmoraOrb from "@/components/ui/AmoraOrb";
import InvitationBackButton from "./InvitationBackButton";
import InvitationButton from "./InvitationButton";
import { HeartIcon } from "./InvitationIcons";
import { invitationPhotoSource } from "./invitationPhotos";
import { glass, hitSlopFor, lineHeight, opaqueScroll, palette, paragraph17, photoFill, typo } from "./invitationStyle";

const CARD_WIDTH = 290;
const CARD_GAP = 12;

type Props = {
  model: CompareModel;
  sort: CompareSortId;
  onSortChange: (sort: CompareSortId) => void;
  onTogglePick: (hallId: string) => void;
  onBack: () => void;
  onNavigate: (route: InvitationRouteKey) => void;
  topInset?: number;
  /** 실제 커플: 출처 줄 아래 한 줄(아직 담은 곳이 없을 때의 안내, 담기를 저장하지 못했을 때). 없으면 그리지 않는다. */
  notice?: string | null;
};

function leadingNumber(value: string | null): number {
  const match = value?.replace(/,/gu, "").match(/\d+(?:\.\d+)?/u);
  return match ? Number(match[0]) : Number.POSITIVE_INFINITY;
}

/**
 * 고른 순서로 카드를 늘어놓는다. 총액과 보증 인원은 모델의 숫자로 오름차순, 교통과 분위기는
 * 비교할 숫자가 모델에 없어 받은 순서 그대로다. 같은 값이면 받은 순서를 지킨다.
 */
export function sortHallCards(halls: readonly HallCard[], sort: CompareSortId): readonly HallCard[] {
  if (sort !== "total" && sort !== "minimum") return halls;
  const key = (hall: HallCard) => leadingNumber(sort === "total" ? hall.totalManwon : hall.minimum);
  return halls
    .map((hall, index) => ({ hall, index }))
    .sort((a, b) => key(a.hall) - key(b.hall) || a.index - b.index)
    .map(({ hall }) => hall);
}

/**
 * 웨딩홀 비교(`Compare.dc`, 390×960). 290px 카드를 옆으로 넘기며 보고, 하트로 상담 후보에 담는다.
 * 꼬리표("총액이 가장 낮아요" 등)는 모델 값만 쓴다 — 업체 품질을 점수로 매기지 않는다.
 */
export default function InvitationCompare({ model, sort, onSortChange, onTogglePick, onBack, onNavigate, topInset, notice }: Props) {
  const insets = useSafeAreaInsets();
  const halls = sortHallCards(model.halls, sort);
  const count = model.halls.filter((hall) => hall.picked).length;
  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: 16 + (topInset ?? insets.top) }]}>
        <InvitationBackButton label={COMPARE_COPY.back} onPress={onBack} />
        <AmoraOrb size={32} mood="calm" decorative />
        <Text style={[typo.sansMedium, styles.headerName]}>{COMPARE_COPY.amora}</Text>
      </View>

      <ScrollView style={[styles.flex, opaqueScroll]}>
        <Text style={[paragraph17, styles.intro]}>{COMPARE_COPY.intro(model.guests, model.month)}</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          snapToInterval={CARD_WIDTH + CARD_GAP}
          snapToAlignment="start"
          decelerationRate="fast"
          contentContainerStyle={styles.cards}
        >
          {halls.map((hall) => (
            <HallCardView key={hall.id} hall={hall} onToggle={() => onTogglePick(hall.id)} />
          ))}
        </ScrollView>
        <View style={styles.sortArea}>
          <View style={styles.sorts}>
            {COMPARE_COPY.sorts.map((item) => {
              const on = item.id === sort;
              return (
                <Pressable
                  key={item.id}
                  onPress={() => onSortChange(item.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  hitSlop={hitSlopFor(38)}
                  style={[styles.sort, on ? styles.sortOn : styles.sortOff]}
                >
                  <Text style={[typo.sans, styles.sortText, on && { color: palette.white }]}>{item.label}</Text>
                </Pressable>
              );
            })}
          </View>
          {model.sourceDateLabel ? (
            <Text style={[typo.sans, styles.source]}>{COMPARE_COPY.sourceNote(model.sourceDateLabel)}</Text>
          ) : null}
          {notice ? (
            <Text accessibilityLiveRegion="polite" style={[typo.sans, styles.notice]}>{notice}</Text>
          ) : null}
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(26, insets.bottom) }]}>
        <InvitationButton
          label={COMPARE_COPY.inquire(count)}
          onPress={count > 0 ? () => onNavigate("letter") : undefined}
          variant="ink"
          height={56}
          fontSize={15}
          weight="700"
          style={count === 0 && styles.unavailable}
        />
      </View>
    </View>
  );
}

function HallCardView({ hall, onToggle }: { hall: HallCard; onToggle: () => void }) {
  const photo = invitationPhotoSource(hall.photo);
  return (
    <View style={styles.card}>
      <View style={styles.photo}>
        {photo ? (
          <Image
            source={photo}
            resizeMode="cover"
            style={photoFill}
            accessible
            accessibilityRole="image"
            accessibilityLabel={COMPARE_COPY.photoAlt(hall.name)}
          />
        ) : null}
        {hall.badge ? (
          <View style={styles.badge}>
            <Text style={[typo.sansMedium, styles.badgeText]}>{hall.badge}</Text>
          </View>
        ) : null}
        <Pressable
          onPress={onToggle}
          accessibilityRole="button"
          accessibilityLabel={COMPARE_COPY.heartLabel(hall.name)}
          accessibilityState={{ selected: hall.picked }}
          style={styles.heart}
        >
          <HeartIcon filled={hall.picked} fill={palette.heart} stroke={hall.picked ? palette.heart : palette.ink} />
        </Pressable>
      </View>
      <View style={styles.cardBody}>
        <View style={styles.cardHead}>
          <View style={styles.nameBlock}>
            <Text style={[typo.serifBold, styles.name]}>{hall.name}</Text>
            <Text style={[typo.sans, styles.area]}>{hall.area}</Text>
          </View>
          {hall.totalManwon ? (
            <View style={styles.price}>
              <Text style={[typo.numeralMedium, styles.total]}>{hall.totalManwon}</Text>
              <Text style={[typo.sans, styles.unit]}>{COMPARE_COPY.manwon}</Text>
            </View>
          ) : null}
        </View>
        <View style={styles.facts}>
          <FactRow label={COMPARE_COPY.rows.meal} value={hall.meal} />
          <FactRow label={COMPARE_COPY.rows.rent} value={hall.rent} />
          <FactRow label={COMPARE_COPY.rows.minimum} value={hall.minimum} warn={hall.minimumWarn} />
          <FactRow label={COMPARE_COPY.rows.transit} value={hall.transit} />
        </View>
      </View>
    </View>
  );
}

function FactRow({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <View style={styles.fact}>
      <Text style={[typo.sans, styles.factLabel]}>{label}</Text>
      <Text style={[typo.sans, styles.factValue, warn && styles.factWarn]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.white },
  flex: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: 8, paddingRight: 16, paddingBottom: 4, paddingLeft: 10 },
  headerName: { fontSize: 14 },
  intro: { paddingTop: 10, paddingHorizontal: 22, paddingBottom: 18 },
  // 아티팩트의 가로 목록은 왼쪽 여백 22px 이 있지만, 파운더가 본 Chrome 에서는 scroll-snap 이 첫 카드를
  // 스크롤 영역 왼쪽 끝에 맞춰 첫 카드가 x=0 에 붙어 보인다. 그 모습대로 왼쪽 여백 없이 두고 302px 마다 멈춘다.
  cards: { gap: CARD_GAP, paddingRight: 22, paddingBottom: 8 },
  card: { width: CARD_WIDTH },
  photo: { height: 200, borderRadius: 24, overflow: "hidden", backgroundColor: palette.stone },
  badge: {
    position: "absolute",
    left: 12,
    top: 12,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: glass.bar,
  },
  badgeText: { fontSize: 12 },
  heart: {
    position: "absolute",
    right: 10,
    top: 10,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: glass.chip,
    alignItems: "center",
    justifyContent: "center",
  },
  cardBody: { paddingTop: 16, paddingHorizontal: 4, gap: 12 },
  cardHead: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 8 },
  nameBlock: { gap: 3, flexShrink: 1 },
  name: { fontSize: 20 },
  area: { fontSize: 13, color: palette.muted },
  price: { flexDirection: "row", alignItems: "baseline", gap: 2 },
  total: { fontSize: 30, lineHeight: 30 },
  unit: { fontSize: 12, color: palette.body },
  facts: { gap: 8, paddingTop: 12, borderTopWidth: 1, borderTopColor: palette.divider },
  fact: { flexDirection: "row", gap: 16 },
  factLabel: { fontSize: 14, color: palette.muted },
  factValue: { flex: 1, fontSize: 14, textAlign: "right" },
  factWarn: { color: palette.warn, fontWeight: "500" },
  sortArea: { paddingTop: 20, paddingHorizontal: 22, gap: 10 },
  sorts: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  sort: { height: 38, paddingHorizontal: 15, borderRadius: 19, justifyContent: "center" },
  sortOn: { backgroundColor: palette.ink },
  sortOff: { borderWidth: 1, borderColor: palette.chipLine, backgroundColor: palette.white },
  sortText: { fontSize: 13 },
  source: { fontSize: 12, lineHeight: lineHeight(12, 1.5), color: palette.muted },
  notice: { fontSize: 13, lineHeight: lineHeight(13, 1.6), color: palette.body },
  footer: { paddingTop: 12, paddingHorizontal: 16 },
  unavailable: { opacity: 0.4 },
});
