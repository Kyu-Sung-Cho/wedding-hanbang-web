import { describe, expect, it } from "vitest";

import { WEDDING_CODE_V06_AXES } from "@/constants/weddingCodeV06";
import { WEDDING_CODE_V08_QUESTIONS } from "@/constants/weddingCodeV08";
import {
  AMORA_PERSONALIZATION_FIELD_NAMES,
  DEFAULT_AMORA_PERSONALIZATION,
  isAmoraPersonalizationChanges,
  mergeAmoraPersonalization,
  parseAmoraPersonalizationPreferences,
} from "@/lib/amora/personalization";
import type { WeddingCodeV06Answers } from "@/lib/weddingCode/v06/gap";
import { buildWeddingCodeSelfProfile } from "@/lib/weddingCode/scene/selfProfile";
import {
  buildWeddingCodeAmoraProposals,
  buildWeddingCodeCoupleCombination,
  weddingCodeProposalChanges,
} from "../amoraBridge";

const CONFIG = {
  questions: WEDDING_CODE_V08_QUESTIONS,
  axes: WEDDING_CODE_V06_AXES,
} as const;

/** 네 축 모두 왼쪽으로만 고른 응답. 선택지 위치는 문항마다 다르므로 letter가 섞인다. */
const LEFT_LEANING: WeddingCodeV06Answers = {
  A1: "A", A2: "A", A3: "C", A4: "B", A5: "A",
  B1: "A", B2: "B", B3: "C", B4: "A", B5: "A",
  C1: "A", C2: "A", C3: "C", C4: "B", C5: "A",
  D1: "A", D2: "B", D3: "C", D4: "A", D5: "A",
};

/** 위와 정확히 반대 편으로만 고른 응답. */
const RIGHT_LEANING: WeddingCodeV06Answers = {
  A1: "C", A2: "B", A3: "A", A4: "A", A5: "C",
  B1: "C", B2: "A", B3: "A", B4: "B", B5: "B",
  C1: "C", C2: "B", C3: "A", C4: "A", C5: "B",
  D1: "C", D2: "B", D3: "A", D4: "B", D5: "B",
};

/**
 * 축당 문항이 홀수(5개)라 다 답하면 정확히 반반이 될 수 없다. 반반은 **한 문항을
 * 건너뛰어 짝수가 됐을 때만** 생긴다 — 축마다 좌 2 : 우 2가 되게 네 개만 답한 응답.
 */
const BALANCED: WeddingCodeV06Answers = {
  A1: "A", A2: "A", A3: "A", A4: "A",
  B1: "A", B2: "A", B3: "A", B4: "A",
  C1: "A", C2: "A", C3: "A", C4: "A",
  D1: "A", D2: "A", D3: "A", D4: "A",
};

const profileOf = (answers: WeddingCodeV06Answers) =>
  buildWeddingCodeSelfProfile(answers, CONFIG);

const proposalFor = (answers: WeddingCodeV06Answers, field: string) =>
  buildWeddingCodeAmoraProposals(profileOf(answers)).find(
    (proposal) => proposal.field === field,
  );

