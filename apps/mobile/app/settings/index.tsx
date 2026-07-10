// 설정 화면 — 프로필/결혼정보 직접 편집 + 알림, 계정관리, 앱 정보
import { useEffect, useState, useRef, useCallback } from "react";
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
  Animated,
  Switch,
  Modal,
} from "react-native";
import DismissKeyboard from "@/components/DismissKeyboard";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import {
  Save,
  ExternalLink,
  Check,
  User,
  Heart,
  Smartphone,
  Bell,
  Shield,
  Lock,
  LogOut,
  Trash2,
  FileText,
  X,
  Eye,
  EyeOff,
  Users,
  Copy,
} from "lucide-react-native";
import * as Clipboard from "expo-clipboard";
import { colors } from "@hanbang/design-tokens";
import { supabase } from "@/lib/supabase";
import { apiFetch } from "@/lib/api";
import { clearCommunityCaches } from "@/lib/communityPostCache";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ActionRow, AppHeader, LoadingState, PrimaryButton, Surface } from "@/components/ui/AppUI";

// AsyncStorage 키
const NOTIF_PUSH_KEY = "@hanbang/notif_push";
const NOTIF_COMMUNITY_KEY = "@hanbang/notif_community";
const NOTIF_PARTNER_KEY = "@hanbang/notif_partner";

interface SettingsData {
  userId: string;
  coupleId: string | null;
  nickname: string;          // 실명 (profiles.name)
  communityNickname: string; // 커뮤니티 별명 (community_profiles.nickname)
  role: string | null;
  weddingDate: string;
  venue: string;
  totalBudget: string;
}

type ProfileUpdateResponse = {
  profile?: { name?: string | null };
  communityProfileSynced?: boolean;
  error?: string;
};

type CommunityProfileResponse = {
  profile?: { nickname?: string | null };
  error?: string;
};

