import { describe, expect, it } from "vitest";

import { COMMUNITY_POST_PUBLIC_SELECT } from "../postSelect";

describe("public community post projection", () => {
  it("does not expose private verification evidence or an internal cohort room id", () => {
    const columns = COMMUNITY_POST_PUBLIC_SELECT
      .split(",")
      .map((column) => column.trim());

    expect(columns).not.toContain("verification_doc_url");
    expect(columns).not.toContain("cohort_room_id");
    expect(columns).not.toContain("author_id");
    expect(columns).toContain("author_id:author_public_id");
  });
});
