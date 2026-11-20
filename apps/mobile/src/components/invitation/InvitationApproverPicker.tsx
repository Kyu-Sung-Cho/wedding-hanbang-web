import { Pressable, StyleSheet, View } from "react-native";
import { LETTER_STATE_COPY, type InquiryApproverMode, type InquiryApproverProposal } from "@hanbang/shared/invitation";
import { Text } from "@/components/ui/AppText";
import InvitationButton from "./InvitationButton";
import { hitSlopFor, lineHeight, palette, typo } from "./invitationStyle";

export type ApproverChoice = { mode: "designated"; userId: string } | { mode: "both" };

type Member = { id: string; name: string | null; isViewer: boolean };

type Props = {
  mode: InquiryApproverMode;
  designatedUserId: string | null;
  members: readonly Member[];
  onChoose: (choice: ApproverChoice) => void;
  /** 저장하는 동안에는 다시 고르지 못한다. */
  busy?: boolean;
  /** 상대가 확인해야 바뀌는 승인 방식 제안(없으면 null). 확인 전까지는 지금 방식(`mode`)이 그대로 쓰인다. */
  pending?: InquiryApproverProposal | null;
  /** 상대가 낸 제안에 답한다. true 는 확인, false 는 거절. */
  onRespond?: (accept: boolean) => void;
};

type ApproverProposalView =
  | { role: "none" }
  /** 내가 낸 제안. 상대가 확인하면 바뀐다. 지금 방식 칩을 다시 누르면 거둔다. */
  | { role: "proposer"; proposedKey: string | null }
  /** 상대가 낸 제안. 누가 무엇을 제안했는지 말할 수 있을 때만 확인·거절을 둔다. */
  | { role: "responder"; proposedKey: string | null; sentence: string | null };

/** 칩 하나를 가리키는 열쇠. 사람 칩은 그 사람 ID, "두 사람 모두" 칩은 "both". */
function choiceKey(mode: InquiryApproverMode, userId: string | null): string | null {
  if (mode === "both") return "both";
  return mode === "designated" ? userId : null;
}

/**
 * 확인을 기다리는 제안을 화면 몫으로 나눈다. 이름은 승인 방식 칸이 준 이름만 쓴다(이름 대신 쓸 말을 지어내지
 * 않는다). 누가 무엇을 제안했는지 말할 수 없으면 확인·거절을 두지 않는다 — 무엇에 동의하는지 모르는 채 누르게
 * 하지 않는다. 그때도 제안은 남고 지금 방식이 그대로 쓰인다.
 */
function approverProposalView(pending: InquiryApproverProposal | null | undefined, members: readonly Member[]): ApproverProposalView {
  if (!pending) return { role: "none" };
  const proposedKey = choiceKey(pending.mode, pending.designatedUserId);
  if (!pending.viewerCanRespond) {
    const viewer = members.find((member) => member.isViewer);
    return viewer && viewer.id === pending.proposedBy ? { role: "proposer", proposedKey } : { role: "none" };
  }
  const proposer = members.find((member) => member.id === pending.proposedBy)?.name?.trim();
  const chosen = pending.mode === "designated"
    ? members.find((member) => member.id === pending.designatedUserId)?.name?.trim()
    : null;
  const choice = pending.mode === "both"
    ? LETTER_STATE_COPY.approverBoth
    : chosen ? LETTER_STATE_COPY.approverPerson(chosen) : null;
  return {
    role: "responder",
    proposedKey,
    sentence: proposer && choice ? LETTER_STATE_COPY.approverProposedBy(proposer, choice) : null,
  };
}

/**
 * 편지 시트 안의 "누가 승인할까요?"(D-76, 2026-11-16 파운더 "커플이 정하게"). 커플이 고른다:
 * 정한 한 사람, 또는 두 사람 모두. 아직 고르지 않았으면 한 분이 승인해도 되고 두 분 모두 알림을 받는다는
 * 것을 그대로 말한다. 칩 모양은 비교 화면 정렬 칩(38px 알약, 13px)과 같다.
 * 이름이 없는 사람은 칩으로 고를 수 없다(이름 대신 쓸 말을 지어내지 않는다).
 *
 * 상대의 승인 권한을 줄이는 변경은 상대가 확인할 때까지 제안으로만 남는다(2026-11-17 보안 검토). 제안한 방식의
 * 칩은 점선으로 둔다. 제안한 사람에게는 `approverPending` 을 보이고, 지금 방식 칩을 다시 누르면 제안을 거둔다.
 * 다른 회원에게는 `approverProposedBy` 와 확인·거절을 보인다.
 */
