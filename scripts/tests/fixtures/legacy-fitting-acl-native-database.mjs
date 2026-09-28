import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createProfileRoleNativeDatabase, nativeProfileRoleAvailable } from './profile-role-native-database.mjs';

export { nativeProfileRoleAvailable as nativeLegacyFittingAvailable };

// 2026-09-28 검토된 pg_get_functiondef 원문만 고정한다. 실제 고객 행은 포함하지 않는다.
export const LEGACY_FITTING_NATIVE_DEFINITIONS = Object.freeze([
  {
    "identity": "public.cleanup_expired_fittings()",
    "definitionSha256": "c4eb796a6da0f0c1e1f3cdf3abc1e6138b388a3f78726ead302583b7088356aa",
    "definition": "CREATE OR REPLACE FUNCTION public.cleanup_expired_fittings()\n RETURNS void\n LANGUAGE plpgsql\n SECURITY DEFINER\nAS $function$\r\nBEGIN\r\n  -- 만료되고 저장하지 않은 피팅 삭제\r\n  DELETE FROM fitting_requests\r\n  WHERE expires_at < NOW() AND is_saved = false;\r\nEND;\r\n$function$\n"
  },
  {
    "identity": "public.increment_fitting_usage(uuid,date)",
    "definitionSha256": "9b17d7a47a88cfcbbc1100416e37abddf60b43c10562ca158a424428e6c8df03",
    "definition": "CREATE OR REPLACE FUNCTION public.increment_fitting_usage(p_couple_id uuid, p_period_start date)\n RETURNS void\n LANGUAGE plpgsql\n SECURITY DEFINER\nAS $function$\r\nBEGIN\r\n  UPDATE fitting_usage\r\n  SET free_used = free_used + 1\r\n  WHERE couple_id = p_couple_id AND period_start = p_period_start;\r\nEND;\r\n$function$\n"
  }
].map(value => Object.freeze(value)));


const hash = value => createHash('sha256').update(value).digest('hex');
const identities = ['public.cleanup_expired_fittings()', 'public.increment_fitting_usage(uuid,date)'];

// 기존 native fixture의 새 loopback cluster만 사용한다. 운영 연결·행·자격 증명은 받지 않는다.
export async function createLegacyFittingAclNativeDatabase(definitions = LEGACY_FITTING_NATIVE_DEFINITIONS) {
  assert.equal(definitions.length, identities.length);
  assert.deepEqual(definitions.map(value => value.identity).sort(), [...identities].sort());
  for (const value of definitions) {
    assert.match(value.definitionSha256, /^[a-f0-9]{64}$/);
    assert.equal(hash(value.definition), value.definitionSha256);
  }
  const owned = await createProfileRoleNativeDatabase();
  try {
    await owned.client.query(`
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE service_role NOLOGIN BYPASSRLS;
      GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
      CREATE TABLE public.fitting_requests(
        id uuid PRIMARY KEY, user_id uuid, couple_id uuid, expires_at timestamptz, is_saved boolean);
      CREATE TABLE public.fitting_usage(
        id uuid PRIMARY KEY, user_id uuid, couple_id uuid, period_start date, free_used integer);
      ALTER TABLE public.fitting_requests ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.fitting_usage ENABLE ROW LEVEL SECURITY;
      REVOKE ALL ON public.fitting_requests, public.fitting_usage FROM PUBLIC, anon, authenticated, service_role;
      CREATE TABLE public.synthetic_fitting_unrelated(id integer PRIMARY KEY, note text);
      INSERT INTO public.synthetic_fitting_unrelated VALUES(1, 'synthetic preserved');
      CREATE SCHEMA supabase_migrations;
      CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY, name text, statements text[]);
      INSERT INTO supabase_migrations.schema_migrations
        VALUES('20260927000000', 'synthetic_predecessor', ARRAY['synthetic unchanged ledger']);
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
    `);
    for (const value of definitions) {
      // CRLF를 포함한 검토된 함수 원문을 그대로 실행하고 PG17의 재출력 hash도 확인한다.
      await owned.client.query(value.definition);
      await owned.client.query(`GRANT EXECUTE ON FUNCTION ${value.identity} TO PUBLIC, anon, authenticated, service_role`);
      const actual = (await owned.client.query(
        'SELECT pg_get_functiondef($1::regprocedure) AS definition', [value.identity])).rows[0].definition;
      assert.equal(hash(actual), value.definitionSha256);
    }
    return owned;
  } catch (error) {
    await owned.close();
    throw error;
  }
}
