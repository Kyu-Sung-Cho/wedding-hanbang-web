import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, View } from "react-native";
import { Text } from "@/components/ui/AppText";
import { SafeAreaView } from "react-native-safe-area-context";
import { RotateCcw, ShieldCheck, X } from "lucide-react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { colors } from "@hanbang/design-tokens";
import {
  buildTurnstileHtml,
  isAllowedTurnstileNavigation,
  parseTurnstileMessage,
  TURNSTILE_BASE_ORIGIN,
} from "@/lib/turnstile";

export type TurnstileAction = "signup" | "forgot";

interface TurnstileModalProps {
  visible: boolean;
  siteKey: string;
  action: TurnstileAction;
  onVerify: (token: string) => void;
  onCancel: () => void;
}

type ChallengePhase = "loading" | "ready" | "expired" | "error";

export default function TurnstileModal({
  visible,
  siteKey,
  action,
  onVerify,
  onCancel,
}: TurnstileModalProps) {
  const html = useMemo(() => buildTurnstileHtml(siteKey, action), [action, siteKey]);
  const [phase, setPhase] = useState<ChallengePhase>(html ? "loading" : "error");
  const [attempt, setAttempt] = useState(0);
  const verifiedRef = useRef(false);

  useEffect(() => {
    if (!visible) return;
    verifiedRef.current = false;
    setAttempt(0);
    setPhase(html ? "loading" : "error");
  }, [html, visible]);

  const handleMessage = useCallback((event: WebViewMessageEvent) => {
    const message = parseTurnstileMessage(event.nativeEvent.data);
    if (!message) {
      setPhase("error");
      return;
    }
    if (message.type === "success") {
      if (verifiedRef.current) return;
      verifiedRef.current = true;
      onVerify(message.token);
      return;
    }
    if (message.type === "ready") {
      setPhase("ready");
      return;
    }
    if (message.type === "expired") {
      setPhase("expired");
      return;
    }
    if (message.type === "error") setPhase("error");
  }, [onVerify]);

  const retry = useCallback(() => {
    if (!html) return;
    verifiedRef.current = false;
    setPhase("loading");
    setAttempt((current) => current + 1);
  }, [html]);

  const cancel = useCallback(() => {
    verifiedRef.current = true;
    onCancel();
  }, [onCancel]);

  const failed = phase === "error" || phase === "expired";
  const statusText = phase === "expired"
    ? "사람인지 확인하는 시간이 지났어요. 다시 확인해주세요."
    : phase === "error"
      ? "사람인지 확인하지 못했어요. 연결을 확인하고 다시 시도해주세요."
      : phase === "ready"
        ? "아래 확인을 완료해주세요."
        : "안전한 확인 화면을 준비하고 있어요.";

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      statusBarTranslucent
      onRequestClose={cancel}
    >
      <SafeAreaView style={styles.overlay}>
        <View
          style={styles.card}
          accessibilityViewIsModal
          accessibilityLabel="사람인지 확인"
        >
          <View style={styles.header}>
            <View style={styles.titleRow}>
              <ShieldCheck size={22} color={colors.noir[800]} />
              <Text style={styles.title}>안전한 이용 확인</Text>
            </View>
            <Pressable
              style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
              onPress={cancel}
              accessibilityRole="button"
              accessibilityLabel="사람인지 확인 취소"
              hitSlop={4}
            >
              <X size={22} color={colors.noir[800]} />
            </Pressable>
          </View>

          <Text
            style={[styles.status, failed && styles.errorStatus]}
            accessibilityLiveRegion="polite"
            accessibilityRole={failed ? "alert" : "text"}
          >
            {statusText}
          </Text>

          {!failed && html ? (
            <View style={styles.webViewFrame}>
              {phase === "loading" && (
                <View style={styles.loading} pointerEvents="none">
                  <ActivityIndicator color={colors.rose[500]} />
                </View>
              )}
              <WebView
                key={attempt}
                source={{ html, baseUrl: TURNSTILE_BASE_ORIGIN }}
                originWhitelist={[
                  TURNSTILE_BASE_ORIGIN,
                  "https://challenges.cloudflare.com",
                  "about:blank",
                  "about:srcdoc",
                ]}
                javaScriptEnabled
                domStorageEnabled
                sharedCookiesEnabled
                thirdPartyCookiesEnabled
                allowsInlineMediaPlayback
                mediaPlaybackRequiresUserAction={false}
                mixedContentMode="never"
                setSupportMultipleWindows={false}
                onShouldStartLoadWithRequest={(request) =>
                  isAllowedTurnstileNavigation(request.url)
                }
                onMessage={handleMessage}
                onError={() => setPhase("error")}
                onHttpError={() => setPhase("error")}
                style={styles.webView}
                accessibilityLabel="Cloudflare 사람인지 확인 위젯"
              />
            </View>
          ) : (
            <View style={styles.failurePanel}>
              <RotateCcw size={28} color={colors.taupe[500]} />
              <Pressable
                style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
                onPress={retry}
                disabled={!html}
                accessibilityRole="button"
                accessibilityLabel="사람인지 다시 확인하기"
                accessibilityState={{ disabled: !html }}
              >
                <Text style={styles.retryText}>다시 확인하기</Text>
              </Pressable>
            </View>
          )}

          <Pressable
            style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed]}
            onPress={cancel}
            accessibilityRole="button"
            accessibilityLabel="취소하고 이전 화면으로 돌아가기"
          >
            <Text style={styles.cancelText}>취소</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 20,
    backgroundColor: "rgba(26, 26, 31, 0.45)",
  },
  card: {
    width: "100%",
    maxWidth: 420,
    alignSelf: "center",
    padding: 20,
    borderRadius: 24,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  header: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  title: {
    fontSize: 18,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.noir[800],
  },
  iconButton: {
    width: 48,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
  },
  status: {
    minHeight: 44,
    paddingTop: 8,
    fontSize: 14,
    lineHeight: 22,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
  },
  errorStatus: { color: colors.danger },
  webViewFrame: {
    height: 150,
    marginTop: 8,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  webView: { flex: 1, backgroundColor: colors.bg },
  loading: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
  },
  failurePanel: {
    minHeight: 150,
    marginTop: 8,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    borderRadius: 16,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  retryButton: {
    minHeight: 48,
    minWidth: 160,
    paddingHorizontal: 20,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
    backgroundColor: colors.noir[800],
  },
  retryText: {
    fontSize: 15,
    fontFamily: "NotoSansKR_600SemiBold",
    color: "#FFFFFF",
  },
  cancelButton: {
    minHeight: 48,
    marginTop: 12,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
  },
  cancelText: {
    fontSize: 15,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.textSecondary,
  },
  pressed: { opacity: 0.7 },
});
