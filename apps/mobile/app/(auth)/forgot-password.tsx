// 비밀번호 찾기 — 이메일로 재설정 링크 발송
import { useState, useEffect, useRef } from "react";
import { View, Pressable, StyleSheet, Alert, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Animated } from "react-native";
import { Text, TextInput } from "@/components/ui/AppText";
import DismissKeyboard from "@/components/DismissKeyboard";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Check } from "lucide-react-native";
import TurnstileModal from "@/components/auth/TurnstileModal";
import {
  InvitationAuthBackground,
  InvitationAuthCard,
  InvitationAuthHeader,
  authColors,
  authField,
  authText,
} from "@/components/invitation/InvitationAuthFrame";
import { palette, typo } from "@/components/invitation/invitationStyle";
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

// 체크마크 애니메이션 컴포넌트. 웹 비밀번호 재설정의 완료 표시와 같은 돌색 원·먹색 체크다.
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
      <Check size={28} color={palette.ink} strokeWidth={2.5} />
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

  // 2026-11-20 파운더 "로그인 페이지도 다 바꿔야": 로그인과 같은 바탕·amora·유리 카드에 넣는다(InvitationAuthFrame).
  // 재설정 요청·안전 확인·문장은 그대로이고, 바뀐 것은 겉모양뿐이다. "웨딩한방" 글자와 앱 아이콘은 amora 머리가 대신한다.

  // 발송 완료 화면
  if (sent) {
    return (
      <InvitationAuthBackground>
      <SafeAreaView style={styles.container}>
        <View style={styles.sentLayout}>
          <InvitationAuthHeader />
          <View style={styles.spacer} />
          <Animated.View
            style={{
              opacity: sentFadeAnim,
              transform: [{ translateY: sentSlideAnim }],
            }}
          >
            <InvitationAuthCard style={styles.sentCard}>
              <CheckmarkAnimation />
              <Text accessibilityRole="header" style={[authText.heading, styles.centerText]}>이메일을 확인해주세요</Text>
              <Text style={[authText.body, styles.centerText]}>
                {email}으로{"\n"}비밀번호 재설정 링크를 보냈어요.{"\n"}이메일을 확인해주세요.
              </Text>
              <Pressable
                style={[authField.primary, styles.sentButton]}
                onPress={() => router.back()}
                accessibilityLabel="로그인으로 돌아가기"
                accessibilityRole="button"
              >
                <Text style={authField.primaryText}>로그인으로 돌아가기</Text>
              </Pressable>
            </InvitationAuthCard>
          </Animated.View>
        </View>
      </SafeAreaView>
      </InvitationAuthBackground>
    );
  }

  // 이메일 입력 폼
  return (
    <InvitationAuthBackground>
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
          {/* 이름·한 줄·오브 — 페이드인 */}
          <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
            <InvitationAuthHeader />
          </Animated.View>
          <View style={styles.spacer} />

          {/* 폼 영역 */}
          <InvitationAuthCard>
            <Text accessibilityRole="header" style={authText.heading}>비밀번호 찾기</Text>
            <Text style={authText.body}>
              가입할 때 사용한 이메일을 입력하면{"\n"}비밀번호 재설정 링크를 보내드려요.
            </Text>

            <View>
              <Text style={styles.label}>이메일</Text>
              <TextInput
                style={[authField.input, emailInvalid && authField.inputError]}
                value={email}
                onChangeText={setEmail}
                onBlur={() => setEmailTouched(true)}
                placeholder="가입한 이메일 주소"
                placeholderTextColor={authColors.placeholder}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                onSubmitEditing={handleReset}
                returnKeyType="go"
                editable={!loading}
                accessibilityLabel="이메일 입력"
              />
              {emailInvalid && (
                <Text style={authText.error}>올바른 이메일 형식을 입력해주세요</Text>
              )}
            </View>

            <Pressable
              style={[authField.primary, (!email.trim() || emailInvalid) && styles.submitBtnDisabled]}
              onPress={handleReset}
              disabled={!email.trim() || loading || emailInvalid || turnstileVisible}
              accessibilityLabel="비밀번호 재설정 링크 보내기"
              accessibilityRole="button"
            >
              {loading
                ? <ActivityIndicator color={authColors.white} />
                : <Text style={authField.primaryText}>비밀번호 재설정 링크 보내기</Text>
              }
            </Pressable>

            {/* 로그인으로 돌아가기 */}
            <Pressable
              style={styles.loginLink}
              onPress={() => router.back()}
              accessibilityLabel="로그인으로 돌아가기"
              accessibilityRole="button"
            >
              <Text style={authText.link}>로그인으로 돌아가기</Text>
            </Pressable>
          </InvitationAuthCard>
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
    </InvitationAuthBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingHorizontal: 12, paddingBottom: 12 },
  spacer: { flexGrow: 1, minHeight: 16 },

  label: {
    ...typo.sansMedium,
    fontSize: 13,
    lineHeight: 18,
    color: palette.body,
    marginBottom: 8,
    marginLeft: 6,
  },
  submitBtnDisabled: { opacity: 0.4 },

  // 로그인 돌아가기 링크
  loginLink: {
    alignItems: "center",
    paddingVertical: 8,
  },

  // 발송 완료
  sentLayout: { flex: 1, paddingHorizontal: 12, paddingBottom: 12 },
  sentCard: { alignItems: "center" },
  centerText: { textAlign: "center" },
  sentButton: { alignSelf: "stretch" },
  checkCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: palette.stone,
    alignItems: "center",
    justifyContent: "center",
  },
});
