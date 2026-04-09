// 로그인 화면 — 카카오/Apple OAuth
import { useState } from "react";
import { View, Text, Pressable, StyleSheet, Image, Alert, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { colors } from "@hanbang/design-tokens";
import { signInWithOAuth } from "@/lib/auth";

export default function LoginScreen() {
  const [loading, setLoading] = useState<null | "kakao" | "apple">(null);

  async function handleLogin(provider: "kakao" | "apple") {
    if (loading) return;
    setLoading(provider);
    try {
      const result = await signInWithOAuth(provider);
      if (result.cancelled) {
        setLoading(null);
        return;
      }
      router.replace("/(tabs)/dashboard");
    } catch (err) {
      const message = err instanceof Error ? err.message : "로그인에 실패했어요";
      Alert.alert("로그인 오류", message);
    } finally {
      setLoading(null);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        {/* 상단 — 브랜드 */}
        <View style={styles.brand}>
          <Image
            source={require("../../assets/icon.png")}
            style={styles.logo}
            resizeMode="contain"
          />
          <Text style={styles.title}>웨딩한방</Text>
          <Text style={styles.subtitle}>
            AI 웨딩 플래너와 함께{"\n"}완벽한 결혼을 준비하세요
          </Text>
        </View>

        {/* 하단 — 로그인 버튼 */}
        <View style={styles.buttons}>
          <Pressable
            style={({ pressed }) => [styles.kakaoButton, pressed && styles.pressed]}
            onPress={() => handleLogin("kakao")}
            disabled={loading !== null}
          >
            {loading === "kakao" ? (
              <ActivityIndicator color="#191919" />
            ) : (
              <Text style={styles.kakaoText}>카카오로 계속하기</Text>
            )}
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.appleButton, pressed && styles.pressed]}
            onPress={() => handleLogin("apple")}
            disabled={loading !== null}
          >
            {loading === "apple" ? (
              <ActivityIndicator color={colors.textPrimary} />
            ) : (
              <Text style={styles.appleText}>Apple로 계속하기</Text>
            )}
          </Pressable>

          <Text style={styles.disclaimer}>
            계속하면 이용약관과 개인정보처리방침에{"\n"}동의하는 것으로 간주됩니다
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingVertical: 32,
    justifyContent: "space-between",
  },
  brand: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  logo: {
    width: 112,
    height: 112,
    marginBottom: 28,
    borderRadius: 28,
  },
  title: {
    fontSize: 36,
    fontFamily: "NotoSerifKR_500Medium",
    color: colors.noir[800],
    marginBottom: 12,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 16,
    color: colors.textSecondary,
    textAlign: "center",
    lineHeight: 24,
  },
  buttons: {
    gap: 12,
  },
  kakaoButton: {
    width: "100%",
    height: 56,
    borderRadius: 16,
    backgroundColor: "#FEE500",
    alignItems: "center",
    justifyContent: "center",
  },
  kakaoText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#191919",
  },
  appleButton: {
    width: "100%",
    height: 56,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  appleText: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  pressed: {
    opacity: 0.8,
  },
  disclaimer: {
    fontSize: 12,
    color: colors.textTertiary,
    textAlign: "center",
    marginTop: 16,
    lineHeight: 18,
  },
});
