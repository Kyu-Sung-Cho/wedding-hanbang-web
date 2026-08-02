// 오프라인 상태 감지 배너 — 인터넷 연결 끊기면 상단에 표시
import { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Animated, AppState, Platform } from "react-native";
import { WifiOff } from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";
import {
  buildMobileSiteUrl,
  resolveMobileSiteOrigin,
} from "@/lib/siteUrl.mjs";

const SITE_ORIGIN = resolveMobileSiteOrigin(
  process.env.EXPO_PUBLIC_SITE_URL,
  { isDevelopment: __DEV__ },
);
const CONNECTIVITY_CHECK_URL = buildMobileSiteUrl("/api/health", SITE_ORIGIN);
const CHECK_TIMEOUT_MS = 5000;
const HIDDEN_OFFSET_Y = -120;

async function checkConnectivity(): Promise<boolean> {
  if (Platform.OS === "web") {
    return typeof navigator === "undefined" ? true : navigator.onLine !== false;
  }

  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    const controller = new AbortController();
    timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
    const res = await fetch(CONNECTIVITY_CHECK_URL, {
      method: "HEAD",
      cache: "no-store",
      signal: controller.signal,
    });
    return res.ok || res.status === 204;
  } catch {
    return false;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export default function OfflineBanner() {
  const [isOffline, setIsOffline] = useState(false);
  const slideAnim = useRef(new Animated.Value(HIDDEN_OFFSET_Y)).current;

  // 연결 상태 확인
  useEffect(() => {
    let mounted = true;

    async function check() {
      const online = await checkConnectivity();
      if (mounted) setIsOffline(!online);
    }

    // 최초 확인
    check();

    // 앱 포그라운드 복귀 시 확인
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") check();
    });

    // 주기적 확인 (30초)
    const interval = setInterval(check, 30000);

    return () => {
      mounted = false;
      subscription.remove();
      clearInterval(interval);
    };
  }, []);

  // 슬라이드 애니메이션
  useEffect(() => {
    Animated.timing(slideAnim, {
      toValue: isOffline ? 0 : HIDDEN_OFFSET_Y,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [isOffline, slideAnim]);

  return (
    <Animated.View
      style={[styles.banner, { transform: [{ translateY: slideAnim }] }]}
      pointerEvents={isOffline ? "auto" : "none"}
    >
      <View style={styles.content}>
        <WifiOff size={16} color="#FFFFFF" strokeWidth={2} />
        <Text style={styles.text}>인터넷 연결을 확인해주세요</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    backgroundColor: colors.rose[600],
    paddingTop: 50,
    paddingBottom: 12,
    paddingHorizontal: 16,
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  text: {
    fontFamily: "NotoSansKR_500Medium",
    fontSize: 13,
    color: "#FFFFFF",
  },
});
