import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  canSaveEtiquetteToSharedSchedule,
  EtiquetteStorageNotice,
  ItemRenderer,
} from "@/components/app/etiquette/EtiquetteClient";

describe("etiquette checklist trust boundary", () => {
  it("does not call a demo or logged-out journey a shared schedule", () => {
    expect(canSaveEtiquetteToSharedSchedule({
      isAuthenticated: false,
      hasJourney: true,
      isDemo: false,
    })).toBe(false);
    expect(canSaveEtiquetteToSharedSchedule({
      isAuthenticated: true,
      hasJourney: true,
      isDemo: true,
    })).toBe(false);
  });

  it("keeps device memo available but hides shared-schedule save without a journey", () => {
    const html = renderToStaticMarkup(
      <ItemRenderer
        item={{ type: "list-item", text: "양가 일정 확인" }}
        blockType="checklist"
        itemId="item-1"
        isChecked={false}
        canSaveToSharedSchedule={false}
        onToggleCheck={vi.fn()}
        onOpenSchedule={vi.fn()}
        onOpenMemo={vi.fn()}
      />,
    );

    expect(html).toContain("이 기기에 메모 추가");
    expect(html).not.toContain("공동 일정에 추가");
  });

  it("labels device-only records separately from the couple's shared schedule", () => {
    const html = renderToStaticMarkup(
      <EtiquetteStorageNotice canSaveToSharedSchedule />,
    );

    expect(html).toContain("체크와 메모는 이 기기에만 저장돼요");
    expect(html).toContain("공동 일정에 추가");
    expect(html).toContain("커플 공동 일정");
  });
});
