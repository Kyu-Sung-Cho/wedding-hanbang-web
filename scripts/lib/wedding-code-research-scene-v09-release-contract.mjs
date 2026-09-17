import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { digest, pinnedArtifact, requireRelease, same } from './current-baseline-release-contract.mjs';
import { loadWeddingCodeResearchHistoricalReleasePlan } from './wedding-code-research-contributions-release-contract.mjs';

export const WEDDING_CODE_SCENE_VERSION_CONTRACT_FILE = 'supabase/release-contracts/wedding-code-research-scene-v09-v1.json';
const CONTRACT_SHA = '46017ac2e9a4e404a6c171c79793dd57547a5649124ed5163dd99b8abe3a04c6';
const MIGRATION_FILE = '20260917090000_wedding_code_research_scene_v09.sql';
const PREDECESSOR_CONTRACT_FILE = 'supabase/release-contracts/wedding-code-research-contributions-v1.json';
const RUNTIME_FILE = 'scripts/lib/wedding-code-research-scene-v09-release.mjs';
export const WEDDING_CODE_SCENE_VERSION_SCOPE = Object.freeze({
  alterTable: 'public.wedding_code_research_contributions',
  replaceConstraint: 'wcr_contributions_scene_version',
  previousSceneVersions: ['v0.8-code'],
  acceptedSceneVersions: ['v0.8-code', 'v0.9-code'],
  change: 'widen-only', answerCode: 'unchanged', otherConstraints: 'unchanged',
  tableAccess: 'unchanged', functionExecute: 'unchanged', existingFunctions: 'unchanged',
  newObjects: 'none', dataRows: 'unchanged', analysis: 'separate-per-scene-version',
  rollback: 'disable-contribution-flag-never-renarrow',
});

// 새 CHECK를 PostgreSQL 17이 역파싱한 문자열. 적용 뒤 catalog와 SQL 안의 검증 블록이 이 값과 같아야 한다.
export const WEDDING_CODE_SCENE_VERSION_CHECK_DEFINITION =
  "CHECK (scene_version = ANY (ARRAY['v0.8-code'::text, 'v0.9-code'::text]))";
export const WEDDING_CODE_SCENE_VERSION_PREVIOUS_CHECK_DEFINITION = "CHECK (scene_version = 'v0.8-code'::text)";
// 234 원문의 소유자 권한 함수 본문(prosrc) MD5. 이 migration은 함수를 바꾸지 않으므로 적용 뒤에도 같아야 한다.
export const WEDDING_CODE_SCENE_VERSION_FUNCTION_BODY_MD5 = Object.freeze({
  'public.insert_wedding_code_research_contribution(text,text,text,bytea)': '6d85d70bfa4f428b4eeaeb97f2ee8817',
  'public.delete_wedding_code_research_contribution(bytea)': '8a8b384d47fcf3e3e0388c5f1e4268a6',
  'public.purge_expired_wedding_code_research_contributions()': '32526988ee690824453ecdb74be707da',
});

