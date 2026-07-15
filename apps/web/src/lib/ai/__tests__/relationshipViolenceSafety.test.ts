import { describe, expect, it } from "vitest";
import {
  hasImmediateKoreanRelationshipViolenceSignal,
  KOREAN_RELATIONSHIP_VIOLENCE_SAFETY_RESPONSE,
} from "../relationshipViolenceSafety";

describe("hasImmediateKoreanRelationshipViolenceSignal", () => {
  it.each([
    "남자친구가 지금 나를 때리고 있어",
    "예비 신랑이 어제 내 목을 졸랐어",
    "상대가 칼을 들고 죽이겠다고 위협해",
    "문을 잠그고 나를 못 나가게 해",
    "계속 위치를 추적하고 집 앞에서 기다려",
    "애인에게 성폭행을 당했어",
    "맞았고 지금도 같은 집에 있어",
  ])("flags a clear current relationship-violence signal: %s", (text) => {
    expect(hasImmediateKoreanRelationshipViolenceSignal(text)).toBe(true);
  });

  it.each([
    "서로 말다툼을 했어",
    "남자친구가 나를 때린 건 아니야",
    "폭행당한 적은 없어",
    "영화에서 남편이 아내를 때리는 장면이 나와",
    "폭행 사건 기사를 요약해줘",
    "드레스 가격이 너무 폭력적이야",
    "스토킹이라는 영화 알아?",
    "계약서 때문에 집에 못 나가게 바빠",
  ])("does not flag ordinary conflict, negation, fiction, or metaphor: %s", (text) => {
    expect(hasImmediateKoreanRelationshipViolenceSignal(text)).toBe(false);
  });

  it("returns only a boolean and does not propagate sensitive source text", () => {
    expect(typeof hasImmediateKoreanRelationshipViolenceSignal("상대가 나를 때렸어")).toBe(
      "boolean",
    );
  });
});

describe("KOREAN_RELATIONSHIP_VIOLENCE_SAFETY_RESPONSE", () => {
  it("does not mediate violence and gives scoped official help routes", () => {
    expect(KOREAN_RELATIONSHIP_VIOLENCE_SAFETY_RESPONSE).toContain("단순한 의견 차이로 중재할 일이 아닙니다");
    expect(KOREAN_RELATIONSHIP_VIOLENCE_SAFETY_RESPONSE).toContain("112");
    expect(KOREAN_RELATIONSHIP_VIOLENCE_SAFETY_RESPONSE).toContain("119");
    expect(KOREAN_RELATIONSHIP_VIOLENCE_SAFETY_RESPONSE).toContain("여성폭력 피해자는 1366");
    expect(KOREAN_RELATIONSHIP_VIOLENCE_SAFETY_RESPONSE).toContain("365일 24시간");
    expect(KOREAN_RELATIONSHIP_VIOLENCE_SAFETY_RESPONSE).toContain("신고·구조·법률 자문을 대신할 수 없습니다");
    expect(KOREAN_RELATIONSHIP_VIOLENCE_SAFETY_RESPONSE).not.toMatch(/화해|서로의 입장|대화로 풀|참아/);
  });
});
