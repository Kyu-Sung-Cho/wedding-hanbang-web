// 글쓰기 화면 — 카테고리 + 광고표시 + 제목 + 내용 + 이미지
import { useState } from "react";
import {
  View, Text, TextInput, ScrollView, StyleSheet, Pressable, Alert, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { ArrowLeft, ChevronDown } from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";
import { apiFetch } from "@/lib/api";

const CATEGORIES = [
  { key: "is_normal", label: "이거 정상이야?" },
  { key: "tour_review", label: "투어/이용 후기" },
  { key: "tips_v2", label: "꿀팁" },
  { key: "ama", label: "결혼 끝났다 AMA" },
  { key: "free", label: "자유게시판" },
];

const AD_OPTIONS = [
  { key: "general", label: "일반", desc: "직접 쓴 글", color: "#22C55E" },
  { key: "sponsored", label: "협찬", desc: "혜택 받은 글", color: "#EAB308" },
  { key: "ad", label: "광고", desc: "업체 공식 광고", color: "#EF4444" },
];

export default function WritePostScreen() {
  const [category, setCategory] = useState("");
  const [adDisclosure, setAdDisclosure] = useState("general");
  const [sponsorDetail, setSponsorDetail] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [showAdPicker, setShowAdPicker] = useState(false);

  async function handleSubmit() {
    if (!category) { Alert.alert("알림", "카테고리를 선택해주세요."); return; }
    if (!title.trim()) { Alert.alert("알림", "제목을 입력해주세요."); return; }
    if (!content.trim()) { Alert.alert("알림", "내용을 입력해주세요."); return; }
    if (adDisclosure === "sponsored" && sponsorDetail.trim().length < 5) {
      Alert.alert("알림", "협찬 내용을 5자 이상 입력해주세요."); return;
    }

    setSubmitting(true);
    try {
      const res = await apiFetch("/api/community/posts", {
        method: "POST",
        body: JSON.stringify({
          category,
          title: title.trim(),
          content: content.trim(),
          visibility: "public",
          ad_disclosure: adDisclosure,
          sponsorship_detail: adDisclosure === "sponsored" ? sponsorDetail.trim() : undefined,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "게시글 작성 실패");
      }

      Alert.alert("완료", "게시글이 작성되었어요!", [
        { text: "확인", onPress: () => router.back() },
      ]);
    } catch (err) {
      Alert.alert("오류", err instanceof Error ? err.message : "작성에 실패했어요");
    } finally {
      setSubmitting(false);
    }
  }

  const selectedCat = CATEGORIES.find((c) => c.key === category);
  const selectedAd = AD_OPTIONS.find((a) => a.key === adDisclosure);

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      {/* 헤더 */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <ArrowLeft size={24} color={colors.noir[800]} />
        </Pressable>
        <Text style={styles.headerTitle}>글쓰기</Text>
        <Pressable
          onPress={handleSubmit}
          disabled={submitting}
          style={[styles.submitBtn, submitting && { opacity: 0.5 }]}
        >
          {submitting
            ? <ActivityIndicator size="small" color="#FFF" />
            : <Text style={styles.submitText}>발행</Text>
          }
        </Pressable>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* 카테고리 선택 */}
        <Pressable style={styles.picker} onPress={() => setShowCategoryPicker(!showCategoryPicker)}>
          <Text style={selectedCat ? styles.pickerValue : styles.pickerPlaceholder}>
            {selectedCat?.label ?? "카테고리 선택"}
          </Text>
          <ChevronDown size={18} color={colors.textTertiary} />
        </Pressable>
        {showCategoryPicker && (
          <View style={styles.pickerDropdown}>
            {CATEGORIES.map((cat) => (
              <Pressable
                key={cat.key}
                style={[styles.pickerOption, category === cat.key && styles.pickerOptionActive]}
                onPress={() => { setCategory(cat.key); setShowCategoryPicker(false); }}
              >
                <Text style={[styles.pickerOptionText, category === cat.key && { color: colors.rose[500] }]}>
                  {cat.label}
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        {/* 광고 표시 */}
        <Pressable style={styles.picker} onPress={() => setShowAdPicker(!showAdPicker)}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View style={[styles.adDot, { backgroundColor: selectedAd?.color }]} />
            <Text style={styles.pickerValue}>{selectedAd?.label ?? "일반"}</Text>
          </View>
          <ChevronDown size={18} color={colors.textTertiary} />
        </Pressable>
        {showAdPicker && (
          <View style={styles.pickerDropdown}>
            {AD_OPTIONS.map((ad) => (
              <Pressable
                key={ad.key}
                style={[styles.pickerOption, adDisclosure === ad.key && styles.pickerOptionActive]}
                onPress={() => { setAdDisclosure(ad.key); setShowAdPicker(false); }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <View style={[styles.adDot, { backgroundColor: ad.color }]} />
                  <Text style={styles.pickerOptionText}>{ad.label}</Text>
                  <Text style={{ fontSize: 12, color: colors.textTertiary }}>— {ad.desc}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        )}

        {/* 협찬 상세 */}
        {adDisclosure === "sponsored" && (
          <TextInput
            style={styles.input}
            value={sponsorDetail}
            onChangeText={setSponsorDetail}
            placeholder="어떤 혜택을 받았나요? (5자 이상)"
            placeholderTextColor={colors.taupe[400]}
          />
        )}

        {/* 제목 */}
        <TextInput
          style={styles.titleInput}
          value={title}
          onChangeText={setTitle}
          placeholder="제목"
          placeholderTextColor={colors.taupe[400]}
          maxLength={200}
        />

        {/* 내용 */}
        <TextInput
          style={styles.contentInput}
          value={content}
          onChangeText={setContent}
          placeholder="내용을 입력하세요..."
          placeholderTextColor={colors.taupe[400]}
          multiline
          textAlignVertical="top"
          maxLength={50000}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: { fontSize: 18, fontWeight: "600", color: colors.noir[800] },
  submitBtn: {
    backgroundColor: colors.noir[800],
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 12,
  },
  submitText: { fontSize: 14, fontWeight: "600", color: "#FFFFFF" },

  content: { padding: 20, gap: 12, paddingBottom: 40 },

  picker: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 14,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pickerValue: { fontSize: 15, color: colors.noir[800] },
  pickerPlaceholder: { fontSize: 15, color: colors.taupe[400] },
  pickerDropdown: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
    marginTop: -4,
  },
  pickerOption: { padding: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  pickerOptionActive: { backgroundColor: colors.ivory[100] },
  pickerOptionText: { fontSize: 14, color: colors.noir[800] },

  adDot: { width: 8, height: 8, borderRadius: 4 },

  input: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    fontSize: 14,
    color: colors.noir[800],
  },
  titleInput: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    fontSize: 18,
    fontWeight: "600",
    color: colors.noir[800],
  },
  contentInput: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    fontSize: 15,
    color: colors.noir[800],
    minHeight: 200,
    lineHeight: 24,
  },
});