const HEADER = /^(?:-- [^\n]*\n)+BEGIN;\nSET LOCAL lock_timeout = '5s';\nSET LOCAL statement_timeout = '30s';\n\n/;
const sqlLiteral = value => `'${value.replaceAll("'", "''")}'`;
// 허용하는 유일한 DDL. 장면 버전 CHECK 하나를 지우고 같은 이름으로 두 값만 받게 다시 만든다.
export const WEDDING_CODE_SCENE_VERSION_ALTER = [
  'ALTER TABLE public.wedding_code_research_contributions',
  '  DROP CONSTRAINT wcr_contributions_scene_version,',
  "  ADD CONSTRAINT wcr_contributions_scene_version CHECK (scene_version IN ('v0.8-code', 'v0.9-code'));",
].join('\n');
// 적용 직후 같은 트랜잭션 안에서 도는 검증 블록. 어긋나면 RAISE EXCEPTION으로 전체를 되돌린다.
export const WEDDING_CODE_SCENE_VERSION_VERIFY = [
  'DO $verify_wedding_code_scene_v09$',
  'DECLARE',
  "  v_contributions regclass := pg_catalog.to_regclass('public.wedding_code_research_contributions');",
  '  v_table regclass;',
  '  v_role text;',
  '  v_function regprocedure;',
  '  v_body_md5 text;',
  'BEGIN',
  '  IF v_contributions IS NULL THEN',
  "    RAISE EXCEPTION 'WEDDING_CODE_SCENE_VERSION_TABLE_MISSING';",
  '  END IF;',
  '  IF (SELECT pg_catalog.array_agg(pg_catalog.pg_get_constraintdef(c.oid, true))',
  '      FROM pg_catalog.pg_constraint AS c',
  "      WHERE c.conrelid = v_contributions AND c.conname = 'wcr_contributions_scene_version'",
  "        AND c.contype = 'c' AND c.convalidated)",
  `     IS DISTINCT FROM ARRAY[${sqlLiteral(WEDDING_CODE_SCENE_VERSION_CHECK_DEFINITION)}] THEN`,
  "    RAISE EXCEPTION 'WEDDING_CODE_SCENE_VERSION_CHECK_UNEXPECTED';",
  '  END IF;',
  '  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_constraint AS c',
  "      WHERE c.conrelid = v_contributions AND c.contype <> 'n') <> 8 THEN",
  "    RAISE EXCEPTION 'WEDDING_CODE_SCENE_VERSION_CONSTRAINT_SET_CHANGED';",
  '  END IF;',
  '  FOREACH v_table IN ARRAY ARRAY[',
  '    v_contributions,',
  "    pg_catalog.to_regclass('public.wedding_code_research_deletion_tombstones')",
  '  ] LOOP',
  '    IF v_table IS NULL OR NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class AS c WHERE c.oid = v_table) THEN',
  "      RAISE EXCEPTION 'WEDDING_CODE_SCENE_VERSION_RLS_DISABLED';",
  '    END IF;',
  '    IF EXISTS (SELECT 1 FROM pg_catalog.pg_policy AS p WHERE p.polrelid = v_table) THEN',
  "      RAISE EXCEPTION 'WEDDING_CODE_SCENE_VERSION_POLICY_PRESENT';",
  '    END IF;',
  "    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP",
  '      IF pg_catalog.has_table_privilege(v_role, v_table,',
  "           'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN')",
  "         OR pg_catalog.has_any_column_privilege(v_role, v_table, 'SELECT, INSERT, UPDATE, REFERENCES') THEN",
  "        RAISE EXCEPTION 'WEDDING_CODE_SCENE_VERSION_TABLE_PRIVILEGE_OPEN';",
  '      END IF;',
  '    END LOOP;',
  '  END LOOP;',
  '  FOR v_function, v_body_md5 IN',
  '    SELECT pg_catalog.to_regprocedure(f.signature), f.body_md5',
  '    FROM (VALUES',
  Object.entries(WEDDING_CODE_SCENE_VERSION_FUNCTION_BODY_MD5)
    .map(([signature, bodyMd5]) => `      (${sqlLiteral(signature)}, ${sqlLiteral(bodyMd5)})`).join(',\n'),
  '    ) AS f(signature, body_md5)',
  '  LOOP',
  '    IF v_function IS NULL THEN',
  "      RAISE EXCEPTION 'WEDDING_CODE_SCENE_VERSION_FUNCTION_MISSING';",
  '    END IF;',
  "    IF NOT (SELECT p.prosecdef AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=\"\"']::text[]",
  '                   AND pg_catalog.md5(p.prosrc) = v_body_md5',
  '            FROM pg_catalog.pg_proc AS p WHERE p.oid = v_function) THEN',
  "      RAISE EXCEPTION 'WEDDING_CODE_SCENE_VERSION_FUNCTION_CHANGED';",
  '    END IF;',
  "    IF pg_catalog.has_function_privilege('anon', v_function, 'EXECUTE')",
  "       OR pg_catalog.has_function_privilege('authenticated', v_function, 'EXECUTE') THEN",
  "      RAISE EXCEPTION 'WEDDING_CODE_SCENE_VERSION_FUNCTION_PRIVILEGE_OPEN';",
  '    END IF;',
  "    IF NOT pg_catalog.has_function_privilege('service_role', v_function, 'EXECUTE') THEN",
  "      RAISE EXCEPTION 'WEDDING_CODE_SCENE_VERSION_FUNCTION_PRIVILEGE_MISSING';",
  '    END IF;',
  '  END LOOP;',
  'END',
  '$verify_wedding_code_scene_v09$;',
].join('\n');
// 주석 줄(`-- `로 시작)을 뺀 실행 원문 전체. 이 문자열과 한 글자라도 다르면 거절한다(허용 목록 = 이것 하나).
export const WEDDING_CODE_SCENE_VERSION_TRANSACTION = [
  "BEGIN;\nSET LOCAL lock_timeout = '5s';\nSET LOCAL statement_timeout = '30s';\n",
  `${WEDDING_CODE_SCENE_VERSION_ALTER}\n`,
  `${WEDDING_CODE_SCENE_VERSION_VERIFY}\n`,
  'COMMIT;\n',
].join('\n');
const executable = text => text.split('\n').filter(line => !line.startsWith('-- ')).join('\n');