describe("웨딩코드 → 아모라 도움 방식 제안", () => {
  it("답하지 않으면 아무것도 제안하지 않는다", () => {
    // 빈 응답에서 나온 기본값을 사용자의 선택처럼 넘기면 안 된다.
    expect(buildWeddingCodeAmoraProposals(profileOf({}))).toEqual([]);
  });

  it("제안값은 아모라 설정이 실제로 받는 값이다", () => {
    for (const answers of [LEFT_LEANING, RIGHT_LEANING, BALANCED]) {
      const changes = weddingCodeProposalChanges(
        buildWeddingCodeAmoraProposals(profileOf(answers)),
      );
      expect(isAmoraPersonalizationChanges(changes)).toBe(true);
      // 병합 결과도 저장 API가 요구하는 완전한 설정이어야 한다.
      const merged = mergeAmoraPersonalization(DEFAULT_AMORA_PERSONALIZATION, changes);
      expect(parseAmoraPersonalizationPreferences(merged)).not.toBeNull();
      for (const field of Object.keys(changes)) {
        expect(AMORA_PERSONALIZATION_FIELD_NAMES as readonly string[]).toContain(field);
      }
    }
  });

  it("같은 질문을 묻는 축 셋은 응답 방향 그대로 옮긴다", () => {
    expect(proposalFor(LEFT_LEANING, "workMode")).toMatchObject({
      value: "together",
      confidence: "direct",
    });
    expect(proposalFor(RIGHT_LEANING, "workMode")).toMatchObject({ value: "owner_led" });

    expect(proposalFor(LEFT_LEANING, "familyOrder")).toMatchObject({
      value: "couple_first",
      confidence: "direct",
    });
    expect(proposalFor(RIGHT_LEANING, "familyOrder")).toMatchObject({
      value: "family_input_first",
    });

    expect(proposalFor(LEFT_LEANING, "supportOrder")).toMatchObject({
      value: "listen_first",
      confidence: "direct",
    });
    expect(proposalFor(RIGHT_LEANING, "supportOrder")).toMatchObject({
      value: "action_first",
    });
  });

  it("균형은 빈칸이 아니라 「그때그때 다름」을 받는 값으로 간다", () => {
    expect(proposalFor(BALANCED, "workMode")?.value).toBe("hybrid");
    expect(proposalFor(BALANCED, "familyOrder")?.value).toBe("case_by_case");
    expect(proposalFor(BALANCED, "supportOrder")?.value).toBe("ask_each_time");
  });

  it("추론에 가까운 항목은 표시하고, 근거가 없으면 아예 제안하지 않는다", () => {
    const inferred = proposalFor(LEFT_LEANING, "decisionStart");
    expect(inferred).toMatchObject({ value: "compare_first", confidence: "indirect" });
    expect(inferred?.caution).toBeTruthy();

    // 분위기·의미를 먼저 본다고 「추천안 하나를 원한다」가 되지는 않는다.
    expect(proposalFor(RIGHT_LEANING, "decisionStart")).toBeUndefined();
    expect(proposalFor(BALANCED, "decisionStart")).toBeUndefined();
  });

  it("모든 제안에 응답에서 나온 근거가 함께 간다", () => {
    for (const proposal of buildWeddingCodeAmoraProposals(profileOf(LEFT_LEANING))) {
      expect(proposal.basis).toMatch(/장면 중 \d곳/);
      expect(proposal.effect.length).toBeGreaterThan(0);
      expect(proposal.choiceLabel.length).toBeGreaterThan(0);
      // 내부 값 이름을 사용자 문구에 노출하지 않는다.
      expect(`${proposal.choiceLabel} ${proposal.effect}`).not.toContain(proposal.value);
    }
  });

  it("같은 응답이면 같은 제안을 같은 순서로 만든다", () => {
    expect(buildWeddingCodeAmoraProposals(profileOf(LEFT_LEANING))).toEqual(
      buildWeddingCodeAmoraProposals(profileOf(LEFT_LEANING)),
    );
  });

  it("성향 판정으로 읽히는 말을 만들지 않는다", () => {
    const text = buildWeddingCodeAmoraProposals(profileOf(LEFT_LEANING))
      .map((proposal) => `${proposal.choiceLabel} ${proposal.effect} ${proposal.caution ?? ""}`)
      .join(" ");
    for (const banned of ["유형", "궁합", "성격", "점수", "등급", "예측"]) {
      expect(text, banned).not.toContain(banned);
    }
  });
});

describe("두 사람의 조합", () => {
  it("갈린 축에서는 한쪽 값으로 맞추지 않고 순서를 정하게 한다", () => {
    const combination = buildWeddingCodeCoupleCombination(
      profileOf(LEFT_LEANING),
      profileOf(RIGHT_LEANING),
    );
    expect(combination).toHaveLength(WEDDING_CODE_V06_AXES.length);
    expect(combination.every((item) => item.state === "split")).toBe(true);
    for (const item of combination) {
      expect(item.directive.length).toBeGreaterThan(0);
      // 갈린 자리에서 어느 쪽이 맞다고 말하면 아모라가 한쪽 편이 된다.
      expect(item.directive).not.toMatch(/맞는 쪽|올바른 쪽|더 나은/);
    }
    expect(combination[0].firstTitle).not.toBe(combination[0].secondTitle);
  });

  it("방향이 같으면 같은 축으로 묶어 말한다", () => {
    const combination = buildWeddingCodeCoupleCombination(
      profileOf(LEFT_LEANING),
      profileOf(LEFT_LEANING),
    );
    expect(combination.every((item) => item.state === "aligned")).toBe(true);
    for (const item of combination) {
      expect(item.firstTitle).toBe(item.secondTitle);
    }
  });

  it("한쪽이 답하지 않은 축은 조합으로 만들지 않는다", () => {
    expect(
      buildWeddingCodeCoupleCombination(profileOf(LEFT_LEANING), profileOf({})),
    ).toEqual([]);
  });

  it("조합은 설정으로 저장할 수 있는 형태가 아니다", () => {
    // 조합에는 아모라 설정 필드가 없어야 한다 — 계정별 설정에 커플 합의를 섞지 않는다.
    const combination = buildWeddingCodeCoupleCombination(
      profileOf(LEFT_LEANING),
      profileOf(RIGHT_LEANING),
    );
    for (const item of combination) {
      for (const field of AMORA_PERSONALIZATION_FIELD_NAMES) {
        expect(Object.keys(item)).not.toContain(field);
      }
    }
  });
});
