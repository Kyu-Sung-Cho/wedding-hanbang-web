import { Alert, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { ArrowLeft, ExternalLink, ShieldCheck } from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";

const SITE = process.env.EXPO_PUBLIC_SITE_URL || "https://hanbang.ai";

type Props = {
  mode: "signup" | "forgot";
  title: string;
  description: string;
  buttonLabel: string;
};

export default function SecureWebEmailAuth({
  mode,
  title,
  description,
  buttonLabel,
}: Props) {
  async function openSecureWebFlow() {
    try {
      await Linking.openURL(`${SITE}/login?mode=${mode}`);
    } catch {
      Alert.alert(
        "웹 화면을 열 수 없어요",
        "기본 브라우저에서 hanbang.ai/login을 열어 다시 시도해주세요."
      );
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          accessibilityLabel="로그인으로 돌아가기"
          accessibilityRole="button"
        >
          <ArrowLeft size={24} color={colors.noir[800]} />
        </Pressable>
        <Text style={styles.headerTitle}>{title}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.content}>
        <View style={styles.iconCircle}>
          <ShieldCheck size={40} color={colors.rose[500]} strokeWidth={1.8} />
        </View>
        <Text style={styles.title}>웹 보안 확인이 필요해요</Text>
        <Text style={styles.description}>{description}</Text>

        <View style={styles.notice}>
          <Text style={styles.noticeTitle}>왜 웹에서 진행하나요?</Text>
          <Text style={styles.noticeText}>
            이메일 발송 남용과 자동 가입을 막기 위한 봇 방지 확인을 완료해야 해요. 앱은 이 확인을
            우회하지 않으며, 비밀번호를 이 화면에서 수집하지 않습니다.
          </Text>
        </View>

        <Pressable
          style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
          onPress={() => void openSecureWebFlow()}
          accessibilityLabel={buttonLabel}
          accessibilityRole="link"
        >
          <Text style={styles.primaryButtonText}>{buttonLabel}</Text>
          <ExternalLink size={17} color="#FFFFFF" />
        </Pressable>

        <Pressable
          style={styles.secondaryButton}
          onPress={() => router.back()}
          accessibilityLabel="로그인으로 돌아가기"
          accessibilityRole="button"
        >
          <Text style={styles.secondaryButtonText}>로그인으로 돌아가기</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  headerTitle: {
    fontSize: 18,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.noir[800],
  },
  headerSpacer: { width: 24 },
  content: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 28,
    paddingBottom: 64,
  },
  iconCircle: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 24,
  },
  title: {
    fontSize: 25,
    lineHeight: 35,
    fontFamily: "NotoSerifKR_500Medium",
    color: colors.noir[800],
    textAlign: "center",
    marginBottom: 12,
  },
  description: {
    fontSize: 15,
    lineHeight: 24,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
    textAlign: "center",
    marginBottom: 28,
  },
  notice: {
    padding: 18,
    borderRadius: 18,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 24,
  },
  noticeTitle: {
    fontSize: 14,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.noir[800],
    marginBottom: 8,
  },
  noticeText: {
    fontSize: 13,
    lineHeight: 21,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
  },
  primaryButton: {
    height: 54,
    borderRadius: 16,
    backgroundColor: colors.noir[800],
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  pressed: { opacity: 0.82 },
  primaryButtonText: {
    fontSize: 16,
    fontFamily: "NotoSansKR_600SemiBold",
    color: "#FFFFFF",
  },
  secondaryButton: { alignItems: "center", paddingVertical: 16 },
  secondaryButtonText: {
    fontSize: 14,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
  },
});
