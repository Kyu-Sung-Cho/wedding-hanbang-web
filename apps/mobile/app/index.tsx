// 루트: 세션 → 온보딩 여부 → 대시보드 or 로그인
import { useEffect, useState } from "react";
import { Redirect } from "expo-router";
import { View, ActivityIndicator, StyleSheet, Text } from "react-native";
import { colors } from "@hanbang/design-tokens";
import { supabase } from "@/lib/supabase";
import { PrimaryButton } from "@/components/ui/AppUI";

type Destination = "login" | "onboarding" | "dashboard";
type GateStatus = "loading" | "ready" | "error";

export default function Index() {
  const [status, setStatus] = useState<GateStatus>("loading");
  const [dest, setDest] = useState<Destination>("login");
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setStatus("loading");

    (async () => {
      try {
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
      return <Redirect href="/(tabs)/dashboard" />;
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
