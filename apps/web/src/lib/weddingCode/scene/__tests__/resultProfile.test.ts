import { describe, expect, it } from "vitest";
import type { WeddingCodeV06OptionValue } from "@/constants/weddingCodeV06";
import type { WeddingCodeV06Answers } from "@/lib/weddingCode/v06/gap";
import {
  WEDDING_CODE_V06_SCENE_CONFIG,
  WEDDING_CODE_V08_SCENE_CONFIG,
  WEDDING_CODE_V09_SCENE_CONFIG,
  WEDDING_CODE_V10_SCENE_CONFIG,
  WEDDING_CODE_V11_SCENE_CONFIG as config,
  WEDDING_CODE_V12_SCENE_CONFIG as v12,
} from "../config";
import { buildWeddingCodeSelfProfile, describeSelfAxisAbsence } from "../selfProfile";
import { buildWeddingCodeLetters } from "@/lib/weddingCode/profile/letters";
import { buildWeddingCodeTalkFirst } from "@/lib/weddingCode/profile/talkFirst";
import { WEDDING_CODE_TALK_FIRST_ITEMS } from "@/constants/weddingCodeTalkFirst";
import { buildWeddingCodeResultProfile, describeWeddingCodeResultReading } from "../resultProfile";

const profile = (answers: WeddingCodeV06Answers) => buildWeddingCodeResultProfile(answers, config);

describe("v1.1 실제 선택에 연결하는 결과", () => {
  it("예전 공유판의 결과는 당시 규칙과 원문 그대로 돌려준다", () => {
    for (const old of [WEDDING_CODE_V06_SCENE_CONFIG, WEDDING_CODE_V08_SCENE_CONFIG, WEDDING_CODE_V09_SCENE_CONFIG, WEDDING_CODE_V10_SCENE_CONFIG]) {
      const answers: WeddingCodeV06Answers = { A1: "B", B1: "D", C1: "A", D3: "C" };
      expect(buildWeddingCodeResultProfile(answers, old)).toEqual(buildWeddingCodeSelfProfile(answers, old));
    }
  });

  it("같은 조건 먼저 응답이어도 예산과 서비스 확인을 구분해 묻는다", () => {
    const cost = profile({ A1: "A", A2: "A", A3: "D", A4: "D", A5: "A" }).axes[0];
    const service = profile({ A1: "B", A2: "C", A3: "C", A4: "B", A5: "B" }).axes[0];
    expect([cost.leftCount, cost.rightCount]).toEqual([5, 0]);
    expect([service.leftCount, service.rightCount]).toEqual([5, 0]);
    expect(cost.reflection).toContain("총액이나 예산");
    expect(service.reflection).toContain("서비스 내용");
    expect(cost.tellPartner).not.toBe(service.tellPartner);
    expect(service.watchOut).not.toContain("총액만");
  });

  it("조사는 맡겨도 마지막 선택은 함께하는 답을 같은 카드에서 설명한다", () => {
    const reading = profile({ B1: "D", B2: "A", B3: "C", B4: "D", B5: "B" }).axes[1];
    expect(reading.rightCount).toBe(4);
    expect(reading.reflection).toContain("마지막 선택은 함께");
    expect(reading.evidence.map((item) => item.label)).toEqual([
      config.questions[5].options[3].label,
      config.questions[7].options[2].label,
    ]);
  });

  it("같은 위임 방향에서도 내가 맡는 답과 상대에게 맡기는 답을 바꾸지 않는다", () => {
    const mine = profile({ B1: "C", B2: "C", B3: "B", B4: "D", B5: "B" }).axes[1];
    const theirs = profile({ B1: "D", B2: "A", B3: "A", B4: "B", B5: "D" }).axes[1];
    expect(mine.reflection).toContain("내가 맡아서");
    expect(theirs.reflection).toContain("상대에게 선택을 맡기는");
    expect(mine.tellPartner).not.toBe(theirs.tellPartner);
  });

  it("나와 상대가 막힌 두 장면에서 꺼낸 주제의 차이를 해당 두 답으로 설명한다", () => {
    const reading = profile({ D1: "A", D2: "C", D3: "B", D4: "D", D5: "D" }).axes[3];
    expect(reading.rightCount).toBe(4);
    expect(reading.reflection).toContain("명단이 버거울 때는 내 마음을 말하고");
    expect(reading.evidence).toEqual([
      { scene: config.questions[15].scene, label: config.questions[15].options[0].label },
      { scene: config.questions[17].scene, label: config.questions[17].options[1].label },
    ]);
    expect(profile({ D1: "A" }).axes[3].reflection).toBeUndefined();
    expect(profile({ D3: "B" }).axes[3].reflection).toBeUndefined();
  });

  it("안 고른 답이나 한 번뿐인 답에서 반복·장면 간 이야기를 만들지 않는다", () => {
    expect(profile({}).axes.every((axis) => axis.allEvidence?.length === 0 && !axis.reflection)).toBe(true);
    for (const question of config.questions) {
      for (const answer of question.options) {
        const result = profile({ [question.key]: answer.value });
        expect(result.answered).toBe(1);
        expect(result.axes.every((axis) => !axis.reflection)).toBe(true);
        expect(result.axes.flatMap((axis) => axis.allEvidence ?? [])).toEqual([{ scene: question.scene, label: answer.label }]);
      }
    }
  });

  it("각 축의 모든 선택·건너뛰기 조합에서 원문 근거와 양쪽 선택을 보존한다", () => {
    const values: readonly (WeddingCodeV06OptionValue | undefined)[] = [undefined, "A", "B", "C", "D"];
    for (const axis of config.axes) {
      const questions = config.questions.filter((question) => question.axis === axis.key);
      for (let vector = 0; vector < values.length ** questions.length; vector += 1) {
        let remaining = vector;
        const answers: WeddingCodeV06Answers = {};
        for (const question of questions) {
          const value = values[remaining % values.length];
          if (value) answers[question.key] = value;
          remaining = Math.floor(remaining / values.length);
        }
        const result = profile(answers).axes.find((item) => item.axis === axis.key)!;
        const chosen = questions.flatMap((question) => {
          const answer = question.options.find((option) => option.value === answers[question.key]);
          return answer ? [{ scene: question.scene, label: answer.label, construct: answer.weights[0].construct }] : [];
        });
        expect(result.allEvidence).toEqual(chosen.map(({ scene, label }) => ({ scene, label })));
        expect(result.answered).toBe(chosen.length);
        for (const quote of result.evidence) {
          expect(chosen.some((item) => item.scene === quote.scene && item.label === quote.label)).toBe(true);
        }
        if (result.leftCount && result.rightCount) {
          const sides = new Set(result.evidence.map((quote) => {
            const selected = chosen.find((item) => item.scene === quote.scene && item.label === quote.label)!;
            return (axis.left.constructs as readonly string[]).includes(selected.construct) ? "left" : "right";
          }));
          expect(sides).toEqual(new Set(["left", "right"]));
        }
        expect(result.qualifiers).toEqual([]);
        expect(describeWeddingCodeResultReading(result)).not.toContain("겪은 일");
      }
    }
  }, 30000);
});

