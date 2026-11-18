import { StyleSheet, View } from "react-native";
import { FIRST_CHAT_COPY } from "@hanbang/shared/invitation";
import { Text } from "@/components/ui/AppText";
import AmoraOrb from "@/components/ui/AmoraOrb";
import { palette, typo } from "./invitationStyle";

/**
 * 대화 머리의 오브와 "듣고 있어요"(`Chat.dc` header: 오브 64px, 12px 흐린 글자, 위 4px). 첫 대화와 같은 값이다.
 * 로그인한 커플의 아모라 대화 탭 머리가 쓴다.
 */
export default function InvitationListening() {
  return (
    <View style={styles.root}>
      <AmoraOrb size={64} mood="calm" />
      <Text style={[typo.sans, styles.listening]}>{FIRST_CHAT_COPY.listening}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: "center" },
  listening: { fontSize: 12, color: palette.muted, marginTop: 4 },
});
