import { useRef, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Text, TextInput } from "@/components/ui/AppText";
import { router } from "expo-router";
import * as Crypto from "expo-crypto";
import { colors, spacing, radius } from "@hanbang/design-tokens";
import { isPersonalActionId, normalizePersonalActionDraft, parsePersonalActionDraftMetadata, parsePersonalActionsViewMetadata } from "@hanbang/shared/amora-personal-actions";
import { usePersonalActions } from "@/lib/usePersonalActions";

export function PersonalActionSave({ ownerId, coupleId, messageId, content, personalActionDraft, personalActionsView }: { ownerId: string; coupleId: string; messageId: string; content: string; personalActionDraft?: unknown; personalActionsView?: unknown }) {
  const data = usePersonalActions(ownerId, false);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [saved, setSaved] = useState(false);
  const submitting = useRef(false);
  const initialized = useRef(false);
  const request = useRef<{ fingerprint: string; id: string } | null>(null);
  if (data.ownerId !== ownerId || !isPersonalActionId(messageId) || !isPersonalActionId(coupleId)) return null;
  const draft = normalizePersonalActionDraft({ title, description, dueDate });
  const busy = data.busyIds.includes(messageId);
  const openPreview = () => {
    if (!initialized.current) {
      const suggestion = parsePersonalActionDraftMetadata(personalActionDraft);
      if (suggestion) { setTitle(suggestion.title); setDescription(suggestion.description ?? ""); setDueDate(suggestion.dueDate ?? ""); }
      initialized.current = true;
    }
    setOpen(true);
  };
  const confirm = async () => {
    if (!draft || submitting.current || data.session.getState().ownerId !== ownerId) return;
    submitting.current = true;
    const fingerprint = JSON.stringify(draft);
    if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, id: Crypto.randomUUID() };
    try {
      const result = await data.session.save(messageId, coupleId, draft, request.current.id);
      if (result && data.session.getState().ownerId === ownerId) { setSaved(true); setOpen(false); }
    } finally { submitting.current = false; }
  };
  const close = () => { if (!busy) setOpen(false); };
  return <View>
    {parsePersonalActionsViewMetadata(personalActionsView) && <Text style={styles.hint}>개인 목록에서 진행·완료 상태와 이어서 상담할 할 일을 확인해 주세요.</Text>}
    {saved ? <View><Text accessibilityLiveRegion="polite" style={styles.hint}>개인 할 일을 저장했어요.</Text><Pressable accessibilityRole="button" onPress={() => router.push("/amora-personal")} style={styles.link}><Text style={styles.linkText}>개인 목록 확인</Text></Pressable></View>
      : <Pressable accessibilityRole="button" onPress={openPreview} style={styles.link}><Text style={styles.linkText}>개인 할 일로 저장</Text></Pressable>}
    {!saved && <Pressable accessibilityRole="button" onPress={() => router.push("/amora-personal")} style={styles.link}><Text style={styles.linkText}>개인 목록 보기</Text></Pressable>}
    <Modal visible={open} transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.sheet} accessibilityViewIsModal>
          <View style={styles.header}><Text accessibilityRole="header" style={styles.title}>개인 할 일로 저장할까요?</Text><Pressable accessibilityRole="button" accessibilityLabel="개인 저장 창 닫기" onPress={close} disabled={busy} style={styles.link}><Text>닫기</Text></Pressable></View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
            <Text style={styles.hint}>나만 보는 할 일이에요. 상대에게 공유하거나 알림을 보내지 않아요.</Text>
            <Text style={styles.preview}>{Array.from(content).slice(0, 500).join("")}</Text>
            <Text style={styles.label}>할 일 제목 · 필수</Text>
            <TextInput accessibilityLabel="할 일 제목" value={title} onChangeText={setTitle} maxLength={120} editable={!busy} placeholder="내가 직접 할 일을 적어 주세요" style={styles.input} />
            <Text style={styles.label}>내용 · 선택</Text>
            <TextInput accessibilityLabel="개인 할 일 내용" value={description} onChangeText={setDescription} maxLength={500} editable={!busy} multiline style={[styles.input, styles.multiline]} />
            <Text style={styles.label}>마감일 · 선택 (YYYY-MM-DD)</Text>
            <TextInput accessibilityLabel="개인 할 일 마감일 YYYY-MM-DD" value={dueDate} onChangeText={setDueDate} maxLength={10} editable={!busy} placeholder="예: 2026-09-10" autoCapitalize="none" style={styles.input} />
            {!!dueDate && !draft && <Text style={styles.hint}>제목과 날짜 형식을 확인해 주세요.</Text>}
            <Text style={styles.hint}>공유 예산·일정·체크리스트는 바뀌지 않아요. 연결된 개인 상담 답변이나 질문을 영구 삭제하면 이 할 일도 삭제돼요.</Text>
          </ScrollView>
          {data.writeError && <Text accessibilityRole="alert" style={styles.error}>{data.writeError}</Text>}
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: !draft || busy, busy }} disabled={!draft || busy} onPress={() => void confirm()} style={[styles.confirm, (!draft || busy) && styles.disabled]}><Text style={styles.confirmText}>{busy ? "저장하는 중…" : "개인 할 일 저장"}</Text></Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  </View>;
}

const styles = StyleSheet.create({
  link: { minHeight: 44, justifyContent: "center", paddingHorizontal: 8 },
  linkText: { fontSize: 12, color: colors.rose[600], textDecorationLine: "underline" },
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: { maxHeight: "92%", padding: spacing[4], paddingBottom: spacing[6], borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, backgroundColor: colors.bg },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  title: { flex: 1, fontSize: 18, fontWeight: "700", color: colors.noir[800] },
  body: { paddingBottom: spacing[4], gap: spacing[2] },
  hint: { fontSize: 12, lineHeight: 19, color: colors.textSecondary },
  preview: { fontSize: 12, lineHeight: 18, padding: spacing[3], backgroundColor: colors.ivory[100], borderRadius: radius.md },
  label: { fontSize: 13, marginTop: spacing[2], color: colors.noir[800] },
  input: { minHeight: 44, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing[3], paddingVertical: spacing[2], color: colors.noir[800], backgroundColor: colors.surface },
  multiline: { minHeight: 88, textAlignVertical: "top" },
  error: { fontSize: 12, lineHeight: 18, color: colors.danger, marginBottom: spacing[3] },
  confirm: { minHeight: 48, padding: spacing[3], alignItems: "center", justifyContent: "center", borderRadius: radius.md, backgroundColor: colors.noir[800] },
  confirmText: { color: colors.surface, fontSize: 15, fontWeight: "700" },
  disabled: { opacity: 0.45 },
});
