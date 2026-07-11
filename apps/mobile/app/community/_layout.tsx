import { useEffect, useMemo, useState } from "react";
import { Redirect, Stack, usePathname } from "expo-router";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { colors } from "@hanbang/design-tokens";
import { sanitizeMobileAuthReturnPath } from "@hanbang/shared";
import ErrorRetry from "@/components/ErrorRetry";
import {
  clearActiveMobileAuthReturnPath,
  savePendingMobileAuthReturnPath,
  setActiveMobileAuthReturnPath,
} from "@/lib/mobileAuthIntent";
import { supabase } from "@/lib/supabase";

type GuardStatus = "checking" | "allowed" | "login" | "error";

export default function CommunityLayout() {
  const pathname = usePathname();
  const protectedIntent = useMemo(
    () => sanitizeMobileAuthReturnPath(pathname),
    [pathname],
  );
  const [status, setStatus] = useState<GuardStatus>("checking");
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    if (!protectedIntent) return;

    let active = true;
    setStatus("checking");
    setActiveMobileAuthReturnPath(protectedIntent);

    void supabase.auth.getSession()
      .then(async ({ data, error }) => {
        if (!active) return;
        if (error) throw error;

        if (data.session) {
          setStatus("allowed");
          return;
        }

        const saved = await savePendingMobileAuthReturnPath(protectedIntent);
        if (!saved) throw new Error("invalid_mobile_auth_return_path");
        if (active) setStatus("login");
      })
      .catch((error: unknown) => {
        if (!active) return;
        console.error("Protected community intent check failed:", error);
        setStatus("error");
      });

    return () => {
      active = false;
      clearActiveMobileAuthReturnPath(protectedIntent);
    };
  }, [protectedIntent, retryToken]);

  if (!protectedIntent || status === "allowed") {
    return <Stack screenOptions={{ headerShown: false }} />;
  }

  if (status === "login") {
    return <Redirect href="/(auth)/login" />;
  }

  if (status === "error") {
    return (
      <View style={styles.errorContainer}>
        <ErrorRetry
          message="이 화면으로 돌아올 경로를 안전하게 저장하지 못했어요. 연결을 확인하고 다시 시도해 주세요."
          onRetry={() => setRetryToken((value) => value + 1)}
        />
      </View>
    );
  }

  return (
    <View style={styles.loading} accessibilityLiveRegion="polite">
      <ActivityIndicator color={colors.rose[500]} />
    </View>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
  },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    backgroundColor: colors.bg,
    paddingHorizontal: 24,
  },
});
