import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { colors } from "@hanbang/design-tokens";

import type {
  PreparationJourneyMapModel,
  PreparationJourneyNodeModel,
  PreparationJourneyTone,
} from "@/lib/preparationMapPresentation.mjs";
import { AppText } from "@/components/ui/AppUI";

export type PreparationJourneyViewMode = "map" | "details";

interface PreparationJourneyMapProps {
  model: Readonly<PreparationJourneyMapModel>;
  viewMode: PreparationJourneyViewMode;
  onViewModeChange: (mode: PreparationJourneyViewMode) => void;
  onOpenTopic: (topicKey: string) => void;
}

const TONE_COLORS: Record<PreparationJourneyTone, {
  border: string;
  background: string;
  foreground: string;
}> = {
  active: {
    border: colors.rose[500],
    background: colors.rose.glow,
    foreground: colors.rose[600],
  },
  success: {
    border: colors.sage[500],
    background: colors.sage.pale,
    foreground: colors.sage[500],
  },
  warning: {
    border: colors.warning,
    background: colors.ivory[100],
    foreground: colors.warning,
  },
  neutral: {
    border: colors.border,
    background: colors.surface,
    foreground: colors.textSecondary,
  },
  muted: {
    border: colors.border,
    background: colors.ivory[100],
    foreground: colors.textTertiary,
  },
};

