import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { X } from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";
import { PROFILE_AVATAR_EMOJIS, isProfileAvatarEmoji } from "@hanbang/shared/profile-avatar";
import { Text } from "@/components/ui/AppText";
import ProfileAvatar from "@/components/ui/ProfileAvatar";
import { apiFetchForExpectedUser } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import {
  buildProfileAvatarJsonBody,
  isSavedProfileAvatarSelection,
  parseProfileAvatarResponse,
  profileAvatarKind,
  profileAvatarSaveErrorMessage,
  readProfileAvatarPhotoAsset,
  type ProfileAvatarKind,
  type ProfileAvatarPhotoUpload,
} from "@/lib/profileAvatarPresentation.mjs";

// 웹 settings/ProfileAvatarEditor.tsx 와 같은 선택지·같은 서버 경로(PUT /api/profile/avatar)다.
// 서버는 Bearer 요청을 신뢰 출처로 받고, 저장 직전에 expected_user_id 로 계정 전환을 한 번 더 막는다.
const REQUEST_TIMEOUT_MS = 30_000;
const KIND_OPTIONS: ReadonlyArray<{ kind: ProfileAvatarKind; label: string }> = [
  { kind: "initial", label: "기본 글자" },
  { kind: "emoji", label: "이모지" },
  { kind: "photo", label: "사진" },
];

type ProfileAvatarEditorSheetProps = {
  visible: boolean;
  ownerId: string;
  name: string | null;
  onClose: (saved: { avatarUrl: string | null } | null) => void;
};

async function isStillOwner(ownerId: string) {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id === ownerId;
}

function withTimeout(): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

