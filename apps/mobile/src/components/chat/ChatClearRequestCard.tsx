import { useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { RefreshCw } from "lucide-react-native";
import { Text } from "@/components/ui/AppText";
import { colors } from "@hanbang/design-tokens";
import {
  describeChatClearRequest,
  type ChatClearRequestAction,
  type ChatClearRequestResult,
  type ChatClearRequestRole,
  type ChatClearRequestView,
} from "@/lib/chatClearRequest";

/**
 * 「함께 새로 시작」 동의 카드 — 웹 `ClearRequestCard` 와 같은 세 상태(대기·동의·거절).
 *
 * 받은 사람만 동의·거절을 누를 수 있고, 요청한 사람은 기다리는 상태를 본다. 누른 결과는 서버가
 * 확인해 준 뒤에만 카드에 반영한다 — 그 전에는 "처리 중"일 뿐이다. 실패하면 이유를 카드에 남기고
 * 다시 누를 수 있게 둔다.
 */
export function ChatClearRequestCard({
  request,
  role,
  onRespond,
}: {
  request: ChatClearRequestView;
  role: ChatClearRequestRole;
  onRespond: (action: ChatClearRequestAction) => Promise<ChatClearRequestResult>;
}) {
  const [busy, setBusy] = useState<ChatClearRequestAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resolved, setResolved] = useState<"accepted" | "declined" | null>(null);
  const inFlight = useRef(false);
  // 서버 기록이 먼저다. 기록이 아직 대기 중일 때만 서버가 방금 확인해 준 결과를 쓴다.
  const status = request.status !== "pending" ? request.status : resolved ?? "pending";
  const copy = describeChatClearRequest(status, role);

  const respond = async (action: ChatClearRequestAction) => {
    if (inFlight.current || !copy.canRespond) return;
    inFlight.current = true;
    setBusy(action);
    setError(null);
    try {
      const result = await onRespond(action);
      if (result.ok) setResolved(result.status);
      else setError(result.error);
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  };

  return (
    <View style={styles.row}>
      <View style={styles.card}>
        <View style={styles.heading}>
          <View style={styles.icon} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <RefreshCw size={14} color={colors.rose[700]} />
          </View>
          <View style={styles.copy}>
            <Text accessibilityRole="header" style={styles.title}>{copy.title}</Text>
            <Text style={styles.body}>{copy.body}</Text>
            {copy.footnote && <Text style={styles.footnote}>{copy.footnote}</Text>}
          </View>
        </View>
        {copy.canRespond && (
          <View style={styles.actions}>
            <Pressable
              style={({ pressed }) => [styles.accept, pressed && styles.acceptPressed, busy !== null && styles.disabled]}
              onPress={() => respond("accept")}
              disabled={busy !== null}
              accessibilityRole="button"
              accessibilityLabel="함께 새로 시작에 동의"
              accessibilityState={{ disabled: busy !== null, busy: busy === "accept" }}
            >
              {busy === "accept" && <ActivityIndicator size="small" color={colors.surface} />}
              <Text style={styles.acceptText}>{busy === "accept" ? "처리 중…" : "동의"}</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.decline, pressed && styles.declinePressed, busy !== null && styles.disabled]}
              onPress={() => respond("decline")}
              disabled={busy !== null}
              accessibilityRole="button"
              accessibilityLabel="함께 새로 시작 거절"
              accessibilityState={{ disabled: busy !== null, busy: busy === "decline" }}
            >
              <Text style={styles.declineText}>{busy === "decline" ? "처리 중…" : "거절"}</Text>
            </Pressable>
          </View>
        )}
        {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { width: "100%", alignItems: "center", marginVertical: 4 },
  card: { width: "100%", maxWidth: 448, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.ivory[50] },
  heading: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  icon: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: colors.rose.pale },
  copy: { flex: 1 },
  title: { fontSize: 14, fontWeight: "700", color: colors.noir[800] },
  body: { marginTop: 4, fontSize: 13, lineHeight: 19, color: colors.textSecondary },
  footnote: { marginTop: 6, fontSize: 12, lineHeight: 17, color: colors.paper.inkFaint },
  actions: { flexDirection: "row", gap: 8, marginTop: 12 },
  accept: { flex: 1, minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 12, backgroundColor: colors.rose[600] },
  acceptPressed: { backgroundColor: colors.rose[700] },
  acceptText: { fontSize: 14, fontWeight: "700", color: colors.surface },
  decline: { flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: 12, borderWidth: 1, borderColor: colors.paper.outline, backgroundColor: colors.surface },
  declinePressed: { backgroundColor: colors.ivory[100] },
  declineText: { fontSize: 14, fontWeight: "600", color: colors.noir[800] },
  disabled: { opacity: 0.6 },
  error: { marginTop: 8, fontSize: 12, lineHeight: 17, color: colors.dangerDeep },
});
