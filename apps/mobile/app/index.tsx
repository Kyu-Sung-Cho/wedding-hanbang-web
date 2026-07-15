// 루트: 세션과 프로필 상태를 확인한 뒤 안전한 목적지로 이동한다.
import { useCallback, useEffect, useRef, useState } from "react";
import { Redirect, type Href } from "expo-router";
import { View, ActivityIndicator, StyleSheet, Text } from "react-native";
import { colors } from "@hanbang/design-tokens";
import ErrorRetry from "@/components/ErrorRetry";
import { consumePendingMobileAuthReturnPath } from "@/lib/mobileAuthIntent";
import { supabase } from "@/lib/supabase";
import { readMySafeProfile } from "@/lib/safeProfile";

type LoadStatus = "loading" | "ready" | "error";

export default function Index() {
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [destination, setDestination] = useState<Href | null>(null);
  const requestIdRef = useRef(0);

  const loadDestination = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setStatus("loading");

    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (requestId !== requestIdRef.current) return;

      const session = sessionData.session;
      if (!session) {
        setDestination("/(auth)/login");
        setStatus("ready");
        return;
      }

      const { data: profile, error: profileError } = await readMySafeProfile();

      if (profileError) throw profileError;
      if (requestId !== requestIdRef.current) return;

      if (!profile || !profile.onboarding_completed) {
        setDestination("/onboarding");
      } else {
        const pendingPath = await consumePendingMobileAuthReturnPath();
        if (requestId !== requestIdRef.current) return;
        setDestination(pendingPath ?? "/(tabs)/dashboard");
      }
      setStatus("ready");
    } catch (error) {
      if (requestId !== requestIdRef.current) return;
      console.error("Mobile auth profile load failed:", error);
      setDestination(null);
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void loadDestination();
    return () => {
      requestIdRef.current += 1;
    };
  }, [loadDestination]);

  if (status === "loading") {
    return (
      <View style={styles.loading} accessibilityLiveRegion="polite">
        <ActivityIndicator color={colors.rose[500]} size="large" />
        <Text style={styles.loadingText}>오늘의 웨딩 플랜을 준비하고 있어요</Text>
      </View>
    );
  }

  if (status === "error") {
    return (
      <View style={styles.errorContainer}>
        <ErrorRetry
          message="로그인 정보는 그대로예요. 연결을 확인한 뒤 프로필을 다시 불러와 주세요."
          onRetry={() => void loadDestination()}
        />
      </View>
    );
  }

  return destination ? <Redirect href={destination} /> : null;
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
    gap: 14,
    paddingHorizontal: 32,
  },
  loadingText: {
    fontSize: 14,
    lineHeight: 22,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
    textAlign: "center",
  },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    backgroundColor: colors.bg,
    paddingHorizontal: 24,
  },
});
