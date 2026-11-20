#!/usr/bin/env node
// 아모라 먼저 챙기기 배포 길의 로컬 고정값을 만든다. credential/network/DB 호출은 없다.
//   --write-snapshot  기준 커밋(BASE_COMMIT)의 supabase/migrations·release-contracts·scripts/lib 원문을 고정한다.
//   --write           고정 목록(manifest)을 지금 원문 hash 로 다시 쓴다.
//   --check           고정 목록이 지금 원문과 맞는지만 본다.
// main 이 이 세 폴더를 바꾸고 이 가지가 그 main 위로 옮겨 가면 BASE_COMMIT·스냅숏·빌드 계약의 hash 를 함께 다시 만든다.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE_COMMIT, digest, expectedScope, loadPlan, MANIFEST, PINNED_FILES, PREDECESSOR_SNAPSHOT,
  RELEASE } from './amora-proactive-release.mjs';
import { MIGRATIONS, PROJECT_REF, SYSTEM_IDENTIFIER } from './amora-proactive-release-catalog.mjs';

const fail = code => { const error = new Error(code); error.code = code; throw error; };

export function prepareManifest(repoRoot) {
  return {
    version: 1, kind: 'amora-proactive-scoped-release', release: RELEASE,
    status: 'requires-scoped-runtime-evidence', productionApplyImplemented: true, runtimeEvidenceVerified: false,
    projectRef: PROJECT_REF, systemIdentifier: SYSTEM_IDENTIFIER, baseCommit: BASE_COMMIT,
    migrations: MIGRATIONS.map(m => ({ version: m.version, name: m.name, file: m.file })),
    existingData: 'profiles-default-columns-and-care-email-consent-backfill-only', newRows: 'none',
    scope: expectedScope(),
    backup: 'fresh-remote-pinned-before-catalog-and-preserved-catalog-ledger-digests-no-customer-data-export',
    rollback: 'previous-web-deployment-preserve-new-objects-and-existing-customer-data',
    sending: 'AMORA_APP_PUSH_ENABLED stays unset until the owner decides; care email stays behind the existing care switches',
    artifacts: PINNED_FILES.map(file => ({ file, sha256: digest(readFileSync(resolve(repoRoot, file))) })),
  };
}

// 기준 커밋의 원문을 Git 객체에서 그대로 꺼내 고정한다(작업 트리의 줄끝 변환을 거치지 않는다).
export function buildPredecessorSnapshot(repoRoot) {
  const git = (args, input) => execFileSync('git', ['--no-replace-objects', '-C', repoRoot, ...args], {
    input, windowsHide: true, timeout: 60_000, maxBuffer: 256 * 1024 * 1024, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    env: { ...process.env, GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0' },
  });
  const entries = git(['ls-tree', '-r', BASE_COMMIT, '--', 'supabase/migrations', 'supabase/release-contracts', 'scripts/lib'])
    .toString('utf8').split(/\r?\n/u).filter(Boolean).map(line => {
      const match = /^100644 blob ([a-f0-9]{40})\t(.+)$/u.exec(line);
      if (!match) fail('APRO_PREDECESSOR_TREE_INVALID');
      return { file: match[2], gitBlob: match[1] };
    }).sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  const files = entries.map(({ file, gitBlob }) => {
    const bytes = git(['cat-file', 'blob', gitBlob]);
    return { file, gitBlob, bytes: bytes.length, sha256: digest(bytes) };
  });
  const migrationCount = files.filter(pin => pin.file.startsWith('supabase/migrations/') && pin.file.endsWith('.sql')).length;
  return { format: 'amora-proactive-predecessor-snapshot-v1', baseCommit: BASE_COMMIT, migrationCount, files };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 1 || !['--write', '--write-snapshot', '--check'].includes(args[0])) fail('APRO_LOCAL_PREPARE_ARGUMENT_INVALID');
    const repoRoot = process.cwd();
    if (args[0] === '--write-snapshot') {
      const snapshot = buildPredecessorSnapshot(repoRoot);
      const text = `${JSON.stringify(snapshot, null, 2)}\n`;
      writeFileSync(resolve(repoRoot, PREDECESSOR_SNAPSHOT), text, { encoding: 'utf8' });
      process.stdout.write(`APRO_PREDECESSOR_SNAPSHOT_WRITTEN: files=${snapshot.files.length}; migrations=${snapshot.migrationCount}; sha256=${digest(Buffer.from(text))}\n`);
    } else {
      if (args[0] === '--write') {
        writeFileSync(resolve(repoRoot, MANIFEST), `${JSON.stringify(prepareManifest(repoRoot), null, 2)}\n`, { encoding: 'utf8' });
      }
      const plan = loadPlan(repoRoot);
      process.stdout.write(`APRO_LOCAL_MANIFEST_VERIFIED: sql_sha256=${plan.sqlSha256s.join(',')}; fixture_sha256=${plan.fixtureSha256}; migrations=${plan.migrations.length}; remote_writes=false; deployment_authorized=false\n`);
    }
  } catch (error) {
    process.stderr.write(`APRO_LOCAL_PREPARE_BLOCKED: ${/^APRO_[A-Z0-9_]+$/u.test(error?.code ?? error?.message ?? '') ? (error.code ?? error.message) : 'APRO_UNEXPECTED'}\n`);
    process.exitCode = 1;
  }
}
