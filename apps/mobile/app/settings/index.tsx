// 설정 화면 — 프로필/결혼정보 직접 편집 + 계정관리, 앱 정보
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
  Shield,
  Lock,
  LogOut,
  X,
  Eye,
  EyeOff,
  Users,
  Copy,
} from "lucide-react-native";
import * as Clipboard from "expo-clipboard";
import { colors } from "@hanbang/design-tokens";
import { isStrongPassword, manwonInputToWon, normalizeOptionalBudgetWon, wonToManwonInput } from "@hanbang/shared";
import { supabase } from "@/lib/supabase";
import { readMySafeProfile } from "@/lib/safeProfile";
import { apiFetch } from "@/lib/api";
import { clearCommunityCaches } from "@/lib/communityPostCache";
import { ActionRow, AppHeader, LoadingState, PrimaryButton, Surface } from "@/components/ui/AppUI";
import ErrorRetry from "@/components/ErrorRetry";

interface SettingsData {
  userId: string;
  coupleId: string | null;
  nickname: string;          // 계정 안에서 사용할 이름 (profiles.name)
  communityNickname: string; // 커뮤니티 별명 (community_profiles.nickname)
  role: string | null;
  weddingDate: string;
  venue: string;
  totalBudget: string;
}

type ProfileUpdateResponse = {
  profile?: { name?: string | null };
  error?: string;
};

type CommunityProfileResponse = {
  profile?: { nickname?: string | null };
  error?: string;
};

type CoupleInviteState = {
  inviteCode: string | null;
  isFullyLinked: boolean;
  requiresRelinkConfirmation: boolean;
};

type SettingsLoadResult = {
  settings: SettingsData;
  inviteState: CoupleInviteState | null;
};

type SettingsLoadSource =
  | "auth"
  | "profile"
  | "journey"
  | "partner"
  | "invite";

class SettingsLoadError extends Error {
  constructor(
    readonly source: SettingsLoadSource,
    message: string,
  ) {
    super(message);
    this.name = "SettingsLoadError";
  }
}

function settingsLoadMessage(source: SettingsLoadSource): string {
  switch (source) {
    case "auth":
      return "로그인 상태를 확인하지 못했어요.";
    case "profile":
      return "프로필 정보를 불러오지 못했어요.";
    case "journey":
      return "결혼 준비 정보를 불러오지 못했어요.";
    case "partner":
      return "파트너 연결 상태를 불러오지 못했어요.";
    case "invite":
      return "커플 초대 코드 상태를 불러오지 못했어요.";
  }
}

type ApiErrorBody = {
  error?: unknown;
  message?: unknown;
};

function apiErrorMessage(body: ApiErrorBody, fallback: string): string {
  if (typeof body.message === "string" && body.message.trim()) return body.message;
  if (typeof body.error === "string" && body.error.trim()) return body.error;
  return fallback;
}

async function readCoupleInviteState(): Promise<CoupleInviteState> {
  const response = await apiFetch("/api/couple/code");
  const body = (await response.json().catch(() => ({}))) as ApiErrorBody & {
    inviteCode?: unknown;
    isFullyLinked?: unknown;
    requiresRelinkConfirmation?: unknown;
  };
  if (!response.ok) {
    throw new Error(apiErrorMessage(body, "커플 코드를 확인하지 못했습니다."));
  }

  const inviteCode = typeof body.inviteCode === "string" ? body.inviteCode : null;
  const requiresRelinkConfirmation = body.requiresRelinkConfirmation === true;
  if (
    typeof body.isFullyLinked !== "boolean"
    || (inviteCode === null && !requiresRelinkConfirmation)
    || (inviteCode !== null && !/^WH-[A-F0-9]{12}$/.test(inviteCode))
  ) {
    throw new Error("커플 코드 상태를 확인하지 못했습니다.");
  }

  return {
    inviteCode,
    isFullyLinked: body.isFullyLinked,
    requiresRelinkConfirmation,
  };
}

