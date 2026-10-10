import { describe, expect, it } from "vitest";
import {
  INTRO,
  ITEMS21,
  SCALE_HELP,
  SCALE_OPTIONS,
  SPECIAL_OPTIONS,
  TOPICS,
  VERSIONS,
  createEmptyAnswers,
  isResponse,
  parseAnswers,
} from "./bank";
import { AGREEMENT_COPY, buildReport, buildSafeSummary } from "./report";
import type { Answers, ItemId, Response } from "./types";

const expectedStatements = [
  "식에 우리 둘이 처음 만난 이야기를 하객에게 들려주는 시간을 넣고 싶다.",
  "식의 다른 부분이 간단해져도, 내가 가장 원하는 한두 부분에 예산을 더 쓰고 싶다.",
  "꼭 넣고 싶은 항목이 생기면, 전체 예산은 늘리지 않고 다른 항목에 쓰기로 한 돈을 줄이고 싶다.",
  "하객에게 인사를 마친 뒤 여유가 생기면, 하객과 더 이야기하기보다 우리 둘만의 시간으로 쓰고 싶다.",
  "예식장을 찾기 시작할 때부터, 상대와 후보를 함께 보며 이야기하고 싶다.",
  "예식장을 찾을 때, 내 마음에 드는 후보를 먼저 몇 곳 찾아본 뒤 상대와 이야기하고 싶다.",
  "둘이 원하는 조건을 정했다면, 예식장 첫 후보는 상대가 추려 와도 편하다.",
  "우리 둘 모두 마음에 드는 청첩장 후보 두 개가 남았다면, 마지막 선택은 상대에게 맡겨도 편하다.",
  "예산과 날짜에 맞는 예식장 두 곳이 마음에 들면, 더 찾기보다 그 두 곳을 자세히 비교하고 싶다.",
  "각자 고른 예식장이 다르면, 그 두 곳 중 하나를 고르기보다 둘 다 새 후보를 찾아보고 싶다.",
  "의견이 잘 안 맞는 날에는, 그날 결론을 내기보다 각자 생각한 뒤 다음 날 다시 이야기하고 싶다.",
  "둘이 조건을 정하고 내가 업체 후보를 찾기로 했다면, 중간부터 함께 보기보다 후보를 추린 뒤 상대와 이야기하고 싶다.",
  "예식 분위기를 생각하기 시작할 때, 가족이 바라는 분위기도 들어보고 싶다.",
  "우리 둘이 원하는 예식 모습을 대략 정했다면, 확정하기 전에 가족 의견도 듣고 싶다.",
  "우리 둘 모두 괜찮다고 느끼는 식순 두 가지가 있다면, 가족이 더 좋아하는 쪽을 고르고 싶다.",
  "가족과 우리 둘이 원하는 식순이 다를 때, 가족 의견을 들은 뒤 마지막 선택은 우리 둘이 하고 싶다.",
  "예식장 답변 때문에 속상한 날, 상대가 해결책을 찾기 전에 내 이야기를 먼저 들어주면 좋겠다.",
  "내가 맡은 업체 연락이 버거울 때, 물어볼 내용을 같이 정리해 주기보다 연락을 대신 맡아 주면 좋겠다.",
  "내가 맡은 준비가 밀린 날, 상대가 일부를 대신 끝내 주기보다 나와 같이 하나씩 하는 게 편하다.",
  "예식장을 둘러보고 지쳤을 때, 처음 쉬는 시간은 상대와 함께 보내고 싶다.",
  "예식장을 둘러보고 지쳤을 때, 처음 쉬는 시간은 혼자 보내고 싶다.",
];

function all(response: Response): Answers {
  const answers = createEmptyAnswers();
  for (const item of ITEMS21) answers[item.id] = response;
  return answers;
}

function only(values: Partial<Answers>): Answers {
  return { ...createEmptyAnswers(), ...values };
}

