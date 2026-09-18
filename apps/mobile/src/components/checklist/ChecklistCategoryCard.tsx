/**
 * 체크리스트 목록의 분야 카드 한 장. 누르면 분야 시트가 열린다.
 *
 * ## 웹 카드와 같은 말을 한다
 *
 * 웹 체크리스트(`apps/web/src/components/app/checklist/ChecklistContent.tsx`)의 카드는 분야를
 * 세 갈래로 말한다. 앱도 같은 세 갈래다.
 *
 *   - 안 하는 분야: 「진행률과 알림에서 제외됨 · 안 해요」, 막대는 빈 줄.
 *   - 항목을 세지 않고 분야만 표시한 경우(온보딩·라운지·아모라의 선언):
 *     「완료로 표시함 · 항목은 확인 전」. 개수를 나란히 쓰면 `0/9개 완료 · 완료` 가 되어 고장난
 *     것처럼 읽힌다. 완료 선언이면 막대를 세이지로 채우고, 퍼센트는 말하지 않는다.
 *   - 나머지: 「3/9개 완료 · 준비 중」과 항목 완료율 막대.
 *
 * 상태 이름은 공용 사전(`PREPARATION_PROGRESS_STATUS_LABELS`)에서만 읽는다 — 온보딩에서 고른
 * 「안 해요」가 화면마다 다른 말로 보이던 일이 있었다(`checklistNoteRendering.test.mjs`).
 *
 * ## 진행 막대를 다시 넣은 이유
 *
 * 2026-09-04 시안 반영 때 막대를 뺐었다(부제와 같은 말을 한 번 더 한다고 봤다). 2026-09-18
 * 파운더가 "웹으로 다 한 것들 모바일 앱으로" 맞추라고 했고, 웹 카드는 막대로 분야끼리의 진척을
 * 한눈에 비교하게 한다. 막대는 4px 한 줄이라 카드 높이는 거의 그대로다.
 */
import { View, Pressable, StyleSheet } from "react-native";
import { Text } from "@/components/ui/AppText";
import { colors } from "@hanbang/design-tokens";
import { PREPARATION_PROGRESS_STATUS_LABELS } from "@hanbang/shared/constants";
import { declaredStatusNote } from "@/lib/planningCategoryView";
import type { ChecklistSheetStats } from "./CategoryChecklistSheet";

export default function ChecklistCategoryCard({
  label,
  stats,
  onPress,
}: {
  label: string;
  stats: ChecklistSheetStats;
  onPress: () => void;
}) {
  const completed = stats.status === "completed";
  const stateTone = stats.skipped
    ? s.toneMuted
    : completed
      ? s.toneDone
      : stats.status === "in_progress"
        ? s.toneActive
        : s.toneMuted;

  const summary = stats.skipped
    ? "진행률과 알림에서 제외됨"
    : stats.declared
      ? declaredStatusNote(stats.status)
      : `${stats.done}/${stats.total}개 완료`;
  const state = stats.skipped
    ? PREPARATION_PROGRESS_STATUS_LABELS.not_applicable
    : stats.declared
      ? "항목은 확인 전"
      : PREPARATION_PROGRESS_STATUS_LABELS[stats.status];
  const showsPercent = !stats.skipped && !stats.declared;

  return (
    <View style={s.card}>
      <Pressable
        style={s.header}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${label} 체크리스트 열기`}
        accessibilityValue={{ text: `${summary} · ${state}` }}
      >
        <View style={s.body}>
          <Text style={s.label}>{label}</Text>
          <View style={s.statusRow}>
            <Text style={[s.stat, stats.declared ? [stateTone, s.statStrong] : null]}>{summary}</Text>
            <Text
              style={[
                s.state,
                stats.declared ? s.toneMuted : stateTone,
                !stats.declared && !stats.skipped && stats.status !== "not_started" ? s.statStrong : null,
              ]}
            >
              {state}
            </Text>
          </View>
          {showsPercent ? (
            <View
              style={s.track}
              accessibilityRole="progressbar"
              accessibilityLabel={`${label} 항목 완료율`}
              accessibilityValue={{ min: 0, max: 100, now: stats.percent }}
            >
              <View
                testID="checklist-category-progress-fill"
                style={[s.fill, completed ? s.fillDone : null, { width: `${stats.percent}%` }]}
              />
            </View>
          ) : (
            // 퍼센트를 말하지 않는 줄. 완료 선언만 세이지로 채운다(웹과 같다).
            <View
              style={[s.track, stats.declared && completed ? s.trackDone : null]}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            />
          )}
        </View>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  /** 시안 카드는 테두리 한 줄로 선다 — 그림자 없음. */
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 13,
    padding: 15,
  },
  header: { flexDirection: "row", alignItems: "center", minHeight: 44 },
  body: { flex: 1, minWidth: 0 },
  label: {
    fontSize: 14,
    color: colors.paper.ink,
    fontFamily: "NotoSansKR_600SemiBold",
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginTop: 5,
  },
  stat: {
    flexShrink: 1,
    fontSize: 11.5,
    color: colors.paper.inkFaint,
    fontFamily: "NotoSansKR_400Regular",
  },
  state: {
    flexShrink: 0,
    fontSize: 11.5,
    fontFamily: "NotoSansKR_400Regular",
  },
  statStrong: { fontFamily: "NotoSansKR_600SemiBold" },
  // 흰 카드 위 작은 글자라 4.5:1 을 넘는 어두운 단계를 쓴다(세이지 deep 4.98, 장미 700 6.25).
  toneDone: { color: colors.sage.deep },
  toneActive: { color: colors.rose[700] },
  toneMuted: { color: colors.paper.inkFaint },
  track: {
    height: 4,
    marginTop: 7,
    borderRadius: 2,
    overflow: "hidden",
    backgroundColor: colors.surfaceLow,
  },
  trackDone: { backgroundColor: colors.sage[500] },
  fill: {
    height: "100%",
    borderRadius: 2,
    backgroundColor: colors.rose[500],
  },
  fillDone: { backgroundColor: colors.sage[500] },
});
