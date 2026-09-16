import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { digest, pinnedArtifact, requireRelease, same } from './current-baseline-release-contract.mjs';
import { loadNotApplicableStatusHistoricalReleasePlan } from './amora-not-applicable-status-release-contract.mjs';

export const WEDDING_CODE_RESEARCH_CONTRACT_FILE = 'supabase/release-contracts/wedding-code-research-contributions-v1.json';
const CONTRACT_SHA = '7230b2d9b698c1b9cff230dcf4fe88213273f3802fdf88698937cde16b8110ac';
const MIGRATION_FILE = '20260915130000_wedding_code_research_contributions.sql';
const PREDECESSOR_CONTRACT_FILE = 'supabase/release-contracts/amora-not-applicable-status-v1.json';
export const WEDDING_CODE_RESEARCH_SCOPE = Object.freeze({
  newTables: ['public.wedding_code_research_contributions', 'public.wedding_code_research_deletion_tombstones'],
  newFunctions: ['public.insert_wedding_code_research_contribution(text,text,text,bytea)',
    'public.delete_wedding_code_research_contribution(bytea)', 'public.purge_expired_wedding_code_research_contributions()'],
  tableAccess: 'owner-only-rls-enabled-no-policies', functionExecute: 'service_role-only',
  contributionRetentionDays: 60, tombstoneRetentionDays: 30, timestampPrecision: 'utc-day',
  duplicateReceipt: 'unique-violation-23505', purgeRemovesTombstonedContributions: true,
  personalData: 'none', joinKeys: 'none', retiredCollectionObjects: 'untouched',
  existingTables: 'unchanged', existingFunctions: 'unchanged', dataRows: 'unchanged',
});

// 검토한 SQL의 뼈대. 새 테이블 두 개·인덱스 두 개·함수 세 개만 만들고, 실행 권한은 service_role에만 준다.
const HEADER = /^(?:-- [^\n]*\n)+BEGIN;\nSET LOCAL lock_timeout = '5s';\nSET LOCAL statement_timeout = '30s';\n\n/;
export const WEDDING_CODE_RESEARCH_CREATE_LINES = Object.freeze([
  'CREATE TABLE public.wedding_code_research_contributions (',
  'CREATE INDEX wcr_contributions_expires_at_idx',
  'CREATE TABLE public.wedding_code_research_deletion_tombstones (',
  'CREATE INDEX wcr_tombstones_expires_at_idx',
  'CREATE FUNCTION public.insert_wedding_code_research_contribution(',
  'CREATE FUNCTION public.delete_wedding_code_research_contribution(p_deletion_receipt_hash bytea)',
  'CREATE FUNCTION public.purge_expired_wedding_code_research_contributions()',
]);
export const WEDDING_CODE_RESEARCH_GRANT_LINES = Object.freeze([
  'GRANT EXECUTE ON FUNCTION public.insert_wedding_code_research_contribution(text, text, text, bytea) TO service_role;',
  'GRANT EXECUTE ON FUNCTION public.delete_wedding_code_research_contribution(bytea) TO service_role;',
  'GRANT EXECUTE ON FUNCTION public.purge_expired_wedding_code_research_contributions() TO service_role;',
]);
export const WEDDING_CODE_RESEARCH_REQUIRED_CLAUSES = Object.freeze([
  "CONSTRAINT wcr_contributions_scene_version CHECK (scene_version = 'v0.8-code'),",
  "CONSTRAINT wcr_contributions_answer_code CHECK (answer_code ~ '^[A-D-]{20}$' AND answer_code ~ '[A-D]'),",
  "CONSTRAINT wcr_contributions_consent_version CHECK (consent_version ~ '^wc-research-consent-v[1-9][0-9]*$'),",
  'CONSTRAINT wcr_contributions_receipt_hash_key UNIQUE',
  'CONSTRAINT wcr_contributions_receipt_hash_length CHECK (octet_length(deletion_receipt_hash) = 32),',
  "CHECK (expires_at > created_at AND expires_at <= created_at + interval '60 days')",
  "created_at timestamptz NOT NULL DEFAULT date_trunc('day', now(), 'UTC')\n",
  "CONSTRAINT wcr_contributions_created_at_day CHECK (created_at = date_trunc('day', created_at, 'UTC')),",
  "expires_at timestamptz NOT NULL DEFAULT (date_trunc('day', now(), 'UTC') + interval '60 days'),",
  'CONSTRAINT wcr_tombstones_receipt_hash_length CHECK (octet_length(deletion_receipt_hash) = 32),',
  "deleted_at timestamptz NOT NULL DEFAULT date_trunc('day', now(), 'UTC')\n",
  "CONSTRAINT wcr_tombstones_deleted_at_day CHECK (deleted_at = date_trunc('day', deleted_at, 'UTC')),",
  "expires_at timestamptz NOT NULL DEFAULT (date_trunc('day', now(), 'UTC') + interval '30 days')\n",
  "WHERE tombstone.deletion_receipt_hash = contribution.deletion_receipt_hash",
  'ALTER TABLE public.wedding_code_research_contributions ENABLE ROW LEVEL SECURITY;',
  'ALTER TABLE public.wedding_code_research_deletion_tombstones ENABLE ROW LEVEL SECURITY;',
  'REVOKE ALL ON TABLE public.wedding_code_research_contributions FROM PUBLIC, anon, authenticated, service_role;',
  'REVOKE ALL ON TABLE public.wedding_code_research_deletion_tombstones FROM PUBLIC, anon, authenticated, service_role;',
  'REVOKE ALL ON FUNCTION public.insert_wedding_code_research_contribution(text, text, text, bytea)\n  FROM PUBLIC, anon, authenticated;',
  'REVOKE ALL ON FUNCTION public.delete_wedding_code_research_contribution(bytea)\n  FROM PUBLIC, anon, authenticated;',
  'REVOKE ALL ON FUNCTION public.purge_expired_wedding_code_research_contributions()\n  FROM PUBLIC, anon, authenticated;',
  "RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'WEDDING_CODE_RESEARCH_CONTRIBUTION_REJECTED';",
  'ON CONFLICT (deletion_receipt_hash) DO NOTHING;',
  'DO $verify_wedding_code_research$',
]);
// 과거 수집 객체 이름, 계정·네트워크 식별자, 정책·권한 우회 구문은 이 SQL에 나오면 안 된다.
const FORBIDDEN = [/wedding_code_response/i, /\bCREATE\s+POLICY\b/i, /\bSECURITY\s+INVOKER\b/i, /\bauth\./i,
  /schema_migrations/i, /\buser_id\b/i, /\buser_agent\b/i, /\bip_address\b/i, /\binet\b/i, /\bcouple/i, /\bamora/i,
  /\bprofiles\b/i, /\bREFERENCES\s+\w+\./i, /\bALTER\s+DEFAULT\s+PRIVILEGES\b/i, /\bSET\s+(?:LOCAL\s+)?ROLE\b/i,
  /\bFORCE\s+ROW\b/i, /\bDISABLE\s+ROW\b/i, /\bDROP\b/i, /\bTO\s+(?:PUBLIC|anon|authenticated)\b/i];
