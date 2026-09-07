import { useEffect, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { colors, spacing, radius } from "@hanbang/design-tokens";
import type { PersonalAction, PersonalActionReview } from "@hanbang/shared/amora-personal-actions";
import { personalActionContinuation } from "@/lib/personalActionContinuation";
import { supabase } from "@/lib/supabase";

export function PersonalActionContinue({ action }: { action: PersonalAction }) {
  const [review, setReview] = useState<PersonalActionReview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange(event => {
      if (event !== "INITIAL_SESSION") { generation.current += 1; inFlight.current = false; setBusy(false); setReview(null); setError(null); }
    });
    return () => { generation.current += 1; data.subscription.unsubscribe(); };
  }, []);
  const run = async (confirm: boolean) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(null);
    const epoch = generation.current;
    try {
      if (confirm && review) {
        await personalActionContinuation.stage(review);
        if (epoch === generation.current) { setReview(null); router.push("/(tabs)/chat"); }
      } else {
        const next = await personalActionContinuation.review(action.id);
        if (epoch === generation.current && next.action.ownerUserId === action.ownerUserId) setReview(next);
      }
    } catch {
      if (epoch === generation.current) setError("이 할 일을 현재 나만 상담으로 이어갈 수 있는지 확인하지 못했어요. 다시 눌러 확인해 주세요.");
    } finally { if (epoch === generation.current) { inFlight.current = false; setBusy(false); } }
  };
  return <View>
    <Pressable accessibilityRole="button" disabled={busy} onPress={() => void run(false)} style={styles.button}><Text style={styles.link}>{busy && !review ? "확인하는 중…" : "이 할 일 이어서 상담"}</Text></Pressable>
    {error && !review && <Text accessibilityRole="alert" style={styles.hint}>{error}</Text>}
    <Modal visible={!!review} transparent animationType="slide" onRequestClose={() => { if (!busy) setReview(null); }}>
      <View style={styles.overlay}><View style={styles.sheet} accessibilityViewIsModal>
        <Text accessibilityRole="header" style={styles.title}>이 할 일로 나만 상담을 이어갈까요?</Text>
        <ScrollView contentContainerStyle={styles.body}>
          <Text style={styles.hint}>아래 내용만 나만 상담 입력창에 넣어요. 직접 보내기 전에는 대화로 전송하지 않아요.</Text>
          <Text style={styles.title}>{review?.action.title}</Text>
          {!!review?.action.description && <Text style={styles.description}>{review.action.description}</Text>}
          <Text style={styles.hint}>{review?.action.dueDate ? `마감일 ${review.action.dueDate}` : "마감일 없음"}</Text>
        </ScrollView>
        {error && <Text accessibilityRole="alert" style={styles.hint}>{error}</Text>}
        <Pressable accessibilityRole="button" disabled={busy} onPress={() => void run(true)} style={styles.button}><Text style={styles.link}>{busy ? "확인하는 중…" : "나만 상담 입력창에 넣기"}</Text></Pressable>
        <Pressable accessibilityRole="button" disabled={busy} onPress={() => setReview(null)} style={styles.button}><Text>닫기</Text></Pressable>
      </View></View>
    </Modal>
  </View>;
}
const styles = StyleSheet.create({
  button: { minHeight: 44, paddingHorizontal: spacing[2], justifyContent: "center" }, link: { color: colors.rose[600], textDecorationLine: "underline" },
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: { maxHeight: "90%", padding: spacing[4], paddingBottom: spacing[6], backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl },
  body: { gap: spacing[3], paddingVertical: spacing[4] }, title: { fontSize: 16, fontWeight: "700", color: colors.noir[800] },
  description: { fontSize: 14, lineHeight: 21, color: colors.noir[800] }, hint: { fontSize: 12, lineHeight: 19, color: colors.textSecondary },
});
