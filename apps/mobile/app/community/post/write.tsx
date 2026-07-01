// 글쓰기 화면 — 카테고리 + 광고표시 + 제목 + 내용 + 이미지 첨부 + 미리보기
import { useState } from "react";
import {
  View, Text, TextInput, ScrollView, StyleSheet, Pressable, Alert, ActivityIndicator, Image,
} from "react-native";
import DismissKeyboard from "@/components/DismissKeyboard";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { ChevronDown, Eye, Edit3, Check, ImagePlus, X } from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";
import { apiFetch } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import * as ImagePicker from "expo-image-picker";
import { AppHeader } from "@/components/ui/AppUI";

const CATEGORIES = [
  { key: "is_normal", label: "이거 정상이야?" },
  { key: "tour_review", label: "투어/이용 후기" },
  { key: "tips_v2", label: "꿀팁" },
  { key: "ama", label: "결혼 끝났다 AMA" },
  { key: "free", label: "자유게시판" },
];

const AD_OPTIONS = [
  { key: "general", label: "일반", desc: "직접 쓴 글", color: "#22C55E", bgColor: "rgba(34,197,94,0.08)" },
  { key: "sponsored", label: "협찬", desc: "혜택 받은 글", color: "#EAB308", bgColor: "rgba(234,179,8,0.08)" },
  { key: "ad", label: "광고", desc: "업체 공식 광고", color: "#EF4444", bgColor: "rgba(239,68,68,0.08)" },
];

const TITLE_MAX = 200;
const CONTENT_MAX = 50000;
const MAX_IMAGES = 5;
const UPLOAD_URL = "https://hanbang.ai/api/community/upload";

interface SelectedImage {
  uri: string;
  fileName: string;
  mimeType: string;
}

