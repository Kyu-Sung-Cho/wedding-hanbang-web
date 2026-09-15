import { useEffect, useState } from "react";
import { Image, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { User } from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";
import { Text } from "@/components/ui/AppText";
import { supabase } from "@/lib/supabase";
import { profileAvatarDisplay } from "@/lib/profileAvatarPresentation.mjs";

// 웹 components/ui/ProfileAvatar.tsx 와 같은 표시다: 사진 → 이모지 → 이름 첫 글자.
// 개인 사진은 공개 주소가 없다. 로그인한 본인·연결된 상대만 Bearer 인증으로 읽는다.
const API_BASE = process.env.EXPO_PUBLIC_SITE_URL || "https://hanbang.ai";

type ProfileAvatarProps = {
  name?: string | null;
  avatarUrl?: string | null;
  /** avatarUrl 이 사진일 때 그 경로가 이 사람 것인지 확인하는 소유자 ID. */
  ownerId?: string | null;
  /** 저장 전 고른 사진의 기기 안 미리보기. 저장된 값으로 쓰지 않는다. */
  previewUri?: string | null;
  size?: number;
  /** 옆에 이름이 이미 읽히는 자리(채팅)는 스크린리더에서 숨긴다. */
  decorative?: boolean;
  style?: StyleProp<ViewStyle>;
};

export default function ProfileAvatar({ name, avatarUrl, ownerId, previewUri, size = 40, decorative = false, style }: ProfileAvatarProps) {
  const display = profileAvatarDisplay({ name, avatarUrl, ownerId });
  const photoPath = display.kind === "photo" ? display.path : null;
  const [photo, setPhoto] = useState<{ path: string; token: string } | null>(null);
  const [failedPath, setFailedPath] = useState<string | null>(null);

  useEffect(() => {
    if (!photoPath) {
      setPhoto(null);
      return;
    }
    let active = true;
    supabase.auth.getSession()
      .then(({ data }) => {
        const token = data.session?.access_token;
        if (active) setPhoto(token ? { path: photoPath, token } : null);
      })
      .catch(() => {
        if (active) setPhoto(null);
      });
    return () => {
      active = false;
    };
  }, [photoPath]);

  const frame = { width: size, height: size, borderRadius: size / 2 };
  const showStoredPhoto = !previewUri && photo !== null && photo.path === photoPath && failedPath !== photoPath;
  const initial = display.kind === "emoji" ? null : display.initial;

  return (
    <View
      style={[styles.frame, frame, style]}
      accessible={!decorative}
      accessibilityRole={decorative ? undefined : "image"}
      accessibilityLabel={decorative ? undefined : `${name?.trim() || "사용자"} 프로필`}
      accessibilityElementsHidden={decorative}
      importantForAccessibility={decorative ? "no-hide-descendants" : "auto"}
    >
      {previewUri ? (
        <Image source={{ uri: previewUri }} style={styles.fill} />
      ) : showStoredPhoto && photo ? (
        <Image
          source={{ uri: `${API_BASE}${photo.path}`, headers: { Authorization: `Bearer ${photo.token}` } }}
          style={styles.fill}
          onError={() => setFailedPath(photo.path)}
        />
      ) : display.kind === "emoji" ? (
        <Text style={{ fontSize: Math.round(size * 0.52), lineHeight: Math.round(size * 0.7) }}>{display.emoji}</Text>
      ) : initial === "?" ? (
        <User size={Math.round(size * 0.45)} color={colors.rose[700]} />
      ) : (
        <Text style={[styles.initial, { fontSize: Math.round(size * 0.42), lineHeight: Math.round(size * 0.58) }]}>{initial}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.rose.light,
    backgroundColor: colors.rose.pale,
  },
  fill: { width: "100%", height: "100%" },
  initial: {
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.rose[700],
  },
});
