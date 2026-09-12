import { StyleSheet, View } from "react-native";
import { Text } from "@/components/ui/AppText";
import { colors } from "@hanbang/design-tokens";
import {
  communityContentOriginLabel,
  type CommunityAdDisclosure,
  type CommunityContentOrigin,
} from "@/lib/communityTrust.mjs";

type Props = {
  contentOrigin: CommunityContentOrigin;
  adDisclosure?: CommunityAdDisclosure;
  sponsorshipDetail?: string | null;
  isResolved?: boolean;
  underReview?: boolean;
  showDisclosureDetail?: boolean;
};

const AD_LABELS: Record<Exclude<CommunityAdDisclosure, "general">, string> = {
  sponsored: "협찬·혜택 있음",
  ad: "광고",
};

export function CommunityTrustBadges({
  contentOrigin,
  adDisclosure = "general",
  sponsorshipDetail = null,
  isResolved = false,
  underReview = false,
  showDisclosureDetail = false,
}: Props) {
  const originLabel = communityContentOriginLabel(contentOrigin);
  const adLabel = adDisclosure === "general" ? null : AD_LABELS[adDisclosure];

  return (
    <View
      style={styles.wrapper}
      accessible
      accessibilityLabel={[
        `작성 출처 ${originLabel}`,
        adLabel ? `경제적 관계 ${adLabel}` : "광고나 협찬 표시 없음",
        underReview ? "운영 검토 중" : null,
        isResolved ? "질문자가 해결됨으로 표시" : null,
      ].filter(Boolean).join(", ")}
    >
      <View style={[styles.badge, styles.originBadge]}>
        <Text style={styles.originText}>{originLabel}</Text>
      </View>
      {adLabel ? (
        <View style={[styles.badge, styles.adBadge]}>
          <Text style={styles.adText}>{adLabel}</Text>
        </View>
      ) : null}
      {underReview ? (
        <View style={[styles.badge, styles.reviewBadge]}>
          <Text style={styles.reviewText}>운영 검토 중</Text>
        </View>
      ) : null}
      {isResolved && !underReview ? (
        <View style={[styles.badge, styles.resolvedBadge]}>
          <Text style={styles.resolvedText}>해결됨</Text>
        </View>
      ) : null}
      {showDisclosureDetail && adLabel && sponsorshipDetail?.trim() ? (
        <Text style={styles.disclosureDetail}>
          혜택 관계: {sponsorshipDetail.trim()}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 6,
  },
  badge: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  originBadge: {
    backgroundColor: colors.ivory[100],
    borderColor: colors.border,
  },
  originText: {
    color: colors.noir[800],
    fontSize: 11,
    fontWeight: "600",
  },
  adBadge: {
    backgroundColor: "rgba(234,179,8,0.10)",
    borderColor: "rgba(202,138,4,0.35)",
  },
  adText: {
    color: "#A16207",
    fontSize: 11,
    fontWeight: "700",
  },
  reviewBadge: {
    backgroundColor: "rgba(148,163,184,0.12)",
    borderColor: "rgba(100,116,139,0.30)",
  },
  reviewText: {
    color: "#475569",
    fontSize: 11,
    fontWeight: "700",
  },
  resolvedBadge: {
    backgroundColor: "rgba(54,83,78,0.10)",
    borderColor: "rgba(54,83,78,0.30)",
  },
  resolvedText: {
    color: "#36534E",
    fontSize: 11,
    fontWeight: "700",
  },
  disclosureDetail: {
    flexBasis: "100%",
    color: colors.noir[800],
    fontSize: 12,
    lineHeight: 18,
  },
});
