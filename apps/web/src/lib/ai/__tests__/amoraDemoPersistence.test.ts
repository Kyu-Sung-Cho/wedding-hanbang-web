import { describe, expect, it } from "vitest";
import { guardDemoPersistenceDisclosure } from "../amoraDemoPersistence";

describe("guardDemoPersistenceDisclosure", () => {
  it("deterministically discloses that an explicit wedding date is not persisted", () => {
    const result = guardDemoPersistenceDisclosure(
      "날짜가 정해지니 갑자기 현실로 다가와 숨 막힐 수 있어요.",
      "결혼식은 내년 5월 3일로 정했는데 벌써 숨 막혀.",
    );

    expect(result.appendedNotice).toContain("실제 일정에는 아직 저장되지 않았어요");
    expect(result.text).toContain(result.appendedNotice);
  });

  it("does not duplicate a model disclosure", () => {
    const text = "체험 상담이라 실제 일정에는 저장되지 않았어요.";
    expect(guardDemoPersistenceDisclosure(text, "결혼식은 2027년 5월 3일로 정했어")).toEqual({
      text,
      appendedNotice: null,
    });
  });

  it("does not attach a persistence notice to ordinary price questions", () => {
    expect(guardDemoPersistenceDisclosure(
      "원본 비용은 업체마다 달라요.",
      "원본 데이터가 30만원인지 알려줘.",
    )).toEqual({ text: "원본 비용은 업체마다 달라요.", appendedNotice: null });
  });
});
