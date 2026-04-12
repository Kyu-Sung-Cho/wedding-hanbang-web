// 비밀번호 찾기 — 이메일로 재설정 링크 발송
import { useState, useEffect, useRef } from "react";
import {
  View, Text, TextInput, Pressable, StyleSheet, Alert,
  ActivityIndicator, Animated, Keyboard,
} from "react-native";
import DismissKeyboard from "@/components/DismissKeyboard";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { ArrowLeft, Mail, Check } from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";
import { supabase } from "@/lib/supabase";

// 이메일 유효성 검사
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// 에러 한국어 변환
function translateError(message: string): string {
  if (message.includes("rate limit")) return "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.";
  if (message.includes("not found")) return "등록되지 않은 이메일입니다.";
  return "발송에 실패했어요. 다시 시도해주세요.";
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

  // 발송 완료 화면 페이드인
  const sentFadeAnim = useRef(new Animated.Value(0)).current;
  const sentSlideAnim = useRef(new Animated.Value(20)).current;

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

    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${process.env.EXPO_PUBLIC_SITE_URL || "https://hanbang.ai"}/reset-password`,
      });

      if (error) {
        Alert.alert("오류", translateError(error.message));
        return;
      }

      setSent(true);
    } catch {
      Alert.alert("오류", "발송에 실패했어요. 다시 시도해주세요.");
    } finally {
      setLoading(false);
    }
  }

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
          <Text style={styles.sentTitle}>이메일을 보냈어요</Text>
          <Text style={styles.sentDesc}>
            {email}으로{"\n"}비밀번호 재설정 링크를 보냈어요.{"\n"}이메일을 확인해주세요.
          </Text>
          <Pressable style={styles.backBtn} onPress={() => router.back()}>
            <Text style={styles.backBtnText}>로그인으로 돌아가기</Text>
          </Pressable>
        </Animated.View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <DismissKeyboard>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <ArrowLeft size={24} color={colors.noir[800]} />
        </Pressable>
      </View>

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
        />
        {emailInvalid && (
          <Text style={styles.errorText}>올바른 이메일 형식을 입력해주세요</Text>
        )}

        <Pressable
          style={[styles.submitBtn, (!email.trim() || emailInvalid) && styles.submitBtnDisabled]}
          onPress={handleReset}
          disabled={!email.trim() || loading || emailInvalid}
        >
          {loading
            ? <ActivityIndicator color="#FFF" />
            : <Text style={styles.submitText}>재설정 메일 보내기</Text>
          }
        </Pressable>
      </View>
      </DismissKeyboard>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: 20, paddingVertical: 14 },
  content: { paddingHorizontal: 24, paddingTop: 12 },
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
    shadowColor: "#000",
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
