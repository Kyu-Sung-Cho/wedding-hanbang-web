import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(process.cwd(), "../..");
const read = (relativePath: string) =>
  readFileSync(path.join(root, relativePath), "utf8");

const localConfig = read("supabase/config.toml");
const hostedPreflight = read("scripts/supabase-auth-config-preflight.mjs");
const hostedPreflightTests = read(
  "scripts/supabase-auth-config-preflight.test.mjs"
);
const releaseTargets = JSON.parse(read("scripts/release-targets.json"));
const ship = read("scripts/supabase-ship-safe.ps1");
const signupRoute = read("apps/web/src/app/api/auth/signup/route.ts");
const forgotPasswordRoute = read(
  "apps/web/src/app/api/auth/forgot-password/route.ts"
);
const preregisterRoute = read("apps/web/src/app/api/preregister/route.ts");
const surveyRoute = read("apps/web/src/app/api/survey/route.ts");
const adminAuthRoute = read("apps/web/src/app/api/admin/auth/route.ts");
const resetPage = read("apps/web/src/app/reset-password/page.tsx");
const loginPage = read("apps/web/src/app/(auth)/login/page.tsx");
const betaForm = read("apps/web/src/app/beta/BetaForm.tsx");
const surveyPage = read("apps/web/src/app/customersurvey/page.tsx");
const mobileLogin = read("apps/mobile/app/(auth)/login.tsx");
const turnstile = read("apps/web/src/lib/turnstile.ts");
const turnstileWidget = read(
  "apps/web/src/components/auth/TurnstileWidget.tsx"
);

