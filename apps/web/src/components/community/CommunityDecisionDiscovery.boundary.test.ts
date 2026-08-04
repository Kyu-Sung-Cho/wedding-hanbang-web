// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

describe("community decision discovery integration boundary", () => {
  it("places the compact decision feed before the existing generic community feed", () => {
    const landing = source("src/components/community/CommunityLandingClient.tsx");

    expect(landing).toContain("<CommunityDecisionDiscovery viewerId={viewerId} />");
    expect(landing.indexOf("<CommunityDecisionDiscovery viewerId={viewerId} />"))
      .toBeLessThan(landing.indexOf("{communityMainNode}"));
  });

  it("fails out of the first viewport when no decision feed has loaded", () => {
    const discovery = source("src/components/community/CommunityDecisionDiscovery.tsx");

    expect(discovery).toContain('currentViewState.status === "error" && !hasEarlierFeed');
    expect(discovery).toContain("return null");
    expect(discovery).toContain("?mode=${activeMode}&limit=5");
  });
});
