import { axisInfo, type Axis } from "@/constants/weddingCodeV40";
import { encodeCode } from "@/lib/weddingCode/v40/codec";
import { compareCouple } from "@/lib/weddingCode/v40/couple";
import { answerText } from "@/lib/weddingCode/v40/present";
import { splitCountsOf, stateIndex } from "@/lib/weddingCode/v40/states";
import { itemValue } from "@/lib/weddingCode/v40/value";
import type { Bank, CoupleAxisRow, CoupleItemPair, CoupleResult, DecodedCode, Perspective, ScoredItem } from "@/lib/weddingCode/v40/types";

/** 공용 v40 화면 폴더는 새 판 모듈을 가져오지 않는다. source는 현재 승인된 v4.2 원문만 받는다. */
const REPORT_SOURCE_VERSION: Bank["version"] = "v4.2-depth";

export interface CoupleReportSource {
  readonly bank: Bank;
  readonly first: DecodedCode;
  readonly second: DecodedCode;
}

export interface CoupleReportCounts {
  readonly answered: number;
  readonly frontCount: number;
  readonly backCount: number;
  readonly neutralCount: number;
}

export interface CoupleReportScene {
  readonly itemId: string;
  readonly caption: string;
  readonly prompt: readonly string[];
  readonly firstText: string;
  readonly secondText: string;
  /** `other`는 전체 상위 셋에는 없지만 두 사람이 실제로 답한 문항이다. */
  readonly kind: "different" | "similar" | "other";
}

export interface CoupleReportRoles {
  readonly intro: string;
  readonly frontTask: string;
  readonly backTask: string;
  /** 제안 대상일 뿐 확정 담당자가 아니다. 화면이 나/상대 관점으로 이름을 붙인다. */
  readonly frontCandidate: Perspective | null;
  readonly backCandidate: Perspective | null;
}

export interface CouplePreparationRow {
  readonly axis: Axis;
  readonly state: "same" | "different" | "even" | "excluded";
  readonly exclusionReason: "unset" | "provisional" | "gate" | null;
  readonly helpfulPoint: string;
  readonly coordinationSituation: string;
  readonly roleSuggestion: CoupleReportRoles | null;
  readonly firstCriterion: string;
  readonly evidence: {
    readonly first: CoupleReportCounts;
    readonly second: CoupleReportCounts;
    readonly scene: CoupleReportScene | null;
  };
}

export interface CouplePreparationReport {
  /** 잘못 연결된 원문은 사례로 쓰지 않는다. */
  readonly sourceStatus: "absent" | "verified" | "rejected";
  readonly rows: readonly [CouplePreparationRow, CouplePreparationRow, CouplePreparationRow, CouplePreparationRow];
}

