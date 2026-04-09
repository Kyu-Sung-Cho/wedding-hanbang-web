// 루트 인덱스 — 세션 체크 후 로그인 or 탭으로 리다이렉트
import { useEffect, useState } from "react";
import { Redirect } from "expo-router";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { colors } from "@hanbang/design-tokens";
import { supabase } from "@/lib/supabase";

export default function Index() {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<boolean>(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(!!data.session);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.rose[500]} />
      </View>
    );
  }

  return session ? <Redirect href="/(tabs)/dashboard" /> : <Redirect href="/(auth)/login" />;
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
  },
});
