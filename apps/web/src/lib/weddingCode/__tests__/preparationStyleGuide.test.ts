import { describe, expect, it } from "vitest";
import {
  CURRENT_WEDDING_CODE_SCENE_CONFIG as current,
  WEDDING_CODE_V06_SCENE_CONFIG,
  WEDDING_CODE_V08_SCENE_CONFIG,
  WEDDING_CODE_V09_SCENE_CONFIG,
  WEDDING_CODE_V10_SCENE_CONFIG,
  WEDDING_CODE_V11_SCENE_CONFIG,
  type WeddingCodeSceneConfig,
} from "../scene/config";
import { buildWeddingCodeResultProfile } from "../scene/resultProfile";
import type { WeddingCodeV06Answers } from "../v06/gap";
import { buildPreparationStyleGuide, type PreparationStyleResponse } from "../preparationStyleGuide";

const configs = [
  WEDDING_CODE_V06_SCENE_CONFIG, WEDDING_CODE_V08_SCENE_CONFIG,
  WEDDING_CODE_V09_SCENE_CONFIG, WEDDING_CODE_V10_SCENE_CONFIG,
  WEDDING_CODE_V11_SCENE_CONFIG, current,
];

function response(answers: WeddingCodeV06Answers, config = current): PreparationStyleResponse {
  return { version: config.version, answers };
}

function allFirst(config: WeddingCodeSceneConfig): PreparationStyleResponse {
  return response(Object.fromEntries(config.questions.map(question => [question.key, question.options[0].value])), config);
}

