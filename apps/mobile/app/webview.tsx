// 범용 WebView 화면 — hanbang.ai 페이지를 앱 내에서 표시
import { useState, useRef, useCallback } from "react";
import {
  View, Text, StyleSheet, Pressable, ActivityIndicator,
  Share, Linking, Platform, RefreshControl, ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, router } from "expo-router";
import { ArrowLeft, Share2 } from "lucide-react-native";
import { WebView } from "react-native-webview";
import { colors } from "@hanbang/design-tokens";

const HANBANG_HOST = "hanbang.ai";

function firstParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function normalizeHanbangUrl(value: string | null): string | null {
  if (!value || value.length > 2048) return null;

  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    const isAllowedHost = host === HANBANG_HOST || host.endsWith(`.${HANBANG_HOST}`);

    if (parsed.protocol !== "https:" || !isAllowedHost) return null;
    parsed.username = "";
    parsed.password = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

function canOpenExternally(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "https:" || protocol === "http:" || protocol === "mailto:" || protocol === "tel:";
  } catch {
    return false;
  }
}

function titleFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const segment = pathname.split("/").filter(Boolean).pop();
    const map: Record<string, string> = {
      etiquette: "예절 가이드",
      vendors: "업체 탐색",
      budget: "예산 관리",
      schedule: "일정 관리",
      chat: "AI 채팅",
      settings: "설정",
      fitting: "AI 드레스 피팅",
    };
    return (segment && map[segment]) || "웨딩한방";
  } catch {
    return "웨딩한방";
  }
}

export default function WebViewScreen() {
  const params = useLocalSearchParams<{ url?: string | string[] }>();
  const url = firstParam(params.url);
  const safeUrl = normalizeHanbangUrl(url);
  const webViewRef = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);
  const [currentTitle, setCurrentTitle] = useState(titleFromUrl(safeUrl ?? ""));

  const handleShare = useCallback(async () => {
    if (!safeUrl) return;
    try {
      await Share.share({ url: safeUrl, message: safeUrl });
    } catch {
      // 공유 취소
    }
  }, [safeUrl]);

  // hanbang.ai 링크는 WebView에서, 외부 링크는 브라우저에서
  const handleNavigation = useCallback((event: { url: string }) => {
    const nextUrl = normalizeHanbangUrl(event.url);
    if (nextUrl) {
      setCurrentTitle(titleFromUrl(nextUrl));
      return true;
    }

    if (canOpenExternally(event.url)) {
      Linking.openURL(event.url).catch(() => undefined);
      return false;
    }

    return false;
  }, []);

  if (!safeUrl) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <ArrowLeft size={24} color={colors.noir[800]} />
          </Pressable>
          <Text style={styles.headerTitle}>오류</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: colors.textTertiary }}>URL이 제공되지 않았습니다.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      {/* 헤더 */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <ArrowLeft size={24} color={colors.noir[800]} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>{currentTitle}</Text>
        <Pressable onPress={handleShare} hitSlop={12}>
          <Share2 size={20} color={colors.noir[800]} />
        </Pressable>
      </View>

      {/* 로딩 인디케이터 */}
      {loading && (
        <View style={styles.loadingBar}>
          <ActivityIndicator size="small" color={colors.rose[500]} />
        </View>
      )}

      {/* WebView */}
      <WebView
        ref={webViewRef}
        source={{ uri: safeUrl }}
        style={{ flex: 1 }}
        onLoadStart={() => setLoading(true)}
        onLoadEnd={() => setLoading(false)}
        onShouldStartLoadWithRequest={handleNavigation}
        pullToRefreshEnabled
        allowsBackForwardNavigationGestures
        javaScriptEnabled
        domStorageEnabled
        startInLoadingState={false}
        showsVerticalScrollIndicator={false}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  headerTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "600",
    color: colors.noir[800],
    textAlign: "center",
    marginHorizontal: 12,
  },
  loadingBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    paddingTop: 60,
    alignItems: "center",
  },
});