const count = (text, pattern) => [...text.matchAll(pattern)].length;

export function assertWeddingCodeResearchSqlScope(text) {
  const ok = typeof text === 'string' && !text.includes('\r') && HEADER.test(text) && text.endsWith('\n\nCOMMIT;\n')
    && count(text, /\bBEGIN;/g) === 1 && count(text, /\bCOMMIT\b/gi) === 1 && count(text, /\bROLLBACK\b/gi) === 0
    && same_(text.match(/^CREATE [^\n]*$/gm), WEDDING_CODE_RESEARCH_CREATE_LINES) && count(text, /\bCREATE\b/gi) === WEDDING_CODE_RESEARCH_CREATE_LINES.length
    && same_(text.match(/^GRANT [^\n]*$/gm), WEDDING_CODE_RESEARCH_GRANT_LINES) && count(text, /\bGRANT\b/gi) === WEDDING_CODE_RESEARCH_GRANT_LINES.length
    && count(text, /^ALTER TABLE [^\n]* ENABLE ROW LEVEL SECURITY;$/gm) === 2 && count(text, /\bALTER\b/gi) === 2
    && count(text, /^LANGUAGE plpgsql\nSECURITY DEFINER\nSET search_path = ''\nAS \$function\$$/gm) === 3
    && count(text, /\bSECURITY\s+DEFINER\b/gi) === 3 && count(text, /\$function\$;/g) === 3
    && WEDDING_CODE_RESEARCH_REQUIRED_CLAUSES.every(clause => text.includes(clause))
    // 시각 컬럼은 UTC 날짜만 받는다. now()를 날짜로 자르지 않고 그대로 쓰는 곳은 함수 본문의 만료 비교뿐이다.
    && count(text, /\bnow\(\)/g) === count(text, /date_trunc\('day', now\(\), 'UTC'\)/g) + count(text, /expires_at <= pg_catalog\.now\(\)/g)
    // 중복 hash는 UNIQUE 위반(23505)으로 올라가야 한다. 삭제의 tombstone 외에는 충돌을 삼키거나 예외를 바꾸지 않는다.
    && count(text, /\bON\s+CONFLICT\b/gi) === 1 && !/\bEXCEPTION\s+WHEN\b/i.test(text) && !/'23505'|unique_violation/i.test(text)
    && !FORBIDDEN.some(pattern => pattern.test(text));
  requireRelease(ok, 'WEDDING_CODE_RESEARCH_SQL_SCOPE_CHANGED');
  return text;
}
function same_(actual, expected) { return Array.isArray(actual) && actual.length === expected.length && actual.every((line, i) => line === expected[i]); }