describe("라운지 준비 스타일의 실제 선택 안내", () => {
  it("개인 요약의 셈·원문·안내를 현재 결과에서 가져오고 네 주제로 묶는다", () => {
    const mine = response({ A1: "C", A2: "D", B1: "B", B2: "C", C1: "A", C5: "B", D1: "A", D3: "A" });
    const guide = buildPreparationStyleGuide(mine);
    expect(guide.status).toBe("solo");
    if (guide.status !== "solo") throw new Error("expected personal guide");
    expect(guide.personal).toMatchObject({ answered: 8, total: 20, skipped: 12, complete: false });
    expect(guide.personal.groups.map(group => group.id)).toEqual(["budget", "roles", "family", "support"]);
    const profile = buildWeddingCodeResultProfile(mine.answers, current);
    for (const group of guide.personal.groups) {
      expect(group.reading).toEqual(profile.axes.find(axis => axis.axis === group.axis));
      expect(group.answered).toBe(2);
      expect(group.total).toBe(5);
      expect(group.skipped).toBe(3);
      expect(group.countLine).toContain("답한 2장면");
      for (const scene of group.scenes) {
        const question = current.questions.find(item => item.key === scene.key)!;
        expect(scene.scene).toBe(question.scene);
        expect(scene.question).toBe(question.question);
        if (!mine.answers[scene.key]) {
          expect(scene.answer).toBeNull();
          expect(scene.nextStep).toBeNull();
        } else {
          const option = question.options.find(item => item.value === mine.answers[scene.key])!;
          expect(scene.answer).toEqual({ value: option.value, label: option.label });
          expect(scene.nextStep).toBe(current.nextSteps[scene.key]);
        }
      }
    }
    expect(guide.personal.groups[2].reading.leftLabel).toBe("둘이 정하기");
    expect(guide.personal.groups[3].reading.reflection).toContain("얘기를 들어주길 바라고");
    expect(guide).not.toHaveProperty("partner");
    expect(guide).not.toHaveProperty("compared");
  });

  it("같은 집계 방향의 다른 보기까지 실제 기호로 구분하고 한쪽 건너뜀은 제외한다", () => {
    const guide = buildPreparationStyleGuide(
      response({ A1: "A", A2: "C", B1: "B", C3: "B", D1: "A" }),
      response({ A1: "B", A2: "C", B1: "C", C3: "C", D2: "A" }),
    );
    expect(guide.status).toBe("couple");
    if (guide.status !== "couple") throw new Error("expected comparison");
    expect(guide).toMatchObject({ compared: 4, same: 1, different: 3, skipped: 16 });
    expect(guide.skippedMessage).toContain("16장면은 비교하지 않았어요");
    expect(guide.summary).toBe("함께 답한 4장면 중 1곳은 같은 답, 3곳은 다른 답을 골랐어요.");
    const scenes = guide.groups.flatMap(group => group.scenes);
    for (const key of ["A1", "B1", "C3"]) {
      const scene = scenes.find(item => item.key === key)!;
      expect(scene.status).toBe("different");
      expect(scene.nextStep).toBe(current.nextSteps[scene.key]);
    }
    expect(scenes.find(scene => scene.key === "A2")).toMatchObject({
      status: "same", explanation: "같은 답을 골랐어요. 고른 이유도 같은지는 서로 물어보세요.",
    });
    expect(scenes.find(scene => scene.key === "D1")).toMatchObject({
      status: "not_compared", partner: null, nextStep: null, explanation: "상대가 답하지 않아 비교하지 않았어요.",
    });
    expect(scenes.find(scene => scene.key === "D2")).toMatchObject({
      status: "not_compared", mine: null, nextStep: null, explanation: "내가 답하지 않아 비교하지 않았어요.",
    });
    expect(guide.groups.find(group => group.id === "support")).toMatchObject({ compared: 0, same: 0, different: 0, skipped: 5 });
    expect(guide.groups.reduce((sum, group) => sum + group.compared, 0)).toBe(guide.compared);
  });

  it("두 사람이 모두 건너뛰어도 같은 선택이나 행동 안내를 만들지 않는다", () => {
    const guide = buildPreparationStyleGuide(response({}), response({}));
    expect(guide.status).toBe("couple");
    if (guide.status !== "couple") throw new Error("expected empty comparison");
    expect(guide).toMatchObject({ compared: 0, same: 0, different: 0, skipped: 20 });
    expect(guide.summary).toBe("둘이 함께 답한 장면이 없어 아직 비교하지 않았어요.");
    expect(guide.personal.summary).toBe("아직 답한 장면이 없어요.");
    for (const group of guide.groups) {
      expect(group.compared).toBe(0);
      expect(group.scenes).toHaveLength(5);
      expect(group.scenes.every(scene => scene.status === "not_compared" && scene.nextStep === null)).toBe(true);
    }
    for (const group of guide.personal.groups) {
      expect(group.summary).toBe("이 주제는 아직 답한 장면이 없어요.");
      expect(group.reading.evidence).toEqual([]);
    }
  });

  it("다른 문항 판의 답은 기호가 같아도 비교하지 않고 각자 원문만 보존한다", () => {
    const mine = response({ A2: "A" }, WEDDING_CODE_V11_SCENE_CONFIG);
    const partner = response({ A2: "A" });
    const guide = buildPreparationStyleGuide(mine, partner);
    expect(guide.status).toBe("version_mismatch");
    if (guide.status !== "version_mismatch") throw new Error("expected blocked comparison");
    expect(guide).not.toHaveProperty("compared");
    expect(guide).not.toHaveProperty("groups");
    expect(guide.personal.version).toBe(WEDDING_CODE_V11_SCENE_CONFIG.version);
    expect(guide.partner.version).toBe(current.version);
    expect(guide.personal.groups[0].scenes[1].answer?.label).toBe(WEDDING_CODE_V11_SCENE_CONFIG.questions[1].options[0].label);
    expect(guide.partner.groups[0].scenes[1].answer?.label).toBe(current.questions[1].options[0].label);
    expect(guide.personal.groups[0].scenes[1].answer?.label).not.toBe(guide.partner.groups[0].scenes[1].answer?.label);
  });

  it("등록된 모든 판은 해당 문항·다음 대화를 쓰고 서로 다른 판의 모든 조합은 비교하지 않는다", () => {
    for (const first of configs) {
      for (const second of configs) {
        const guide = buildPreparationStyleGuide(allFirst(first), allFirst(second));
        if (first.version !== second.version) {
          expect(guide.status).toBe("version_mismatch");
          continue;
        }
        expect(guide.status).toBe("couple");
        if (guide.status !== "couple") throw new Error("expected same-version comparison");
        expect(guide).toMatchObject({ compared: first.questions.length, same: first.questions.length, different: 0, skipped: 0 });
        expect(guide.personal.complete).toBe(true);
        expect(guide.skippedMessage).toBeNull();
        for (const scene of guide.groups.flatMap(group => group.scenes)) {
          const question = first.questions.find(item => item.key === scene.key)!;
          expect(scene.mine?.label).toBe(question.options[0].label);
          expect(scene.partner?.label).toBe(question.options[0].label);
          expect(scene.nextStep).toBe(first.nextSteps[scene.key]);
          expect(scene.explanation).toContain("고른 이유도 같은지는 서로 물어보세요");
        }
      }
    }
  });

  it.each(["", " ", " v1.2-code", "v1.2-code ", "v999-code", "constructor", "__proto__"])(
    "없는 판 %j를 현재 판이나 구판으로 대체하지 않는다", version => {
      expect(buildPreparationStyleGuide({ version, answers: { A1: "A" } })).toMatchObject({
        status: "invalid", participant: "mine", reason: "unsupported_version",
      });
      expect(buildPreparationStyleGuide(response({ A1: "A" }), { version, answers: { A1: "A" } })).toMatchObject({
        status: "invalid", participant: "partner", reason: "unsupported_version",
      });
    },
  );

  it("실제 판에 없는 보기와 문항은 일부 응답으로 조용히 누락시키지 않는다", () => {
    const malformed = [
      response({ C1: "C" }), response({ B1: "D" }),
      response(Object.fromEntries([["A1", "a"]])),
      response(Object.fromEntries([["A1", "-"]])),
      response(Object.fromEntries([["A1", null]])),
      response(Object.fromEntries([["A1", "A"], ["A6", "B"]])),
      response({ A5: "A" }, WEDDING_CODE_V06_SCENE_CONFIG),
    ];
    for (const invalid of malformed) {
      expect(buildPreparationStyleGuide(invalid)).toMatchObject({ status: "invalid", reason: "invalid_answers", participant: "mine" });
      expect(buildPreparationStyleGuide(response({ A1: "A" }), invalid)).toMatchObject({ status: "invalid", reason: "invalid_answers", participant: "partner" });
    }
  });

  it("배열·null·상속된 답을 답변 객체로 받아들이지 않는다", () => {
    for (const answers of [null, [], new Date(0), Object.create({ A1: "A" })]) {
      const malformed = { version: current.version, answers } as PreparationStyleResponse;
      expect(buildPreparationStyleGuide(malformed)).toMatchObject({ status: "invalid", reason: "invalid_answers" });
    }
  });

  it("부분 응답의 undefined는 건너뜀으로 읽고 입력을 변경하지 않는다", () => {
    const answers = Object.freeze({ A1: "A" as const, B1: undefined });
    const mine = Object.freeze(response(answers));
    const partner = Object.freeze(response(Object.freeze({ A1: "B" as const })));
    const first = buildPreparationStyleGuide(mine, partner);
    expect(first).toEqual(buildPreparationStyleGuide(mine, partner));
    expect(first).toMatchObject({ status: "couple", compared: 1, same: 0, different: 1, skipped: 19 });
    expect(mine.answers).toEqual({ A1: "A", B1: undefined });
    expect(partner.answers).toEqual({ A1: "B" });
  });
});
