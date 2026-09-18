import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Switch, View } from "react-native";
import { TextInput } from "@/components/ui/AppText";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import {
  BrainCircuit,
  Check,
  Lock,
  Pencil,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from "lucide-react-native";
import { colors, radius, spacing } from "@hanbang/design-tokens";
import { apiJsonForExpectedUser } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import {
  createOwnerCoupleSessionFence,
  type OwnerCoupleSessionToken,
} from "@/lib/ownerCoupleSessionFence.mjs";
import {
  AppHeader,
  AppText,
  EmptyState,
  LoadingState,
  PrimaryButton,
  StatusPill,
  Surface,
} from "@/components/ui/AppUI";
import {
  AMORA_MEMORY_PROFILE_HEADING,
  AMORA_MEMORY_SENSITIVE_NOTICE,
  memoryConsentHeading,
  memoryConsentStatus,
  memoryCorrectionLabel,
  memoryKindLabel,
  memoryProfileLines,
  type AmoraMemoryProfile,
  type AmoraMemoryVisibility,
} from "@/lib/amoraMemoryDisplay";

type Visibility = AmoraMemoryVisibility;

type MemorySetting = {
  visibility: Visibility;
  enabled: boolean;
  consentedByMe: boolean;
  consentedCount: number;
  requiredCount: number;
  legacyPurgedAt: string | null;
  pendingPurge: { memories: number; summaries: number; profiles: number; total: number };
};

/**
 * 켜는 순간 무엇이 사라지는지 사람 말로 옮긴다. 숫자는 서버가 SQL 의 DELETE 조건과
 * 같은 조건으로 센 값이고, 여기서 다시 계산하지 않는다. 웹 설정 화면과 같은 문장이다 —
 * 같은 상황에 두 화면이 다른 말을 하면 사용자는 무엇이 일어나는지 모른다.
 */
function describePendingPurge(setting: MemorySetting): string {
  const parts: string[] = [];
  if (setting.pendingPurge.memories > 0) parts.push(`정리된 기억 ${setting.pendingPurge.memories}개`);
  if (setting.pendingPurge.summaries > 0) parts.push(`대화 요약 ${setting.pendingPurge.summaries}개`);
  if (setting.pendingPurge.profiles > 0) parts.push("상담 참고 맥락");
  return parts.join(", ");
}

type MemoryItem = {
  id: string;
  visibility: Visibility;
  kind: string;
  title: string | null;
  value: unknown;
  userConfirmedAt: string | null;
  /** 사람이 고친 기억인가. 공유 기억을 한 사람이 고치면 `userConfirmedAt` 은 비워진다. */
  userCorrected?: boolean;
  updatedAt: string;
};

type MemoryResponse = {
  runtimeEnabled: boolean;
  settings: MemorySetting[];
  memories: MemoryItem[];
  /** 켜진 범위의 상담 참고 맥락. 옛 서버는 보내지 않는다. */
  profiles?: AmoraMemoryProfile[];
};

function valueToText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "내용을 확인해주세요";
}