describe("21문항 원문과 응답 계약", () => {
  it("사용자가 지정한 21개 원문·번호·순서를 보존한다", () => {
    expect(ITEMS21).toHaveLength(21);
    expect(ITEMS21.map((item) => item.statement)).toEqual(expectedStatements);
    expect(ITEMS21.map((item) => item.id)).toEqual(
      Array.from({ length: 21 }, (_, index) => `Q${String(index + 1).padStart(2, "0")}`),
    );
    expect(ITEMS21.map((item) => item.number)).toEqual(
      Array.from({ length: 21 }, (_, index) => index + 1),
    );
    expect(TOPICS.map((topic) => topic.itemIds.length)).toEqual([4, 8, 4, 5]);
    expect(TOPICS.flatMap((topic) => topic.itemIds)).toEqual(ITEMS21.map((item) => item.id));
  });

  it("안내·상황·척도·별도 응답의 원문을 보존한다", () => {
    expect(INTRO).toEqual([
      "결혼 준비를 한다고 생각하고, 각 장면에서 내게 더 편할 것 같은 방식으로 답해 주세요. 경험이 없어도 괜찮아요.",
      "각 문장이 내가 원하는 방식에 얼마나 맞는지 골라 주세요.",
    ]);
    expect(TOPICS.map((topic) => [topic.title, topic.context])).toEqual([
      ["식의 모습과 예산을 생각할 때", "예산 문항은 아직 계약 전이고, 식의 기본 진행에 필요한 비용은 마련된 상황을 떠올려 주세요."],
      ["둘이 후보를 찾고 고를 때", "두 사람 모두 준비할 시간이 있고, 상대도 맡은 일을 해낼 수 있다고 생각해 주세요. 급하게 결정할 일은 없는 상황이에요."],
      ["가족과 준비 이야기를 나눌 때", "결혼 준비 이야기를 나눌 가족을 떠올려 주세요. 해당하는 가족이 없으면 ‘나에게 해당하지 않아요’를 골라도 괜찮아요."],
      ["준비하다 지쳤을 때", "바로 처리해야 할 일은 없고, 상대에게도 도와줄 여유가 있다고 생각해 주세요."],
    ]);
    expect(SCALE_OPTIONS).toEqual([
      { value: 1, label: "전혀 맞지 않아요" },
      { value: 2, label: "별로 맞지 않아요" },
      { value: 3, label: "반반이에요" },
      { value: 4, label: "대체로 맞아요" },
      { value: 5, label: "아주 잘 맞아요" },
    ]);
    expect(SPECIAL_OPTIONS).toEqual([
      { value: "unknown", label: "아직 모르겠어요" },
      { value: "not-applicable", label: "나에게 해당하지 않아요" },
      { value: "skipped", label: "지금 답하지 않을게요" },
    ]);
    expect(SCALE_HELP).toBe("‘반반’은 문장에 끌리는 정도가 중간일 때예요. 판단이 아직 서지 않으면 ‘아직 모르겠어요’를 골라 주세요.");
    expect(VERSIONS).toEqual({
      questionnaireVersion: "preferences21-20261010-r1",
      interpretationVersion: "preferences21-reading-alpha.1",
      displayVersion: "preferences21-report-alpha.1",
    });
  });

  it("엄격한 응답 파서는 오래된 배열·알 수 없는 키·응답값을 받지 않는다", () => {
    expect(parseAnswers(all(3))).toEqual(all(3));
    expect(parseAnswers({ ...all(3), Q22: 3 })).toBeNull();
    const missing: Partial<Answers> = all(3);
    delete missing.Q21;
    expect(parseAnswers(missing)).toBeNull();
    expect(parseAnswers(Array.from({ length: 30 }, () => 3))).toBeNull();
    expect(parseAnswers(null)).toBeNull();
    expect(parseAnswers(Object.assign(new Date(), all(3)))).toBeNull();
    expect(parseAnswers(Object.assign(Object.create({ inherited: 1 }), all(3)))).toBeNull();
    const accessor = all(3);
    Object.defineProperty(accessor, "Q01", { enumerable: true, get: () => { throw new Error("실행하면 안 되는 접근자"); } });
    expect(parseAnswers(accessor)).toBeNull();
    expect(parseAnswers(new Proxy(all(3), { getPrototypeOf: () => { throw new Error("실행하면 안 되는 프록시"); } }))).toBeNull();
    expect(parseAnswers({ ...all(3), [Symbol("extra")]: 1 })).toBeNull();
    for (const invalid of [0, 6, 1.5, NaN, Infinity, "3", "unanswered", undefined, true, {}]) {
      expect(isResponse(invalid)).toBe(false);
      expect(parseAnswers({ ...all(3), Q01: invalid })).toBeNull();
    }
    for (const valid of [1, 2, 3, 4, 5, "unknown", "not-applicable", "skipped", null]) {
      expect(isResponse(valid)).toBe(true);
    }
  });
});

