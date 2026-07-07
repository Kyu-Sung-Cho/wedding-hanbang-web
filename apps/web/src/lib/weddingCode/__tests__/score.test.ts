import { describe, expect, it } from "vitest";
import {
  WEDDING_CODE_V05_EXPOSURE_MAX,
  WEDDING_CODE_V05_NON_PUBLIC_CONSTRUCTS,
  WEDDING_CODE_V05_PUBLIC_AXES,
  WEDDING_CODE_V05_QUESTIONS,
  type WeddingCodeV05QuestionKey,
} from "@/constants/weddingCodeV05";
import { WEDDING_CODE_CONSTRUCT_KEYS } from "@/lib/wedding-code/types";
import {
  assertWeddingCodeV05ExposureMaxMatchesDraft,
  computeWeddingCodeV05GlobalExposureMax,
  publicAxisUsesInternalOnlyConstructs,
  scoreWeddingCodeV05,
} from "../score";

describe("WeddingCode v0.5 candidate item integrity", () => {
  it("16개 문항과 문항별 4개 선택지를 유지한다", () => {
    expect(WEDDING_CODE_V05_QUESTIONS).toHaveLength(16);
    expect(new Set(WEDDING_CODE_V05_QUESTIONS.map((question) => question.key)).size).toBe(16);
    for (const question of WEDDING_CODE_V05_QUESTIONS) {
      expect(question.options, question.key).toHaveLength(4);
      expect(question.status).toBe("candidate_pending_human_validation");
    }
  });

  it("모든 가중치는 등록된 construct만 사용하고 1~2점만 쓴다", () => {
    const constructKeys = new Set<string>(WEDDING_CODE_CONSTRUCT_KEYS);
    for (const question of WEDDING_CODE_V05_QUESTIONS) {
      for (const option of question.options) {
        expect(option.weights.length, `${question.key}-${option.value}`).toBeGreaterThan(0);
        for (const weight of option.weights) {
          expect(constructKeys.has(weight.construct), `${question.key}-${option.value}`).toBe(true);
          expect([1, 2]).toContain(weight.value);
        }
      }
    }
  });

  it("D3에는 guidanceNeed 점수 누수가 없고, 예전 비난 프레임을 쓰지 않는다", () => {
    const d3 = WEDDING_CODE_V05_QUESTIONS.find((question) => question.key === "D3")!;
    expect(d3.question).toContain("준비 속도");
    expect(d3.question).not.toContain("미루");
    const d3Constructs = d3.options.flatMap((option) => option.weights.map((weight) => weight.construct));
    expect(d3Constructs).not.toContain("guidanceNeed");
  });

  it("D4는 빠른 결정을 낙인찍지 않고 조건 확인 시간을 묻는다", () => {
    const d4 = WEDDING_CODE_V05_QUESTIONS.find((question) => question.key === "D4")!;
    expect(d4.question).toContain("오늘 계약하면 혜택");
    expect(d4.options.map((option) => option.label).join(" ")).toContain("총액·추가금·취소 조건");
    expect(d4.options.map((option) => option.label).join(" ")).not.toContain("잡고 싶다");
  });

  it("exposureMax는 문항 데이터에서 재계산한 값과 문서 반영값이 일치한다", () => {
    expect(computeWeddingCodeV05GlobalExposureMax()).toEqual(WEDDING_CODE_V05_EXPOSURE_MAX);
    expect(assertWeddingCodeV05ExposureMaxMatchesDraft()).toBe(true);
  });
});

