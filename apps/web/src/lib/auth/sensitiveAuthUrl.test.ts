import { beforeEach, describe, expect, it } from "vitest";

import {
  captureAndClearSensitiveAuthUrl,
  consumePendingLoginError,
  consumePendingMobileOAuthCode,
  consumePendingPasswordRecovery,
} from "./sensitiveAuthUrl";

describe("sensitive auth callback URL handling", () => {
  beforeEach(() => {
    consumePendingLoginError();
    consumePendingMobileOAuthCode();
    consumePendingPasswordRecovery();
    window.history.replaceState({}, "", "/");
  });

  it("scrubs ordinary session credentials without granting recovery authority", () => {
    window.history.replaceState(
      {},
      "",
      "/reset-password?redirect=%2Fadmin%2Flogin#access_token=access-marker&refresh_token=refresh-marker&type=recovery",
    );

    captureAndClearSensitiveAuthUrl();

    expect(window.location.href).toBe(
      "http://localhost:3000/reset-password?redirect=%2Fadmin%2Flogin",
    );
    expect(consumePendingPasswordRecovery()).toBeNull();
  });

  it("keeps only a one-time hashed recovery token in memory", () => {
    window.history.replaceState(
      {},
      "",
      "/reset-password?redirect=%2Fadmin%2Flogin#token_hash=hashed-marker&type=recovery",
    );

    captureAndClearSensitiveAuthUrl();

    expect(window.location.href).toBe(
      "http://localhost:3000/reset-password?redirect=%2Fadmin%2Flogin",
    );
    expect(consumePendingPasswordRecovery()).toEqual({
      kind: "token_hash",
      tokenHash: "hashed-marker",
    });
    expect(consumePendingPasswordRecovery()).toBeNull();
  });

  it("keeps a mobile PKCE code only until the callback consumes it", () => {
    window.history.replaceState(
      {},
      "",
      "/auth/mobile-callback?code=one-time-marker&from=google",
    );

    captureAndClearSensitiveAuthUrl();

    expect(window.location.href).toBe(
      "http://localhost:3000/auth/mobile-callback?from=google",
    );
    expect(consumePendingMobileOAuthCode()).toBe("one-time-marker");
    expect(consumePendingMobileOAuthCode()).toBeNull();
  });

  it("does not remove ordinary code parameters from unrelated product routes", () => {
    window.history.replaceState({}, "", "/signup?code=campaign-code");

    captureAndClearSensitiveAuthUrl();

    expect(window.location.search).toBe("?code=campaign-code");
  });

  it("scrubs login provider errors and callback secrets while retaining only an error flag", () => {
    window.history.replaceState(
      {},
      "",
      "/login?mode=login&error=oauth_error&error_code=provider_error#error_description=bride%40example.com%20token%3Dprivate-marker&state=state-marker",
    );

    captureAndClearSensitiveAuthUrl();

    expect(window.location.href).toBe(
      "http://localhost:3000/login?mode=login",
    );
    expect(window.location.href).not.toContain("bride%40example.com");
    expect(window.location.href).not.toContain("private-marker");
    expect(window.location.href).not.toContain("state-marker");
    expect(consumePendingLoginError()).toBe(true);
    expect(consumePendingLoginError()).toBe(false);
  });

  it("scrubs provider errors from the demo login route without removing safe navigation state", () => {
    window.history.replaceState(
      {},
      "",
      "/demo/login?redirect=%2Fwedding%2Flounge&error_description=private-marker",
    );

    captureAndClearSensitiveAuthUrl();

    expect(window.location.href).toBe(
      "http://localhost:3000/demo/login?redirect=%2Fwedding%2Flounge",
    );
    expect(consumePendingLoginError()).toBe(true);
  });

  it("fails closed when callback credentials reach a login route without an error description", () => {
    window.history.replaceState(
      {},
      "",
      "/login?mode=login&code=one-time-marker&state=state-marker&client_secret=client-secret-marker",
    );

    captureAndClearSensitiveAuthUrl();

    expect(window.location.href).toBe(
      "http://localhost:3000/login?mode=login",
    );
    expect(window.location.href).not.toContain("client-secret-marker");
    expect(consumePendingLoginError()).toBe(true);
    expect(consumePendingMobileOAuthCode()).toBeNull();
  });
});
