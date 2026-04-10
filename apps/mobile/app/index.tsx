// 루트: 세션 → 온보딩 여부 → 대시보드 or 로그인
import { useEffect, useState } from "react";
import { Redirect } from "expo-router";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { colors } from "@hanbang/design-tokens";
import { supabase } from "@/lib/supabase";

type Destination = "login" | "onboarding" | "dashboard";

export default function Index() {
  const [loading, setLoading] = useState(true);
  const [dest, setDest] = useState<Destination>("login");

  useEffect(() => {
    (async () => {
      // 1. 세션 확인
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setDest("login");
        setLoading(false);
        return;
      }

      // 2. 프로필 확인 (온보딩 완료 여부)
      const { data: profile } = await supabase
        .from("profiles")
        .select("name, couple_id, onboarding_completed")
        .eq("id", session.user.id)
        .single();

      if (!profile || !profile.onboarding_completed) {
        setDest("onboarding");
      } else {
        setDest("dashboard");
      }

      setLoading(false);
    })();
  }, []);

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.rose[500]} size="large" />
      </View>
    );
  }

  switch (dest) {
    case "login":
      return <Redirect href="/(auth)/login" />;
    case "onboarding":
      return <Redirect href={"/onboarding/index" as never} />;
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
  },
});
