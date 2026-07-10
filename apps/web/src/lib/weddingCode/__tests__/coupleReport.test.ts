import { describe, expect, it } from "vitest";
import {
  WEDDING_CODE_V05_QUESTIONS,
  WEDDING_CODE_V05_SCORING_VERSION,
  WEDDING_CODE_V05_VERSION,
} from "@/constants/weddingCodeV05";
import {
  buildWeddingCodeCoupleReportPayload,
  parseWeddingCodeCoupleReportPayload,
  type WeddingCodeStoredResponseForCouple,
} from "../coupleReport";

const BANNED_PUBLIC_WORDS = ["궁합", "적합도", "결혼 성공", "성공률", "이혼", "갈등 위험", "희귀"];

function answers(value: "A" | "B" | "C" | "D") {
  return Object.fromEntries(WEDDING_CODE_V05_QUESTIONS.map((question) => [question.key, value]));
}

function row(
  answerValue: "A" | "B" | "C" | "D",
  overrides: Partial<WeddingCodeStoredResponseForCouple> = {}
): WeddingCodeStoredResponseForCouple {
  return {
    created_at: "2026-07-08T00:00:00.000Z",
    form_version: WEDDING_CODE_V05_VERSION,
    scoring_version: WEDDING_CODE_V05_SCORING_VERSION,
    answers: answers(answerValue),
    ...overrides,
  };
}

function flattenText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(flattenText).join("\n");
  if (value && typeof value === "object") return Object.values(value).map(flattenText).join("\n");
  return "";
}

describe("WeddingCode couple report payload", () => {
  it("waits until two responses are present", () => {
    const payload = buildWeddingCodeCoupleReportPayload([row("A")]);

    expect(payload.status).toBe("waiting");
    expect(payload.responseCount).toBe(1);
    expect(flattenText(payload)).not.toContain("궁합");
  });

  it("rejects mixed versions instead of comparing incompatible results", () => {
    const payload = buildWeddingCodeCoupleReportPayload([
      row("A"),
      row("B", { form_version: "v0.4.2" }),
    ]);

    expect(payload.status).toBe("incompatible");
    expect(flattenText(payload)).toContain("버전");
  });

  it("compares compatible copy-only candidates without relabeling their verbatim choices", () => {
    const payload = buildWeddingCodeCoupleReportPayload([
      row("A", { form_version: "v0.5-candidate.1" }),
      row("B"),
    ]);

    expect(payload.status).toBe("ready");
    if (payload.status !== "ready") return;
    expect(payload.report.scenarioCards).toHaveLength(0);
  });

  it("does not quote current labels for two responses from the same historical form", () => {
    const payload = buildWeddingCodeCoupleReportPayload([
      row("A", { form_version: "v0.5-candidate.8" }),
      row("B", { form_version: "v0.5-candidate.8" }),
    ]);

    expect(payload.status).toBe("ready");
    if (payload.status !== "ready") return;
    expect(payload.report.scenarioCards).toHaveLength(0);
  });

  it("does not compare rows produced by a different scoring contract", () => {
    const payload = buildWeddingCodeCoupleReportPayload([
      row("A"),
      row("B", { scoring_version: "wc-v05-score.legacy" }),
    ]);

    expect(payload.status).toBe("incompatible");
    expect(flattenText(payload)).toContain("계산 기준");
  });

  it("builds a bounded preparation-style overlap report for two v0.5 responses", () => {
    const payload = buildWeddingCodeCoupleReportPayload([row("A"), row("D")]);

    expect(payload.status).toBe("ready");
    if (payload.status !== "ready") return;
    expect(payload.report.titleKo).toContain("준비 방식 겹침도");
    expect(payload.report.overlapScore).not.toBeNull();
    expect(payload.participants).toHaveLength(2);
    expect(payload.participants[0].answeredCount).toBe(16);
    expect(payload.report.scenarioCards.length).toBeGreaterThan(0);
    expect(flattenText(payload.report.scenarioCards)).toContain("한 사람");
    for (const word of BANNED_PUBLIC_WORDS) {
      expect(flattenText(payload.report)).not.toContain(word);
    }
  });

  it("does not compare incomplete v0.5 rows", () => {
    const payload = buildWeddingCodeCoupleReportPayload([
      row("A"),
      row("B", { answers: { A1: "B" } }),
    ]);

    expect(payload.status).toBe("incompatible");
    expect(flattenText(payload)).toContain("전체 응답");
  });

  it("accepts a complete ready payload and rejects malformed 2xx shapes", () => {
    const ready = buildWeddingCodeCoupleReportPayload([row("A"), row("D")]);

    expect(parseWeddingCodeCoupleReportPayload(ready)).toEqual(ready);
    expect(parseWeddingCodeCoupleReportPayload({ status: "oops", responseCount: 2 })).toBeNull();
    expect(
      parseWeddingCodeCoupleReportPayload({ status: "ready", responseCount: 2 })
    ).toBeNull();
    expect(
      parseWeddingCodeCoupleReportPayload({
        ...ready,
        report: ready.status === "ready" ? { ...ready.report, easyPoints: [null] } : null,
      })
    ).toBeNull();
  });
});
