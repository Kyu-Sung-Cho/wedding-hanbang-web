import { describe, expect, it } from "vitest";
import { V40_STATE_COUNTS } from "@/constants/weddingCodeV40";
import { WEDDING_CODE_V42_BANK } from "@/lib/weddingCode/v42/bank";
import { compareCouple } from "@/lib/weddingCode/v40/couple";
import { fixtureByName, V40_FIXTURES } from "@/lib/weddingCode/v40/fixtures";
import { answerText } from "@/lib/weddingCode/v40/present";
import { stateChar } from "@/lib/weddingCode/v40/states";
import { itemValue, stateValue } from "@/lib/weddingCode/v40/value";
import type { Axis, CoupleResult, DecodedCode } from "@/lib/weddingCode/v40/types";
import { buildCouplePreparationReport, type CoupleReportSource } from "./couplePreparationReport";

const bank = WEDDING_CODE_V42_BANK;

function fixture(name: string): DecodedCode {
  const found = fixtureByName(name);
  if (found === undefined) throw new Error(`표본을 찾지 못했습니다: ${name}`);
  return { formBit: found.formBit, responses: found.responses };
}

function source(first: DecodedCode, second: DecodedCode): CoupleReportSource {
  return { bank, first, second };
}

function prepared(first: DecodedCode, second: DecodedCode) {
  const result = compareCouple(bank, first, second);
  return { result, report: buildCouplePreparationReport(result, source(first, second)) };
}

function rowAt(result: CoupleResult, axis: Axis) {
  const row = result.axes.find((entry) => entry.axis === axis);
  if (row === undefined) throw new Error(`축을 찾지 못했습니다: ${axis}`);
  return row;
}

function reversedAxis(person: DecodedCode, axis: Axis): DecodedCode {
  const responses = { ...person.responses };
  for (const item of bank.scoredByAxis[axis]) {
    const wanted = itemValue(item, person.responses[item.id]);
    if (wanted === null) throw new Error(`${item.id}의 유효 답이 없습니다.`);
    let found = false;
    for (let state = 0; state < V40_STATE_COUNTS[item.fmt]; state += 1) {
      if (stateValue(item, state) !== -wanted) continue;
      responses[item.id] = stateChar(state);
      found = true;
      break;
    }
    if (!found) throw new Error(`${item.id}의 반대 방향 상태가 없습니다.`);
  }
  return { formBit: person.formBit, responses };
}