const AXIS_COPY: Readonly<Record<Axis, {
  readonly sameFrontHelpful: string;
  readonly sameBackHelpful: string;
  readonly differentHelpful: string;
  readonly evenHelpful: string;
  readonly sameFrontCoordination: string;
  readonly sameBackCoordination: string;
  readonly coordinationSituation: string;
  readonly frontTask: string;
  readonly backTask: string;
  readonly firstCriterion: string;
}>> = {
  money: {
    sameFrontHelpful: "두 사람 모두 돈에서는 조건 먼저 쪽 글자가 나왔어요. 같은 후보의 총액·추가금을 함께 적어 보면 비교의 출발점이 될 수 있어요.",
    sameBackHelpful: "두 사람 모두 돈에서는 장면 먼저 쪽 글자가 나왔어요. 같은 후보에서 꼭 남기고 싶은 하루의 장면과 분위기를 각각 적어 보면 선택 기준을 이야기할 수 있어요.",
    differentHelpful: "돈을 정할 때 한쪽은 조건, 다른 한쪽은 그날 장면 쪽 글자예요. 같은 후보의 총액·추가금과 남기고 싶은 장면을 나란히 적어 볼 수 있어요.",
    evenHelpful: "돈에 관한 답에서 한쪽 이상은 뚜렷한 방향으로 모이지 않았어요. 같은 후보의 조건과 남기고 싶은 장면을 모두 적고 이번 선택의 기준을 정해 볼 수 있어요.",
    sameFrontCoordination: "같은 조건 먼저 쪽이어도 얼마를 한도로 둘지, 꼭 지킬 조건과 조정할 조건을 어디서 나눌지 맞춰 보세요.",
    sameBackCoordination: "같은 장면 먼저 쪽이어도 어떤 순간과 분위기를 우선할지 서로 맞춰 보세요.",
    coordinationSituation: "같은 후보를 고를 때 총액·조건과 그날 남길 경험 중 무엇을 먼저 볼지 달라질 수 있어요.",
    frontTask: "같은 후보의 총액·추가금·취소 조건을 적어 보기",
    backTask: "같은 후보에서 남기고 싶은 장면·분위기를 적어 보기",
    firstCriterion: "이번 후보에서 반드시 지킬 금액·조건과 꼭 남기고 싶은 장면을 각각 하나씩 적어 볼까요?",
  },
  process: {
    sameFrontHelpful: "두 사람 모두 준비 과정에서는 같이 하기 쪽 글자가 나왔어요. 상담이나 후보 비교를 함께 볼 시점을 적어 두면 준비 순서를 이야기할 수 있어요.",
    sameBackHelpful: "두 사람 모두 준비 과정에서는 나눠 하기 쪽 글자가 나왔어요. 맡을 일과 완료 뒤 공유할 내용을 따로 적어 보면 역할의 경계를 이야기할 수 있어요.",
    differentHelpful: "준비 과정에서 함께 보고 싶은 순간과 따로 맡고 싶은 범위를 일정에 나란히 적어 볼 수 있어요.",
    evenHelpful: "준비 과정에서 한쪽 이상은 함께하기와 나눠 하기에 뚜렷하게 기울지 않았어요. 이번 일에서 같이 볼 부분과 맡길 부분을 따로 정해 볼 수 있어요.",
    sameFrontCoordination: "같이 본다는 범위를 상담, 중간 확인, 마지막 선택 중 어디까지로 볼지 맞춰 보세요.",
    sameBackCoordination: "담당을 나눌 때 언제 중간 내용을 알려 주고 마지막 선택은 어디까지 함께할지 맞춰 보세요.",
    coordinationSituation: "후보를 찾고 고르기까지 함께 확인할 시점과 나눠 맡을 범위를 정할 때 이야기해 볼 수 있어요.",
    frontTask: "함께 볼 상담·결정과 중간 공유 시점을 적어 보기",
    backTask: "따로 맡을 일과 마친 뒤 전달할 내용을 적어 보기",
    firstCriterion: "어떤 일은 함께 보고, 어떤 일은 맡기며, 중간에는 언제 공유할까요?",
  },
  scope: {
    sameFrontHelpful: "두 사람 모두 정하는 범위에서는 둘이 정하기 쪽 글자가 나왔어요. 초대 명단이나 식의 방식에서 둘의 초안을 먼저 적어 볼 수 있어요.",
    sameBackHelpful: "두 사람 모두 정하는 범위에서는 가족과 정하기 쪽 글자가 나왔어요. 미리 의견을 들을 항목과 시점을 목록으로 만들어 볼 수 있어요.",
    differentHelpful: "둘이 먼저 초안을 쓸 항목과 가족 의견을 먼저 들을 항목을 나눠 적어 볼 수 있어요.",
    evenHelpful: "함께 정하는 사람의 범위에서 한쪽 이상은 뚜렷한 방향으로 모이지 않았어요. 이번 항목마다 둘이 정할 부분과 가족에게 물을 부분을 확인해 볼 수 있어요.",
    sameFrontCoordination: "둘이 먼저 정하더라도 가족에게 알리기 전에 어디까지 확정할지 맞춰 보세요.",
    sameBackCoordination: "가족에게 미리 묻더라도 누구에게 무엇을 언제 물을지, 들은 뒤 둘의 선택은 어떻게 할지 맞춰 보세요.",
    coordinationSituation: "초대 명단이나 식의 방식을 정할 때 둘이 먼저 정할 부분과 가족에게 물을 부분을 나눠 볼 수 있어요.",
    frontTask: "둘이 먼저 결정할 항목의 초안을 적어 보기",
    backTask: "가족에게 미리 여쭐 항목과 시점을 적어 보기",
    firstCriterion: "둘이 먼저 정할 항목과 가족에게 미리 물을 항목의 경계는 어디인가요?",
  },
  support: {
    sameFrontHelpful: "두 사람 모두 지친 날에는 마음 먼저 쪽 글자가 나왔어요. 말로 먼저 확인받거나 건네고 싶은 표현을 각자 적어 볼 수 있어요.",
    sameBackHelpful: "두 사람 모두 지친 날에는 할 일 먼저 쪽 글자가 나왔어요. 어떤 일의 도움을 원하거나 제안하고 싶은지 각자 적어 볼 수 있어요.",
    differentHelpful: "지친 날의 답이 마음 확인과 할 일 덜기 쪽으로 달랐어요. 실제 지친 날에는 어느 반응이 먼저 필요한지 물어볼 수 있어요.",
    evenHelpful: "지친 날의 답에서 한쪽 이상은 뚜렷한 방향으로 모이지 않았어요. 말과 행동 중 하나를 미리 고정하지 않고 그날 필요한 첫 반응을 물어볼 수 있어요.",
    sameFrontCoordination: "마음을 먼저 확인하더라도 어떤 말을 듣고 싶은지, 언제 물어봐 주면 좋은지 맞춰 보세요.",
    sameBackCoordination: "할 일을 먼저 덜더라도 어떤 일은 부탁받고 맡는 게 좋은지 맞춰 보세요.",
    coordinationSituation: "준비가 벅찬 날 말로 알아주기와 실제 할 일 덜기 중 어떤 반응이 필요한지 확인해 볼 수 있어요.",
    frontTask: "각자 지친 날 듣고 싶은 말이나 확인 질문을 적어 보기",
    backTask: "각자 부탁하거나 제안하고 싶은 도움을 적어 보기",
    firstCriterion: "지친 날 처음에는 어떤 말이나 행동이 필요한지 서로 어떻게 확인할까요?",
  },
};

