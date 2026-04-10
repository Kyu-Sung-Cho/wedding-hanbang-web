// 비밀번호 찾기 — 이메일로 재설정 링크 발송
import { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, Alert, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { ArrowLeft, Mail } from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";
import { supabase } from "@/lib/supabase";

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleReset() {
    if (!email.trim()) {
      Alert.alert("알림", "이메일을 입력해주세요.");
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${process.env.EXPO_PUBLIC_SITE_URL || "https://hanbang.ai"}/reset-password`,
      });

      if (error) {
        Alert.alert("오류", error.message);
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
        <View style={styles.sentContent}>
          <View style={styles.iconCircle}>
            <Mail size={32} color={colors.rose[500]} />
          </View>
          <Text style={styles.sentTitle}>이메일을 보냈어요</Text>
          <Text style={styles.sentDesc}>
            {email}으로 비밀번호 재설정 링크를 보냈어요.{"\n"}이메일을 확인해주세요.
          </Text>
          <Pressable style={styles.backBtn} onPress={() => router.back()}>
            <Text style={styles.backBtnText}>로그인으로 돌아가기</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
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
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          placeholder="example@email.com"
          placeholderTextColor={colors.taupe[400]}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
        />

        <Pressable
          style={[styles.submitBtn, !email.trim() && styles.submitBtnDisabled]}
          onPress={handleReset}
          disabled={!email.trim() || loading}
        >
          {loading
            ? <ActivityIndicator color="#FFF" />
            : <Text style={styles.submitText}>재설정 메일 보내기</Text>
          }
        </Pressable>
      </View>
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
  desc: { fontSize: 15, color: colors.textSecondary, lineHeight: 24, marginBottom: 28 },
  label: { fontSize: 14, fontWeight: "600", color: colors.noir[800], marginBottom: 8 },
  input: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    fontSize: 15,
    color: colors.noir[800],
  },
  submitBtn: {
    height: 56,
    borderRadius: 16,
    backgroundColor: colors.noir[800],
    alignItems: "center",
    justifyContent: "center",
    marginTop: 24,
  },
  submitBtnDisabled: { opacity: 0.4 },
  submitText: { fontSize: 16, fontWeight: "600", color: "#FFF" },

  // 발송 완료
  sentContent: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.ivory[200],
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
  },
  sentTitle: { fontSize: 22, fontWeight: "600", color: colors.noir[800], marginBottom: 12 },
  sentDesc: { fontSize: 14, color: colors.textSecondary, textAlign: "center", lineHeight: 22, marginBottom: 32 },
  backBtn: {
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: colors.noir[800],
  },
  backBtnText: { fontSize: 15, fontWeight: "600", color: "#FFF" },
});
