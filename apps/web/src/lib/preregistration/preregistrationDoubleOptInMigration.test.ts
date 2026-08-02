// @vitest-environment node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd(), "../..");
const migrationFile = "20260803102000_preregistration_double_opt_in.sql";
const migration = readFileSync(
  resolve(repoRoot, "supabase/migrations", migrationFile),
  "utf8",
);
const manifest = JSON.parse(readFileSync(
  resolve(repoRoot, "supabase/release-manifests/vendor-disclosure-v2-20260718.json"),
  "utf8",
)) as { expandMigrations: Array<{ file: string; sha256: string }> };

const TOKEN_A = "A".repeat(43);
const TOKEN_B = "B".repeat(43);
const EMAIL_LOOKUP = createHash("sha256").update("email-lookup").digest("hex");
const OTHER_LOOKUP = createHash("sha256").update("other-email").digest("hex");
const ENVELOPE = `v1.${"I".repeat(16)}.${"T".repeat(22)}.${"C".repeat(32)}`;

function digest(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

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
    GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.role() TO PUBLIC;

    CREATE TABLE public.preregistrations (
      id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
      email text NOT NULL UNIQUE,
      name text,
      wedding_date text,
      source text DEFAULT 'web',
      utm_source text,
      utm_medium text,
      utm_campaign text,
      role text,
      message text,
      is_beta_candidate boolean DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT pg_catalog.statement_timestamp()
    );
    ALTER TABLE public.preregistrations ENABLE ROW LEVEL SECURITY;
    CREATE POLICY prereg_service_all ON public.preregistrations
      FOR ALL TO service_role USING (true) WITH CHECK (true);
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.preregistrations TO service_role;
  `);
  await db.exec(migration);
  return db;
}

async function setPersona(
  db: PGlite,
  role: "anon" | "authenticated" | "service_role",
) {
  await db.exec(`SET ROLE ${role}`);
  await db.query("SELECT set_config('request.jwt.claim.role', $1, false)", [role]);
}

async function resetPersona(db: PGlite) {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.role', '', false)");
}

async function issue(
  db: PGlite,
  token = TOKEN_A,
  emailLookup = EMAIL_LOOKUP,
) {
  return db.query<{ issued: boolean }>(
    `SELECT public.issue_preregistration_intent($1, $2, $3, $4, $5) AS issued`,
    [digest(token), emailLookup, ENVELOPE, "2026-08-02", true],
  );
}

async function confirm(db: PGlite, token = TOKEN_A, email = "person@example.com") {
  return db.query<{ result: string }>(`
    SELECT public.confirm_preregistration_intent(
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
    ) AS result
  `, [
    digest(token),
    EMAIL_LOOKUP,
    email,
    "김한방",
    "2026-12-20",
    "bride",
    "베타에 참여하고 싶어요.",
    true,
    "naver",
    "social",
    "launch_2026",
    "2026-08-02",
  ]);
}

describe("preregistration double-opt-in migration", () => {
  it("is SHA-pinned in the ordered successor release manifest", () => {
    const pin = manifest.expandMigrations.find((entry) => entry.file === migrationFile);
    expect(pin).toEqual({ file: migrationFile, sha256: canonicalSha256(migration) });
    const pinIndex = manifest.expandMigrations.findIndex((entry) => entry.file === migrationFile);
    const predecessorIndex = manifest.expandMigrations.findIndex((entry) =>
      entry.file === "20260803101000_require_customer_survey_consent_evidence.sql"
    );
    expect(pinIndex).toBeGreaterThan(predecessorIndex);
  });

  it("stores only digests plus ciphertext and denies direct table access", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      expect((await issue(db)).rows[0]?.issued).toBe(true);
      await expect(db.query("SELECT * FROM public.preregistration_intents"))
        .rejects.toThrow(/permission denied/i);

      await resetPersona(db);
      const stored = await db.query<{
        token_digest: string;
        email_lookup_digest: string;
        payload_envelope: string;
        ttl_seconds: number;
      }>(`
        SELECT
          encode(token_digest, 'hex') AS token_digest,
          encode(email_lookup_digest, 'hex') AS email_lookup_digest,
          payload_envelope,
          extract(epoch FROM (expires_at - issued_at))::integer AS ttl_seconds
        FROM public.preregistration_intents
      `);
      expect(stored.rows).toEqual([{
        token_digest: digest(TOKEN_A),
        email_lookup_digest: EMAIL_LOOKUP,
        payload_envelope: ENVELOPE,
        ttl_seconds: 1800,
      }]);
      expect(JSON.stringify(stored.rows)).not.toContain("person@example.com");
      expect(JSON.stringify(stored.rows)).not.toContain(TOKEN_A);

      const access = await db.query<{
        anon_table: boolean;
        authenticated_table: boolean;
        service_table: boolean;
        anon_confirm: boolean;
        service_confirm: boolean;
        forced_rls: boolean;
        policy_count: number;
      }>(`
        SELECT
          has_table_privilege('anon', 'public.preregistration_intents', 'SELECT') AS anon_table,
          has_table_privilege('authenticated', 'public.preregistration_intents', 'SELECT') AS authenticated_table,
          has_table_privilege('service_role', 'public.preregistration_intents', 'SELECT') AS service_table,
          has_function_privilege(
            'anon',
            'public.confirm_preregistration_intent(text,text,text,text,text,text,text,boolean,text,text,text,text)',
            'EXECUTE'
          ) AS anon_confirm,
          has_function_privilege(
            'service_role',
            'public.confirm_preregistration_intent(text,text,text,text,text,text,text,boolean,text,text,text,text)',
            'EXECUTE'
          ) AS service_confirm,
          (SELECT relrowsecurity AND relforcerowsecurity
             FROM pg_catalog.pg_class
            WHERE oid = 'public.preregistration_intents'::regclass) AS forced_rls,
          (SELECT count(*)::integer
             FROM pg_catalog.pg_policy
            WHERE polrelid = 'public.preregistration_intents'::regclass) AS policy_count
      `);
      expect(access.rows[0]).toEqual({
        anon_table: false,
        authenticated_table: false,
        service_table: false,
        anon_confirm: false,
        service_confirm: true,
        forced_rls: true,
        policy_count: 0,
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("revokes an older token on reissue and atomically promotes exactly once", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      await issue(db, TOKEN_A);
      await issue(db, TOKEN_B);
      const oldRead = await db.query<{ payload: string | null }>(
        "SELECT public.read_preregistration_intent($1) AS payload",
        [digest(TOKEN_A)],
      );
      const newRead = await db.query<{ payload: string | null }>(
        "SELECT public.read_preregistration_intent($1) AS payload",
        [digest(TOKEN_B)],
      );
      expect(oldRead.rows[0]?.payload).toBeNull();
      expect(newRead.rows[0]?.payload).toBe(ENVELOPE);

      expect((await confirm(db, TOKEN_B)).rows[0]?.result).toBe("confirmed");
      expect((await confirm(db, TOKEN_B)).rows[0]?.result).toBe("invalid");

      await resetPersona(db);
      const registration = await db.query<{
        email: string;
        privacy_version: string;
        privacy_agreed: boolean;
        email_verified: boolean;
      }>(`
        SELECT
          email,
          privacy_version,
          privacy_agreed_at IS NOT NULL AS privacy_agreed,
          email_verified_at IS NOT NULL AS email_verified
        FROM public.preregistrations
      `);
      expect(registration.rows).toEqual([{
        email: "person@example.com",
        privacy_version: "2026-08-02",
        privacy_agreed: true,
        email_verified: true,
      }]);
      expect((await db.query(
        "SELECT count(*)::integer AS count FROM public.preregistration_intents",
      )).rows[0]).toEqual({ count: 0 });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("never overwrites a prior registration and still consumes the email-owned intent", async () => {
    const db = await createDatabase();
    try {
      await resetPersona(db);
      await db.exec("DROP TRIGGER preregistrations_verified_write_guard ON public.preregistrations");
      await db.query(
        "INSERT INTO public.preregistrations(email, name) VALUES ($1, $2)",
        ["person@example.com", "기존 이름"],
      );
      await db.exec(`
        CREATE TRIGGER preregistrations_verified_write_guard
        BEFORE INSERT OR UPDATE ON public.preregistrations
        FOR EACH ROW EXECUTE FUNCTION public.guard_verified_preregistration()
      `);

      await setPersona(db, "service_role");
      await issue(db);
      expect((await confirm(db)).rows[0]?.result).toBe("already_registered");

      await resetPersona(db);
      expect((await db.query(
        "SELECT name FROM public.preregistrations WHERE email = $1",
        ["person@example.com"],
      )).rows).toEqual([{ name: "기존 이름" }]);
      expect((await db.query(
        "SELECT count(*)::integer AS count FROM public.preregistration_intents",
      )).rows[0]).toEqual({ count: 0 });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("supports explicit cancellation, bounded expiry purge, and fail-closed direct writes", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      await issue(db, TOKEN_A, EMAIL_LOOKUP);
      const revoked = await db.query<{ revoked: boolean }>(
        "SELECT public.revoke_preregistration_intent($1) AS revoked",
        [digest(TOKEN_A)],
      );
      expect(revoked.rows[0]?.revoked).toBe(true);
      expect((await db.query<{ revoked: boolean }>(
        "SELECT public.revoke_preregistration_intent($1) AS revoked",
        [digest(TOKEN_A)],
      )).rows[0]?.revoked).toBe(false);

      await issue(db, TOKEN_B, OTHER_LOOKUP);
      await resetPersona(db);
      await db.query(`
        UPDATE public.preregistration_intents
        SET consent_agreed_at = statement_timestamp() - interval '31 minutes',
            issued_at = statement_timestamp() - interval '31 minutes',
            expires_at = statement_timestamp() - interval '1 minute'
      `);
      await setPersona(db, "service_role");
      expect((await db.query<{ purged: number }>(
        "SELECT public.purge_expired_preregistration_intents(10) AS purged",
      )).rows[0]?.purged).toBe(1);

      await expect(db.query(`
        INSERT INTO public.preregistrations(email)
        VALUES ('unverified@example.com')
      `)).rejects.toThrow(/permission denied|email_verification_required/i);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("rejects untrusted RPC calls and migration replay does not revive consumed tokens", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "anon");
      await expect(issue(db)).rejects.toThrow(/permission denied/i);
      await resetPersona(db);
      await db.exec(migration);

      const tables = await db.query<{ count: number }>(`
        SELECT count(*)::integer AS count
        FROM pg_catalog.pg_class
        WHERE oid = 'public.preregistration_intents'::regclass
      `);
      expect(tables.rows[0]?.count).toBe(1);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);
});
