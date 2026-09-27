/**
 * 아모라 대화를 처음 열 때 '함께 대화'와 '나만 (상담)' 중 하나를 고르는 카드.
 *
 * 2026-09-26 파운더 결정. 지금까지 앱 아모라는 누구에게나 '함께 대화'로 열렸다. 이제는 처음
 * 여는 사람에게 이 카드를 먼저 보이고, 고르기 전에는 보내지 못하게 한다(`chat.tsx`).
 *
 * - 문구는 `@hanbang/shared/amora-lane-choice` 의 정본을 그대로 그린다. 웹 두 화면과 같은 한 벌이다.
 * - 버튼 이름은 위쪽 탭 이름과 같다. 카드로 고르든 탭으로 고르든 화면은 같은 처리를 탄다.
 * - '파트너가 연결되면' 덧붙임은 파트너가 아직 없을 때만 붙인다. 연결된 사람에게는 틀린 말이 된다.
 * - 버튼이 읽히는 이름은 탭 이름 그대로 두고, 설명은 힌트로 읽힌다. 버튼 안에 다른 버튼을 두지
 *   않는다(안쪽 버튼이 스크린리더에서 사라진다).
 */
import { Pressable, StyleSheet, View } from "react-native";
import { Lock } from "lucide-react-native";
import { amoraIdentity, colors } from "@hanbang/design-tokens";
import { Text } from "@/components/ui/AppText";
import AmoraMark from "@/components/ui/AmoraMark";
import {
  AMORA_LANE_CHOICE_COPY,
  type AmoraLaneChoice,
} from "@hanbang/shared/amora-lane-choice";

export interface AmoraLaneChoiceCardProps {
  /** 파트너가 연결돼 있는가. 아니면 '함께 대화' 설명 뒤에 덧붙임 한 줄을 붙인다. */
  hasLinkedPartner: boolean;
  disabled: boolean;
  onChoose: (lane: AmoraLaneChoice) => void;
}

export function AmoraLaneChoiceCard({ hasLinkedPartner, disabled, onChoose }: AmoraLaneChoiceCardProps) {
  const copy = AMORA_LANE_CHOICE_COPY;
  const sharedHint = hasLinkedPartner
    ? copy.shared.description
    : `${copy.shared.description} ${copy.shared.unlinkedPartnerNote}`;
  return (
    <View style={st.card}>
      <Text style={st.title} accessibilityRole="header">{copy.title}</Text>
      <Pressable
        onPress={() => onChoose("shared")}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={copy.shared.label}
        accessibilityHint={sharedHint}
        accessibilityState={{ disabled }}
        style={({ pressed }) => [st.option, pressed && !disabled && st.optionPressed]}
      >
        <View style={st.optionHead}>
          <AmoraMark size={16} color={amoraIdentity.ink} />
          <Text style={[st.optionLabel, st.sharedLabel]}>{copy.shared.label}</Text>
        </View>
        <Text style={st.optionDescription}>{copy.shared.description}</Text>
        {!hasLinkedPartner && <Text style={st.optionNote}>{copy.shared.unlinkedPartnerNote}</Text>}
      </Pressable>
      <Pressable
        onPress={() => onChoose("private")}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={copy.private.label}
        accessibilityHint={copy.private.description}
        accessibilityState={{ disabled }}
        style={({ pressed }) => [st.option, pressed && !disabled && st.optionPressed]}
      >
        <View style={st.optionHead}>
          <Lock size={16} color={colors.sage.deep} />
          <Text style={[st.optionLabel, st.privateLabel]}>{copy.private.label}</Text>
        </View>
        <Text style={st.optionDescription}>{copy.private.description}</Text>
      </Pressable>
      <Text style={st.footnote}>{copy.footnote}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 16,
    padding: 16,
    gap: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  title: { fontSize: 16, lineHeight: 24, fontWeight: "600", color: colors.textPrimary },
  option: {
    minHeight: 44,
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  optionPressed: { backgroundColor: colors.ivory[100] },
  optionHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  optionLabel: { fontSize: 15, lineHeight: 22, fontWeight: "600" },
  sharedLabel: { color: colors.rose[700] },
  privateLabel: { color: colors.sage.deep },
  optionDescription: { fontSize: 13, lineHeight: 19, color: colors.textSecondary },
  optionNote: { fontSize: 12, lineHeight: 18, color: colors.paper.inkFaint },
  footnote: { fontSize: 12, lineHeight: 18, color: colors.paper.inkFaint },
});
