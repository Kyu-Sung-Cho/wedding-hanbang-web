import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import WeddingDetails from "../WeddingDetails";

describe("WeddingDetails budget", () => {
  it("offers an explicit undecided option when no budget was entered", () => {
    const html = renderToStaticMarkup(
      <WeddingDetails
        weddingDate={null}
        weddingDateUndecided={true}
        venue={null}
        venueUndecided={true}
        budget={0}
        onDateChange={vi.fn()}
        onDateUndecidedChange={vi.fn()}
        onVenueChange={vi.fn()}
        onVenueUndecidedChange={vi.fn()}
        onBudgetChange={vi.fn()}
      />,
    );

    expect(html).toContain("아직 미정");
    expect(html).toContain("예산은 정한 뒤 입력해도 돼요");
    expect(html).not.toContain("상견례");
  });
});
