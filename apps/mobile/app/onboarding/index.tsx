// 온보딩 화면 — 4단계 (역할 → 커플 → 결혼 상세 → 완료)
import { useState } from "react";
import {
  View, Text, Pressable, TextInput, StyleSheet, ScrollView,
  Alert, ActivityIndicator, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { ArrowLeft, ArrowRight, Heart, User, Calendar, CheckCircle2 } from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";
import { apiFetch } from "@/lib/api";

type Role = "bride" | "groom";
type CoupleAction = "create" | "join";

export default function OnboardingScreen() {
  const [step, setStep] = useState(1);
  const [role, setRole] = useState<Role | null>(null);
  const [coupleAction, setCoupleAction] = useState<CoupleAction>("create");
  const [inviteCode, setInviteCode] = useState("");
  const [weddingDate, setWeddingDate] = useState("");
  const [weddingDateUndecided, setWeddingDateUndecided] = useState(false);
  const [venue, setVenue] = useState("");
  const [budget, setBudget] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resultCode, setResultCode] = useState("");

  const totalSteps = 4;

  function canNext(): boolean {
    switch (step) {
      case 1: return role !== null;
      case 2: return coupleAction === "create" || (coupleAction === "join" && inviteCode.length >= 6);
      case 3: return true;
      default: return false;
    }
  }

  async function handleSubmit() {
    setSubmitting(true);
    try {
      const res = await apiFetch("/api/onboarding", {
        method: "POST",
        body: JSON.stringify({
          role,
          coupleAction,
          partnerInviteCode: coupleAction === "join" ? inviteCode : undefined,
          weddingDate: weddingDateUndecided ? null : weddingDate || null,
          venue: venue || null,
          totalBudget: budget ? parseInt(budget) : 0,
          progress: {},
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        Alert.alert("오류", data.error ?? "저장에 실패했어요");
        return;
      }

      if (data.inviteCode && coupleAction === "create") {
        setResultCode(data.inviteCode);
        setStep(4);
      } else {
        router.replace("/(tabs)/dashboard");
      }
    } catch (err) {
      Alert.alert("오류", err instanceof Error ? err.message : "저장 실패");
    } finally {
      setSubmitting(false);
    }
  }

  function handleNext() {
    if (step === 3) {
      handleSubmit();
    } else if (step === 4) {
      router.replace("/(tabs)/dashboard");
    } else {
      setStep(step + 1);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* 헤더 */}
        <View style={styles.header}>
          {step > 1 && step < 4 ? (
            <Pressable onPress={() => setStep(step - 1)} hitSlop={12}>
              <ArrowLeft size={24} color={colors.noir[800]} />
            </Pressable>
          ) : <View style={{ width: 24 }} />}
          <Text style={styles.stepText}>{step}/{totalSteps}</Text>
          <View style={{ width: 24 }} />
        </View>

        {/* 진행 바 */}
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${(step / totalSteps) * 100}%` }]} />
        </View>

        {/* Step 1: 역할 */}
        {step === 1 && (
          <View style={styles.stepContent}>
            <Text style={styles.stepTitle}>반가워요!</Text>
            <Text style={styles.stepDesc}>결혼 준비에서의 역할을 알려주세요</Text>

            <View style={styles.roleRow}>
              <Pressable
                style={[styles.roleCard, role === "bride" && styles.roleCardActive]}
                onPress={() => setRole("bride")}
              >
                <Heart size={32} color={role === "bride" ? colors.rose[500] : colors.taupe[400]} />
                <Text style={[styles.roleLabel, role === "bride" && styles.roleLabelActive]}>신부</Text>
              </Pressable>
              <Pressable
                style={[styles.roleCard, role === "groom" && styles.roleCardActive]}
                onPress={() => setRole("groom")}
              >
                <User size={32} color={role === "groom" ? colors.rose[500] : colors.taupe[400]} />
                <Text style={[styles.roleLabel, role === "groom" && styles.roleLabelActive]}>신랑</Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* Step 2: 커플 연결 */}
        {step === 2 && (
          <View style={styles.stepContent}>
            <Text style={styles.stepTitle}>커플 연결</Text>
            <Text style={styles.stepDesc}>파트너와 함께 준비할 수 있어요</Text>

            <Pressable
              style={[styles.optionCard, coupleAction === "create" && styles.optionActive]}
              onPress={() => setCoupleAction("create")}
            >
              <Text style={styles.optionTitle}>새로 시작하기</Text>
              <Text style={styles.optionDesc}>초대코드를 받아 파트너에게 공유</Text>
            </Pressable>

            <Pressable
              style={[styles.optionCard, coupleAction === "join" && styles.optionActive]}
              onPress={() => setCoupleAction("join")}
            >
              <Text style={styles.optionTitle}>초대코드로 합류</Text>
              <Text style={styles.optionDesc}>파트너가 보낸 코드를 입력</Text>
            </Pressable>

            {coupleAction === "join" && (
              <TextInput
                style={styles.input}
                value={inviteCode}
                onChangeText={setInviteCode}
                placeholder="초대코드 (예: WH-ABC123)"
                placeholderTextColor={colors.taupe[400]}
                autoCapitalize="characters"
                maxLength={10}
              />
            )}
          </View>
        )}

        {/* Step 3: 결혼 상세 */}
        {step === 3 && (
          <View style={styles.stepContent}>
            <Text style={styles.stepTitle}>결혼 정보</Text>
            <Text style={styles.stepDesc}>나중에 변경할 수 있어요</Text>

            <Text style={styles.fieldLabel}>결혼 예정일</Text>
            {!weddingDateUndecided && (
              <TextInput
                style={styles.input}
                value={weddingDate}
                onChangeText={setWeddingDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.taupe[400]}
                keyboardType={Platform.OS === "ios" ? "numbers-and-punctuation" : "default"}
                maxLength={10}
              />
            )}
            <Pressable
              style={styles.checkRow}
              onPress={() => setWeddingDateUndecided(!weddingDateUndecided)}
            >
              {weddingDateUndecided
                ? <CheckCircle2 size={20} color={colors.rose[500]} />
                : <View style={styles.checkbox} />
              }
              <Text style={styles.checkLabel}>아직 정하지 않았어요</Text>
            </Pressable>

            <Text style={[styles.fieldLabel, { marginTop: 20 }]}>예식장</Text>
            <TextInput
              style={styles.input}
              value={venue}
              onChangeText={setVenue}
              placeholder="예식장 이름 (선택)"
              placeholderTextColor={colors.taupe[400]}
            />

            <Text style={[styles.fieldLabel, { marginTop: 20 }]}>총 예산 (만원)</Text>
            <TextInput
              style={styles.input}
              value={budget}
              onChangeText={setBudget}
              placeholder="예: 3000"
              placeholderTextColor={colors.taupe[400]}
              keyboardType="numeric"
            />
          </View>
        )}

        {/* Step 4: 완료 */}
        {step === 4 && (
          <View style={styles.stepContent}>
            <View style={styles.doneIcon}>
              <CheckCircle2 size={48} color={colors.rose[500]} />
            </View>
            <Text style={styles.stepTitle}>준비 완료!</Text>
            <Text style={styles.stepDesc}>웨딩한방과 함께 완벽한 결혼을 준비하세요</Text>

            {resultCode ? (
              <View style={styles.codeCard}>
                <Text style={styles.codeLabel}>파트너 초대코드</Text>
                <Text style={styles.codeValue}>{resultCode}</Text>
                <Text style={styles.codeHint}>이 코드를 파트너에게 보내주세요</Text>
              </View>
            ) : null}
          </View>
        )}
      </ScrollView>

      {/* 하단 버튼 */}
      <View style={styles.footer}>
        <Pressable
          style={[styles.nextBtn, !canNext() && step < 4 && styles.nextBtnDisabled]}
          onPress={handleNext}
          disabled={(!canNext() && step < 4) || submitting}
        >
          {submitting ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <>
              <Text style={styles.nextText}>
                {step === 3 ? "시작하기" : step === 4 ? "대시보드로 이동" : "다음"}
              </Text>
              {step < 4 && <ArrowRight size={20} color="#FFF" />}
            </>
          )}
        </Pressable>

        {step === 3 && (
          <Pressable onPress={handleSubmit} style={styles.skipBtn}>
            <Text style={styles.skipText}>건너뛰기</Text>
          </Pressable>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 24, paddingBottom: 120 },

  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 16,
  },
  stepText: { fontSize: 14, color: colors.textTertiary, fontWeight: "500" },

  progressBar: { height: 4, backgroundColor: colors.ivory[200], borderRadius: 2, marginBottom: 32 },
  progressFill: { height: "100%", backgroundColor: colors.rose[500], borderRadius: 2 },

  stepContent: { paddingTop: 8 },
  stepTitle: {
    fontSize: 28,
    fontFamily: "NotoSerifKR_500Medium",
    color: colors.noir[800],
    marginBottom: 8,
  },
  stepDesc: { fontSize: 15, color: colors.textSecondary, marginBottom: 32, lineHeight: 22 },

  // Step 1: 역할
  roleRow: { flexDirection: "row", gap: 16 },
  roleCard: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 32,
    borderRadius: 24,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
    gap: 12,
  },
  roleCardActive: { borderColor: colors.rose[500], backgroundColor: colors.rose.pale + "30" },
  roleLabel: { fontSize: 16, fontWeight: "600", color: colors.textSecondary },
  roleLabelActive: { color: colors.rose[500] },

  // Step 2: 커플
  optionCard: {
    padding: 20,
    borderRadius: 20,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
    marginBottom: 12,
  },
  optionActive: { borderColor: colors.rose[500] },
  optionTitle: { fontSize: 16, fontWeight: "600", color: colors.noir[800], marginBottom: 4 },
  optionDesc: { fontSize: 13, color: colors.textSecondary },

  // Step 3: 상세
  fieldLabel: { fontSize: 14, fontWeight: "600", color: colors.noir[800], marginBottom: 8 },
  input: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    fontSize: 15,
    color: colors.noir[800],
    marginBottom: 8,
  },
  checkRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.taupe[400],
  },
  checkLabel: { fontSize: 14, color: colors.textSecondary },

  // Step 4: 완료
  doneIcon: { alignItems: "center", marginBottom: 24, marginTop: 40 },
  codeCard: {
    backgroundColor: colors.noir[800],
    borderRadius: 20,
    padding: 24,
    alignItems: "center",
    marginTop: 24,
  },
  codeLabel: { fontSize: 13, color: colors.taupe[400], marginBottom: 8 },
  codeValue: {
    fontSize: 28,
    fontFamily: "CormorantGaramond_600SemiBold",
    color: "#FFFFFF",
    letterSpacing: 2,
    marginBottom: 8,
  },
  codeHint: { fontSize: 12, color: colors.taupe[400] },

  // Footer
  footer: { padding: 24, gap: 12 },
  nextBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 56,
    borderRadius: 16,
    backgroundColor: colors.noir[800],
  },
  nextBtnDisabled: { opacity: 0.4 },
  nextText: { fontSize: 16, fontWeight: "600", color: "#FFFFFF" },
  skipBtn: { alignItems: "center", paddingVertical: 8 },
  skipText: { fontSize: 14, color: colors.textTertiary },
});