function countsOf(side: CoupleAxisRow["first"]): CoupleReportCounts {
  return {
    answered: side.answered,
    frontCount: side.frontCount,
    backCount: side.backCount,
    neutralCount: side.neutralCount,
  };
}

function sourceIsVerified(result: CoupleResult, source: CoupleReportSource): boolean {
  try {
    // bank는 같은 실행 흐름의 신뢰된 부모가 넘긴다. 객체 동일성에 기대지 않고 판·응답 완전성·결과 재계산을 대조한다.
    if (source.bank.version !== REPORT_SOURCE_VERSION || source.bank.items.length !== 68) return false;
    if (encodeCode(source.bank, source.first.formBit, source.first.responses) === null) return false;
    if (encodeCode(source.bank, source.second.formBit, source.second.responses) === null) return false;
    return JSON.stringify(compareCouple(source.bank, source.first, source.second)) === JSON.stringify(result);
  } catch {
    return false;
  }
}

function sceneFromPair(pair: CoupleItemPair, kind: CoupleReportScene["kind"]): CoupleReportScene {
  return {
    itemId: pair.itemId,
    caption: pair.caption,
    prompt: pair.prompt,
    firstText: pair.firstText,
    secondText: pair.secondText,
    kind,
  };
}

interface Candidate {
  readonly item: ScoredItem;
  readonly firstText: string;
  readonly secondText: string;
  readonly rank: number;
}