describe("Supabase hosted Auth release gate", () => {
  it("keeps the local declarative config aligned with the general-user boundary", () => {
    const globalAuth = localConfig.slice(
      localConfig.indexOf("[auth]"),
      localConfig.indexOf("[auth.rate_limit]")
    );
    const emailAuth = localConfig.slice(
      localConfig.indexOf("[auth.email]"),
      localConfig.indexOf("[auth.sms]")
    );
    const smsAuth = localConfig.slice(localConfig.indexOf("[auth.sms]"));
    expect(globalAuth).toContain("enable_signup = false");
    expect(emailAuth).toContain("enable_signup = true");
    expect(smsAuth).toContain("enable_signup = false");
    expect(localConfig).toContain("minimum_password_length = 8");
    expect(localConfig).toContain(
      'password_requirements = "lower_upper_letters_digits_symbols"'
    );
    expect(localConfig).toContain("enable_confirmations = true");
    expect(localConfig).toContain("secure_password_change = true");
  });

  it("attests the hosted mutable settings read-only and never accepts a write flag", () => {
    expect(hostedPreflight).toContain(
      '"direct-signup-disabled-general-password-v1"'
    );
    expect(hostedPreflight).toContain("config.disable_signup === true");
    expect(hostedPreflight).toContain("config.password_min_length === GENERAL_PASSWORD_MIN_LENGTH");
    expect(hostedPreflight).toContain(
      "config.password_required_characters ==="
    );
    expect(hostedPreflight).toContain(
      "config.site_url === expected.redirectTokenPolicy.canonicalSiteUrl"
    );
    expect(hostedPreflight).toContain(
      "arraysEqual(actualRedirectUrls, expected.additionalRedirectUrls)"
    );
    expect(hostedPreflight).toContain(
      "config.jwt_exp === expected.redirectTokenPolicy.jwtExpirySeconds"
    );
    expect(hostedPreflight).toContain(
      "config.refresh_token_rotation_enabled ==="
    );
    expect(hostedPreflight).toContain(
      "config.security_refresh_token_reuse_interval ==="
    );
    expect(hostedPreflight).toContain(
      "config.mailer_otp_length === expected.redirectTokenPolicy.emailOtpLength"
    );
    expect(hostedPreflight).toContain(
      "config.mailer_otp_exp === expected.redirectTokenPolicy.emailOtpExpirySeconds"
    );
    expect(hostedPreflight).toContain("config.rate_limit_email_sent ===");
    expect(hostedPreflight).toContain("config.rate_limit_token_refresh ===");
    expect(hostedPreflight).toContain("config.rate_limit_otp ===");
    expect(hostedPreflight).toContain("config.rate_limit_verify ===");
    expect(hostedPreflight).toContain(
      "/^external_([a-z0-9_]+)_enabled$/"
    );
    expect(hostedPreflight).toContain('method: "GET"');
    expect(hostedPreflight).not.toContain('method: "PATCH"');
    expect(hostedPreflight).not.toContain('method: "POST"');
    expect(hostedPreflightTests).toContain('"--write"');
    expect(hostedPreflightTests).toContain(
      "attests the exact hosted redirect, token, rate-limit, and OAuth boundary"
    );
    expect(hostedPreflightTests).toContain("prints only project identity and boolean evidence");
  });

  it("binds initial and immediate pre-push checks to the reviewed release artifacts", () => {
    expect(ship).toContain(
      '(Resolve-Path "scripts/supabase-auth-config-preflight.mjs").Path'
    );
    const initial = ship.indexOf('Invoke-Step "Exact hosted Auth config preflight"');
    const immediate = ship.indexOf(
      'Invoke-Step "Immediate hosted Auth config recheck"'
    );
    const push = ship.indexOf('Invoke-Step "Push pending migrations"');
    expect(initial).toBeGreaterThanOrEqual(0);
    expect(immediate).toBeGreaterThan(initial);
    expect(push).toBeGreaterThan(immediate);
  });

  it("does not conflate consumer signup policy with the role-aware admin policy", () => {
    expect(signupRoute).toContain("isStrongPassword(password)");
    expect(signupRoute).toContain("const turnstile = await verifyTurnstile(");
    expect(signupRoute).toMatch(/getClientIp\(request\),\r?\n\s+"signup"/);
    expect(forgotPasswordRoute).toMatch(
      /getClientIp\(request\),\r?\n\s+"forgot_password"/
    );
    expect(preregisterRoute).toMatch(
      /getClientIp\(request\),\r?\n\s+"preregister"/
    );
    expect(surveyRoute).toMatch(/getClientIp\(request\),\r?\n\s+"survey"/);
    expect(adminAuthRoute).toContain("value.length >= 12");
    expect(adminAuthRoute.match(/isStrongAdminPassword\(/g)?.length).toBeGreaterThanOrEqual(3);
    expect(resetPage).toContain("supabase.auth.updateUser");
    expect(resetPage).toContain('label: "8자 이상"');

    expect(releaseTargets.productionSupabaseAuthConfigContract).toBe(
      "direct-signup-disabled-general-password-v1"
    );
    expect(releaseTargets.productionSupabasePublicEmailBoundary).toEqual({
      status: "blocked-hosted-native-email-bypass",
      contract: "hosted-public-email-boundary-v1",
      approvedMode: null,
    });
    expect(releaseTargets.productionSupabaseRedirectTokenPolicy).toEqual({
      status: "not_attested",
      contract: "hosted-auth-redirect-token-v1",
      canonicalSiteUrl: "https://hanbang.ai",
      exactAdditionalRedirectUrls: [],
      jwtExpirySeconds: 3600,
      refreshTokenRotation: true,
      refreshTokenReuseSeconds: 10,
      emailOtpLength: 6,
      emailOtpExpirySeconds: 3600,
      rateLimits: {
        emailSentPerHour: 2,
        tokenRefreshPerFiveMinutesPerIp: 150,
        signInSignUpsPerFiveMinutesPerIp: 30,
        tokenVerificationsPerFiveMinutesPerIp: 30,
      },
    });
    expect(releaseTargets.productionOAuthProviderContract).toEqual({
      status: "not_attested",
      contract: "verified-visible-oauth-providers-v1",
      visibleProviders: [],
    });
    expect(releaseTargets.productionTurnstileBoundary).toEqual({
      status: "not_configured",
      contract: "siteverify-hostname-action-v1",
      canonicalHostname: "hanbang.ai",
      requiredActions: [
        "signup",
        "forgot_password",
        "preregister",
        "survey",
      ],
    });
    expect(releaseTargets.productionAdminPasswordLifecycle).toEqual({
      status: "blocked-role-aware-provider-gap",
      contract: "role-aware-admin-password-v1",
      minimumLength: 12,
    });
    expect(ship).toContain(
      "admin creation, recovery, and authenticated password updates enforce the role-aware 12-character policy"
    );
    expect(ship).toContain(
      "public GoTrue recovery, resend, magic-link, and OTP email paths cannot bypass"
    );
    expect(ship).toContain(
      "every visible OAuth provider and redirect round-trip is independently attested"
    );
    expect(ship).toContain(
      "all four hostname/action-bound Siteverify flows are independently attested"
    );
  });

  it("hides unverified OAuth controls and never reflects provider details to users", () => {
    for (const provider of ["KAKAO", "GOOGLE", "APPLE"]) {
      expect(loginPage).toContain(
        `process.env.NEXT_PUBLIC_OAUTH_${provider}_ENABLED === "true"`
      );
    }
    expect(loginPage).toContain("HAS_VERIFIED_OAUTH_PROVIDER &&");
    expect(
      loginPage.match(/inline-flex min-h-11 items-center px-2/g)?.length
    ).toBeGreaterThanOrEqual(4);
    expect(loginPage).toContain(
      'href="/wedding" className="inline-flex min-h-11 items-center px-3'
    );
    expect(loginPage).not.toContain("setError(signInError.message)");
    expect(loginPage).not.toContain("setError(`소셜 로그인 오류:");
    expect(loginPage).not.toContain("setError(`오류:");
    expect(mobileLogin).toContain("<Text style={styles.fieldHint}>8자 이상</Text>");
  });

  it("fails email surfaces closed and binds Turnstile tokens to hostname and action", () => {
    expect(loginPage).toContain("EMAIL_DELIVERY_ACTIONS_AVAILABLE");
    expect(loginPage).toContain("!EMAIL_DELIVERY_ACTIONS_AVAILABLE");
    expect(loginPage).toContain(
      'action={mode === "signup" ? "signup" : "forgot_password"}'
    );
    expect(turnstileWidget).toContain("action: TurnstileAction");
    expect(turnstileWidget).toContain("action,");
    expect(turnstileWidget).toContain("api.js?render=explicit");
    expect(turnstileWidget).toContain('size: "flexible"');
    expect(turnstileWidget).toContain("보안 확인 다시 시도");
    expect(turnstile).toContain(
      "data.hostname?.toLowerCase() === PRODUCTION_TURNSTILE_HOSTNAME"
    );
    expect(turnstile).toContain("data.action === expectedAction");
    expect(turnstile).toContain("token.length > 2048");
    expect(betaForm).toContain("setTurnstileAttempt((attempt) => attempt + 1)");
    expect(betaForm).toContain('key={`preregister-${turnstileAttempt}`}');
    expect(surveyPage).toContain("setTurnstileAttempt((attempt) => attempt + 1)");
    expect(surveyPage).toContain('key={`survey-${turnstileAttempt}`}');
    expect(ship).toContain("$status.turnstileCredentialsConfigured -ne $true");
    expect(ship).toContain(
      "$status.turnstileCanonicalHostnameConfigured -ne $true"
    );
    expect(ship).toContain("$status.turnstileConfigured -ne $true");
  });
});
