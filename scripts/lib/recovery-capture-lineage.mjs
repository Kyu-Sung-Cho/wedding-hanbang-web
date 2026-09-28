import { loadBudgetDecisionHistoricalRelease } from './amora-budget-decision-release-contract.mjs';
import { loadDeletionAuditNullabilityReleasePlan } from './account-deletion-audit-nullability-release-contract.mjs';
import { digest, digestJson, pinnedArtifact, requireRelease, same } from './current-baseline-release-contract.mjs';
import { LEGACY_JOIN_ACL_PINS, LEGACY_JOIN_ACL_PROJECT_REF, LEGACY_JOIN_ACL_RELEASE_ID, LEGACY_JOIN_IDENTITY } from './legacy-couple-join-acl-release.mjs';
import { LEGACY_FITTING_ACL_PINS, LEGACY_FITTING_ACL_PROJECT_REF, LEGACY_FITTING_ACL_RELEASE_ID,
  LEGACY_FITTING_ACL_SYSTEM_IDENTIFIER } from './legacy-fitting-acl-release.mjs';

const SOURCE_PINS = Object.freeze({
  historicalLoader: { file: 'scripts/lib/amora-budget-decision-release-contract.mjs', sha256: 'a50410b3385abe720b4906b55ace02470dbe62725a1ad390b31725750220fe56' },
  currentLoader: { file: 'scripts/lib/account-deletion-audit-nullability-release-contract.mjs', sha256: '0434dc864d0b3c2a9e254648239fdb4f115e0890bc91a30816cec6f5f86c607e' },
  join: { file: 'scripts/lib/legacy-couple-join-acl-release.mjs', sha256: '80d190f00a87b759e10942bbb2711c03539e112891b9b8500e91b27353dee82a' },
  fitting: { file: 'scripts/lib/legacy-fitting-acl-release.mjs', sha256: '33504442c10ee78d50b4e9ded2bdb56b51445b817249b8e2a2337b08514d74df' },
  fittingContract: { file: 'supabase/release-contracts/legacy-fitting-acl-v1.json', sha256: 'f99120618fd1d7751cc53d81e56ea187c6d88a6727f2079605ef448add22e2ae' },
});
const APPENDED_FILES = Object.freeze([
  '20260910160514_amora_shared_budget_decision_receipts.sql',
  '20260911080244_amora_budget_plan_explicit_allocations.sql',
  '20260913043211_chat_feedback_automatic_signal_nullable.sql',
  '20260913075045_profile_wedding_roles.sql',
  '20260913082314_private_profile_avatars_delivery.sql',
  '20260913103407_account_deletion_customer_data_boundary.sql',
  '20260915101500_amora_atomic_not_applicable_status.sql',
  '20260915130000_wedding_code_research_contributions.sql',
  '20260917090000_wedding_code_research_scene_v09.sql',
  '20260918090000_wedding_code_research_scene_v10.sql',
  '20260920120000_wedding_preparation_style.sql',
  '20260923104336_wedding_code_pair_sessions.sql',
  '20260923132503_wedding_code_pair_session_conflict_response.sql',
  '20260928073546_account_deletion_anonymous_audit.sql',
]);
const loadedLineages = new WeakSet();
const INVENTORY_PIN = Object.freeze({ file: 'supabase/release-checks/current-baseline-inventory-v1.sql',
  sha256: '25426ca5d3397de465e137ea3c4119ca2373277b18b8f5e610407deba1ad96f8' });
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

export function buildRecoveryCaptureInventorySql(repoRoot) {
  const original = pinnedArtifact(repoRoot, INVENTORY_PIN).toString('utf8');
  const boundary = 'BEGIN TRANSACTION READ ONLY;\n';
  requireRelease(original.startsWith(boundary) && original.endsWith('\nCOMMIT;\n'), 'RECOVERY_INVENTORY_ENVELOPE_CHANGED');
  // pg_get_*의 정의 표기가 연결의 기본 search_path에 따라 달라지지 않도록 고정한다.
  return boundary + 'SET LOCAL search_path = pg_catalog, public;\n' + original.slice(boundary.length);
}

