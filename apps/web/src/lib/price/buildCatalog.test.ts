import { describe, expect, it, vi } from "vitest";

import {
  loadPriceCatalogWithBuildFallback,
} from "./buildCatalog";

describe("price catalog build fallback", () => {
  it("uses an empty catalog only for the explicit repository CI placeholder", async () => {
    const loader = vi.fn().mockRejectedValue(new Error("network must not run"));
    const catalog = await loadPriceCatalogWithBuildFallback(loader, {
      CI: "true",
      NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
    });

    expect(loader).not.toHaveBeenCalled();
    expect(catalog.counts).toEqual({ studio: 0, dress: 0, makeup: 0, hall: 0 });
  });

  it.each([
    {},
    {
      CI: "false",
      NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
    },
  ])("never hides missing deployment configuration as a valid empty catalog", async (env) => {
    const loader = vi.fn().mockRejectedValue(new Error("deployment configuration missing"));
    await expect(loadPriceCatalogWithBuildFallback(loader, env))
      .rejects.toThrow("deployment configuration missing");
    expect(loader).toHaveBeenCalledOnce();
  });

  it("keeps a real deployment fail-closed when public data is unavailable", async () => {
    const loader = vi.fn().mockRejectedValue(new Error("database unavailable"));
    await expect(loadPriceCatalogWithBuildFallback(loader, {
      NEXT_PUBLIC_SUPABASE_URL: "https://sampleprojectref1234.supabase.co",
    })).rejects.toThrow("database unavailable");
    expect(loader).toHaveBeenCalledOnce();
  });
});
