import { readMobileSignupConsentAccess } from "@/lib/signupConsentAccess";
// 루트: 세션 → 온보딩 여부 → 웨딩 라운지 or 로그인
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { Redirect } from "expo-router";
import { View, ActivityIndicator, StyleSheet, Text } from "react-native";
import { colors } from "@hanbang/design-tokens";
import { supabase } from "@/lib/supabase";
import {
  resolveRootDestination,
  rootGateNeedsProfile,
  type RootDestination,
} from "@/lib/rootDestination";
import { PrimaryButton } from "@/components/ui/AppUI";
import { resolveMobileSiteOrigin } from "@/lib/siteUrl.mjs";
import { verifyMobileWebRuntime } from "@/lib/mobileWebRuntime";

type GateStatus = "loading" | "ready" | "error" | "mismatch";

export default function Index() {
  const [status, setStatus] = useState<GateStatus>("loading");
  const [dest, setDest] = useState<RootDestination>("login");
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    let epoch = 0;
    let controller: AbortController | null = null;
    let sawAuthEvent = false;

    async function load(eventSession?: Session | null) {
      const requestEpoch = ++epoch;
      controller?.abort();
      const requestController = new AbortController();
      controller = requestController;
      const current = () => active && requestEpoch === epoch && !requestController.signal.aborted;
      setStatus("loading");
      try {
        const siteOrigin = resolveMobileSiteOrigin(
          process.env.EXPO_PUBLIC_SITE_URL,
          { isDevelopment: __DEV__ },
        );
        // 목적지 설정 불일치와 일시적인 연결 실패는 기존처럼 구분한다.
        const runtime = await verifyMobileWebRuntime({
          siteOrigin,
          supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
        });
        if (!current()) return;
        if (!runtime.ok && runtime.reason === "mismatch") {
          setStatus("mismatch");
          return;
        }

        const {
          data: { session },
          error: sessionError,
        } = eventSession === undefined
          ? await supabase.auth.getSession()
          : { data: { session: eventSession }, error: null };
        if (!current()) return;
        if (sessionError) throw sessionError;

        // 동의가 확인된 현재 주체만 프로필을 읽고 목적지를 확정한다.
        const consentAccess = session
          ? await readMobileSignupConsentAccess(session.user.id, requestController.signal)
          : undefined;
        if (!current()) return;
        if (!rootGateNeedsProfile(session, consentAccess)) {
          setDest(resolveRootDestination({ session, consentAccess, profile: null }));
          setStatus("ready");
          return;
        }

        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("name, couple_id, onboarding_completed")
          .eq("id", session.user.id)
          .maybeSingle();
        if (!current()) return;
        if (profileError) throw profileError;
        setDest(resolveRootDestination({ session, consentAccess, profile }));
        setStatus("ready");
      } catch {
        if (current()) setStatus("error");
      }
    }

    // 계정 교체·로그아웃은 이전 조회를 즉시 무효화한다. 늦은 초기 getSession도 덮지 못한다.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      sawAuthEvent = true;
      void load(session);
    });
    if (!sawAuthEvent) void load();
    return () => {
      active = false;
      epoch += 1;
      controller?.abort();
      subscription.unsubscribe();
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
    case "consent":
      return <Redirect href="/(auth)/consent" />;
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
