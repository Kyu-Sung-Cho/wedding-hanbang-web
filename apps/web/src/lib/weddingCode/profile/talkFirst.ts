import type { WeddingCodeV06AxisKey } from "@/constants/weddingCodeV06";
import {
  WEDDING_CODE_TALK_FIRST_ITEMS,
  WEDDING_CODE_TALK_FIRST_LEFT_OUT,
  WEDDING_CODE_TALK_FIRST_MORE,
  WEDDING_CODE_TALK_FIRST_SUMMARY,
  WEDDING_CODE_TALK_FIRST_THIN_NOTE,
  weddingCodeTalkFirstPartnerLine,
  type WeddingCodeTalkFirstLeftOutReason,
} from "@/constants/weddingCodeTalkFirst";
import { weddingCodeSceneCountLabel } from "@/lib/weddingCode/scene/config";
import { withJosa } from "@/lib/weddingCode/scene/selfProfile";
import {
  WEDDING_CODE_FIRMNESS_LABEL,
  type WeddingCodeLetterSlot,
  type WeddingCodeLetters,
} from "./letters";

/**
 * 혼자 결과의 「이번 주엔 뭐부터 같이 얘기해 볼까요?」 — 어느 주제를 먼저 꺼낼지 고른다.
 *
 * ## 고르는 규칙
 *
 * 1. 글자가 있고 **두 장면 이상** 답한 주제만 쓴다. 한 장면(1 대 0)은 글자가 「모두 같은
 *    쪽」으로 나오지만 한 장면으로 순서를 매기기엔 너무 얇다. 양쪽 수가 같거나 건너뛴
 *    주제도 쓰지 않는다 — 없는 답으로 할 얘기를 지어내지 않는다.
 * 2. 두 장면 이상 차이 나는 주제(모두 같은 쪽·한쪽이 더 많음)를 **차이 순**으로 두 개까지.
 *    굳기 라벨이 아니라 실제 차이로 줄 세운다 — 세 장면 건너뛴 2 대 0 이 4 대 1 을
 *    앞지르지 않게.
 * 3. 하나 차이로 갈린 주제를 하나(앞의 것이 없으면 둘) 덧붙인다. 답한 장면이 많은 쪽 먼저.
 * 4. 항목을 채우려고 늘리지 않는다. 쓸 주제가 없으면 `null` 이고, 화면은 이 칸을 그리지
 *    않는다(카드 아래 원래 안내가 대신 나온다).
 *
 * 뺀 주제는 이유와 함께 모두 말한다(건너뜀 → 같은 수 → 한 장면 순). 이유가 여럿이어도
 * 한 문장으로 잇는다(「~고, ~서 여기선 뺐어요.」). 답을 적게 할수록 이 칸은 **덜** 말한다.
 */

export type WeddingCodeTalkKind = "lean" | "split";

export type WeddingCodeTalkFirstItem = Readonly<{
  axis: WeddingCodeV06AxisKey;
  kind: WeddingCodeTalkKind;
  slot: WeddingCodeLetterSlot;
  /** 「모두 같은 쪽 · 답한 5장면」. 굳기 라벨만 두면 세 장면 건너뛴 2 대 0 도 「모두 같은 쪽」으로 읽힌다. */
  tagLabel: string;
  lead: string;
  detail: string;
}>;

export type WeddingCodeTalkFirst = Readonly<{
  /** 왜 이 주제들을 골랐는지. */
  summary: string;
  /** 골라 적을 수 있는 주제가 자리보다 많았으면 나머지가 어디 있는지. 아니면 null. */
  more: string | null;
  /** 뺀 주제와 이유를 한 문장으로. 뺀 주제가 없으면 null. */
  leftOut: string | null;
  /** 답한 장면이 절반이 안 되면 그 사실. 아니면 null. */
  thinNote: string | null;
  /** 1~3개. 순서가 곧 먼저 꺼낼 순서다. */
  items: readonly WeddingCodeTalkFirstItem[];
  partnerLine: string;
}>;

export type WeddingCodeTalkFirstCounts = Readonly<{ answered: number; total: number }>;

const LEAN_LIMIT = 2;

function marginOf(slot: WeddingCodeLetterSlot): number {
  return slot.majority - slot.minority;
}

