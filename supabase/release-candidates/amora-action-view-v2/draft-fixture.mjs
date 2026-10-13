import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PGlite } from '../../../apps/web/node_modules/@electric-sql/pglite/dist/index.js';
import { createProfileRoleNativeDatabase, nativeProfileRoleAvailable } from '../../../scripts/tests/fixtures/profile-role-native-database.mjs';

export const BRIDE = '10000000-0000-4000-8000-000000000001';
export const GROOM = '10000000-0000-4000-8000-000000000002';
export const OUTSIDER = '10000000-0000-4000-8000-000000000003';
export const COUPLE = '20000000-0000-4000-8000-000000000001';
export const OTHER_COUPLE = '20000000-0000-4000-8000-000000000002';
export const JOURNEY = '30000000-0000-4000-8000-000000000001';
export const TOKEN = '2026-01-01T00:00:00.123456Z';
export const candidatePath = new URL('./patch_own_amora_action_view_v2.sql', import.meta.url);
export { nativeProfileRoleAvailable };

const migration = name => readFileSync(new URL(`../../migrations/${name}`, import.meta.url), 'utf8');
const require = createRequire(import.meta.url);
const { Client } = require('pg');

/** 로컬 합성 schema와 실제 기존 함수만 사용한다. 운영 접속 문자열을 받지 않는다. */
export async function createDraftDatabase({ native = false, candidate = true } = {}) {
  const owned = native ? await createProfileRoleNativeDatabase() : new PGlite();
  const db = native ? owned.client : owned;
  const exec = text => native ? db.query(text) : db.exec(text);
  try {
    await exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE SCHEMA auth;
      CREATE TABLE auth.users(id uuid PRIMARY KEY);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
        SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
      CREATE TABLE public.couples(id uuid PRIMARY KEY,bride_id uuid,groom_id uuid);
      CREATE TABLE public.profiles(id uuid PRIMARY KEY,couple_id uuid,role text);
      CREATE TABLE public.wedding_journeys(id uuid PRIMARY KEY,couple_id uuid UNIQUE,
        progress jsonb NOT NULL DEFAULT '{}',state_revision bigint NOT NULL DEFAULT 0,updated_at timestamptz);
    `);
    const membership = migration('20260716114000_current_couple_membership_privacy_fence.sql');
    for (const name of ['is_current_couple_member', 'is_couple_member']) {
      const definition = membership.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\$function\\$;`))?.[0];
      assert.ok(definition, `original ${name} missing`);
      await exec(definition);
    }
    await exec(`ALTER FUNCTION public.is_current_couple_member(uuid,uuid) OWNER TO postgres;
      ALTER FUNCTION public.is_couple_member(uuid) OWNER TO postgres;
      REVOKE ALL ON FUNCTION public.is_current_couple_member(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
      REVOKE ALL ON FUNCTION public.is_couple_member(uuid) FROM PUBLIC,anon,authenticated,service_role;
      GRANT EXECUTE ON FUNCTION public.is_couple_member(uuid) TO authenticated,service_role;
      ALTER TABLE public.wedding_journeys ENABLE ROW LEVEL SECURITY;
      GRANT SELECT ON public.wedding_journeys TO authenticated;
      CREATE POLICY journey_read ON public.wedding_journeys FOR SELECT TO authenticated
        USING(public.is_couple_member(couple_id));`);
    const revision = migration('20260802170000_amora_shared_action_roster_binding.sql')
      .match(/CREATE OR REPLACE FUNCTION public\.advance_wedding_journey_state_revision\(\)[\s\S]*?\$function\$;/)?.[0];
    assert.ok(revision, 'original revision trigger missing');
    await exec(revision);
    await exec(`CREATE TRIGGER journey_revision BEFORE INSERT OR UPDATE ON public.wedding_journeys
      FOR EACH ROW EXECUTE FUNCTION public.advance_wedding_journey_state_revision();`);
    await exec(migration('20260615100000_create_amora_actions.sql'));
    await exec(migration('20260615101000_fix_amora_action_status_timestamps.sql'));
    await exec(migration('20260906074227_amora_manual_actions_actor_boundary.sql'));
    if (candidate && existsSync(candidatePath)) await exec(readFileSync(candidatePath, 'utf8'));
    await db.query('INSERT INTO auth.users VALUES ($1),($2),($3)', [BRIDE,GROOM,OUTSIDER]);
    await db.query('INSERT INTO public.couples VALUES ($1,$2,$3),($4,$5,null)', [COUPLE,BRIDE,GROOM,OTHER_COUPLE,OUTSIDER]);
    await db.query("INSERT INTO public.profiles VALUES ($1,$2,'bride'),($3,$2,'groom'),($4,$5,'bride')", [BRIDE,COUPLE,GROOM,OUTSIDER,OTHER_COUPLE]);
    await db.query('INSERT INTO public.wedding_journeys(id,couple_id,progress) VALUES ($1,$2,$3::jsonb)', [JOURNEY,COUPLE,JSON.stringify({__amora_actions:[],budget:{keep:17},schedule:['synthetic-kept']})]);
    const asRole = async (role, actor, sql, values = [], client = db) => {
      assert.ok(['authenticated','anon','service_role'].includes(role));
      const work = async tx => {
        await tx.query(`SET LOCAL ROLE ${role}`);
        await tx.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [actor ?? '']);
        return tx.query(sql,values);
      };
      if (!native) return client.transaction(work);
      await client.query('BEGIN');
      try { const result = await work(client); await client.query('COMMIT'); return result; }
      catch(error) { await client.query('ROLLBACK'); throw error; }
    };
    return {
      db, exec, asRole, native,
      async patch(id, values, token = TOKEN, { actor = BRIDE, couple = COUPLE, role = 'authenticated', client = db } = {}) {
        const result = await asRole(role,actor,
          'SELECT public.patch_own_amora_action_view_v2($1,$2,$3,$4::jsonb) AS value',
          [couple,id,token,JSON.stringify(values)],client);
        return result.rows[0].value;
      },
      async oldPatch(id, values, { actor = BRIDE, couple = COUPLE, client = db } = {}) {
        return (await asRole('authenticated',actor,
          "SELECT public.mutate_own_amora_action($1,$2,'update',$3::jsonb) AS value",
          [couple,id,JSON.stringify(values)],client)).rows[0].value;
      },
      async create(id, values = { title:'SYNTHETIC-CANONICAL' }, actor = BRIDE) {
        return (await asRole('authenticated',actor,
          "SELECT public.mutate_own_amora_action($1,$2,'create',$3::jsonb) AS value",
          [COUPLE,id,JSON.stringify(values)])).rows[0].value;
      },
      async seedCanonical(id = 'draft_canonical', token = TOKEN) {
        await db.query(`INSERT INTO public.amora_actions(id,couple_id,title,description,created_by,updated_at)
          VALUES($1,$2,'SYNTHETIC-CANONICAL','SYNTHETIC-ORIGINAL',$3,$4::timestamptz)`, [id,COUPLE,BRIDE,token]);
      },
      async seedLegacy(actions) {
        await db.query("UPDATE public.wedding_journeys SET progress=jsonb_set(progress,'{__amora_actions}',$1::jsonb) WHERE id=$2", [JSON.stringify(actions),JOURNEY]);
      },
      async read(id, actor = BRIDE) {
        return (await asRole('authenticated',actor,
          'SELECT to_jsonb(a) AS value FROM public.amora_actions a WHERE id=$1', [id])).rows[0]?.value ?? null;
      },
      async journey(actor = BRIDE) {
        return (await asRole('authenticated',actor,
          'SELECT progress,state_revision FROM public.wedding_journeys WHERE id=$1',[JOURNEY])).rows[0] ?? null;
      },
      async newSession() {
        assert.equal(native,true);
        const client = new Client({...owned.connection,connectionTimeoutMillis:1000,query_timeout:20_000});
        await client.connect();
        return client;
      },
      async close() { if (native) await owned.close(); else await db.close(); },
    };
  } catch(error) { if (native) await owned.close(); else await db.close(); throw error; }
}

export const legacy = (id = 'draft_legacy', changes = {}) => ({
  id,title:'SYNTHETIC-LEGACY',description:'SYNTHETIC-ORIGINAL',priority:'medium',status:'open',
  source:'manual',createdAt:TOKEN,updatedAt:TOKEN,unknown:{preserved:true},...changes,
});
