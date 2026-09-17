import { StyleSheet, View } from "react-native";
import { Text } from "@/components/ui/AppText";
import {
  BarChart3,
  Heart,
  MessagesSquare,
  Scale,
} from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";
import {
  getExpectedMediationRevision,
  type MediationBlock,
} from "@/lib/amoraMediation";
import AmoraMediationResponses from "./AmoraMediationResponses";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default function AmoraMediationCard({
  block,
  messageId,
}: {
  block: MediationBlock;
  messageId?: string;
}) {
  const expectedRevision = getExpectedMediationRevision(block);
  const expectedProposalVersion = expectedRevision?.expectedProposalVersion;
  const expectedRosterFingerprint = expectedRevision?.expectedRosterFingerprint;
  const canConfirm = Boolean(
    block.resolution?.trim()
    && messageId
    && UUID_PATTERN.test(messageId)
    && expectedProposalVersion
    && expectedRosterFingerprint,
  );

  // 이 카드에 담긴 말은 요청한 사람이 직접 쓴 요약뿐이다. 상대의 메시지는 서버가
  // 모델에 보내지도 않는다. 그러니 아모라가 양쪽 이야기를 다 듣고 정리한 것처럼 쓰면
  // 사실이 아니고, 그 카드를 읽는 상대는 아모라가 저쪽 편을 들었다고 이해한다.
  // 웹 카드와 같은 문구를 쓴다 — 같은 사실을 두 화면이 다르게 말하면 안 된다.
  const requesterSummaryOnly = block.requesterSummaryOnly === true;

  const sections = [
    {
      key: "empathy",
      title: requesterSummaryOnly ? "요청자가 전한 감정" : "전해진 감정",
      Icon: Heart,
      color: "#8B6B24",
      backgroundColor: "#FEF9E8",
      borderColor: "#E9D59F",
      text: block.empathy,
    },
    {
      key: "translation",
      title: requesterSummaryOnly ? "요청자가 전한 상황" : "상황 정리",
      Icon: MessagesSquare,
      color: colors.noir[800],
      backgroundColor: "#F2F7F5",
      borderColor: colors.sage.pale,
      text: block.translation,
    },
    {
      key: "data",
      title: requesterSummaryOnly ? "상대방에게 확인할 점" : "확인할 내용",
      Icon: BarChart3,
      color: colors.textSecondary,
      backgroundColor: colors.ivory[100],
      borderColor: colors.border,
      text: block.data,
    },
    {
      key: "resolution",
      title: "같이 검토할 선택안",
      Icon: Scale,
      color: colors.rose[700],
      backgroundColor: colors.surface,
      borderColor: colors.rose.light,
      text: block.resolution,
    },
  ].filter((section) => Boolean(section.text));

  if (sections.length === 0) return null;

  return (
    <View
      style={styles.container}
      accessibilityLabel={requesterSummaryOnly
        ? "요청자 요약 기반 조율 초안"
        : "확인 출처가 없는 이전 조율 초안"}
    >
      <View style={styles.intro}>
        <Scale size={16} color={colors.noir[800]} />
        <View style={styles.introTextWrap}>
          <Text style={styles.introTitle}>
            {requesterSummaryOnly ? "요청자 요약 기반 조율 초안" : "확인 출처가 없는 이전 조율 초안"}
          </Text>
          <Text style={styles.introCopy}>
            {requesterSummaryOnly
              ? "요청자가 직접 적은 요약을 바탕으로 만든 조율 초안이에요. 상대방의 생각은 아직 확인되지 않았어요."
              : "확인 출처가 없는 이전 조율 초안이에요. 내용은 참고만 하고 새 공동 결정으로 확인하려면 조율 초안을 다시 요청해 주세요."}
          </Text>
        </View>
      </View>

      <View style={styles.sectionList}>
        {sections.map(({ key, title, Icon, color, backgroundColor, borderColor, text }) => (
          <View
            key={key}
            style={[styles.section, { backgroundColor, borderColor }]}
          >
            <View style={styles.sectionHeading}>
              <View style={[styles.sectionIcon, { borderColor }]}>
                <Icon size={14} color={color} strokeWidth={2.4} />
              </View>
              <Text style={[styles.sectionTitle, { color }]}>{title}</Text>
            </View>
            <Text style={styles.sectionText}>{text}</Text>
          </View>
        ))}
      </View>

      {canConfirm && messageId && expectedRevision && <AmoraMediationResponses revision={{messageId,...expectedRevision}} />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 10,
    marginTop: 8,
  },
  intro: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: colors.ivory[100],
    borderWidth: 1,
    borderColor: colors.border,
  },
  introTextWrap: {
    flex: 1,
    gap: 3,
  },
  introTitle: {
    fontSize: 13,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.noir[800],
  },
  introCopy: {
    fontSize: 12,
    lineHeight: 18,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
  },
  sectionList: {
    gap: 8,
  },
  section: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  sectionHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginBottom: 6,
  },
  sectionIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
  },
  sectionTitle: {
    fontSize: 12,
    fontFamily: "NotoSansKR_600SemiBold",
  },
  sectionText: {
    fontSize: 14,
    lineHeight: 21,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textPrimary,
  },
});
