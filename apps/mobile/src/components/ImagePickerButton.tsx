// 이미지 선택 + Supabase Storage 업로드 컴포넌트
import { useState } from "react";
import {
  View,
  Text,
  Pressable,
  Image,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Plus, X } from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";
import { apiFetch } from "@/lib/api";

interface ImagePickerButtonProps {
  images: string[];
  onChange: (urls: string[]) => void;
  max?: number;
}

export default function ImagePickerButton({
  images,
  onChange,
  max = 5,
}: ImagePickerButtonProps) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  async function handlePick() {
    if (images.length >= max) {
      Alert.alert("알림", `최대 ${max}장까지 업로드할 수 있어요.`);
      return;
    }

    // 권한 확인
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("권한 필요", "사진 접근 권한이 필요합니다.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 0.8,
    });

    if (result.canceled || !result.assets?.[0]) return;

    const asset = result.assets[0];
    setUploading(true);
    setProgress(0);

    try {
      const uri = asset.uri;
      const mimeType = asset.mimeType === "image/png" ||
        asset.mimeType === "image/webp" ||
        asset.mimeType === "image/jpeg"
        ? asset.mimeType
        : "image/jpeg";
      if (typeof asset.fileSize === "number" && asset.fileSize > 5 * 1024 * 1024) {
        throw new Error("이미지는 5MB 이하로 업로드할 수 있어요.");
      }
      const extension = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
      const fileName = asset.fileName?.slice(0, 120) || `community-image.${extension}`;
      const formData = new FormData();
      formData.append("file", {
        uri,
        name: fileName,
        type: mimeType,
      } as unknown as Blob);

      setProgress(0.3);
      const response = await apiFetch("/api/community/upload", {
        method: "POST",
        body: formData,
      });
      const payload = await response.json().catch(() => ({})) as { url?: string; error?: string };
      if (!response.ok || typeof payload.url !== "string") {
        throw new Error(payload.error || "이미지 업로드에 실패했어요.");
      }

      setProgress(1);
      onChange([...images, payload.url]);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "이미지 업로드에 실패했어요";
      Alert.alert("업로드 오류", message);
    } finally {
      setUploading(false);
      setProgress(0);
    }
  }

  function handleRemove(index: number) {
    const updated = images.filter((_, i) => i !== index);
    onChange(updated);
  }

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* 기존 이미지 썸네일 */}
        {images.map((uri, index) => (
          <View key={uri + index} style={styles.thumbnailWrap}>
            <Image source={{ uri }} style={styles.thumbnail} />
            <Pressable
              style={styles.removeBtn}
              onPress={() => handleRemove(index)}
              hitSlop={6}
            >
              <X size={12} color="#FFFFFF" />
            </Pressable>
          </View>
        ))}

        {/* 추가 버튼 */}
        {images.length < max && (
          <Pressable
            style={({ pressed }) => [
              styles.addBtn,
              pressed && { opacity: 0.7 },
            ]}
            onPress={handlePick}
            disabled={uploading}
          >
            {uploading ? (
              <View style={styles.uploadingWrap}>
                <ActivityIndicator size="small" color={colors.rose[500]} />
                <Text style={styles.progressText}>
                  {Math.round(progress * 100)}%
                </Text>
              </View>
            ) : (
              <>
                <Plus size={24} color={colors.taupe[400]} />
                <Text style={styles.addText}>
                  {images.length}/{max}
                </Text>
              </>
            )}
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginVertical: 8 },
  scrollContent: { gap: 10, paddingHorizontal: 2, paddingVertical: 2 },

  // 썸네일
  thumbnailWrap: { position: "relative" },
  thumbnail: {
    width: 80,
    height: 80,
    borderRadius: 12,
    backgroundColor: colors.ivory[200],
  },
  removeBtn: {
    position: "absolute",
    top: -4,
    right: -4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.noir[800],
    alignItems: "center",
    justifyContent: "center",
  },

  // 추가 버튼
  addBtn: {
    width: 80,
    height: 80,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: "dashed",
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  addText: { fontSize: 11, color: colors.taupe[400] },

  // 업로드 중
  uploadingWrap: { alignItems: "center", gap: 4 },
  progressText: { fontSize: 10, color: colors.rose[500], fontWeight: "600" },
});
