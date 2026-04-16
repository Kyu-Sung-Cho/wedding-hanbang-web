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
  Keyboard,
  Switch,
  Modal,
} from "react-native";
import DismissKeyboard from "@/components/DismissKeyboard";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import {
  ArrowLeft,
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
  ChevronRight,
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
import AsyncStorage from "@react-native-async-storage/async-storage";

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

        // 커뮤니티 프로필 (별명)
        let communityNickname = "";
        const { data: communityProfile } = await supabase
          .from("community_profiles")
          .select("nickname")
          .eq("user_id", user.id)
          .maybeSingle();

        if (communityProfile) {
          communityNickname = communityProfile.nickname ?? "";
        } else {
          // 커뮤니티 프로필 자동 생성 (이름 기반 초기 별명)
          const initialNick = profile?.name ?? "유저" + user.id.slice(0, 4);
          await supabase.from("community_profiles").insert({
            user_id: user.id,
            nickname: initialNick,
          }).then(() => {});
          communityNickname = initialNick;
        }

        // 파트너 정보 로드
        if (profile?.couple_id) {
          try {
            // 파트너 이름 조회
            const { data: partners } = await supabase
              .from("profiles")
              .select("name")
              .eq("couple_id", profile.couple_id)
              .neq("id", user.id);

            if (partners && partners.length > 0) {
              setPartnerName(partners[0]?.name ?? null);
            }

            // 커플 초대 코드 조회
            const codeRes = await apiFetch("/api/couple/code");
            if (codeRes.ok) {
              const codeData = await codeRes.json();
              setInviteCode(codeData.inviteCode ?? null);
              setIsFullyLinked(codeData.isFullyLinked ?? false);
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
    data.weddingDate !== initialData.weddingDate ||
    data.venue !== initialData.venue ||
    data.totalBudget !== initialData.totalBudget
  );

  async function handleSave() {
    if (!data) return;
    setSaving(true);

    try {
      // 프로필 업데이트 (실명)
      const { error: profileError } = await supabase
        .from("profiles")
        .update({ name: data.nickname })
        .eq("id", data.userId);

      if (profileError) throw profileError;

      // 커뮤니티 별명 업데이트
      if (data.communityNickname) {
        await supabase
          .from("community_profiles")
          .update({ nickname: data.communityNickname })
          .eq("user_id", data.userId);
      }

      // 결혼 정보 업데이트
      if (data.coupleId) {
        const budgetNum = data.totalBudget
          ? parseInt(data.totalBudget, 10)
          : null;

        const { error: journeyError } = await supabase
          .from("wedding_journeys")
          .update({
            wedding_date: data.weddingDate || null,
            venue: data.venue || null,
            total_budget:
              budgetNum && !isNaN(budgetNum) ? budgetNum : null,
          })
          .eq("couple_id", data.coupleId);

        if (journeyError) throw journeyError;
      }

      setInitialData(data);
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
      "정말 탈퇴하시겠어요?\n모든 데이터가 삭제되며 복구할 수 없어요.",
      [
        { text: "취소", style: "cancel" },
        {
          text: "탈퇴하기",
          style: "destructive",
          onPress: () => {
            // 2차 확인
            Alert.alert(
              "최종 확인",
              "한번 삭제된 계정은 복구할 수 없습니다.\n정말 탈퇴하시겠어요?",
              [
                { text: "취소", style: "cancel" },
                {
                  text: "탈퇴 확인",
                  style: "destructive",
                  onPress: async () => {
                    try {
                      const { data: { session } } = await supabase.auth.getSession();
                      if (!session?.access_token) {
                        Alert.alert("오류", "로그인 상태를 확인해주세요.");
                        return;
                      }

                      const res = await fetch(
                        `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/delete-account`,
                        {
                          method: "POST",
                          headers: {
                            Authorization: `Bearer ${session.access_token}`,
                            "Content-Type": "application/json",
                          },
                        }
                      );

                      if (!res.ok) {
                        const body = await res.json().catch(() => ({}));
                        throw new Error(body.message ?? "탈퇴 처리 중 오류가 발생했어요");
                      }

                      await supabase.auth.signOut();
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
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <ArrowLeft size={24} color={colors.noir[800]} />
          </Pressable>
          <Text style={styles.headerTitle}>설정</Text>
          <View style={{ width: 24 }} />
        </View>
        <ActivityIndicator
          color={colors.rose[500]}
          style={{ marginTop: 40 }}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      {/* 헤더 */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <ArrowLeft size={24} color={colors.noir[800]} />
        </Pressable>
        <Text style={styles.headerTitle}>설정</Text>
        <View style={{ width: 24 }} />
      </View>

      <DismissKeyboard>
      <ScrollView contentContainerStyle={styles.content}>
        {/* 섹션 1: 프로필 */}
        <View style={styles.sectionHeader}>
          <User size={16} color={colors.rose[500]} />
          <Text style={styles.sectionTitle}>프로필</Text>
        </View>
        <View style={styles.card}>
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
        </View>

        {/* 섹션 2: 결혼 정보 */}
        <View style={styles.sectionHeader}>
          <Heart size={16} color={colors.rose[500]} />
          <Text style={styles.sectionTitle}>결혼 정보</Text>
        </View>
        <View style={styles.card}>
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
        </View>

        {/* 저장 버튼 */}
        <Pressable
          style={({ pressed }) => [
            styles.saveBtn,
            !hasChanges && !saved && styles.saveBtnDisabled,
            pressed && hasChanges && { transform: [{ scale: 0.98 }] },
          ]}
          onPress={handleSave}
          disabled={saving || !hasChanges}
        >
          {saving ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : saved ? (
            <Animated.View style={[styles.saveBtnContent, { transform: [{ scale: checkScale }] }]}>
              <Check size={18} color="#FFFFFF" />
              <Text style={styles.saveBtnText}>저장 완료</Text>
            </Animated.View>
          ) : (
            <View style={styles.saveBtnContent}>
              <Save size={18} color="#FFFFFF" />
              <Text style={styles.saveBtnText}>저장하기</Text>
            </View>
          )}
        </Pressable>

        {/* 섹션 3: 알림 설정 */}
        <View style={styles.sectionHeader}>
          <Bell size={16} color={colors.rose[500]} />
          <Text style={styles.sectionTitle}>알림 설정</Text>
        </View>
        <View style={styles.card}>
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
        </View>

        {/* 섹션 4: 파트너 관리 */}
        {data?.coupleId && (
          <>
            <View style={styles.sectionHeader}>
              <Users size={16} color={colors.rose[500]} />
              <Text style={styles.sectionTitle}>파트너 관리</Text>
            </View>
            <View style={styles.card}>
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
            </View>
          </>
        )}

        {/* 섹션 5: 계정 관리 */}
        <View style={styles.sectionHeader}>
          <Shield size={16} color={colors.rose[500]} />
          <Text style={styles.sectionTitle}>계정 관리</Text>
        </View>
        <View style={styles.card}>
          <Pressable
            style={({ pressed }) => [styles.actionRow, pressed && { opacity: 0.6 }]}
            onPress={() => {
              setNewPassword("");
              setConfirmPassword("");
              setShowNewPassword(false);
              setShowConfirmPassword(false);
              setPasswordModalVisible(true);
            }}
          >
            <View style={styles.actionRowLeft}>
              <Lock size={18} color={colors.noir[800]} />
              <Text style={styles.actionRowText}>비밀번호 변경</Text>
            </View>
            <ChevronRight size={18} color={colors.taupe[400]} />
          </Pressable>

          <View style={styles.divider} />

          <Pressable
            style={({ pressed }) => [styles.actionRow, pressed && { opacity: 0.6 }]}
            onPress={handleLogout}
          >
            <View style={styles.actionRowLeft}>
              <LogOut size={18} color={colors.noir[800]} />
              <Text style={styles.actionRowText}>로그아웃</Text>
            </View>
            <ChevronRight size={18} color={colors.taupe[400]} />
          </Pressable>
        </View>

        {/* 섹션 6: 앱 정보 */}
        <View style={styles.sectionHeader}>
          <Smartphone size={16} color={colors.rose[500]} />
          <Text style={styles.sectionTitle}>앱 정보</Text>
        </View>
        <View style={styles.card}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>버전</Text>
            <Text style={styles.infoValue}>1.0.0</Text>
          </View>

          <View style={styles.divider} />

          <Pressable
            style={({ pressed }) => [styles.linkRow, pressed && { opacity: 0.6 }]}
            onPress={() => Linking.openURL("https://hanbang.ai/terms")}
          >
            <Text style={styles.linkText}>이용약관</Text>
            <ExternalLink size={16} color={colors.taupe[400]} />
          </Pressable>

          <View style={styles.divider} />

          <Pressable
            style={({ pressed }) => [styles.linkRow, pressed && { opacity: 0.6 }]}
            onPress={() => Linking.openURL("https://hanbang.ai/privacy")}
          >
            <Text style={styles.linkText}>개인정보처리방침</Text>
            <ExternalLink size={16} color={colors.taupe[400]} />
          </Pressable>

          <View style={styles.divider} />

          <Pressable
            style={({ pressed }) => [styles.linkRow, pressed && { opacity: 0.6 }]}
            onPress={() => Linking.openURL("https://hanbang.ai/licenses")}
          >
            <View style={styles.actionRowLeft}>
              <FileText size={16} color={colors.noir[800]} />
              <Text style={styles.linkText}>오픈소스 라이선스</Text>
            </View>
            <ExternalLink size={16} color={colors.taupe[400]} />
          </Pressable>
        </View>

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
            <Pressable
              style={({ pressed }) => [
                styles.modalSaveBtn,
                (!newPassword.trim() || newPassword.length < 6 || newPassword !== confirmPassword) &&
                  styles.saveBtnDisabled,
                pressed && { transform: [{ scale: 0.98 }] },
              ]}
              onPress={handleChangePassword}
              disabled={
                passwordSaving ||
                !newPassword.trim() ||
                newPassword.length < 6 ||
                newPassword !== confirmPassword
              }
            >
              {passwordSaving ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.saveBtnText}>변경하기</Text>
              )}
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },

  // 헤더
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: colors.noir[800],
    fontFamily: "NotoSerifKR_500Medium",
  },

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
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 20,
    padding: 16,
    marginBottom: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
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

  // 저장 버튼
  saveBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 16,
    borderRadius: 16,
    backgroundColor: colors.rose[500],
    marginBottom: 24,
  },
  saveBtnDisabled: {
    backgroundColor: colors.taupe[400],
    opacity: 0.5,
  },
  saveBtnContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  saveBtnText: { fontSize: 16, fontWeight: "600", color: "#FFFFFF" },

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
    letterSpacing: 2,
  },
  copyBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.rose.glow,
    alignItems: "center",
    justifyContent: "center",
  },

  // 계정 관리 행
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 6,
  },
  actionRowLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  actionRowText: {
    fontSize: 15,
    fontWeight: "500",
    color: colors.noir[800],
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

  // 링크 행
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 4,
  },
  linkText: { fontSize: 15, color: colors.noir[800] },

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
  modalSaveBtn: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    borderRadius: 16,
    backgroundColor: colors.rose[500],
    marginTop: 8,
  },
});
