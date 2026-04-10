// 로그인 — 이메일/비밀번호 + 카카오/Apple 소셜 로그인
import { useState } from "react";
import {
  View, Text, TextInput, Pressable, StyleSheet, Image, Alert,
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Eye, EyeOff } from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";
import { supabase } from "@/lib/supabase";
import { signInWithOAuth } from "@/lib/auth";

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState<null | "email" | "kakao" | "apple">(null);

  // 이메일 로그인
  async function handleEmailLogin() {
    if (!email.trim() || !password) return;
    setLoading("email");
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) {
        if (error.message.includes("Invalid login")) {
          Alert.alert("로그인 실패", "이메일 또는 비밀번호가 올바르지 않습니다.");
        } else {
          Alert.alert("오류", error.message);
        }
        return;
      }
      router.replace("/(tabs)/dashboard");
    } catch {
      Alert.alert("오류", "로그인에 실패했어요.");
    } finally {
      setLoading(null);
    }
  }

  // 소셜 로그인
  async function handleSocialLogin(provider: "kakao" | "apple") {
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
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* 로고 */}
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

          {/* 이메일 로그인 */}
          <View style={styles.form}>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="이메일"
              placeholderTextColor={colors.taupe[400]}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <View style={styles.passwordRow}>
              <TextInput
                style={[styles.input, { flex: 1, marginBottom: 0 }]}
                value={password}
                onChangeText={setPassword}
                placeholder="비밀번호"
                placeholderTextColor={colors.taupe[400]}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                onSubmitEditing={handleEmailLogin}
                returnKeyType="go"
              />
              <Pressable style={styles.eyeBtn} onPress={() => setShowPassword(!showPassword)}>
                {showPassword
                  ? <EyeOff size={20} color={colors.taupe[400]} />
                  : <Eye size={20} color={colors.taupe[400]} />
                }
              </Pressable>
            </View>

            <Pressable
              style={[styles.emailBtn, (!email.trim() || !password) && { opacity: 0.4 }]}
              onPress={handleEmailLogin}
              disabled={!email.trim() || !password || loading !== null}
            >
              {loading === "email"
                ? <ActivityIndicator color="#FFF" />
                : <Text style={styles.emailBtnText}>로그인</Text>
              }
            </Pressable>

            {/* 비밀번호 찾기 + 회원가입 */}
            <View style={styles.linkRow}>
              <Pressable onPress={() => router.push("/(auth)/forgot-password" as never)}>
                <Text style={styles.link}>비밀번호 찾기</Text>
              </Pressable>
              <Text style={styles.linkDot}>|</Text>
              <Pressable onPress={() => router.push("/(auth)/signup" as never)}>
                <Text style={[styles.link, { color: colors.rose[500] }]}>회원가입</Text>
              </Pressable>
            </View>
          </View>

          {/* 구분선 */}
          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>또는</Text>
            <View style={styles.dividerLine} />
          </View>

          {/* 소셜 로그인 */}
          <View style={styles.socialButtons}>
            <Pressable
              style={({ pressed }) => [styles.kakaoButton, pressed && { opacity: 0.8 }]}
              onPress={() => handleSocialLogin("kakao")}
              disabled={loading !== null}
            >
              {loading === "kakao" ? (
                <ActivityIndicator color="#191919" />
              ) : (
                <Text style={styles.kakaoText}>카카오로 계속하기</Text>
              )}
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.appleButton, pressed && { opacity: 0.8 }]}
              onPress={() => handleSocialLogin("apple")}
              disabled={loading !== null}
            >
              {loading === "apple" ? (
                <ActivityIndicator color={colors.textPrimary} />
              ) : (
                <Text style={styles.appleText}>Apple로 계속하기</Text>
              )}
            </Pressable>
          </View>

          <Text style={styles.disclaimer}>
            계속하면 이용약관과 개인정보처리방침에{"\n"}동의하는 것으로 간주됩니다
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scrollContent: { paddingHorizontal: 24, paddingBottom: 32 },

  brand: { alignItems: "center", paddingTop: 40, marginBottom: 32 },
  logo: { width: 88, height: 88, marginBottom: 16, borderRadius: 24 },
  title: {
    fontSize: 32,
    fontFamily: "NotoSerifKR_500Medium",
    color: colors.noir[800],
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: "center",
    lineHeight: 24,
  },

  // 이메일 폼
  form: { gap: 10 },
  input: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    fontSize: 15,
    color: colors.noir[800],
  },
  passwordRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  eyeBtn: { padding: 10 },
  emailBtn: {
    height: 52,
    borderRadius: 14,
    backgroundColor: colors.noir[800],
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  emailBtnText: { fontSize: 16, fontWeight: "600", color: "#FFF" },

  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    marginTop: 8,
  },
  link: { fontSize: 13, color: colors.textSecondary },
  linkDot: { fontSize: 13, color: colors.border },

  // 구분선
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginVertical: 24,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { fontSize: 13, color: colors.textTertiary },

  // 소셜
  socialButtons: { gap: 12 },
  kakaoButton: {
    width: "100%",
    height: 52,
    borderRadius: 14,
    backgroundColor: "#FEE500",
    alignItems: "center",
    justifyContent: "center",
  },
  kakaoText: { fontSize: 15, fontWeight: "600", color: "#191919" },
  appleButton: {
    width: "100%",
    height: 52,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  appleText: { fontSize: 15, fontWeight: "600", color: colors.textPrimary },

  disclaimer: {
    fontSize: 12,
    color: colors.textTertiary,
    textAlign: "center",
    marginTop: 20,
    lineHeight: 18,
  },
});
