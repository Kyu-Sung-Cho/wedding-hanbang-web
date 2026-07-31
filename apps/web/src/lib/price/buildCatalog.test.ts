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

  it("uses an empty catalog for the explicit Vercel Preview stub without opening Supabase", async () => {
    const loader = vi.fn().mockRejectedValue(new Error("preview must not open Supabase"));
    const catalog = await loadPriceCatalogWithBuildFallback(loader, {
      CI: "false",
      VERCEL_ENV: "preview",
      NEXT_PUBLIC_PREVIEW_STUB_MODE: "true",
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
    });

    expect(loader).not.toHaveBeenCalled();
    expect(catalog.counts).toEqual({ studio: 0, dress: 0, makeup: 0, hall: 0 });
    expect(catalog.agencies).toEqual([]);
  });

  it("uses an empty catalog for the explicit synthetic local environment", async () => {
    const loader = vi.fn().mockRejectedValue(new Error("local preview must not open Supabase"));
    const catalog = await loadPriceCatalogWithBuildFallback(loader, {
      CI: "false",
      HANBANG_SYNTHETIC_SUPABASE_ENVIRONMENT: "true",
      NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
    });

    expect(loader).not.toHaveBeenCalled();
    expect(catalog.counts).toEqual({ studio: 0, dress: 0, makeup: 0, hall: 0 });
    expect(catalog.agencies).toEqual([]);
  });

  it("does not let the synthetic marker hide a real deployment failure", async () => {
    const loader = vi.fn().mockRejectedValue(new Error("database unavailable"));

    await expect(loadPriceCatalogWithBuildFallback(loader, {
      HANBANG_SYNTHETIC_SUPABASE_ENVIRONMENT: "true",
      NEXT_PUBLIC_SUPABASE_URL: "https://sampleprojectref1234.supabase.co",
    })).rejects.toThrow("database unavailable");

    expect(loader).toHaveBeenCalledOnce();
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
