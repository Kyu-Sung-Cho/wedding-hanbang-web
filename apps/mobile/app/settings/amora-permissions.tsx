// 허락 규칙 화면(설계 25장 3절). 웹 `/settings/amora-permissions` 와 같은 표(`@hanbang/shared/amora-permissions`)다.
// 아모라가 알아서 하는 일, 물어보고 하는 일, 하지 않는 일을 보이고, 같은 화면에서 앱 알림·메일·오늘의 한 가지·기억을
// 정한다. 인터넷 찾기(갈래 3)와 맡은 일(갈래 4)은 아직 없어 꺼진 채 넘긴다(오늘 쓸 수 없는 일을 쓰지 않는다).
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { BrainCircuit, CircleCheck, CircleSlash, MessageSquareMore } from "lucide-react-native";
import { colors, spacing } from "@hanbang/design-tokens";
import { AMORA_PERMISSION_COPY, buildAmoraPermissionTable } from "@hanbang/shared/amora-permissions";

import { Text } from "@/components/ui/AppText";
import { ActionRow, AppHeader, Surface } from "@/components/ui/AppUI";
import AmoraCarePreferenceControl from "@/components/settings/AmoraCarePreferenceControl";
import AmoraPushPreferenceControl from "@/components/settings/AmoraPushPreferenceControl";
import TodayOnePreferenceControl from "@/components/settings/TodayOnePreferenceControl";

const FEATURES = { webSearch: false, agentTasks: false } as const;
const SECTIONS = [
  { key: "auto", Icon: CircleCheck },
  { key: "ask", Icon: MessageSquareMore },
  { key: "never", Icon: CircleSlash },
] as const;

export default function AmoraPermissionsScreen() {
  const copy = AMORA_PERMISSION_COPY;
  const table = buildAmoraPermissionTable(FEATURES);
  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      <AppHeader title={copy.title} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.intro}>{copy.intro}</Text>
        {SECTIONS.map(({ key, Icon }) => (
          <Surface key={key} style={styles.card}>
            <View style={styles.sectionHeader}>
              <Icon size={16} color={colors.rose[500]} />
              <Text style={styles.sectionTitle} accessibilityRole="header">{copy.sections[key]}</Text>
            </View>
            {table[key].map((item) => (
              <Text key={item} style={styles.item}>{item}</Text>
            ))}
            {key === "ask" ? <Text style={styles.note}>{copy.askNote}</Text> : null}
            {key === "never" ? <Text style={styles.note}>{copy.neverNote}</Text> : null}
          </Surface>
        ))}

        <Text style={styles.controlsTitle} accessibilityRole="header">{copy.controlsTitle}</Text>
        <Surface style={styles.card}>
          <AmoraPushPreferenceControl />
          <TodayOnePreferenceControl />
          <AmoraCarePreferenceControl />
        </Surface>
        <Surface style={styles.card}>
          <ActionRow
            icon={<BrainCircuit size={18} color={colors.noir[800]} />}
            title={copy.memoryLink}
            description={copy.memoryLinkSub}
            onPress={() => router.push("/settings/amora-memory" as const)}
          />
        </Surface>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing[5], paddingBottom: 48, gap: spacing[4] },
  intro: { fontSize: 14, lineHeight: 21, color: colors.textSecondary },
  card: { gap: spacing[2] },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
  sectionTitle: { fontSize: 15, fontWeight: "600", color: colors.noir[800] },
  item: { fontSize: 14, lineHeight: 21, color: colors.noir[800] },
  note: { fontSize: 12, lineHeight: 18, color: colors.textSecondary, marginTop: spacing[1] },
  controlsTitle: { fontSize: 15, fontWeight: "600", color: colors.noir[800], marginTop: spacing[2] },
});