export default function SettingsScreen() {
  const [data, setData] = useState<SettingsData | null>(null);
  const [initialData, setInitialData] = useState<SettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadIssue, setLoadIssue] = useState<SettingsLoadSource | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const checkScale = useRef(new Animated.Value(0)).current;

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
  const [relinkRecoveryRequired, setRelinkRecoveryRequired] = useState(false);
  const [relinkRecoveryPreviousCoupleId, setRelinkRecoveryPreviousCoupleId] = useState<string | null>(null);
  const [codeCopied, setCodeCopied] = useState(false);
  const settingsReadOnly = Boolean(loadIssue) || loading;

  // 현재 데이터 로드. 새 커플 공간을 만든 직후에도 이 함수 전체를 다시
  // 실행해 이전 couple/journey를 화면에 남기지 않는다.
  const loadSettings = useCallback(async (
    options: { requireInviteState?: boolean } = {}
  ): Promise<SettingsLoadResult | null> => {
    const inviteFailureCode = options.requireInviteState
      ? "required_invite_state_lookup_failed"
      : "invite_state_lookup_failed";
    setLoading(true);
    try {
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();
        if (userError) {
          throw new SettingsLoadError("auth", "authenticated_user_lookup_failed");
        }
        if (!user) {
          router.replace("/(auth)/login");
          return null;
        }

        const { data: profile, error: profileError } = await readMySafeProfile();
        if (profileError || !profile) {
          throw new SettingsLoadError("profile", "profile_lookup_failed");
        }

        let weddingDate = "";
        let venue = "";
        let totalBudget = "";

        if (profile?.couple_id) {
          const { data: journey, error: journeyError } = await supabase
            .from("wedding_journeys")
            .select("wedding_date, venue, total_budget")
            .eq("couple_id", profile.couple_id)
            .single();
          if (journeyError || !journey) {
            throw new SettingsLoadError("journey", "journey_lookup_failed");
          }

          if (journey) {
            weddingDate = journey.wedding_date ?? "";
            venue = journey.venue ?? "";
            totalBudget = wonToManwonInput(journey.total_budget);
          }
        }

        let communityNickname = "";
        try {
          const communityRes = await apiFetch("/api/community/profile");
          if (!communityRes.ok) {
            throw new Error("community_profile_lookup_failed");
          }
          const communityData =
            (await communityRes.json().catch(() => ({}))) as CommunityProfileResponse;
          communityNickname = communityData.profile?.nickname ?? "";
        } catch {
          throw new SettingsLoadError("profile", "community_profile_lookup_failed");
        }

        let nextPartnerName: string | null = null;
        let nextInviteState: CoupleInviteState | null = null;

        // 파트너 정보 로드
        if (profile?.couple_id) {
          // 파트너 이름 조회
          const { data: partners, error: partnerError } = await supabase.rpc(
            "get_my_partner_public"
          );
          if (partnerError) throw new SettingsLoadError("partner", "partner_lookup_failed");

          if (partners && partners.length > 0) {
            nextPartnerName = partners[0]?.name ?? null;
          }

          try {
            nextInviteState = await readCoupleInviteState();
          } catch {
            throw new SettingsLoadError("invite", inviteFailureCode);
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
        setPartnerName(nextPartnerName);
        setInviteCode(nextInviteState?.inviteCode ?? null);
        setIsFullyLinked(nextInviteState?.isFullyLinked ?? false);
        setRequiresRelinkConfirmation(
          nextInviteState?.requiresRelinkConfirmation ?? false
        );
        setLoadIssue(null);
        return { settings: loadedData, inviteState: nextInviteState };
      } catch (err) {
        setLoadIssue(err instanceof SettingsLoadError ? err.source : "profile");
        return null;
      } finally {
        setLoading(false);
      }
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  function updateField(field: keyof SettingsData, value: string) {
    if (settingsReadOnly) return;
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
    if (!data || settingsReadOnly) return;
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
          body: JSON.stringify({ name: nextData.nickname }),
        });
        const profileBody =
          (await profileRes.json().catch(() => ({}))) as ProfileUpdateResponse;

        if (!profileRes.ok) {
          throw new Error(profileBody.error ?? "이름 저장에 실패했어요.");
        }

        nextData.nickname = profileBody.profile?.name ?? nextData.nickname;
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
        const budgetNum = normalizeOptionalBudgetWon(
          nextData.totalBudget ? manwonInputToWon(nextData.totalBudget) : 0,
        );
        if (nextData.totalBudget && !budgetNum) {
          throw new Error("총 예산을 만원 단위 숫자로 입력해주세요.");
        }

        const { error: journeyError } = await supabase
          .from("wedding_journeys")
          .update({
            wedding_date: nextData.weddingDate || null,
            venue: nextData.venue || null,
            total_budget: budgetNum,
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
    if (!isStrongPassword(newPassword)) {
      Alert.alert("오류", "비밀번호는 8자 이상이며 대문자, 소문자, 숫자, 특수문자를 모두 포함해야 해요.");
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
    let returnedInviteCode: string | null = null;
    let requestError: string | null = null;
    const previousCoupleId = data?.coupleId ?? relinkRecoveryPreviousCoupleId;
    setRelinkRecoveryPreviousCoupleId(previousCoupleId);
    // Remove all editable old-journey state before dispatch. The mutation can
    // commit even if its HTTP response is lost.
    setData(null);
    setInitialData(null);
    setRelinkRecoveryRequired(true);
    setRelinking(true);
    try {
      const response = await apiFetch("/api/couple/code", {
        method: "POST",
        body: JSON.stringify({ confirmLegacyRelink: true }),
      });
      const body = (await response.json().catch(() => ({}))) as ApiErrorBody & {
        inviteCode?: unknown;
      };
      if (!response.ok || typeof body.inviteCode !== "string") {
        throw new Error(apiErrorMessage(body, "초대 코드를 만들지 못했습니다."));
      }
      returnedInviteCode = body.inviteCode;
    } catch (error) {
      requestError = error instanceof Error ? error.message : "초대 코드를 만들지 못했습니다.";
    } finally {
      try {
        const refreshed = await loadSettings({ requireInviteState: true });
        const refreshedSettings = refreshed?.settings ?? null;
        const refreshedInviteState = refreshed?.inviteState ?? null;
        const observedFreshCouple = Boolean(
          refreshedSettings?.coupleId
          && refreshedSettings.coupleId !== previousCoupleId
          && refreshedInviteState?.inviteCode
          && !refreshedInviteState.requiresRelinkConfirmation
        );
        const observedOriginalCouple = Boolean(
          previousCoupleId
          && refreshedSettings?.coupleId === previousCoupleId
          && refreshedInviteState?.inviteCode === null
          && refreshedInviteState.requiresRelinkConfirmation
        );

        if (observedFreshCouple) {
          setRelinkRecoveryRequired(false);
          setInviteCode(returnedInviteCode ?? refreshedInviteState?.inviteCode ?? null);
          setRequiresRelinkConfirmation(false);
        } else if (observedOriginalCouple && requestError && returnedInviteCode === null) {
          // A primary profile/journey read plus the blocked invite state proves
          // the replacement transaction did not commit. The loaded old state
          // is therefore safe to edit again.
          setRelinkRecoveryRequired(false);
          Alert.alert(
            "새 커플 공간을 만들지 못했어요",
            `${requestError} 이전 결혼 정보는 그대로 유지됩니다.`
          );
        } else {
          setData(null);
          setInitialData(null);
          setRelinkRecoveryRequired(true);
        }
      } catch {
        // Keep the screen non-editable until a primary read proves which
        // couple the profile now belongs to.
        setData(null);
        setInitialData(null);
        setRelinkRecoveryRequired(true);
      }
      setRelinking(false);
    }
  }

  async function recoverLegacyRelinkState() {
    setRelinking(true);
    try {
      const refreshed = await loadSettings({ requireInviteState: true });
      const refreshedSettings = refreshed?.settings ?? null;
      const refreshedInviteState = refreshed?.inviteState ?? null;
      const observedFreshCouple = Boolean(
        refreshedSettings?.coupleId
        && refreshedSettings.coupleId !== relinkRecoveryPreviousCoupleId
        && refreshedInviteState?.inviteCode
        && !refreshedInviteState.requiresRelinkConfirmation
      );
      const observedOriginalCouple = Boolean(
        relinkRecoveryPreviousCoupleId
        && refreshedSettings?.coupleId === relinkRecoveryPreviousCoupleId
        && refreshedInviteState?.inviteCode === null
        && refreshedInviteState.requiresRelinkConfirmation
      );

      if (observedFreshCouple) {
        setRelinkRecoveryRequired(false);
        return;
      }
      if (observedOriginalCouple) {
        setRelinkRecoveryRequired(false);
        Alert.alert(
          "이전 정보가 안전하게 유지되고 있어요",
          "새 커플 공간 생성은 반영되지 않았습니다. 이전 일정과 예산을 계속 수정할 수 있어요."
        );
        return;
      }
      throw new Error("authoritative relink state not observable");
    } catch {
      setData(null);
      setInitialData(null);
      setRelinkRecoveryRequired(true);
      Alert.alert(
        "아직 상태를 확인하지 못했어요",
        "네트워크를 확인한 뒤 다시 시도해 주세요. 확인 전에는 이전 결혼 정보를 수정할 수 없습니다."
      );
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

  const roleLabel =
    data?.role === "bride"
      ? "신부"
      : data?.role === "groom"
        ? "신랑"
        : data?.role ?? "-";

  if (loading && !data) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <AppHeader title="설정" onBack={() => router.back()} />
        <LoadingState label="설정을 불러오는 중이에요" />
      </SafeAreaView>
    );
  }

  if (relinkRecoveryRequired) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <AppHeader title="설정" onBack={() => router.back()} />
        <View style={{ flex: 1, justifyContent: "center", padding: 24 }}>
          <Surface style={styles.card}>
            <Text style={styles.sectionTitle}>새 커플 공간을 확인하고 있어요</Text>
            <Text style={styles.fieldHint}>
              응답이 끊겨 서버 반영 여부를 다시 확인해야 합니다. 확인 전에는 이전 일정과 예산을 수정할 수 없어요.
            </Text>
            <PrimaryButton
              tone="rose"
              style={styles.saveButton}
              onPress={() => void recoverLegacyRelinkState()}
              disabled={relinking}
              icon={relinking ? <ActivityIndicator size="small" color="#FFFFFF" /> : undefined}
            >
              {relinking ? "확인 중" : "상태 다시 확인"}
            </PrimaryButton>
          </Surface>
        </View>
      </SafeAreaView>
    );
  }

  if (loadIssue && !data) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <AppHeader title="설정" onBack={() => router.back()} />
        <ErrorRetry
          message={settingsLoadMessage(loadIssue)}
          onRetry={() => void loadSettings()}
        />
      </SafeAreaView>
    );
  }

  if (!data) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <AppHeader title="설정" onBack={() => router.back()} />
        <LoadingState label="로그인 상태를 확인하고 있어요" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <AppHeader title="설정" onBack={() => router.back()} />

      {loadIssue && data ? (
        <View style={styles.loadWarning} accessibilityRole="alert">
          <View style={styles.loadWarningCopy}>
            <Text style={styles.loadWarningTitle}>
              마지막으로 확인한 설정을 표시하고 있어요
            </Text>
            <Text style={styles.loadWarningBody}>
              {settingsLoadMessage(loadIssue)} 기존 값은 유지하지만, 수정과 저장은 최신 상태를 확인한 뒤 다시 사용할 수 있어요.
            </Text>
          </View>
          <Pressable
            style={({ pressed }) => [
              styles.loadRetryButton,
              pressed && !loading && { opacity: 0.65 },
            ]}
            onPress={() => void loadSettings()}
            disabled={loading}
            accessibilityRole="button"
            accessibilityLabel="설정 정보 다시 불러오기"
          >
            <Text style={styles.loadRetryText}>{loading ? "확인 중" : "다시 불러오기"}</Text>
          </Pressable>
        </View>
      ) : null}

      <DismissKeyboard>
      <ScrollView contentContainerStyle={styles.content}>
        {/* 섹션 1: 프로필 */}
        <View style={styles.sectionHeader}>
          <User size={16} color={colors.rose[500]} />
          <Text style={styles.sectionTitle}>프로필</Text>
        </View>
        <Surface style={styles.card}>
          <View style={styles.field}>
            <Text style={styles.label}>이름 또는 서로 부를 이름</Text>
            <TextInput
              style={[
                styles.textInput,
                focusedField === "nickname" && styles.textInputFocused,
              ]}
              value={data?.nickname ?? ""}
              onChangeText={(v) => updateField("nickname", v)}
              editable={!settingsReadOnly}
              placeholder="계정에서 사용할 이름"
              placeholderTextColor={colors.taupe[400]}
              maxLength={20}
              onFocus={() => setFocusedField("nickname")}
              onBlur={() => setFocusedField(null)}
            />
            <Text style={styles.fieldHint}>
              아모라와 파트너에게 표시돼요. 커뮤니티 별명과는 별개예요.
            </Text>
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
              editable={!settingsReadOnly}
              placeholder="커뮤니티에서 사용할 별명"
              placeholderTextColor={colors.taupe[400]}
              maxLength={20}
              onFocus={() => setFocusedField("communityNickname")}
              onBlur={() => setFocusedField(null)}
            />
            <Text style={styles.fieldHint}>게시글과 댓글에서 표시돼요</Text>
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
              editable={!settingsReadOnly}
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
              editable={!settingsReadOnly}
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
              editable={!settingsReadOnly}
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
          disabled={saving || settingsReadOnly || (!hasChanges && !saved)}
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
                      disabled={relinking || settingsReadOnly}
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
                    disabled={!inviteCode || settingsReadOnly}
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

        </Surface>

        {/* 회원 탈퇴 (위험 영역) */}
        <View style={styles.dangerZone}>
          <View style={styles.deletionUnavailable}>
            <Text style={styles.deletionUnavailableTitle}>계정 삭제 기능 점검 중</Text>
            <Text style={styles.deletionUnavailableBody}>
              삭제 작업자와 실패 복구가 확인되지 않아 현재 요청을 받지 않아요. 검증 전에는 공개 운영하지 않습니다.
            </Text>
          </View>
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
                !isStrongPassword(newPassword) ||
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
  loadWarning: {
    marginHorizontal: 20,
    marginTop: 12,
    borderWidth: 1,
    borderColor: "#E8B4AB",
    borderRadius: 16,
    backgroundColor: "#FFF4F2",
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  loadWarningCopy: {
    flex: 1,
  },
  loadWarningTitle: {
    color: colors.danger,
    fontFamily: "NotoSansKR_600SemiBold",
    fontSize: 14,
  },
  loadWarningBody: {
    marginTop: 3,
    color: colors.textSecondary,
    fontFamily: "NotoSansKR_400Regular",
    fontSize: 12,
    lineHeight: 18,
  },
  loadRetryButton: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  loadRetryText: {
    color: colors.danger,
    fontFamily: "NotoSansKR_600SemiBold",
    fontSize: 13,
  },

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
  deletionUnavailable: {
    borderWidth: 1,
    borderColor: "#F5D08A",
    borderRadius: 12,
    backgroundColor: "#FFF8E8",
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  deletionUnavailableTitle: {
    color: "#6B4A10",
    fontFamily: "NotoSansKR_600SemiBold",
    fontSize: 14,
    textAlign: "center",
  },
  deletionUnavailableBody: {
    color: "#7A5B23",
    fontFamily: "NotoSansKR_400Regular",
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4,
    textAlign: "center",
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
