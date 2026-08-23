// 로그인 — 이메일/비밀번호 + 카카오/Apple 소셜 로그인
import { useState, useEffect, useRef } from "react";
import {
  View, Text, TextInput, Pressable, StyleSheet, Image, Alert,
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView,
  Animated,
} from "react-native";
import DismissKeyboard from "@/components/DismissKeyboard";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Eye, EyeOff } from "lucide-react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@hanbang/design-tokens";
import { supabase } from "@/lib/supabase";
import {
  OAUTH_PROVIDER_UNAVAILABLE,
  isOAuthProviderEnabled,
  signInWithOAuth,
} from "@/lib/auth";

const SOCIAL_PROVIDER_LABEL = {
  kakao: "카카오",
  google: "구글",
  apple: "Apple",
} as const;

// Supabase 에러 메시지 한국어 변환
function translateError(message: string): string {
  // 소셜로만 가입한 계정에는 비밀번호가 없다. 그 사람에게 "비밀번호가 틀렸다"고 하면
  // 존재하지 않는 것을 계속 맞히려 애쓴다. 그렇다고 "이 계정은 구글이에요"라고 말하면
  // 가입 여부가 밖으로 드러나므로, 어느 쪽인지는 말하지 않고 나가는 길만 가리킨다.
  if (message.includes("Invalid login")) {
    return "이메일과 비밀번호가 맞지 않아요. 카카오·구글·Apple로 시작한 계정이라면 비밀번호가 아직 없을 수 있어요 — 아래 '비밀번호 찾기'에서 정하실 수 있어요.";
  }
  // 사실만 말하고 끝내면 사용자는 뭘 해야 할지 모른다. 메일함부터 보게 하고,
  // 없을 때의 다음 행동까지 문장 안에 넣는다(웹의 `authErrorMessages.ts` 와 같은 규칙).
  if (message.includes("Email not confirmed")) {
    return "이메일 인증이 아직 안 끝났어요. 메일함에서 확인 메일의 버튼을 눌러주세요. 메일이 없으면 같은 이메일로 회원가입을 다시 진행하면 새 메일을 보내드려요.";
  }
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
  const [loading, setLoading] = useState<null | "email" | "kakao" | "apple" | "google">(null);
  const [emailTouched, setEmailTouched] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const kakaoOAuthEnabled = isOAuthProviderEnabled("kakao");
  const appleOAuthEnabled = isOAuthProviderEnabled("apple");
  const googleOAuthEnabled = isOAuthProviderEnabled("google");
  const hasSocialLogin = kakaoOAuthEnabled || appleOAuthEnabled || googleOAuthEnabled;

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

  const emailInvalid =
    emailTouched &&
    email.trim().length > 0 &&
    !isValidEmail(email.trim());
  const isFormDisabled = loading !== null;

  function showLoginError(title: string, message: string) {
    setLoginError(message);
    if (Platform.OS !== "web") {
      Alert.alert(title, message);
    }
  }

  // 이메일 로그인
  async function handleEmailLogin() {
    if (!email.trim() || !password) return;
    if (!isValidEmail(email.trim())) {
      showLoginError("알림", "올바른 이메일 형식을 입력해주세요.");
      return;
    }
    setLoginError(null);
    setLoading("email");
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) {
        showLoginError("로그인 실패", translateError(error.message));
        return;
      }
      // 루트가 onboarding_completed를 다시 확인한 뒤 올바른 화면으로 보낸다.
      router.replace("/");
    } catch {
      showLoginError("오류", "로그인에 실패했어요. 다시 시도해주세요.");
    } finally {
      setLoading(null);
    }
  }

  // 소셜 로그인
  async function handleSocialLogin(provider: "kakao" | "apple" | "google") {
    if (loading) return;
    setLoginError(null);
    setLoading(provider);
    try {
      const result = await signInWithOAuth(provider);
      if (result.cancelled) {
        setLoading(null);
        return;
      }
      // OAuth 신규 가입자도 온보딩을 건너뛰지 않게 공통 gate로 돌아간다.
      router.replace("/");
    } catch (err) {
      // 앱이 쓴 안내만 그대로 보여준다. Supabase가 던진 원문은 사람이 읽을 수 없고
      // 내부 상태를 드러내므로, 무엇이 안 됐는지만 우리 말로 알린다.
      const message =
        err instanceof Error && err.name === OAUTH_PROVIDER_UNAVAILABLE
          ? err.message
          : `${SOCIAL_PROVIDER_LABEL[provider]} 로그인을 지금 마치지 못했어요. 잠시 후 다시 시도하시거나 이메일 로그인을 이용해주세요.`;
      showLoginError("로그인 오류", message);
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
              결혼 준비, 아모라와 처음부터 끝까지
            </Text>
          </Animated.View>

          {/* 이메일 로그인 폼 */}
          <View style={[styles.form, isFormDisabled && { opacity: 0.5 }]}>
            <View>
              <TextInput
                style={[styles.input, emailInvalid && styles.inputError]}
                value={email}
                onChangeText={(value) => {
                  setEmail(value);
                  setLoginError(null);
                }}
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
                  onChangeText={(value) => {
                    setPassword(value);
                    setLoginError(null);
                  }}
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

            {loginError ? (
              <Text style={styles.loginError} accessibilityRole="alert">
                {loginError}
              </Text>
            ) : null}

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
              <Pressable onPress={() => router.push({ pathname: "/(auth)/forgot-password" })}>
                <Text style={styles.link}>비밀번호 찾기</Text>
              </Pressable>
              <Text style={styles.linkDot}>|</Text>
              <Pressable onPress={() => router.push({ pathname: "/(auth)/signup" })}>
                <Text style={[styles.link, { color: colors.rose[500] }]}>회원가입</Text>
              </Pressable>
            </View>
          </View>

          {hasSocialLogin ? (
            <>
              {/* 구분선 */}
              <View style={styles.dividerRow}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>또는</Text>
                <View style={styles.dividerLine} />
              </View>

              {/* 소셜 로그인 */}
              <View style={[styles.socialButtons, isFormDisabled && { opacity: 0.5 }]}>
            {kakaoOAuthEnabled ? (
            <Pressable
              style={({ pressed }) => [styles.kakaoButton, pressed && { opacity: 0.8 }]}
              onPress={() => handleSocialLogin("kakao")}
              disabled={loading !== null}
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
                  <Text style={styles.kakaoText}>카카오로 계속하기</Text>
                </View>
              )}
            </Pressable>
            ) : null}

            {googleOAuthEnabled ? (
            <Pressable
              style={({ pressed }) => [styles.googleButton, pressed && { opacity: 0.8 }]}
              onPress={() => handleSocialLogin("google")}
              disabled={loading !== null}
              accessibilityLabel="구글로 로그인"
              accessibilityRole="button"
            >
              {loading === "google" ? (
                <ActivityIndicator color={colors.textPrimary} />
              ) : (
                <View style={styles.socialInner}>
                  <Ionicons
                    name="logo-google"
                    size={20}
                    color={colors.textPrimary}
                  />
                  <Text style={styles.googleText}>구글로 계속하기</Text>
                </View>
              )}
            </Pressable>
            ) : null}

            {appleOAuthEnabled ? (
            <Pressable
              style={({ pressed }) => [styles.appleButton, pressed && { opacity: 0.8 }]}
              onPress={() => handleSocialLogin("apple")}
              disabled={loading !== null}
              accessibilityLabel="Apple로 로그인"
              accessibilityRole="button"
            >
              {loading === "apple" ? (
                <ActivityIndicator color={colors.textPrimary} />
              ) : (
                <View style={styles.socialInner}>
                  <Ionicons
                    name="logo-apple"
                    size={20}
                    color={colors.textPrimary}
                  />
                  <Text style={styles.appleText}>Apple로 계속하기</Text>
                </View>
              )}
            </Pressable>
            ) : null}
              </View>
            </>
          ) : (
            <Text style={styles.socialUnavailable}>
              {Platform.OS === "web"
                ? "소셜 로그인은 설치한 앱에서 이용할 수 있어요."
                : "소셜 로그인은 현재 준비 중이에요. 이메일 로그인을 이용해주세요."}
            </Text>
          )}

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
  loginError: {
    borderRadius: 12,
    backgroundColor: colors.rose.pale,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    fontFamily: "NotoSansKR_500Medium",
    color: colors.danger,
    lineHeight: 20,
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
  googleButton: {
    width: "100%",
    height: 52,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  googleText: {
    fontSize: 15,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.textPrimary,
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
  appleText: {
    fontSize: 15,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.textPrimary,
  },
  socialUnavailable: {
    marginTop: 24,
    fontSize: 13,
    lineHeight: 20,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
    textAlign: "center",
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