describe("v1.2 가변 보기의 실제 의미를 따라가는 결과", () => {
  const current = (answers: WeddingCodeV06Answers) => buildWeddingCodeResultProfile(answers, v12);

  it("후속 대화도 최종 결정 참여자를 확인하고, 부모님 압박이나 주말까지의 여유를 만들지 않는다", () => {
    const talk = (answers: WeddingCodeV06Answers) => {
      const result = current(answers);
      return buildWeddingCodeTalkFirst(buildWeddingCodeLetters(result), result)!;
    };
    const family = talk({ C1: "B", C2: "B", C3: "C" }).items[0];
    expect(family.slot.questionVersion).toBe("v1.2-code");
    expect(family.lead).toBe("부모님과 정할 일은 누가 무엇을 고를지 맞춰 두세요.");
    expect(family.detail).toContain("함께 고를지, 부모님께 선택을 맡길지");
    const split = talk({ C1: "A", C2: "B", C3: "C" }).items[0];
    expect(split.detail).toContain("마지막 선택에 누가 참여하면 좋을지");
    expect(split.detail).not.toContain("부모님 뜻을 얼마나 따를지");
    const action = talk({ D1: "B", D3: "A", D5: "B" }).items[0];
    expect(action.detail).toContain("마감이 정해진 일이 있다면 먼저 확인");
    expect(action.detail).not.toContain("주말로 넘겨");

    // 실제 예전 판은 문항 판 메타데이터 없이 기존 안내로 읽힌다.
    const oldAnswers: WeddingCodeV06Answers = {};
    for (const question of config.questions.filter(item => item.axis === "coordinationScope")) {
      const option = question.options.find(item => item.weights[0].construct === "familyIntegration")!;
      oldAnswers[question.key] = option.value;
    }
    const old = profile(oldAnswers);
    const oldTalk = buildWeddingCodeTalkFirst(buildWeddingCodeLetters(old), old)!.items[0];
    expect(oldTalk.slot.questionVersion).toBeUndefined();
    expect(oldTalk.lead).toBe(WEDDING_CODE_TALK_FIRST_ITEMS.coordinationScope.right.lead);
    expect(oldTalk.detail).toBe(WEDDING_CODE_TALK_FIRST_ITEMS.coordinationScope.right.detail);
  });

  it("서비스 정보를 묻는 답을 진위 의심으로 바꾸지 않는다", () => {
    const result = current({ A1: "B", A2: "C", A3: "C", A4: "B", A5: "B" });
    const reading = result.axes[0];
    expect(result.repeated).toContainEqual({ construct: "evidenceDecision", phrase: "무엇을 어떻게 해주는지", count: 5 });
    expect(buildWeddingCodeLetters(result).slots[0].meaning).toBe("비용이나 서비스 내용을 먼저 확인하는 답을 더 많이 골랐어요");
    expect(reading.reflection).toContain("서비스 내용");
    expect(JSON.stringify(result)).not.toContain("적힌 내용이 사실인지");
    const partial = current({ A1: "C", A2: "D", A3: "A", A4: "D", A5: "D" }).axes[0];
    expect(describeSelfAxisAbsence(partial)).toBe("“조건 먼저” 쪽 답을 고르긴 했지만, 그중 ‘무엇을 어떻게 해주는지’부터 보는 답은 없었어요.");
  });

  it("이미 부모님 조건을 확인하고 둘이 정한 답을 가족 배려 부재로 설명하지 않는다", () => {
    const result = current({ C1: "A", C2: "A", C3: "A", C4: "A", C5: "A" });
    const reading = result.axes[2];
    expect(reading.title).toBe("이번엔 ‘둘이 정하기’ 쪽 답이 더 많았어요");
    expect(describeSelfAxisAbsence(reading)).toBe("“부모님도 참여” 쪽 답은 한 번도 고르지 않았어요.");
    expect(reading.missingPhrases).toEqual(["부모님도 참여"]);
    expect(result.repeated).toContainEqual({ construct: "coupleAutonomy", phrase: "둘이 정하기", count: 5 });
    expect(describeWeddingCodeResultReading(reading)).toBe("답한 5장면 모두 U(둘이 정하기) 쪽이었어요.");
    expect(JSON.stringify(result)).not.toMatch(/가족·하객까지|우리 둘 먼저/);
  });

  it.each([
    { name: "함께하는 실속형", groups: ["AADDA", "AAAAA", "AAAAA", "BAABB"], code: "VTUA", counts: [[5, 0], [5, 0], [5, 0], [0, 5]] },
    { name: "위임과 경험을 중시하는 상황", groups: ["CDACD", "CDCCC", "BBCBB", "ABBAA"], code: "MOFH", counts: [[0, 5], [0, 5], [0, 5], [5, 0]] },
    { name: "일과 가족 상황별로 나누는 경우", groups: ["BBDAD", "BBABA", "BACAA", "AAABA"], code: "moua", counts: [[2, 3], [2, 3], [3, 2], [2, 3]] },
  ])("가상 응답 $name의 원문·집계·코드를 보존한다", ({ groups, code, counts }) => {
    const vector = groups.join("");
    const answers: WeddingCodeV06Answers = {};
    v12.questions.forEach((question, index) => {
      const option = question.options.find(item => item.value === vector[index]);
      expect(option).toBeDefined();
      if (option) answers[question.key] = option.value;
    });
    const result = current(answers);
    expect(result.answered).toBe(20);
    expect(buildWeddingCodeLetters(result).code).toBe(code);
    expect(result.axes.map(item => [item.leftCount, item.rightCount])).toEqual(counts);
    expect(result.axes.flatMap(item => item.allEvidence ?? [])).toEqual(v12.questions.map(question => ({
      scene: question.scene, label: question.options.find(item => item.value === answers[question.key])!.label,
    })));
    expect(JSON.stringify(result)).not.toMatch(/가족·하객까지|우리 둘 먼저|적힌 내용이 사실인지/);
  });

  it("같은 응답 코드를 새 판과 옛 판에서 서로의 역할로 읽지 않는다", () => {
    const answers: WeddingCodeV06Answers = { B1: "C", B3: "B", B4: "D", B5: "B" };
    expect(profile(answers).axes[1].reflection).toContain("내가 맡아서");
    const mine = current({ B1: "B", B2: "C", B3: "B", B4: "B", B5: "B" }).axes[1];
    const theirs = current({ B1: "C", B2: "D", B3: "C", B4: "C", B5: "C" }).axes[1];
    expect(mine.reflection).toContain("내가 맡아서");
    expect(theirs.reflection).toContain("상대에게 맡기는");
    expect(theirs.evidence[0].label).toBe(v12.questions[5].options[2].label);
    expect(theirs.evidence[1].label).toBe(v12.questions[6].options[3].label);
  });

  it("분담 상담을 한 사람이 모든 상담을 맡은 것으로 바꾸지 않는다", () => {
    const reading = current({ B2: "B", B3: "A" }).axes[1];
    expect(reading.reflection).toContain("상담은 맡을 사람을 정하고");
    expect(reading.reflection).not.toContain("한 사람이 맡고");
    expect(reading.evidence).toEqual([v12.questions[6], v12.questions[7]].map((question, i) => ({
      scene: question.scene, label: question.options[i === 0 ? 1 : 0].label,
    })));
  });

  it("가족과 정할 범위를 실제 두 선택으로 연결하며 의견을 무시했다고 말하지 않는다", () => {
    const reading = current({ C1: "B", C5: "A" }).axes[2];
    expect(reading.axisLabel).toBe("누구와 함께 정하나");
    expect(reading.reflection).toBe("식장은 부모님과 함께 정하고, 지원금의 사용처는 둘이 정하는 답을 골랐어요.");
    const delegated = current({ C3: "C" }).axes[2];
    expect(delegated.reflection).toBeUndefined();
    expect(delegated.letterMeaning).toBe("부모님과 함께 정하거나 선택을 맡기는 답을 더 많이 골랐어요");
    expect(current({ C5: "A" }).axes[2].letterMeaning).toBe("마지막 선택을 둘이 하는 답을 더 많이 골랐어요");
    expect(profile({ C3: "A" }).axes[2].letterMeaning).toBeUndefined();
    expect(delegated.evidence[0].label).toBe(v12.questions[12].options[2].label);
    expect(delegated.watchOut).toContain("부모님께 선택을 맡길 일");
  });

  it("원하는 도움을 실제로 했던 말이나 상대에게 주는 도움으로 바꾸지 않는다", () => {
    const reading = current({ D1: "A", D3: "A" }).axes[3];
    expect(reading.reflection).toContain("얘기를 들어주길 바라고");
    expect(reading.reflection).toContain("함께 읽자고 하는 답");
    expect(current({ D1: "B", D3: "B" }).axes[3].reflection).toContain("명단은 함께 추려주길 바라고");
    expect(current({ D1: "A" }).axes[3].reflection).toBeUndefined();
    expect(current({ D3: "A" }).axes[3].reflection).toBeUndefined();
  });

  it("가변 보기의 모든 축별 선택·건너뜀 조합에서 선택 수와 근거를 그대로 보존한다", () => {
    for (const axis of v12.axes) {
      const questions = v12.questions.filter(q => q.axis === axis.key);
      const visit = (index: number, answers: WeddingCodeV06Answers) => {
        if (index < questions.length) {
          const question = questions[index];
          visit(index + 1, answers);
          for (const option of question.options) visit(index + 1, { ...answers, [question.key]: option.value });
          return;
        }
        const reading = current(answers).axes.find(item => item.axis === axis.key)!;
        const selected = questions.flatMap(question => {
          const option = question.options.find(item => item.value === answers[question.key]);
          return option ? [{ scene: question.scene, label: option.label, construct: option.weights[0].construct }] : [];
        });
        expect(reading.allEvidence).toEqual(selected.map(({ scene, label }) => ({ scene, label })));
        expect(reading.answered).toBe(selected.length);
        expect(reading.leftCount + reading.rightCount).toBe(selected.length);
        if (selected.length < 2) expect(reading.reflection).toBeUndefined();
        for (const quote of reading.evidence) {
          expect(selected.some(item => item.scene === quote.scene && item.label === quote.label)).toBe(true);
        }
        if (reading.leftCount && reading.rightCount) {
          expect(new Set(reading.evidence.map(quote => {
            const match = selected.find(item => item.scene === quote.scene && item.label === quote.label)!;
            return (axis.left.constructs as readonly string[]).includes(match.construct) ? "left" : "right";
          }))).toEqual(new Set(["left", "right"]));
        }
        expect(reading.qualifiers).toEqual([]);
      };
      visit(0, {});
    }
  }, 30000);
});
