import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WEDDING_CODE_V42_BANK } from "@/lib/weddingCode/v42/bank";
import { compareCouple } from "@/lib/weddingCode/v40/couple";
import { buildFixtures } from "@/lib/weddingCode/v40/fixtures";
import type { DecodedCode } from "@/lib/weddingCode/v40/types";
import { axisInfo } from "@/constants/weddingCodeV40";
import { CouplePreparationReport } from "./CouplePreparationSection";
import { buildCouplePreparationReport } from "./couplePreparationReport";
import { click, createHarness, type Harness } from "./inputTestKit";

const bank = WEDDING_CODE_V42_BANK;
const fixtures = buildFixtures(bank);
function decoded(name: string): DecodedCode {
  const found = fixtures.find((entry) => entry.name === name);
  if (!found) throw new Error(name);
  return { formBit: found.formBit, responses: found.responses };
}
const first = decoded("swua-example");
const second = decoded("couple-partner");
const result = compareCouple(bank, first, second);
const source = { bank, first, second };
let harness: Harness;
beforeEach(() => { harness = createHarness(); });
afterEach(async () => { await harness.unmount(); });
const root = () => harness.container;

describe("실제 두 사람 답을 읽는 준비 리포트", () => {
  it("모든 주제에서 제안과 실제 선택지, 각자 응답 분모를 함께 확인한다", async () => {
    const report = buildCouplePreparationReport(result, source);
    await harness.render(<CouplePreparationReport result={result} source={source} perspective="first" idPrefix="proof" headingLevel={2} />);
    for (const row of report.rows) {
      await click([...root().querySelectorAll("button")].find((button) => button.textContent === axisInfo(row.axis).title));
      const region = root().querySelector(`[data-preparation-axis="${row.axis}"]`)!;
      expect(root().querySelectorAll('[aria-pressed="true"]')).toHaveLength(1);
      expect(region.textContent).toContain(row.helpfulPoint);
      expect(region.textContent).toContain(row.firstCriterion);
      for (const person of ["first", "second"] as const) {
        expect(region.querySelector(`[data-preparation-person="${person}"]`)?.textContent).toContain(String(row.evidence[person].answered));
      }
      if (row.evidence.scene) {
        expect(region.querySelector('[data-preparation-scene]')?.textContent).toContain(row.evidence.scene.firstText);
        expect(region.querySelector('[data-preparation-scene]')?.textContent).toContain(row.evidence.scene.secondText);
      }
      expect(region.textContent).not.toMatch(/궁합|성격|진단|정확도|결혼 성공/u);
    }
  });

  it("나 기준을 바꿔도 제안 대상과 그 사람이 선택한 원문은 바뀌지 않는다", async () => {
    const report = buildCouplePreparationReport(result, source);
    const row = report.rows.find((each) => each.roleSuggestion?.frontCandidate != null && each.evidence.scene != null)!;
    expect(row).toBeDefined();
    await harness.render(<CouplePreparationReport result={result} source={source} perspective="first" idPrefix="proof" headingLevel={2} />);
    await click([...root().querySelectorAll("button")].find((button) => button.textContent === axisInfo(row.axis).title));
    const tasks = ["first", "second"].map((person) => root().querySelector(`[data-role-candidate="${person}"] p`)?.textContent);
    const answers = ["first", "second"].map((person) => root().querySelector(`[data-scene-person="${person}"] p:last-child`)?.textContent);
    await harness.render(<CouplePreparationReport result={result} source={source} perspective="second" idPrefix="proof" headingLevel={2} />);
    expect(root().querySelector('[data-role-candidate]')?.getAttribute("data-role-candidate")).toBe("second");
    expect(root().querySelector('[data-role-candidate="second"]')?.textContent).toContain("나에게 제안하는 일");
    expect(["first", "second"].map((person) => root().querySelector(`[data-role-candidate="${person}"] p`)?.textContent)).toEqual(tasks);
    expect(["first", "second"].map((person) => root().querySelector(`[data-scene-person="${person}"] p:last-child`)?.textContent)).toEqual(answers);
  });

  it("임시나 미정이면 역할과 비교 장면 대신 보류 안내를 읽는다", async () => {
    const sparse = decoded("unusable-axis");
    const compared = compareCouple(bank, sparse, first);
    const row = compared.axes.find((each) => each.excluded)!;
    await harness.render(<CouplePreparationReport result={compared} source={{ bank, first: sparse, second: first }} perspective={null} idPrefix="proof" headingLevel={3} />);
    await click([...root().querySelectorAll("button")].find((button) => button.textContent === axisInfo(row.axis).title));
    expect(root().querySelectorAll("h2")).toHaveLength(0);
    expect(root().querySelector("h3")?.textContent).toBe("우리 둘의 준비 리포트");
    expect(root().querySelector('[data-role-candidate]')).toBeNull();
    expect(root().querySelector('[data-preparation-scene]')).toBeNull();
    expect(root().textContent).toContain("지금은 담당을 제안하지 않아요");
  });

  it("결과와 원응답이 어긋나면 장면도 역할도 보류하고 회복 방법을 알린다", async () => {
    await harness.render(<CouplePreparationReport result={result} source={{ bank, first: second, second: first }} perspective={null} idPrefix="proof" headingLevel={2} />);
    expect(root().querySelector('[data-role-candidate]')).toBeNull();
    expect(root().querySelector('[data-preparation-scene]')).toBeNull();
    expect(root().textContent).toContain("받은 링크를 다시 열어 주세요");
  });

  it.each([
    ["unusable-axis", "unset", "글자를 정할 만큼 답이 모이지 않았어요"],
    ["provisional-tie", "provisional", "임시 글자가 나왔어요"],
    ["rhythm-gate", "gate", "응답 상태를 먼저 확인해야"],
  ] as const)("%s에서는 보류 사유를 구별해서 알려 준다", async (name, reason, explanation) => {
    const sample = decoded(name);
    const compared = compareCouple(bank, sample, first);
    const model = buildCouplePreparationReport(compared, { bank, first: sample, second: first });
    const row = model.rows.find((each) => each.exclusionReason === reason)!;
    expect(row).toBeDefined();
    await harness.render(<CouplePreparationReport result={compared} source={{ bank, first: sample, second: first }} perspective={null} idPrefix="proof" headingLevel={2} />);
    await click([...root().querySelectorAll("button")].find((button) => button.textContent === axisInfo(row.axis).title));
    expect(root().querySelector(`[data-preparation-exclusion="${reason}"]`)?.textContent).toContain(explanation);
  });
});