export default function InvitationApproverPicker({
  mode,
  designatedUserId,
  members,
  onChoose,
  busy = false,
  pending = null,
  onRespond,
}: Props) {
  const named = members.filter((member): member is Member & { name: string } => Boolean(member.name?.trim()));
  const designated = mode === "designated" ? members.find((member) => member.id === designatedUserId) ?? null : null;
  const explain = mode === "both"
    ? LETTER_STATE_COPY.approverNeedsBoth
    : designated?.name
      ? LETTER_STATE_COPY.approverDesignated(designated.name)
      : LETTER_STATE_COPY.approverUnset;
  const proposal = approverProposalView(pending, members);
  const proposedKey = proposal.role === "none" ? null : proposal.proposedKey;
  // 내가 낸 제안이 기다리는 동안에는 지금 방식 칩도 누를 수 있다(다시 고르면 제안을 거둔다).
  const withdrawable = proposal.role === "proposer";
  return (
    <View style={styles.root}>
      <Text accessibilityRole="header" style={[typo.sans, styles.heading]}>{LETTER_STATE_COPY.approverHeading}</Text>
      <View style={styles.chips}>
        {named.map((member) => {
          const on = mode === "designated" && designatedUserId === member.id;
          return (
            <Chip
              key={member.id}
              label={LETTER_STATE_COPY.approverPerson(member.name)}
              on={on}
              proposed={proposedKey === member.id}
              pressable={!on || withdrawable}
              disabled={busy}
              onPress={() => onChoose({ mode: "designated", userId: member.id })}
            />
          );
        })}
        {members.length >= 2 ? (
          <Chip
            label={LETTER_STATE_COPY.approverBoth}
            on={mode === "both"}
            proposed={proposedKey === "both"}
            pressable={mode !== "both" || withdrawable}
            disabled={busy}
            onPress={() => onChoose({ mode: "both" })}
          />
        ) : null}
      </View>
      <Text style={[typo.sans, styles.explain]}>{explain}</Text>
      {proposal.role === "proposer" ? (
        <Text accessibilityLiveRegion="polite" style={[typo.sans, styles.explain]}>{LETTER_STATE_COPY.approverPending}</Text>
      ) : null}
      {proposal.role === "responder" && proposal.sentence ? (
        <ProposalAnswer sentence={proposal.sentence} busy={busy} onRespond={onRespond} />
      ) : null}
    </View>
  );
}

/**
 * 직접 보내기(D-83 1단계)의 편지 시트에는 승인 칸이 없다. 그래도 상대가 이미 낸 승인 방식 제안에는 답할 수 있게
 * 그 확인·거절만 그린다(서버는 이미 온 제안의 확인·거절을 받는다). 답할 제안이 없거나 누가 무엇을 제안했는지
 * 말할 수 없으면 아무것도 그리지 않는다.
 */
export function InvitationProposalAnswer({
  pending,
  members,
  busy = false,
  onRespond,
}: {
  pending: InquiryApproverProposal | null;
  members: readonly Member[];
  busy?: boolean;
  onRespond: (accept: boolean) => void;
}) {
  const proposal = approverProposalView(pending, members);
  if (proposal.role !== "responder" || !proposal.sentence) return null;
  return <ProposalAnswer sentence={proposal.sentence} busy={busy} onRespond={onRespond} />;
}

function ProposalAnswer({ sentence, busy, onRespond }: { sentence: string; busy: boolean; onRespond?: (accept: boolean) => void }) {
  return (
    <View style={styles.proposal}>
      <Text accessibilityLiveRegion="polite" style={[typo.sans, styles.proposalText]}>{sentence}</Text>
      <View style={styles.chips}>
        <InvitationButton
          label={LETTER_STATE_COPY.approverConfirm}
          onPress={busy ? undefined : () => onRespond?.(true)}
          disabled={busy}
          variant="ink"
          height={38}
          paddingHorizontal={15}
          fontSize={13}
          weight="700"
        />
        <InvitationButton
          label={LETTER_STATE_COPY.approverDecline}
          onPress={busy ? undefined : () => onRespond?.(false)}
          disabled={busy}
          variant="outline"
          height={38}
          paddingHorizontal={15}
          fontSize={13}
        />
      </View>
    </View>
  );
}

function Chip({
  label,
  on,
  proposed,
  pressable,
  disabled,
  onPress,
}: {
  label: string;
  on: boolean;
  /** 확인을 기다리는 제안의 방식(점선). */
  proposed: boolean;
  /** 고른 칩은 보통 다시 누를 수 없다. 내가 낸 제안을 거둘 때만 누를 수 있다. */
  pressable: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={pressable && !disabled ? onPress : undefined}
      accessibilityRole="button"
      accessibilityState={{ selected: on, disabled }}
      hitSlop={hitSlopFor(38)}
      style={[styles.chip, on ? styles.chipOn : proposed ? styles.chipProposed : styles.chipOff]}
    >
      <Text style={[typo.sans, styles.chipText, on && { color: palette.white }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { gap: 10 },
  heading: { fontSize: 13, color: palette.muted },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { height: 38, paddingHorizontal: 15, borderRadius: 19, justifyContent: "center" },
  chipOn: { backgroundColor: palette.ink },
  chipOff: { borderWidth: 1, borderColor: palette.chipLine, backgroundColor: palette.white },
  // 아직 바뀌지 않은 제안의 방식. 준비 순서 "넣기"와 같은 점선이다.
  chipProposed: { borderWidth: 1, borderColor: palette.dashed, borderStyle: "dashed", backgroundColor: palette.white },
  chipText: { fontSize: 13 },
  explain: { fontSize: 13, lineHeight: lineHeight(13, 1.6), color: palette.body },
  proposal: { gap: 10, padding: 14, borderRadius: 18, backgroundColor: palette.paperSoft },
  proposalText: { fontSize: 13, lineHeight: lineHeight(13, 1.55), color: palette.body },
});
