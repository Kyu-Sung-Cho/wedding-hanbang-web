// 루트: 세션 → 온보딩 여부 → 웨딩 라운지 or 로그인
import { useEffect, useState } from "react";
import { Redirect } from "expo-router";
import { View, ActivityIndicator, StyleSheet, Text } from "react-native";
import { colors } from "@hanbang/design-tokens";
import { supabase } from "@/lib/supabase";
import { PrimaryButton } from "@/components/ui/AppUI";
import { resolveMobileSiteOrigin } from "@/lib/siteUrl.mjs";
import { verifyMobileWebRuntime } from "@/lib/mobileWebRuntime";

type Destination = "login" | "onboarding" | "dashboard";
type GateStatus = "loading" | "ready" | "error" | "mismatch";

export default function Index() {
  const [status, setStatus] = useState<GateStatus>("loading");
  const [dest, setDest] = useState<Destination>("login");
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setStatus("loading");

    (async () => {
      try {
        const siteOrigin = resolveMobileSiteOrigin(
          process.env.EXPO_PUBLIC_SITE_URL,
          { isDevelopment: __DEV__ },
        );
        // 세션을 쓰기 전에 목적지를 먼저 확인한다. 다만 "물어볼 수 없었다"와
        // "물어봤는데 답이 달랐다"를 구분한다 — 앞은 지하철에서도 흔한 일이고,
        // 뒤는 세션이 엉뚱한 프로젝트로 갈 수 있다는 증거다.
        const runtime = await verifyMobileWebRuntime({
          siteOrigin,
          supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
        });
        if (!active) return;
        if (!runtime.ok && runtime.reason === "mismatch") {
          setStatus("mismatch");
          return;
        }

        // 인증과 프로필 실패는 그대로 재시도 가능한 오류로 남긴다. 조용히 넘어가면
        // 사람이 무엇이 잘못됐는지 모른 채 빈 화면을 본다.
        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        if (!active) return;

        if (!session) {
          setDest("login");
          setStatus("ready");
          return;
        }

        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("name, couple_id, onboarding_completed")
          .eq("id", session.user.id)
          .maybeSingle();
        if (profileError) throw profileError;
        if (!active) return;

        if (!profile || !profile.onboarding_completed) {
          setDest("onboarding");
        } else {
          setDest("dashboard");
        }
      } catch {
        if (active) {
          setStatus("error");
        }
        return;
      }

      if (active) {
        setStatus("ready");
      }
    })();

    return () => {
      active = false;
    };
  }, [loadAttempt]);

  if (status === "loading") {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.rose[500]} size="large" />
        <Text style={styles.loadingText}>오늘의 웨딩 플랜을 준비하고 있어요</Text>
      </View>
    );
  }

  // 목적지가 어긋난 것은 재시도로 풀리지 않는다. 앱을 업데이트해야 한다.
  if (status === "mismatch") {
    return (
      <View style={styles.loading}>
        <Text style={styles.errorTitle}>안전하게 연결할 수 없어요</Text>
        <Text style={styles.loadingText}>
          앱과 서버의 설정이 서로 달라요. 계정을 잘못 건드리지 않도록 여기서 멈췄어요.
          앱을 최신 버전으로 업데이트한 뒤 다시 열어주세요.
        </Text>
      </View>
    );
  }

  if (status === "error") {
    return (
      <View style={styles.loading}>
        <Text style={styles.errorTitle}>로그인 상태를 확인하지 못했어요</Text>
        <Text style={styles.loadingText}>
          연결을 확인한 뒤 다시 시도해주세요. 로그인 정보는 그대로 안전하게 유지돼요.
        </Text>
        <PrimaryButton
          tone="rose"
          style={styles.retryButton}
          onPress={() => setLoadAttempt((attempt) => attempt + 1)}
        >
          다시 시도
        </PrimaryButton>
      </View>
    );
  }

  switch (dest) {
    case "login":
      return <Redirect href="/(auth)/login" />;
    case "onboarding":
      return <Redirect href="/onboarding" />;
    case "dashboard":
      return <Redirect href="/(tabs)/lounge" />;
  }
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
  errorTitle: {
    fontSize: 20,
    fontFamily: "NotoSerifKR_500Medium",
    color: colors.noir[800],
    textAlign: "center",
  },
  retryButton: {
    width: "100%",
    maxWidth: 320,
    marginTop: 8,
  },
});