/** 고정 로컬 계보만 연결한다. 현재 운영 catalog, ACL 적용 사실, 수집·복원·소스 승인이 아니다. */
export function loadRecoveryCaptureLineage(repoRoot) {
  for (const pin of Object.values(SOURCE_PINS)) pinnedArtifact(repoRoot, pin);
  const historical = loadBudgetDecisionHistoricalRelease(repoRoot);
  const current = loadDeletionAuditNullabilityReleasePlan(repoRoot);
  requireRelease(historical.baseline.ledger.length === 215 && current.migrationCount === 240,
    'RECOVERY_LINEAGE_PREDECESSOR_CHANGED');
  same([historical.contract.projectRef, historical.contract.systemIdentifier],
    [current.contract.projectRef, current.contract.systemIdentifier], 'RECOVERY_LINEAGE_TARGET_CHANGED');
  const oldFiles = new Set(historical.hotfix.reviewedLocalHistory.migrations.map(pin => pin.file));
  const appendedPins = current.reviewedMigrations.filter(pin => !oldFiles.has(pin.file));
  same(appendedPins.map(pin => pin.file), APPENDED_FILES, 'RECOVERY_LINEAGE_SQL_SET_CHANGED');
  same(current.followupMigrations.map(pin => pin.file), APPENDED_FILES, 'RECOVERY_LINEAGE_SQL_SET_CHANGED');
  const appendedMigrations = appendedPins.map(pin => {
    const bytes = pinnedArtifact(repoRoot, { ...pin, file: `supabase/migrations/${pin.file}` });
    // ledger는 SQL 파일 hash가 아니라 단일 원문 statement 배열의 JSON hash를 기록한다.
    const row = { version: pin.file.slice(0, 14), name: pin.file.slice(15, -4),
      statementsSha256: digest(JSON.stringify([bytes.toString('utf8')])) };
    return { ...pin, ledgerRow: row };
  });
  const expectedLedger = [...historical.baseline.ledger, ...appendedMigrations.map(pin => pin.ledgerRow)];
  requireRelease(expectedLedger.length === 229 && expectedLedger.every((row, index) => index === 0 || expectedLedger[index - 1].version < row.version),
    'RECOVERY_LINEAGE_LEDGER_ORDER_INVALID');
  requireRelease(LEGACY_JOIN_ACL_PROJECT_REF === current.contract.projectRef
    && LEGACY_FITTING_ACL_PROJECT_REF === current.contract.projectRef
    && LEGACY_FITTING_ACL_SYSTEM_IDENTIFIER === current.contract.systemIdentifier, 'RECOVERY_LINEAGE_TARGET_CHANGED');
  const fittingContract = JSON.parse(pinnedArtifact(repoRoot, SOURCE_PINS.fittingContract));
  same(fittingContract.functions, LEGACY_FITTING_ACL_PINS, 'RECOVERY_LINEAGE_ACL_CHANGED');
  const manualAclReleases = [
    { release: LEGACY_JOIN_ACL_RELEASE_ID, source: SOURCE_PINS.join, expectedPhase: 'after',
      changedIdentities: [LEGACY_JOIN_IDENTITY], ledgerChanges: [],
      expectedInventory: LEGACY_JOIN_ACL_PINS.map(pin => ({ identity: pin.identity, owner: 'postgres', security_definer: true,
        definition_md5: pin.definitionMd5, acl: pin.afterAcl,
        ...Object.fromEntries(['anon_execute', 'authenticated_execute', 'service_execute'].map((key, index) =>
          [key, pin.identity === LEGACY_JOIN_IDENTITY ? false : pin.execute[index]])) })) },
    { release: LEGACY_FITTING_ACL_RELEASE_ID, source: SOURCE_PINS.fitting, contract: SOURCE_PINS.fittingContract,
      expectedPhase: 'after', changedIdentities: LEGACY_FITTING_ACL_PINS.map(pin => pin.identity), ledgerChanges: [],
      expectedInventory: LEGACY_FITTING_ACL_PINS.map(pin => ({ ...pin, owner: 'postgres', securityDefiner: true,
        settings: null, aclExplicit: true, acl: ['postgres', 'service_role'].map(grantee =>
          ({ grantee, grantor: 'postgres', privilege: 'EXECUTE', grantable: false })), execute: [false, false, true, true] })) },
  ];
  const lineage = freeze({ format: 'recovery-capture-lineage-v1',
    scope: 'expected-ledger-and-manual-acl-source-lineage-only',
    projectRef: current.contract.projectRef, systemIdentifier: current.contract.systemIdentifier,
    historical: { loader: SOURCE_PINS.historicalLoader,
      contract: { file: 'supabase/release-contracts/amora-budget-decision-hotfix-v1.json', sha256: historical.hotfixSha256 },
      baseline: historical.hotfix.operatingBaseline, ledgerCount: historical.baseline.ledger.length,
      ledgerSha256: digestJson(historical.baseline.ledger) },
    current: { loader: SOURCE_PINS.currentLoader,
      contract: { file: 'supabase/release-contracts/account-deletion-audit-nullability-v1.json', sha256: current.contractSha256 },
      reviewedMigrations: current.reviewedMigrations, migrationSetSha256: digestJson(current.reviewedMigrations) },
    appendedMigrations, expectedLedger, expectedLedgerSha256: digestJson(expectedLedger), manualAclReleases });
  loadedLineages.add(lineage);
  return lineage;
}

/** 관측의 출처·시각·대상 인증은 호출자의 별도 계약이다. 여기서는 전달된 ledger의 정확한 내용만 비교한다. */
export function assertRecoveryCaptureLedger(lineage, observedLedger) {
  requireRelease(loadedLineages.has(lineage), 'RECOVERY_LINEAGE_NOT_LOADED');
  same(observedLedger, lineage.expectedLedger, 'RECOVERY_LINEAGE_LEDGER_MISMATCH');
  return Object.freeze({ scope: 'ledger-content-equality-only', ledgerCount: lineage.expectedLedger.length,
    ledgerSha256: lineage.expectedLedgerSha256 });
}