export default function AmoraMemoryScreen() {
  const [data, setData] = useState<MemoryResponse | null>(null);
  const [activeVisibility, setActiveVisibility] = useState<Visibility>("shared");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<MemoryItem | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editValue, setEditValue] = useState("");
  const sessionFenceRef = useRef(createOwnerCoupleSessionFence()).current;
  const loadSequenceRef = useRef(0);

  // 계정·커플이 바뀌면 이전 identity에 묶인 화면 상태를 렌더 뒤가 아니라 즉시 비운다.
  const clearIdentityBoundState = useCallback(() => {
    setData(null);
    setActiveVisibility("shared");
    setEditing(null);
    setEditTitle("");
    setEditValue("");
    setError(null);
  }, []);

  const isOwnerCurrent = useCallback(async (sequence: number, ownerId: string) => {
    if (loadSequenceRef.current !== sequence) return false;
    const { data: sessionData } = await supabase.auth.getSession();
    return sessionData.session?.user.id.toLowerCase() === ownerId.toLowerCase()
      && loadSequenceRef.current === sequence;
  }, []);

  const isLoadCommitCurrent = useCallback(async (
    sequence: number,
    token: OwnerCoupleSessionToken,
  ) => {
    if (
      loadSequenceRef.current !== sequence
      || !sessionFenceRef.isCurrent(token)
    ) return false;
    const { data: sessionData } = await supabase.auth.getSession();
    return sessionData.session?.user.id.toLowerCase() === token.ownerId
      && loadSequenceRef.current === sequence
      && sessionFenceRef.isCurrent(token);
  }, [sessionFenceRef]);

  const load = useCallback(async () => {
    const sequence = loadSequenceRef.current + 1;
    loadSequenceRef.current = sequence;
    setLoading(true);
    setError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (loadSequenceRef.current !== sequence) return;
      const ownerId = sessionData.session?.user.id ?? null;
      if (sessionFenceRef.setOwner(ownerId)) clearIdentityBoundState();
      if (!ownerId) {
        clearIdentityBoundState();
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("couple_id")
        .eq("id", ownerId)
        .single();
      if (!(await isOwnerCurrent(sequence, ownerId))) return;

      if (!profile?.couple_id) {
        sessionFenceRef.clearCouple(ownerId);
        clearIdentityBoundState();
        setError("커플 연결을 확인한 뒤 기억을 볼 수 있어요.");
        return;
      }

      if (sessionFenceRef.setIdentity(ownerId, profile.couple_id)) {
        clearIdentityBoundState();
      }
      const token = sessionFenceRef.capture();
      if (!token || !(await isLoadCommitCurrent(sequence, token))) return;

      const payload = await apiJsonForExpectedUser<MemoryResponse>(
        token.ownerId,
        "/api/amora/memory",
      );
      // 응답을 기다리는 사이 계정이나 커플이 바뀌었으면 한 글자도 반영하지 않는다.
      if (!(await isLoadCommitCurrent(sequence, token))) return;
      setData(payload);
      const available = payload.settings.map((setting) => setting.visibility);
      setActiveVisibility((current) => available.includes(current) ? current : available[0] ?? "shared");
    } catch (loadError) {
      if (loadSequenceRef.current !== sequence) return;
      setError(loadError instanceof Error ? loadError.message : "기억을 불러오지 못했어요.");
    } finally {
      if (loadSequenceRef.current === sequence) setLoading(false);
    }
  }, [
    clearIdentityBoundState,
    isLoadCommitCurrent,
    isOwnerCurrent,
    sessionFenceRef,
  ]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    let disposed = false;
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        const ownerId = session?.user.id ?? null;
        if (!sessionFenceRef.setOwner(ownerId)) return;
        loadSequenceRef.current += 1;
        clearIdentityBoundState();
        setLoading(true);
        setTimeout(() => {
          if (!disposed) void load();
        }, 0);
      },
    );
    return () => {
      disposed = true;
      loadSequenceRef.current += 1;
      sessionFenceRef.setOwner(null);
      subscription.unsubscribe();
    };
  }, [clearIdentityBoundState, load, sessionFenceRef]);

  const setting = data?.settings.find((item) => item.visibility === activeVisibility);
  const memories = useMemo(
    () => (data?.memories ?? []).filter((item) => item.visibility === activeVisibility),
    [activeVisibility, data?.memories],
  );
  const profileLines = memoryProfileLines(data?.profiles, activeVisibility);

  async function patch(body: Record<string, unknown>) {
    // 쓰기도 같은 identity에 결박한다. 계정 전환 중이면 요청 자체를 보내지 않는다.
    const token = sessionFenceRef.capture();
    if (!token) {
      throw new Error("계정을 확인하고 있어요. 잠시 후 다시 시도해주세요.");
    }
    await apiJsonForExpectedUser(token.ownerId, "/api/amora/memory", {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  }

  async function applyMemoryToggle() {
    if (!setting) return;
    setBusy(true);
    setError(null);
    try {
      await patch({ action: "toggle", visibility: activeVisibility, enabled: !setting.consentedByMe });
      await load();
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "설정을 바꾸지 못했어요.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleMemory() {
    if (!setting || busy || (!data?.runtimeEnabled && !setting.consentedByMe)) return;
    // 처음 켜는 순간 서버가 기존 자동 기억·대화 요약·맞춤 맥락을 지운다. 되돌릴 수
    // 없으므로 무엇이 사라지는지 먼저 보여준다. 웹 설정 화면과 같은 사실을 말한다.
    const willPurge = !setting.consentedByMe
      && setting.legacyPurgedAt === null
      && setting.pendingPurge.total > 0;
    if (willPurge) {
      Alert.alert(
        activeVisibility === "shared"
          ? "두 분이 모두 켜면 지금 기록이 지워져요"
          : "켜면 지금 기록이 지워져요",
        `${describePendingPurge(setting)}. 되돌릴 수 없어요. 동의하기 전에 아모라가 혼자 정리해 둔 것이라, 켤 때는 지금부터 새로 쌓아요. 직접 고친 기억과 채팅 원문, 저장한 일정·예산은 그대로예요.`,
        [
          { text: "그대로 두기", style: "cancel" },
          { text: "지우고 켜기", style: "destructive", onPress: () => { void applyMemoryToggle(); } },
        ],
      );
      return;
    }
    await applyMemoryToggle();
  }

  function openEditor(memory: MemoryItem) {
    setEditing(memory);
    setEditTitle(memory.title ?? "");
    setEditValue(valueToText(memory.value));
  }

  async function saveMemory() {
    if (!editing || busy || !editTitle.trim() || !editValue.trim()) return;
    setBusy(true);
    try {
      await patch({
        action: "update_memory",
        visibility: activeVisibility,
        memoryId: editing.id,
        title: editTitle.trim(),
        value: editValue.trim(),
      });
      setEditing(null);
      await load();
    } catch (saveError) {
      Alert.alert("저장하지 못했어요", saveError instanceof Error ? saveError.message : "다시 시도해주세요.");
    } finally {
      setBusy(false);
    }
  }

  function confirmDelete(memory: MemoryItem) {
    Alert.alert(
      "이 기억을 지울까요?",
      "삭제한 항목은 백그라운드 작업이 다시 만들지 않아요.",
      [
        { text: "취소", style: "cancel" },
        {
          text: "삭제",
          style: "destructive",
          onPress: () => {
            void (async () => {
              setBusy(true);
              try {
                await patch({ action: "delete_memory", visibility: activeVisibility, memoryId: memory.id });
                await load();
              } catch (deleteError) {
                Alert.alert("삭제하지 못했어요", deleteError instanceof Error ? deleteError.message : "다시 시도해주세요.");
              } finally {
                setBusy(false);
              }
            })();
          },
        },
      ],
    );
  }

  function confirmClear() {
    Alert.alert(
      "이 범위의 기억을 초기화할까요?",
      "대화 요약과 맞춤 맥락도 지우고 기억 기능을 꺼요. 채팅 원문과 직접 저장한 일정·예산은 그대로예요.",
      [
        { text: "취소", style: "cancel" },
        {
          text: "모두 지우기",
          style: "destructive",
          onPress: () => {
            void (async () => {
              setBusy(true);
              try {
                await patch({ action: "clear_scope", visibility: activeVisibility });
                await load();
              } catch (clearError) {
                Alert.alert("초기화하지 못했어요", clearError instanceof Error ? clearError.message : "다시 시도해주세요.");
              } finally {
                setBusy(false);
              }
            })();
          },
        },
      ],
    );
  }

  if (loading && !data) {
    return (
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <AppHeader title="아모라 기억" onBack={() => router.back()} />
        <LoadingState label="아모라의 기억을 불러오는 중이에요" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      <AppHeader title="아모라 기억" subtitle="내가 직접 관리해요" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Surface tone="ivory" style={styles.introCard}>
          <View style={styles.introIcon}>
            <BrainCircuit size={20} color="#FFFFFF" />
          </View>
          <View style={styles.flex}>
            <AppText variant="bodyStrong">기억의 주인은 두 분이에요</AppText>
            <AppText variant="caption" style={styles.introCopy}>
              대화에서 직접 확정한 내용만 정리해요. 틀리면 고치고, 원치 않으면 언제든 지울 수 있어요.
            </AppText>
            <AppText variant="caption" style={styles.sensitiveNotice}>
              {AMORA_MEMORY_SENSITIVE_NOTICE}
            </AppText>
          </View>
        </Surface>

        {/* 서버가 runtimeEnabled=false 라고 말했을 때만. 불러오지 못한 것을 점검 중으로 읽지 않는다. */}
        {data && !data.runtimeEnabled ? (
          <Surface tone="ivory" style={styles.noticeCard}>
            <AppText variant="caption" style={styles.noticeText}>
              새 기억 연결은 최종 운영 점검 중이에요. 기존 기억의 확인·수정·삭제는 지금도 가능해요.
            </AppText>
          </Surface>
        ) : null}

        {/* 받은 것이 없으면 오류가 없어도(로그아웃 직후처럼 load 가 빈손으로 끝난 경우)
            빈 화면 대신 다시 불러올 길을 준다. */}
        {error || !data ? (
          <Surface tone="rose" style={styles.noticeCard}>
            <AppText variant="caption" style={styles.errorText}>{error ?? "기억을 불러오지 못했어요."}</AppText>
            <PrimaryButton tone="ghost" onPress={() => void load()} style={styles.retryButton}>다시 불러오기</PrimaryButton>
          </Surface>
        ) : null}

        {/* 아래는 모두 서버가 준 상태다. 받지 못했으면(첫 불러오기 실패·커플 확인 실패)
            켜짐·꺼짐·기억 개수를 지어내지 않는다 — 웹의 `error && !data` 와 같다. */}
        {data ? (
          <>
            {(data?.settings.length ?? 0) > 1 ? (
              <View style={styles.tabs} accessibilityRole="tablist">
                {data?.settings.map((item) => {
                  const active = activeVisibility === item.visibility;
                  const shared = item.visibility === "shared";
                  return (
                    <Pressable
                      key={item.visibility}
                      onPress={() => setActiveVisibility(item.visibility)}
                      style={[styles.tab, active && styles.tabActive]}
                      accessibilityRole="tab"
                      accessibilityState={{ selected: active }}
                    >
                      {shared
                        ? <Users size={16} color={active ? colors.noir[800] : colors.textSecondary} />
                        : <Lock size={15} color={active ? colors.noir[800] : colors.textSecondary} />}
                      <AppText variant="caption" style={active ? styles.tabTextActive : styles.tabText}>
                        {shared ? "둘이 함께" : "나만 상담"}
                      </AppText>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}

            <Surface style={styles.settingCard}>
              <View style={styles.settingRow}>
                <View style={styles.flex}>
                  {/* 스위치는 **내 동의**이고, 상태 문장은 실제로 켜졌는지(공유는 두 사람 모두
                      동의)다. 웹 설정 화면과 같은 문장이다. */}
                  <AppText variant="bodyStrong">{memoryConsentHeading(activeVisibility)}</AppText>
                  <AppText variant="caption" style={styles.settingDescription}>
                    {memoryConsentStatus(activeVisibility, setting)}
                  </AppText>
                </View>
                <Switch
                  value={setting?.consentedByMe === true}
                  onValueChange={() => void toggleMemory()}
                  disabled={busy || !setting || (!data?.runtimeEnabled && !setting.consentedByMe)}
                  trackColor={{ false: colors.ivory[200], true: colors.sage.pale }}
                  thumbColor={setting?.consentedByMe ? colors.success : colors.taupe[400]}
                  accessibilityLabel={memoryConsentHeading(activeVisibility)}
                />
              </View>
            </Surface>

            {profileLines.length > 0 ? (
              <Surface tone="ivory" style={styles.profileCard}>
                <View style={styles.profileTitleRow}>
                  <ShieldCheck size={18} color={colors.success} />
                  <AppText variant="bodyStrong">{AMORA_MEMORY_PROFILE_HEADING}</AppText>
                </View>
                {profileLines.map((line, index) => (
                  <AppText key={`${line}-${index}`} variant="body" style={styles.profileLine}>
                    {`• ${line}`}
                  </AppText>
                ))}
              </Surface>
            ) : null}

            <View style={styles.listHeader}>
              <View>
                <AppText variant="subtitle">정리된 기억 {memories.length}개</AppText>
                <AppText variant="caption">직접 고친 기억은 자동으로 덮어쓰지 않아요</AppText>
              </View>
              <Pressable
                onPress={confirmClear}
                disabled={busy || !setting}
                style={styles.clearButton}
                accessibilityRole="button"
              >
                <AppText variant="caption" style={styles.clearText}>기억 초기화</AppText>
              </Pressable>
            </View>

            {memories.length === 0 ? (
              <Surface>
                <EmptyState
                  icon={<BrainCircuit size={28} color={colors.textTertiary} />}
                  title="아직 정리된 기억이 없어요"
                  description="기억을 켜고 대화하면 직접 확정한 내용만 천천히 쌓여요."
                />
              </Surface>
            ) : (
              <View style={styles.memoryList}>
                {memories.map((memory) => {
                  const correction = memoryCorrectionLabel(memory, activeVisibility);
                  return (
                    <Surface key={memory.id} style={styles.memoryCard}>
                      <View style={styles.memoryMeta}>
                        <StatusPill label={memoryKindLabel(memory.kind)} tone="rose" />
                        {/* `userConfirmedAt` 이 아니라 사람이 고쳤는지를 본다. 공유 기억을 한 사람이
                            고친 것은 공동 확인이 아니므로 그렇게 적는다. */}
                        {correction ? (
                          <View style={styles.confirmedLabel}>
                            <Check size={13} color={colors.success} />
                            <AppText variant="caption" style={styles.confirmedText}>{correction}</AppText>
                          </View>
                        ) : null}
                      </View>
                      <AppText variant="bodyStrong" style={styles.memoryTitle}>{memory.title ?? "기억"}</AppText>
                      <AppText variant="body" style={styles.memoryValue}>{valueToText(memory.value)}</AppText>
                      <View style={styles.memoryActions}>
                        <Pressable
                          onPress={() => openEditor(memory)}
                          style={styles.iconButton}
                          accessibilityRole="button"
                          accessibilityLabel="기억 고치기"
                        >
                          <Pencil size={17} color={colors.rose[600]} />
                        </Pressable>
                        <Pressable
                          onPress={() => confirmDelete(memory)}
                          disabled={busy}
                          style={styles.iconButton}
                          accessibilityRole="button"
                          accessibilityLabel="기억 삭제"
                        >
                          <Trash2 size={17} color={colors.danger} />
                        </Pressable>
                      </View>
                    </Surface>
                  );
                })}
              </View>
            )}
          </>
        ) : null}

        <View style={styles.privacyNote}>
          <ShieldCheck size={16} color={colors.success} />
          <AppText variant="caption" style={styles.flex}>
            기억 초기화는 채팅 원문이나 직접 저장한 일정·예산을 지우지 않아요.
          </AppText>
        </View>
      </ScrollView>

      <Modal visible={editing !== null} transparent animationType="fade" onRequestClose={() => setEditing(null)}>
        <View style={styles.modalBackdrop}>
          <Surface style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <AppText variant="subtitle">기억 고치기</AppText>
              <Pressable onPress={() => setEditing(null)} style={styles.iconButton} accessibilityLabel="닫기">
                <X size={20} color={colors.noir[800]} />
              </Pressable>
            </View>
            <AppText variant="caption">내가 고친 값은 아모라가 자동으로 덮어쓰지 않아요.</AppText>
            <TextInput
              value={editTitle}
              onChangeText={setEditTitle}
              maxLength={60}
              placeholder="기억 제목"
              placeholderTextColor={colors.paper.inkFaint}
              style={styles.input}
            />
            <TextInput
              value={editValue}
              onChangeText={setEditValue}
              maxLength={160}
              multiline
              placeholder="기억 내용"
              placeholderTextColor={colors.paper.inkFaint}
              style={[styles.input, styles.textarea]}
            />
            <PrimaryButton
              tone="rose"
              disabled={busy || !editTitle.trim() || !editValue.trim()}
              onPress={() => void saveMemory()}
            >
              저장
            </PrimaryButton>
          </Surface>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing[5], paddingBottom: 48, gap: spacing[4] },
  flex: { flex: 1 },
  introCard: { flexDirection: "row", alignItems: "flex-start", gap: spacing[3] },
  introIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.xl,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.rose[600],
  },
  introCopy: { marginTop: spacing[1], color: colors.textSecondary },
  sensitiveNotice: { marginTop: spacing[2], color: colors.textSecondary },
  noticeCard: { gap: spacing[3] },
  noticeText: { color: colors.noir[800] },
  errorText: { color: colors.dangerDeep },
  retryButton: { alignSelf: "flex-start" },
  tabs: {
    minHeight: 48,
    flexDirection: "row",
    padding: 4,
    borderRadius: radius.xl,
    backgroundColor: colors.ivory[200],
  },
  tab: {
    flex: 1,
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[2],
    borderRadius: radius.lg,
  },
  tabActive: { backgroundColor: colors.surface },
  tabText: { color: colors.textSecondary },
  tabTextActive: { color: colors.noir[800], fontFamily: "NotoSansKR_600SemiBold" },
  settingCard: { paddingVertical: spacing[4] },
  settingRow: { flexDirection: "row", alignItems: "center", gap: spacing[4] },
  settingDescription: { marginTop: spacing[1], color: colors.textSecondary },
  profileCard: { gap: spacing[2] },
  profileTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
  profileLine: { color: colors.textSecondary },
  listHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing[3] },
  clearButton: { minHeight: 44, justifyContent: "center", paddingHorizontal: spacing[2] },
  clearText: { color: colors.dangerDeep, fontFamily: "NotoSansKR_600SemiBold" },
  memoryList: { gap: spacing[3] },
  memoryCard: { padding: spacing[4] },
  // "한 사람이 직접 고침 · 공동 확인 아님" 은 320px 에서 라벨 옆에 다 안 들어간다 — 줄을 넘긴다.
  memoryMeta: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing[2] },
  confirmedLabel: { flexDirection: "row", alignItems: "center", gap: 3, flexShrink: 1 },
  confirmedText: { color: colors.sage.deep, flexShrink: 1 },
  memoryTitle: { marginTop: spacing[3] },
  memoryValue: { marginTop: spacing[1], color: colors.textSecondary },
  memoryActions: { marginTop: spacing[3], flexDirection: "row", justifyContent: "flex-end", gap: spacing[2] },
  iconButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.full },
  privacyNote: { flexDirection: "row", alignItems: "center", gap: spacing[2], paddingHorizontal: spacing[2] },
  modalBackdrop: {
    flex: 1,
    justifyContent: "center",
    padding: spacing[5],
    backgroundColor: "rgba(36, 56, 50, 0.45)",
  },
  modalCard: { gap: spacing[4] },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    backgroundColor: colors.ivory[100],
    paddingHorizontal: spacing[4],
    color: colors.noir[800],
    fontFamily: "NotoSansKR_400Regular",
    fontSize: 15,
  },
  textarea: { minHeight: 104, paddingTop: spacing[3], textAlignVertical: "top" },
});
