// 설정 화면 — 프로필/결혼정보 직접 편집 + 알림, 계정관리, 앱 정보
import { useEffect, useState, useRef } from "react";
import { CONTACT } from "@hanbang/shared/constants";
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
  Platform,
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
  X,
  Eye,
  EyeOff,
  Users,
  BrainCircuit,
  BookOpen,
} from "lucide-react-native";
import * as Clipboard from "expo-clipboard";
import { colors } from "@hanbang/design-tokens";
import {
  describeCoupleInviteWindow,
  resolveCoupleConnectionState,
  type CoupleConnectionState,
} from "@hanbang/shared";
import { supabase } from "@/lib/supabase";
import { signOut } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import {
  buildWeddingSettingsPatch,
  createLatestSettingsLoadGate,
  parseWeddingSettingsResponse,
  splitWeddingSettingsPatch,
  type WeddingSettingsData,
  type WeddingSettingsSnapshot,
} from "@/lib/weddingSettings";
import { clearCommunityCaches } from "@/lib/communityPostCache";
import { purgeCommunityDecisionPendingForOwnerWithRetry } from "@/lib/communityDecisionPending";
import { hasActiveCareConsent } from "@/lib/careSettings";
import { toKoreanErrorMessage } from "@/lib/errorCopy";
import { ActionRow, AppHeader, LoadingState, PrimaryButton, Surface } from "@/components/ui/AppUI";
import AppGuide from "@/components/AppGuide";
import InviteCodeCard from "@/components/invite/InviteCodeCard";
import TodayOnePreferenceControl from "@/components/settings/TodayOnePreferenceControl";
import CommunityReplyPushPreferenceControl from "@/components/settings/CommunityReplyPushPreferenceControl";

type SettingsData = WeddingSettingsData;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type CoupleCodeResponse = {
  inviteCode?: unknown;
  isFullyLinked?: unknown;
  isMembershipSealed?: unknown;
  inviteCodeExpiresAt?: unknown;
  inviteCodeReissued?: unknown;
};

