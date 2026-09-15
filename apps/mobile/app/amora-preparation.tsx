import { ScrollView, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, spacing } from "@hanbang/design-tokens";
import AmoraActionsCard from "@/components/lounge/AmoraActionsCard";
import { ActionRow, AppHeader, AppText, Surface } from "@/components/ui/AppUI";

export default function AmoraPreparationScreen() {
  return <SafeAreaView style={styles.screen} edges={["top", "bottom"]}>
    <AppHeader title="준비 기록" onBack={() => router.canGoBack() ? router.back() : router.replace("/(tabs)/lounge")} />
    <ScrollView contentContainerStyle={styles.content}>
      <AppText variant="body">아모라와 확인해 남긴 할 일을 다시 볼 수 있어요. 예산·일정·체크리스트에는 각각 반영된 내용을 확인해 주세요.</AppText>
      <View style={styles.links}><Surface>
        <ActionRow title="예산 확인하기" onPress={() => router.push("/budget")} />
        <ActionRow title="일정 확인하기" onPress={() => router.push("/schedule")} />
        <ActionRow title="체크리스트 확인하기" onPress={() => router.push("/checklist")} />
        <ActionRow title="나만 보는 할 일" onPress={() => router.push("/amora-personal")} />
      </Surface></View>
      <AmoraActionsCard presentation="board" />
      {/* 루트 Stack 화면이라 push 는 (tabs)를 한 벌 더 쌓아 채팅 화면이 둘 뜬다. 기존 (tabs)로 돌아간다. */}
      <ActionRow title="아모라와 이야기하기" onPress={() => router.dismissTo("/(tabs)/chat")} />
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing[4], paddingBottom: spacing[8] },
  links: { marginVertical: spacing[4] },
});
