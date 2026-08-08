import { beforeEach, describe, expect, it } from "vitest";

import { withSessionCache } from "./sessionCache";

describe("withSessionCache ownership guard", () => {
  beforeEach(() => sessionStorage.clear());

  it("does not repopulate a purged A cache when A's request finishes after a switch", async () => {
    const key = "community:viewer:user-a:trending";
    let currentViewer = "user-a";
    let resolveFetch: ((value: { title: string }) => void) | undefined;

    const pending = withSessionCache(
      key,
      60_000,
      () => new Promise((resolve) => { resolveFetch = resolve; }),
      { shouldCache: () => currentViewer === "user-a" },
    );
    currentViewer = "user-b";
    sessionStorage.removeItem(key);
    resolveFetch?.({ title: "A private title" });

    await expect(pending).resolves.toEqual({ title: "A private title" });
    expect(sessionStorage.getItem(key)).toBeNull();
  });
});
