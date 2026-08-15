import { useWindowDimensions } from "react-native";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ArrowRight,
  BrainCircuit,
  ShieldCheck,
  SlidersHorizontal,
  UsersRound,
  X,
} from "lucide-react-native";
import { colors, radius, spacing } from "@hanbang/design-tokens";
import type { DashboardRecommendationDisclosure } from "@/lib/dashboardExperience.mjs";

interface AmoraRecommendationWhySheetProps {
  visible: boolean;
  disclosure: Readonly<DashboardRecommendationDisclosure>;
  onClose: () => void;
  onManageStyle: () => void;
  onManageMemory: () => void;
}

export default function AmoraRecommendationWhySheet({
  visible,
  disclosure,
  onClose,
  onManageStyle,
  onManageMemory,
}: AmoraRecommendationWhySheetProps) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const maxHeight = Math.max(
    320,
    height - Math.max(insets.top, spacing[4]) - Math.max(insets.bottom, spacing[4]),
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.overlay} accessibilityViewIsModal>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="추천 이유 닫기"
        />
        <View
          style={[
            styles.sheet,
            {
              maxHeight,
              paddingBottom: Math.max(insets.bottom, spacing[4]),
            },
          ]}
        >
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.eyebrow}>AMORA · PERSONALIZATION</Text>
              <Text style={styles.title}>왜 이 제안인가요?</Text>
              <Text style={styles.subtitle}>
                추천 순서를 정한 기록과 설명을 맞추는 맥락을 나눠서 보여드려요.
              </Text>
            </View>
            <Pressable
              onPress={onClose}
              style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="추천 이유 닫기"
            >
              <X size={20} color={colors.noir[800]} />
            </Pressable>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
          >
            <View style={styles.section}>
              <View style={styles.sectionHeading}>
                <ShieldCheck size={18} color={colors.sage[500]} />
                <Text style={styles.sectionTitle}>추천 순서를 정한 준비 기록</Text>
              </View>
              <View style={styles.factCard}>
                <Text style={styles.factSource}>{disclosure.prioritySource}</Text>
                <Text style={styles.factReason}>{disclosure.priorityReason}</Text>
              </View>
            </View>

            <View style={styles.section}>
              <View style={styles.sectionHeading}>
                <SlidersHorizontal size={18} color={colors.rose[600]} />
                <Text style={styles.sectionTitle}>설명을 맞추기 위해 전달된 설정과 기준</Text>
              </View>
              <View style={styles.contextList}>
                {disclosure.contextRows.map((row) => (
                  <View key={row.label} style={styles.contextRow}>
                    <View style={styles.contextHeading}>
                      <Text style={styles.contextLabel}>{row.label}</Text>
                      <View
                        style={[
                          styles.scopePill,
                          row.scope === "커플 공유" && styles.sharedScopePill,
                        ]}
                      >
                        {row.scope === "커플 공유" ? (
                          <UsersRound size={12} color={colors.sage[500]} />
                        ) : (
                          <ShieldCheck size={12} color={colors.rose[600]} />
                        )}
                        <Text style={styles.scopeText}>{row.scope}</Text>
                      </View>
                    </View>
                    <Text style={styles.contextDetail}>{row.detail}</Text>
                  </View>
                ))}
              </View>
            </View>

            <View style={styles.memoryNotice}>
              <BrainCircuit size={18} color={colors.noir.soft} />
              <Text style={styles.memoryText}>{disclosure.memoryNotice}</Text>
            </View>

            <View style={styles.actions}>
              <Pressable
                onPress={onManageStyle}
                style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}
                accessibilityRole="button"
              >
                <Text style={styles.actionText}>내 방식·기준 관리</Text>
                <ArrowRight size={17} color={colors.noir[800]} />
              </Pressable>
              <Pressable
                onPress={onManageMemory}
                style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}
                accessibilityRole="button"
              >
                <Text style={styles.actionText}>대화 기억 관리</Text>
                <ArrowRight size={17} color={colors.noir[800]} />
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(13, 13, 15, 0.48)",
  },
  sheet: {
    paddingTop: spacing[2],
    paddingHorizontal: spacing[5],
    borderTopLeftRadius: radius["2xl"],
    borderTopRightRadius: radius["2xl"],
    backgroundColor: colors.surface,
  },
  handle: {
    width: 44,
    height: 4,
    alignSelf: "center",
    marginBottom: spacing[4],
    borderRadius: radius.full,
    backgroundColor: colors.ivory[200],
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[3],
  },
  headerCopy: { flex: 1 },
  eyebrow: {
    fontSize: 11,
    lineHeight: 17,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.rose[600],
  },
  title: {
    marginTop: spacing[1],
    fontSize: 22,
    lineHeight: 30,
    fontFamily: "NotoSansKR_700Bold",
    color: colors.noir[900],
  },
  subtitle: {
    marginTop: spacing[2],
    fontSize: 13,
    lineHeight: 20,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
  },
  closeButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: colors.ivory[100],
  },
  scrollContent: {
    paddingTop: spacing[5],
    paddingBottom: spacing[4],
    gap: spacing[5],
  },
  section: { gap: spacing[3] },
  sectionHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
  },
  sectionTitle: {
    flex: 1,
    fontSize: 14,
    lineHeight: 21,
    fontFamily: "NotoSansKR_700Bold",
    color: colors.noir[800],
  },
  factCard: {
    padding: spacing[4],
    gap: spacing[2],
    borderRadius: radius.lg,
    backgroundColor: colors.sage.pale,
  },
  factSource: {
    fontSize: 12,
    lineHeight: 18,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.sage[500],
  },
  factReason: {
    fontSize: 13,
    lineHeight: 21,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.noir[800],
  },
  contextList: {
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.ivory[200],
    borderRadius: radius.lg,
  },
  contextRow: {
    padding: spacing[4],
    gap: spacing[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.ivory[200],
  },
  contextHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[2],
  },
  contextLabel: {
    fontSize: 13,
    lineHeight: 20,
    fontFamily: "NotoSansKR_700Bold",
    color: colors.noir[800],
  },
  scopePill: {
    minHeight: 26,
    paddingHorizontal: spacing[2],
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    borderRadius: radius.full,
    backgroundColor: colors.rose.pale,
  },
  sharedScopePill: { backgroundColor: colors.sage.pale },
  scopeText: {
    fontSize: 11,
    lineHeight: 16,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.noir.soft,
  },
  contextDetail: {
    fontSize: 12,
    lineHeight: 19,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
  },
  memoryNotice: {
    padding: spacing[4],
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[3],
    borderRadius: radius.lg,
    backgroundColor: colors.ivory[100],
  },
  memoryText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 19,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.noir.soft,
  },
  actions: { gap: spacing[2] },
  actionButton: {
    minHeight: 48,
    paddingHorizontal: spacing[4],
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: colors.ivory[200],
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  actionText: {
    fontSize: 14,
    lineHeight: 21,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.noir[800],
  },
  pressed: { opacity: 0.72 },
});
