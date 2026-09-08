// @vitest-environment node
import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("공개 준비 안내 조회", () => {
  it.each([
    ["c.venue.venue_04", "/checklist?category=venue"],
    ["g.gift-money.section-2", "/manners/gift-money#section-2"],
  ])("확정된 안내에서 짧은 질문만 복원한다: %s", async (source, href) => {
    const response = await GET(new Request(`https://hanbang.ai/api/amora/preparation-source?source=${source}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(["source", "sourceHref", "sourceLabel", "text"]);
    expect(body.source).toBe(source);
    expect(body.sourceHref).toBe(href);
    expect(body.sourceLabel.length).toBeGreaterThan(0);
    expect(body.text).toContain(body.sourceLabel);
    expect(body.text.length).toBeLessThan(500);
  });

  it.each([
    "", "source=", "source=c.venue.studio_01", "source=g.missing",
    "source=g.gift-money.section-999", "source=c.venue&source=g.gift-money",
    "source=c.venue&text=private-note", `source=${"a".repeat(171)}`,
  ])("잘못된 ID와 추가 텍스트를 되돌려 주지 않는다: %s", async query => {
    const response = await GET(new Request(`https://hanbang.ai/api/amora/preparation-source?${query}`));
    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "invalid_preparation_source" });
  });
});
