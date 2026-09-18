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
 *
 * ## 아모라 질문(2026-09-15)
 *
 * 웹 모달에는 분야 전체(「아모라 질문」)와 항목마다 아모라 버튼이 있었는데 이 시트에는
 * 없었다. 같은 커플이 앱에서만 질문 입구를 못 찾는 상태였다. 두 버튼 모두 웹뷰 예절 편의
 * 질문 링크와 **같은 `amoraSource` 경로**로 네이티브 채팅을 열고, 채팅은 입력창에 질문만
 * 채운다. 질문을 보내도 체크·일정·예산은 바뀌지 않는다 — 아모라가 낸 카드를 사용자가 직접
 * 확인해야만 바뀐다.
 */

import { useMemo } from "react";
import { Modal, View, ScrollView, Pressable, StyleSheet } from "react-native";
import { Text } from "@/components/ui/AppText";
import { Check, Ban, Sparkle, BookOpen } from "lucide-react-native";
import { amoraIdentity, colors } from "@hanbang/design-tokens";
import {
  CHECKLIST_MAP,
  checklistItemTag,
  checklistNoteSourceChip,
  groupChecklistItems,
  labelWithoutConditionSuffix,
  mannersGuideForCategory,
  PREPARATION_PROGRESS_STATUS_LABELS,
  type ChecklistItem,
} from "@hanbang/shared/constants";
import { type PlanningChecklistStatus } from "@hanbang/shared/utils";
import AmoraMark from "@/components/ui/AmoraMark";

import ChecklistProgressRing from "./ChecklistProgressRing";
import ChecklistItemTag from "./ChecklistItemTag";

/**
 * 아모라 질문 버튼이 스크린리더에 덧붙이는 설명. 눈에 보이는 안내 줄은 따로 두지 않는다 —
 * 누르면 채팅 입력창에 질문만 채워진다. 보낸 뒤에도 체크 상태는 그대로다(웹 모달과 같은 약속).
 */
const AMORA_QUESTION_HINT = "아모라 채팅 입력창에 질문만 채워요. 질문을 보내도 체크 상태는 바뀌지 않아요.";

