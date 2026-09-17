import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { buildWeddingCodeSceneVersionMutationSql, buildWeddingCodeSceneVersionObservationSql, validateWeddingCodeSceneVersionCatalog,
  weddingCodeSceneVersionLedgerDigestSql,
} from '../lib/wedding-code-research-scene-v09-release.mjs';
import { weddingCodeResearchPreservedCatalogSql, weddingCodeResearchTargetCatalogSql } from '../lib/wedding-code-research-contributions-release.mjs';
import { createProfileRoleNativeDatabase, nativeProfileRoleAvailable } from './fixtures/profile-role-native-database.mjs';

const root = resolve(import.meta.dirname, '../..');
const { Client } = createRequire(import.meta.url)('pg');
const sql = readFileSync(resolve(root, 'supabase/migrations/20260917090000_wedding_code_research_scene_v09.sql'), 'utf8');
const predecessorSql = readFileSync(resolve(root, 'supabase/migrations/20260915130000_wedding_code_research_contributions.sql'), 'utf8');
const skip = nativeProfileRoleAvailable ? false : 'native PG17 unavailable; actual PG17 catalog/transaction/lock test not verified';
const hash = byte => Buffer.alloc(32, byte);
const INSERT = 'SELECT public.insert_wedding_code_research_contribution($1,$2,$3,$4)';
const CONSENT = 'wc-research-consent-v1';