describe("실제 v4.2 답에 근거한 커플 준비 리포트", () => {
  const first = fixture("swua-example");
  const second = fixture("couple-partner");

  it("고정 네 주제와 실제 수치·원문을 내고 사람 답의 정확도나 관계 점수를 만들지 않는다", () => {
    const { result, report } = prepared(first, second);
    expect(report.sourceStatus).toBe("verified");
    expect(report.rows.map((row) => row.axis)).toEqual(["money", "process", "scope", "support"]);
    for (const row of report.rows) {
      const scored = rowAt(result, row.axis);
      expect(row.evidence.first).toEqual({
        answered: scored.first.answered,
        frontCount: scored.first.frontCount,
        backCount: scored.first.backCount,
        neutralCount: scored.first.neutralCount,
      });
      expect(row.evidence.second).toEqual({
        answered: scored.second.answered,
        frontCount: scored.second.frontCount,
        backCount: scored.second.backCount,
        neutralCount: scored.second.neutralCount,
      });
      const scene = row.evidence.scene;
      if (scene !== null) {
        const item = bank.byId.get(scene.itemId);
        expect(item?.axis).toBe(row.axis);
        expect(scene.caption).toBe(item?.caption);
        expect(scene.prompt[0]).toBe(item?.stem);
        expect(scene.firstText.length).toBeGreaterThan(0);
        expect(scene.secondText.length).toBeGreaterThan(0);
      }
      expect(`${row.helpfulPoint} ${row.coordinationSituation} ${row.firstCriterion}`).not.toMatch(/궁합|성격|능력|성공률|합의했/u);
    }
  });

  it("두 사람 순서를 바꿔도 같은 주제·사례이며 근거와 역할 대상만 바뀐다", () => {
    const forward = prepared(first, second).report;
    const reverse = prepared(second, first).report;
    expect(reverse.sourceStatus).toBe("verified");
    for (let index = 0; index < 4; index += 1) {
      const a = forward.rows[index];
      const b = reverse.rows[index];
      expect(b.axis).toBe(a.axis);
      expect(b.state).toBe(a.state);
      expect(b.evidence.first).toEqual(a.evidence.second);
      expect(b.evidence.second).toEqual(a.evidence.first);
      expect(b.evidence.scene?.itemId ?? null).toBe(a.evidence.scene?.itemId ?? null);
      expect(b.evidence.scene?.firstText ?? null).toBe(a.evidence.scene?.secondText ?? null);
      expect(b.evidence.scene?.secondText ?? null).toBe(a.evidence.scene?.firstText ?? null);
      const swap = (person: "first" | "second" | null) => person === "first" ? "second" : person === "second" ? "first" : null;
      expect(b.roleSuggestion?.frontCandidate ?? null).toBe(swap(a.roleSuggestion?.frontCandidate ?? null));
      expect(b.roleSuggestion?.backCandidate ?? null).toBe(swap(a.roleSuggestion?.backCandidate ?? null));
    }
  });

  it("같은 글자여도 장면 묶음의 실제 답이 다르면 합의나 고정 담당으로 읽지 않는다", () => {
    const matching = V40_FIXTURES.flatMap((left) => V40_FIXTURES.flatMap((right) => {
      const a = { formBit: left.formBit, responses: left.responses };
      const b = { formBit: right.formBit, responses: right.responses };
      const comparison = compareCouple(bank, a, b);
      const target = comparison.axes.find((row) => row.tag === "same" && row.first.facets.some((facet, index) => {
        const other = row.second.facets[index];
        return facet.frontCount !== other.frontCount || facet.backCount !== other.backCount || facet.neutralCount !== other.neutralCount;
      }));
      return target === undefined ? [] : [{ a, b, target }];
    }))[0];
    expect(matching).toBeDefined();
    if (matching === undefined) return;
    const report = prepared(matching.a, matching.b).report;
    const row = report.rows.find((entry) => entry.axis === matching.target.axis);
    expect(row?.state).toBe("same");
    expect(row?.roleSuggestion?.frontCandidate).toBeNull();
    expect(row?.roleSuggestion?.backCandidate).toBeNull();
    expect(row?.helpfulPoint).toContain("장면마다 선택은 다를 수");
    expect(row?.helpfulPoint).not.toContain("합의");
  });

  it("네 주제의 같은 앞/뒤 글자는 서로 다른 준비 행동과 같은 방향 안의 조율 기준을 제안한다", () => {
    const front = fixture("all-clear");
    const backByAxis = {
      money: fixture("swua-example"),
      process: front,
      scope: front,
      support: reversedAxis(front, "support"),
    };
    const frontByAxis = {
      money: front,
      process: fixture("swua-example"),
      scope: fixture("swua-example"),
      support: front,
    };
    const expected = {
      money: { front: ["총액·추가금", "한도"], back: ["장면과 분위기", "우선"] },
      process: { front: ["함께 볼 시점", "상담"], back: ["완료 뒤 공유", "중간"] },
      scope: { front: ["둘의 초안", "어디까지"], back: ["의견을 들을 항목", "언제"] },
      support: { front: ["확인받거나 건네고 싶은", "어떤 말을"], back: ["도움을 원하거나 제안", "어떤 일은"] },
    } as const;
    for (const axis of ["money", "process", "scope", "support"] as const) {
      for (const [person, direction] of [[frontByAxis[axis], "front"], [backByAxis[axis], "back"]] as const) {
        const row = prepared(person, person).report.rows.find((entry) => entry.axis === axis);
        expect(row?.state, `${axis}/${direction}`).toBe("same");
        expect(row?.helpfulPoint, `${axis}/${direction}`).toContain(expected[axis][direction][0]);
        expect(row?.coordinationSituation, `${axis}/${direction}`).toContain(expected[axis][direction][1]);
        expect(row?.roleSuggestion?.frontCandidate).toBeNull();
        expect(row?.roleSuggestion?.backCandidate).toBeNull();
      }
    }
  });

  it("다른 방향과 반반도 네 주제마다 실제 결정 질문을 다르게 제안하며 반반은 담당을 고정하지 않는다", () => {
    const front = fixture("all-clear");
    const back = fixture("swua-example");
    const supportBack = reversedAxis(front, "support");
    const expected = {
      money: "총액·추가금과 남기고 싶은 장면",
      process: "함께 보고 싶은 순간과 따로 맡고 싶은 범위",
      scope: "둘이 먼저 초안을 쓸 항목과 가족 의견",
      support: "어느 반응이 먼저 필요한지",
    } as const;
    const pairByAxis = {
      money: [front, back],
      process: [front, back],
      scope: [front, back],
      support: [front, supportBack],
    } as const;
    const even = fixture("all-even");
    const evenReport = prepared(even, even).report;
    for (const axis of ["money", "process", "scope", "support"] as const) {
      const [a, b] = pairByAxis[axis];
      const different = prepared(a, b).report.rows.find((row) => row.axis === axis);
      expect(different?.state, axis).toBe("different");
      expect(different?.helpfulPoint).toContain(expected[axis]);
      const evenRow = evenReport.rows.find((row) => row.axis === axis);
      expect(evenRow?.state, axis).toBe("even");
      expect(evenRow?.helpfulPoint).toContain(axis === "money" ? "조건과 남기고 싶은 장면" : axis === "process" ? "같이 볼 부분과 맡길 부분" : axis === "scope" ? "둘이 정할 부분과 가족에게 물을 부분" : "그날 필요한 첫 반응");
      expect(evenRow?.roleSuggestion?.frontCandidate).toBeNull();
      expect(evenRow?.roleSuggestion?.backCandidate).toBeNull();
    }
  });

  it("도움 H/A 방향이 달라도 말·행동을 제공할 능력이나 돌봄 담당자를 글자로 정하지 않는다", () => {
    const heart = fixture("all-clear");
    const action = reversedAxis(heart, "support");
    const row = prepared(heart, action).report.rows.find((entry) => entry.axis === "support");
    expect(row?.state).toBe("different");
    expect(row?.roleSuggestion?.frontCandidate).toBeNull();
    expect(row?.roleSuggestion?.backCandidate).toBeNull();
    expect(row?.roleSuggestion?.intro).toContain("각자 필요한 말과 도움");
    expect(row?.roleSuggestion?.intro).toContain("담당은 글자로 정하지 않아요");
    expect(row?.roleSuggestion?.frontTask).toContain("각자 지친 날 듣고 싶은 말");
    expect(row?.roleSuggestion?.backTask).toContain("각자 부탁하거나 제안하고 싶은 도움");
  });

  it("반반인 주제는 방향별 담당자를 배정하지 않는다", () => {
    const report = prepared(first, second).report;
    const even = report.rows.find((row) => row.state === "even");
    expect(even).toBeDefined();
    expect(even?.roleSuggestion?.frontCandidate).toBeNull();
    expect(even?.roleSuggestion?.backCandidate).toBeNull();
    expect(even?.helpfulPoint).toContain("한쪽 이상");
  });

  it("원문 source가 없으면 상위 목록의 실제 장면만 쓰고 네 주제 모두 사례를 지어내지 않는다", () => {
    const same = fixture("all-clear");
    const comparison = compareCouple(bank, same, same);
    const report = buildCouplePreparationReport(comparison);
    expect(report.sourceStatus).toBe("absent");
    for (const row of report.rows) {
      const listed = comparison.talk.find((pair) => pair.axis === row.axis) ?? comparison.similar.find((pair) => pair.axis === row.axis);
      expect(row.evidence.scene?.itemId ?? null).toBe(listed?.itemId ?? null);
    }
    expect(report.rows.some((row) => row.evidence.scene === null)).toBe(true);
  });

  it("검증한 source에서는 상위 셋에 없는 축도 실제 둘의 유효 답에서 한 장면을 찾는다", () => {
    const same = fixture("all-clear");
    const comparison = compareCouple(bank, same, same);
    const absent = buildCouplePreparationReport(comparison).rows.find((row) => row.evidence.scene === null && !row.state.includes("excluded"));
    expect(absent).toBeDefined();
    if (absent === undefined) return;
    const report = buildCouplePreparationReport(comparison, source(same, same));
    const scene = report.rows.find((row) => row.axis === absent.axis)?.evidence.scene;
    expect(scene?.kind).toBe("other");
    const item = scene === null || scene === undefined ? undefined : bank.byId.get(scene.itemId);
    expect(scene?.firstText).toBe(item && scene ? answerText(item, same.responses[scene.itemId]) : undefined);
  });

  it("한 사람의 중립 0점도 유효 답으로 인정하고 원문 선택 장면에서 제외하지 않는다", () => {
    const same = fixture("all-clear");
    const original = compareCouple(bank, same, same);
    const uncovered = original.axes.find((row) => !original.talk.some((pair) => pair.axis === row.axis) && !original.similar.some((pair) => pair.axis === row.axis));
    expect(uncovered).toBeDefined();
    if (uncovered === undefined) return;
    const item = bank.scoredByAxis[uncovered.axis].find((entry) => entry.fmt === "react");
    expect(item).toBeDefined();
    if (item === undefined) return;
    const withNeutral: DecodedCode = { formBit: same.formBit, responses: { ...same.responses, [item.id]: stateChar(2) } };
    const { report } = prepared(withNeutral, same);
    const scene = report.rows.find((row) => row.axis === uncovered.axis)?.evidence.scene;
    expect(report.sourceStatus).toBe("verified");
    expect(scene?.itemId).toBe(item.id);
    expect(scene?.kind).toBe("other");
    expect(scene?.firstText).toContain("가운데 칸");
  });

  it("미정·임시·관문 제외는 실제 응답 수만 남기고 비교 장면과 담당자 제안을 보류한다", () => {
    const empty: DecodedCode = { formBit: 0, responses: {} };
    const unset = buildCouplePreparationReport(compareCouple(bank, empty, first));
    expect(unset.rows.every((row) => row.state === "excluded" && row.exclusionReason === "unset" && row.roleSuggestion === null && row.evidence.scene === null)).toBe(true);
    const provisional = prepared(fixture("provisional-tie"), first).report;
    expect(provisional.rows.some((row) => row.exclusionReason === "provisional" && row.roleSuggestion === null && row.evidence.scene === null)).toBe(true);
    const gated = prepared(fixture("rhythm-gate"), first).report;
    expect(gated.rows.every((row) => row.state === "excluded" && row.roleSuggestion === null && row.evidence.scene === null)).toBe(true);
    expect(gated.rows.some((row) => row.exclusionReason === "gate")).toBe(true);
  });

  it("source의 판·완전성·사람 순서가 어긋나면 사례와 역할을 모두 닫는다", () => {
    const { result } = prepared(first, second);
    const wrongVersion = { ...bank, version: "v4.1-depth" as const };
    const incomplete: DecodedCode = { ...first, responses: { ...first.responses } };
    delete (incomplete.responses as Record<string, string>)[bank.items[0].id];
    const candidates: CoupleReportSource[] = [
      { bank: wrongVersion, first, second },
      source(incomplete, second),
      source(second, first),
    ];
    for (const candidate of candidates) {
      const report = buildCouplePreparationReport(result, candidate);
      expect(report.sourceStatus).toBe("rejected");
      expect(report.rows.every((row) => row.roleSuggestion === null && row.evidence.scene === null)).toBe(true);
    }
  });

  it("동일 객체가 아니어도 부모가 넘긴 v4.2 판과 완전한 답·재계산 결과가 같으면 원문 source로 인정한다", () => {
    const { result } = prepared(first, second);
    const equivalentBank = { ...bank, items: [...bank.items] };
    const report = buildCouplePreparationReport(result, { bank: equivalentBank, first, second });
    expect(report.sourceStatus).toBe("verified");
    expect(report.rows.some((row) => row.evidence.scene !== null)).toBe(true);
  });
});