describe("WeddingCode v0.5 normalized scoring", () => {
  it("공개 축은 DPR/GN 내부 전용 construct를 사용하지 않는다", () => {
    expect(publicAxisUsesInternalOnlyConstructs()).toBe(false);
    const internalOnly = new Set<string>(WEDDING_CODE_V05_NON_PUBLIC_CONSTRUCTS);
    for (const axis of WEDDING_CODE_V05_PUBLIC_AXES) {
      expect([...axis.left.constructs, ...axis.right.constructs].some((construct) => internalOnly.has(construct))).toBe(false);
    }
  });

  it("전체 응답을 정규화해 0~100 범위 점수와 공개 축을 만든다", () => {
    const answers = Object.fromEntries(
      WEDDING_CODE_V05_QUESTIONS.map((question) => [question.key, "A"])
    ) as Record<WeddingCodeV05QuestionKey, "A">;
    const result = scoreWeddingCodeV05(answers);

    expect(result.answeredCount).toBe(16);
    expect(result.warnings).toEqual([]);
    for (const score of Object.values(result.constructScores)) {
      if (score.exposureMax === 0) {
        expect(score.normalized).toBeNull();
      } else {
        expect(score.normalized).toBeGreaterThanOrEqual(0);
        expect(score.normalized).toBeLessThanOrEqual(100);
      }
    }
    expect(result.publicAxes).toHaveLength(4);
    expect(result.publicAxes.every((axis) => !axis.displayKo.includes("궁합"))).toBe(true);
    expect(result.publicAxes.every((axis) => !axis.displayKo.includes("갈등"))).toBe(true);
  });

  it("부분 응답은 응답한 문항의 exposure만 사용하고 부족한 축은 insufficient_data로 둔다", () => {
    const result = scoreWeddingCodeV05({ A1: "A" });
    expect(result.answeredCount).toBe(1);
    expect(result.constructScores.costRisk.exposureMax).toBeGreaterThan(0);
    expect(result.constructScores.familyIntegration.exposureMax).toBe(0);
    expect(result.constructScores.familyIntegration.normalized).toBeNull();
    expect(result.publicAxes.some((axis) => axis.leaning === "insufficient_data")).toBe(true);
  });

  it("내부 샘플 5개가 금지어 없이 서로 다른 축 패턴을 만든다", () => {
    const samples: Record<string, Record<WeddingCodeV05QuestionKey, "A" | "B" | "C" | "D">> = {
      costGuard: {
        A1: "A", A2: "B", A3: "A", A4: "A",
        B1: "C", B2: "B", B3: "D", B4: "A",
        C1: "C", C2: "B", C3: "D", C4: "A",
        D1: "C", D2: "C", D3: "B", D4: "C",
      },
      meaningMood: {
        A1: "B", A2: "A", A3: "B", A4: "B",
        B1: "D", B2: "D", B3: "B", B4: "C",
        C1: "D", C2: "A", C3: "A", C4: "C",
        D1: "A", D2: "B", D3: "A", D4: "D",
      },
      roleOrganizer: {
        A1: "D", A2: "C", A3: "A", A4: "C",
        B1: "B", B2: "C", B3: "A", B4: "B",
        C1: "B", C2: "B", C3: "D", C4: "D",
        D1: "C", D2: "D", D3: "C", D4: "A",
      },
      familyBridge: {
        A1: "C", A2: "D", A3: "C", A4: "D",
        B1: "A", B2: "D", B3: "B", B4: "C",
        C1: "A", C2: "C", C3: "B", C4: "B",
        D1: "B", D2: "B", D3: "A", D4: "B",
      },
      autonomyPacer: {
        A1: "C", A2: "B", A3: "D", A4: "D",
        B1: "A", B2: "B", B3: "B", B4: "D",
        C1: "D", C2: "A", C3: "A", C4: "C",
        D1: "D", D2: "A", D3: "D", D4: "A",
      },
    };
    const signatures = new Set<string>();
    const bannedWords = ["궁합", "적합도", "갈등 위험", "이혼", "성공률", "희귀"];

    for (const [name, answers] of Object.entries(samples)) {
      const result = scoreWeddingCodeV05(answers);
      expect(result.answeredCount, name).toBe(16);
      expect(result.warnings, name).toEqual([]);
      for (const axis of result.publicAxes) {
        for (const word of bannedWords) {
          expect(axis.displayKo, `${name}-${axis.key}`).not.toContain(word);
        }
      }
      signatures.add(result.publicAxes.map((axis) => `${axis.key}:${axis.leaning}`).join("|"));
    }

    expect(signatures.size).toBeGreaterThanOrEqual(3);
    expect(scoreWeddingCodeV05(samples.costGuard).publicAxes[0].leaning).toBe("left");
    expect(scoreWeddingCodeV05(samples.meaningMood).publicAxes[0].leaning).toBe("right");
  });
});