test('actual PG17 catalog, rollback, lock bound and commit widen only the scene CHECK and preserve existing rows; drift is rejected',
  { skip, timeout: 180_000 }, async () => {
    const owned = await createProfileRoleNativeDatabase();
    const db = owned.client;
    const peer = new Client({ ...owned.connection, query_timeout: 30_000 });
    try {
      await db.query(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
        GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
        ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
        ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
        CREATE TABLE public.unrelated_rows(id int PRIMARY KEY, note text);
        INSERT INTO public.unrelated_rows VALUES (1, 'synthetic preserved');
        CREATE SCHEMA supabase_migrations;
        CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);`);
      // 운영과 같은 선행 상태: 234 원문이 적용돼 있고, v0.8-code 응답이 이미 들어 있다.
      await db.query(predecessorSql);
      await db.query("INSERT INTO supabase_migrations.schema_migrations VALUES('20260915130000','wedding_code_research_contributions',ARRAY[$1]::text[])",
        [predecessorSql]);
      await db.query('SET ROLE service_role');
      await db.query(INSERT, ['v0.8-code', 'ABCD-ABCD-ABCD-ABCD-', CONSENT, hash(1)]);
      await db.query(INSERT, ['v0.8-code', 'AAAAAAAAAAAAAAAAAAAA', CONSENT, hash(2)]);
      await assert.rejects(db.query(INSERT, ['v0.9-code', 'BBBBBBBBBBBBBBBBBBBB', CONSENT, hash(3)]), /wcr_contributions_scene_version/);
      await db.query('RESET ROLE');
      const rows = async () => (await db.query(`SELECT encode(deletion_receipt_hash, 'hex') AS receipt, scene_version, answer_code, created_at, expires_at
        FROM public.wedding_code_research_contributions ORDER BY 1`)).rows;
      const existing = await rows();
      assert.equal(existing.length, 2);

      const one = async text => (await db.query(`SELECT ${text} AS value`)).rows[0].value;
      const before = { catalog: await one(weddingCodeResearchTargetCatalogSql()), preservedCatalogSha: await one(weddingCodeResearchPreservedCatalogSql()),
        ledgerSha: await one(weddingCodeSceneVersionLedgerDigestSql()), migration: null };
      validateWeddingCodeSceneVersionCatalog(before.catalog, predecessorSql, false);
      assert.throws(() => validateWeddingCodeSceneVersionCatalog(before.catalog, predecessorSql, true), { code: 'WEDDING_CODE_SCENE_VERSION_TARGET_CATALOG_DRIFT' });
      const observation = (await db.query(buildWeddingCodeSceneVersionObservationSql())).find(result => result.rows?.[0]?.observation)?.rows[0].observation;
      assert.equal(observation.systemIdentifier, owned.system); assert.equal(observation.readOnly, true);
      assert.match(observation.serverVersion, /^17\./); assert.equal(observation.currentUser, 'postgres');
      assert.equal(observation.preservedCatalogSha, before.preservedCatalogSha);
      assert.deepEqual(observation.catalog, before.catalog);
      assert.equal(observation.migration, null);
      assert.equal(observation.predecessor.version, '20260915130000');
      // 합성 PG17은 운영과 다른 system identifier를 가진다. 고정 identity 조회만 합성값으로 대체한다.
      const bundle = rehearsal => buildWeddingCodeSceneVersionMutationSql({ sql, predecessorSql, before, rehearsal,
        deadline: new Date(Date.now() + 120_000).toISOString() }).replace(`<>'7581440907192989109'`, `<>'${owned.system}'`);

      await db.query(bundle(true));
      assert.deepEqual(await one(weddingCodeResearchTargetCatalogSql()), before.catalog);
      assert.equal(await one(weddingCodeResearchPreservedCatalogSql()), before.preservedCatalogSha);
      assert.equal(await one(weddingCodeSceneVersionLedgerDigestSql()), before.ledgerSha);

      // 저장 중인 트랜잭션이 테이블을 잡고 있으면 ALTER는 lock_timeout(5s) 안에 포기하고 아무것도 바꾸지 않는다.
      await peer.connect();
      await peer.query('BEGIN; SET LOCAL ROLE service_role');
      await peer.query(INSERT, ['v0.8-code', 'CCCCCCCCCCCCCCCCCCCC', CONSENT, hash(4)]);
      const started = Date.now();
      await assert.rejects(db.query(bundle(false)), error => error.code === '55P03');
      const waited = Date.now() - started;
      assert.ok(waited >= 4_000 && waited < 20_000, `lock wait ${waited}ms`);
      await db.query('ROLLBACK');
      await peer.query('COMMIT');
      assert.deepEqual(await one(weddingCodeResearchTargetCatalogSql()), before.catalog);
      assert.equal(await one(weddingCodeSceneVersionLedgerDigestSql()), before.ledgerSha);
      await db.query('DELETE FROM public.wedding_code_research_contributions WHERE deletion_receipt_hash = $1', [hash(4)]);
      assert.deepEqual(await rows(), existing);

      await db.query(bundle(false));
      validateWeddingCodeSceneVersionCatalog(await one(weddingCodeResearchTargetCatalogSql()), predecessorSql, true);
      assert.equal(await one(weddingCodeResearchPreservedCatalogSql()), before.preservedCatalogSha);
      assert.equal(await one(weddingCodeSceneVersionLedgerDigestSql(true)), before.ledgerSha);
      assert.deepEqual((await db.query("SELECT pg_get_constraintdef(oid, true) AS def FROM pg_constraint WHERE conname='wcr_contributions_scene_version'")).rows,
        [{ def: "CHECK (scene_version = ANY (ARRAY['v0.8-code'::text, 'v0.9-code'::text]))" }]);
      assert.deepEqual((await db.query('SELECT * FROM public.unrelated_rows')).rows, [{ id: 1, note: 'synthetic preserved' }]);
      assert.deepEqual(await rows(), existing);
      assert.equal((await db.query("SELECT statements[1] AS sql FROM supabase_migrations.schema_migrations WHERE version='20260917090000'")).rows[0].sql, sql);

      // 실제 역할 경계는 그대로다: service_role은 함수로만 v0.9를 저장하고 테이블을 직접 못 읽는다. anon은 함수도 못 부른다.
      await db.query('SET ROLE service_role');
      await db.query(INSERT, ['v0.9-code', 'BBBBBBBBBBBBBBBBBBBB', CONSENT, hash(3)]);
      await db.query(INSERT, ['v0.8-code', 'DDDDDDDDDDDDDDDDDDDD', CONSENT, hash(5)]);
      for (const scene of ['v1.0-code', '', 'v0.9', 'V0.9-CODE', 'v0.9-code ']) {
        await assert.rejects(db.query(INSERT, [scene, 'ABCD-ABCD-ABCD-ABCD-', CONSENT, hash(6)]), /wcr_contributions_scene_version/, scene);
      }
      for (const answer of ['ABCD-ABCD-ABCD-ABCD', '--------------------', 'abcd-abcd-abcd-abcd-']) {
        await assert.rejects(db.query(INSERT, ['v0.9-code', answer, CONSENT, hash(6)]), /wcr_contributions_answer_code/, answer);
      }
      await assert.rejects(db.query('SELECT count(*) FROM public.wedding_code_research_contributions'), /permission denied/);
      await db.query('SET ROLE anon');
      await assert.rejects(db.query(INSERT, ['v0.9-code', 'ABCD-ABCD-ABCD-ABCD-', CONSENT, hash(7)]), /permission denied/);
      await db.query('RESET ROLE');
      assert.deepEqual((await db.query(`SELECT scene_version, count(*)::int AS n FROM public.wedding_code_research_contributions
        GROUP BY 1 ORDER BY 1`)).rows, [{ scene_version: 'v0.8-code', n: 3 }, { scene_version: 'v0.9-code', n: 1 }]);

      // 적용 뒤 권한·CHECK가 어긋나면 catalog 판정이 거절한다.
      await db.query('BEGIN');
      await db.query(`ALTER TABLE public.wedding_code_research_contributions DROP CONSTRAINT wcr_contributions_scene_version,
        ADD CONSTRAINT wcr_contributions_scene_version CHECK (scene_version ~ '^v0[.][0-9]-code$') NOT VALID`);
      assert.throws(() => validateWeddingCodeSceneVersionCatalog(null, predecessorSql, true));
      const widened = await one(weddingCodeResearchTargetCatalogSql());
      assert.throws(() => validateWeddingCodeSceneVersionCatalog(widened, predecessorSql, true), { code: 'WEDDING_CODE_SCENE_VERSION_TARGET_CATALOG_DRIFT' });
      await db.query('ROLLBACK');
      await db.query('GRANT SELECT ON public.wedding_code_research_contributions TO authenticated');
      const drifted = await one(weddingCodeResearchTargetCatalogSql());
      assert.throws(() => validateWeddingCodeSceneVersionCatalog(drifted, predecessorSql, true), { code: 'WEDDING_CODE_SCENE_VERSION_TARGET_CATALOG_DRIFT' });
    } finally {
      await peer.end().catch(() => {});
      await owned.close();
    }
  });
