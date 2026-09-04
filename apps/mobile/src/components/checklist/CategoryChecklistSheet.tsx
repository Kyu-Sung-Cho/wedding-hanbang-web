/**
 * 분야 하나의 체크리스트 — 아래에서 올라오는 시트.
 *
 * ## 무엇이 달라졌나
 *
 * 2026-09-04 이전에는 분야 카드를 누르면 **그 자리에서 아래로 펼쳐졌다**(아코디언).
 * 시안(`ChecklistGreetingMobile.dc.html` 외 3장)은 목록을 뒤에 두고 시트가 올라온다.
 * 왜 바꾸나 — 펼침은 항목이 열두 개쯤 되면 카드가 화면을 넘겨 **머리(진행률·제목)가
 * 위로 밀려 나간다.** 시트는 머리를 고정하고 항목만 구른다.
 *
 * ## 웹 모달과 같아야 하는 것 / 달라야 하는 것
 *
 * 같아야 하는 것은 **무엇을 보여주는가**다 — 단계 묶음, 세 가지 표시, 「다음 할 일」을
 * 고르는 규칙. 그 규칙은 `@hanbang/shared/constants` 한 곳에 있고 두 앱이 같은 것을
 * 부른다. 각자 계산하면 같은 커플에게 두 화면이 다른 단계를 말한다.
 *
 * 달라야 하는 것은 색·서체·움직임이다. 여기는 `@hanbang/design-tokens` 를 쓴다.
 *
 * ## 남긴 것
 *
 * 「우리는 이건 안 해요」는 시안 어디에도 없지만 지우지 않았다. 가족·지역마다 하는
 * 항목이 달라서, 끄면 진행률 분모와 마감 알림에서 빠진다. 지우면 안 하는 분야가
 * 영구 미완료로 남는다.
 */

import { useMemo } from "react";
import {
  Modal,
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
} from "react-native";
import { CheckCircle2, Circle, Ban, Lightbulb, BookOpen, ChevronRight } from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";
import {
  checklistItemTag,
  groupChecklistItems,
  labelWithoutConditionSuffix,
  mannersGuideForCategory,
  type ChecklistItem,
} from "@hanbang/shared/constants";

import ChecklistProgressRing from "./ChecklistProgressRing";
import ChecklistItemTag from "./ChecklistItemTag";

export type ChecklistSheetStats = {
  done: number;
  total: number;
  percent: number;
  skipped: boolean;
};