export default function SettingsScreen() {
  const [data, setData] = useState<SettingsData | null>(null);
  const [initialData, setInitialData] = useState<SettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const checkScale = useRef(new Animated.Value(0)).current;

  // 알림 설정 상태
  const [pushEnabled, setPushEnabled] = useState(true);
  const [communityNotifEnabled, setCommunityNotifEnabled] = useState(true);
  const [partnerNotifEnabled, setPartnerNotifEnabled] = useState(true);

  // 비밀번호 변경 모달
  const [passwordModalVisible, setPasswordModalVisible] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);

  // 파트너 관리
  const [partnerName, setPartnerName] = useState<string | null>(null);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [isFullyLinked, setIsFullyLinked] = useState(false);
  const [requiresRelinkConfirmation, setRequiresRelinkConfirmation] = useState(false);
  const [relinking, setRelinking] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);

  // 알림 설정 로드
  useEffect(() => {
    (async () => {
      try {
        const [push, community, partner] = await Promise.all([
          AsyncStorage.getItem(NOTIF_PUSH_KEY),
          AsyncStorage.getItem(NOTIF_COMMUNITY_KEY),
          AsyncStorage.getItem(NOTIF_PARTNER_KEY),
        ]);
        // 기본값: 켜짐 (null이면 true)
        if (push !== null) setPushEnabled(push === "true");
        if (community !== null) setCommunityNotifEnabled(community === "true");
        if (partner !== null) setPartnerNotifEnabled(partner === "true");
      } catch (err) {
        console.error("알림 설정 로드 오류:", err);
      }
    })();
  }, []);

  // 알림 토글 핸들러
  const togglePush = useCallback(async (value: boolean) => {
    setPushEnabled(value);
    await AsyncStorage.setItem(NOTIF_PUSH_KEY, String(value));
  }, []);

  const toggleCommunity = useCallback(async (value: boolean) => {
    setCommunityNotifEnabled(value);
    await AsyncStorage.setItem(NOTIF_COMMUNITY_KEY, String(value));
  }, []);

  const togglePartner = useCallback(async (value: boolean) => {
    setPartnerNotifEnabled(value);
    await AsyncStorage.setItem(NOTIF_PARTNER_KEY, String(value));
  }, []);

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

        let communityNickname = "";
        try {
          const communityRes = await apiFetch("/api/community/profile");
          if (communityRes.ok) {
            const communityData =
              (await communityRes.json().catch(() => ({}))) as CommunityProfileResponse;
            communityNickname = communityData.profile?.nickname ?? "";
          }
        } catch {
          communityNickname = profile?.name ?? "";
        }

        // 파트너 정보 로드
        if (profile?.couple_id) {
          try {
            // 파트너 이름 조회
            const { data: partners } = await supabase.rpc("get_my_partner_public");

            if (partners && partners.length > 0) {
              setPartnerName(partners[0]?.name ?? null);
            }

            // 커플 초대 코드 조회
            const codeRes = await apiFetch("/api/couple/code");
            if (codeRes.ok) {
              const codeData = await codeRes.json();
              setInviteCode(codeData.inviteCode ?? null);
              setIsFullyLinked(codeData.isFullyLinked ?? false);
              setRequiresRelinkConfirmation(codeData.requiresRelinkConfirmation === true);
            }
          } catch (err) {
            console.error("파트너 정보 로드 오류:", err);
          }
        }

        const loadedData: SettingsData = {
          userId: user.id,
          coupleId: profile?.couple_id ?? null,
          nickname: profile?.name ?? "",
          communityNickname,
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
    data.communityNickname !== initialData.communityNickname ||
    data.weddingDate !== initialData.weddingDate ||
    data.venue !== initialData.venue ||
    data.totalBudget !== initialData.totalBudget
  );

  async function handleSave() {
    if (!data) return;
    setSaving(true);

    try {
      const nextData: SettingsData = {
        ...data,
        nickname: data.nickname.trim(),
        communityNickname: data.communityNickname.trim(),
      };

      const nameChanged = nextData.nickname !== initialData?.nickname.trim();
      const communityNicknameChanged =
        nextData.communityNickname !== initialData?.communityNickname.trim();

      if (nameChanged) {
        const profileRes = await apiFetch("/api/profile", {
          method: "PATCH",
          body: JSON.stringify({
            name: nextData.nickname,
            sync_community_nickname: !communityNicknameChanged,
          }),
        });
        const profileBody =
          (await profileRes.json().catch(() => ({}))) as ProfileUpdateResponse;

        if (!profileRes.ok) {
          throw new Error(profileBody.error ?? "이름 저장에 실패했어요.");
        }

        nextData.nickname = profileBody.profile?.name ?? nextData.nickname;
        if (!communityNicknameChanged && profileBody.communityProfileSynced) {
          nextData.communityNickname = nextData.nickname;
        }
      }

      if (communityNicknameChanged) {
        const communityRes = await apiFetch("/api/community/profile", {
          method: "PATCH",
          body: JSON.stringify({ nickname: nextData.communityNickname }),
        });
        const communityBody =
          (await communityRes.json().catch(() => ({}))) as CommunityProfileResponse;

        if (!communityRes.ok) {
          throw new Error(communityBody.error ?? "커뮤니티 별명 저장에 실패했어요.");
        }

        nextData.communityNickname =
          communityBody.profile?.nickname ?? nextData.communityNickname;
      }

      // 결혼 정보 업데이트
      if (nextData.coupleId) {
        const budgetNum = nextData.totalBudget
          ? parseInt(nextData.totalBudget, 10)
          : null;

        const { error: journeyError } = await supabase
          .from("wedding_journeys")
          .update({
            wedding_date: nextData.weddingDate || null,
            venue: nextData.venue || null,
            total_budget:
              budgetNum && !isNaN(budgetNum) ? budgetNum : null,
          })
          .eq("couple_id", nextData.coupleId);

        if (journeyError) throw journeyError;
      }

      setData(nextData);
      setInitialData(nextData);
      if (nameChanged || communityNicknameChanged) {
        clearCommunityCaches();
      }
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

  // 비밀번호 변경
  async function handleChangePassword() {
    if (!newPassword.trim()) {
      Alert.alert("오류", "새 비밀번호를 입력해주세요.");
      return;
    }
    if (newPassword.length < 6) {
      Alert.alert("오류", "비밀번호는 6자 이상이어야 해요.");
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert("오류", "비밀번호가 일치하지 않아요.");
      return;
    }

    setPasswordSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });
      if (error) throw error;

      Alert.alert("완료", "비밀번호가 변경되었어요.");
      setPasswordModalVisible(false);
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "비밀번호 변경 중 오류가 발생했어요";
      Alert.alert("오류", message);
    } finally {
      setPasswordSaving(false);
    }
  }

  // 초대 코드 복사
  async function copyInviteCode() {
    if (!inviteCode) return;
    try {
      await Clipboard.setStringAsync(inviteCode);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    } catch {
      Alert.alert("오류", "코드 복사에 실패했어요.");
    }
  }

  async function unlockLegacyInvite() {
    setRelinking(true);
    try {
      const response = await apiFetch("/api/couple/code", {
        method: "POST",
        body: JSON.stringify({ confirmLegacyRelink: true }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || typeof body.inviteCode !== "string") {
        throw new Error(body.error ?? "초대 코드를 만들지 못했습니다.");
      }
      setInviteCode(body.inviteCode);
      setRequiresRelinkConfirmation(false);
    } catch (error) {
      Alert.alert("초대 코드 오류", error instanceof Error ? error.message : "초대 코드를 만들지 못했습니다.");
    } finally {
      setRelinking(false);
    }
  }

  function confirmLegacyRelink() {
    Alert.alert(
      "새 커플 공간 만들기",
      "이전 공간의 일정·예산·대화는 새 파트너에게 공유되지 않습니다. 비어 있는 새 공간으로 시작할까요?",
      [
        { text: "취소", style: "cancel" },
        { text: "확인하고 만들기", onPress: () => void unlockLegacyInvite() },
      ]
    );
  }

  // 로그아웃
  function handleLogout() {
    Alert.alert("로그아웃", "정말 로그아웃 하시겠어요?", [
      { text: "취소", style: "cancel" },
      {
        text: "로그아웃",
        style: "destructive",
        onPress: async () => {
          await supabase.auth.signOut();
          router.replace("/(auth)/login");
        },
      },
    ]);
  }

  // 회원 탈퇴
  function handleDeleteAccount() {
    Alert.alert(
      "회원 탈퇴",
      "본인 비공개 상담과 직접 작성한 내용은 삭제됩니다. 파트너의 공동 계획과 법정 보존 대상 거래기록은 정해진 기간 남을 수 있어요.",
      [
        { text: "취소", style: "cancel" },
        {
          text: "탈퇴하기",
          style: "destructive",
          onPress: () => {
            // 2차 확인
            Alert.alert(
              "최종 확인",
              "계정은 복구할 수 없습니다. 파트너에게 남는 공동 기록과 법정 보존 항목을 확인했나요?",
              [
                { text: "취소", style: "cancel" },
                {
                  text: "탈퇴 확인",
                  style: "destructive",
                  onPress: async () => {
                    try {
                      const res = await apiFetch("/api/auth/delete", {
                        method: "DELETE",
                        body: JSON.stringify({ reason: "other" }),
                      });

                      if (res.status !== 202) {
                        const body = await res.json().catch(() => ({}));
                        throw new Error(body.error ?? "탈퇴 처리 중 오류가 발생했어요");
                      }

                      // 서버의 영속 큐가 접수했으므로 앱이 닫혀도 삭제는 계속된다.
                      // 네트워크 로그아웃 실패가 로컬 데이터 정리를 막지 않게 한다.
                      await supabase.auth.signOut({ scope: "local" }).catch(() => {});
                      clearCommunityCaches();
                      await AsyncStorage.clear();
                      router.replace("/(auth)/login");
                    } catch (err) {
                      const message =
                        err instanceof Error ? err.message : "탈퇴 처리 중 오류가 발생했어요";
                      Alert.alert("오류", message);
                    }
                  },
                },
              ]
            );
          },
        },
      ]
    );
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
        <AppHeader title="설정" onBack={() => router.back()} />
        <LoadingState label="설정을 불러오는 중이에요" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <AppHeader title="설정" onBack={() => router.back()} />

      <DismissKeyboard>
      <ScrollView contentContainerStyle={styles.content}>
        {/* 섹션 1: 프로필 */}
        <View style={styles.sectionHeader}>
          <User size={16} color={colors.rose[500]} />
          <Text style={styles.sectionTitle}>프로필</Text>
        </View>
        <Surface style={styles.card}>
          <View style={styles.field}>
            <Text style={styles.label}>이름 (실명)</Text>
            <TextInput
              style={[
                styles.textInput,
                focusedField === "nickname" && styles.textInputFocused,
              ]}
              value={data?.nickname ?? ""}
              onChangeText={(v) => updateField("nickname", v)}
              placeholder="실명을 입력하세요"
              placeholderTextColor={colors.taupe[400]}
              maxLength={20}
              onFocus={() => setFocusedField("nickname")}
              onBlur={() => setFocusedField(null)}
            />
            <Text style={styles.fieldHint}>아모라, 파트너 채팅에서 사용돼요</Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.field}>
            <Text style={styles.label}>커뮤니티 별명</Text>
            <TextInput
              style={[
                styles.textInput,
                focusedField === "communityNickname" && styles.textInputFocused,
              ]}
              value={data?.communityNickname ?? ""}
              onChangeText={(v) => updateField("communityNickname", v)}
              placeholder="커뮤니티에서 사용할 별명"
              placeholderTextColor={colors.taupe[400]}
              maxLength={15}
              onFocus={() => setFocusedField("communityNickname")}
              onBlur={() => setFocusedField(null)}
            />
            <Text style={styles.fieldHint}>게시글, 댓글, 동기방에서 표시돼요</Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.field}>
            <Text style={styles.label}>역할</Text>
            <View style={styles.readOnlyField}>
              <Text style={styles.readOnlyText}>{roleLabel}</Text>
            </View>
          </View>
        </Surface>

        {/* 섹션 2: 결혼 정보 */}
        <View style={styles.sectionHeader}>
          <Heart size={16} color={colors.rose[500]} />
          <Text style={styles.sectionTitle}>결혼 정보</Text>
        </View>
        <Surface style={styles.card}>
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
        </Surface>

        {/* 저장 버튼 */}
        <PrimaryButton
          tone="rose"
          style={styles.saveButton}
          onPress={handleSave}
          disabled={saving || (!hasChanges && !saved)}
          icon={
            saving ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : saved ? (
              <Animated.View style={{ transform: [{ scale: checkScale }] }}>
                <Check size={18} color="#FFFFFF" />
              </Animated.View>
            ) : (
              <Save size={18} color="#FFFFFF" />
            )
          }
        >
          {saving ? "저장 중" : saved ? "저장 완료" : "저장하기"}
        </PrimaryButton>

        {/* 섹션 3: 알림 설정 */}
        <View style={styles.sectionHeader}>
          <Bell size={16} color={colors.rose[500]} />
          <Text style={styles.sectionTitle}>알림 설정</Text>
        </View>
        <Surface style={styles.card}>
          <View style={styles.toggleRow}>
            <View style={styles.toggleInfo}>
              <Text style={styles.toggleLabel}>푸시 알림</Text>
              <Text style={styles.toggleHint}>일정, 예산 알림을 받아요</Text>
            </View>
            <Switch
              value={pushEnabled}
              onValueChange={togglePush}
              trackColor={{ false: colors.ivory[200], true: colors.rose.pale }}
              thumbColor={pushEnabled ? colors.rose[500] : colors.taupe[400]}
            />
          </View>

          <View style={styles.divider} />

          <View style={styles.toggleRow}>
            <View style={styles.toggleInfo}>
              <Text style={styles.toggleLabel}>커뮤니티 알림</Text>
              <Text style={styles.toggleHint}>댓글, 좋아요 알림을 받아요</Text>
            </View>
            <Switch
              value={communityNotifEnabled}
              onValueChange={toggleCommunity}
              trackColor={{ false: colors.ivory[200], true: colors.rose.pale }}
              thumbColor={communityNotifEnabled ? colors.rose[500] : colors.taupe[400]}
            />
          </View>

          <View style={styles.divider} />

          <View style={styles.toggleRow}>
            <View style={styles.toggleInfo}>
              <Text style={styles.toggleLabel}>파트너 메시지 알림</Text>
              <Text style={styles.toggleHint}>파트너가 보낸 메시지 알림</Text>
            </View>
            <Switch
              value={partnerNotifEnabled}
              onValueChange={togglePartner}
              trackColor={{ false: colors.ivory[200], true: colors.rose.pale }}
              thumbColor={partnerNotifEnabled ? colors.rose[500] : colors.taupe[400]}
            />
          </View>
        </Surface>

        {/* 섹션 4: 파트너 관리 */}
        {data?.coupleId && (
          <>
            <View style={styles.sectionHeader}>
              <Users size={16} color={colors.rose[500]} />
              <Text style={styles.sectionTitle}>파트너 관리</Text>
            </View>
            <Surface style={styles.card}>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>파트너</Text>
                <Text style={styles.infoValue}>
                  {isFullyLinked
                    ? partnerName ?? "연동됨"
                    : "미연동"}
                </Text>
              </View>

              <View style={styles.divider} />

              <View style={styles.field}>
                <Text style={styles.label}>커플 초대 코드</Text>
                {requiresRelinkConfirmation && (
                  <View style={styles.relinkNotice}>
                    <Text style={styles.relinkTitle}>새 커플 공간으로 시작해 주세요</Text>
                    <Text style={styles.relinkText}>
                      이전 자료를 새 파트너에게 넘기지 않고 비어 있는 새 공간을 만듭니다.
                    </Text>
                    <Pressable
                      onPress={confirmLegacyRelink}
                      disabled={relinking}
                      style={({ pressed }) => [
                        styles.relinkButton,
                        (pressed || relinking) && { opacity: 0.65 },
                      ]}
                    >
                      {relinking ? (
                        <ActivityIndicator size="small" color={colors.surface} />
                      ) : (
                        <Text style={styles.relinkButtonText}>확인하고 새 공간 만들기</Text>
                      )}
                    </Pressable>
                  </View>
                )}
                <View style={styles.codeRow}>
                  <View style={styles.codeBox}>
                    <Text style={styles.codeText}>{inviteCode ?? "---"}</Text>
                  </View>
                  <Pressable
                    style={({ pressed }) => [
                      styles.copyBtn,
                      pressed && { opacity: 0.6 },
                    ]}
                    onPress={copyInviteCode}
                    disabled={!inviteCode}
                  >
                    {codeCopied ? (
                      <Check size={16} color={colors.rose[500]} />
                    ) : (
                      <Copy size={16} color={colors.rose[500]} />
                    )}
                  </Pressable>
                </View>
                <Text style={styles.fieldHint}>
                  {isFullyLinked
                    ? "파트너와 연동이 완료되었어요"
                    : "이 코드를 파트너에게 공유해주세요"}
                </Text>
              </View>
            </Surface>
          </>
        )}

        {/* 섹션 5: 계정 관리 */}
        <View style={styles.sectionHeader}>
          <Shield size={16} color={colors.rose[500]} />
          <Text style={styles.sectionTitle}>계정 관리</Text>
        </View>
        <Surface style={styles.card}>
          <ActionRow
            icon={<Lock size={18} color={colors.noir[800]} />}
            title="비밀번호 변경"
            onPress={() => {
              setNewPassword("");
              setConfirmPassword("");
              setShowNewPassword(false);
              setShowConfirmPassword(false);
              setPasswordModalVisible(true);
            }}
          />

          <View style={styles.divider} />

          <ActionRow
            icon={<LogOut size={18} color={colors.noir[800]} />}
            title="로그아웃"
            onPress={handleLogout}
          />
        </Surface>

        {/* 섹션 6: 앱 정보 */}
        <View style={styles.sectionHeader}>
          <Smartphone size={16} color={colors.rose[500]} />
          <Text style={styles.sectionTitle}>앱 정보</Text>
        </View>
        <Surface style={styles.card}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>버전</Text>
            <Text style={styles.infoValue}>1.0.0</Text>
          </View>

          <View style={styles.divider} />

          <ActionRow
            title="이용약관"
            onPress={() => Linking.openURL("https://hanbang.ai/terms")}
            right={<ExternalLink size={16} color={colors.taupe[400]} />}
          />

          <View style={styles.divider} />

          <ActionRow
            title="개인정보처리방침"
            onPress={() => Linking.openURL("https://hanbang.ai/privacy")}
            right={<ExternalLink size={16} color={colors.taupe[400]} />}
          />

          <View style={styles.divider} />

          <ActionRow
            icon={<FileText size={16} color={colors.noir[800]} />}
            title="오픈소스 라이선스"
            onPress={() => Linking.openURL("https://hanbang.ai/licenses")}
            right={<ExternalLink size={16} color={colors.taupe[400]} />}
          />
        </Surface>

        {/* 회원 탈퇴 (위험 영역) */}
        <View style={styles.dangerZone}>
          <Pressable
            style={({ pressed }) => [styles.dangerBtn, pressed && { opacity: 0.7 }]}
            onPress={handleDeleteAccount}
          >
            <Trash2 size={16} color={colors.danger} />
            <Text style={styles.dangerBtnText}>회원 탈퇴</Text>
          </Pressable>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
      </DismissKeyboard>

      {/* 비밀번호 변경 모달 */}
      <Modal
        visible={passwordModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setPasswordModalVisible(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setPasswordModalVisible(false)}
        >
          <Pressable
            style={styles.modalContent}
            onPress={() => {}}
          >
            {/* 모달 헤더 */}
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>비밀번호 변경</Text>
              <Pressable
                onPress={() => setPasswordModalVisible(false)}
                hitSlop={12}
              >
                <X size={22} color={colors.noir[800]} />
              </Pressable>
            </View>

            {/* 새 비밀번호 */}
            <View style={styles.modalField}>
              <Text style={styles.label}>새 비밀번호</Text>
              <View style={styles.passwordInputWrapper}>
                <TextInput
                  style={styles.passwordInput}
                  value={newPassword}
                  onChangeText={setNewPassword}
                  placeholder="6자 이상 입력"
                  placeholderTextColor={colors.taupe[400]}
                  secureTextEntry={!showNewPassword}
                  autoCapitalize="none"
                  maxLength={64}
                />
                <Pressable
                  onPress={() => setShowNewPassword(!showNewPassword)}
                  hitSlop={8}
                  style={styles.eyeBtn}
                >
                  {showNewPassword ? (
                    <EyeOff size={18} color={colors.taupe[400]} />
                  ) : (
                    <Eye size={18} color={colors.taupe[400]} />
                  )}
                </Pressable>
              </View>
            </View>

            {/* 비밀번호 확인 */}
            <View style={styles.modalField}>
              <Text style={styles.label}>비밀번호 확인</Text>
              <View style={styles.passwordInputWrapper}>
                <TextInput
                  style={styles.passwordInput}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  placeholder="다시 한번 입력"
                  placeholderTextColor={colors.taupe[400]}
                  secureTextEntry={!showConfirmPassword}
                  autoCapitalize="none"
                  maxLength={64}
                />
                <Pressable
                  onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                  hitSlop={8}
                  style={styles.eyeBtn}
                >
                  {showConfirmPassword ? (
                    <EyeOff size={18} color={colors.taupe[400]} />
                  ) : (
                    <Eye size={18} color={colors.taupe[400]} />
                  )}
                </Pressable>
              </View>
              {confirmPassword.length > 0 && newPassword !== confirmPassword && (
                <Text style={styles.errorHint}>비밀번호가 일치하지 않아요</Text>
              )}
            </View>

            {/* 변경 버튼 */}
            <PrimaryButton
              tone="rose"
              style={styles.modalSaveButton}
              onPress={handleChangePassword}
              disabled={
                passwordSaving ||
                !newPassword.trim() ||
                newPassword.length < 6 ||
                newPassword !== confirmPassword
              }
              icon={passwordSaving ? <ActivityIndicator size="small" color="#FFFFFF" /> : undefined}
            >
              {passwordSaving ? "변경 중" : "변경하기"}
            </PrimaryButton>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },

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
    borderColor: colors.border,
    borderWidth: 1,
    padding: 16,
    marginBottom: 20,
    shadowOpacity: 0.04,
    elevation: 2,
  },

  // 필드
  field: { gap: 6 },
  label: { fontSize: 13, fontWeight: "600", color: colors.textSecondary },
  fieldHint: { fontSize: 11, color: colors.taupe[400], marginTop: 4, marginLeft: 2 },
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

  saveButton: {
    marginBottom: 24,
  },

  // 알림 토글 행
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 2,
  },
  toggleInfo: {
    flex: 1,
    marginRight: 12,
  },
  toggleLabel: {
    fontSize: 15,
    fontWeight: "500",
    color: colors.noir[800],
  },
  toggleHint: {
    fontSize: 12,
    color: colors.taupe[400],
    marginTop: 2,
  },

  // 커플 코드
  codeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  codeBox: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: colors.ivory[200],
    borderRadius: 14,
  },
  codeText: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.noir[800],
    fontFamily: "CormorantGaramond_400Regular",
    letterSpacing: 0,
  },
  relinkNotice: {
    marginBottom: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.rose.pale,
    backgroundColor: colors.ivory[100],
  },
  relinkTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.noir[900],
  },
  relinkText: {
    marginTop: 5,
    fontSize: 13,
    lineHeight: 19,
    color: colors.textSecondary,
  },
  relinkButton: {
    marginTop: 12,
    minHeight: 42,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.rose[500],
  },
  relinkButtonText: {
    color: colors.surface,
    fontSize: 14,
    fontWeight: "700",
  },
  copyBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.rose.glow,
    alignItems: "center",
    justifyContent: "center",
  },

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

  // 위험 영역 (회원 탈퇴)
  dangerZone: {
    alignItems: "center",
    marginTop: 8,
    paddingTop: 8,
  },
  dangerBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.danger,
    backgroundColor: "rgba(239, 68, 68, 0.05)",
  },
  dangerBtnText: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.danger,
  },

  // 비밀번호 모달
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.4)",
    justifyContent: "flex-end",
  },
  modalContent: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 24,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: colors.noir[800],
    fontFamily: "NotoSerifKR_500Medium",
  },
  modalField: {
    marginBottom: 18,
    gap: 6,
  },
  passwordInputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.bg,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  passwordInput: {
    flex: 1,
    fontSize: 15,
    color: colors.noir[800],
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  eyeBtn: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  errorHint: {
    fontSize: 12,
    color: colors.danger,
    marginTop: 4,
    marginLeft: 2,
  },
  modalSaveButton: {
    marginTop: 8,
  },
});
