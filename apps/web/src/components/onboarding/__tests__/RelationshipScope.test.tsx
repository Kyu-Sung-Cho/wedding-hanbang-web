import { PUBLIC_BETA_RELATIONSHIP_SCOPE } from "@hanbang/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import RoleSelection from "../RoleSelection";

describe("public beta relationship scope", () => {
  it("explains the supported couple structure before a user selects a role", () => {
    const html = renderToStaticMarkup(
      <RoleSelection selected={null} onSelect={vi.fn()} />,
    );

    expect(PUBLIC_BETA_RELATIONSHIP_SCOPE.supportedRoles).toEqual([
      "bride",
      "groom",
    ]);
    expect(html).toContain(PUBLIC_BETA_RELATIONSHIP_SCOPE.notice);
    expect(html).toContain(PUBLIC_BETA_RELATIONSHIP_SCOPE.guidance);
    expect(html).toContain("신부");
    expect(html).toContain("신랑");
  });
});