export default function WritePostScreen() {
  const [category, setCategory] = useState("");
  const [adDisclosure, setAdDisclosure] = useState("general");
  const [sponsorDetail, setSponsorDetail] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [isPreview, setIsPreview] = useState(false);
  const [images, setImages] = useState<SelectedImage[]>([]);
  const [uploadProgress, setUploadProgress] = useState("");

  // 갤러리에서 이미지 선택
  async function pickImages() {
    if (images.length >= MAX_IMAGES) {
      Alert.alert("알림", `이미지는 최대 ${MAX_IMAGES}장까지 첨부할 수 있어요.`);
      return;
    }

    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("권한 필요", "사진 접근 권한을 허용해주세요.");
      return;
    }

    const remaining = MAX_IMAGES - images.length;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      quality: 0.8,
    });

    if (result.canceled || result.assets.length === 0) return;

    const newImages: SelectedImage[] = result.assets.map((asset) => ({
      uri: asset.uri,
      fileName: asset.fileName || `image_${Date.now()}.jpg`,
      mimeType: asset.mimeType || "image/jpeg",
    }));

    setImages((prev) => [...prev, ...newImages].slice(0, MAX_IMAGES));
  }

  // 선택된 이미지 제거
  function removeImage(index: number) {
    setImages((prev) => prev.filter((_, i) => i !== index));
  }

  // 이미지 업로드 — Bearer 토큰으로 인증, FormData 전송
  async function uploadImages(): Promise<string[]> {
    if (images.length === 0) return [];

    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("로그인이 필요합니다.");

    const urls: string[] = [];

    for (let i = 0; i < images.length; i++) {
      setUploadProgress(`${i + 1}/${images.length} 업로드 중...`);

      const img = images[i];
      const formData = new FormData();
      formData.append("file", {
        uri: img.uri,
        name: img.fileName,
        type: img.mimeType,
      } as unknown as Blob);

      const res = await fetch(UPLOAD_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `이미지 업로드 실패 (${i + 1}번째)`);
      }

      const { url } = await res.json();
      urls.push(url);
    }

    setUploadProgress("");
    return urls;
  }

  async function handleSubmit() {
    if (!category) { Alert.alert("알림", "카테고리를 선택해주세요."); return; }
    if (!title.trim()) { Alert.alert("알림", "제목을 입력해주세요."); return; }
    if (!content.trim()) { Alert.alert("알림", "내용을 입력해주세요."); return; }
    if (adDisclosure === "sponsored" && sponsorDetail.trim().length < 5) {
      Alert.alert("알림", "협찬 내용을 5자 이상 입력해주세요."); return;
    }

    setSubmitting(true);
    try {
      // 이미지 업로드
      const imageUrls = await uploadImages();

      const res = await apiFetch("/api/community/posts", {
        method: "POST",
        body: JSON.stringify({
          category,
          title: title.trim(),
          content: content.trim(),
          visibility: "public",
          ad_disclosure: adDisclosure,
          sponsorship_detail: adDisclosure === "sponsored" ? sponsorDetail.trim() : undefined,
          ...(imageUrls.length > 0 && { images: imageUrls }),
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "게시글 작성에 실패했어요");
      }

      Alert.alert("완료", "게시글이 작성되었어요!", [
        { text: "확인", onPress: () => router.back() },
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "작성에 실패했어요";
      // 영문 Supabase 에러 번역
      const translated = msg.includes("duplicate")
        ? "이미 동일한 글이 존재합니다."
        : msg.includes("permission")
          ? "권한이 없습니다. 다시 로그인해주세요."
          : msg.includes("network")
            ? "네트워크 오류가 발생했어요. 인터넷 연결을 확인해주세요."
            : msg;
      Alert.alert("오류", translated);
    } finally {
      setSubmitting(false);
    }
  }

  const selectedCat = CATEGORIES.find((c) => c.key === category);
  const selectedAd = AD_OPTIONS.find((a) => a.key === adDisclosure);

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <AppHeader
        title="글쓰기"
        onBack={() => router.back()}
        sideWidth={72}
        right={
          <Pressable
            onPress={handleSubmit}
            disabled={submitting}
            accessibilityRole="button"
            accessibilityLabel="게시글 발행"
            style={({ pressed }) => [
              styles.publishButton,
              submitting && styles.publishButtonDisabled,
              pressed && !submitting && { transform: [{ scale: 0.96 }] },
            ]}
          >
            {submitting ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <Text style={styles.publishButtonText}>발행</Text>
            )}
          </Pressable>
        }
      />

      {/* 탭: 작성/미리보기 */}
      <View style={styles.tabRow}>
        <Pressable
          style={[styles.tab, !isPreview && styles.tabActive]}
          onPress={() => setIsPreview(false)}
        >
          <Edit3 size={14} color={!isPreview ? colors.rose[500] : colors.textTertiary} />
          <Text style={[styles.tabText, !isPreview && styles.tabTextActive]}>작성</Text>
        </Pressable>
        <Pressable
          style={[styles.tab, isPreview && styles.tabActive]}
          onPress={() => setIsPreview(true)}
        >
          <Eye size={14} color={isPreview ? colors.rose[500] : colors.textTertiary} />
          <Text style={[styles.tabText, isPreview && styles.tabTextActive]}>미리보기</Text>
        </Pressable>
      </View>

      {isPreview ? (
        /* 미리보기 모드 */
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.previewContent}>
          {selectedAd && selectedAd.key !== "general" && (
            <View style={[styles.previewAdBadge, { backgroundColor: selectedAd.bgColor }]}>
              <View style={[styles.adDot, { backgroundColor: selectedAd.color }]} />
              <Text style={[styles.previewAdText, { color: selectedAd.color }]}>{selectedAd.label}</Text>
            </View>
          )}
          <View style={styles.previewCatBadge}>
            <Text style={styles.previewCatText}>{selectedCat?.label ?? "카테고리 미선택"}</Text>
          </View>
          <Text style={styles.previewTitle}>{title || "제목을 입력해주세요"}</Text>
          <Text style={styles.previewBody}>{content || "내용을 입력해주세요"}</Text>
          {images.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.previewThumbRow}
              contentContainerStyle={styles.thumbRowContent}
            >
              {images.map((img) => (
                <Image key={img.uri} source={{ uri: img.uri }} style={styles.previewThumb} />
              ))}
            </ScrollView>
          )}
        </ScrollView>
      ) : (
        /* 작성 모드 */
        <DismissKeyboard>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {/* 카테고리 선택 */}
          <Text style={styles.fieldLabel}>카테고리</Text>
          <Pressable
            style={({ pressed }) => [
              styles.picker,
              pressed && { borderColor: colors.rose[500] },
            ]}
            onPress={() => setShowCategoryPicker(!showCategoryPicker)}
          >
            <Text style={selectedCat ? styles.pickerValue : styles.pickerPlaceholder}>
              {selectedCat?.label ?? "카테고리를 선택해주세요"}
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
                  <Text style={[styles.pickerOptionText, category === cat.key && { color: colors.rose[500], fontWeight: "600" }]}>
                    {cat.label}
                  </Text>
                  {category === cat.key && <Check size={16} color={colors.rose[500]} />}
                </Pressable>
              ))}
            </View>
          )}

          {/* 광고 표시 — 라디오 카드 */}
          <Text style={styles.fieldLabel}>글 유형</Text>
          <View style={styles.adCardRow}>
            {AD_OPTIONS.map((ad) => {
              const isActive = adDisclosure === ad.key;
              return (
                <Pressable
                  key={ad.key}
                  style={[
                    styles.adCard,
                    isActive && { borderColor: ad.color, backgroundColor: ad.bgColor },
                  ]}
                  onPress={() => setAdDisclosure(ad.key)}
                >
                  <View style={[styles.adRadio, isActive && { borderColor: ad.color }]}>
                    {isActive && <View style={[styles.adRadioFill, { backgroundColor: ad.color }]} />}
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <View style={[styles.adDot, { backgroundColor: ad.color }]} />
                      <Text style={[styles.adCardLabel, isActive && { color: ad.color }]}>{ad.label}</Text>
                    </View>
                    <Text style={styles.adCardDesc}>{ad.desc}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>

          {/* 협찬 상세 */}
          {adDisclosure === "sponsored" && (
            <View>
              <Text style={styles.fieldLabel}>협찬 내용</Text>
              <TextInput
                style={styles.input}
                value={sponsorDetail}
                onChangeText={setSponsorDetail}
                placeholder="어떤 혜택을 받았나요? (5자 이상)"
                placeholderTextColor={colors.taupe[400]}
              />
            </View>
          )}

          {/* 제목 */}
          <Text style={styles.fieldLabel}>제목</Text>
          <TextInput
            style={styles.titleInput}
            value={title}
            onChangeText={setTitle}
            placeholder="제목을 입력하세요"
            placeholderTextColor={colors.taupe[400]}
            maxLength={TITLE_MAX}
          />
          <Text style={styles.charCount}>
            {title.length}/{TITLE_MAX}
          </Text>

          {/* 내용 */}
          <Text style={styles.fieldLabel}>내용</Text>
          <TextInput
            style={styles.contentInput}
            value={content}
            onChangeText={setContent}
            placeholder="내용을 입력하세요..."
            placeholderTextColor={colors.taupe[400]}
            multiline
            textAlignVertical="top"
            maxLength={CONTENT_MAX}
          />
          <Text style={styles.charCount}>
            {content.length.toLocaleString()}/{CONTENT_MAX.toLocaleString()}
          </Text>

          {/* 이미지 첨부 */}
          <Text style={styles.fieldLabel}>사진 첨부</Text>
          <Pressable
            style={({ pressed }) => [
              styles.imagePickerBtn,
              pressed && { borderColor: colors.rose[500] },
            ]}
            onPress={pickImages}
          >
            <ImagePlus size={20} color={colors.rose[500]} />
            <Text style={styles.imagePickerText}>
              사진 추가 ({images.length}/{MAX_IMAGES})
            </Text>
          </Pressable>

          {/* 선택된 이미지 썸네일 */}
          {images.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.thumbRow}
              contentContainerStyle={styles.thumbRowContent}
            >
              {images.map((img, idx) => (
                <View key={img.uri} style={styles.thumbWrapper}>
                  <Image source={{ uri: img.uri }} style={styles.thumb} />
                  <Pressable
                    style={styles.thumbRemove}
                    onPress={() => removeImage(idx)}
                    hitSlop={8}
                  >
                    <X size={12} color="#FFF" />
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          )}

          {/* 업로드 진행 상태 */}
          {uploadProgress !== "" && (
            <View style={styles.uploadProgressRow}>
              <ActivityIndicator size="small" color={colors.rose[500]} />
              <Text style={styles.uploadProgressText}>{uploadProgress}</Text>
            </View>
          )}
        </ScrollView>
        </DismissKeyboard>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  publishButton: {
    backgroundColor: colors.noir[800],
    minWidth: 56,
    minHeight: 36,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  publishButtonDisabled: {
    opacity: 0.5,
  },
  publishButtonText: { fontSize: 14, fontWeight: "600", color: "#FFFFFF" },

  // 탭
  tabRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
  },
  tabActive: {
    borderBottomWidth: 2,
    borderBottomColor: colors.rose[500],
  },
  tabText: { fontSize: 14, color: colors.textTertiary },
  tabTextActive: { color: colors.rose[500], fontWeight: "600" },

  content: { padding: 20, gap: 4, paddingBottom: 40 },

  fieldLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.textSecondary,
    marginBottom: 8,
    marginTop: 16,
  },

  picker: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 14,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
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
    marginTop: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 3,
  },
  pickerOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  pickerOptionActive: { backgroundColor: colors.rose.glow },
  pickerOptionText: { fontSize: 14, color: colors.noir[800] },

  // 광고 라디오 카드
  adCardRow: { gap: 8 },
  adCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  adRadio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.taupe[400],
    alignItems: "center",
    justifyContent: "center",
  },
  adRadioFill: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  adDot: { width: 8, height: 8, borderRadius: 4 },
  adCardLabel: { fontSize: 14, fontWeight: "600", color: colors.noir[800] },
  adCardDesc: { fontSize: 12, color: colors.textTertiary, marginTop: 2 },

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
  charCount: {
    fontSize: 12,
    color: colors.textTertiary,
    textAlign: "right",
    marginTop: 4,
    fontFamily: "CormorantGaramond_400Regular",
  },

  // 이미지 첨부
  imagePickerBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 14,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderStyle: "dashed",
  },
  imagePickerText: {
    fontSize: 14,
    fontWeight: "500",
    color: colors.rose[500],
  },
  thumbRow: {
    marginTop: 12,
    flexGrow: 0,
  },
  thumbRowContent: {
    gap: 10,
  },
  thumbWrapper: {
    position: "relative",
  },
  thumb: {
    width: 80,
    height: 80,
    borderRadius: 12,
    backgroundColor: colors.ivory[200],
  },
  thumbRemove: {
    position: "absolute",
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
  },
  uploadProgressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 12,
  },
  uploadProgressText: {
    fontSize: 13,
    color: colors.rose[500],
    fontWeight: "500",
  },

  // 미리보기
  previewContent: { padding: 20, paddingBottom: 40 },
  previewAdBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    marginBottom: 12,
  },
  previewAdText: { fontSize: 13, fontWeight: "700" },
  previewCatBadge: {
    alignSelf: "flex-start",
    backgroundColor: colors.rose.glow,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    marginBottom: 12,
  },
  previewCatText: { fontSize: 13, fontWeight: "600", color: colors.rose[500] },
  previewTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: colors.noir[800],
    lineHeight: 34,
    marginBottom: 16,
    fontFamily: "NotoSerifKR_500Medium",
  },
  previewBody: {
    fontSize: 15,
    color: colors.noir[800],
    lineHeight: 28,
  },
  previewThumbRow: {
    marginTop: 20,
    flexGrow: 0,
  },
  previewThumb: {
    width: 120,
    height: 120,
    borderRadius: 12,
    backgroundColor: colors.ivory[200],
  },
});
