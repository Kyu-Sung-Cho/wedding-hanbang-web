import { describe, expect, it } from "vitest";
import { createEmptyWeddingTasteDraft } from "../validation";
import { buildWeddingTasteAmoraText, summarizeWeddingTaste } from "../summary";
import { compareWeddingTastes } from "../comparison";
import type { WeddingTasteDraftV1 } from "../types";

const first = (): WeddingTasteDraftV1 => ({ ...createEmptyWeddingTasteDraft(), priorityDomains: { status: "answered", values: ["photo"] }, mood: { status: "answered", values: ["minimal", "natural"] }, details: { photo: { status: "answered", values: ["candid"] } }, avoids: { status: "answered", values: ["repeated_poses"] }, negotiability: { photo: "open_to_options" } });
describe("취향 요약과 비교", () => {
  it("내 선택을 모두 전달하되 미응답과 상대의 선택을 지어내지 않는다", () => {
    const text = buildWeddingTasteAmoraText(first());
    expect(text).toContain("자연스러운 순간");
    expect(text).toContain("정해진 포즈만 반복하는 촬영");
    expect(text).toContain("다른 안도 함께 볼 수 있어요");
    expect(text).toContain("둘이 같이 정한 건 아니에요");
    expect(text).not.toContain("뷔페");
    expect(summarizeWeddingTaste(first()).find(row => row.key === "detail:meal")?.state).toBe("skipped");
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
