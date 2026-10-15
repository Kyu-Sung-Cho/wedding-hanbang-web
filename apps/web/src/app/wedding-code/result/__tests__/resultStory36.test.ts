// @vitest-environment node
import { describe, expect, it } from "vitest";
import { CRITERIA, NOTES } from "@/constants/weddingCode36";
import { createSubmission, presentIndividual, type Rating, type Submission } from "@/lib/weddingCode36";
import reviewedCopy from "@/lib/weddingCode36/data/type-cards.json";
import { buildResultStory36, criterionReading36 } from "../resultStory36";

const expectedAnimals: Record<string, string> = { P: "beaver", J: "penguin", D: "cat", S: "peacock" };

function withCriteria(vectors: Record<string, Rating[]>, initial: Rating = 3): Submission {
  const submission = createSubmission(initial);
  for (const criterion of CRITERIA) {
    const values = vectors[criterion.id];
    if (values) criterion.item_ids.forEach((id, index) => { submission.answers[id] = values[index]; });
  }
  return submission;
}

describe("36문항 결과의 응답 근거와 다음 대화", () => {
  it.each(reviewedCopy.cards)("$name은 검수된 준비 제안과 해당 동물을 보여준다", card => {
    const result = presentIndividual(withCriteria({ [card.adjective_criterion]: [5, 5, 5], [card.animal_criterion]: [5, 5, 5] }));
    const before = structuredClone(result);
    const story = buildResultStory36(result);
    expect(result.assessment.alias.id).toBe(card.id);
    expect(story.action).toBe(card.action);
    expect(story.tags).toHaveLength(2);
    expect(story.tags.every(tag => tag.length > 0)).toBe(true);
    expect(story.animal).toBe(expectedAnimals[card.animal_criterion]);
    expect(result).toEqual(before);
  });

  it("단단한 비버는 예산과 준비 날짜를 짚고 기존 6개 근거를 보존한다", () => {
    const result = presentIndividual(withCriteria({ B: [5, 5, 5], P: [5, 5, 5] }, 2));
    expect(buildResultStory36(result)).toMatchObject({
      tags: ["예산 한도 유지", "준비 날짜 미리 정하기"],
      action: "전체 예산에 포함할 항목을 적고, 다음에 함께 볼 날을 정해보세요.",
      animal: "beaver",
    });
    expect(result.profile.find(card => card.id === "B")?.evidence.map(entry => entry.value)).toEqual([5, 5, 5]);
    expect(result.profile.find(card => card.id === "P")?.evidence.map(entry => entry.value)).toEqual([5, 5, 5]);
  });

  it.each([
    [1, "제시된 준비 방식에는 동의하지 않았어요"],
    [2, "제시된 준비 방식에는 동의하지 않았어요"],
    [3, "모든 준비 기준에서 중간 응답을 골랐어요"],
    [4, "여러 준비 기준에 모두 동의했어요"],
    [5, "여러 준비 기준에 모두 동의했어요"],
  ] as const)("전부 %i인 답도 응답 모습에 맞게 안내한다", (rating, heading) => {
    const result = presentIndividual(createSubmission(rating));
    expect(buildResultStory36(result)).toMatchObject({ stateHeading: heading, animal: "otter", tags: [] });
    expect(buildResultStory36(result).action).toBeTruthy();
    expect(result.name).toBe("아직 미정인 수달");
  });

  it("장면 메모가 달라도 27개 기준이 모두 중간인 안내는 바뀌지 않는다", () => {
    const submission = createSubmission(3);
    for (const note of NOTES) submission.answers[note.id] = 5;
    expect(buildResultStory36(presentIndividual(submission)).stateHeading).toBe("모든 준비 기준에서 중간 응답을 골랐어요");
  });

  it("답이 하나도 없으면 성향이나 준비 제안을 만들지 않는다", () => {
    expect(buildResultStory36(presentIndividual(createSubmission()))).toEqual({
      stateHeading: "아직 답한 장면이 없어요", tags: [], action: null, animal: "otter",
    });
  });

  it("장면 메모만 답했을 때는 준비 기준에 답했다고 하지 않는다", () => {
    const submission = createSubmission();
    for (const note of NOTES) submission.answers[note.id] = 4;
    const result = presentIndividual(submission);
    expect(result.answered_count).toBe(9);
    expect(buildResultStory36(result)).toMatchObject({ stateHeading: "답한 장면부터 살펴볼게요", tags: [], animal: "otter" });
  });

  it("빈 답을 중간으로 바꾸거나 안내에 비공개 사유를 옮기지 않는다", () => {
    const submission = createSubmission(3);
    submission.answers.B1 = null;
    submission.missing_reasons.B1 = "prefer_not_to_answer";
    const result = presentIndividual(submission);
    const story = buildResultStory36(result);
    expect(story.stateHeading).toBe("답한 장면부터 살펴볼게요");
    expect(story.action).toContain("빈 답은 그대로 두어도");
    expect(JSON.stringify(story)).not.toContain("prefer_not_to_answer");
    expect(result.profile.find(card => card.id === "B")?.mean).toBeNull();
  });

  it("같은 평균이어도 1·3·5와 3·3·3은 다르게 읽는다", () => {
    const varied = presentIndividual(withCriteria({ B: [1, 3, 5] }));
    const neutral = presentIndividual(createSubmission(3));
    const variedCard = varied.profile.find(card => card.id === "B")!;
    const neutralCard = neutral.profile.find(card => card.id === "B")!;
    expect(variedCard.mean).toBe(neutralCard.mean);
    expect(criterionReading36(variedCard).status).toBe("장면에 따라 동의·비동의");
    expect(criterionReading36(neutralCard).status).toBe("세 장면 모두 중간 응답");
    expect(buildResultStory36(varied).stateHeading).toBe("장면에 따라 답이 달랐어요");
    expect(variedCard.evidence.map(entry => entry.value)).toEqual([1, 3, 5]);
  });

  it("한 부분만 확인되면 그 기준만 보여주고 전체 유형 동물을 붙이지 않는다", () => {
    const result = presentIndividual(withCriteria({ B: [5, 5, 5] }));
    expect(result.assessment.alias.status).toBe("partial");
    expect(buildResultStory36(result)).toMatchObject({
      stateHeading: "반복해서 동의한 준비 기준이 있어요", tags: ["예산 한도 유지"], animal: "otter",
    });
  });

  it("일부 기준이 확인돼도 다른 기준의 빈 답과 장면 차이는 먼저 안내한다", () => {
    const missing = presentIndividual(withCriteria({ B: [5, 5, 5], P: [null, 3, 3] }));
    const varied = presentIndividual(withCriteria({ B: [5, 5, 5], P: [1, 3, 5] }));
    expect(buildResultStory36(missing)).toMatchObject({ stateHeading: "답한 장면부터 살펴볼게요", tags: ["예산 한도 유지"], animal: "otter" });
    expect(buildResultStory36(varied)).toMatchObject({ stateHeading: "장면에 따라 답이 달랐어요", tags: ["예산 한도 유지"], animal: "otter" });
  });

  it("동점에서 대표 기준을 임의로 고르지 않는다", () => {
    const result = presentIndividual(withCriteria({ B: [5, 5, 5], M: [5, 5, 5], P: [5, 5, 5], J: [5, 5, 5] }));
    expect(result.assessment.alias.adjective.reason).toBe("top_tie");
    expect(buildResultStory36(result)).toMatchObject({ stateHeading: "같은 정도로 답한 준비 기준이 있어요", tags: [], animal: "otter" });
  });

  it("한 묶음의 모든 기준에 동의했을 때도 하나를 임의로 고르지 않는다", () => {
    const result = presentIndividual(withCriteria({ B: [5, 5, 5], M: [5, 5, 5], V: [5, 5, 5], G: [5, 5, 5], F: [5, 5, 5] }));
    expect(result.assessment.alias.adjective.reason).toBe("all_supported");
    expect(buildResultStory36(result)).toMatchObject({ stateHeading: "함께 드러난 준비 기준이 여러 개예요", tags: [], animal: "otter" });
  });

  it("작은 응답 차이와 반복된 동의 부족은 서로 다른 안내를 한다", () => {
    const narrow = presentIndividual(withCriteria({ B: [5, 5, 5], M: [5, 5, 4], P: [5, 5, 5], J: [5, 5, 4] }));
    const unrepeated = presentIndividual(withCriteria(Object.fromEntries(CRITERIA.map(card => [card.id, [3, 3, 4]]))));
    expect(narrow.assessment.alias.adjective.reason).toBe("small_gap");
    expect(buildResultStory36(narrow).stateHeading).toBe("대표 기준 하나를 고르기에는 답이 비슷했어요");
    expect(buildResultStory36(unrepeated).stateHeading).toBe("이름 하나보다 장면별 답을 함께 봐요");
    expect(buildResultStory36(narrow).animal).toBe("otter");
    expect(buildResultStory36(unrepeated).animal).toBe("otter");
  });

  it("아홉 기준에 짧은 제목을 주되 평균과 원답을 바꾸지 않는다", () => {
    const result = presentIndividual(createSubmission(4));
    const before = structuredClone(result.profile);
    const labels = result.profile.map(card => criterionReading36(card).label);
    expect(labels).toHaveLength(9);
    expect(new Set(labels).size).toBe(9);
    expect(labels).toContain("하객 경험에 추가로 쓰기");
    expect(labels).toContain("합의한 세부 선택 맡기기");
    expect(result.profile).toEqual(before);
  });

  it.each([
    [[4, 5, 4], "세 장면 모두 동의"],
    [[1, 2, 1], "세 장면 모두 동의하지 않음"],
    [[null, 3, 4], "답하지 않은 장면 포함"],
    [[2, 3, 4], "장면에 따라 동의·비동의"],
    [[3, 3, 3], "세 장면 모두 중간 응답"],
    [[3, 4, 4], "중간 응답이 섞여 있음"],
    [[2, 2, 3], "중간 응답이 섞여 있음"],
  ] as const)("세 답 %j의 실제 응답 패턴만 설명한다", (vector, expected) => {
    const result = presentIndividual(withCriteria({ B: [...vector] }));
    expect(criterionReading36(result.profile.find(card => card.id === "B")!).status).toBe(expected);
  });
});
