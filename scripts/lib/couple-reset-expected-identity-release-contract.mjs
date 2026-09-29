import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { digest, pinnedArtifact, requireRelease, same } from './current-baseline-release-contract.mjs';
import { loadDeletionAuditNullabilityHistoricalReleasePlan } from './account-deletion-audit-nullability-release-contract.mjs';
import { loadEffectiveBudgetDecisionHistoricalRelease } from './amora-budget-decision-effective-release-contract.mjs';

export const COUPLE_RESET_EXPECTED_IDENTITY_CONTRACT_FILE = 'supabase/release-contracts/couple-reset-expected-identity-v1.json';
const CONTRACT_SHA = '0c4cbfc9af05ae2b2924370b552a7c9db6836675f6ede8d2915d772fec9cb281';
const PREDECESSOR = Object.freeze({ file: 'supabase/release-contracts/account-deletion-audit-nullability-v1.json',
  sha256: 'ad50817b53ee069e99b8dcd5b8b5856b5c9691a32d5dd1ff15daccb5a1c4d73a' });
const PREDECESSOR_LOADER = Object.freeze({ file: 'scripts/lib/account-deletion-audit-nullability-release-contract.mjs',
  sha256: '0434dc864d0b3c2a9e254648239fdb4f115e0890bc91a30816cec6f5f86c607e' });
const MIGRATION_FILE = '20260928144843_couple_reset_expected_identity.sql';
const VERIFICATION_TESTS = Object.freeze([
  'apps/web/src/lib/couples/__tests__/expectedCoupleResetMigration.test.ts',
  'scripts/tests/couple-reset-expected-identity-runtime.test.mjs',
  'scripts/tests/couple-reset-expected-identity-native.test.mjs',
  'scripts/tests/fixtures/couple-reset-expected-identity-native-database.mjs',
]);
const RUNTIME_FILE = 'scripts/lib/couple-reset-expected-identity-release.mjs';
const CATALOG_FILE = 'scripts/lib/couple-reset-expected-identity-catalog.mjs';
const CATALOG_FIXTURE = 'supabase/release-contracts/couple-reset-expected-identity-pg17-catalog-v1.json';
export const COUPLE_RESET_EXPECTED_IDENTITY_RUNTIME_POLICY = Object.freeze({
  productionTransport: 'read-only-inspection-only', productionMutations: 'blocked-before-io',
  localValidation: 'injected-query-with-no-production-authority',
  requiredGates: ['global-web-api-auth-db-storage-write-fence', 'db-backup', 'storage-original-backup',
    'original-restore-verification', 'rollback-artifact'],
  gateIntegration: 'not-implemented', uncertainOutcome: 'read-only-inspection-no-automatic-retry',
});
export const COUPLE_RESET_EXPECTED_IDENTITY_SCHEMA_CHANGE =
  'function:public.reset_expected_couple_membership(uuid,uuid):add-authenticated-wrapper';
export const COUPLE_RESET_EXPECTED_IDENTITY_SCOPE = Object.freeze({
  dataRows: 'unchanged-during-migration', auth: 'unchanged', storage: 'unchanged', existingJobs: 'unchanged',
  tables: 'unchanged', tableAcl: 'unchanged', tableRls: 'unchanged', indexes: 'unchanged',
  triggers: 'unchanged', constraints: 'unchanged',
  function: 'public.reset_expected_couple_membership(uuid,uuid)', functionOwner: 'postgres', functionSecurity: 'definer',
  executeRoles: ['authenticated'], deniedExecuteRoles: ['PUBLIC', 'anon', 'service_role'],
  delegatedFunction: 'public.reset_current_couple_membership()', existingFunction: 'unchanged',
  actor: 'auth.uid-and-authenticated-role', confirmation: 'null-safe-expected-user-and-couple',
  locking: 'profile-for-update-before-confirmation-and-nested-reset', searchPath: ['pg_catalog', 'public'],
  functionLockTimeout: '5s', functionStatementTimeout: '15s', migrationLockTimeout: '5s', migrationStatementTimeout: '30s',
  migrationExecution: 'single-transaction-required',
  rollback: 'transaction-rollback-before-commit-forward-fix-after-commit', fullOriginalRestore: 'not-proven',
});
const REQUIRED_LOCAL_CHECKS = Object.freeze([
  'expected-actor-and-couple-mismatch-write-zero',
  'both-member-roles-reset-through-existing-rpc',
  'stale-couple-retry-rejected-and-explicit-null-retry-accepted',
  'missing-profile-write-zero',
  'nested-reset-failure-atomic-rollback',
  'anon-and-service-role-execute-denied',
  'missing-uid-and-wrong-claim-role-denied',
  'definer-namespace-and-timeouts-catalog-verified',
  'native-pg17-preview-rollback-and-exact-normalized-ledger-commit',
  'native-pg17-stale-actor-and-duplicate-reset-races',
  'native-pg17-in-flight-legacy-reset-without-deadlock',
  'native-pg17-owner-view-and-row-drift-rejected-atomically',
  'production-mutation-gated-before-runtime-io',
  'durable-intent-source-recheck-and-no-uncertain-retry',
]);

