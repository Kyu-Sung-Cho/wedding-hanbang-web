// @vitest-environment node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd(), "../..");
const migrationFile = "20260802158000_gate_new_auth_users_on_signup_consent.sql";
const migrationPath = resolve(repoRoot, "supabase/migrations", migrationFile);
const migration = readFileSync(migrationPath, "utf8");
const config = readFileSync(resolve(repoRoot, "supabase/config.toml"), "utf8");
const manifest = JSON.parse(readFileSync(
  resolve(repoRoot, "supabase/release-manifests/vendor-disclosure-v2-20260718.json"),
  "utf8",
)) as { expandMigrations: Array<{ file: string; sha256: string }> };

const EMAIL = "bride@example.test";
const OTHER_EMAIL = "groom@example.test";
const TOKEN = "A".repeat(43);
const OTHER_TOKEN = "B".repeat(43);
const USER_ID = "10000000-0000-4000-8000-000000000001";

function canonicalSha256(text: string) {
  return createHash("sha256")
    .update(text.replace(/\r\n?/g, "\n"), "utf8")
    .digest("hex");
}

async function createDatabase() {
  const db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE ROLE supabase_auth_admin NOLOGIN;

    CREATE SCHEMA auth;
    CREATE SCHEMA extensions;
    CREATE EXTENSION pgcrypto SCHEMA extensions;

    CREATE FUNCTION auth.role()
    RETURNS text
    LANGUAGE sql
    STABLE
    AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.role', true), '')::text
    $$;
    GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role,
      supabase_auth_admin;
    GRANT EXECUTE ON FUNCTION auth.role() TO PUBLIC;
  `);
  await db.exec(migration);
  return db;
}

async function setPersona(
  db: PGlite,
  role: "anon" | "authenticated" | "service_role" | "supabase_auth_admin",
) {
  await db.exec(`SET ROLE ${role}`);
  await db.query("SELECT set_config('request.jwt.claim.role', $1, false)", [role]);
}

async function resetPersona(db: PGlite) {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.role', '', false)");
}

async function issueIntent(
  db: PGlite,
  email = EMAIL,
  token = TOKEN,
  termsVersion = "2026-08-02",
  privacyVersion = "2026-08-02",
) {
  return db.query<{ issued: boolean }>(
    `SELECT public.issue_signup_consent_intent($1, $2, $3, $4, $5) AS issued`,
    [email, token, termsVersion, privacyVersion, false],
  );
}

function signupEvent(options: {
  email?: string;
  token?: string | null;
  provider?: string;
  userId?: string;
  metadataName?: string;
} = {}) {
  const token = options.token === undefined ? TOKEN : options.token;
  return {
    metadata: {
      name: options.metadataName ?? "before-user-created",
      uuid: "request-id",
    },
    user: {
      id: options.userId ?? USER_ID,
      email: options.email ?? EMAIL,
      is_anonymous: false,
      app_metadata: {
        provider: options.provider ?? "email",
        providers: [options.provider ?? "email"],
      },
      user_metadata: token === null
        ? { name: "Sample User" }
        : { name: "Sample User", signup_consent_intent: token },
    },
  };
}

async function invokeHook(db: PGlite, event: ReturnType<typeof signupEvent>) {
  return db.query<{ result: Record<string, unknown> }>(
    "SELECT public.before_user_created_consent_hook($1::jsonb) AS result",
    [JSON.stringify(event)],
  );
}

describe("signup consent Before User Created auth hook migration", () => {
  it("pins and enables the exact Postgres auth-hook contract", () => {
    expect(config).toMatch(/\[auth\.hook\.before_user_created\]\s+enabled\s*=\s*true\s+uri\s*=\s*"pg-functions:\/\/postgres\/public\/before_user_created_consent_hook"/);
    expect(config).not.toMatch(
      /\[auth\.hook\.custom_access_token\]\s+enabled\s*=\s*true/,
    );

    const pin = manifest.expandMigrations.find((entry) => entry.file === migrationFile);
    expect(pin).toEqual({
      file: migrationFile,
      sha256: canonicalSha256(migration),
    });
    const pinIndex = manifest.expandMigrations.findIndex(
      (entry) => entry.file === migrationFile,
    );
    const successorIndex = manifest.expandMigrations.findIndex(
      (entry) => entry.file === "20260802160000_require_vendor_staff_publication_consent.sql",
    );
    expect(pinIndex).toBeGreaterThanOrEqual(0);
    expect(successorIndex).toBeGreaterThan(pinIndex);
  });

  it("stores only fixed-length digests and denies table or issuer access to untrusted roles", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      const issued = await issueIntent(db);
      expect(issued.rows[0]?.issued).toBe(true);
      await expect(db.query("SELECT * FROM public.signup_consent_intents"))
        .rejects.toThrow(/permission denied/i);

      await resetPersona(db);
      const stored = await db.query<{
        token_digest_hex: string;
        email_token_digest_hex: string;
        terms_version: string;
        privacy_version: string;
      }>(`
        SELECT
          encode(token_digest, 'hex') AS token_digest_hex,
          encode(email_token_digest, 'hex') AS email_token_digest_hex,
          terms_version,
          privacy_version
        FROM public.signup_consent_intents
      `);
      expect(stored.rows).toHaveLength(1);
      expect(stored.rows[0]?.token_digest_hex).toMatch(/^[a-f0-9]{64}$/);
      expect(stored.rows[0]?.email_token_digest_hex).toMatch(/^[a-f0-9]{64}$/);
      expect(JSON.stringify(stored.rows[0])).not.toContain(EMAIL);
      expect(JSON.stringify(stored.rows[0])).not.toContain(TOKEN);
      expect(stored.rows[0]).toMatchObject({
        terms_version: "2026-08-02",
        privacy_version: "2026-08-02",
      });

      const acl = await db.query<{
        anon_table: boolean;
        authenticated_table: boolean;
        service_table: boolean;
        auth_admin_table: boolean;
        anon_issue: boolean;
        authenticated_issue: boolean;
        service_issue: boolean;
        auth_admin_issue: boolean;
        service_revoke: boolean;
        auth_admin_revoke: boolean;
        service_hook: boolean;
        auth_admin_hook: boolean;
      }>(`
        SELECT
          has_table_privilege('anon', 'public.signup_consent_intents', 'SELECT') AS anon_table,
          has_table_privilege('authenticated', 'public.signup_consent_intents', 'SELECT') AS authenticated_table,
          has_table_privilege('service_role', 'public.signup_consent_intents', 'SELECT') AS service_table,
          has_table_privilege('supabase_auth_admin', 'public.signup_consent_intents', 'SELECT') AS auth_admin_table,
          has_function_privilege('anon', 'public.issue_signup_consent_intent(text,text,text,text,boolean)', 'EXECUTE') AS anon_issue,
          has_function_privilege('authenticated', 'public.issue_signup_consent_intent(text,text,text,text,boolean)', 'EXECUTE') AS authenticated_issue,
          has_function_privilege('service_role', 'public.issue_signup_consent_intent(text,text,text,text,boolean)', 'EXECUTE') AS service_issue,
          has_function_privilege('supabase_auth_admin', 'public.issue_signup_consent_intent(text,text,text,text,boolean)', 'EXECUTE') AS auth_admin_issue,
          has_function_privilege('service_role', 'public.revoke_signup_consent_intent(text)', 'EXECUTE') AS service_revoke,
          has_function_privilege('supabase_auth_admin', 'public.revoke_signup_consent_intent(text)', 'EXECUTE') AS auth_admin_revoke,
          has_function_privilege('service_role', 'public.before_user_created_consent_hook(jsonb)', 'EXECUTE') AS service_hook,
          has_function_privilege('supabase_auth_admin', 'public.before_user_created_consent_hook(jsonb)', 'EXECUTE') AS auth_admin_hook
      `);
      expect(acl.rows[0]).toEqual({
        anon_table: false,
        authenticated_table: false,
        service_table: false,
        auth_admin_table: false,
        anon_issue: false,
        authenticated_issue: false,
        service_issue: true,
        auth_admin_issue: false,
        service_revoke: true,
        auth_admin_revoke: false,
        service_hook: false,
        auth_admin_hook: true,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("atomically consumes one matching email intent and rejects replay", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      await issueIntent(db);
      await resetPersona(db);
      await setPersona(db, "supabase_auth_admin");

      const first = await invokeHook(db, signupEvent());
      expect(first.rows[0]?.result).toEqual({});
      const replay = await invokeHook(db, signupEvent());
      expect(replay.rows[0]?.result).toEqual({
        error: { http_code: 403, message: "Signup is not permitted." },
      });

      await resetPersona(db);
      const retained = await db.query<{ count: number }>(`
        SELECT count(*)::integer AS count
        FROM public.signup_consent_intents
      `);
      expect(retained.rows[0]?.count).toBe(0);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("lets only the service role immediately revoke an unused intent", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      await issueIntent(db);
      const first = await db.query<{ revoked: boolean }>(
        "SELECT public.revoke_signup_consent_intent($1) AS revoked",
        [TOKEN],
      );
      const replay = await db.query<{ revoked: boolean }>(
        "SELECT public.revoke_signup_consent_intent($1) AS revoked",
        [TOKEN],
      );
      expect(first.rows[0]?.revoked).toBe(true);
      expect(replay.rows[0]?.revoked).toBe(false);

      await resetPersona(db);
      await setPersona(db, "supabase_auth_admin");
      expect((await invokeHook(db, signupEvent())).rows[0]?.result)
        .toHaveProperty("error");
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("rejects direct signup, OAuth creation, email mismatch, expiry, and stale policy versions", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      await issueIntent(db);
      await issueIntent(db, EMAIL, OTHER_TOKEN);
      await expect(issueIntent(db, OTHER_EMAIL, "C".repeat(43), "2026-07-17"))
        .rejects.toThrow(/signup_consent_policy_version_invalid/i);
      await resetPersona(db);
      await db.query(
        `UPDATE public.signup_consent_intents
         SET issued_at = statement_timestamp() - interval '20 minutes',
             expires_at = statement_timestamp() - interval '1 second'
         WHERE token_digest = extensions.digest(convert_to($1, 'UTF8'), 'sha256')`,
        [OTHER_TOKEN],
      );
      await setPersona(db, "supabase_auth_admin");

      for (const event of [
        signupEvent({ token: null }),
        signupEvent({ provider: "google" }),
        signupEvent({ provider: "apple" }),
        signupEvent({ provider: "kakao" }),
        signupEvent({ email: OTHER_EMAIL }),
        signupEvent({ token: OTHER_TOKEN }),
        signupEvent({ metadataName: "custom-access-token" }),
      ]) {
        const response = await invokeHook(db, event);
        expect(response.rows[0]?.result).toEqual({
          error: { http_code: 403, message: "Signup is not permitted." },
        });
      }
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("is replay-safe without reviving a consumed token or broadening grants", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      await issueIntent(db);
      await resetPersona(db);
      await setPersona(db, "supabase_auth_admin");
      expect((await invokeHook(db, signupEvent())).rows[0]?.result).toEqual({});
      await resetPersona(db);

      await db.exec(migration);
      await setPersona(db, "supabase_auth_admin");
      expect((await invokeHook(db, signupEvent())).rows[0]?.result).toHaveProperty("error");
      await expect(db.query("SELECT * FROM public.signup_consent_intents"))
        .rejects.toThrow(/permission denied/i);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);
});
