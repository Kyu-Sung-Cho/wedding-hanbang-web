import { describe, expect, it, vi } from "vitest";
import { persistEtiquetteSchedule } from "@/components/app/etiquette/etiquetteScheduleSave";

describe("persistEtiquetteSchedule", () => {
  it("reports failure instead of success when the shared journey update is rejected", async () => {
    const updateJourney = vi.fn().mockResolvedValue(false);

    const result = await persistEtiquetteSchedule({
      nextProgress: { __events: [] },
      mode: "add",
      updateJourney,
    });

    expect(result).toEqual({
      ok: false,
      message: "공동 일정을 저장하지 못했습니다. 입력한 내용은 그대로 두었으니 다시 시도해주세요.",
    });
  });
});
