import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createCustomerDataBoundaryFixture } from './account-deletion-customer-data-database.mjs';
import { createProfileRoleNativeDatabase, nativeProfileRoleAvailable } from './profile-role-native-database.mjs';
export { nativeProfileRoleAvailable as nativeCustomerDataAvailable };

const sourceFunction = (sql, name) => {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  const match = /AS (\$[a-z_]*\$)[\s\S]*?\1;/.exec(sql.slice(start));
  assert.ok(start >= 0 && match, `missing historical function ${name}`);
  return sql.slice(start, start + match.index + match[0].length);
};

// 제품 PG fixture의 실제 선행 schema/FK/epoch source를 native PG17에 재사용한다.
// 신규 migration 호출만 제외하고 초기 job을 비운다. 전체 운영 원본의 복제라고 주장하지 않는다.
export async function createCustomerDataNativeDatabase(root) {
  const owned = await createProfileRoleNativeDatabase();
  try {
    const read = name => readFileSync(join(root, 'supabase/migrations', name), 'utf8');
    const fixtureSource = readFileSync(join(root, 'scripts/tests/fixtures/account-deletion-customer-data-database.mjs'));
    const adapter = { exec: sql => owned.client.query(sql), query: (sql, values) => owned.client.query(sql, values) };
    await createCustomerDataBoundaryFixture({ createDatabase: async () => adapter, readMigration: read, installMigration: false });
    await owned.client.query('DELETE FROM public.account_deletion_jobs;');
    const previousSql = read('20260716113000_account_deletion_storage_saga.sql');
    const previousClaimSql = read('20260716094000_couple_roster_epoch.sql');
    for (const [name, args, sql] of [['prepare_account_deletion_auth_delete', 'uuid,uuid', previousSql],
      ['claim_amora_memory_job', 'integer,uuid', previousClaimSql]]) {
      await owned.client.query(`${sourceFunction(sql, name)}
        ALTER FUNCTION public.${name}(${args}) OWNER TO postgres;
        REVOKE ALL ON FUNCTION public.${name}(${args}) FROM PUBLIC,anon,authenticated,service_role;
        GRANT EXECUTE ON FUNCTION public.${name}(${args}) TO service_role;`);
    }
    await owned.client.query(`CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY);
      CREATE TABLE storage.objects(id uuid PRIMARY KEY,bucket_id text,name text);
      INSERT INTO storage.buckets VALUES('unchanged-fixture');
      INSERT INTO storage.objects VALUES(gen_random_uuid(),'unchanged-fixture','synthetic.webp');
      CREATE SCHEMA supabase_migrations;
      CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);`);
    const predecessorSql = read('20260913082314_private_profile_avatars_delivery.sql');
    await owned.client.query("INSERT INTO supabase_migrations.schema_migrations VALUES('20260913082314','private_profile_avatars_delivery',ARRAY[$1]::text[])", [predecessorSql]);
    return { ...owned, adapter, previousSql, previousClaimSql, predecessorSql,
      baselineFixtureSha256: createHash('sha256').update(fixtureSource).digest('hex') };
  } catch (error) { await owned.close(); throw error; }
}
