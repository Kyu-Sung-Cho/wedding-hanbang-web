// 설정 화면 — 프로필/결혼정보 직접 편집
import { useEffect, useState } from "react";
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
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { ArrowLeft, Save, ExternalLink } from "lucide-react-native";
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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

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

        setData({
          userId: user.id,
          coupleId: profile?.couple_id ?? null,
          nickname: profile?.name ?? "",
          role: profile?.role ?? null,
          weddingDate,
          venue,
          totalBudget,
        });
      } catch (err) {
        console.error("Settings load error:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function updateField(field: keyof SettingsData, value: string) {
    setData((prev) => (prev ? { ...prev, [field]: value } : prev));
  }

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

      Alert.alert("저장 완료", "설정이 저장되었어요.");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "저장 중 오류가 발생했어요";
      Alert.alert("오류", message);
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

      <ScrollView contentContainerStyle={styles.content}>
        {/* 섹션 1: 프로필 편집 */}
        <Text style={styles.sectionTitle}>프로필 편집</Text>
        <View style={styles.card}>
          <View style={styles.field}>
            <Text style={styles.label}>닉네임</Text>
            <TextInput
              style={styles.textInput}
              value={data?.nickname ?? ""}
              onChangeText={(v) => updateField("nickname", v)}
              placeholder="닉네임을 입력하세요"
              placeholderTextColor={colors.taupe[400]}
              maxLength={20}
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
        <Text style={styles.sectionTitle}>결혼 정보</Text>
        <View style={styles.card}>
          <View style={styles.field}>
            <Text style={styles.label}>결혼 예정일</Text>
            <TextInput
              style={styles.textInput}
              value={data?.weddingDate ?? ""}
              onChangeText={(v) => updateField("weddingDate", v)}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.taupe[400]}
              maxLength={10}
              keyboardType="numbers-and-punctuation"
            />
          </View>

          <View style={styles.divider} />

          <View style={styles.field}>
            <Text style={styles.label}>예식장</Text>
            <TextInput
              style={styles.textInput}
              value={data?.venue ?? ""}
              onChangeText={(v) => updateField("venue", v)}
              placeholder="예식장 이름"
              placeholderTextColor={colors.taupe[400]}
              maxLength={50}
            />
          </View>

          <View style={styles.divider} />

          <View style={styles.field}>
            <Text style={styles.label}>총 예산 (원)</Text>
            <TextInput
              style={styles.textInput}
              value={data?.totalBudget ?? ""}
              onChangeText={(v) => updateField("totalBudget", v)}
              placeholder="예: 30000000"
              placeholderTextColor={colors.taupe[400]}
              keyboardType="numeric"
              maxLength={12}
            />
          </View>
        </View>

        {/* 저장 버튼 */}
        <Pressable
          style={({ pressed }) => [
            styles.saveBtn,
            pressed && { opacity: 0.8 },
            saving && { opacity: 0.6 },
          ]}
          onPress={handleSave}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <>
              <Save size={18} color="#FFFFFF" />
              <Text style={styles.saveBtnText}>저장하기</Text>
            </>
          )}
        </Pressable>

        {/* 섹션 3: 앱 정보 */}
        <Text style={styles.sectionTitle}>앱 정보</Text>
        <View style={styles.card}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>버전</Text>
            <Text style={styles.infoValue}>1.0.0</Text>
          </View>

          <View style={styles.divider} />

          <Pressable
            style={styles.linkRow}
            onPress={() => Linking.openURL("https://hanbang.ai/terms")}
          >
            <Text style={styles.linkText}>이용약관</Text>
            <ExternalLink size={16} color={colors.taupe[400]} />
          </Pressable>

          <View style={styles.divider} />

          <Pressable
            style={styles.linkRow}
            onPress={() => Linking.openURL("https://hanbang.ai/privacy")}
          >
            <Text style={styles.linkText}>개인정보처리방침</Text>
            <ExternalLink size={16} color={colors.taupe[400]} />
          </Pressable>
        </View>
      </ScrollView>
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
  },

  content: { padding: 20, paddingBottom: 40 },

  // 섹션
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.noir[800],
    marginBottom: 12,
    marginTop: 8,
  },

  // 카드
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 20,
    padding: 16,
    marginBottom: 20,
  },

  // 필드
  field: { gap: 6 },
  label: { fontSize: 13, fontWeight: "500", color: colors.textSecondary },
  textInput: {
    fontSize: 15,
    color: colors.noir[800],
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: colors.bg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  readOnlyField: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: colors.ivory[200],
    borderRadius: 12,
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
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: colors.rose[500],
    marginBottom: 24,
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
  infoValue: { fontSize: 15, color: colors.textSecondary },

  // 링크 행
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 4,
  },
  linkText: { fontSize: 15, color: colors.noir[800] },
});
