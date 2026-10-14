import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createPrivilegeDatabase} from '../../../supabase/release-candidates/amora-action-writer-retirement-v1/privileges-fixture.mjs';
import {legacy} from '../../../supabase/release-candidates/amora-action-view-v2/draft-fixture.mjs';

/** Fixed local schema and synthetic ledger/rows only. No production connection/factory/identity overrides. */
export async function createAmoraWriterRetirementRecoveryNativeDatabase() {
  const f=await createPrivilegeDatabase({phase:'before'});
  try {
    const source=readFileSync(new URL('../../../supabase/migrations/20260731123000_couple_plan_change_write_boundary.sql',import.meta.url),'utf8');
    const highImpact=source.match(/CREATE OR REPLACE FUNCTION public\.couple_plan_change_is_high_impact\([\s\S]*?\$function\$;/)?.[0];
    assert.ok(highImpact);await f.exec(highImpact);
    await f.seedCanonical('native_original7_canonical');
    await f.seedLegacy([legacy('native_original7_legacy')]);
    await f.exec('CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[])');
    await f.db.query(`INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
      SELECT lpad(value::text,14,'0'),'synthetic_history_'||value::text,
      CASE WHEN value<=64 THEN NULL ELSE ARRAY['-- synthetic local native history only '||value::text]::text[] END
      FROM generate_series(1,230) AS sequence(value)`);
    return f;
  } catch(error) {await f.close();throw error;}
}
