import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { buildWeddingCodeResearchMutationSql, buildWeddingCodeResearchObservationSql, validateWeddingCodeResearchCatalog,
  weddingCodeResearchLedgerDigestSql, weddingCodeResearchPreservedCatalogSql, weddingCodeResearchTargetCatalogSql,
} from '../lib/wedding-code-research-contributions-release.mjs';
import { createProfileRoleNativeDatabase, nativeProfileRoleAvailable } from './fixtures/profile-role-native-database.mjs';

const root = resolve(import.meta.dirname, '../..');
const { Client } = createRequire(import.meta.url)('pg');
const sql = readFileSync(resolve(root, 'supabase/migrations/20260915130000_wedding_code_research_contributions.sql'), 'utf8');
const skip = nativeProfileRoleAvailable ? false : 'native PG17 unavailable; actual PG17 catalog/transaction/lock test not verified';
const hash = byte => Buffer.alloc(32, byte);
const CALL = {
  insert: 'SELECT public.insert_wedding_code_research_contribution($1,$2,$3,$4)',
  delete: 'SELECT public.delete_wedding_code_research_contribution($1)',
};

test('actual PG17 catalog, rollback and commit match the reviewed objects and preserve existing rows; ACL drift is rejected',
  { skip, timeout: 180_000 }, async () => {
    const owned = await createProfileRoleNativeDatabase();
    const db = owned.client;
    const peer = new Client({ ...owned.connection, query_timeout: 20_000 });
    try {
      await db.query(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
        GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
        ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
        ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
        CREATE TABLE public.unrelated_rows(id int PRIMARY KEY, note text);
        INSERT INTO public.unrelated_rows VALUES (1, 'synthetic preserved');
        CREATE SCHEMA supabase_migrations;
        CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);
        INSERT INTO supabase_migrations.schema_migrations VALUES('20260915101500','fixture',ARRAY['fixture']);`);
      const one = async text => (await db.query(`SELECT ${text} AS value`)).rows[0].value;
      const before = { catalog: await one(weddingCodeResearchTargetCatalogSql()), preservedCatalogSha: await one(weddingCodeResearchPreservedCatalogSql()),
        ledgerSha: await one(weddingCodeResearchLedgerDigestSql()), migration: null };
      validateWeddingCodeResearchCatalog(before.catalog, sql, false);
      const observation = (await db.query(buildWeddingCodeResearchObservationSql())).find(result => result.rows?.[0]?.observation)?.rows[0].observation;
      assert.equal(observation.systemIdentifier, owned.system); assert.equal(observation.readOnly, true);
      assert.match(observation.serverVersion, /^17\./); assert.equal(observation.currentUser, 'postgres');
      assert.equal(observation.preservedCatalogSha, before.preservedCatalogSha);
      // 합성 PG17은 운영과 다른 system identifier를 가진다. 고정 identity 조회만 합성값으로 대체한다.
      const bundle = rehearsal => buildWeddingCodeResearchMutationSql({ sql, before, rehearsal,
        deadline: new Date(Date.now() + 120_000).toISOString() }).replace(`<>'7581440907192989109'`, `<>'${owned.system}'`);
      await db.query(bundle(true));
      assert.deepEqual(await one(weddingCodeResearchTargetCatalogSql()), before.catalog);
      assert.equal(await one(weddingCodeResearchPreservedCatalogSql()), before.preservedCatalogSha);
      assert.equal(await one(weddingCodeResearchLedgerDigestSql()), before.ledgerSha);
      await db.query(bundle(false));
      validateWeddingCodeResearchCatalog(await one(weddingCodeResearchTargetCatalogSql()), sql, true);
      assert.equal(await one(weddingCodeResearchPreservedCatalogSql()), before.preservedCatalogSha);
      assert.deepEqual((await db.query('SELECT * FROM public.unrelated_rows')).rows, [{ id: 1, note: 'synthetic preserved' }]);
      assert.equal((await db.query("SELECT statements[1] AS sql FROM supabase_migrations.schema_migrations WHERE version='20260915130000'")).rows[0].sql, sql);

      // 실제 역할 경계: service_role은 함수로만 쓰고, 테이블은 직접 읽거나 쓰지 못한다. anon은 함수도 못 부른다.
      await db.query('SET ROLE service_role');
      await db.query(CALL.insert, ['v0.8-code', 'ABCD-ABCD-ABCD-ABCD-', 'wc-research-consent-v1', hash(1)]);
      await assert.rejects(db.query('SELECT count(*) FROM public.wedding_code_research_contributions'), /permission denied/);
      await db.query('SET ROLE anon');
      await assert.rejects(db.query(CALL.delete, [hash(1)]), /permission denied/);
      await db.query('RESET ROLE');

      // 같은 hash의 저장과 삭제는 서로를 기다린다. 늦게 끝난 쪽이 먼저 끝난 쪽 결과를 본다.
      await peer.connect();
      await peer.query('SET ROLE service_role');
      await db.query('BEGIN; SET LOCAL ROLE service_role');
      await db.query(CALL.insert, ['v0.8-code', 'AAAAAAAAAAAAAAAAAAAA', 'wc-research-consent-v1', hash(2)]);
      let deleted = false;
      const deletion = peer.query(CALL.delete, [hash(2)]).then(() => { deleted = true; });
      await delay(500);
      assert.equal(deleted, false, 'delete must wait for the uncommitted insert of the same hash');
      await db.query('COMMIT');
      await deletion;
      assert.deepEqual((await db.query('SELECT count(*)::int AS n FROM public.wedding_code_research_contributions WHERE deletion_receipt_hash=$1', [hash(2)])).rows, [{ n: 0 }]);
      assert.deepEqual((await db.query('SELECT count(*)::int AS n FROM public.wedding_code_research_deletion_tombstones WHERE deletion_receipt_hash=$1', [hash(2)])).rows, [{ n: 1 }]);

      await db.query('BEGIN; SET LOCAL ROLE service_role');
      await db.query(CALL.delete, [hash(3)]);
      let settled = false;
      const insertion = peer.query(CALL.insert, ['v0.8-code', 'BBBBBBBBBBBBBBBBBBBB', 'wc-research-consent-v1', hash(3)])
        .finally(() => { settled = true; });
      await delay(500);
      assert.equal(settled, false, 'insert must wait for the uncommitted delete of the same hash');
      await db.query('COMMIT');
      await assert.rejects(insertion, /WEDDING_CODE_RESEARCH_CONTRIBUTION_REJECTED/);
      assert.deepEqual((await db.query('SELECT count(*)::int AS n FROM public.wedding_code_research_contributions WHERE deletion_receipt_hash=$1', [hash(3)])).rows, [{ n: 0 }]);

      // PG17에서도 3인자 date_trunc CHECK가 실제로 걸리고, 저장 시각은 UTC 날짜 자정이다(세션 시간대와 무관).
      await db.query("SET TIME ZONE 'Asia/Seoul'");
      await db.query('BEGIN; SET LOCAL ROLE service_role');
      await db.query(CALL.insert, ['v0.8-code', 'CCCCCCCCCCCCCCCCCCCC', 'wc-research-consent-v1', hash(4)]);
      await db.query('COMMIT');
      assert.deepEqual((await db.query(`SELECT created_at = date_trunc('day', now(), 'UTC') AS today,
        to_char(created_at AT TIME ZONE 'UTC', 'HH24:MI:SS.US') AS clock, extract(epoch FROM expires_at - created_at)::int AS lifetime
        FROM public.wedding_code_research_contributions WHERE deletion_receipt_hash=$1`, [hash(4)])).rows,
      [{ today: true, clock: '00:00:00.000000', lifetime: 60 * 86_400 }]);
      await assert.rejects(db.query(`INSERT INTO public.wedding_code_research_contributions
        (created_at, expires_at, scene_version, answer_code, consent_version, deletion_receipt_hash)
        VALUES (date_trunc('day', now(), 'UTC') + interval '1 hour', date_trunc('day', now(), 'UTC') + interval '30 days',
        'v0.8-code', 'AAAAAAAAAAAAAAAAAAAA', 'wc-research-consent-v1', $1)`, [hash(5)]), /wcr_contributions_created_at_day/);
      await assert.rejects(db.query(CALL.insert, ['v0.8-code', 'DDDDDDDDDDDDDDDDDDDD', 'wc-research-consent-v1', hash(4)]),
        error => error.code === '23505');
      await db.query("RESET TIME ZONE");

      // tombstone과 같은 hash의 행이 함수 밖 경로로 남아 있으면 purge가 지우고 개수에 넣는다.
      await db.query(`INSERT INTO public.wedding_code_research_contributions (scene_version, answer_code, consent_version, deletion_receipt_hash)
        VALUES ('v0.8-code', 'CCCCCCCCCCCCCCCCCCCC', 'wc-research-consent-v1', $1)`, [hash(2)]);
      await db.query('SET ROLE service_role');
      assert.deepEqual((await db.query('SELECT public.purge_expired_wedding_code_research_contributions() AS n')).rows, [{ n: 1 }]);
      await db.query('RESET ROLE');
      assert.deepEqual((await db.query('SELECT count(*)::int AS n FROM public.wedding_code_research_contributions WHERE deletion_receipt_hash=$1', [hash(2)])).rows, [{ n: 0 }]);
      assert.deepEqual((await db.query('SELECT count(*)::int AS n FROM public.wedding_code_research_contributions')).rows, [{ n: 2 }]);

      await db.query('GRANT SELECT ON public.wedding_code_research_contributions TO authenticated');
      assert.throws(() => validateWeddingCodeResearchCatalog(null, sql, true));
      const drifted = await one(weddingCodeResearchTargetCatalogSql());
      assert.throws(() => validateWeddingCodeResearchCatalog(drifted, sql, true), { code: 'WEDDING_CODE_RESEARCH_TARGET_CATALOG_DRIFT' });
    } finally {
      await peer.end().catch(() => {});
      await owned.close();
    }
  });
