// 회원가입 — 이름 + 이메일 + 비밀번호 + 약관동의
import { useState, useCallback, useRef } from "react";
import { View, Pressable, StyleSheet, ScrollView, Alert, ActivityIndicator, Linking, KeyboardAvoidingView, Platform, LayoutAnimation, UIManager, DimensionValue } from "react-native";
import { Text, TextInput } from "@/components/ui/AppText";
import DismissKeyboard from "@/components/DismissKeyboard";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { CheckCircle2, Circle, Eye, EyeOff, ChevronDown, ChevronUp } from "lucide-react-native";
import TurnstileModal from "@/components/auth/TurnstileModal";
import InvitationBackButton from "@/components/invitation/InvitationBackButton";
import {
  InvitationAuthBackground,
  InvitationAuthCard,
  InvitationAuthHeader,
  authAgreement,
  authColors,
  authField,
  authText,
} from "@/components/invitation/InvitationAuthFrame";
import { palette, typo } from "@/components/invitation/invitationStyle";
import { requestMobileSignup } from "@/lib/mobileAuthRequests";
import {
  isValidTurnstileToken,
  turnstileTokenIsRequired,
} from "@/lib/turnstile";

// Android LayoutAnimation 활성화
if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const SITE = process.env.EXPO_PUBLIC_SITE_URL || "https://hanbang.ai";
const TURNSTILE_SITE_KEY = process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY?.trim() ?? "";
// 서버와 같은 규칙. 사이트 키가 발급돼 있을 때만 토큰을 요구한다.
const TURNSTILE_REQUIRED = turnstileTokenIsRequired(TURNSTILE_SITE_KEY);

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

