import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from "react-native";
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
import { apiJson } from "@/lib/api";
import {
  AppHeader,
  AppText,
  EmptyState,
  LoadingState,
  PrimaryButton,
  StatusPill,
  Surface,
} from "@/components/ui/AppUI";

type Visibility = "shared" | "bride_private" | "groom_private";

type MemorySetting = {
  visibility: Visibility;
  enabled: boolean;
  consentedByMe: boolean;
  consentedCount: number;
  requiredCount: number;
};

type MemoryItem = {
  id: string;
  visibility: Visibility;
  kind: string;
  title: string | null;
  value: unknown;
  userConfirmedAt: string | null;
  updatedAt: string;
};

type MemoryResponse = {
  runtimeEnabled: boolean;
  settings: MemorySetting[];
  memories: MemoryItem[];
};

const KIND_LABELS: Record<string, string> = {
  decision: "확정한 선택",
  preference: "선호",
  constraint: "꼭 지킬 조건",
  relationship: "가족·커플 맥락",
  fact: "준비 정보",
  legacy: "이전 대화 기억",
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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await apiJson<MemoryResponse>("/api/amora/memory");
      setData(payload);
      const available = payload.settings.map((setting) => setting.visibility);
      setActiveVisibility((current) => available.includes(current) ? current : available[0] ?? "shared");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "기억을 불러오지 못했어요.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const setting = data?.settings.find((item) => item.visibility === activeVisibility);
  const memories = useMemo(
    () => (data?.memories ?? []).filter((item) => item.visibility === activeVisibility),
    [activeVisibility, data?.memories],
  );

  async function patch(body: Record<string, unknown>) {
    await apiJson("/api/amora/memory", {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  }

  async function toggleMemory() {
    if (!setting || busy || (!data?.runtimeEnabled && !setting.consentedByMe)) return;
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
          </View>
        </Surface>

        {!data?.runtimeEnabled ? (
          <Surface tone="ivory" style={styles.noticeCard}>
            <AppText variant="caption" style={styles.noticeText}>
              새 기억 연결은 최종 운영 점검 중이에요. 기존 기억의 확인·수정·삭제는 지금도 가능해요.
            </AppText>
          </Surface>
        ) : null}

        {error ? (
          <Surface tone="rose" style={styles.noticeCard}>
            <AppText variant="caption" style={styles.errorText}>{error}</AppText>
            <PrimaryButton tone="ghost" onPress={() => void load()} style={styles.retryButton}>다시 불러오기</PrimaryButton>
          </Surface>
        ) : null}

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
              <View style={styles.settingTitleRow}>
                <AppText variant="bodyStrong">대화 기억</AppText>
                <StatusPill
                  label={data?.runtimeEnabled ? setting?.enabled ? "켜짐" : "꺼짐" : "준비 중"}
                  tone={setting?.enabled ? "success" : "neutral"}
                />
              </View>
              <AppText variant="caption" style={styles.settingDescription}>
                {activeVisibility === "shared"
                  ? setting?.enabled
                    ? "두 분 모두 동의했어요."
                    : setting?.consentedByMe
                      ? `내 동의 저장됨 · 상대방 대기 (${setting.consentedCount}/${setting.requiredCount})`
                      : "공유 기억은 두 분 모두 동의해야 해요."
                  : "개인 상담 기억은 파트너에게 보이지 않아요."}
              </AppText>
            </View>
            <Switch
              value={setting?.consentedByMe === true}
              onValueChange={() => void toggleMemory()}
              disabled={busy || !setting || (!data?.runtimeEnabled && !setting.consentedByMe)}
              trackColor={{ false: colors.ivory[200], true: colors.sage.pale }}
              thumbColor={setting?.consentedByMe ? colors.success : colors.taupe[400]}
              accessibilityLabel="아모라 대화 기억"
            />
          </View>
        </Surface>

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
            {memories.map((memory) => (
              <Surface key={memory.id} style={styles.memoryCard}>
                <View style={styles.memoryMeta}>
                  <StatusPill label={KIND_LABELS[memory.kind] ?? "대화 기억"} tone="rose" />
                  {memory.userConfirmedAt ? (
                    <View style={styles.confirmedLabel}>
                      <Check size={13} color={colors.success} />
                      <AppText variant="caption" style={styles.confirmedText}>직접 확인</AppText>
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
            ))}
          </View>
        )}

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
              placeholderTextColor={colors.textTertiary}
              style={styles.input}
            />
            <TextInput
              value={editValue}
              onChangeText={setEditValue}
              maxLength={160}
              multiline
              placeholder="기억 내용"
              placeholderTextColor={colors.textTertiary}
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
  noticeCard: { gap: spacing[3] },
  noticeText: { color: colors.noir[800] },
  errorText: { color: colors.danger },
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
  settingTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
  settingDescription: { marginTop: spacing[1], color: colors.textSecondary },
  listHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing[3] },
  clearButton: { minHeight: 44, justifyContent: "center", paddingHorizontal: spacing[2] },
  clearText: { color: colors.danger, fontFamily: "NotoSansKR_600SemiBold" },
  memoryList: { gap: spacing[3] },
  memoryCard: { padding: spacing[4] },
  memoryMeta: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
  confirmedLabel: { flexDirection: "row", alignItems: "center", gap: 3 },
  confirmedText: { color: colors.success },
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