function TopicNode({
  node,
  chapterTitle,
  singleColumn,
  onOpenTopic,
}: {
  node: Readonly<PreparationJourneyNodeModel>;
  chapterTitle: string;
  singleColumn: boolean;
  onOpenTopic: (topicKey: string) => void;
}) {
  const tone = TONE_COLORS[node.tone];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${chapterTitle}, ${node.accessibilityLabel}`}
      accessibilityHint="두 번 탭하면 이 준비의 상세 기록을 확인해요"
      onPress={() => onOpenTopic(node.topicKey)}
      style={({ pressed }) => [
        styles.mapNode,
        singleColumn && styles.singleColumnNode,
        {
          borderColor: node.isFocus ? colors.rose[500] : tone.border,
          backgroundColor: tone.background,
        },
        node.isFocus && styles.focusNode,
        pressed && styles.pressed,
      ]}
    >
      <View
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[
          styles.nodeSymbol,
          { borderColor: tone.border, backgroundColor: colors.surface },
        ]}
      >
        <Text style={[styles.nodeSymbolText, { color: tone.foreground }]}>
          {node.symbol}
        </Text>
      </View>
      <View style={styles.nodeCopy}>
        {node.isFocus ? (
          <Text style={styles.focusLabel}>이번에 볼 곳</Text>
        ) : null}
        <Text style={styles.nodeTitle}>{node.title}</Text>
        <Text style={styles.nodeState}>{node.stateLabel}</Text>
      </View>
    </Pressable>
  );
}

export default function PreparationJourneyMap({
  model,
  viewMode,
  onViewModeChange,
  onOpenTopic,
}: PreparationJourneyMapProps) {
  const { width, fontScale } = useWindowDimensions();
  const singleColumn = width < 360 || fontScale >= 1.5;

  return (
    <View style={styles.section}>
      <View style={styles.intro}>
        <AppText variant="body" style={styles.description}>
          {model.description}
        </AppText>
        <AppText variant="caption" style={styles.boundaryLabel}>
          {model.boundaryLabel}
        </AppText>
        {model.coverageNotice ? (
          <View style={styles.coverageNotice}>
            <AppText variant="bodyStrong" style={styles.coverageNoticeText}>
              {model.coverageNotice}
            </AppText>
          </View>
        ) : null}
      </View>

      <View style={styles.viewTabs} accessibilityRole="tablist">
        {model.viewOptions.map((option) => {
          const selected = option.key === viewMode;
          return (
            <Pressable
              key={option.key}
              accessibilityRole="tab"
              accessibilityLabel={`${option.label}으로 보기`}
              accessibilityState={{ selected }}
              onPress={() => onViewModeChange(option.key)}
              style={[styles.viewTab, selected && styles.viewTabSelected]}
            >
              <Text style={[styles.viewTabText, selected && styles.viewTabTextSelected]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {viewMode === "map" ? (
        <>
          <View style={styles.focusSection}>
            <View accessible accessibilityRole="header">
              <AppText variant="subtitle">{model.focus.title}</AppText>
            </View>
            <AppText variant="caption" style={styles.focusDescription}>
              {model.focus.description}
            </AppText>
            {model.focus.nodes.length > 0 ? (
              <View style={styles.focusTopics}>
                {model.focus.nodes.map((node) => (
                  <Pressable
                    key={node.topicKey}
                    accessibilityRole="button"
                    accessibilityLabel={`이번에 볼 준비, ${node.accessibilityLabel}`}
                    onPress={() => onOpenTopic(node.topicKey)}
                    style={({ pressed }) => [styles.focusTopic, pressed && styles.pressed]}
                  >
                    <Text style={styles.focusTopicText}>{node.title}</Text>
                    <Text style={styles.focusTopicReason}>{node.focusReasonLabel}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>

          <View style={styles.chapters}>
            {model.chapters.map((chapter, chapterIndex) => (
              <View key={chapter.key} style={styles.chapter}>
                <View
                  accessible={false}
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  style={styles.chapterRail}
                >
                  <View style={[styles.chapterMarker, chapter.hasFocus && styles.chapterMarkerFocus]} />
                  {chapterIndex < model.chapters.length - 1 ? (
                    <View style={styles.chapterLine} />
                  ) : null}
                </View>
                <View style={styles.chapterContent}>
                  <View accessible accessibilityRole="header">
                    <AppText variant="subtitle">{chapter.title}</AppText>
                  </View>
                  <AppText variant="caption" style={styles.chapterDescription}>
                    {chapter.description}
                  </AppText>
                  <View style={styles.mapNodes}>
                    {chapter.nodes.map((node) => (
                      <TopicNode
                        key={node.topicKey}
                        node={node}
                        chapterTitle={chapter.title}
                        singleColumn={singleColumn}
                        onOpenTopic={onOpenTopic}
                      />
                    ))}
                  </View>
                </View>
              </View>
            ))}
          </View>

          <AppText variant="caption" style={styles.sequenceNote}>
            보기 편하게 묶은 주제예요. 모든 준비는 잠겨 있지 않고 언제든 열어볼 수 있어요.
          </AppText>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 20 },
  intro: { gap: 8 },
  description: { color: colors.textSecondary },
  boundaryLabel: { color: colors.noir[800] },
  coverageNotice: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderLeftWidth: 3,
    borderLeftColor: colors.rose[500],
    backgroundColor: colors.ivory[100],
  },
  coverageNoticeText: { color: colors.noir[800] },
  viewTabs: {
    flexDirection: "row",
    padding: 4,
    borderRadius: 16,
    backgroundColor: colors.ivory[100],
  },
  viewTab: {
    flex: 1,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
  },
  viewTabSelected: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  viewTabText: {
    fontSize: 14,
    fontWeight: "600",
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.textSecondary,
  },
  viewTabTextSelected: { color: colors.noir[800] },
  focusSection: {
    gap: 8,
    padding: 16,
    borderRadius: 18,
    backgroundColor: colors.rose.glow,
  },
  focusDescription: { color: colors.noir[800] },
  focusTopics: { gap: 8 },
  focusTopic: {
    width: "100%",
    maxWidth: "100%",
    minHeight: 48,
    flexShrink: 1,
    alignItems: "flex-start",
    justifyContent: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.rose[500],
    backgroundColor: colors.surface,
  },
  focusTopicText: {
    flexShrink: 1,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: "700",
    fontFamily: "NotoSansKR_700Bold",
    color: colors.noir[800],
  },
  focusTopicReason: {
    flexShrink: 1,
    marginTop: 2,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "500",
    fontFamily: "NotoSansKR_500Medium",
    color: colors.noir[800],
  },
  chapters: { gap: 4 },
  chapter: { flexDirection: "row", alignItems: "stretch" },
  chapterRail: { width: 24, alignItems: "center" },
  chapterMarker: {
    width: 14,
    height: 14,
    marginTop: 8,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chapterMarkerFocus: { borderColor: colors.rose[500], backgroundColor: colors.rose.glow },
  chapterLine: { flex: 1, width: 1, minHeight: 24, backgroundColor: colors.border },
  chapterContent: { flex: 1, minWidth: 0, paddingLeft: 10, paddingBottom: 24, gap: 4 },
  chapterDescription: { marginBottom: 8, color: colors.textSecondary },
  mapNodes: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  mapNode: {
    minWidth: 132,
    minHeight: 72,
    flexBasis: "45%",
    flexGrow: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderWidth: 1,
    borderRadius: 18,
  },
  singleColumnNode: { minWidth: 0, flexBasis: "100%" },
  focusNode: { borderWidth: 2 },
  nodeSymbol: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
    borderWidth: 1,
  },
  nodeSymbolText: { fontSize: 15, fontWeight: "700", fontFamily: "NotoSansKR_700Bold" },
  nodeCopy: { flex: 1, minWidth: 0, gap: 2 },
  focusLabel: {
    fontSize: 10,
    lineHeight: 15,
    fontWeight: "700",
    fontFamily: "NotoSansKR_700Bold",
    color: colors.noir[800],
  },
  nodeTitle: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
    fontFamily: "NotoSansKR_700Bold",
    color: colors.noir[800],
  },
  nodeState: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "600",
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.noir[800],
  },
  sequenceNote: {
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    color: colors.textSecondary,
  },
  pressed: { opacity: 0.72 },
});