describe("실제 답만으로 만드는 결정적인 응답 설명", () => {
  it.each([1, 3, 5] as const)("모두 %d여도 빈 완료 화면이나 강제 유형을 만들지 않는다", (response) => {
    const report = buildReport(all(response));
    expect(report).toEqual(buildReport(all(response)));
    expect(report.counts).toEqual({ total: 21, responded: 21, numeric: 21, unknown: 0, notApplicable: 0, skipped: 0, unanswered: 0 });
    expect(report.topics.flatMap((topic) => topic.insights)).toHaveLength(21);
    expect(report.evidence).toHaveLength(21);
    expect(report.evidence.every((row) => row.response === response)).toBe(true);
    expect(report.character.status).toBe("pending");
    expect(report.core.summary.length).toBeGreaterThan(0);
    expect(report).not.toHaveProperty("score");
    expect(report).not.toHaveProperty("typeCode");
  });

  it.each([
    ["unknown", "unknown"],
    ["not-applicable", "notApplicable"],
    ["skipped", "skipped"],
    [null, "unanswered"],
  ] as const)("모두 %s인 상태를 수치나 중간값으로 바꾸지 않는다", (response, counter) => {
    const report = buildReport(all(response));
    expect(report.counts.numeric).toBe(0);
    expect(report.counts[counter]).toBe(21);
    expect(report.counts.responded).toBe(response === null ? 0 : 21);
    expect(report.topics.flatMap((topic) => topic.insights)).toEqual([]);
    expect(report.evidence.map((row) => row.response)).toEqual(ITEMS21.map(() => response));
    expect(report.unknowns.some((unknown) => unknown.kind === response || (response === null && unknown.kind === "unanswered"))).toBe(true);
    expect(report.core.summary).toContain("수치");
    expect(report.partnerQuestions).toHaveLength(1);
    expect(report.actions).toHaveLength(1);
    expect(report.contextCaveats).toHaveLength(1);
    expect(report.partnerQuestions[0].itemId).toBeNull();
    expect(report.actions[0].itemId).toBeNull();
  });

  it("각 상태를 따로 세고 근거와 일곱 가지 결과 요소를 보존한다", () => {
    const answers = only({ Q01: 5, Q02: 1, Q03: 3, Q04: "unknown", Q05: "not-applicable", Q06: "skipped" });
    const report = buildReport(answers);
    expect(report.counts).toEqual({ total: 21, responded: 6, numeric: 3, unknown: 1, notApplicable: 1, skipped: 1, unanswered: 15 });
    const insights = report.topics.flatMap((topic) => topic.insights);
    expect(insights.map((insight) => insight.reading)).toEqual(["agreement", "disagreement", "middle"]);
    for (const insight of insights) {
      expect(insight.observation.length).toBeGreaterThan(0);
      expect(insight.evidence.statement).toBe(ITEMS21.find((item) => item.id === insight.itemId)?.statement);
      expect(insight.evidence.response).toBe(answers[insight.itemId]);
      expect(insight.contextCaveat.length).toBeGreaterThan(0);
      expect(insight.partnerQuestion.length).toBeGreaterThan(0);
      expect(insight.action.length).toBeGreaterThan(0);
    }
    expect(report.contextCaveats.length).toBeGreaterThan(0);
    expect(report.partnerQuestions).toHaveLength(3);
    expect(report.actions).toHaveLength(3);
    expect(report.unknowns.length).toBeGreaterThan(0);
  });

  it("낮은 동의가 반대 성격·가족 관계·능력을 뜻하지 않는다", () => {
    const report = buildReport(all(1));
    for (const insight of report.topics.flatMap((topic) => topic.insights)) {
      expect(insight.reading).toBe("disagreement");
      expect(insight.observation).toContain("맞지 않는다고 답했어요");
    }
    const exposed = JSON.stringify({ core: report.core, observations: report.topics.flatMap((topic) => topic.insights.map((insight) => insight.observation)) });
    expect(exposed).not.toMatch(/회피형|독립형|의존형|불안정|능력이|궁합 점수|가족 관계가|성격이/);
  });

  it("동시에 동의할 수 있는 문항과 서로 다른 장면을 각각 보존한다", () => {
    const report = buildReport(only({ Q02: 5, Q03: 5, Q05: 5, Q06: 5, Q13: 5, Q14: 5, Q18: 5, Q19: 5, Q20: 5, Q21: 5 }));
    expect(report.combinations.map((note) => note.itemIds)).toEqual([
      ["Q02", "Q03"], ["Q05", "Q06"], ["Q13", "Q14"], ["Q18", "Q19"], ["Q20", "Q21"],
    ]);
    expect(report.combinations.find((note) => note.itemIds.includes("Q20"))?.message).toContain("이 답만으로 정할 수 없어요");
    expect(report.combinations.find((note) => note.itemIds.includes("Q18"))?.message).toContain("업체 연락");
    expect(report.combinations.find((note) => note.itemIds.includes("Q18"))?.message).toContain("준비가 밀린 날");
    expect(report.combinations.find((note) => note.itemIds.includes("Q02"))?.message).toContain("전체 예산");
    expect(JSON.stringify(report)).not.toMatch(/모순된 답|역채점|충돌 점수/);
  });

  it("가족 문항 전체 비해당에서 가족의 생각이나 관계를 만들어내지 않는다", () => {
    const answers = all(4);
    for (const id of TOPICS[2].itemIds) answers[id] = "not-applicable";
    const report = buildReport(answers);
    expect(report.topics[2].insights).toEqual([]);
    expect(report.topics[2].numericCount).toBe(0);
    expect(report.unknowns.find((unknown) => unknown.kind === "not-applicable")?.message).toContain("가족 관계나 가치관");
    expect(report.character.status).toBe("pending");
  });

  it("응답 하나를 바꿔도 관계없는 설명은 바뀌지 않는다", () => {
    const before = buildReport(all(3));
    for (const changedItem of ITEMS21) {
      const answers = all(3);
      answers[changedItem.id] = 5;
      const after = buildReport(answers);
      const beforeOthers = before.topics.flatMap((topic) => topic.insights).filter((insight) => insight.itemId !== changedItem.id);
      const afterOthers = after.topics.flatMap((topic) => topic.insights).filter((insight) => insight.itemId !== changedItem.id);
      expect(afterOthers).toEqual(beforeOthers);
      expect(after.topics.filter((topic) => topic.id !== changedItem.topicId)).toEqual(before.topics.filter((topic) => topic.id !== changedItem.topicId));
    }
  });

  it("1~5의 인접한 답에서도 원답을 보존하고 양끝만으로 해석을 만들지 않는다", () => {
    for (const response of [1, 2, 3, 4, 5] as const) {
      const report = buildReport(only({ Q11: response }));
      expect(report.evidence.find((row) => row.itemId === "Q11")?.response).toBe(response);
      expect(report.topics[1].insights[0].reading).toBe(response <= 2 ? "disagreement" : response === 3 ? "middle" : "agreement");
      expect(report.topics[1].insights[0].observation).not.toContain("회피");
    }
  });
});

describe("공유 전 검토할 비가족 요약", () => {
  it("친구 요약에는 명시적으로 동의한 본인 선호만 있고 원답·가족은 없다", () => {
    const summary = buildSafeSummary(all(5));
    expect(summary.lines).toHaveLength(17);
    expect(summary.lines.map((line) => line.itemId)).not.toContain("Q13");
    for (const line of summary.lines) expect(line.text).toBe(AGREEMENT_COPY[line.itemId]);
    expect(summary).not.toHaveProperty("answers");
    expect(JSON.stringify(summary)).not.toMatch(/가족|Q13|Q14|Q15|Q16/);
    expect(buildSafeSummary(all(1)).lines).toEqual([]);
    expect(buildSafeSummary(all(3)).lines).toEqual([]);
    expect(buildSafeSummary(all("unknown")).lines).toEqual([]);
  });

  it("가족 응답만 달라져도 비가족 요약은 같다", () => {
    const answers = all(5);
    const before = buildSafeSummary(answers);
    for (const itemId of ["Q13", "Q14", "Q15", "Q16"] satisfies ItemId[]) answers[itemId] = 1;
    expect(buildSafeSummary(answers)).toEqual(before);
  });
});