// 색은 청첩장 팔레트에서 고른다. 약함은 경고색, 보통은 흐린 글자색, 강함은 먹색이다.
// 글자(약함·보통·강함)가 함께 나오니 색만 보고 읽을 일은 없다.
const strengthConfig: Record<Exclude<PasswordStrength, "none">, { label: string; color: string; width: DimensionValue }> = {
  weak: { label: "약함", color: palette.warn, width: "33%" },
  medium: { label: "보통", color: palette.muted, width: "66%" },
  strong: { label: "강함", color: palette.ink, width: "100%" },
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
  const [turnstileVisible, setTurnstileVisible] = useState(false);
  const turnstileTokenRef = useRef("");

  // 약관 동의
  const [agreeAll, setAgreeAll] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [agreePrivacy, setAgreePrivacy] = useState(false);
  // 만 14세 이상 확인. 생년월일은 받지 않는다 — 거르는 데 필요하지 않은 정보를
  // 더 받는 것은 최소수집 원칙에 어긋난다.
  const [agreeAge14, setAgreeAge14] = useState(false);
  const [agreeMarketing, setAgreeMarketing] = useState(false);

  const emailInvalid = emailTouched && email.length > 0 && !isValidEmail(email);
  const passwordStrength = getPasswordStrength(password);

  function toggleAll() {
    const next = !agreeAll;
    setAgreeAll(next);
    setAgreeTerms(next);
    setAgreePrivacy(next);
    setAgreeAge14(next);
    setAgreeMarketing(next);
  }

  function updateAgreements(
    terms: boolean,
    privacy: boolean,
    age14: boolean,
    marketing: boolean,
  ) {
    setAgreeTerms(terms);
    setAgreePrivacy(privacy);
    setAgreeAge14(age14);
    setAgreeMarketing(marketing);
    setAgreeAll(terms && privacy && age14 && marketing);
  }

  const toggleAgreementSection = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setShowAgreements((v) => !v);
  }, []);

  const canSubmit = name.trim() && email.trim() && isValidEmail(email) && isStrongPassword(password) &&
    password === confirmPassword && agreeTerms && agreePrivacy && agreeAge14;

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
    if (!agreeTerms || !agreePrivacy || !agreeAge14) {
      Alert.alert("알림", "필수 항목에 모두 동의해주세요.");
      return;
    }

    turnstileTokenRef.current = "";
    if (!TURNSTILE_REQUIRED) {
      // 서버와 같은 규칙. 사이트 키가 미발급이면 서버도 토큰을 보지 않으므로
      // 앱만 막을 이유가 없다 — 그때 막히는 것은 봇이 아니라 진짜 사용자다.
      void performSignup("");
      return;
    }

    setTurnstileVisible(true);
  }

  async function submitSignupWithTurnstile(turnstileToken: string) {
    if (!isValidTurnstileToken(turnstileToken)) {
      turnstileTokenRef.current = "";
      setTurnstileVisible(false);
      Alert.alert("안전 확인 실패", "사람인지 확인을 다시 완료해주세요.");
      return;
    }
    await performSignup(turnstileToken);
  }

  // 토큰 유무와 무관한 실제 가입 요청. 사이트 키가 발급돼 있으면 위에서 검증한
  // 토큰이 들어오고, 미발급이면 빈 값으로 들어온다 — 서버도 그 경우 토큰을
  // 보지 않고 IP·이메일 속도 제한으로만 방어한다.
  async function performSignup(turnstileToken: string) {
    turnstileTokenRef.current = turnstileToken;
    setTurnstileVisible(false);
    setLoading(true);
    try {
      // WebView에서 검증된 단일 사용 토큰만 하드닝 라우트에 전달한다.
      const res = await requestMobileSignup(
        {
          email: email.trim(),
          password,
          name: name.trim(),
          consent: {
            terms: agreeTerms,
            privacy: agreePrivacy,
            age14: agreeAge14,
            marketing: agreeMarketing,
          },
        },
        turnstileTokenRef.current,
      );
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
      turnstileTokenRef.current = "";
      setLoading(false);
    }
  }

  // 2026-11-20 파운더 "로그인 페이지도 다 바꿔야": 로그인과 같은 바탕·amora·유리 카드에 넣는다(InvitationAuthFrame).
  // 가입 요청·안전 확인·동의 항목과 문장은 그대로이고, 바뀐 것은 겉모양뿐이다.
  // 머리줄 가운데 있던 "회원가입"은 카드 제목으로 옮겼고, 뒤로 단추는 사진 위 반투명 원(InvitationBackButton)이다.
  return (
    <InvitationAuthBackground>
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {/* 머리줄 — 뒤로 */}
        <View style={styles.header}>
          <InvitationBackButton tone="glass" label="뒤로" onPress={() => router.back()} />
        </View>

        <DismissKeyboard>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <InvitationAuthHeader />
          <View style={styles.spacer} />

          <InvitationAuthCard>
          <Text accessibilityRole="header" style={authText.heading}>회원가입</Text>
          <Text style={authText.body}>웨딩한방에{"\n"}오신 것을 환영해요</Text>

          {/* 이름 */}
          <View>
            <Text style={styles.label}>이름</Text>
            <TextInput
              style={authField.input}
              value={name}
              onChangeText={setName}
              placeholder="홍길동"
              placeholderTextColor={authColors.placeholder}
              autoCapitalize="words"
            />
          </View>

          {/* 이메일 */}
          <View>
            <Text style={styles.label}>이메일</Text>
            <TextInput
              style={[authField.input, emailInvalid && authField.inputError]}
              value={email}
              onChangeText={setEmail}
              onBlur={() => setEmailTouched(true)}
              placeholder="이메일 주소"
              placeholderTextColor={authColors.placeholder}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
            {emailInvalid && (
              <Text style={authText.error}>올바른 이메일 형식을 입력해주세요</Text>
            )}
          </View>

          {/* 비밀번호 */}
          <View>
            <Text style={styles.label}>비밀번호</Text>
            <View style={styles.passwordRow}>
              <TextInput
                style={[authField.input, { flex: 1 }]}
                value={password}
                onChangeText={setPassword}
                placeholder="8자 이상, 대/소문자·숫자·특수문자"
                placeholderTextColor={authColors.placeholder}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
              />
              <Pressable
                style={styles.eyeBtn}
                onPress={() => setShowPassword(!showPassword)}
              >
                {showPassword
                  ? <EyeOff size={20} color={authColors.icon} />
                  : <Eye size={20} color={authColors.icon} />
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
              <Text style={authText.error}>
                8자 이상, 대문자·소문자·숫자·특수문자를 모두 포함해야 해요
              </Text>
            )}
          </View>

          {/* 비밀번호 확인 */}
          <View>
            <Text style={styles.label}>비밀번호 확인</Text>
            <TextInput
              style={[
                authField.input,
                confirmPassword.length > 0 && password !== confirmPassword && authField.inputError,
              ]}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder="비밀번호를 다시 입력"
              placeholderTextColor={authColors.placeholder}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
            />
            {confirmPassword.length > 0 && password !== confirmPassword && (
              <Text style={authText.error}>비밀번호가 일치하지 않습니다</Text>
            )}
          </View>

          {/* 약관 동의 */}
          <View style={authAgreement.section}>
            <Pressable style={authAgreement.row} onPress={toggleAll}>
              {agreeAll
                ? <CheckCircle2 size={24} color={authColors.checked} />
                : <Circle size={24} color={authColors.unchecked} />
              }
              <Text style={authAgreement.allText}>전체 동의</Text>
              <Pressable
                onPress={toggleAgreementSection}
                hitSlop={8}
                style={styles.chevronBtn}
                accessibilityRole="button"
                accessibilityLabel={showAgreements ? "약관 항목 접기" : "약관 항목 펼치기"}
                accessibilityState={{ expanded: showAgreements }}
              >
                {showAgreements
                  ? <ChevronUp size={20} color={authColors.icon} />
                  : <ChevronDown size={20} color={authColors.icon} />
                }
              </Pressable>
            </Pressable>

            {showAgreements && (
              <>
                <View style={authAgreement.divider} />

                {/* 이용약관 (필수) */}
                <View style={authAgreement.row}>
                  <Pressable onPress={() => updateAgreements(!agreeTerms, agreePrivacy, agreeAge14, agreeMarketing)}>
                    {agreeTerms
                      ? <CheckCircle2 size={20} color={authColors.checked} />
                      : <Circle size={20} color={authColors.unchecked} />
                    }
                  </Pressable>
                  <Text style={authAgreement.text}>
                    <Text style={authAgreement.required}>[필수]</Text> 이용약관 동의
                  </Text>
                  <Pressable onPress={() => Linking.openURL(`${SITE}/terms`)}>
                    <Text style={authAgreement.link}>보기</Text>
                  </Pressable>
                </View>

                {/* 개인정보 처리방침 (필수) */}
                <View style={authAgreement.row}>
                  <Pressable onPress={() => updateAgreements(agreeTerms, !agreePrivacy, agreeAge14, agreeMarketing)}>
                    {agreePrivacy
                      ? <CheckCircle2 size={20} color={authColors.checked} />
                      : <Circle size={20} color={authColors.unchecked} />
                    }
                  </Pressable>
                  <Text style={authAgreement.text}>
                    <Text style={authAgreement.required}>[필수]</Text> 개인정보 처리방침 동의
                  </Text>
                  <Pressable onPress={() => Linking.openURL(`${SITE}/privacy`)}>
                    <Text style={authAgreement.link}>보기</Text>
                  </Pressable>
                </View>

                {/* 만 14세 이상 (필수) */}
                <View style={authAgreement.row}>
                  <Pressable
                    onPress={() =>
                      updateAgreements(agreeTerms, agreePrivacy, !agreeAge14, agreeMarketing)
                    }
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: agreeAge14 }}
                    accessibilityLabel="필수 만 14세 이상입니다"
                  >
                    {agreeAge14
                      ? <CheckCircle2 size={20} color={authColors.checked} />
                      : <Circle size={20} color={authColors.unchecked} />
                    }
                  </Pressable>
                  <Text style={authAgreement.text}>
                    <Text style={authAgreement.required}>[필수]</Text> 만 14세 이상입니다
                  </Text>
                </View>

                {/* 마케팅 수신 (선택) */}
                <View style={authAgreement.row}>
                  <Pressable onPress={() => updateAgreements(agreeTerms, agreePrivacy, agreeAge14, !agreeMarketing)}>
                    {agreeMarketing
                      ? <CheckCircle2 size={20} color={authColors.checked} />
                      : <Circle size={20} color={authColors.unchecked} />
                    }
                  </Pressable>
                  <Text style={authAgreement.text}>
                    <Text style={authAgreement.optional}>[선택]</Text> 마케팅 정보 수신 동의
                  </Text>
                </View>
              </>
            )}
          </View>

          {/* 가입 버튼 */}
          <Pressable
            style={[authField.primary, !canSubmit && styles.submitBtnDisabled]}
            onPress={handleSignup}
            disabled={!canSubmit || loading || turnstileVisible}
            accessibilityRole="button"
            accessibilityLabel="가입하기"
          >
            {loading
              ? <ActivityIndicator color={authColors.white} />
              : <Text style={authField.primaryText}>가입하기</Text>
            }
          </Pressable>

          {/* 로그인으로 */}
          <Pressable onPress={() => router.back()} style={styles.loginLink}>
            <Text style={authText.link}>
              이미 계정이 있으신가요? <Text style={authText.linkStrong}>로그인</Text>
            </Text>
          </Pressable>
          </InvitationAuthCard>
        </ScrollView>
        </DismissKeyboard>
      </KeyboardAvoidingView>
      <TurnstileModal
        visible={turnstileVisible}
        siteKey={TURNSTILE_SITE_KEY}
        action="signup"
        onVerify={submitSignupWithTurnstile}
        onCancel={() => {
          turnstileTokenRef.current = "";
          setTurnstileVisible(false);
        }}
      />
    </SafeAreaView>
    </InvitationAuthBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 12, paddingTop: 4 },
  content: { flexGrow: 1, paddingHorizontal: 12, paddingBottom: 12 },
  spacer: { flexGrow: 1, minHeight: 16 },

  label: {
    ...typo.sansMedium,
    fontSize: 13,
    lineHeight: 18,
    color: palette.body,
    marginBottom: 8,
    marginLeft: 6,
  },

  passwordRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  eyeBtn: { padding: 10 },

  // 비밀번호 강도 표시기
  strengthContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 10,
    paddingHorizontal: 6,
  },
  strengthBarBg: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: palette.chipLine,
    overflow: "hidden",
  },
  strengthBarFill: {
    height: "100%",
    borderRadius: 2,
  },
  strengthLabel: {
    ...typo.sansMedium,
    fontSize: 12,
    minWidth: 28,
  },

  chevronBtn: { padding: 4 },

  submitBtnDisabled: { opacity: 0.4 },

  loginLink: { alignItems: "center", paddingVertical: 8 },
});
