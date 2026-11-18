import { Pressable, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { Text } from "@/components/ui/AppText";
import { lineHeight, palette, typo } from "@/components/invitation/invitationStyle";
import { buildHomeServices } from "@/lib/dashboardExperience.mjs";

/**
 * 지난 상담 요청 기록으로 가는 한 줄. 업체 상담·예약 요청은 2026-07-15부터 받지 않으므로, 이미 기록이 있는
 * 커플에게만 지난 기록을 보는 입구로 남긴다(2026-09-18 파운더 결정). 2026-11-17 홈에서는 준비 도구 격자가
 * 없어서 홈의 알림 자리에 "두 분이 정할 것" 줄과 같은 모양(15px 제목, 13px 흐린 설명)으로 조용히 둔다.
 * 글자는 예전 라운지 칸과 같은 목록(`HOME_SERVICES`)에서 읽는다.
 */
export default function LoungeRecordsEntry() {
  const entry = buildHomeServices({ hasBookingRecords: true }).find((service) => service.key === "bookings");
  if (!entry) return null;
  return (
    <Pressable
      onPress={() => router.push("/bookings")}
      accessibilityRole="button"
      accessibilityLabel={`${entry.title}, ${entry.description}`}
      style={styles.row}
    >
      {({ pressed }) => (
        <View style={styles.text}>
          <Text style={[typo.sansMedium, styles.title, pressed && { color: palette.muted }]}>{entry.title}</Text>
          <Text style={[typo.sans, styles.sub]}>{entry.description}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 44, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: palette.divider },
  text: { gap: 3 },
  title: { fontSize: 15, lineHeight: lineHeight(15, 1.4) },
  sub: { fontSize: 13, color: palette.muted },
});
