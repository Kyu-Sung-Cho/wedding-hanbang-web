import type { WeddingCodeV05AxisKey } from "@/constants/weddingCodeV05";
import type { WeddingCodeV05AxisScore, WeddingCodeV05ScoreResult } from "./score";

export type WeddingCodeV05AxisReport = {
  key: WeddingCodeV05AxisKey;
  labelKo: string;
  summaryKo: string;
  leftLabelKo: string;
  rightLabelKo: string;
  leftCount: number;
  rightCount: number;
  leftScore: number | null;
  rightScore: number | null;
  responsePattern: WeddingCodeV05AxisScore["responsePattern"];
};

export type WeddingCodeV05ActionCard = {
  id: "first_then" | "work_boundary" | "contract_check";
  titleKo: string;
  bodyKo: string;
};

export type WeddingCodeV05IndividualReport = {
  titleKo: string;
  subtitleKo: string;
  shareSummaryKo: string;
  shareNoteKo: string;
  sharePromptKo: string;
  axisReports: WeddingCodeV05AxisReport[];
  talkStarters: string[];
  actionCards: WeddingCodeV05ActionCard[];
  disclaimerKo: string;
};

const INDIVIDUAL_DISCLAIMER =
  "이 베타 결과는 현재 16개 답변에서 각 시작점을 고른 횟수만 정리해요. 성격·관계·결혼의 앞날을 진단하거나 예측하지 않습니다.";

export function buildWeddingCodeV05IndividualReport(
  score: WeddingCodeV05ScoreResult
): WeddingCodeV05IndividualReport {
  const axisReports = score.publicAxes.map(axisToReport);

  return {
    titleKo: "이번 답변에서 먼저 고른 것들",
    subtitleKo: `${score.answeredCount}개 장면을 네 가지 준비 순서로 나눠, 고른 횟수 그대로 보여드려요.`,
    shareSummaryKo: axisReports.map(shareLabel).join(" · "),
    shareNoteKo: "16개 가상 장면에서 고른 횟수예요. 성격·관계 진단이 아니에요.",
    sharePromptKo: "가상 장면에서 너는 무엇을 먼저 골라?",
    axisReports,
    // 특정 축을 "가장 강한" 대화 주제로 자동 승격하지 않는다. 사용자가
    // 현재 필요한 주제를 직접 고르게 해 동률의 첫 축 편향도 피한다.
    talkStarters: [
      "서로 결과를 보여주기 전에, 이번 주 준비에서 먼저 맞추고 싶은 것 하나를 말해보세요.",
      "네 가지 시작점 중 지금 가장 대화가 필요한 것 하나를 각자 고르고, 왜 먼저 필요한지 말해보세요.",
    ],
    actionCards: [
      {
        id: "first_then",
        titleKo: "먼저와 그다음 나누기",
        bodyKo: "둘 다 중요한 기준이라면 무엇을 먼저 말하고 무엇을 그다음 확인할지 순서만 정해보세요.",
      },
      {
        id: "work_boundary",
        titleKo: "같이 볼 일과 맡을 일",
        bodyKo: "예약 확정처럼 되돌리기 어려운 결정은 같이 보고, 자료 찾기처럼 나눌 수 있는 일은 담당을 정해보세요.",
      },
      {
        id: "contract_check",
        titleKo: "예약 전 공통 확인",
        bodyKo: "어떤 시작점을 골랐든 총금액, 추가 비용, 취소 조건은 예약 문서에서 따로 확인하세요.",
      },
    ],
    disclaimerKo: INDIVIDUAL_DISCLAIMER,
  };
}

function axisToReport(axis: WeddingCodeV05AxisScore): WeddingCodeV05AxisReport {
  return {
    key: axis.key,
    labelKo: axis.labelKo,
    summaryKo: axis.displayKo,
    leftLabelKo: axis.leftLabelKo,
    rightLabelKo: axis.rightLabelKo,
    leftCount: axis.leftCount,
    rightCount: axis.rightCount,
    leftScore: axis.leftScore,
    rightScore: axis.rightScore,
    responsePattern: axis.responsePattern,
  };
}

function shareLabel(axis: WeddingCodeV05AxisReport): string {
  if (axis.responsePattern === "insufficient_data") return `${axis.labelKo} 미완료`;
  if (axis.leftCount === axis.rightCount) {
    switch (axis.key) {
      case "decisionCriteria":
        return "조건·장면 2:2";
      case "preparationMode":
        return "같이·분담 2:2";
      case "coordinationScope":
        return "둘·주변 2:2";
      case "supportOrder":
        return "마음·할 일 2:2";
    }
  }
  const selectedLabel = axis.leftCount > axis.rightCount ? axis.leftLabelKo : axis.rightLabelKo;
  return `${selectedLabel} ${Math.max(axis.leftCount, axis.rightCount)}/4`;
}
