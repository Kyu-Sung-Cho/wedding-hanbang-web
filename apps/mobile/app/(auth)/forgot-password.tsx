// 비밀번호 찾기 — 이메일로 재설정 링크 발송
import { useState, useEffect, useRef } from "react";
import { View, Pressable, StyleSheet, Image, Alert, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Animated } from "react-native";
import { Text, TextInput } from "@/components/ui/AppText";
import DismissKeyboard from "@/components/DismissKeyboard";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Check } from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";
import TurnstileModal from "@/components/auth/TurnstileModal";
import { requestMobilePasswordReset } from "@/lib/mobileAuthRequests";
import {
  isValidTurnstileToken,
  turnstileTokenIsRequired,
} from "@/lib/turnstile";

const TURNSTILE_SITE_KEY = process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY?.trim() ?? "";
// 서버와 같은 규칙. 사이트 키가 발급돼 있을 때만 토큰을 요구한다.
const TURNSTILE_REQUIRED = turnstileTokenIsRequired(TURNSTILE_SITE_KEY);

// 이메일 유효성 검사
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// 체크마크 애니메이션 컴포넌트
function CheckmarkAnimation() {
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.timing(opacityAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 4,
        tension: 80,
        useNativeDriver: true,
      }),
    ]).start();
  }, [scaleAnim, opacityAnim]);

  return (
    <Animated.View
      style={[
        styles.checkCircle,
        {
          opacity: opacityAnim,
          transform: [{ scale: scaleAnim }],
        },
      ]}
    >
      <Check size={36} color="#FFFFFF" strokeWidth={3} />
    </Animated.View>
  );
}

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [turnstileVisible, setTurnstileVisible] = useState(false);
  const turnstileTokenRef = useRef("");

  // 로고 페이드인 애니메이션
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(18)).current;

  // 발송 완료 화면 페이드인
  const sentFadeAnim = useRef(new Animated.Value(0)).current;
  const sentSlideAnim = useRef(new Animated.Value(20)).current;

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

  useEffect(() => {
    if (sent) {
      Animated.parallel([
        Animated.timing(sentFadeAnim, {
          toValue: 1,
          duration: 500,
          useNativeDriver: true,
        }),
        Animated.timing(sentSlideAnim, {
          toValue: 0,
          duration: 500,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [sent, sentFadeAnim, sentSlideAnim]);

  const emailInvalid = emailTouched && email.length > 0 && !isValidEmail(email);

  async function handleReset() {
    if (!email.trim()) {
      Alert.alert("알림", "이메일을 입력해주세요.");
      return;
    }
    if (!isValidEmail(email.trim())) {
      Alert.alert("알림", "올바른 이메일 형식을 입력해주세요.");
      return;
    }

    turnstileTokenRef.current = "";
    if (!TURNSTILE_REQUIRED) {
      // 서버와 같은 규칙 — 미발급이면 서버도 토큰을 보지 않는다.
      void performPasswordReset("");
      return;
    }

    setTurnstileVisible(true);
  }

  async function submitResetWithTurnstile(turnstileToken: string) {
    if (!isValidTurnstileToken(turnstileToken)) {
      turnstileTokenRef.current = "";
      setTurnstileVisible(false);
      Alert.alert("안전 확인 실패", "사람인지 확인을 다시 완료해주세요.");
      return;
    }
    await performPasswordReset(turnstileToken);
  }

  // 토큰 유무와 무관한 실제 재설정 요청.
  async function performPasswordReset(turnstileToken: string) {
    turnstileTokenRef.current = turnstileToken;
    setTurnstileVisible(false);
    setLoading(true);
    try {
      // 검증된 단일 사용 토큰만 보낸다. 서버 응답은 계정 열거 방지를 위해
      // 존재 여부와 무관하게 동일한 성공 형태를 유지한다.
      const res = await requestMobilePasswordReset(
        email.trim(),
        turnstileTokenRef.current,
      );

      if (!res.ok) {
        Alert.alert("오류", "발송에 실패했어요. 다시 시도해주세요.");
        return;
      }

      setSent(true);
    } catch {
      Alert.alert("오류", "발송에 실패했어요. 다시 시도해주세요.");
    } finally {
      turnstileTokenRef.current = "";
      setLoading(false);
    }
  }

  // 발송 완료 화면
  if (sent) {
    return (
      <SafeAreaView style={styles.container}>
        <Animated.View
          style={[
            styles.sentContent,
            {
              opacity: sentFadeAnim,
              transform: [{ translateY: sentSlideAnim }],
            },
          ]}
        >
          <CheckmarkAnimation />
          <Text style={styles.sentTitle}>이메일을 확인해주세요</Text>
          <Text style={styles.sentDesc}>
            {email}으로{"\n"}비밀번호 재설정 링크를 보냈어요.{"\n"}이메일을 확인해주세요.
          </Text>
          <Pressable
            style={styles.backBtn}
            onPress={() => router.back()}
            accessibilityLabel="로그인으로 돌아가기"
            accessibilityRole="button"
          >
            <Text style={styles.backBtnText}>로그인으로 돌아가기</Text>
          </Pressable>
        </Animated.View>
      </SafeAreaView>
    );
  }

  // 이메일 입력 폼
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
            <Text style={styles.brandTitle}>웨딩한방</Text>
          </Animated.View>

          {/* 폼 영역 */}
          <View style={styles.content}>
            <Text style={styles.title}>비밀번호 찾기</Text>
            <Text style={styles.desc}>
              가입할 때 사용한 이메일을 입력하면{"\n"}비밀번호 재설정 링크를 보내드려요.
            </Text>

            <Text style={styles.label}>이메일</Text>
            <TextInput
              style={[styles.input, emailInvalid && styles.inputError]}
              value={email}
              onChangeText={setEmail}
              onBlur={() => setEmailTouched(true)}
              placeholder="가입한 이메일 주소"
              placeholderTextColor={colors.taupe[400]}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              onSubmitEditing={handleReset}
              returnKeyType="go"
              editable={!loading}
              accessibilityLabel="이메일 입력"
            />
            {emailInvalid && (
              <Text style={styles.errorText}>올바른 이메일 형식을 입력해주세요</Text>
            )}

            <Pressable
              style={[styles.submitBtn, (!email.trim() || emailInvalid) && styles.submitBtnDisabled]}
              onPress={handleReset}
              disabled={!email.trim() || loading || emailInvalid || turnstileVisible}
              accessibilityLabel="비밀번호 재설정 링크 보내기"
              accessibilityRole="button"
            >
              {loading
                ? <ActivityIndicator color="#FFF" />
                : <Text style={styles.submitText}>비밀번호 재설정 링크 보내기</Text>
              }
            </Pressable>

            {/* 로그인으로 돌아가기 */}
            <Pressable
              style={styles.loginLink}
              onPress={() => router.back()}
              accessibilityLabel="로그인으로 돌아가기"
              accessibilityRole="button"
            >
              <Text style={styles.loginLinkText}>로그인으로 돌아가기</Text>
            </Pressable>
          </View>
        </ScrollView>
        </DismissKeyboard>
      </KeyboardAvoidingView>
      <TurnstileModal
        visible={turnstileVisible}
        siteKey={TURNSTILE_SITE_KEY}
        action="forgot"
        onVerify={submitResetWithTurnstile}
        onCancel={() => {
          turnstileTokenRef.current = "";
          setTurnstileVisible(false);
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scrollContent: { paddingHorizontal: 24, paddingBottom: 40 },

  // 로고
  brand: { alignItems: "center", paddingTop: 48, marginBottom: 36 },
  logo: {
    width: 88,
    height: 88,
    marginBottom: 16,
    borderRadius: 24,
    shadowColor: colors.paper.ink,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
  },
  brandTitle: {
    fontSize: 32,
    fontFamily: "NotoSerifKR_500Medium",
    color: colors.noir[800],
  },

  // 폼 영역
  content: {},
  title: {
    fontSize: 26,
    fontFamily: "NotoSerifKR_500Medium",
    color: colors.noir[800],
    marginBottom: 12,
  },
  desc: {
    fontSize: 15,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
    lineHeight: 24,
    marginBottom: 28,
  },
  label: {
    fontSize: 14,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.noir[800],
    marginBottom: 8,
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
  },
  inputError: { borderColor: colors.danger },
  errorText: {
    fontSize: 12,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.danger,
    marginTop: 6,
    marginLeft: 4,
  },
  submitBtn: {
    height: 52,
    borderRadius: 16,
    backgroundColor: colors.noir[800],
    alignItems: "center",
    justifyContent: "center",
    marginTop: 24,
    shadowColor: colors.paper.ink,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  submitBtnDisabled: { opacity: 0.4 },
  submitText: {
    fontSize: 16,
    fontFamily: "NotoSansKR_600SemiBold",
    color: "#FFF",
  },

  // 로그인 돌아가기 링크
  loginLink: {
    alignItems: "center",
    marginTop: 16,
    paddingVertical: 8,
  },
  loginLinkText: {
    fontSize: 13,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
  },

  // 발송 완료
  sentContent: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  checkCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.rose[500],
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 28,
    shadowColor: colors.rose[500],
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 4,
  },
  sentTitle: {
    fontSize: 22,
    fontFamily: "NotoSerifKR_500Medium",
    color: colors.noir[800],
    marginBottom: 12,
  },
  sentDesc: {
    fontSize: 14,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 32,
  },
  backBtn: {
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: colors.noir[800],
    shadowColor: colors.paper.ink,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  backBtnText: {
    fontSize: 15,
    fontFamily: "NotoSansKR_600SemiBold",
    color: "#FFF",
  },
});