export function assertWeddingCodeSceneVersionSqlScope(text) {
  const ok = typeof text === 'string' && !text.includes('\r') && HEADER.test(text) && text.endsWith('\n\nCOMMIT;\n')
    && executable(text) === WEDDING_CODE_SCENE_VERSION_TRANSACTION;
  requireRelease(ok, 'WEDDING_CODE_SCENE_VERSION_SQL_SCOPE_CHANGED');
  return text;
}

// 234 선행 원문과 계약을 그대로 보존하고, 장면 버전 CHECK를 넓히는 migration 한 건만 추가한다.
// 로컬 검증만 수행한다. 운영 적용·런타임 증거·배포 승인을 뜻하지 않는다.
export function loadWeddingCodeSceneVersionReleasePlan(repoRoot) {
  const bytes = pinnedArtifact(repoRoot, { file: WEDDING_CODE_SCENE_VERSION_CONTRACT_FILE, sha256: CONTRACT_SHA });
  const contract = JSON.parse(bytes);
  requireRelease(contract.version === 1 && contract.kind === 'wedding-code-research-scene-v09-static-successor'
    && contract.release === 'wedding-code-research-scene-v09-20260917'
    && contract.status === 'requires-scoped-runtime-evidence' && contract.productionApplyImplemented === true
    && contract.runtimeEvidenceVerified === false, 'WEDDING_CODE_SCENE_VERSION_CONTRACT_INVALID');
  const predecessor = loadWeddingCodeResearchHistoricalReleasePlan(repoRoot);
  same(contract.predecessor, { file: PREDECESSOR_CONTRACT_FILE, sha256: predecessor.contractSha256 }, 'WEDDING_CODE_SCENE_VERSION_PREDECESSOR_CHANGED');
  requireRelease(contract.projectRef === predecessor.contract.projectRef && contract.systemIdentifier === predecessor.contract.systemIdentifier,
    'WEDDING_CODE_SCENE_VERSION_DESTINATION_CHANGED');
  same(contract.scope, WEDDING_CODE_SCENE_VERSION_SCOPE, 'WEDDING_CODE_SCENE_VERSION_SCOPE_CHANGED');
  requireRelease(contract.reviewedPredecessorMigrationCount === 234 && predecessor.migrationCount === 234
    && contract.migrations?.length === 1 && contract.migrations[0].file === MIGRATION_FILE, 'WEDDING_CODE_SCENE_VERSION_MIGRATION_SET_CHANGED');
  same(contract.predecessorMigration, { ...predecessor.contract.migrations[0], file: `supabase/migrations/${predecessor.contract.migrations[0].file}` },
    'WEDDING_CODE_SCENE_VERSION_PREDECESSOR_CHANGED');
  requireRelease(contract.runtime?.file === RUNTIME_FILE, 'WEDDING_CODE_SCENE_VERSION_IMPLEMENTATION_CHANGED');
  pinnedArtifact(repoRoot, contract.runtime);
  const reviewed = [...predecessor.reviewedMigrations, ...contract.migrations].sort((a, b) => a.file.localeCompare(b.file));
  same(readdirSync(join(repoRoot, 'supabase/migrations')).filter(file => /\.sql$/i.test(file)).sort(), reviewed.map(pin => pin.file),
    'NEW_MIGRATION_NOT_REVIEWED');
  for (const pin of reviewed) pinnedArtifact(repoRoot, { ...pin, file: `supabase/migrations/${pin.file}` });
  requireRelease(reviewed.at(-1)?.file === MIGRATION_FILE && /^\d{14}_[a-z0-9][a-z0-9_.-]*\.sql$/.test(MIGRATION_FILE),
    'WEDDING_CODE_SCENE_VERSION_MIGRATION_SET_CHANGED');
  const sql = pinnedArtifact(repoRoot, { ...contract.migrations[0], file: `supabase/migrations/${MIGRATION_FILE}` });
  assertWeddingCodeSceneVersionSqlScope(sql.toString('utf8'));
  return { contract, contractSha256: digest(bytes), migrationSha256: digest(sql), migrationCount: reviewed.length, reviewedMigrations: reviewed,
    followupMigrations: [...predecessor.followupMigrations, { file: MIGRATION_FILE, version: MIGRATION_FILE.slice(0, 14) }],
    staticVerified: true, productionApplyImplemented: true, runtimeEvidenceVerified: false, releaseAuthorized: false, remoteWritesPerformed: false };
}
