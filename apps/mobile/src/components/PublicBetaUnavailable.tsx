import { router } from "expo-router";
import { ShieldCheck } from "lucide-react-native";
import { StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, spacing } from "@hanbang/design-tokens";
import {
  AppHeader,
  EmptyState,
  IconBadge,
  PrimaryButton,
} from "@/components/ui/AppUI";

const COPY = {
  vendor: {
    title: "업체 탐색은 현재 제공하지 않아요",
    description:
      "업체 정보의 출처·최신성·연결 가능 여부를 검증하지 못해 제공하지 않아요. 재개 여부와 시점은 정해지지 않았습니다. 지금은 출처가 표시된 시세 자료를 참고해 주세요.",
  },
  booking: {
    title: "웨딩한방에서는 예약을 받지 않아요",
    description:
      "이전 베타 화면의 항목은 실제 업체 접수나 계약 상태를 증명하지 않아요. 업체 안내와 계약서를 기준으로 직접 확인해 주세요.",
  },
  cohort: {
    title: "동기방은 현재 제공하지 않아요",
    description:
      "예식 시기·메시지·계약 금액을 한 방에 모으는 기능은 개인정보, 표본 보호와 운영 검증이 끝나지 않아 제공하지 않아요. 재개 여부와 시점은 정해지지 않았습니다.",
  },
} as const;

export default function PublicBetaUnavailable({
  feature,
}: {
  feature: keyof typeof COPY;
}) {
  const copy = COPY[feature];

  return (
    <SafeAreaView style={styles.safe}>
      <AppHeader
        title="웨딩한방"
        onBack={() => router.replace("/(tabs)/dashboard")}
      />
      <View style={styles.content}>
        <EmptyState
          icon={
            <IconBadge tone="ivory" size={52}>
              <ShieldCheck size={24} color={colors.noir[800]} />
            </IconBadge>
          }
          title={copy.title}
          description={copy.description}
          action={
            <View style={styles.actions}>
              <PrimaryButton onPress={() => router.replace("/(tabs)/dashboard")}>
                홈으로 돌아가기
              </PrimaryButton>
              <PrimaryButton
                tone="ghost"
                onPress={() => feature === "cohort"
                  ? router.replace("/(tabs)/community")
                  : router.push("/market-prices")}
              >
                {feature === "cohort" ? "커뮤니티로" : "근거가 표시된 시세 보기"}
              </PrimaryButton>
            </View>
          }
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.surfaceLow,
  },
  content: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: spacing[5],
    paddingBottom: spacing[10],
  },
  actions: {
    width: "100%",
    gap: spacing[2],
  },
});
