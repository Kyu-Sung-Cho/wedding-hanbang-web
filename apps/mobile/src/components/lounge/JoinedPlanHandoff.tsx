// 파트너 합류 직후 라운지 안내 — "이제 이 계획을 함께 봐요".
//
// 웹 라운지의 같은 카드(`apps/web/src/app/(app)/lounge/page.tsx`, `joined-plan-handoff`)를
// 앱으로 옮긴 것이다. 문구와 네 칸(날짜·장소·총 예산·준비 진행)은 `@/lib/joinedPlanHandoff`가
// 웹과 같은 글자로 만들고, 이 파일은 그리기만 한다.
//
// 행동은 둘뿐이다. "함께 확인할 내용 찾기"는 아모라 입력창에 질문 초안만 놓고, "이 내용
// 확인했어요"는 카드를 닫는다. 둘 다 계획을 바꾸지 않는다.
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "@/components/ui/AppText";
import { HeartHandshake } from "lucide-react-native";
import { colors, radius, spacing } from "@hanbang/design-tokens";
import { AppText, PrimaryButton } from "@/components/ui/AppUI";
import AmoraMark from "@/components/ui/AmoraMark";
import type { JoinedPlanHandoffView } from "@/lib/joinedPlanHandoff";

interface JoinedPlanHandoffProps {
  view: JoinedPlanHandoffView;
  onReview: () => void;
  onDismiss: () => void;
}

export default function JoinedPlanHandoff({
  view,
  onReview,
  onDismiss,
}: JoinedPlanHandoffProps) {
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.icon}>
          <HeartHandshake size={20} color={colors.noir[800]} />
        </View>
        <View style={styles.headerCopy}>
          <AppText variant="eyebrow" style={styles.eyebrow}>
            {view.eyebrow}
          </AppText>
          <Text style={styles.title} accessibilityRole="header">
            {view.title}
          </Text>
          <Text style={styles.body}>{view.body}</Text>
        </View>
      </View>

      <View style={styles.grid}>
        {view.cells.map((cell) => (
          <View key={cell.label} style={styles.cell}>
            <Text style={styles.cellLabel}>{cell.label}</Text>
            {/* 두 줄까지 둔다. 320px 화면에서 칸 폭은 글자 90px 남짓이라 "2027년 5월 15일"이
                한 줄에 다 들어가지 않는다 — 한 줄로 자르면 날짜가 "2027년 5월…"로 끊긴다. */}
            <Text style={styles.cellValue} numberOfLines={2}>
              {cell.value}
            </Text>
            {cell.note ? (
              <Text style={styles.cellNote} numberOfLines={1}>
                {cell.note}
              </Text>
            ) : null}
          </View>
        ))}
      </View>

      <PrimaryButton
        tone="rose"
        style={styles.review}
        icon={<AmoraMark size={18} color={colors.surface} />}
        onPress={onReview}
        accessibilityHint="아모라 채팅 입력창에 질문 초안만 채워요. 계획은 바뀌지 않아요."
      >
        {view.reviewLabel}
      </PrimaryButton>
      <Pressable
        style={({ pressed }) => [styles.dismiss, pressed && styles.dismissPressed]}
        onPress={onDismiss}
        accessibilityRole="button"
        accessibilityHint="이 안내를 닫아요. 아무것도 저장하지 않아요."
      >
        <Text style={styles.dismissText}>{view.dismissLabel}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  // 웹 카드와 같은 세이지 면이다(--amora-sage 테두리, --amora-sage-pale 바탕).
  card: {
    marginBottom: spacing[4],
    padding: spacing[4],
    borderRadius: radius["2xl"],
    borderWidth: 1,
    borderColor: colors.sage[500],
    backgroundColor: colors.htmlWorkspace.sagePale,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[3],
  },
  icon: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: colors.surface,
  },
  headerCopy: {
    flex: 1,
  },
  eyebrow: {
    color: colors.textSecondary,
  },
  title: {
    marginTop: spacing[1],
    fontSize: 17,
    lineHeight: 24,
    fontFamily: "NotoSansKR_700Bold",
    color: colors.noir[900],
  },
  body: {
    marginTop: spacing[2],
    fontSize: 13,
    lineHeight: 21,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
  },
  // 칸은 테두리·그림자 없는 흰 면이다 — 카드 안에 카드를 또 세우지 않는다.
  grid: {
    marginTop: spacing[4],
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[2],
  },
  cell: {
    flexBasis: "45%",
    flexGrow: 1,
    minWidth: 0,
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[3],
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
  },
  cellLabel: {
    fontSize: 11,
    lineHeight: 16,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.textTertiary,
  },
  cellValue: {
    marginTop: 2,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.noir[900],
  },
  cellNote: {
    marginTop: 1,
    fontSize: 11,
    lineHeight: 16,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textTertiary,
  },
  review: {
    marginTop: spacing[4],
  },
  dismiss: {
    minHeight: 44,
    marginTop: spacing[2],
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.xl,
  },
  dismissPressed: {
    backgroundColor: colors.surface,
  },
  dismissText: {
    fontSize: 13,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.noir[800],
  },
});