export default function CategoryChecklistSheet({
  visible,
  categoryKey,
  label,
  items,
  tip,
  stats,
  onClose,
  onToggleItem,
  onToggleApplicability,
  onOpenGuide,
}: {
  visible: boolean;
  categoryKey: string;
  label: string;
  items: ChecklistItem[];
  tip: string;
  stats: ChecklistSheetStats;
  onClose: () => void;
  onToggleItem: (itemId: string, currentDone: boolean) => void;
  onToggleApplicability: () => void;
  /** 예절 편 웹뷰를 여는 일은 화면이 한다 — 이 컴포넌트는 주소를 모른다. */
  onOpenGuide: (slug: string) => void;
}) {
  const groups = useMemo(
    () => groupChecklistItems(categoryKey, items),
    [categoryKey, items],
  );

  /**
   * 「다음 할 일」이 붙는 항목 — **단계 순서로** 처음 만나는 미완료 항목 하나.
   *
   * 항목 배열이 아니라 `groups` 를 훑는 이유는 결혼식장 때문이다. 그 분야는 단계
   * 순서와 배열 순서가 달라서, 배열에서 먼저 나오는 항목이 화면에서는 아래에 있다.
   * 껐으면 아무것도 가리키지 않는다 — 진행률에서 뺀 분야에 다음 할 일이 있다고
   * 말하는 것은 앞뒤가 안 맞는다.
   */
  const nextItemId = stats.skipped
    ? undefined
    : groups.flatMap((group) => group.items).find((item) => !item.done)?.id;

  const guide = mannersGuideForCategory(categoryKey);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      {/* 바깥을 누르면 닫힌다. 시안의 어두운 막이 이 자리다. */}
      <Pressable
        style={s.scrim}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={`${label} 체크리스트 닫기`}
      />
      <View style={s.sheet}>
        <View style={s.handle} />

        <View style={s.head}>
          <ChecklistProgressRing
            percent={stats.skipped ? 0 : stats.percent}
            label={`${label} 완료율`}
            centerText={stats.skipped ? "—" : `${stats.percent}%`}
          />
          <View style={s.headText}>
            <Text style={s.title} numberOfLines={2}>{label}</Text>
            <View style={s.metaRow}>
              <Text style={s.statusChip}>
                {stats.skipped ? "해당 없음" : stats.done === 0 ? "시작 전" : stats.done >= stats.total ? "완료" : "진행 중"}
              </Text>
              <Text style={s.meta}>
                {stats.skipped
                  ? "진행률에서 제외됨"
                  : `${stats.done}/${stats.total} 완료 · ${stats.percent}%`}
              </Text>
            </View>
          </View>
        </View>

        <ScrollView style={s.body} contentContainerStyle={s.bodyContent}>
          <Pressable
            style={s.skipRow}
            onPress={onToggleApplicability}
            accessibilityRole="button"
            accessibilityLabel={stats.skipped ? `${label} 다시 준비 목록에 넣기` : `${label} 준비 목록에서 제외하기`}
          >
            <Ban size={18} color={colors.textTertiary} />
            <Text style={s.skipText}>
              {stats.skipped ? "다시 준비 목록에 넣기" : "우리는 이건 안 해요"}
            </Text>
          </Pressable>

          {groups.map((group) => {
            const groupDone = group.items.filter((item) => item.done).length;
            return (
              <View key={group.title || "all"} style={s.group}>
                {group.title ? (
                  <View style={s.groupHead}>
                    <Text style={s.groupTitle}>{group.title}</Text>
                    <Text style={s.groupCount}>{groupDone}/{group.items.length}</Text>
                  </View>
                ) : null}

                {group.items.map((item, index) => {
                  const tag = checklistItemTag(item.id);
                  const isNext = item.id === nextItemId;
                  // 「해당 시」 표시가 붙는 항목은 라벨 끝의 `(해당하는 경우)` 를 뗀다.
                  // 표시가 그 말을 대신하므로 두면 같은 말이 두 번 보인다.
                  const shownLabel = tag === "해당 시"
                    ? labelWithoutConditionSuffix(item.label)
                    : item.label;

                  return (
                    <Pressable
                      key={item.id}
                      style={[
                        s.itemRow,
                        index === group.items.length - 1 ? s.itemRowLast : null,
                      ]}
                      onPress={() => onToggleItem(item.id, item.done)}
                      disabled={stats.skipped}
                      accessibilityRole="checkbox"
                      accessibilityLabel={item.label}
                      // 안내는 이름이 아니라 힌트로 읽힌다. 이름에 붙이면 항목마다
                      // 두 문장을 이어 읽는다(웹의 aria-describedby와 같은 취지).
                      accessibilityHint={item.note}
                      accessibilityState={{ checked: item.done, disabled: stats.skipped }}
                    >
                      {/*
                        동그라미 셋이 서로 다른 말을 한다 — 끝난 것, 다음에 할 것,
                        아직인 것. 가운데 것이 없으면 열 줄이 전부 똑같아 보여
                        어디부터 손대야 할지가 화면에 없다.
                      */}
                      {item.done ? (
                        <CheckCircle2 size={22} color={colors.sage[500]} />
                      ) : (
                        <Circle
                          size={22}
                          color={isNext ? colors.rose[500] : colors.taupe[400]}
                        />
                      )}
                      <View style={s.itemTextColumn}>
                        <View style={s.itemTopRow}>
                          <Text
                            style={[
                              s.itemLabel,
                              item.done && s.itemDone,
                              isNext && s.itemNext,
                            ]}
                          >
                            {shownLabel}
                          </Text>
                          {isNext ? (
                            <ChecklistItemTag kind="다음 할 일" />
                          ) : tag ? (
                            <ChecklistItemTag kind={tag} />
                          ) : null}
                        </View>
                        {item.note ? (
                          <Text style={s.itemNote}>{item.note}</Text>
                        ) : null}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            );
          })}
        </ScrollView>

        <View style={s.foot}>
          <View style={s.tipRow}>
            <Lightbulb size={15} color={colors.gold.DEFAULT} />
            <Text style={s.tipText}>{tip}</Text>
          </View>
          {guide ? (
            <Pressable
              style={s.guide}
              onPress={() => onOpenGuide(guide.slug)}
              accessibilityRole="link"
              accessibilityLabel={`${guide.title} 보기`}
            >
              <BookOpen size={15} color={colors.textTertiary} />
              <Text style={s.guideText}>{guide.title} 보기</Text>
              <ChevronRight size={16} color={colors.textTertiary} />
            </Pressable>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "rgba(38,37,31,0.5)" },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    top: 120,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
  },
  handle: {
    width: 38,
    height: 4,
    borderRadius: 100,
    backgroundColor: colors.border,
    alignSelf: "center",
    marginTop: 10,
    marginBottom: 14,
  },

  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headText: { flex: 1, minWidth: 0 },
  title: { fontSize: 17, fontFamily: "NotoSansKR_600SemiBold", color: colors.noir[800] },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 3 },
  statusChip: {
    fontSize: 10.5,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.textSecondary,
    backgroundColor: colors.ivory[200],
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 100,
    overflow: "hidden",
  },
  meta: { fontSize: 11.5, fontFamily: "NotoSansKR_400Regular", color: colors.textTertiary },

  body: { flex: 1 },
  bodyContent: { paddingHorizontal: 20, paddingBottom: 20 },

  skipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 44,
    marginTop: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
  },
  skipText: { fontSize: 13, fontFamily: "NotoSansKR_400Regular", color: colors.textSecondary },

  group: { marginTop: 16 },
  groupHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 5,
  },
  groupTitle: { fontSize: 11.5, fontFamily: "NotoSansKR_600SemiBold", color: colors.rose[600] },
  groupCount: { fontSize: 11, fontFamily: "NotoSansKR_400Regular", color: colors.textTertiary },

  itemRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 11,
    paddingVertical: 13,
    minHeight: 44,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  itemRowLast: { borderBottomWidth: 0 },
  itemTextColumn: { flex: 1, minWidth: 0 },
  itemTopRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 7 },
  itemLabel: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.noir[800],
  },
  itemNext: { fontFamily: "NotoSansKR_600SemiBold" },
  itemDone: { color: colors.textTertiary, textDecorationLine: "line-through" },
  itemNote: {
    marginTop: 6,
    fontSize: 12.5,
    lineHeight: 20,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textTertiary,
  },

  foot: {
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 22,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.ivory.warm,
  },
  tipRow: { flexDirection: "row", alignItems: "flex-start", gap: 9, marginBottom: 12 },
  tipText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 19,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
  },
  guide: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 46,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  guideText: { fontSize: 13, fontFamily: "NotoSansKR_600SemiBold", color: colors.noir[800] },
});