export default function SettingsScreen() {
  const [data, setData] = useState<SettingsData | null>(null);
  const [initialData, setInitialData] = useState<SettingsData | null>(null);
  const [settingsSnapshot, setSettingsSnapshot] =
    useState<WeddingSettingsSnapshot | null>(null);
  const [legacyCareConsentActive, setLegacyCareConsentActive] = useState(false);
  const [revokingLegacyCareConsent, setRevokingLegacyCareConsent] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const checkScale = useRef(new Animated.Value(0)).current;
  const settingsLoadGate = useRef(createLatestSettingsLoadGate()).current;

  // 비밀번호 변경 모달
  const [passwordModalVisible, setPasswordModalVisible] = useState(false);
  const [guideVisible, setGuideVisible] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);

  // 파트너 관리
  const [partnerName, setPartnerName] = useState<string | null>(null);
  const [usesNeutralMembers, setUsesNeutralMembers] = useState(false);
  const [coupleConnection, setCoupleConnection] = useState<CoupleConnectionState>(() =>
    resolveCoupleConnectionState(null),
  );
  const [codeCopied, setCodeCopied] = useState(false);
  const [resettingCouple, setResettingCouple] = useState(false);

  // 현재 데이터 로드
  useEffect(() => {
    const loadToken = settingsLoadGate.begin();

    setLoading(true);
    setLoadError(null);
    setSettingsSnapshot(null);
    setLegacyCareConsentActive(false);

    (async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          throw new Error("로그인이 만료됐어요. 다시 로그인한 뒤 시도해주세요.");
        }

        const settingsResponse = await apiFetch("/api/settings/wedding-profile");
        const settingsPayload = await settingsResponse.json().catch(() => ({}));
        if (!settingsResponse.ok) {
          const errorMessage =
            typeof settingsPayload === "object" &&
            settingsPayload !== null &&
            "error" in settingsPayload &&
            typeof settingsPayload.error === "string"
              ? settingsPayload.error
              : "설정을 불러오지 못했어요.";
          throw new Error(errorMessage);
        }
        const parsedSettings = parseWeddingSettingsResponse(settingsPayload);

        const profile = parsedSettings.profile;
        if (!profile || profile.id !== user.id) {
          throw new Error("내 프로필을 확인하지 못했어요.");
        }

        let nextPartnerName: string | null = null;
        let nextCoupleConnection = resolveCoupleConnectionState(null);
        let nextUsesNeutralMembers = false;

        // 파트너 정보 로드
        if (profile?.couple_id) {
          let partnerPresent = false;
          try {
            // 파트너 이름 조회
            const { data: partners } = await supabase
              .from("couple_profile_directory")
              .select("name")
              .eq("couple_id", profile.couple_id)
              .neq("id", user.id);

            // 컬럼이 없는 DB에서는 조회가 실패한다. 그 상태에선 중립 커플이
            // 존재할 수 없으므로 기존(v1)으로 본다.
            const { data: memberModel } = await supabase
              .from("couples")
              .select("member_model_version")
              .eq("id", profile.couple_id)
              .maybeSingle();
            nextUsesNeutralMembers = memberModel?.member_model_version === 2;

            partnerPresent = Boolean(partners && partners.length > 0);
            if (partners && partners.length > 0) {
              nextPartnerName = partners[0]?.name ?? null;
            }

            // 커플 초대 코드 조회
            const codeRes = await apiFetch("/api/couple/code");
            if (codeRes.ok) {
              const codeData = (await codeRes.json().catch(() => null)) as CoupleCodeResponse | null;
              nextCoupleConnection = resolveCoupleConnectionState(codeData, { partnerPresent });
            } else {
              nextCoupleConnection = resolveCoupleConnectionState(null, { partnerPresent });
            }
          } catch (err) {
            console.error("파트너 정보 로드 오류:", err);
            nextCoupleConnection = resolveCoupleConnectionState(null, { partnerPresent });
          }
        }

        const loadedData = parsedSettings.data;

        if (loadToken.isCurrent()) {
          setPartnerName(nextPartnerName);
          setCoupleConnection(nextCoupleConnection);
          setUsesNeutralMembers(nextUsesNeutralMembers);
          setLegacyCareConsentActive(hasActiveCareConsent(profile));
          setData(loadedData);
          setInitialData(loadedData);
          setSettingsSnapshot(parsedSettings.snapshot);
        }
      } catch (err) {
        console.error("설정 로드 오류:", err);
        if (loadToken.isCurrent()) {
          setLoadError(
            err instanceof Error && err.message.startsWith("로그인이 만료")
              ? err.message
              : "설정을 불러오지 못했어요. 연결을 확인한 뒤 다시 시도해주세요.",
          );
        }
      } finally {
        if (loadToken.isCurrent()) setLoading(false);
      }
    })();

    return () => loadToken.cancel();
  }, [loadAttempt, settingsLoadGate]);

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

  /**
   * 계획 변경(결혼 예정일·식장·총 예산)을 승인 경로로 보낸다.
   *
   * 웹 설정이 하는 것과 같은 경로다(`/api/journey` → `submit_couple_plan_change`).
   * 파트너가 연결돼 있으면 서버가 `pending_partner` 를 돌려주고, 그때는 아직 반영되지
   * 않았다고 말해야 한다 — 저장했다고 말하면 이 제품이 가장 하면 안 되는 거짓말이 된다.
   *
   * `expected_revision` 은 필수다(route.ts 가 없으면 400). 이 화면이 들고 있는 값에는
   * 없으므로 보내기 직전에 `/api/auth/me` 에서 현재 값을 읽는다.
   */
  async function submitWeddingPlanChange(
    changes: Record<string, string | number | null>,
  ): Promise<"applied" | "pending_partner"> {
    const meResponse = await apiFetch("/api/auth/me");
    const mePayload: unknown = await meResponse.json().catch(() => null);
    const revision =
      isRecord(mePayload) && isRecord(mePayload.journey)
        ? mePayload.journey.state_revision
        : null;
    if (!meResponse.ok || typeof revision !== "number") {
      throw new Error("결혼 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
    }

    const response = await apiFetch("/api/journey", {
      method: "PATCH",
      body: JSON.stringify({ expected_revision: revision, ...changes }),
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const message =
        isRecord(payload) && typeof payload.error === "string"
          ? payload.error
          : "결혼 정보를 저장하지 못했어요.";
      throw new Error(message);
    }
    return isRecord(payload) && payload.status === "pending_partner"
      ? "pending_partner"
      : "applied";
  }

  /** 계획 변경만 있었을 때의 마무리. 서버가 정본이므로 화면 값을 지어내지 않고 다시 읽는다. */
  async function reloadAfterPlanChange(
    outcome: "applied" | "pending_partner" | null,
  ) {
    // 파트너 확인을 기다리는 중이면 서버 값은 아직 예전 그대로다. 다시 읽어야
    // 화면이 "저장된 것처럼" 남아 있지 않는다.
    try {
      const refreshed = await apiFetch("/api/settings/wedding-profile");
      if (refreshed.ok) {
        const parsed = parseWeddingSettingsResponse(await refreshed.json());
        setData(parsed.data);
        setInitialData(parsed.data);
        setSettingsSnapshot(parsed.snapshot);
      }
    } catch (refreshError) {
      console.error("설정 다시 불러오기 실패:", refreshError);
    }

    if (outcome === "pending_partner") {
      Alert.alert(
        "상대방 확인을 기다려요",
        "결혼 정보 변경을 요청했어요. 두 분이 확인하기 전에는 반영되지 않아요.",
      );
      return;
    }
    setSaved(true);
    Animated.sequence([
      Animated.spring(checkScale, { toValue: 1, friction: 3, useNativeDriver: true }),
      Animated.timing(checkScale, { toValue: 0, duration: 1500, delay: 1000, useNativeDriver: true }),
    ]).start(() => setSaved(false));
  }

  async function handleSave() {
    if (!data || !settingsSnapshot) return;
    setSaving(true);

    try {
      const patch = buildWeddingSettingsPatch(data, settingsSnapshot);
      if (!patch) {
        if (initialData) setData(initialData);
        return;
      }

      // 결혼 예정일·식장·총 예산은 계획 변경 경로로만 쓸 수 있다. 옛 설정 경로로 같이
      // 보내면 DB 트리거가 셋 때문에 **저장 전체**를 거절해서, 같이 고친 이름까지 함께
      // 날아간다. 그래서 보내기 직전에 가른다 — 자세한 이유는 splitWeddingSettingsPatch.
      const { profilePatch, planChanges } = splitWeddingSettingsPatch(patch);
      const planOutcome = planChanges
        ? await submitWeddingPlanChange(planChanges)
        : null;

      if (!profilePatch) {
        await reloadAfterPlanChange(planOutcome);
        return;
      }

      const response = await apiFetch("/api/settings/wedding-profile", {
        method: "PATCH",
        body: JSON.stringify(profilePatch),
      });
      const responseBody = await response.json().catch(() => ({}));
      if (!response.ok) {
        const errorMessage =
          typeof responseBody === "object" &&
          responseBody !== null &&
          "error" in responseBody &&
          typeof responseBody.error === "string"
            ? responseBody.error
            : "설정을 저장하지 못했어요.";
        const errorCode =
          typeof responseBody === "object" &&
          responseBody !== null &&
          "code" in responseBody &&
          typeof responseBody.code === "string"
            ? responseBody.code
            : null;
        // 409에는 두 종류가 섞여 있다. 화면 데이터가 낡아 다시 불러와야 하는 경우에만
        // 로드 오류로 바꾼다. 저장이 거부된 것은 화면이 깨진 것이 아니므로, 그때
        // 화면을 통째로 날리면 사람이 방금 입력한 값까지 잃는다.
        if (response.status === 409 && errorCode === "SETTINGS_CHANGED") {
          setLoadError(errorMessage);
        }
        throw new Error(errorMessage);
      }

      const savedSettings = parseWeddingSettingsResponse(responseBody);
      setData(savedSettings.data);
      setInitialData(savedSettings.data);
      setSettingsSnapshot(savedSettings.snapshot);
      if ("name" in patch.changes || "community_nickname" in patch.changes) {
        clearCommunityCaches();
      }
      setSaved(true);

      // 체크마크 애니메이션
      Animated.sequence([
        Animated.spring(checkScale, { toValue: 1, friction: 3, useNativeDriver: true }),
        Animated.timing(checkScale, { toValue: 0, duration: 1500, delay: 1000, useNativeDriver: true }),
      ]).start(() => setSaved(false));
    } catch (err) {
      Alert.alert("오류", toKoreanErrorMessage(err, "저장 중 문제가 있었어요. 잠시 뒤 다시 시도해 주세요."));
    } finally {
      setSaving(false);
    }
  }

  async function handleRevokeLegacyCareConsent() {
    setRevokingLegacyCareConsent(true);
    try {
      const response = await apiFetch("/api/profile", {
        method: "PATCH",
        body: JSON.stringify({ care_notifications_enabled: false }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message =
          typeof payload === "object" &&
          payload !== null &&
          "error" in payload &&
          typeof payload.error === "string"
            ? payload.error
            : "수신 동의를 해제하지 못했어요.";
        throw new Error(message);
      }
      setLegacyCareConsentActive(false);
      Alert.alert("해제 완료", "이전 이메일 수신 동의를 해제했어요.");
    } catch (error) {
      Alert.alert(
        "해제 실패",
        error instanceof Error
          ? error.message
          : "수신 동의를 해제하지 못했어요. 잠시 후 다시 시도해주세요.",
      );
    } finally {
      setRevokingLegacyCareConsent(false);
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
      Alert.alert("오류", toKoreanErrorMessage(err, "비밀번호를 바꾸지 못했어요. 잠시 뒤 다시 시도해 주세요."));
    } finally {
      setPasswordSaving(false);
    }
  }

  // 초대 코드 복사
  async function copyInviteCode() {
    const inviteCode = coupleConnection.inviteCode;
    if (!inviteCode) return;
    try {
      await Clipboard.setStringAsync(inviteCode);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    } catch {
      Alert.alert("오류", "코드 복사에 실패했어요.");
    }
  }

  function handleStartNewCouple() {
    if (resettingCouple) return;

    Alert.alert(
      "새 커플로 다시 시작",
      "현재 커플 연결과 공유 준비 데이터를 분리하고 온보딩으로 돌아갑니다. 이 작업은 되돌릴 수 없어요.",
      [
        { text: "취소", style: "cancel" },
        {
          text: "계속",
          style: "destructive",
          onPress: async () => {
            setResettingCouple(true);
            try {
              const response = await apiFetch("/api/couple/reset", {
                method: "POST",
                body: JSON.stringify({ confirmText: "초기화합니다" }),
              });
              const payload = (await response.json().catch(() => ({}))) as { error?: string };
              if (!response.ok) {
                throw new Error(payload.error ?? "새 커플을 시작하지 못했어요.");
              }

              clearCommunityCaches();
              setPartnerName(null);
              setCoupleConnection(resolveCoupleConnectionState(null));
              setData((current) => current ? { ...current, coupleId: null } : current);
              setInitialData((current) => current ? { ...current, coupleId: null } : current);
              router.replace("/onboarding");
            } catch (error) {
              Alert.alert(
                "새 커플을 시작하지 못했어요",
                toKoreanErrorMessage(error, "잠시 후 다시 시도해 주세요."),
              );
            } finally {
              setResettingCouple(false);
            }
          },
        },
      ],
    );
  }

  async function performLogout() {
    if (loggingOut) return;

    setLoggingOut(true);
    setLogoutError(null);
    try {
      await signOut();
      router.replace("/(auth)/login");
    } catch {
      const message = "로그아웃하지 못했어요. 연결을 확인하고 다시 시도해주세요.";
      setLogoutError(message);
      if (Platform.OS !== "web") {
        Alert.alert("로그아웃 실패", message);
      }
    } finally {
      setLoggingOut(false);
    }
  }

  // 로그아웃
  function handleLogout() {
    if (Platform.OS === "web") {
      void performLogout();
      return;
    }

    Alert.alert("로그아웃", "정말 로그아웃 하시겠어요?", [
      { text: "취소", style: "cancel" },
      {
        text: "로그아웃",
        style: "destructive",
        onPress: () => void performLogout(),
      },
    ]);
  }

  // 회원 탈퇴
  function handleDeleteAccount() {
    Alert.alert(
      "회원 탈퇴",
      "계정과 직접 소유한 데이터 삭제를 요청해요. 안전 확인이 필요한 경우 완료까지 시간이 걸릴 수 있어요.",
      [
        { text: "취소", style: "cancel" },
        {
          text: "탈퇴하기",
          style: "destructive",
          onPress: () => {
            // 2차 확인
            Alert.alert(
              "최종 확인",
              "삭제 요청 후 로그아웃되며 새 파일 업로드가 제한돼요. 정말 진행하시겠어요?",
              [
                { text: "취소", style: "cancel" },
                {
                  text: "탈퇴 확인",
                  style: "destructive",
                  onPress: async () => {
                    try {
                      const {
                        data: { session: deletionSession },
                        error: deletionSessionError,
                      } = await supabase.auth.getSession();
                      if (deletionSessionError || !deletionSession?.user.id) {
                        throw new Error("계정의 기기 데이터를 안전하게 정리할 사용자를 확인하지 못했어요.");
                      }
                      const deletionOwnerId = deletionSession.user.id;
                      const res = await apiFetch("/api/auth/delete", {
                        method: "DELETE",
                        body: JSON.stringify({ reason: "mobile_request" }),
                      });
                      const body = (await res.json().catch(() => ({}))) as {
                        error?: string;
                        message?: string;
                        pending?: boolean;
                      };
                      if (!res.ok && !body.pending) {
                        throw new Error(
                          body.error ?? "탈퇴 요청을 시작하지 못했어요. 잠시 후 다시 시도해 주세요.",
                        );
                      }
                      const finishSignOut = async () => {
                        const { decisionDataPurged } = await signOut({
                          continueOnDecisionPurgeFailure: true,
                        });
                        router.replace("/(auth)/login");
                        if (!decisionDataPurged) {
                          Alert.alert(
                            "기기 임시 데이터 정리가 남아 있어요",
                            "계정 삭제 요청은 접수됐지만 이 기기의 비공개 결정 초안과 재시도 명령 정리는 아직 완료로 확인되지 않았어요.",
                            [
                              {
                                text: "다시 정리",
                                onPress: () => {
                                  void purgeCommunityDecisionPendingForOwnerWithRetry(
                                    deletionOwnerId,
                                  ).then(() => {
                                    Alert.alert(
                                      "기기 데이터 정리 완료",
                                      "이 계정의 비공개 결정 임시 데이터를 모두 정리했어요.",
                                    );
                                  }).catch(() => {
                                    Alert.alert(
                                      "기기 데이터 정리 미완료",
                                      "아직 안전하게 정리됐다고 확인할 수 없어요. 앱을 종료하지 말고 다시 시도해주세요.",
                                    );
                                  });
                                },
                              },
                            ],
                          );
                        }
                      };
                      if (body.pending) {
                        Alert.alert(
                          "삭제 요청 접수",
                          body.message
                            ?? "계정 삭제를 안전하게 처리 중이에요. 새 파일 업로드는 제한돼요.",
                          [{ text: "확인", onPress: finishSignOut }],
                        );
                        return;
                      }
                      await finishSignOut();
                    } catch (err) {
                      const message =
                        toKoreanErrorMessage(err, "탈퇴를 끝내지 못했어요. 잠시 뒤 다시 시도해 주세요.");
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

  // 중립 준비 공간에서는 role이 항상 채워지지만 사용자가 고른 값이 아니다.
  // "-"로 바꾸면 "설정 안 함"으로 읽히므로 필드 자체를 감춘다.
  const roleLabel = usesNeutralMembers
    ? null
    : data?.role === "bride"
      ? "신부"
      : data?.role === "groom"
        ? "신랑"
        : data?.role ?? "-";
  const phase = coupleConnection.phase;
  const inviteWindowNotice = describeCoupleInviteWindow(coupleConnection);
  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <AppHeader title="설정" onBack={() => router.back()} />
        <LoadingState label="설정을 불러오는 중이에요" />
      </SafeAreaView>
    );
  }

  if (loadError || !data || !initialData) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <AppHeader title="설정" onBack={() => router.back()} />
        <View style={styles.loadErrorContent}>
          <Surface style={styles.loadErrorCard}>
            <Text style={styles.loadErrorTitle}>설정을 열지 못했어요</Text>
            <Text style={styles.loadErrorDescription}>
              {loadError ?? "설정 정보를 확인하지 못했어요. 잠시 후 다시 시도해주세요."}
            </Text>
            <PrimaryButton
              tone="rose"
              onPress={() => setLoadAttempt((attempt) => attempt + 1)}
            >
              다시 시도
            </PrimaryButton>
          </Surface>
        </View>
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

          {roleLabel !== null && (
            <>
              <View style={styles.divider} />

              <View style={styles.field}>
                <Text style={styles.label}>역할</Text>
                <View style={styles.readOnlyField}>
                  <Text style={styles.readOnlyText}>{roleLabel}</Text>
                </View>
              </View>
            </>
          )}
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
            <Text style={styles.label}>결혼식장</Text>
            <TextInput
              style={[
                styles.textInput,
                focusedField === "venue" && styles.textInputFocused,
              ]}
              value={data?.venue ?? ""}
              onChangeText={(v) => updateField("venue", v)}
              placeholder="결혼식장 이름"
              placeholderTextColor={colors.taupe[400]}
              maxLength={120}
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

        {/* 아모라 기억 */}
        <View style={styles.sectionHeader}>
          <BrainCircuit size={16} color={colors.rose[500]} />
          <Text style={styles.sectionTitle}>아모라</Text>
        </View>
        <Surface style={styles.card}>
          <ActionRow
            icon={<BrainCircuit size={18} color={colors.noir[800]} />}
            title="아모라가 기억하는 것"
            description="기억 동의, 수정, 삭제를 직접 관리해요"
            onPress={() => router.push("/settings/amora-memory" as const)}
          />
        </Surface>

        {/* 섹션 3: 알림 설정 */}
        <View style={styles.sectionHeader}>
          <Bell size={16} color={colors.rose[500]} />
          <Text style={styles.sectionTitle}>알림 설정</Text>
        </View>
        <Surface style={styles.card}>
          <ActionRow
            icon={<Bell size={18} color={colors.noir[800]} />}
            title="기기 알림 설정"
            description="알림 허용 여부는 휴대폰 설정에서 바꿀 수 있어요"
            onPress={() => void Linking.openSettings()}
            right={<ExternalLink size={16} color={colors.taupe[400]} />}
          />
          <CommunityReplyPushPreferenceControl />
          <TodayOnePreferenceControl />
          {legacyCareConsentActive ? (
            <>
              <View style={styles.divider} />
              <ActionRow
                icon={<Bell size={18} color={colors.noir[800]} />}
                title="이전 이메일 수신 동의 해제"
                description="예전에 동의한 아모라 이메일 수신을 해제해요"
                onPress={() => void handleRevokeLegacyCareConsent()}
                disabled={revokingLegacyCareConsent}
                right={
                  revokingLegacyCareConsent
                    ? <ActivityIndicator size="small" color={colors.rose[500]} />
                    : undefined
                }
              />
            </>
          ) : null}
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
                  {phase === "linked"
                    ? partnerName ?? "연동됨"
                    : phase === "sealed_single"
                      ? "연결 종료"
                      : phase === "awaiting_partner"
                        ? "초대 대기"
                        : "확인 필요"}
                </Text>
              </View>

              <View style={styles.divider} />

              {phase === "awaiting_partner" ? (
                <View style={styles.field}>
                  {/* 코드가 `awaiting_partner`일 때만 이 자리에 온다. 카드 자체도
                      코드 형식을 다시 확인해서, 연결이 끝나 inviteCode가 null이 된
                      뒤에는 빈 QR이나 "null" 글자가 그려질 수 없다. 복사는 카드가
                      직접 하지 않고 아래 콜백을 부른다 — 소유자 확인을 거치는
                      경로가 이 화면에만 있어야 한다. */}
                  <InviteCodeCard
                    code={coupleConnection.inviteCode}
                    label="커플 초대 코드"
                    copied={codeCopied}
                    copyDisabled={!coupleConnection.canInvite}
                    onCopy={copyInviteCode}
                  />
                  {/* 기한은 코드를 보내는 이 자리에서 말해야 한다. main의 #136이
                      넣은 안내를 카드로 바꾸면서 지우면, 실사용 코드가 경고 없이
                      죽는다. 서버가 기한을 모르면 원래 안내 문구로 돌아간다. */}
                  <Text style={styles.fieldHint}>
                    {inviteWindowNotice?.message ?? "이 코드를 파트너에게 공유해 주세요"}
                  </Text>
                  {/* 두 사람이 각자 앱을 깔고 각자 "시작하기"를 누르면 둘 다 여기 서서
                      서로의 코드를 기다린다. 그 상태에서 상대 코드를 넣을 자리가 없으면
                      나갈 문이 없다 — 웹 설정에는 이 버튼이 단계와 무관하게 있는데
                      모바일에는 `sealed_single`(연결 종료)에만 있어서, 주 제품인 앱에서만
                      막혀 있었다. 온보딩은 이미 끝나 다시 열리지 않고, 서버는
                      `ALREADY_LINKED_TO_ANOTHER_COUPLE` 로 거절한다. */}
                  <Text style={[styles.fieldHint, styles.restartHint]}>
                    파트너도 따로 시작해서 각자 코드가 생겼다면, 한 사람이 다시 시작한 뒤
                    상대의 코드를 넣어 주세요.
                  </Text>
                  <Pressable
                    onPress={handleStartNewCouple}
                    disabled={resettingCouple}
                    accessibilityRole="button"
                    accessibilityLabel="현재 커플 연결을 끊고 새 커플로 다시 시작"
                    style={({ pressed }) => [styles.restartLink, pressed && { opacity: 0.6 }]}
                  >
                    <Text style={styles.restartLinkText}>
                      {resettingCouple ? "준비 중..." : "새 커플로 다시 시작"}
                    </Text>
                  </Pressable>
                </View>
              ) : phase === "linked" ? (
                <View style={styles.connectionNotice}>
                  <Text style={styles.connectionTitle}>파트너와 안전하게 연결되어 있어요</Text>
                  <Text style={styles.connectionBody}>두 분의 일정과 예산을 함께 관리할 수 있어요.</Text>
                </View>
              ) : phase === "sealed_single" ? (
                <View style={styles.connectionNotice}>
                  <Text style={styles.connectionTitle}>이 커플 연결은 종료됐어요</Text>
                  <Text style={styles.connectionBody}>
                    연결 기록을 보호하기 위해 새 멤버를 이 커플에 초대할 수 없어요. 새 커플로 다시 시작하거나 문제가 있으면 고객지원에 문의해 주세요.
                  </Text>
                  <PrimaryButton
                    tone="rose"
                    style={styles.restartButton}
                    onPress={handleStartNewCouple}
                    disabled={resettingCouple}
                    icon={resettingCouple ? <ActivityIndicator size="small" color="#FFFFFF" /> : undefined}
                  >
                    {resettingCouple ? "준비 중..." : "새 커플로 다시 시작"}
                  </PrimaryButton>
                  <Pressable
                    onPress={() => Linking.openURL(`mailto:${CONTACT.email}`)}
                    style={({ pressed }) => [styles.supportLink, pressed && { opacity: 0.6 }]}
                    accessibilityRole="link"
                  >
                    <Text style={styles.supportLinkText}>고객지원 문의</Text>
                  </Pressable>
                </View>
              ) : (
                <View style={styles.connectionNotice}>
                  <Text style={styles.connectionTitle}>연결 상태를 확인하지 못했어요</Text>
                  <Text style={styles.connectionBody}>
                    안전을 위해 새 멤버 초대는 잠시 멈췄어요. 다시 열어 보거나 고객지원에 문의해 주세요.
                  </Text>
                  <Pressable
                    onPress={() => Linking.openURL(`mailto:${CONTACT.email}`)}
                    style={({ pressed }) => [styles.supportLink, pressed && { opacity: 0.6 }]}
                    accessibilityRole="link"
                  >
                    <Text style={styles.supportLinkText}>고객지원 문의</Text>
                  </Pressable>
                </View>
              )}
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
            title={loggingOut ? "로그아웃 중" : "로그아웃"}
            onPress={handleLogout}
            disabled={loggingOut}
            right={
              loggingOut
                ? <ActivityIndicator size="small" color={colors.rose[500]} />
                : undefined
            }
          />
          {logoutError ? (
            <Text style={styles.inlineError} accessibilityRole="alert">
              {logoutError}
            </Text>
          ) : null}
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

          {/* 6슬라이드 서비스 안내는 만들어져 있었는데 여는 곳이 없었다. 첫 실행에는
              라운지 코치마크가 뜨므로, 이 안내는 보고 싶을 때 직접 여는 자리에 둔다. */}
          <ActionRow
            icon={<BookOpen size={18} color={colors.rose[500]} />}
            title="서비스 안내 다시 보기"
            description="웨딩한방을 어떻게 쓰는지 처음부터 볼 수 있어요"
            onPress={() => setGuideVisible(true)}
          />

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

          {/* 오픈소스 라이선스 행은 제거했다 — 대상 페이지(hanbang.ai)가 없어
              외부 브라우저로 404를 열고 있었고, 404는 저작자 표시를 제공하지 않는다.
              스토어 제출 전에 실제 고지 화면을 만들어 다시 넣어야 한다. */}
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

      {/* 서비스 안내 (사용자가 직접 열었을 때만 뜬다) */}
      <Modal
        visible={guideVisible}
        animationType="slide"
        onRequestClose={() => setGuideVisible(false)}
      >
        <AppGuide onClose={() => setGuideVisible(false)} />
      </Modal>

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
                accessibilityRole="button"
                accessibilityLabel="비밀번호 변경 창 닫기"
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

  loadErrorContent: {
    flex: 1,
    justifyContent: "center",
    padding: 20,
  },
  loadErrorCard: {
    borderColor: colors.border,
    borderWidth: 1,
    padding: 20,
    gap: 12,
  },
  loadErrorTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.noir[800],
    fontFamily: "NotoSerifKR_500Medium",
  },
  loadErrorDescription: {
    fontSize: 14,
    lineHeight: 21,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  inlineError: {
    marginTop: 12,
    fontSize: 13,
    lineHeight: 20,
    color: colors.danger,
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
  connectionNotice: {
    gap: 8,
    padding: 14,
    borderRadius: 14,
    backgroundColor: colors.ivory[200],
  },
  connectionTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.noir[800],
  },
  connectionBody: {
    fontSize: 13,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  restartButton: {
    marginTop: 4,
  },
  supportLink: {
    alignSelf: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  supportLinkText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.rose[500],
    textDecorationLine: "underline",
  },
  // 초대 대기 중의 복구 경로. 코드를 보내는 일이 먼저이므로 기본 버튼으로 올리지 않고
  // 링크로 둔다 — 다만 찾을 수는 있어야 한다.
  restartHint: { marginTop: 10 },
  restartLink: {
    alignSelf: "flex-start",
    paddingHorizontal: 2,
    paddingVertical: 8,
  },
  restartLinkText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.rose[500],
    textDecorationLine: "underline",
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
