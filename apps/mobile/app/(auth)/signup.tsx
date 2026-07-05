// 회원가입 — 이름 + 이메일 + 비밀번호 + 약관동의
import { useState, useCallback } from "react";
import {
  View, Text, TextInput, Pressable, StyleSheet, ScrollView,
  Alert, ActivityIndicator, Linking, KeyboardAvoidingView, Platform,
  LayoutAnimation, UIManager, DimensionValue,
} from "react-native";
import DismissKeyboard from "@/components/DismissKeyboard";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { ArrowLeft, CheckCircle2, Circle, Eye, EyeOff, ChevronDown, ChevronUp } from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";
import { publicApiFetch } from "@/lib/api";

// Android LayoutAnimation 활성화
if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const SITE = process.env.EXPO_PUBLIC_SITE_URL || "https://hanbang.ai";

// 이메일 유효성 검사
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// 비밀번호 강도 계산
type PasswordStrength = "none" | "weak" | "medium" | "strong";
function getPasswordStrength(pw: string): PasswordStrength {
  if (pw.length === 0) return "none";
  if (pw.length < 6) return "weak";
  let score = 0;
  if (pw.length >= 8) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (score >= 3) return "strong";
  if (score >= 1) return "medium";
  return "weak";
}

const strengthConfig: Record<Exclude<PasswordStrength, "none">, { label: string; color: string; width: DimensionValue }> = {
  weak: { label: "약함", color: colors.danger, width: "33%" },
  medium: { label: "보통", color: colors.warning, width: "66%" },
  strong: { label: "강함", color: colors.success, width: "100%" },
};

// 서버(/api/auth/signup)와 동일한 강한 비밀번호 정책 —
// 8자 이상 + 대/소문자 + 숫자 + 특수문자. 클라에서 먼저 막아 400 왕복을 줄인다.
function isStrongPassword(pw: string): boolean {
  return (
    pw.length >= 8 &&
    /[A-Z]/.test(pw) &&
    /[a-z]/.test(pw) &&
    /\d/.test(pw) &&
    /[^A-Za-z0-9]/.test(pw)
  );
}

