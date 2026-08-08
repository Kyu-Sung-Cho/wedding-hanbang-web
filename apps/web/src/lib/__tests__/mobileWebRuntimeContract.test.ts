import { describe, expect, it } from "vitest";

import {
  MOBILE_WEB_REQUIRED_CAPABILITIES,
  buildMobileWebRuntimeContract,
  getSupabaseProjectRef,
  validateMobileWebRuntimeContract,
} from "@hanbang/shared";

const SUPABASE_URL = "https://abcdefghijklmnopqrst.supabase.co";

describe("mobile/web runtime contract", () => {
  it("extracts only a strict hosted Supabase project destination", () => {
    expect(getSupabaseProjectRef(SUPABASE_URL)).toBe("abcdefghijklmnopqrst");
    expect(getSupabaseProjectRef("https://abcdefghijklmnopqrst.supabase.co.evil.test")).toBeNull();
    expect(getSupabaseProjectRef("https://unexpected.example.com")).toBeNull();
  });

  it("accepts the exact web destination and every required capability", () => {
    const contract = buildMobileWebRuntimeContract(SUPABASE_URL);

    expect(contract).not.toBeNull();
    expect(validateMobileWebRuntimeContract(contract, SUPABASE_URL)).toEqual({
      ok: true,
      contract,
    });
  });

  it("fails closed when the app and web point at different projects", () => {
    const contract = buildMobileWebRuntimeContract(SUPABASE_URL);

    expect(validateMobileWebRuntimeContract(
      contract,
      "https://zyxwvutsrqponmlkjihg.supabase.co",
    )).toEqual({ ok: false, reason: "destination" });
  });

  it("fails closed when the web bridge loses a required capability", () => {
    const contract = buildMobileWebRuntimeContract(SUPABASE_URL);
    expect(contract).not.toBeNull();

    expect(validateMobileWebRuntimeContract(
      {
        ...contract,
        capabilities: MOBILE_WEB_REQUIRED_CAPABILITIES.slice(0, -1),
      },
      SUPABASE_URL,
    )).toEqual({ ok: false, reason: "capability" });
  });
});