/** 중립 칸도 유효 답이다. 기존 answerText는 방향 인용에서 이를 생략하므로 실제 누른 칸·배분을 그대로 기술한다. */
function actualAnswerText(item: ScoredItem, value: string): string | null {
  const directional = answerText(item, value);
  if (directional !== null) return directional;
  if (itemValue(item, value) !== 0) return null;
  if (item.fmt === "react") return "양쪽 사이의 가운데 칸을 골랐어요";
  if (item.fmt === "split") {
    const state = stateIndex(value);
    if (state === null) return null;
    const counts = splitCountsOf(state);
    return item.entries.map((entry, index) => `「${entry.text}」 ${counts[index]}칸`).join(" · ");
  }
  return null;
}

/** 상위 셋에 들지 못했어도 두 사람이 실제 유효하게 답한 문항 하나를 고른다. */
function sceneFromSource(axis: Axis, source: CoupleReportSource): CoupleReportScene | null {
  let best: Candidate | null = null;
  for (const item of source.bank.scoredByAxis[axis]) {
    const rawFirst = source.first.responses[item.id];
    const rawSecond = source.second.responses[item.id];
    const firstValue = itemValue(item, rawFirst);
    const secondValue = itemValue(item, rawSecond);
    if (firstValue === null || secondValue === null) continue;
    const firstText = rawFirst === undefined ? null : actualAnswerText(item, rawFirst);
    const secondText = rawSecond === undefined ? null : actualAnswerText(item, rawSecond);
    if (firstText === null || secondText === null) continue;
    // 반대 방향 → 한쪽 중립 → 같은 방향 다른 세기 → 완전히 같은 답 순서. 각 층 안에서는 값 차이가 큰 장면을 먼저 둔다.
    const opposite = firstValue * secondValue < 0;
    const oneNeutral = (firstValue === 0) !== (secondValue === 0);
    const rank = (opposite ? 3000 : oneNeutral ? 2000 : firstValue !== secondValue ? 1000 : 0)
      + Math.abs(firstValue - secondValue) * 10 + Math.min(Math.abs(firstValue), Math.abs(secondValue));
    if (best === null || rank > best.rank) best = { item, firstText, secondText, rank };
  }
  if (best === null) return null;
  const item = best.item;
  return {
    itemId: item.id,
    caption: item.caption,
    prompt: item.fmt === "react"
      ? [item.stem, ...(item.quote ? [`${item.quote.speaker} · 「${item.quote.text}」`] : []), item.question]
      : [item.stem],
    firstText: best.firstText,
    secondText: best.secondText,
    kind: "other",
  };
}

function sceneFor(axis: Axis, result: CoupleResult, sourceStatus: CouplePreparationReport["sourceStatus"], source?: CoupleReportSource): CoupleReportScene | null {
  if (sourceStatus === "rejected") return null;
  const different = result.talk.find((pair) => pair.axis === axis);
  if (different !== undefined) return sceneFromPair(different, "different");
  const similar = result.similar.find((pair) => pair.axis === axis);
  if (similar !== undefined) return sceneFromPair(similar, "similar");
  return sourceStatus === "verified" && source !== undefined ? sceneFromSource(axis, source) : null;
}

function stateOf(row: CoupleAxisRow): CouplePreparationRow["state"] {
  if (row.excluded) return "excluded";
  if (row.tag === "same" || row.tag === "different") return row.tag;
  return "even";
}

function exclusionReasonOf(row: CoupleAxisRow): CouplePreparationRow["exclusionReason"] {
  if (!row.excluded) return null;
  if (row.first.letter === null || row.second.letter === null) return "unset";
  if (row.first.provisional || row.second.provisional) return "provisional";
  return "gate";
}

function helpfulPointFor(row: CoupleAxisRow, state: CouplePreparationRow["state"]): string {
  const copy = AXIS_COPY[row.axis];
  switch (state) {
    case "same":
      return `${row.first.letter === axisInfo(row.axis).front ? copy.sameFrontHelpful : copy.sameBackHelpful} 같은 글자여도 실제 장면마다 선택은 다를 수 있어요.`;
    case "different":
      return copy.differentHelpful;
    case "even":
      return copy.evenHelpful;
    case "excluded":
      return `「${axisInfo(row.axis).title}」에서 이번 답만으로는 두 사람의 방향을 비교하지 않아요. 각자 중요하게 볼 기준을 적는 것부터 시작할 수 있어요.`;
  }
}