export default function SignupScreen() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showAgreements, setShowAgreements] = useState(true);

  // 약관 동의
  const [agreeAll, setAgreeAll] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [agreePrivacy, setAgreePrivacy] = useState(false);
  const [agreeMarketing, setAgreeMarketing] = useState(false);

  const emailInvalid = emailTouched && email.length > 0 && !isValidEmail(email);
  const passwordStrength = getPasswordStrength(password);

  function toggleAll() {
    const next = !agreeAll;
    setAgreeAll(next);
    setAgreeTerms(next);
    setAgreePrivacy(next);
    setAgreeMarketing(next);
  }

  function updateAgreements(terms: boolean, privacy: boolean, marketing: boolean) {
    setAgreeTerms(terms);
    setAgreePrivacy(privacy);
    setAgreeMarketing(marketing);
    setAgreeAll(terms && privacy && marketing);
  }

  const toggleAgreementSection = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setShowAgreements((v) => !v);
  }, []);

  const canSubmit = name.trim() && email.trim() && isValidEmail(email) && isStrongPassword(password) &&
    password === confirmPassword && agreeTerms && agreePrivacy;

  async function handleSignup() {
    if (!canSubmit) return;

    if (!isStrongPassword(password)) {
      Alert.alert("알림", "비밀번호는 8자 이상이며 대문자, 소문자, 숫자, 특수문자를 포함해야 해요.");
      return;
    }
    if (password !== confirmPassword) {
      Alert.alert("알림", "비밀번호가 일치하지 않습니다.");
      return;
    }
    if (!agreeTerms || !agreePrivacy) {
      Alert.alert("알림", "필수 약관에 동의해주세요.");
      return;
    }

    setLoading(true);
    try {
      // 웹과 동일한 하드닝 라우트 경유 — Turnstile(모바일 생략)·IP/이메일 rate limit·
      // enumeration 마스킹·강한 비밀번호·브랜드 인증메일을 서버가 처리한다.
      // 클라 SDK 직접 호출(우회)을 제거. 라우트는 세션을 만들지 않고 인증 메일만 보낸다.
      const res = await publicApiFetch("/api/auth/signup", {
        method: "POST",
        body: JSON.stringify({
          email: email.trim(),
          password,
          name: name.trim(),
          marketingAgreed: agreeMarketing,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string };

      if (!res.ok || !data.success) {
        Alert.alert("알림", data.error ?? "회원가입에 실패했어요. 다시 시도해주세요.");
        return;
      }

      // 항상 인증 메일 확인 안내 (enumeration 방지 — 서버가 존재 여부를 노출하지 않음)
      Alert.alert(
        "이메일 확인",
        "가입 확인 이메일을 보냈어요. 이메일을 확인한 후 로그인해주세요.",
        [{ text: "확인", onPress: () => router.back() }]
      );
    } catch {
      Alert.alert("오류", "회원가입에 실패했어요. 다시 시도해주세요.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {/* 헤더 */}
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <ArrowLeft size={24} color={colors.noir[800]} />
          </Pressable>
          <Text style={styles.headerTitle}>회원가입</Text>
          <View style={{ width: 24 }} />
        </View>

        <DismissKeyboard>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>웨딩한방에{"\n"}오신 것을 환영해요</Text>

          {/* 이름 */}
          <Text style={styles.label}>이름</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="홍길동"
            placeholderTextColor={colors.taupe[400]}
            autoCapitalize="words"
          />

          {/* 이메일 */}
          <Text style={styles.label}>이메일</Text>
          <TextInput
            style={[styles.input, emailInvalid && styles.inputError]}
            value={email}
            onChangeText={setEmail}
            onBlur={() => setEmailTouched(true)}
            placeholder="이메일 주소"
            placeholderTextColor={colors.taupe[400]}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {emailInvalid && (
            <Text style={styles.errorText}>올바른 이메일 형식을 입력해주세요</Text>
          )}

          {/* 비밀번호 */}
          <Text style={styles.label}>비밀번호</Text>
          <View style={styles.passwordRow}>
            <TextInput
              style={[styles.input, { flex: 1, marginBottom: 0 }]}
              value={password}
              onChangeText={setPassword}
              placeholder="8자 이상, 대/소문자·숫자·특수문자"
              placeholderTextColor={colors.taupe[400]}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
            />
            <Pressable
              style={styles.eyeBtn}
              onPress={() => setShowPassword(!showPassword)}
            >
              {showPassword
                ? <EyeOff size={20} color={colors.taupe[400]} />
                : <Eye size={20} color={colors.taupe[400]} />
              }
            </Pressable>
          </View>

          {/* 비밀번호 강도 표시기 */}
          {password.length > 0 && passwordStrength !== "none" && (
            <View style={styles.strengthContainer}>
              <View style={styles.strengthBarBg}>
                <View
                  style={[
                    styles.strengthBarFill,
                    {
                      width: strengthConfig[passwordStrength].width,
                      backgroundColor: strengthConfig[passwordStrength].color,
                    },
                  ]}
                />
              </View>
              <Text
                style={[
                  styles.strengthLabel,
                  { color: strengthConfig[passwordStrength].color },
                ]}
              >
                {strengthConfig[passwordStrength].label}
              </Text>
            </View>
          )}
          {password.length > 0 && !isStrongPassword(password) && (
            <Text style={styles.errorText}>
              8자 이상, 대문자·소문자·숫자·특수문자를 모두 포함해야 해요
            </Text>
          )}

          {/* 비밀번호 확인 */}
          <Text style={styles.label}>비밀번호 확인</Text>
          <TextInput
            style={[
              styles.input,
              confirmPassword.length > 0 && password !== confirmPassword && styles.inputError,
            ]}
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            placeholder="비밀번호를 다시 입력"
            placeholderTextColor={colors.taupe[400]}
            secureTextEntry={!showPassword}
            autoCapitalize="none"
          />
          {confirmPassword.length > 0 && password !== confirmPassword && (
            <Text style={styles.errorText}>비밀번호가 일치하지 않습니다</Text>
          )}

          {/* 약관 동의 */}
          <View style={styles.agreementSection}>
            <Pressable style={styles.agreeRow} onPress={toggleAll}>
              {agreeAll
                ? <CheckCircle2 size={24} color={colors.rose[500]} />
                : <Circle size={24} color={colors.taupe[400]} />
              }
              <Text style={styles.agreeAllText}>전체 동의</Text>
              <Pressable onPress={toggleAgreementSection} hitSlop={8} style={styles.chevronBtn}>
                {showAgreements
                  ? <ChevronUp size={20} color={colors.taupe[400]} />
                  : <ChevronDown size={20} color={colors.taupe[400]} />
                }
              </Pressable>
            </Pressable>

            {showAgreements && (
              <>
                <View style={styles.divider} />

                {/* 이용약관 (필수) */}
                <View style={styles.agreeRow}>
                  <Pressable onPress={() => updateAgreements(!agreeTerms, agreePrivacy, agreeMarketing)}>
                    {agreeTerms
                      ? <CheckCircle2 size={20} color={colors.rose[500]} />
                      : <Circle size={20} color={colors.taupe[400]} />
                    }
                  </Pressable>
                  <Text style={styles.agreeText}>
                    <Text style={styles.agreeRequired}>[필수]</Text> 이용약관 동의
                  </Text>
                  <Pressable onPress={() => Linking.openURL(`${SITE}/terms`)}>
                    <Text style={styles.agreeLink}>보기</Text>
                  </Pressable>
                </View>

                {/* 개인정보 처리방침 (필수) */}
                <View style={styles.agreeRow}>
                  <Pressable onPress={() => updateAgreements(agreeTerms, !agreePrivacy, agreeMarketing)}>
                    {agreePrivacy
                      ? <CheckCircle2 size={20} color={colors.rose[500]} />
                      : <Circle size={20} color={colors.taupe[400]} />
                    }
                  </Pressable>
                  <Text style={styles.agreeText}>
                    <Text style={styles.agreeRequired}>[필수]</Text> 개인정보 처리방침 동의
                  </Text>
                  <Pressable onPress={() => Linking.openURL(`${SITE}/privacy`)}>
                    <Text style={styles.agreeLink}>보기</Text>
                  </Pressable>
                </View>

                {/* 마케팅 수신 (선택) */}
                <View style={styles.agreeRow}>
                  <Pressable onPress={() => updateAgreements(agreeTerms, agreePrivacy, !agreeMarketing)}>
                    {agreeMarketing
                      ? <CheckCircle2 size={20} color={colors.rose[500]} />
                      : <Circle size={20} color={colors.taupe[400]} />
                    }
                  </Pressable>
                  <Text style={styles.agreeText}>
                    <Text style={styles.agreeOptional}>[선택]</Text> 마케팅 정보 수신 동의
                  </Text>
                </View>
              </>
            )}
          </View>

          {/* 가입 버튼 */}
          <Pressable
            style={[styles.submitBtn, !canSubmit && styles.submitBtnDisabled]}
            onPress={handleSignup}
            disabled={!canSubmit || loading}
          >
            {loading
              ? <ActivityIndicator color="#FFF" />
              : <Text style={styles.submitText}>가입하기</Text>
            }
          </Pressable>

          {/* 로그인으로 */}
          <Pressable onPress={() => router.back()} style={styles.loginLink}>
            <Text style={styles.loginLinkText}>
              이미 계정이 있으신가요? <Text style={{ color: colors.rose[500] }}>로그인</Text>
            </Text>
          </Pressable>
        </ScrollView>
        </DismissKeyboard>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  headerTitle: {
    fontSize: 18,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.noir[800],
  },
  content: { paddingHorizontal: 24, paddingBottom: 40 },
  title: {
    fontSize: 26,
    fontFamily: "NotoSerifKR_500Medium",
    color: colors.noir[800],
    lineHeight: 36,
    marginBottom: 28,
  },

  label: {
    fontSize: 14,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.noir[800],
    marginBottom: 8,
    marginTop: 16,
  },
  input: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    fontSize: 15,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.noir[800],
    marginBottom: 4,
  },
  inputError: { borderColor: colors.danger },
  errorText: {
    fontSize: 12,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.danger,
    marginTop: 4,
    marginLeft: 4,
  },

  passwordRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  eyeBtn: { padding: 10 },

  // 비밀번호 강도 표시기
  strengthContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 8,
    marginBottom: 4,
    paddingHorizontal: 4,
  },
  strengthBarBg: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.ivory[200],
    overflow: "hidden",
  },
  strengthBarFill: {
    height: "100%",
    borderRadius: 2,
  },
  strengthLabel: {
    fontSize: 12,
    fontFamily: "NotoSansKR_500Medium",
    minWidth: 28,
  },

  // 약관
  agreementSection: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    padding: 16,
    marginTop: 24,
    gap: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 1,
  },
  agreeRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  agreeAllText: {
    fontSize: 16,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.noir[800],
    flex: 1,
  },
  chevronBtn: { padding: 4 },
  agreeText: {
    fontSize: 14,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.noir[800],
    flex: 1,
  },
  agreeRequired: { color: colors.rose[500], fontFamily: "NotoSansKR_600SemiBold" },
  agreeOptional: { color: colors.textTertiary, fontFamily: "NotoSansKR_600SemiBold" },
  agreeLink: {
    fontSize: 13,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textTertiary,
    textDecorationLine: "underline",
  },
  divider: { height: 1, backgroundColor: colors.border },

  // 버튼
  submitBtn: {
    height: 56,
    borderRadius: 16,
    backgroundColor: colors.noir[800],
    alignItems: "center",
    justifyContent: "center",
    marginTop: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
  submitBtnDisabled: { opacity: 0.4 },
  submitText: {
    fontSize: 16,
    fontFamily: "NotoSansKR_600SemiBold",
    color: "#FFF",
  },

  loginLink: { alignItems: "center", marginTop: 16, paddingVertical: 8 },
  loginLinkText: {
    fontSize: 14,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
  },
});
