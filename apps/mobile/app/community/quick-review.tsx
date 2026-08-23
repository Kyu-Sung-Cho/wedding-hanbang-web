// 15초 후기 작성
import { useState } from "react";
import {
  View, Text, TextInput, ScrollView, StyleSheet, Pressable,
  Alert, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Star } from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";
import { PLANNING_CATEGORY_LABELS } from "@hanbang/shared/constants";
import { apiFetch } from "@/lib/api";
import { AppHeader, PrimaryButton } from "@/components/ui/AppUI";
import { toKoreanErrorMessage } from "@/lib/errorCopy";

const CATEGORIES = [
  { key: "venue", label: PLANNING_CATEGORY_LABELS.venue },
  { key: "studio", label: PLANNING_CATEGORY_LABELS.studio },
  { key: "dress", label: PLANNING_CATEGORY_LABELS.dress },
  { key: "makeup", label: PLANNING_CATEGORY_LABELS.makeup },
  { key: "snap", label: PLANNING_CATEGORY_LABELS.snap },
  { key: "ring", label: PLANNING_CATEGORY_LABELS.ring },
  { key: "honeymoon", label: PLANNING_CATEGORY_LABELS.honeymoon },
  { key: "bouquet", label: PLANNING_CATEGORY_LABELS.bouquet },
  { key: "invitation", label: PLANNING_CATEGORY_LABELS.invitation },
  { key: "other", label: "기타" },
];

const AD_OPTIONS = [
  { key: "general", label: "일반" },
  { key: "sponsored", label: "협찬" },
  { key: "ad", label: "광고" },
];

const REVIEW_MAX = 100;

export default function QuickReviewScreen() {
  const [vendorName, setVendorName] = useState("");
  const [category, setCategory] = useState("");
  const [rating, setRating] = useState(0);
  const [review, setReview] = useState("");
  const [adDisclosure, setAdDisclosure] = useState("general");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!vendorName.trim()) { Alert.alert("알림", "업체명을 입력해주세요."); return; }
    if (!category) { Alert.alert("알림", "카테고리를 선택해주세요."); return; }
    if (rating === 0) { Alert.alert("알림", "별점을 선택해주세요."); return; }
    if (!review.trim()) { Alert.alert("알림", "한줄 후기를 입력해주세요."); return; }

    setSubmitting(true);
    try {
      const res = await apiFetch("/api/community/posts", {
        method: "POST",
        body: JSON.stringify({
          category: "tour_review",
          title: `${vendorName.trim()} 후기`,
          content: review.trim(),
          visibility: "public",
          is_quick_review: true,
          rating,
          ad_disclosure: adDisclosure,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "후기 작성에 실패했어요");
      }

      Alert.alert("완료", "15초 후기가 등록되었어요!", [
        { text: "확인", onPress: () => router.back() },
      ]);
    } catch (err) {
      Alert.alert("오류", toKoreanErrorMessage(err, "후기를 올리지 못했어요. 잠시 뒤 다시 시도해 주세요."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={s.container} edges={["top"]}>
      <AppHeader title="15초 후기" onBack={() => router.back()} />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
      >
        {/* 업체명 */}
        <Text style={s.label}>업체명</Text>
        <TextInput
          style={s.input}
          value={vendorName}
          onChangeText={setVendorName}
          placeholder="업체 이름을 입력하세요"
          placeholderTextColor={colors.taupe[400]}
        />

        {/* 카테고리 */}
        <Text style={s.label}>카테고리</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chipScroll}>
          <View style={s.chipRow}>
            {CATEGORIES.map((cat) => (
              <Pressable
                key={cat.key}
                style={[s.chip, category === cat.key && s.chipActive]}
                onPress={() => setCategory(cat.key)}
              >
                <Text style={[s.chipText, category === cat.key && s.chipTextActive]}>
                  {cat.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>

        {/* 별점 */}
        <Text style={s.label}>별점</Text>
        <View style={s.starRow}>
          {[1, 2, 3, 4, 5].map((n) => (
            <Pressable key={n} onPress={() => setRating(n)} hitSlop={4}>
              <Star
                size={36}
                color={n <= rating ? colors.gold.DEFAULT : colors.taupe[400]}
                fill={n <= rating ? colors.gold.DEFAULT : "none"}
              />
            </Pressable>
          ))}
          {rating > 0 && (
            <Text style={s.ratingNum}>{rating}.0</Text>
          )}
        </View>

        {/* 한줄 후기 */}
        <Text style={s.label}>한줄 후기</Text>
        <TextInput
          style={s.input}
          value={review}
          onChangeText={(t) => setReview(t.slice(0, REVIEW_MAX))}
          placeholder="한 줄로 후기를 남겨주세요"
          placeholderTextColor={colors.taupe[400]}
          maxLength={REVIEW_MAX}
        />
        <Text style={s.charCount}>{review.length}/{REVIEW_MAX}</Text>

        {/* 광고 표시 */}
        <Text style={s.label}>글 유형</Text>
        <View style={s.adRow}>
          {AD_OPTIONS.map((ad) => {
            const active = adDisclosure === ad.key;
            return (
              <Pressable
                key={ad.key}
                style={[s.adChip, active && s.adChipActive]}
                onPress={() => setAdDisclosure(ad.key)}
              >
                <View style={[s.radio, active && s.radioActive]}>
                  {active && <View style={s.radioFill} />}
                </View>
                <Text style={[s.adChipText, active && s.adChipTextActive]}>{ad.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <PrimaryButton
          style={s.submitButton}
          onPress={handleSubmit}
          disabled={submitting}
          icon={submitting ? <ActivityIndicator size="small" color="#FFFFFF" /> : undefined}
        >
          {submitting ? "등록 중" : "후기 등록하기"}
        </PrimaryButton>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingBottom: 40 },

  label: {
    fontSize: 13,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.textSecondary,
    marginBottom: 8,
    marginTop: 20,
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.noir[800],
  },
  charCount: {
    fontSize: 12,
    fontFamily: "CormorantGaramond_400Regular",
    color: colors.textTertiary,
    textAlign: "right",
    marginTop: 4,
  },

  // 카테고리 칩
  chipScroll: { marginBottom: 4 },
  chipRow: { flexDirection: "row", gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: colors.ivory[200],
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: {
    backgroundColor: colors.noir[800],
    borderColor: colors.noir[800],
  },
  chipText: {
    fontSize: 13,
    fontFamily: "NotoSansKR_500Medium",
    color: colors.textSecondary,
  },
  chipTextActive: {
    color: "#FFFFFF",
  },

  // 별점
  starRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  ratingNum: {
    fontSize: 20,
    fontFamily: "CormorantGaramond_600SemiBold",
    color: colors.gold.DEFAULT,
    marginLeft: 8,
  },

  // 광고 유형
  adRow: { flexDirection: "row", gap: 10 },
  adChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  adChipActive: {
    borderColor: colors.rose[500],
    backgroundColor: colors.rose.glow,
  },
  adChipText: {
    fontSize: 14,
    fontFamily: "NotoSansKR_500Medium",
    color: colors.textSecondary,
  },
  adChipTextActive: {
    color: colors.rose[500],
  },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: colors.taupe[400],
    alignItems: "center",
    justifyContent: "center",
  },
  radioActive: {
    borderColor: colors.rose[500],
  },
  radioFill: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.rose[500],
  },

  submitButton: {
    marginTop: 32,
  },
});