function leftOutReasonOf(slot: WeddingCodeLetterSlot): WeddingCodeTalkFirstLeftOutReason | null {
  if (slot.answered === 0) return "skipped";
  if (slot.upper === null) return "tie";
  if (slot.answered === 1) return "single";
  return null;
}

const LEFT_OUT_ORDER: readonly WeddingCodeTalkFirstLeftOutReason[] = ["skipped", "tie", "single"];

/** 이유마다 주제를 묶고, 마지막 묶음만 「~서 여기선 뺐어요.」로 끝내 한 문장으로 잇는다. */
function leftOutSentence(slots: readonly WeddingCodeLetterSlot[]): string | null {
  const groups = LEFT_OUT_ORDER.flatMap((reason) => {
    const group = slots.filter((slot) => leftOutReasonOf(slot) === reason);
    if (group.length === 0) return [];
    const labels = group.map((slot) => `‘${slot.axisLabel}’`).join(", ");
    return [{ reason, topic: withJosa(labels, "은", "는") }];
  });
  if (groups.length === 0) return null;
  return groups
    .map(({ reason, topic }, index) => {
      const forms = WEDDING_CODE_TALK_FIRST_LEFT_OUT[reason];
      return index === groups.length - 1 ? forms.last(topic) : forms.mid(topic);
    })
    .join(" ");
}

function itemOf(slot: WeddingCodeLetterSlot, kind: WeddingCodeTalkKind): WeddingCodeTalkFirstItem {
  const entries = WEDDING_CODE_TALK_FIRST_ITEMS[slot.axis];
  // lean 은 글자가 있는 주제에서만 나온다(chosen 이 null 이면 usable 에 들지 못했다).
  const copy = kind === "split" ? entries.split : entries[slot.chosen ?? "left"];
  return {
    axis: slot.axis,
    kind,
    slot,
    tagLabel: `${WEDDING_CODE_FIRMNESS_LABEL[slot.firmness]} · 답한 ${slot.answered}장면`,
    lead: copy.lead,
    detail: copy.detail,
  };
}

function summaryOf(leanCount: number, splitCount: number): string {
  if (splitCount === 0) {
    return leanCount > 1 ? WEDDING_CODE_TALK_FIRST_SUMMARY.leanMany : WEDDING_CODE_TALK_FIRST_SUMMARY.leanOne;
  }
  if (leanCount === 0) {
    return splitCount > 1 ? WEDDING_CODE_TALK_FIRST_SUMMARY.splitMany : WEDDING_CODE_TALK_FIRST_SUMMARY.splitOne;
  }
  return WEDDING_CODE_TALK_FIRST_SUMMARY.leanAndSplit;
}

export function buildWeddingCodeTalkFirst(
  letters: WeddingCodeLetters,
  counts: WeddingCodeTalkFirstCounts,
): WeddingCodeTalkFirst | null {
  const indexed = letters.slots.map((slot, index) => ({ slot, index }));
  const usable = indexed.filter(({ slot }) => slot.upper !== null && slot.answered >= 2);
  if (usable.length === 0) return null;

  const lean = usable
    .filter(({ slot }) => slot.firmness === "firm" || slot.firmness === "clear")
    .sort((a, b) =>
      marginOf(b.slot) - marginOf(a.slot)
      || b.slot.answered - a.slot.answered
      || a.index - b.index,
    );
  const split = usable
    .filter(({ slot }) => slot.firmness === "narrow")
    .sort((a, b) => b.slot.answered - a.slot.answered || a.index - b.index);

  const leanPicked = lean.slice(0, LEAN_LIMIT);
  const splitPicked = split.slice(0, leanPicked.length === 0 ? 2 : 1);
  const items = [
    ...leanPicked.map(({ slot }) => itemOf(slot, "lean")),
    ...splitPicked.map(({ slot }) => itemOf(slot, "split")),
  ];

  const sceneLabel = weddingCodeSceneCountLabel(counts.total);
  return {
    summary: summaryOf(leanPicked.length, splitPicked.length),
    more: lean.length + split.length > items.length ? WEDDING_CODE_TALK_FIRST_MORE : null,
    leftOut: leftOutSentence(letters.slots),
    thinNote: counts.answered * 2 < counts.total ? WEDDING_CODE_TALK_FIRST_THIN_NOTE : null,
    items,
    partnerLine: weddingCodeTalkFirstPartnerLine(sceneLabel),
  };
}
