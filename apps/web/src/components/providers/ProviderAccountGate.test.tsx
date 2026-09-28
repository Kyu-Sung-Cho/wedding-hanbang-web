// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildSignupConsentServerEvidence } from "@hanbang/shared";

const mocks = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: mocks.getUser } }) }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));

import ProviderAccountGate from "./ProviderAccountGate";

const evidence = buildSignupConsentServerEvidence({ termsAgreed: true, privacyAgreed: true, ageOver14Confirmed: true, marketingAgreed: false, consentPolicyVersion: "2026-09-28" }, "2026-09-28T00:00:00.000Z");
const consentingAccount = { id: "member", email: "test@example.com", email_confirmed_at: "2026-09-28", app_metadata: { signup_consent: evidence } };

describe("provider account gate", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("preserves the registration destination when requesting login", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    await expect(ProviderAccountGate({ destination: "/business/register", children: "private form" }))
      .rejects.toThrow("redirect:/login?redirect=%2Fbusiness%2Fregister");
  });

  it("requires account consent without sending a provider to couple onboarding", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "member" } } });
    await expect(ProviderAccountGate({ destination: "/provider", children: "private center" }))
      .rejects.toThrow("redirect:/consent?redirect=%2Fprovider");
  });

  it("does not accept a legacy account or client-authored consent as server evidence", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { ...consentingAccount, created_at: "2026-01-01T00:00:00.000Z", app_metadata: {}, user_metadata: { signup_consent: evidence, terms_agreed: true, privacy_agreed: true } } } });
    await expect(ProviderAccountGate({ destination: "/provider", children: "private center" })).rejects.toThrow("redirect:/consent?redirect=%2Fprovider");
  });

  it("does not render the protected form for an unconfirmed email", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { ...consentingAccount, email_confirmed_at: null } } });
    expect(await ProviderAccountGate({ destination: "/business/inquiry", children: "private form" })).not.toBe("private form");
  });

  it("allows a confirmed consenting account without reading a couple profile", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: consentingAccount } });
    expect(await ProviderAccountGate({ destination: "/provider", children: "private center" })).toBe("private center");
  });
});
