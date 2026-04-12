// 설정 화면 — 프로필/결혼정보 직접 편집
import { useEffect, useState, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Linking,
  Animated, Keyboard,
} from "react-native";
import DismissKeyboard from "@/components/DismissKeyboard";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { ArrowLeft, Save, ExternalLink, Check, User, Heart, Smartphone } from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";
import { supabase } from "@/lib/supabase";

interface SettingsData {
  userId: string;
  coupleId: string | null;
  nickname: string;
  role: string | null;
  weddingDate: string;
  venue: string;
  totalBudget: string;
}

export default function SettingsScreen() {
  const [data, setData] = useState<SettingsData | null>(null);
  const [initialData, setInitialData] = useState<SettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const checkScale = useRef(new Animated.Value(0)).current;

  // 현재 데이터 로드
  useEffect(() => {
    (async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;

        const { data: profile } = await supabase
          .from("profiles")
          .select("name, role, couple_id")
          .eq("id", user.id)
          .single();

        let weddingDate = "";
        let venue = "";
        let totalBudget = "";

        if (profile?.couple_id) {
          const { data: journey } = await supabase
            .from("wedding_journeys")
            .select("wedding_date, venue, total_budget")
            .eq("couple_id", profile.couple_id)
            .single();

          if (journey) {
            weddingDate = journey.wedding_date ?? "";
            venue = journey.venue ?? "";
            totalBudget = journey.total_budget
              ? String(journey.total_budget)
              : "";
          }
        }

        const loadedData: SettingsData = {
          userId: user.id,
          coupleId: profile?.couple_id ?? null,
          nickname: profile?.name ?? "",
          role: profile?.role ?? null,
          weddingDate,
          venue,
          totalBudget,
        };

        setData(loadedData);
        setInitialData(loadedData);
      } catch (err) {
        console.error("설정 로드 오류:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function updateField(field: keyof SettingsData, value: string) {
    setData((prev) => (prev ? { ...prev, [field]: value } : prev));
    setSaved(false);
  }

  // 변경 사항 감지
  const hasChanges = data && initialData && (
    data.nickname !== initialData.nickname ||
    data.weddingDate !== initialData.weddingDate ||
    data.venue !== initialData.venue ||
    data.totalBudget !== initialData.totalBudget
  );

  async function handleSave() {
    if (!data) return;
    setSaving(true);

    try {
      // 프로필 업데이트
      const { error: profileError } = await supabase
        .from("profiles")
        .update({ name: data.nickname })
        .eq("id", data.userId);

      if (profileError) throw profileError;

      // 결혼 정보 업데이트
      if (data.coupleId) {
        const budgetNum = data.totalBudget
          ? parseInt(data.totalBudget, 10)
          : null;

        const { error: journeyError } = await supabase
          .from("wedding_journeys")
          .update({
            wedding_date: data.weddingDate || null,
            venue: data.venue || null,
            total_budget:
              budgetNum && !isNaN(budgetNum) ? budgetNum : null,
          })
          .eq("couple_id", data.coupleId);

        if (journeyError) throw journeyError;
      }

      setInitialData(data);
      setSaved(true);

      // 체크마크 애니메이션
      Animated.sequence([
        Animated.spring(checkScale, { toValue: 1, friction: 3, useNativeDriver: true }),
        Animated.timing(checkScale, { toValue: 0, duration: 1500, delay: 1000, useNativeDriver: true }),
      ]).start(() => setSaved(false));
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "저장 중 오류가 발생했어요";
      // 영문 Supabase 에러 번역
      const translated = message.includes("permission")
        ? "권한이 없습니다. 다시 로그인해주세요."
        : message.includes("network")
          ? "네트워크 오류가 발생했어요."
          : message;
      Alert.alert("오류", translated);
    } finally {
      setSaving(false);
    }
  }

  const roleLabel =
    data?.role === "bride"
      ? "신부"
      : data?.role === "groom"
        ? "신랑"
        : data?.role ?? "-";

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <ArrowLeft size={24} color={colors.noir[800]} />
          </Pressable>
          <Text style={styles.headerTitle}>설정</Text>
          <View style={{ width: 24 }} />
        </View>
        <ActivityIndicator
          color={colors.rose[500]}
          style={{ marginTop: 40 }}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      {/* 헤더 */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <ArrowLeft size={24} color={colors.noir[800]} />
        </Pressable>
        <Text style={styles.headerTitle}>설정</Text>
        <View style={{ width: 24 }} />
      </View>

      <DismissKeyboard>
      <ScrollView contentContainerStyle={styles.content}>
        {/* 섹션 1: 프로필 */}
        <View style={styles.sectionHeader}>
          <User size={16} color={colors.rose[500]} />
          <Text style={styles.sectionTitle}>프로필</Text>
        </View>
        <View style={styles.card}>
          <View style={styles.field}>
            <Text style={styles.label}>닉네임</Text>
            <TextInput
              style={[
                styles.textInput,
                focusedField === "nickname" && styles.textInputFocused,
              ]}
              value={data?.nickname ?? ""}
              onChangeText={(v) => updateField("nickname", v)}
              placeholder="닉네임을 입력하세요"
              placeholderTextColor={colors.taupe[400]}
              maxLength={20}
              onFocus={() => setFocusedField("nickname")}
              onBlur={() => setFocusedField(null)}
            />
          </View>

          <View style={styles.divider} />

          <View style={styles.field}>
            <Text style={styles.label}>역할</Text>
            <View style={styles.readOnlyField}>
              <Text style={styles.readOnlyText}>{roleLabel}</Text>
            </View>
          </View>
        </View>

        {/* 섹션 2: 결혼 정보 */}
        <View style={styles.sectionHeader}>
          <Heart size={16} color={colors.rose[500]} />
          <Text style={styles.sectionTitle}>결혼 정보</Text>
        </View>
        <View style={styles.card}>
          <View style={styles.field}>
            <Text style={styles.label}>결혼 예정일</Text>
            <TextInput
              style={[
                styles.textInput,
                focusedField === "weddingDate" && styles.textInputFocused,
              ]}
              value={data?.weddingDate ?? ""}
              onChangeText={(v) => updateField("weddingDate", v)}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.taupe[400]}
              maxLength={10}
              keyboardType="numbers-and-punctuation"
              onFocus={() => setFocusedField("weddingDate")}
              onBlur={() => setFocusedField(null)}
            />
          </View>

          <View style={styles.divider} />

          <View style={styles.field}>
            <Text style={styles.label}>예식장</Text>
            <TextInput
              style={[
                styles.textInput,
                focusedField === "venue" && styles.textInputFocused,
              ]}
              value={data?.venue ?? ""}
              onChangeText={(v) => updateField("venue", v)}
              placeholder="예식장 이름"
              placeholderTextColor={colors.taupe[400]}
              maxLength={50}
              onFocus={() => setFocusedField("venue")}
              onBlur={() => setFocusedField(null)}
            />
          </View>

          <View style={styles.divider} />

          <View style={styles.field}>
            <Text style={styles.label}>총 예산 (만원)</Text>
            <TextInput
              style={[
                styles.textInput,
                focusedField === "totalBudget" && styles.textInputFocused,
              ]}
              value={data?.totalBudget ?? ""}
              onChangeText={(v) => updateField("totalBudget", v)}
              placeholder="예: 3000"
              placeholderTextColor={colors.taupe[400]}
              keyboardType="numeric"
              maxLength={12}
              onFocus={() => setFocusedField("totalBudget")}
              onBlur={() => setFocusedField(null)}
            />
          </View>
        </View>

        {/* 저장 버튼 */}
        <Pressable
          style={({ pressed }) => [
            styles.saveBtn,
            !hasChanges && !saved && styles.saveBtnDisabled,
            pressed && hasChanges && { transform: [{ scale: 0.98 }] },
          ]}
          onPress={handleSave}
          disabled={saving || !hasChanges}
        >
          {saving ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : saved ? (
            <Animated.View style={[styles.saveBtnContent, { transform: [{ scale: checkScale }] }]}>
              <Check size={18} color="#FFFFFF" />
              <Text style={styles.saveBtnText}>저장 완료</Text>
            </Animated.View>
          ) : (
            <View style={styles.saveBtnContent}>
              <Save size={18} color="#FFFFFF" />
              <Text style={styles.saveBtnText}>저장하기</Text>
            </View>
          )}
        </Pressable>

        {/* 섹션 3: 앱 */}
        <View style={styles.sectionHeader}>
          <Smartphone size={16} color={colors.rose[500]} />
          <Text style={styles.sectionTitle}>앱</Text>
        </View>
        <View style={styles.card}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>버전</Text>
            <Text style={styles.infoValue}>1.0.0</Text>
          </View>

          <View style={styles.divider} />

          <Pressable
            style={({ pressed }) => [styles.linkRow, pressed && { opacity: 0.6 }]}
            onPress={() => Linking.openURL("https://hanbang.ai/terms")}
          >
            <Text style={styles.linkText}>이용약관</Text>
            <ExternalLink size={16} color={colors.taupe[400]} />
          </Pressable>

          <View style={styles.divider} />

          <Pressable
            style={({ pressed }) => [styles.linkRow, pressed && { opacity: 0.6 }]}
            onPress={() => Linking.openURL("https://hanbang.ai/privacy")}
          >
            <Text style={styles.linkText}>개인정보처리방침</Text>
            <ExternalLink size={16} color={colors.taupe[400]} />
          </Pressable>
        </View>
      </ScrollView>
      </DismissKeyboard>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },

  // 헤더
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: colors.noir[800],
    fontFamily: "NotoSerifKR_500Medium",
  },

  content: { padding: 20, paddingBottom: 40 },

  // 섹션
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
    marginTop: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.noir[800],
    fontFamily: "NotoSerifKR_500Medium",
  },

  // 카드
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 20,
    padding: 16,
    marginBottom: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 2,
  },

  // 필드
  field: { gap: 6 },
  label: { fontSize: 13, fontWeight: "600", color: colors.textSecondary },
  textInput: {
    fontSize: 15,
    color: colors.noir[800],
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: colors.bg,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  textInputFocused: {
    borderColor: colors.rose[500],
  },
  readOnlyField: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: colors.ivory[200],
    borderRadius: 14,
  },
  readOnlyText: { fontSize: 15, color: colors.textSecondary },

  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: 14,
  },

  // 저장 버튼
  saveBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 16,
    borderRadius: 16,
    backgroundColor: colors.rose[500],
    marginBottom: 24,
  },
  saveBtnDisabled: {
    backgroundColor: colors.taupe[400],
    opacity: 0.5,
  },
  saveBtnContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  saveBtnText: { fontSize: 16, fontWeight: "600", color: "#FFFFFF" },

  // 정보 행
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 4,
  },
  infoLabel: { fontSize: 15, color: colors.noir[800] },
  infoValue: {
    fontSize: 15,
    color: colors.textSecondary,
    fontFamily: "CormorantGaramond_400Regular",
  },

  // 링크 행
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 4,
  },
  linkText: { fontSize: 15, color: colors.noir[800] },
});
