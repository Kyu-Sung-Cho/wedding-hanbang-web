import { describe, expect, it } from "vitest";

import { assertPreviewStubDeployment } from "./previewStubConfig";

describe("assertPreviewStubDeployment", () => {
  it("blocks a production build when preview stub mode is enabled", () => {
    expect(() =>
      assertPreviewStubDeployment({
        VERCEL_ENV: "production",
        NEXT_PUBLIC_PREVIEW_STUB_MODE: "true",
      })
    ).toThrow("NEXT_PUBLIC_PREVIEW_STUB_MODE must never be enabled in Production");
  });

  it("allows the explicit stub in Preview", () => {
    expect(() =>
      assertPreviewStubDeployment({
        VERCEL_ENV: "preview",
        NEXT_PUBLIC_PREVIEW_STUB_MODE: "true",
      })
    ).not.toThrow();
  });

  it("allows a normal production build", () => {
    expect(() =>
      assertPreviewStubDeployment({
        VERCEL_ENV: "production",
        NEXT_PUBLIC_PREVIEW_STUB_MODE: "false",
      })
    ).not.toThrow();
  });
});
