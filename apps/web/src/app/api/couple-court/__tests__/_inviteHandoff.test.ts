import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COURT_INVITE_HANDOFF_COOKIE,
  courtInviteHandoffFromRequest,
  openCourtInviteHandoff,
  sealCourtInviteHandoff,
} from "../_inviteHandoff";

const TOKEN_HASH = "a".repeat(64);

describe("court invite authentication handoff", () => {
  beforeEach(() => {
    vi.stubEnv("COUPLE_COURT_INVITE_COOKIE_SECRET", "court-invite-cookie-test-secret-1234567890");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("round-trips only the token hash inside an authenticated ciphertext", () => {
    const sealed = sealCourtInviteHandoff(TOKEN_HASH, 1_000);
    expect(sealed).not.toContain(TOKEN_HASH);
    expect(openCourtInviteHandoff(sealed, 2_000)).toEqual({ tokenHash: TOKEN_HASH });
  });

  it("rejects tampering and expiry", () => {
    const sealed = sealCourtInviteHandoff(TOKEN_HASH, 1_000);
    const changed = `${sealed.slice(0, -1)}${sealed.endsWith("A") ? "B" : "A"}`;
    expect(() => openCourtInviteHandoff(changed, 2_000)).toThrow();
    expect(() => openCourtInviteHandoff(sealed, 1_000 + 10 * 60 * 1000 + 1)).toThrow();
  });

  it("reads only the exact HttpOnly handoff cookie name", () => {
    const request = new Request("https://hanbang.ai/api/couple-court/invites/accept", {
      headers: {
        Cookie: `other=value; ${COURT_INVITE_HANDOFF_COOKIE}=sealed.value; similarly_named_cookie=nope`,
      },
    });
    expect(courtInviteHandoffFromRequest(request)).toBe("sealed.value");
  });
});