// 233 선행 원문과 계약을 그대로 보존하고, 익명 연구 기여 저장소 migration 한 건만 추가한다.
// 로컬 검증만 수행한다. 운영 적용·런타임 증거·배포 승인을 뜻하지 않는다.
export function loadWeddingCodeResearchReleasePlan(repoRoot) {
  const bytes = pinnedArtifact(repoRoot, { file: WEDDING_CODE_RESEARCH_CONTRACT_FILE, sha256: CONTRACT_SHA });
  const contract = JSON.parse(bytes);
  requireRelease(contract.version === 1 && contract.kind === 'wedding-code-research-contributions-static-successor'
    && contract.release === 'wedding-code-research-contributions-20260915'
    && contract.status === 'requires-scoped-runtime-evidence' && contract.productionApplyImplemented === true
    && contract.runtimeEvidenceVerified === false, 'WEDDING_CODE_RESEARCH_CONTRACT_INVALID');
  const predecessor = loadNotApplicableStatusHistoricalReleasePlan(repoRoot);
  same(contract.predecessor, { file: PREDECESSOR_CONTRACT_FILE, sha256: predecessor.contractSha256 }, 'WEDDING_CODE_RESEARCH_PREDECESSOR_CHANGED');
  requireRelease(contract.projectRef === predecessor.contract.projectRef && contract.systemIdentifier === predecessor.contract.systemIdentifier,
    'WEDDING_CODE_RESEARCH_DESTINATION_CHANGED');
  same(contract.scope, WEDDING_CODE_RESEARCH_SCOPE, 'WEDDING_CODE_RESEARCH_SCOPE_CHANGED');
  requireRelease(contract.reviewedPredecessorMigrationCount === 233 && predecessor.migrationCount === 233
    && contract.migrations?.length === 1 && contract.migrations[0].file === MIGRATION_FILE, 'WEDDING_CODE_RESEARCH_MIGRATION_SET_CHANGED');
  same(contract.predecessorMigration, { ...predecessor.contract.migrations[0], file: `supabase/migrations/${predecessor.contract.migrations[0].file}` },
    'WEDDING_CODE_RESEARCH_PREDECESSOR_CHANGED');
  requireRelease(contract.runtime?.file === 'scripts/lib/wedding-code-research-contributions-release.mjs', 'WEDDING_CODE_RESEARCH_IMPLEMENTATION_CHANGED');
  pinnedArtifact(repoRoot, contract.runtime);
  const reviewed = [...predecessor.reviewedMigrations, ...contract.migrations].sort((a, b) => a.file.localeCompare(b.file));
  same(readdirSync(join(repoRoot, 'supabase/migrations')).filter(file => /\.sql$/i.test(file)).sort(), reviewed.map(pin => pin.file),
    'NEW_MIGRATION_NOT_REVIEWED');
  for (const pin of reviewed) pinnedArtifact(repoRoot, { ...pin, file: `supabase/migrations/${pin.file}` });
  requireRelease(reviewed.at(-1)?.file === MIGRATION_FILE && /^\d{14}_[a-z0-9][a-z0-9_.-]*\.sql$/.test(MIGRATION_FILE),
    'WEDDING_CODE_RESEARCH_MIGRATION_SET_CHANGED');
  const sql = pinnedArtifact(repoRoot, { ...contract.migrations[0], file: `supabase/migrations/${MIGRATION_FILE}` });
  assertWeddingCodeResearchSqlScope(sql.toString('utf8'));
  return { contract, contractSha256: digest(bytes), migrationSha256: digest(sql), migrationCount: reviewed.length, reviewedMigrations: reviewed,
    followupMigrations: [...predecessor.followupMigrations, { file: MIGRATION_FILE, version: MIGRATION_FILE.slice(0, 14) }],
    staticVerified: true, productionApplyImplemented: true, runtimeEvidenceVerified: false, releaseAuthorized: false, remoteWritesPerformed: false };
}
