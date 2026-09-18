// 15초 후기 작성
//
// 요청 모양은 `@/lib/communityQuickReview.mjs` 가 정한다. 예전 화면은 요청 키(Idempotency-Key)
// 없이 보내 서버가 모든 후기를 400 으로 거절했고, 「협찬」을 골라도 협찬 내용을 적을 곳이 없었다.
import { useRef, useState } from "react";
import { View, ScrollView, StyleSheet, Pressable, Alert, ActivityIndicator } from "react-native";
import { Text, TextInput } from "@/components/ui/AppText";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import * as Crypto from "expo-crypto";
import { Star } from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";
import { PLANNING_CATEGORY_LABELS } from "@hanbang/shared/constants";
import { apiFetch } from "@/lib/api";
import { AppHeader, PrimaryButton } from "@/components/ui/AppUI";
import { toKoreanErrorMessage } from "@/lib/errorCopy";
import {
  QUICK_REVIEW_SPONSORSHIP_DETAIL_MAX,
  createQuickReviewSubmission,
  readCreatedQuickReviewPostId,
  validateQuickReviewDraft,
  type QuickReviewAdDisclosure,
} from "@/lib/communityQuickReview.mjs";

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

const AD_OPTIONS: ReadonlyArray<{ key: QuickReviewAdDisclosure; label: string }> = [
  { key: "general", label: "일반" },
  { key: "sponsored", label: "협찬" },
  { key: "ad", label: "광고" },
];

const REVIEW_MAX = 100;
const VENDOR_NAME_MAX = 60;

export default function QuickReviewScreen() {
  const [vendorName, setVendorName] = useState("");
  const [category, setCategory] = useState("");
  const [rating, setRating] = useState(0);
  const [review, setReview] = useState("");
  const [adDisclosure, setAdDisclosure] = useState<QuickReviewAdDisclosure>("general");
  const [sponsorshipDetail, setSponsorshipDetail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // 응답만 잃은 경우 같은 내용은 같은 요청 키로 다시 보낸다 — 서버가 저장된 글을 돌려주고
  // 두 번 만들지 않는다.
  const submissionRef = useRef(createQuickReviewSubmission(() => Crypto.randomUUID())).current;

  async function handleSubmit() {
    if (submitting) return;
    const draft = { vendorName, category, rating, review, adDisclosure, sponsorshipDetail };
    const invalid = validateQuickReviewDraft(draft);
    if (invalid) { Alert.alert("알림", invalid); return; }

    setSubmitting(true);
    try {
      const command = submissionRef.commandFor(draft);
      const res = await apiFetch("/api/community/posts", {
        method: "POST",
        headers: { "Idempotency-Key": command.idempotencyKey },
        body: JSON.stringify(command.body),
      });
      const payload = await res.json().catch(() => null) as { error?: unknown } | null;

      if (!res.ok) {
        throw new Error(
          typeof payload?.error === "string" ? payload.error : "후기 작성에 실패했어요",
        );
      }
      // 서버 영수증에서 새 글 id 를 확인한 뒤에만 등록된 것으로 본다.
      const postId = readCreatedQuickReviewPostId(payload);
      if (!postId) {
        throw new Error("후기가 저장됐는지 확인하지 못했어요. 내용을 그대로 두었으니 다시 올려 주세요.");
      }
      submissionRef.clearIf(command.idempotencyKey);
      router.replace({ pathname: "/community/post/[id]", params: { id: postId } });
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
          maxLength={VENDOR_NAME_MAX}
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
                accessibilityRole="button"
                accessibilityState={{ selected: category === cat.key }}
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
                accessibilityRole="radio"
                accessibilityState={{ checked: active }}
              >
                <View style={[s.radio, active && s.radioActive]}>
                  {active && <View style={s.radioFill} />}
                </View>
                <Text style={[s.adChipText, active && s.adChipTextActive]}>{ad.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {/* 협찬 내용 — 서버와 웹이 5자 이상을 요구한다. 없으면 후기가 거절된다. */}
        {adDisclosure === "sponsored" && (
          <View>
            <Text style={s.label}>어떤 혜택을 받았나요?</Text>
            <TextInput
              style={[s.input, s.sponsorInput]}
              value={sponsorshipDetail}
              onChangeText={setSponsorshipDetail}
              placeholder="예: 드레스 입어보기 비용 1회 제공받음"
              placeholderTextColor={colors.taupe[400]}
              accessibilityLabel="받은 협찬 내용"
              maxLength={QUICK_REVIEW_SPONSORSHIP_DETAIL_MAX}
              multiline
              textAlignVertical="top"
            />
            <Text style={s.helper}>5자 이상 적어 주세요. 적은 내용은 글에 협찬 표시와 함께 보여요.</Text>
          </View>
        )}

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
  sponsorInput: {
    minHeight: 72,
  },
  helper: {
    fontSize: 12,
    lineHeight: 18,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
    marginTop: 6,
  },

  // 카테고리 칩
  chipScroll: { marginBottom: 4 },
  chipRow: { flexDirection: "row", gap: 8 },
  chip: {
    minHeight: 44,
    justifyContent: "center",
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
    minHeight: 44,
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
    color: colors.rose[700],
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
