import { useCallback } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Text } from "@/components/ui/AppText";
import { router, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, spacing, radius } from "@hanbang/design-tokens";
import { AppHeader } from "@/components/ui/AppUI";
import { usePersonalActions } from "@/lib/usePersonalActions";
import type { PersonalAction } from "@hanbang/shared/amora-personal-actions";
import { PersonalActionContinue } from "@/components/chat/PersonalActionContinue";

export default function AmoraPersonalScreen() {
  const data = usePersonalActions();
  useFocusEffect(useCallback(() => { void data.session.load(); }, [data.session]));
  const remove = (action: PersonalAction) => Alert.alert("개인 할 일을 삭제할까요?", "이 할 일만 삭제하고 원래 대화는 남겨요.", [
    { text: "취소", style: "cancel" },
    { text: "삭제", style: "destructive", onPress: () => { if (data.session.getState().ownerId === action.ownerUserId) void data.session.remove(action); } },
  ]);
  return <SafeAreaView style={styles.screen} edges={["top", "bottom"]}>
    <AppHeader title="나만 보는 할 일" onBack={() => router.canGoBack() ? router.back() : router.replace("/(tabs)/chat")} />
    <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={data.loading} onRefresh={() => void data.session.load()} />}>
      <Text style={styles.hint}>나만 상담한 답변에서 직접 확인해 저장한 할 일이에요. 파트너에게 공유하거나 알림을 보내지 않아요.</Text>
      {(data.error || data.writeError) && <View style={styles.card}><Text accessibilityRole="alert" style={styles.error}>{data.error || data.writeError}</Text><Pressable accessibilityRole="button" onPress={() => void data.session.load()} style={styles.button}><Text>목록 다시 확인</Text></Pressable></View>}
      {!data.ownerId && <Text accessibilityLiveRegion="polite" style={styles.hint}>로그인 정보를 확인하고 있어요. 연결이 끊겼다면 다시 로그인해 주세요.</Text>}
      {data.ownerId && !data.loading && !data.error && data.actions.length === 0 && <Text style={styles.hint}>저장한 개인 할 일이 없어요. 나만 상담한 답변의 ‘개인 할 일로 저장’에서 제목을 적고 확인해 주세요.</Text>}
      {data.actions.map(action => <View key={action.id} style={styles.card}>
        <Text style={[styles.title, action.status === "done" && styles.completed]}>{action.title}</Text>
        <Text style={styles.hint}>{action.status === "done" ? "완료" : "진행 중"}</Text>
        {!!action.description && <Text style={styles.description}>{action.description}</Text>}
        {!!action.dueDate && <Text style={styles.hint}>마감일 {action.dueDate}</Text>}
        <PersonalActionContinue action={action} />
        <View style={styles.buttons}><Pressable accessibilityRole="button" disabled={data.busyIds.includes(action.id)} onPress={() => void data.session.update(action)} style={styles.button}><Text>{action.status === "done" ? "진행 중으로 되돌리기" : "완료로 표시"}</Text></Pressable>
          <Pressable accessibilityRole="button" disabled={data.busyIds.includes(action.id)} onPress={() => remove(action)} style={styles.button}><Text>삭제</Text></Pressable></View>
      </View>)}
      {data.actions.length > 0 && <Text style={styles.hint}>전체 {data.count}개 중 {data.actions.length}개 표시</Text>}
      {!!data.nextCursor && <Pressable accessibilityRole="button" disabled={data.loading} onPress={() => void data.session.load(data.nextCursor ?? undefined)} style={styles.button}><Text>개인 할 일 더 보기</Text></Pressable>}
      {/* 루트 Stack 화면이라 push 는 (tabs)를 한 벌 더 쌓아 채팅 화면이 둘 뜬다. 기존 (tabs)로 돌아간다. */}
      <Pressable accessibilityRole="button" onPress={() => router.dismissTo("/(tabs)/chat")} style={styles.button}><Text>아모라 대화로 돌아가기</Text></Pressable>
    </ScrollView>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg }, content: { padding: spacing[4], gap: spacing[3], paddingBottom: spacing[8] },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing[4], backgroundColor: colors.surface, gap: spacing[2] },
  title: { fontSize: 16, fontWeight: "700", color: colors.noir[800] }, completed: { textDecorationLine: "line-through", opacity: 0.6 },
  hint: { fontSize: 12, lineHeight: 19, color: colors.textSecondary }, description: { fontSize: 14, lineHeight: 21, color: colors.noir[800] },
  buttons: { flexDirection: "row", flexWrap: "wrap", gap: spacing[3] }, button: { minHeight: 44, paddingHorizontal: spacing[2], justifyContent: "center" },
  error: { color: colors.dangerDeep, fontSize: 12, lineHeight: 19 },
});
