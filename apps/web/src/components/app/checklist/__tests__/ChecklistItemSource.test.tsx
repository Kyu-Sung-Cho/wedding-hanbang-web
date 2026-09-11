import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import ChecklistItemSource from "@/components/app/checklist/ChecklistItemSource";

describe("체크리스트 근거 링크의 실제 렌더", () => {
  it.each(["link", "chip"] as const)("신혼집 계약 신고 항목이 %s 화면에서도 해당 가이드 절로 연결된다", (variant) => {
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(<ChecklistItemSource itemId="housing_13" variant={variant} />);
    const anchors = container.querySelectorAll("a");
    expect(anchors).toHaveLength(1);
    expect(anchors[0].getAttribute("href")).toBe("/wedding/manners/home-conversation#section-5");
    expect(anchors[0].textContent).toBe("근거 · 계약 직후 — 주택 임대차 계약 신고 대상 확인");
  });

  it("근거 없는 항목에는 링크를 지어내지 않는다", () => {
    expect(renderToStaticMarkup(<ChecklistItemSource itemId="unknown_item" />)).toBe("");
  });
});