export default function ProfileAvatarEditorSheet({ visible, ownerId, name, onClose }: ProfileAvatarEditorSheetProps) {
  const [baseline, setBaseline] = useState<string | null>(null);
  const [expectedRevision, setExpectedRevision] = useState<string | null>(null);
  const [kind, setKind] = useState<ProfileAvatarKind>("initial");
  const [emoji, setEmoji] = useState<string>(PROFILE_AVATAR_EMOJIS[0].emoji);
  const [photo, setPhoto] = useState<ProfileAvatarPhotoUpload | null>(null);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const inFlight = useRef(false);
  const openRef = useRef(false);

  useEffect(() => {
    openRef.current = visible;
    if (!visible) return;
    let cancelled = false;
    const request = withTimeout();
    setReady(false);
    setLoading(true);
    setError("");
    setPhoto(null);
    void (async () => {
      try {
        const response = await apiFetchForExpectedUser(ownerId, "/api/profile/avatar", { method: "GET", signal: request.signal });
        const data = parseProfileAvatarResponse(await response.json().catch(() => null), ownerId);
        if (cancelled) return;
        if (!response.ok || !data || !(await isStillOwner(ownerId))) throw new Error("unavailable");
        if (cancelled) return;
        setBaseline(data.avatar_url);
        setExpectedRevision(data.revision);
        setKind(profileAvatarKind(data.avatar_url));
        if (isProfileAvatarEmoji(data.avatar_url)) setEmoji(data.avatar_url as string);
        setReady(true);
      } catch {
        if (!cancelled) setError("프로필을 불러오지 못했어요. 다시 시도해 주세요.");
      } finally {
        request.clear();
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      request.clear();
    };
  }, [visible, ownerId, retry]);

  async function pickPhoto() {
    if (saving) return;
    setError("");
    try {
      // 시스템 사진 선택기는 앨범 전체 접근 권한 없이 고른 사진 한 장만 넘긴다.
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
      });
      if (!openRef.current || result.canceled || result.assets.length === 0) return;
      const read = readProfileAvatarPhotoAsset(result.assets[0]);
      if (!read.ok) {
        setError(read.message);
        return;
      }
      setPhoto(read.photo);
    } catch {
      setError("사진을 열지 못했어요. 다시 시도해 주세요.");
    }
  }

  async function save() {
    if (inFlight.current || !ready) return;
    if (kind === "photo" && !photo) return;
    inFlight.current = true;
    setSaving(true);
    setError("");
    const request = withTimeout();
    try {
      let body: FormData | string;
      let headers: Record<string, string> | undefined;
      if (kind === "photo" && photo) {
        const form = new FormData();
        // React Native FormData 는 { uri, name, type } 로 기기 안 파일을 첨부한다.
        form.append("photo", photo as unknown as Blob);
        form.append("expected_revision", expectedRevision ?? "null");
        form.append("expected_user_id", ownerId);
        body = form;
        // 경계(boundary)는 네이티브 네트워크 계층이 붙인다. 기본 JSON 헤더만 덮어쓴다.
        headers = { "Content-Type": "multipart/form-data" };
      } else {
        body = JSON.stringify(buildProfileAvatarJsonBody({
          kind: kind === "emoji" ? "emoji" : "initial",
          emoji,
          expectedRevision,
          ownerId,
        }));
      }
      const response = await apiFetchForExpectedUser(ownerId, "/api/profile/avatar", {
        method: "PUT",
        body,
        headers,
        signal: request.signal,
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const code = response.status === 429
          ? "RATE_LIMITED"
          : payload && typeof payload === "object" ? (payload as Record<string, unknown>).code : null;
        throw new Error(profileAvatarSaveErrorMessage(code));
      }
      const saved = parseProfileAvatarResponse(payload, ownerId, true);
      if (!isSavedProfileAvatarSelection({ kind, emoji }, saved) || !saved) {
        throw new Error(profileAvatarSaveErrorMessage(null));
      }
      if (!openRef.current || !(await isStillOwner(ownerId))) return;
      onClose({ avatarUrl: saved.avatar_url });
    } catch (failure) {
      if (!openRef.current) return;
      if (failure instanceof Error && failure.message === "API_SESSION_OWNER_MISMATCH") {
        setError(profileAvatarSaveErrorMessage("AVATAR_OWNER_CHANGED"));
      } else {
        setError(failure instanceof Error && failure.message.endsWith("주세요.") ? failure.message : profileAvatarSaveErrorMessage(null));
      }
    } finally {
      request.clear();
      inFlight.current = false;
      setSaving(false);
    }
  }

  const close = () => {
    if (!saving) onClose(null);
  };
  const previewAvatar = kind === "initial" ? null : kind === "emoji" ? emoji : baseline;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="프로필 꾸미기 닫기" />
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.title}>프로필 꾸미기</Text>
              <Text style={styles.subtitle}>나와 연결된 상대에게 보여요. 커뮤니티 프로필은 별도로 관리해요.</Text>
            </View>
            <Pressable onPress={close} disabled={saving} hitSlop={10} accessibilityRole="button" accessibilityLabel="프로필 꾸미기 닫기" style={styles.closeButton}>
              <X size={20} color={colors.taupe[500]} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.body}>
            {loading ? (
              <View style={styles.loading} accessibilityLiveRegion="polite">
                <ActivityIndicator size="small" color={colors.noir[800]} />
                <Text style={styles.helper}>프로필을 불러오는 중이에요.</Text>
              </View>
            ) : null}

            {ready ? (
              <>
                <View style={styles.preview}>
                  <ProfileAvatar
                    name={name}
                    avatarUrl={kind === "photo" && photo ? null : previewAvatar}
                    ownerId={ownerId}
                    previewUri={kind === "photo" && photo ? photo.uri : null}
                    size={80}
                  />
                </View>
                <View style={styles.kindRow} accessibilityRole="radiogroup" accessibilityLabel="프로필 표시 방식">
                  {KIND_OPTIONS.map((option) => {
                    const selected = kind === option.kind;
                    return (
                      <Pressable
                        key={option.kind}
                        disabled={saving}
                        onPress={() => { setKind(option.kind); setError(""); }}
                        style={[styles.kindButton, selected && styles.kindButtonSelected]}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: selected, disabled: saving }}
                      >
                        <Text style={[styles.kindLabel, selected && styles.kindLabelSelected]}>{option.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>

                {kind === "initial" ? <Text style={styles.helper}>이름의 첫 글자로 표시해요.</Text> : null}

                {kind === "emoji" ? (
                  <View style={styles.emojiGrid} accessibilityLabel="프로필 이모지 선택">
                    {PROFILE_AVATAR_EMOJIS.map((option) => {
                      const selected = emoji === option.emoji;
                      return (
                        <Pressable
                          key={option.emoji}
                          disabled={saving}
                          onPress={() => { setEmoji(option.emoji); setError(""); }}
                          style={[styles.emojiButton, selected && styles.kindButtonSelected]}
                          accessibilityRole="radio"
                          accessibilityLabel={option.label}
                          accessibilityState={{ checked: selected, disabled: saving }}
                        >
                          <Text style={styles.emoji}>{option.emoji}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : null}

                {kind === "photo" ? (
                  <View>
                    <Pressable disabled={saving} onPress={() => { void pickPhoto(); }} style={styles.secondaryButton} accessibilityRole="button">
                      <Text style={styles.secondaryButtonText}>{photo ? "사진 바꾸기" : "사진 고르기"}</Text>
                    </Pressable>
                    {photo ? <Text style={styles.helper} accessibilityLiveRegion="polite">고른 사진을 위에서 확인해 주세요.</Text> : null}
                    <Text style={styles.helper}>JPG · PNG · WebP, 최대 4MB. 사진 가운데가 원 안에 표시돼요.</Text>
                  </View>
                ) : null}
              </>
            ) : null}

            {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}

            <View style={styles.footerActions}>
              {!ready && !loading ? (
                <Pressable style={styles.secondaryButtonFlex} onPress={() => setRetry((value) => value + 1)} accessibilityRole="button">
                  <Text style={styles.secondaryButtonText}>다시 불러오기</Text>
                </Pressable>
              ) : null}
              <Pressable style={styles.secondaryButtonFlex} onPress={close} disabled={saving} accessibilityRole="button">
                <Text style={styles.secondaryButtonText}>취소</Text>
              </Pressable>
              {ready ? (
                <Pressable
                  style={[styles.primaryButton, (saving || (kind === "photo" && !photo)) && styles.disabled]}
                  onPress={() => { void save(); }}
                  disabled={saving || (kind === "photo" && !photo)}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: saving || (kind === "photo" && !photo), busy: saving }}
                >
                  {saving ? <ActivityIndicator size="small" color="#fff" /> : null}
                  <Text style={styles.primaryButtonText}>{saving ? "저장 중…" : "저장"}</Text>
                </Pressable>
              ) : null}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(13,13,15,0.46)" },
  sheet: {
    maxHeight: "90%",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: colors.ivory[50],
    paddingBottom: 24,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 16,
    paddingHorizontal: 20,
    paddingVertical: 18,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.ivory[200],
  },
  headerCopy: { flex: 1 },
  title: { fontSize: 17, fontWeight: "700", color: colors.noir[800] },
  subtitle: { marginTop: 5, fontSize: 13, lineHeight: 19, color: colors.taupe[500] },
  closeButton: { padding: 4 },
  body: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 8 },
  loading: { flexDirection: "row", alignItems: "center", gap: 8 },
  preview: { alignItems: "center", marginBottom: 18 },
  kindRow: { flexDirection: "row", gap: 8 },
  kindButton: {
    flex: 1,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  kindButtonSelected: { borderColor: colors.noir[800], backgroundColor: colors.ivory[100] },
  kindLabel: { fontSize: 14, fontWeight: "600", color: colors.textSecondary },
  kindLabelSelected: { color: colors.noir[800] },
  helper: { marginTop: 12, fontSize: 13, lineHeight: 19, color: colors.taupe[500] },
  emojiGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 },
  emojiButton: {
    width: 52,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  emoji: { fontSize: 24, lineHeight: 32 },
  error: { marginTop: 14, borderRadius: 10, backgroundColor: "#fbf2f0", padding: 10, fontSize: 13, lineHeight: 19, color: colors.rose[700] },
  footerActions: { flexDirection: "row", gap: 10, marginTop: 20 },
  secondaryButton: {
    marginTop: 14,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  secondaryButtonFlex: {
    flex: 1,
    minHeight: 46,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.ivory[200],
    borderRadius: 13,
    backgroundColor: colors.surface,
  },
  secondaryButtonText: { fontSize: 14, fontWeight: "700", color: colors.textSecondary },
  primaryButton: {
    flex: 1,
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderRadius: 13,
    backgroundColor: colors.noir[800],
  },
  primaryButtonText: { fontSize: 14, fontWeight: "700", color: "#fff" },
  disabled: { opacity: 0.45 },
});