/** 정확한 SQL 해시와 별도로, 승인한 권한·잠금·위임 순서가 무엇인지 검증한다. */
export function assertCoupleResetExpectedIdentitySql(text) {
  const code = 'COUPLE_RESET_SQL_SCOPE_CHANGED';
  requireRelease(typeof text === 'string' && !text.includes('\r') && text.endsWith('\n'), code);
  const sql = text.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim();
  const ordered = [
    "SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '30s';",
    'CREATE OR REPLACE FUNCTION public.reset_expected_couple_membership( p_expected_user_id uuid, p_expected_couple_id uuid ) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER',
    "SET search_path = pg_catalog, public SET lock_timeout = '5s' SET statement_timeout = '15s'",
    'v_user_id uuid := auth.uid();',
    "IF v_user_id IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501'; END IF;",
    'SELECT profile.couple_id INTO v_couple_id FROM public.profiles AS profile WHERE profile.id = v_user_id FOR UPDATE;',
    "IF NOT FOUND THEN RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'P0002'; END IF;",
    "IF p_expected_user_id IS DISTINCT FROM v_user_id THEN RAISE EXCEPTION 'couple_reset_user_changed' USING ERRCODE = 'P0001'; END IF;",
    "IF p_expected_couple_id IS DISTINCT FROM v_couple_id THEN RAISE EXCEPTION 'couple_reset_couple_changed' USING ERRCODE = 'P0001'; END IF;",
    'RETURN public.reset_current_couple_membership();',
    'ALTER FUNCTION public.reset_expected_couple_membership(uuid, uuid) OWNER TO postgres;',
    'REVOKE ALL ON FUNCTION public.reset_expected_couple_membership(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;',
    'GRANT EXECUTE ON FUNCTION public.reset_expected_couple_membership(uuid, uuid) TO authenticated;',
    "IF NOT has_function_privilege('authenticated', 'public.reset_expected_couple_membership(uuid,uuid)', 'EXECUTE') OR has_function_privilege('anon', 'public.reset_expected_couple_membership(uuid,uuid)', 'EXECUTE') OR has_function_privilege('service_role', 'public.reset_expected_couple_membership(uuid,uuid)', 'EXECUTE') THEN RAISE EXCEPTION 'EXPECTED_COUPLE_RESET_ACL_INVALID'; END IF;",
  ];
  let end = 0;
  for (const statement of ordered) {
    const index = sql.indexOf(statement, end);
    requireRelease(index >= end, code);
    end = index + statement.length;
  }
  requireRelease((sql.match(/\bCREATE\b/g) ?? []).length === 1
    && (sql.match(/\bALTER\b/g) ?? []).length === 1
    && (sql.match(/\bGRANT\b/g) ?? []).length === 1
    && (sql.match(/\bREVOKE\b/g) ?? []).length === 1
    && (sql.match(/RETURN public\.reset_current_couple_membership\(\);/g) ?? []).length === 1
    && !/\b(?:INSERT|DELETE|TRUNCATE|DROP|EXECUTE\s+(?:FORMAT|IMMEDIATE)|UPDATE\s+public\.)\b/i.test(sql), code);
}

