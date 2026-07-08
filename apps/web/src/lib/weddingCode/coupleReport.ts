import { WEDDING_CODE_V05_QUESTIONS, WEDDING_CODE_V05_VERSION } from "@/constants/weddingCodeV05";
import { toWeddingCodeV05Answers } from "./answers";
import { buildWeddingCodeV05CoupleReport, type WeddingCodeV05CoupleReport } from "./report";
import { scoreWeddingCodeV05 } from "./score";

export interface WeddingCodeStoredResponseForCouple {
  created_at: string | null;
  form_version: string | null;
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
    .filter((row) => row.form_version === WEDDING_CODE_V05_VERSION)
    .slice(0, 2);
  if (compatibleRows.length < 2) {
    return {
      status: "incompatible",
      responseCount: rows.length,
      messageKo: "두 응답의 테스트 버전이 달라서 아직 비교할 수 없어요.",
    };
  }

  const answerSets = compatibleRows.map((row) => toWeddingCodeV05Answers(row.answers));
  const scores = answerSets.map((answers) => scoreWeddingCodeV05(answers));
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
      firstAnswers: answerSets[0],
      secondAnswers: answerSets[1],
    }),
    participants: [
      { submittedAt: compatibleRows[0].created_at, answeredCount: scores[0].answeredCount },
      { submittedAt: compatibleRows[1].created_at, answeredCount: scores[1].answeredCount },
    ],
  };
}
