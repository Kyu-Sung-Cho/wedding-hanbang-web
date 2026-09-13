import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { LEGACY_JOIN_ACL_INVENTORY_SQL, LEGACY_JOIN_ACL_PINS, LEGACY_JOIN_ACL_PROJECT_REF, LEGACY_JOIN_ACL_RELEASE_ID, buildLegacyJoinAclSql, createLegacyJoinManagementClient, runLegacyJoinAcl, validateLegacyJoinConnection, verifyLegacyJoinInventory } from "../lib/legacy-couple-join-acl-release.mjs";
import { joinSyntheticCoupleViaApi, validateSyntheticAppUrl } from "../../apps/web/scripts/lib/synthetic-couple-api.mjs";

const requireWeb = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const { PGlite } = requireWeb("@electric-sql/pglite");
const { pgcrypto } = requireWeb("@electric-sql/pglite/contrib/pgcrypto");
const OWNER = "00000000-0000-4000-8000-000000000001";
const PARTNER = "00000000-0000-4000-8000-000000000002";
const COUPLE = "10000000-0000-4000-8000-000000000001";
const INVITE = "WH-AAAABBBBCCCC";

async function fixture(t) {
  const db = await PGlite.create({ extensions: { pgcrypto } });
  t.after(() => db.close());
  await db.exec(`
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth; CREATE SCHEMA extensions; CREATE EXTENSION pgcrypto SCHEMA extensions;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE TABLE public.couples (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bride_id uuid,groom_id uuid,invite_code text UNIQUE,member_model_version smallint NOT NULL DEFAULT 1,membership_sealed_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE public.profiles (id uuid PRIMARY KEY,couple_id uuid REFERENCES public.couples(id),role text CHECK(role IN('bride','groom')),updated_at timestamptz NOT NULL DEFAULT now());
    CREATE FUNCTION public.test_enforce_couple_roster_epoch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.bride_id IS NOT NULL AND NEW.groom_id IS NOT NULL THEN NEW.membership_sealed_at:=COALESCE(NEW.membership_sealed_at,clock_timestamp()); END IF; RETURN NEW; END $$;
    CREATE TRIGGER trg_enforce_couple_roster_epoch BEFORE INSERT OR UPDATE ON public.couples FOR EACH ROW EXECUTE FUNCTION public.test_enforce_couple_roster_epoch();
    CREATE FUNCTION public.test_current_couple_row_integrity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$;
    CREATE CONSTRAINT TRIGGER trg_current_couple_row_integrity AFTER INSERT OR UPDATE ON public.couples DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.test_current_couple_row_integrity();
    CREATE FUNCTION public.generate_invite_code() RETURNS text LANGUAGE sql AS $$ SELECT 'WH-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12)) $$;
    CREATE FUNCTION public.join_couple(p_invite_code text,p_role text) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
  `);
  for (const name of ["20260812030000_couple_invite_replay_hardening.sql", "20260820130000_legacy_join_blocks_neutral_space.sql", "20260820150000_invite_expiry_is_not_a_typo.sql"]) {
    await db.exec(readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8"));
  }
  await db.exec(`SET search_path=public,pg_catalog; INSERT INTO public.couples(id,bride_id,invite_code) VALUES('${COUPLE}','${OWNER}','${INVITE}'); INSERT INTO public.profiles(id,couple_id,role) VALUES('${OWNER}','${COUPLE}','bride'),('${PARTNER}',NULL,NULL); SET CONSTRAINTS ALL IMMEDIATE;`);
  return db;
}
async function inventory(db) { return (await db.query(LEGACY_JOIN_ACL_INVENTORY_SQL)).rows; }
async function state(db) {
  return (await db.query("SELECT jsonb_build_object('profiles',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM profiles p),'couples',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM couples c),'receipts',(SELECT count(*) FROM couple_invite_redemptions),'attempts',(SELECT count(*) FROM couple_invite_join_attempts)) AS data")).rows[0].data;
}
async function callAs(db, role, server = false) {
  await db.exec(`SET ROLE ${role}; SELECT set_config('request.jwt.claim.sub','${PARTNER}',false);`);
  try { return await db.query(server ? "SELECT join_couple_server($1::uuid,$2::text,'groom') AS result" : "SELECT join_couple($1::text,'groom') AS result", server ? [PARTNER, INVITE] : [INVITE]); }
  finally { await db.exec("RESET ROLE"); }
}

test("exact observed production contract rehearses with no ACL or membership changes", async t => {
  const db = await fixture(t);
  const before = await inventory(db);
  verifyLegacyJoinInventory(before, "before");
  const data = await state(db);
  await db.exec(buildLegacyJoinAclSql("rehearse"));
  assert.deepEqual(await inventory(db), before);
  assert.deepEqual(await state(db), data);
});

test("revocation denies direct RPC before execution, keeps service wrapper retry and restores exact original ACL", async t => {
  const db = await fixture(t);
  const before = await inventory(db);
  const data = await state(db);
  await db.exec(buildLegacyJoinAclSql("apply"));
  verifyLegacyJoinInventory(await inventory(db), "after");
  for (const role of ["anon", "authenticated", "service_role"]) await assert.rejects(callAs(db, role), { code: "42501" });
  for (const role of ["anon", "authenticated"]) await assert.rejects(callAs(db, role, true), { code: "42501" });
  assert.deepEqual(await state(db), data);
  const first = (await callAs(db, "service_role", true)).rows[0].result;
  const retry = (await callAs(db, "service_role", true)).rows[0].result;
  assert.equal(first.success, true); assert.equal(first.couple_id, COUPLE);
  assert.equal(retry.success, true); assert.equal(retry.idempotent, true);
  const joined = await state(db);
  await db.exec(buildLegacyJoinAclSql("rollback"));
  assert.deepEqual(await inventory(db), before);
  assert.deepEqual(await state(db), joined);
});

test("unsafe wrapper ACL aborts before revocation and preserves all preexisting grants", async t => {
  const db = await fixture(t);
  await db.exec("GRANT EXECUTE ON FUNCTION public.join_couple_server(uuid,text,text) TO authenticated");
  const before = await inventory(db);
  await assert.rejects(db.exec(buildLegacyJoinAclSql("apply")), /JOIN_ACL_FUNCTION_OR_GRANT_DRIFT/);
  await db.exec("ROLLBACK");
  assert.deepEqual(await inventory(db), before);
});

test("postcondition failure rolls back the real REVOKE", async t => {
  const db = await fixture(t);
  const before = await inventory(db);
  const sql = buildLegacyJoinAclSql("apply").replace("DO $join_acl_after$ BEGIN", "DO $join_acl_after$ BEGIN RAISE EXCEPTION 'test_postcondition_failure';");
  await assert.rejects(db.exec(sql), /test_postcondition_failure/);
  await db.exec("ROLLBACK");
  assert.deepEqual(await inventory(db), before);
});

test("definition drift, extra overload and inherited grants are not accepted", async t => {
  const db = await fixture(t);
  const rows = await inventory(db);
  const altered = structuredClone(rows); altered[0].definition_md5 = "0".repeat(32);
  assert.throws(() => verifyLegacyJoinInventory(altered, "before"), /FUNCTION_DRIFT/);
  assert.throws(() => verifyLegacyJoinInventory([...rows, rows[0]], "before"), /IDENTITY_DRIFT/);
  await db.exec("GRANT postgres TO authenticated");
  await assert.rejects(db.exec(buildLegacyJoinAclSql("apply")), /JOIN_ACL_EFFECTIVE_PRIVILEGE_DRIFT/);
  await db.exec("ROLLBACK");
});

test("controller refuses wrong confirmation before any query and drift before mutation", async () => {
  const calls = [];
  const client = { query: async sql => { calls.push(sql); throw new Error("unexpected query"); } };
  await assert.rejects(runLegacyJoinAcl({ client, mode: "apply", expectedRef: LEGACY_JOIN_ACL_PROJECT_REF, confirmation: "wrong" }), /CONFIRMATION_REQUIRED/);
  assert.deepEqual(calls, []);
  const dbClient = { query: async sql => { calls.push(sql); if (sql === LEGACY_JOIN_ACL_INVENTORY_SQL) return { rows: [] }; return { rows: [] }; } };
  await assert.rejects(runLegacyJoinAcl({ client: dbClient, mode: "apply", expectedRef: LEGACY_JOIN_ACL_PROJECT_REF, confirmation: `${LEGACY_JOIN_ACL_RELEASE_ID}:${LEGACY_JOIN_ACL_PROJECT_REF}:apply` }), /IDENTITY_DRIFT/);
  assert.equal(calls.some(sql => sql.includes("REVOKE")), false);
});

test("controller saves the exact baseline first, stops if recording fails and never retries an uncertain COMMIT", async () => {
  const rows = LEGACY_JOIN_ACL_PINS.map(pin => ({ identity: pin.identity, owner: "postgres", security_definer: true, definition_md5: pin.definitionMd5, acl: pin.beforeAcl, anon_execute: pin.execute[0], authenticated_execute: pin.execute[1], service_execute: pin.execute[2] }));
  for (const failRecording of [true, false]) {
    const calls = [];
    const client = { query: async sql => { calls.push(sql); if (sql === LEGACY_JOIN_ACL_INVENTORY_SQL) return { rows }; if (sql.startsWith("BEGIN;")) throw new Error("connection lost around COMMIT"); return { rows: [] }; } };
    await assert.rejects(runLegacyJoinAcl({ client, mode: "apply", expectedRef: LEGACY_JOIN_ACL_PROJECT_REF, confirmation: `${LEGACY_JOIN_ACL_RELEASE_ID}:${LEGACY_JOIN_ACL_PROJECT_REF}:apply`, beforeMutation: before => { assert.deepEqual(before, rows); assert.equal(calls.some(sql => sql.startsWith("BEGIN;")), false); if (failRecording) throw new Error("disk full"); } }), failRecording ? /disk full/ : /OUTCOME_REQUIRES_INSPECTION/);
    assert.equal(calls.filter(sql => sql.startsWith("BEGIN;")).length, failRecording ? 0 : 1);
    assert.equal(calls.includes("ROLLBACK"), !failRecording);
  }
});

test("connection validation binds the exact direct database and disallows pooler/URL overrides", () => {
  const valid = `postgresql://postgres:dummy@db.${LEGACY_JOIN_ACL_PROJECT_REF}.supabase.co:5432/postgres`;
  assert.equal(validateLegacyJoinConnection(valid, LEGACY_JOIN_ACL_PROJECT_REF).hostname, `db.${LEGACY_JOIN_ACL_PROJECT_REF}.supabase.co`);
  for (const value of [valid+"?host=attacker.example", valid.replace("/postgres", "/other"), valid.replace("db.", "evil."), valid.replace(":5432", ":6543"), valid.replace("postgres:dummy", "other:dummy")]) assert.throws(() => validateLegacyJoinConnection(value, LEGACY_JOIN_ACL_PROJECT_REF), /CONNECTION_INVALID/);
});

test("management inspector uses one fixed project endpoint and a read-only SQL transaction", async () => {
  const calls = [];
  const client = createLegacyJoinManagementClient({ accessToken: "synthetic-token-0123456789", expectedRef: LEGACY_JOIN_ACL_PROJECT_REF, fetchImpl: async (url, init) => { calls.push({ url, init }); return { ok: true, text: async () => "[]" }; } });
  await client.query(LEGACY_JOIN_ACL_INVENTORY_SQL);
  assert.equal(calls[0].url, `https://api.supabase.com/v1/projects/${LEGACY_JOIN_ACL_PROJECT_REF}/database/query`);
  assert.match(JSON.parse(calls[0].init.body).query, /^BEGIN READ ONLY;/);
  assert.equal(calls[0].init.redirect, "error");
  await assert.rejects(client.query(buildLegacyJoinAclSql("apply")), /QUERY_FORBIDDEN/);
  await assert.rejects(client.query("SELECT * FROM profiles"), /QUERY_FORBIDDEN/);
  assert.equal(calls.length, 1);
});

test("management writer accepts only the reviewed bundle for its separately confirmed mode", async () => {
  const calls = [];
  const options = { accessToken: "synthetic-token-0123456789", expectedRef: LEGACY_JOIN_ACL_PROJECT_REF, mode: "apply", confirmation: `${LEGACY_JOIN_ACL_RELEASE_ID}:${LEGACY_JOIN_ACL_PROJECT_REF}:apply`, fetchImpl: async (url, init) => { calls.push({ url, init }); return { ok: true, text: async () => "[]" }; } };
  assert.throws(() => createLegacyJoinManagementClient({ ...options, confirmation: "" }), /CONFIRMATION_REQUIRED/);
  assert.throws(() => createLegacyJoinManagementClient({ ...options, expectedRef: "differentproject" }), /TARGET_REF_MISMATCH/);
  const client = createLegacyJoinManagementClient(options);
  await client.query(buildLegacyJoinAclSql("apply"));
  assert.equal(JSON.parse(calls[0].init.body).query, buildLegacyJoinAclSql("apply"));
  await assert.rejects(client.query(buildLegacyJoinAclSql("rollback")), /QUERY_FORBIDDEN/);
  await assert.rejects(client.query(buildLegacyJoinAclSql("apply")+"DROP TABLE profiles;"), /QUERY_FORBIDDEN/);
  await assert.rejects(client.query("ROLLBACK"), /QUERY_FORBIDDEN/);
  assert.equal(calls.length, 1);
});

test("management response and network failures remain unverified without printing or retrying secrets", async () => {
  for (const response of [{ ok: false, text: async () => "secret server error" }, { ok: true, text: async () => '{"error":"secret"}' }, null]) {
    let calls = 0;
    const client = createLegacyJoinManagementClient({ accessToken: "synthetic-token-0123456789", expectedRef: LEGACY_JOIN_ACL_PROJECT_REF, fetchImpl: async () => { calls++; if (!response) throw new Error("secret network payload"); return response; } });
    await assert.rejects(client.query(LEGACY_JOIN_ACL_INVENTORY_SQL), error => /^JOIN_ACL_MANAGEMENT_(OUTCOME_UNVERIFIED|RESPONSE_INVALID)$/.test(error.message));
    assert.equal(calls, 1);
  }
});

function syntheticUser() {
  return { id: PARTNER, client: { auth: { getUser: async () => ({ data: { user: { id: PARTNER } } }), getSession: async () => ({ data: { session: { user: { id: PARTNER }, access_token: "synthetic-token" } } }) } } };
}
test("synthetic join uses owner verification, server consent and onboarding API without changing shared plan fields", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return { ok: true, json: async () => url.includes("/me?") ? { user: { id: PARTNER } } : url.endsWith("/consent") ? { success: true } : { success: true, coupleId: COUPLE } }; };
  await joinSyntheticCoupleViaApi({ user: syntheticUser(), inviteCode: INVITE, role: "groom", expectedCoupleId: COUPLE, appUrl: "http://localhost:3000", expectedRef: "synthetic", fetchImpl });
  assert.deepEqual(calls.map(x => new URL(x.url).pathname), ["/api/auth/me", "/api/auth/consent", "/api/onboarding"]);
  assert.deepEqual(JSON.parse(calls[2].init.body), { role: "groom", coupleAction: "join", partnerInviteCode: INVITE });
  assert.equal(JSON.parse(calls[1].init.body).marketingAgreed, false);
  assert.equal(calls[2].init.redirect, "error");
});
test("synthetic API account mismatch and failed consent prevent join", async () => {
  for (const problem of ["owner", "consent"]) {
    const calls = [];
    await assert.rejects(joinSyntheticCoupleViaApi({ user: syntheticUser(), inviteCode: INVITE, role: "groom", expectedCoupleId: COUPLE, appUrl: "http://localhost:3000", expectedRef: "synthetic", fetchImpl: async url => { calls.push(url); return { ok: true, json: async () => url.includes("/me?") ? { user: { id: problem === "owner" ? OWNER : PARTNER } } : { success: false } }; } }), /OWNER_MISMATCH|CONSENT_UNVERIFIED/);
    assert.equal(calls.some(url => url.endsWith("/onboarding")), false);
  }
  assert.throws(() => validateSyntheticAppUrl("https://hanbang.ai", "synthetic"), /TARGET_INVALID/);
});