// 240 경로의 exact-directory 검사는 그대로다. 그 고정 원문을 읽는 historical
// 경로를 사용해 검토한 전신 전체에 새 SQL 하나만 잇는다. 원격 적용 승인이 아니다.
export function loadCoupleResetExpectedIdentityReleasePlan(repoRoot) {
  const bytes = pinnedArtifact(repoRoot, { file: COUPLE_RESET_EXPECTED_IDENTITY_CONTRACT_FILE, sha256: CONTRACT_SHA });
  const contract = JSON.parse(bytes);
  requireRelease(contract.version === 1 && contract.kind === 'couple-reset-expected-identity-static-successor'
    && contract.release === 'couple-reset-expected-identity-20260928'
    && contract.status === 'requires-global-gates-and-runtime-evidence'
    && contract.productionApplyImplemented === true && contract.productionExecutionEnabled === false
    && contract.runtimeEvidenceVerified === false && contract.releaseAuthorized === false,
  'COUPLE_RESET_CONTRACT_INVALID');
  same(contract.predecessor, PREDECESSOR, 'COUPLE_RESET_PREDECESSOR_CHANGED');
  same(contract.predecessorLoader, PREDECESSOR_LOADER, 'COUPLE_RESET_PREDECESSOR_CHANGED');
  pinnedArtifact(repoRoot, PREDECESSOR);
  pinnedArtifact(repoRoot, PREDECESSOR_LOADER);
  const predecessor = loadDeletionAuditNullabilityHistoricalReleasePlan(repoRoot);
  // 로컬의 미적용 역사 SQL 12개와 원격 전용 역사 행을 보존한다. 파일 수는 원장 행 수가 아니다.
  const ledgerBase = loadEffectiveBudgetDecisionHistoricalRelease(repoRoot);
  same(contract.ledgerBaseline, ledgerBase.effectiveOperatingBaseline, 'COUPLE_RESET_LEDGER_BASELINE_CHANGED');
  const expectedLedgerVersions = [...ledgerBase.baseline.ledger.map(row => row.version),
    ...predecessor.followupMigrations.map(row => row.version)];
  requireRelease(contract.reviewedPredecessorLedgerCount === 229 && expectedLedgerVersions.length === 229
    && expectedLedgerVersions.every((version, index) => /^\d{14}$/.test(version)
      && (index === 0 || version > expectedLedgerVersions[index - 1]))
    && expectedLedgerVersions.at(-1) === '20260928073546', 'COUPLE_RESET_LEDGER_BASELINE_CHANGED');
  same(contract.runtimePolicy, COUPLE_RESET_EXPECTED_IDENTITY_RUNTIME_POLICY, 'COUPLE_RESET_RUNTIME_POLICY_CHANGED');
  for (const [key, file] of [['runtime', RUNTIME_FILE], ['catalog', CATALOG_FILE], ['catalogFixture', CATALOG_FIXTURE]]) {
    requireRelease(contract[key]?.file === file, 'COUPLE_RESET_RUNTIME_SCOPE_CHANGED');
    pinnedArtifact(repoRoot, contract[key]);
  }
  const predecessorMigration = predecessor.contract.migrations[0];
  same(contract.predecessorMigration, { ...predecessorMigration, file: `supabase/migrations/${predecessorMigration.file}` },
    'COUPLE_RESET_PREDECESSOR_CHANGED');
  pinnedArtifact(repoRoot, contract.predecessorMigration);
  requireRelease(contract.projectRef === predecessor.contract.projectRef
    && contract.systemIdentifier === predecessor.contract.systemIdentifier, 'COUPLE_RESET_DESTINATION_CHANGED');
  same(contract.allowedSchemaChanges, [COUPLE_RESET_EXPECTED_IDENTITY_SCHEMA_CHANGE], 'COUPLE_RESET_SCOPE_CHANGED');
  same(contract.scope, COUPLE_RESET_EXPECTED_IDENTITY_SCOPE, 'COUPLE_RESET_SCOPE_CHANGED');
  same(contract.requiredLocalChecks, REQUIRED_LOCAL_CHECKS, 'COUPLE_RESET_LOCAL_CHECKS_CHANGED');
  same(contract.verificationTests?.map(pin => pin.file), VERIFICATION_TESTS, 'COUPLE_RESET_LOCAL_CHECKS_CHANGED');
  for (const pin of contract.verificationTests) pinnedArtifact(repoRoot, pin);
  requireRelease(contract.reviewedPredecessorMigrationCount === 240 && predecessor.migrationCount === 240
    && predecessor.followupMigrations.length === 14 && contract.migrations?.length === 1
    && contract.migrations[0].file === MIGRATION_FILE, 'COUPLE_RESET_MIGRATION_SET_CHANGED');
  const reviewed = [...predecessor.reviewedMigrations, ...contract.migrations].sort((a, b) => a.file.localeCompare(b.file));
  requireRelease(reviewed.length === 241 && reviewed.at(-1).file === MIGRATION_FILE, 'COUPLE_RESET_MIGRATION_SET_CHANGED');
  same(readdirSync(join(repoRoot, 'supabase/migrations')).filter(file => /\.sql$/i.test(file)).sort(),
    reviewed.map(pin => pin.file), 'NEW_MIGRATION_NOT_REVIEWED');
  const sql = pinnedArtifact(repoRoot, { ...contract.migrations[0], file: `supabase/migrations/${MIGRATION_FILE}` });
  assertCoupleResetExpectedIdentitySql(sql.toString('utf8'));
  return { contract, contractSha256: digest(bytes), migrationSha256: digest(sql), migrationCount: reviewed.length,
    expectedLedgerVersions,
    reviewedMigrations: reviewed, followupMigrations: [...predecessor.followupMigrations,
      { file: MIGRATION_FILE, version: MIGRATION_FILE.slice(0, 14) }],
    staticVerified: true, productionApplyImplemented: true, productionExecutionEnabled: false, runtimeEvidenceVerified: false,
    releaseAuthorized: false, remoteWritesPerformed: false };
}
