import { describe, expect, it } from "vitest";
import { createEmptyWeddingTasteDraft } from "../validation";
import { buildWeddingTasteAmoraText, summarizeWeddingTaste } from "../summary";
import { compareWeddingTastes } from "../comparison";
import type { WeddingTasteDraft } from "../types";

const first = (): WeddingTasteDraft => ({ ...createEmptyWeddingTasteDraft(), priorityDomains: { status: "answered", values: ["photo"] }, mood: { status: "answered", values: ["minimal", "natural"] }, details: { photo: { status: "answered", values: ["candid"] } }, avoids: { status: "answered", values: ["repeated_poses"] }, negotiability: { photo: "open_to_options" } });
describe("취향 요약과 비교", () => {
  it("내 선택을 모두 전달하되 미응답과 상대의 선택을 지어내지 않는다", () => {
    const text = buildWeddingTasteAmoraText(first());
    expect(text).toContain("자연스러운 순간");
    expect(text).toContain("정해진 포즈만 반복하는 촬영");
    expect(text).toContain("다른 취향의 후보도 함께 비교하고 싶어요");
    expect(text).toContain("둘이 같이 정한 건 아니에요");
    expect(text).not.toContain("뷔페");
    expect(summarizeWeddingTaste(first()).find(row => row.key === "detail:meal")?.state).toBe("skipped");
  });
  it.each(["질문이 나오지 않음", "건너뜀", "미정"] as const)("v2 Q6가 %s이면 첫 후보 범위를 골랐다고 전달하지 않는다", state => {
    const draft: WeddingTasteDraft = state === "질문이 나오지 않음"
      ? { ...createEmptyWeddingTasteDraft("wedding-taste-v2"), mood: { status: "answered", values: ["minimal"] } }
      : { ...first(), negotiability: state === "미정" ? { photo: "undecided" } : {} };
    const text = buildWeddingTasteAmoraText(draft);
    expect(text).not.toContain("처음 살펴볼 후보를 고른");
    expect(text).not.toContain("지금 고른 취향 안에서 찾아보고 싶어요");
    expect(text).not.toContain("다른 취향의 후보도 함께 비교하고 싶어요");
    expect(text).toContain("먼저 이야기할 주제를 골라도 돈을 더 쓰겠다는 뜻은 아니에요");
    expect(text).toContain("다른 후보도 비교하고 싶다고 답했더라도, 그걸로 바꾸겠다는 약속은 아니에요");
    if (state === "미정") {
      expect(text).toContain("사진 의견이 다르면 먼저 볼 후보: 아직 정하지 못했어요.");
    } else {
      expect(text).not.toContain("의견이 다르면 먼저 볼 후보:");
    }
  });
  it("순서만 다른 복수 선택은 같게 보고, 빈 답끼리는 같은 취향이라고 말하지 않는다", () => {
    const second = first(); second.mood = { status: "answered", values: ["natural", "minimal"] };
    const rows = compareWeddingTastes(first(), second);
    expect(rows.find(row => row.key === "mood")?.status).toBe("same_selection");
    expect(rows.find(row => row.key === "detail:meal")?.status).toBe("needs_confirmation");
  });
  it("자연스러운 사진과 준비한 포즈의 차이를 인용하고 궁합 점수를 만들지 않는다", () => {
    const second = first(); second.details.photo = { status: "answered", values: ["directed"] };
    const row = compareWeddingTastes(first(), second).find(item => item.key === "detail:photo");
    expect(row).toMatchObject({ status: "different_selection", first: "자연스러운 순간", second: "준비한 포즈와 장면" });
    expect(row).not.toHaveProperty("score");
  });
});
