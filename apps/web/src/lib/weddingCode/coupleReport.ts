import {
  WEDDING_CODE_V05_COMPATIBLE_VERSIONS,
  WEDDING_CODE_V05_QUESTIONS,
  WEDDING_CODE_V05_SCORING_VERSION,
  WEDDING_CODE_V05_VERSION,
} from "@/constants/weddingCodeV05";
import { isRecord } from "@/utils/requestValidation";
import { toWeddingCodeV05Answers } from "./answers";
import { buildWeddingCodeV05CoupleReport, type WeddingCodeV05CoupleReport } from "./report";
import { scoreWeddingCodeV05 } from "./score";

type CompatibleWeddingCodeVersion = (typeof WEDDING_CODE_V05_COMPATIBLE_VERSIONS)[number];

export interface WeddingCodeStoredResponseForCouple {
  created_at: string | null;
  form_version: string | null;
  scoring_version: string | null;
  answers: unknown;
}

export type WeddingCodeCoupleReportPayload =
  | {
      status: "waiting";
      responseCount: number;
      messageKo: string;
    }
  | {
      status: "incompatible";
      responseCount: number;
      messageKo: string;
    }
  | {
      status: "ready";
      responseCount: 2;
      report: WeddingCodeV05CoupleReport;
      participants: [
        { submittedAt: string | null; answeredCount: number },
        { submittedAt: string | null; answeredCount: number },
      ];
    };

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isCoupleAxis(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.key === "string" &&
    typeof value.labelKo === "string" &&
    isFiniteNumber(value.overlapScore) &&
    (value.label === "high" || value.label === "medium" || value.label === "low") &&
    typeof value.summaryKo === "string" &&
    typeof value.firstSideKo === "string" &&
    typeof value.secondSideKo === "string"
  );
}

function isScenarioCard(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    (value.relation === "same" || value.relation === "different") &&
    [
      value.categoryKo,
      value.titleKo,
      value.firstChoiceKo,
      value.secondChoiceKo,
      value.attentionKo,
      value.solutionKo,
      value.firstQuestionKo,
    ].every((item) => typeof item === "string")
  );
}

function isSolutionCard(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.axisKey === "string" &&
    isFiniteNumber(value.overlapScore) &&
    [
      value.categoryKo,
      value.titleKo,
      value.attentionKo,
      value.solutionKo,
      value.firstQuestionKo,
    ].every((item) => typeof item === "string")
  );
}

/** Fail closed on malformed 2xx payloads before the result UI dereferences them. */
export function parseWeddingCodeCoupleReportPayload(
  raw: unknown
): WeddingCodeCoupleReportPayload | null {
  if (!isRecord(raw) || !Number.isInteger(raw.responseCount)) return null;

  if (raw.status === "waiting" || raw.status === "incompatible") {
    if (
      typeof raw.messageKo !== "string" ||
      (raw.responseCount as number) < 0 ||
      (raw.responseCount as number) > 2
    ) {
      return null;
    }
    return raw as WeddingCodeCoupleReportPayload;
  }

  if (raw.status !== "ready" || raw.responseCount !== 2 || !isRecord(raw.report)) {
    return null;
  }

  const report = raw.report;
  if (
    typeof report.titleKo !== "string" ||
    (report.overlapScore !== null && !isFiniteNumber(report.overlapScore)) ||
    typeof report.overlapLabelKo !== "string" ||
    !Array.isArray(report.easyPoints) ||
    !report.easyPoints.every(isCoupleAxis) ||
    (report.talkFirst !== null && !isCoupleAxis(report.talkFirst)) ||
    !Array.isArray(report.scenarioCards) ||
    !report.scenarioCards.every(isScenarioCard) ||
    !Array.isArray(report.solutionCards) ||
    !report.solutionCards.every(isSolutionCard) ||
    typeof report.guideKo !== "string" ||
    typeof report.disclaimerKo !== "string" ||
    !Array.isArray(raw.participants) ||
    raw.participants.length !== 2 ||
    !raw.participants.every(
      (participant) =>
        isRecord(participant) &&
        (participant.submittedAt === null || typeof participant.submittedAt === "string") &&
        Number.isInteger(participant.answeredCount)
    )
  ) {
    return null;
  }

  return raw as WeddingCodeCoupleReportPayload;
}

export function buildWeddingCodeCoupleReportPayload(
  rows: readonly WeddingCodeStoredResponseForCouple[]
): WeddingCodeCoupleReportPayload {
  if (rows.length < 2) {
    return {
      status: "waiting",
      responseCount: rows.length,
      messageKo: "아직 상대 응답을 기다리고 있어요.",
    };
  }

  const compatibleRows = rows
    .filter(
      (row) =>
        WEDDING_CODE_V05_COMPATIBLE_VERSIONS.includes(row.form_version as CompatibleWeddingCodeVersion) &&
        row.scoring_version === WEDDING_CODE_V05_SCORING_VERSION
    )
    .slice(0, 2);
  if (compatibleRows.length < 2) {
    return {
      status: "incompatible",
      responseCount: rows.length,
      messageKo: "두 응답의 테스트 버전 또는 계산 기준이 달라서 아직 비교할 수 없어요.",
    };
  }

  const answerSets = compatibleRows.map((row) => toWeddingCodeV05Answers(row.answers));
  const scores = answerSets.map((answers) => scoreWeddingCodeV05(answers));
  const canQuoteCurrentLabels = compatibleRows.every(
    (row) => row.form_version === WEDDING_CODE_V05_VERSION
  );
  if (scores.some((score) => score.answeredCount < WEDDING_CODE_V05_QUESTIONS.length)) {
    return {
      status: "incompatible",
      responseCount: rows.length,
      messageKo: "v0.5 전체 응답 2개가 있어야 비교할 수 있어요.",
    };
  }

  return {
    status: "ready",
    responseCount: 2,
    report: buildWeddingCodeV05CoupleReport(scores[0], scores[1], {
      // Copy-only candidates share scoring, but their option labels are not
      // immutable snapshots. Suppress verbatim choice cards for mixed forms
      // rather than quoting an older response with the newest wording.
      firstAnswers: canQuoteCurrentLabels ? answerSets[0] : undefined,
      secondAnswers: canQuoteCurrentLabels ? answerSets[1] : undefined,
    }),
    participants: [
      { submittedAt: compatibleRows[0].created_at, answeredCount: scores[0].answeredCount },
      { submittedAt: compatibleRows[1].created_at, answeredCount: scores[1].answeredCount },
    ],
  };
}
