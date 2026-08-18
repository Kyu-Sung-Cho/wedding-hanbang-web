import { StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing } from "@hanbang/design-tokens";
import type { AmoraSourceDisclosure } from "@hanbang/shared/amora-source-disclosure";

type Props = {
  disclosure: Readonly<AmoraSourceDisclosure>;
  showDetails?: boolean;
};

export function AmoraSourceDisclosureView({
  disclosure,
  showDetails = false,
}: Props) {
  if (disclosure.rankingPolicy !== "disclosure_only") return null;

  const accessibilityLabel = [
    `정보 종류 ${disclosure.badgeLabel}`,
    disclosure.statusLabel,
    disclosure.commercialRelationshipLabel,
    disclosure.checkedAtLabel,
    showDetails ? disclosure.limitation : null,
  ].filter(Boolean).join(", ");

  return (
    <View style={styles.wrapper} accessible accessibilityLabel={accessibilityLabel}>
      <View
        style={[
          styles.badge,
          disclosure.sourceType === "sponsored_placement" && styles.adBadge,
          disclosure.sourceType === "canonical_record" && styles.canonicalBadge,
        ]}
      >
        <Text style={styles.badgeText}>{disclosure.badgeLabel}</Text>
      </View>
      <Text style={styles.statusText}>
        {[disclosure.statusLabel, disclosure.checkedAtLabel].filter(Boolean).join(" · ")}
      </Text>
      {showDetails ? (
        <View style={styles.detail}>
          <Text style={styles.relationshipText}>
            {disclosure.commercialRelationshipLabel}
          </Text>
          <Text style={styles.limitationText}>{disclosure.limitation}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spacing[2],
  },
  badge: {
    paddingHorizontal: spacing[2],
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.full,
    backgroundColor: colors.ivory[100],
  },
  canonicalBadge: {
    borderColor: "rgba(54,83,78,0.30)",
    backgroundColor: "rgba(54,83,78,0.10)",
  },
  adBadge: {
    borderColor: "rgba(202,138,4,0.35)",
    backgroundColor: "rgba(234,179,8,0.10)",
  },
  badgeText: {
    color: colors.noir[800],
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "700",
  },
  statusText: {
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 17,
  },
  detail: {
    flexBasis: "100%",
    gap: spacing[1],
  },
  relationshipText: {
    color: colors.noir.soft,
    fontSize: 11,
    lineHeight: 17,
    fontWeight: "600",
  },
  limitationText: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 19,
  },
});
