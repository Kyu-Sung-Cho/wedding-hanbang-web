import { describe, expect, it } from "vitest";
import { GET } from "../route";

describe("/api/community/profiles/[userId] GET", () => {
  it("retires the cohort-only public profile card before request or database access", async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(410);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(body.code).toBe("cohort_rooms_retired");
  });
});