function rolesFor(row: CoupleAxisRow, state: CouplePreparationRow["state"]): CoupleReportRoles | null {
  if (state === "excluded") return null;
  const copy = AXIS_COPY[row.axis];
  const stableDifference = state === "different"
    && (row.first.shownBand === "clear" || row.first.shownBand === "lean")
    && (row.second.shownBand === "clear" || row.second.shownBand === "lean")
    && !row.first.provisional && !row.second.provisional;
  // 도움 축에는 받는 반응·주는 행동·다툼·혼자 회복이 섞여 있다. H/A로 누가 돌봄을 맡을지 유추하지 않는다.
  const assignCandidate = stableDifference && row.axis !== "support";
  const front = axisInfo(row.axis).front;
  const frontCandidate: Perspective | null = assignCandidate ? (row.first.letter === front ? "first" : "second") : null;
  const backCandidate: Perspective | null = assignCandidate ? (frontCandidate === "first" ? "second" : "first") : null;
  return {
    intro: row.axis === "support"
      ? "각자 필요한 말과 도움을 적고, 실제 지친 날에는 상대에게 원하는 반응을 확인해 보세요. 돌봄 담당은 글자로 정하지 않아요."
      : stableDifference
      ? "이번 후보 한 가지를 두 기준으로 나눠 살펴볼 수 있어요. 아래 사람 표시는 담당 확정이 아니라 대화를 시작하는 제안이에요."
      : state === "same"
        ? "같은 글자여도 원하는 역할은 다를 수 있어요. 두 기준을 나눠 적고 실제 담당은 함께 정해 보세요."
        : "한 방향을 담당으로 고정하지 말고 두 기준을 함께 살펴본 뒤 역할을 정해 보세요.",
    frontTask: copy.frontTask,
    backTask: copy.backTask,
    frontCandidate,
    backCandidate,
  };
}

function rowFor(row: CoupleAxisRow, result: CoupleResult, sourceStatus: CouplePreparationReport["sourceStatus"], source?: CoupleReportSource): CouplePreparationRow {
  const state = stateOf(row);
  const copy = AXIS_COPY[row.axis];
  return {
    axis: row.axis,
    state,
    exclusionReason: exclusionReasonOf(row),
    helpfulPoint: helpfulPointFor(row, state),
    coordinationSituation: state === "excluded"
      ? "비교를 보류한 주제예요. 지금은 누구의 방향이 더 맞는지 정하지 않고 각자 필요한 기준을 확인해 보세요."
      : state === "same"
        ? row.first.letter === axisInfo(row.axis).front ? copy.sameFrontCoordination : copy.sameBackCoordination
        : copy.coordinationSituation,
    roleSuggestion: sourceStatus === "rejected" ? null : rolesFor(row, state),
    firstCriterion: copy.firstCriterion,
    evidence: {
      first: countsOf(row.first),
      second: countsOf(row.second),
      scene: state === "excluded" ? null : sceneFor(row.axis, result, sourceStatus, source),
    },
  };
}

/** 현재 응답과 실제 원문에 한정한 네 주제 준비 제안. 점수·궁합·확정 담당을 만들지 않는다. */
export function buildCouplePreparationReport(result: CoupleResult, source?: CoupleReportSource): CouplePreparationReport {
  const sourceStatus: CouplePreparationReport["sourceStatus"] = source === undefined ? "absent" : sourceIsVerified(result, source) ? "verified" : "rejected";
  const rows: CouplePreparationReport["rows"] = [
    rowFor(result.axes[0], result, sourceStatus, source),
    rowFor(result.axes[1], result, sourceStatus, source),
    rowFor(result.axes[2], result, sourceStatus, source),
    rowFor(result.axes[3], result, sourceStatus, source),
  ];
  return { sourceStatus, rows };
}
