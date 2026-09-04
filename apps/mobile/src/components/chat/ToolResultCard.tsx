import { StyleSheet, Text, View } from "react-native";
import { CheckCircle2, XCircle } from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";
import type { ToolResultCardModel } from "./toolResultCardModel";

/**
 * 아모라가 반영한 변경의 영수증. 한 줄 제목 + 결과 문장.
 *
 * 2026-09-04: 웹 `ActionCard` 의 최소 형태. 예산·일정 미니 표는 옮기지 않았다 —
 * 무엇이 됐는지/안 됐는지가 먼저다.
 */
export function ToolResultCard({ model }: { model: ToolResultCardModel }) {
  const failed = model.tone === "failure";
  return (
    <View
      style={[styles.card, failed && styles.cardFailed]}
      accessibilityRole="summary"
      accessibilityLabel={`${model.title}: ${failed ? "반영되지 않음" : "반영됨"}. ${model.message}`}
    >
      <View style={styles.heading}>
        {failed ? (
          <XCircle size={16} color="#B04A3B" />
        ) : (
          <CheckCircle2 size={16} color="#2F766F" />
        )}
        <Text style={styles.title}>{model.title}</Text>
        <Text style={[styles.status, failed && styles.statusFailed]}>
          {failed ? "반영되지 않았어요" : "반영됐어요"}
        </Text>
      </View>
      <Text style={styles.message}>{model.message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: "100%",
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#D8C7BB",
    backgroundColor: "#FFFCF8",
  },
  cardFailed: {
    borderColor: "#E3B7AE",
    backgroundColor: "#FFF6F3",
  },
  heading: { flexDirection: "row", alignItems: "center", gap: 6 },
  title: { fontSize: 14, fontWeight: "700", color: colors.noir[800] },
  status: { marginLeft: "auto", fontSize: 12, fontWeight: "600", color: "#2F766F" },
  statusFailed: { color: "#B04A3B" },
  message: { marginTop: 6, fontSize: 13, lineHeight: 19, color: colors.noir.soft },
});
