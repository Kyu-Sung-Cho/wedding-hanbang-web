// 로그인 — 이메일/비밀번호 + 카카오/Apple 소셜 로그인
import { useState, useEffect, useRef } from "react";
import {
  View, Text, TextInput, Pressable, StyleSheet, Image, Alert,
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView,
  Animated, Linking,
} from "react-native";
import DismissKeyboard from "@/components/DismissKeyboard";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Eye, EyeOff } from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";
import { supabase } from "@/lib/supabase";
import { signInWithOAuth } from "@/lib/auth";

const SITE = process.env.EXPO_PUBLIC_SITE_URL || "https://hanbang.ai";

// Supabase 에러 메시지 한국어 변환
function translateError(message: string): string {
  if (message.includes("Invalid login")) return "이메일 또는 비밀번호가 올바르지 않습니다.";
  if (message.includes("Email not confirmed")) return "이메일 인증이 완료되지 않았습니다.";
  if (message.includes("Too many requests")) return "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.";
  if (message.includes("User not found")) return "등록되지 않은 이메일입니다.";
  if (message.includes("Network")) return "네트워크 연결을 확인해주세요.";
  return "로그인에 실패했어요. 다시 시도해주세요.";
}

// 이메일 유효성 검사
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState<null | "email" | "kakao" | "apple">(null);
  const [emailTouched, setEmailTouched] = useState(false);

  // 로고 페이드인 애니메이션
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(18)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 700,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 700,
        useNativeDriver: true,
      }),
    ]).start();
  }, [fadeAnim, slideAnim]);

  const emailInvalid = emailTouched && email.length > 0 && !isValidEmail(email);
  const isFormDisabled = loading !== null;

  // 이메일 로그인
  async function handleEmailLogin() {
    if (!email.trim() || !password) return;
    if (!isValidEmail(email.trim())) {
      Alert.alert("알림", "올바른 이메일 형식을 입력해주세요.");
      return;
    }
    setLoading("email");
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) {
        Alert.alert("로그인 실패", translateError(error.message));
        return;
      }
      // 루트가 profile.onboarding_completed를 확인해 신규 가입자를 온보딩으로 보낸다.
      router.replace("/");
    } catch {
      Alert.alert("오류", "로그인에 실패했어요. 다시 시도해주세요.");
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
      router.replace("/");
    } catch (err) {
      const message = err instanceof Error ? err.message : "로그인에 실패했어요";
      Alert.alert("로그인 오류", message);
    } finally {
      setLoading(null);
    }
  }

  function openSecureWebAuth(mode: "signup" | "forgot") {
    const action = mode === "signup" ? "회원가입" : "비밀번호 재설정";
    Alert.alert(
      "웹 보안 확인이 필요해요",
      `${action}은 봇 방지 보안 확인을 위해 안전한 웹 화면에서 진행합니다.`,
      [
        { text: "취소", style: "cancel" },
        {
          text: "웹 열기",
          onPress: () => {
            void Linking.openURL(`${SITE}/login?mode=${mode}`).catch(() => {
              Alert.alert(
                "웹 화면을 열 수 없어요",
                "기본 브라우저에서 hanbang.ai/login을 열어 다시 시도해주세요."
              );
            });
          },
        },
      ]
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <DismissKeyboard>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* 로고 — 페이드인 */}
          <Animated.View
            style={[
              styles.brand,
              { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
            ]}
          >
            <Image
              source={require("../../assets/icon.png")}
              style={styles.logo}
              resizeMode="contain"
            />
            <Text style={styles.title}>웨딩한방</Text>
            <Text style={styles.subtitle}>
              AI 웨딩 플래너와 함께{"\n"}완벽한 결혼을 준비하세요
            </Text>
          </Animated.View>

          {/* 이메일 로그인 폼 */}
          <View style={[styles.form, isFormDisabled && { opacity: 0.5 }]}>
            <View>
              <TextInput
                style={[styles.input, emailInvalid && styles.inputError]}
                value={email}
                onChangeText={setEmail}
                onBlur={() => setEmailTouched(true)}
                placeholder="이메일 주소를 입력해주세요"
                placeholderTextColor={colors.taupe[400]}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                editable={!isFormDisabled}
                accessibilityLabel="이메일 입력"
              />
              {emailInvalid && (
                <Text style={styles.errorHint}>올바른 이메일 형식을 입력해주세요</Text>
              )}
            </View>

            <View>
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
                  editable={!isFormDisabled}
                  accessibilityLabel="비밀번호 입력"
                />
                <Pressable style={styles.eyeBtn} onPress={() => setShowPassword(!showPassword)}>
                  {showPassword
                    ? <EyeOff size={20} color={colors.taupe[400]} />
                    : <Eye size={20} color={colors.taupe[400]} />
                  }
                </Pressable>
              </View>
              <Text style={styles.fieldHint}>6자 이상</Text>
            </View>

            <Pressable
              style={[styles.emailBtn, (!email.trim() || !password || emailInvalid) && { opacity: 0.4 }]}
              onPress={handleEmailLogin}
              disabled={!email.trim() || !password || loading !== null || emailInvalid}
              accessibilityLabel="로그인"
              accessibilityRole="button"
            >
              {loading === "email"
                ? <ActivityIndicator color="#FFF" />
                : <Text style={styles.emailBtnText}>로그인</Text>
              }
            </Pressable>

            {/* 비밀번호 찾기 + 회원가입 */}
            <View style={styles.linkRow}>
              <Pressable onPress={() => openSecureWebAuth("forgot")}>
                <Text style={styles.link}>비밀번호 찾기</Text>
              </Pressable>
              <Text style={styles.linkDot}>|</Text>
              <Pressable onPress={() => openSecureWebAuth("signup")}>
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
          <View style={[styles.socialButtons, isFormDisabled && { opacity: 0.5 }]}>
            <Pressable
              style={({ pressed }) => [styles.kakaoButton, pressed && { opacity: 0.8 }]}
              onPress={() => handleSocialLogin("kakao")}
              disabled
              accessibilityLabel="카카오로 로그인"
              accessibilityRole="button"
            >
              {loading === "kakao" ? (
                <ActivityIndicator color="#191919" />
              ) : (
                <View style={styles.socialInner}>
                  <View style={styles.kakaoIcon}>
                    <Text style={styles.kakaoIconText}>K</Text>
                  </View>
                  <Text style={styles.kakaoText}>카카오 로그인 준비 중</Text>
                </View>
              )}
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.appleButton, pressed && { opacity: 0.8 }]}
              onPress={() => handleSocialLogin("apple")}
              disabled
              accessibilityLabel="Apple로 로그인"
              accessibilityRole="button"
            >
              {loading === "apple" ? (
                <ActivityIndicator color={colors.textPrimary} />
              ) : (
                <View style={styles.socialInner}>
                  <Text style={styles.appleIcon}>{"\uF8FF"}</Text>
                  <Text style={styles.appleText}>Apple 로그인 준비 중</Text>
                </View>
              )}
            </Pressable>
          </View>

          <Text style={styles.disclaimer}>
            계속하면 이용약관과 개인정보처리방침에{"\n"}동의하는 것으로 간주됩니다
          </Text>
        </ScrollView>
        </DismissKeyboard>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scrollContent: { paddingHorizontal: 24, paddingBottom: 40 },

  brand: { alignItems: "center", paddingTop: 48, marginBottom: 36 },
  logo: {
    width: 88,
    height: 88,
    marginBottom: 16,
    borderRadius: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
  },
  title: {
    fontSize: 32,
    fontFamily: "NotoSerifKR_500Medium",
    color: colors.noir[800],
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 15,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
    textAlign: "center",
    lineHeight: 24,
  },

  // 이메일 폼
  form: { gap: 12 },
  input: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    fontSize: 15,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.noir[800],
  },
  inputError: { borderColor: colors.danger },
  errorHint: {
    fontSize: 12,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.danger,
    marginTop: 6,
    marginLeft: 4,
  },
  fieldHint: {
    fontSize: 12,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textTertiary,
    marginTop: 6,
    marginLeft: 4,
  },
  passwordRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  eyeBtn: { padding: 10 },
  emailBtn: {
    height: 52,
    borderRadius: 16,
    backgroundColor: colors.noir[800],
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  emailBtnText: {
    fontSize: 16,
    fontFamily: "NotoSansKR_600SemiBold",
    color: "#FFF",
  },

  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    marginTop: 8,
  },
  link: {
    fontSize: 13,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
  },
  linkDot: { fontSize: 13, color: colors.border },

  // 구분선
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginVertical: 28,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: {
    fontSize: 13,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textTertiary,
  },

  // 소셜
  socialButtons: { gap: 12 },
  socialInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  kakaoButton: {
    width: "100%",
    height: 52,
    borderRadius: 14,
    backgroundColor: "#FEE500",
    alignItems: "center",
    justifyContent: "center",
  },
  kakaoIcon: {
    width: 22,
    height: 22,
    borderRadius: 6,
    backgroundColor: "#191919",
    alignItems: "center",
    justifyContent: "center",
  },
  kakaoIconText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#FEE500",
  },
  kakaoText: {
    fontSize: 15,
    fontFamily: "NotoSansKR_600SemiBold",
    color: "#191919",
  },
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
  appleIcon: {
    fontSize: 18,
    color: colors.textPrimary,
  },
  appleText: {
    fontSize: 15,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.textPrimary,
  },

  disclaimer: {
    fontSize: 12,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textTertiary,
    textAlign: "center",
    marginTop: 24,
    lineHeight: 18,
  },
});
