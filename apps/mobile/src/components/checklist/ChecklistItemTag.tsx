/**
 * 항목 옆에 붙는 작은 표시 — 웹 모달의 `ItemTag` 와 같은 세 가지.
 *
 * 시안은 셋에 같은 클래스를 썼지만 뜻은 갈린다. 「다음 할 일」은 진행 상태고
 * 나머지 둘은 항목의 성격이다. 그래서 진행 상태만 채운 장미색으로 두고, 성격
 * 표시 둘은 연한 바탕에 글자색으로 구분한다.
 *
 * ⚠️ 「필수」는 사용자에게 **사실을 주장한다.** 붙는 자리는 데이터
 * (`@hanbang/shared/constants` 의 `CHECKLIST_ITEM_TAGS`)가 정하고 172개 중 10개뿐이다.
 * 여기서 조건을 만들어 더 붙이지 마라.
 *
 * 표시는 **글자로 나간다.** 색만으로 뜻을 지지 않으므로 따로 읽어 줄 필요가 없다.
 */
import { StyleSheet } from "react-native";
import { Text } from "@/components/ui/AppText";
import { colors } from "@hanbang/design-tokens";
import type { ChecklistItemTag as TagKind } from "@hanbang/shared/constants";

export default function ChecklistItemTag({ kind }: { kind: TagKind | "다음 할 일" }) {
  // 시안의 `.must` 는 「필수」와 「다음 할 일」이 같은 모양이다(연한 장미 바탕 +
  // 진한 장미 글자). 「해당 시」만 베이지다.
  const tone = kind === "해당 시" ? s.conditional : s.required;
  const text = kind === "해당 시" ? s.conditionalText : s.requiredText;
  return <Text style={[s.base, tone, text]}>{kind}</Text>;
}

const s = StyleSheet.create({
  base: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 100,
    fontSize: 9.5,
    fontFamily: "NotoSansKR_700Bold",
    overflow: "hidden",
  },
  required: { backgroundColor: colors.rose.pale },
  requiredText: { color: colors.rose[700] },
  conditional: { backgroundColor: colors.surfaceLow },
  conditionalText: { color: colors.paper.inkFaint },
});