export type ChecklistSheetStats = {
  done: number;
  total: number;
  percent: number;
  skipped: boolean;
  /**
   * 항목을 세지 않고 분야 단위로 "준비 중·완료"라고 표시한 것인가(온보딩·라운지·아모라).
   * 그렇다면 개수와 퍼센트를 나란히 쓰지 않는다 — `0/9 완료 · 0%` 옆에 「완료」가 선다.
   */
  declared: boolean;
  /** 저장된 상태 키. 상태 이름은 공용 사전에서만 읽는다 — 화면마다 다른 말이 되지 않게. */
  status: PlanningChecklistStatus;
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
  onOpenSource,
  onAskAmora,
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
  /** 근거 칩이 여는 곳. `/manners/<slug>#section-N` 꼴의 경로를 받는다. */
  onOpenSource: (path: string) => void;
  /**
   * 아모라에게 묻기. 항목 id가 없으면 분야 전체 질문이다. 채팅으로 가는 경로는 화면이
   * 만든다 — 웹뷰 링크와 같은 `amoraSource` 경로(`@/lib/amoraPreparationSource`)를 쓴다.
   */
  onAskAmora: (itemId?: string) => void;
}) {
  /**
   * 항목 질문 버튼은 **공유 템플릿에 있는 항목에만** 단다. 예전 버전이 저장한 항목이나
   * 직접 추가한 항목은 서버 정본에 없어 질문 초안을 받을 수 없다(웹 모달과 같은 규칙).
   */
  const templateItemIds = useMemo(
    () => new Set((CHECKLIST_MAP[categoryKey]?.items ?? []).map((item) => item.id)),
    [categoryKey],
  );

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
  // 완료로 표시한 분야도 가리키지 않는다(웹 모달과 같은 규칙) — 끝났다고 한 분야에 다음 할 일은 없다.
  const nextItemId = stats.skipped || (stats.declared && stats.status === "completed")
    ? undefined
    : groups.flatMap((group) => group.items).find((item) => !item.done)?.id;

  /** 고리·줄이 퍼센트를 말하지 않는 경우. 웹 모달처럼 줄표와 「분야 상태로 표시함」을 쓴다. */
  const hidesPercent = stats.skipped || stats.declared;

  const guide = mannersGuideForCategory(categoryKey);

  /**
   * 근거 칩을 그릴 항목 id. 같은 편을 가리키는 항목이 여럿이면 똑같은 줄이 여러 번
   * 서는데 시안은 한 번만 그린다. 자료는 그대로 두고 **표시만** 첫 항목 하나로 줄인다.
   *
   * 그리면서 거르지 않고 미리 센다 — 렌더 중에 그릇을 채우면 두 번째 렌더부터
   * 전부 걸러진다(웹에서 실제로 칩이 전멸했다).
   */
  const chipItemIds = useMemo(() => {
    const seen = new Set<string>();
    const ids = new Set<string>();
    for (const group of groups) {
      for (const item of group.items) {
        const chip = checklistNoteSourceChip(item.id, guide?.slug);
        if (!chip || seen.has(chip.label)) continue;
        seen.add(chip.label);
        ids.add(item.id);
      }
    }
    return ids;
  }, [groups, guide?.slug]);

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
            percent={hidesPercent ? 0 : stats.percent}
            label={`${label} 완료율`}
            centerText={hidesPercent ? "—" : `${stats.percent}%`}
          />
          <View style={s.headText}>
            <Text style={s.title} numberOfLines={2}>{label}</Text>
            <View style={s.metaRow}>
              <Text style={s.statusChip}>
                {PREPARATION_PROGRESS_STATUS_LABELS[stats.skipped ? "not_applicable" : stats.status]}
              </Text>
              <Text style={s.meta}>
                {stats.skipped
                  ? "진행률에서 제외됨"
                  : stats.declared
                    ? "분야 상태로 표시함 · 항목은 확인 전"
                    : `${stats.done}/${stats.total} 완료 · ${stats.percent}%`}
              </Text>
            </View>
          </View>
        </View>

        <ScrollView style={s.body} contentContainerStyle={s.bodyContent}>


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

                  const chip = chipItemIds.has(item.id)
                    ? checklistNoteSourceChip(item.id, guide?.slug)
                    : undefined;

                  return (
                    // 근거 칩은 항목 버튼 **밖 형제**다. 이름을 가진 `Pressable` 안에
                    // 또 `Pressable` 을 넣으면 스크린리더가 안쪽을 못 누른다
                    // (`screenReaderCanReach.test.mjs` 가 잡는다). 웹 모달도 같은 이유로
                    // 링크를 체크박스 밖에 둔다.
                    <View
                      key={item.id}
                      style={index === group.items.length - 1 ? s.itemRowLast : s.itemBlock}
                    >
                    <View style={s.itemLine}>
                    <Pressable
                      style={s.itemRow}
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
                      {/*
                        시안의 동그라미는 **채워진 원반 + 흰 체크**다. lucide 의
                        `CheckCircle2` 는 고리가 끊겨 있고 체크가 밖으로 나와 다른
                        모양이 된다. 그래서 View 로 직접 그린다 — 지름도 정확히 22px 이
                        되고, 「다음 할 일」의 연한 장미 채움도 여기서만 줄 수 있다.
                      */}
                      {item.done ? (
                        <View style={[s.mark, s.markDone]}>
                          <Check size={13} color="#FFFFFF" strokeWidth={2.4} />
                        </View>
                      ) : (
                        <View style={[s.mark, isNext ? s.markNext : s.markTodo]} />
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
                    {/*
                      항목 질문 버튼도 체크 버튼 **밖 형제**다(근거 칩과 같은 이유).
                      눌러도 체크는 바뀌지 않고, 채팅 입력창에 질문만 채워진다.
                    */}
                    {templateItemIds.has(item.id) ? (
                      <Pressable
                        style={({ pressed }) => [s.amoraIconButton, pressed && s.amoraPressed]}
                        onPress={() => onAskAmora(item.id)}
                        accessibilityRole="button"
                        accessibilityLabel={`${item.label} 아모라에 질문하기`}
                        accessibilityHint={AMORA_QUESTION_HINT}
                        hitSlop={4}
                      >
                        <AmoraMark size={20} />
                      </Pressable>
                    ) : null}
                    </View>
                    {chip ? (
                      <Pressable
                        style={s.sourceChip}
                        onPress={() => onOpenSource(chip.path)}
                        accessibilityRole="link"
                        accessibilityLabel={chip.label}
                      >
                        <BookOpen size={12} color={colors.paper.pen} />
                        <Text style={s.sourceChipText}>{chip.label}</Text>
                      </Pressable>
                    ) : null}
                    </View>
                  );
                })}
              </View>
            );
          })}

          {/*
            「우리는 이건 안 해요」 — 시안 여덟 장에 없는 줄이라 **맨 끝으로** 내렸다.
            본문 첫 줄에 있으면 시트를 열었을 때 「01 · …」 그룹이 54px 밀린다.
            기능은 지울 수 없다(안 하는 분야를 못 끄면 진행률에 영구 미완료로 남는다).
          */}
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
        </ScrollView>

        <View style={s.foot}>
          <View style={s.tipRow}>
            <Sparkle size={15} color={colors.gold.DEFAULT} strokeWidth={1.7} />
            <Text style={s.tipText}>{tip}</Text>
          </View>
          <View style={s.footActions}>
            {guide ? (
              <Pressable
                style={s.guide}
                onPress={() => onOpenGuide(guide.slug)}
                accessibilityRole="link"
                accessibilityLabel={`${guide.title} 보기`}
              >
                <BookOpen size={15} color={colors.paper.ink} />
                <Text style={s.guideText} numberOfLines={2}>{guide.title} 보기</Text>
              </Pressable>
            ) : null}
            {/* 분야 전체 질문. 웹 모달의 「아모라 질문」과 같은 자리·같은 말이다. */}
            <Pressable
              style={({ pressed }) => [s.amoraButton, !guide && s.amoraButtonWide, pressed && s.amoraPressed]}
              onPress={() => onAskAmora()}
              accessibilityRole="button"
              accessibilityLabel={`${label} 아모라에 질문하기`}
              accessibilityHint={AMORA_QUESTION_HINT}
            >
              <AmoraMark size={18} />
              <Text style={s.amoraButtonText}>아모라 질문</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "rgba(58,42,39,0.5)" },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    top: 120,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    // 시안의 위쪽 그림자 — 시트가 목록 위에 떠 있다는 신호다.
    shadowColor: "rgba(58,42,39,0.22)",
    shadowOffset: { width: 0, height: -14 },
    shadowOpacity: 1,
    shadowRadius: 20,
    elevation: 12,
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
  title: { fontSize: 17, lineHeight: 22, fontFamily: "NotoSansKR_600SemiBold", color: colors.paper.ink },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 3 },
  statusChip: {
    fontSize: 10.5,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.paper.inkSoft,
    backgroundColor: colors.surfaceLow,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 100,
    overflow: "hidden",
  },
  meta: { fontSize: 11.5, fontFamily: "NotoSansKR_400Regular", color: colors.textTertiary },

  body: { flex: 1 },
  bodyContent: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 20 },

  skipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 44,
    marginTop: 24,
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
  groupTitle: { fontSize: 11.5, fontFamily: "NotoSansKR_700Bold", color: colors.rose[600] },
  groupCount: { fontSize: 11, fontFamily: "NotoSansKR_400Regular", color: colors.textTertiary },

  itemBlock: { borderBottomWidth: 1, borderBottomColor: "#E5DDC9" },
  itemRowLast: { borderBottomWidth: 0 },
  itemLine: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  itemRow: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 11,
    paddingHorizontal: 2,
    paddingVertical: 13,
    minHeight: 44,
  },
  mark: {
    width: 22,
    height: 22,
    borderRadius: 11,
    marginTop: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  markDone: { backgroundColor: colors.sage[500] },
  markNext: { borderWidth: 1.8, borderColor: colors.rose[500], backgroundColor: colors.rose.pale },
  markTodo: { borderWidth: 1.8, borderColor: "#E5DDC9" },
  itemTextColumn: { flex: 1, minWidth: 0 },
  itemTopRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 7 },
  itemLabel: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: "NotoSansKR_500Medium",
    color: colors.paper.ink,
  },
  itemNext: { fontFamily: "NotoSansKR_600SemiBold" },
  itemDone: {
    color: colors.textTertiary,
    textDecorationLine: "line-through",
    // iOS 만 이 색을 쓴다. 안드로이드는 글자색으로 긋는다 — RN 의 한계다.
    textDecorationColor: "#E5DDC9",
  },
  sourceChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    marginLeft: 33,
    marginTop: -4,
    marginBottom: 12,
    minHeight: 38,
    paddingHorizontal: 13,
    borderRadius: 100,
    backgroundColor: colors.ivory.warm,
  },
  sourceChipText: {
    fontSize: 11.5,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.paper.pen,
  },
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
  footActions: { flexDirection: "row", alignItems: "stretch", gap: 8 },
  // 아모라 질문 버튼 — 라운지 아모라 버튼과 같은 정체성 색(`amoraIdentity`)을 쓴다.
  // 웹 `AMORA_ACTION_CLASS`(아이보리 바탕·장미 선·장미 글자)와 같은 조합이다.
  amoraButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    minHeight: 46,
    paddingHorizontal: 14,
    borderRadius: amoraIdentity.radius,
    borderWidth: 1,
    borderColor: amoraIdentity.line,
    backgroundColor: amoraIdentity.surface,
  },
  amoraButtonWide: { flex: 1 },
  amoraButtonText: { fontSize: 13, fontFamily: "NotoSansKR_600SemiBold", color: amoraIdentity.ink },
  amoraIconButton: {
    width: 44,
    height: 44,
    marginTop: 4,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: amoraIdentity.radius,
    borderWidth: 1,
    borderColor: amoraIdentity.line,
    backgroundColor: amoraIdentity.surface,
  },
  amoraPressed: { backgroundColor: amoraIdentity.hover },
  tipText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 19,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.paper.inkSoft,
  },
  guide: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    minHeight: 46,
    paddingHorizontal: 10,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  guideText: { flexShrink: 1, textAlign: "center", fontSize: 13, fontFamily: "NotoSansKR_600SemiBold", color: colors.paper.ink },
});
