#!/usr/bin/env node
// 로컬의 검토 대상 원문 hash를 묶는다. credential/network/DB 호출은 없다.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE_COMMIT, digest, loadPlan, MANIFEST, PINNED_FILES, RELEASE } from './wedding-code36-release.mjs';
import { FUNCTIONS, MIGRATION_VERSION, PROJECT_REF, SYSTEM_IDENTIFIER, TABLES } from './wedding-code36-release-catalog.mjs';

export function prepareManifest(repoRoot) {
  return {
    version: 1, kind: 'wedding-code36-isolated-additive-release', release: RELEASE,
    status: 'requires-scoped-runtime-evidence', productionApplyImplemented: true, runtimeEvidenceVerified: false,
    projectRef: PROJECT_REF, systemIdentifier: SYSTEM_IDENTIFIER, baseCommit: BASE_COMMIT,
    migrationVersion: MIGRATION_VERSION, existingData: 'unchanged', newRows: 'none',
    scope: { newTables: TABLES.map(n => `public.${n}`), newFunctions: FUNCTIONS.map(n => `public.${n}`),
      existingFunctions: 'unchanged', existingTables: 'unchanged', auth: 'unchanged', storage: 'unchanged', cron: 'unchanged' },
    backup: 'fresh-remote-target-absence-and-preserved-catalog-ledger-digests-no-customer-data-export',
    rollback: 'previous-web-deployment-preserve-new-objects-and-existing-customer-data',
    artifacts: PINNED_FILES.map(file => ({ file, sha256: digest(readFileSync(resolve(repoRoot, file))) })),
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 1 || !['--write', '--check'].includes(args[0])) throw new Error('WC36_LOCAL_PREPARE_ARGUMENT_INVALID');
    if (args[0] === '--write') {
      writeFileSync(resolve(process.cwd(), MANIFEST), `${JSON.stringify(prepareManifest(process.cwd()), null, 2)}\n`, { encoding: 'utf8' });
    }
    const plan = loadPlan(process.cwd());
    process.stdout.write(`WC36_LOCAL_MANIFEST_VERIFIED: sql_sha256=${plan.sqlSha256}; remote_writes=false; deployment_authorized=false\n`);
  } catch (error) {
    process.stderr.write(`WC36_LOCAL_PREPARE_BLOCKED: ${/^WC36_[A-Z_]+$/u.test(error?.code ?? error?.message ?? '') ? (error.code ?? error.message) : 'WC36_UNEXPECTED'}\n`);
    process.exitCode = 1;
  }
}
