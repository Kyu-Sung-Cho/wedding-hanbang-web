#!/usr/bin/env node
// 아모라 맡은 일 배포 길의 로컬 고정값을 만든다. credential/network/DB 호출은 없다.
//   --write-snapshot  기준 커밋(BASE_COMMIT)의 supabase/migrations·release-contracts·scripts/lib 원문을 고정한다.
//   --write           고정 목록(manifest)을 지금 원문 hash 로 다시 쓴다.
//   --check           고정 목록이 지금 원문과 맞는지만 본다.
//   --regenerate      SQL 이나 BASE_COMMIT 이 바뀐 뒤 고정값 전부를 한 번에 다시 만든다(아래 regenerate 참고).
// main 이 이 세 폴더를 바꾸고 이 가지가 그 main 위로 옮겨 가면 BASE_COMMIT 을 고친 뒤 --regenerate 를 돌린다.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE_COMMIT, digest, FIXTURE, loadPlan, MANIFEST, MIGRATION, PINNED_FILES, PREDECESSOR_SNAPSHOT,
  RELEASE } from './amora-tasks-release.mjs';
import { FUNCTIONS, MIGRATION_NAME, MIGRATION_VERSION, PROJECT_REF, SYSTEM_IDENTIFIER, TABLES, topLevelStatements,
  unwrapMigration } from './amora-tasks-release-catalog.mjs';

const BUILD_CONTRACT = 'scripts/amora-tasks-release-build-contract.mjs';
const fail = code => { const error = new Error(code); error.code = code; throw error; };

export function prepareManifest(repoRoot) {
  return {
    version: 1, kind: 'amora-tasks-isolated-additive-release', release: RELEASE,
    status: 'requires-scoped-runtime-evidence', productionApplyImplemented: true, runtimeEvidenceVerified: false,
    projectRef: PROJECT_REF, systemIdentifier: SYSTEM_IDENTIFIER, baseCommit: BASE_COMMIT,
    migrationVersion: MIGRATION_VERSION, migrationName: MIGRATION_NAME, existingData: 'unchanged', newRows: 'none',
    scope: { newTables: TABLES.map(n => `public.${n}`), newFunctions: FUNCTIONS.map(n => `public.${n}`),
      existingFunctions: 'unchanged', existingTables: 'unchanged', auth: 'unchanged', storage: 'unchanged', cron: 'unchanged' },
    backup: 'fresh-remote-target-absence-and-preserved-catalog-ledger-digests-no-customer-data-export',
    rollback: 'previous-web-deployment-preserve-new-objects-and-existing-customer-data',
    worker: 'AMORA_TASKS_ENABLED stays off until the owner decides; this release only creates empty tables and service-role functions',
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
      if (!match) fail('ATK_PREDECESSOR_TREE_INVALID');
      return { file: match[2], gitBlob: match[1] };
    }).sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  const files = entries.map(({ file, gitBlob }) => {
    const bytes = git(['cat-file', 'blob', gitBlob]);
    return { file, gitBlob, bytes: bytes.length, sha256: digest(bytes) };
  });
  const migrationCount = files.filter(pin => pin.file.startsWith('supabase/migrations/') && pin.file.endsWith('.sql')).length;
  return { format: 'amora-tasks-predecessor-snapshot-v1', baseCommit: BASE_COMMIT, migrationCount, files };
}

// 빌드 계약 원문에서 `const NAME = 값;` 한 줄만 바꾼다. 그 줄이 정확히 하나가 아니면 아무것도 쓰지 않고 막는다.
export function repinBuildContractSource(source, values) {
  let next = source;
  for (const [name, value] of Object.entries(values)) {
    const pattern = `^((?:export )?const ${name} = )[^;\\n]+;$`;
    if ((next.match(new RegExp(pattern, 'gmu')) ?? []).length !== 1) fail('ATK_BUILD_CONTRACT_PIN_LINE_INVALID');
    next = next.replace(new RegExp(pattern, 'mu'), (_line, head) => `${head}${value};`);
  }
  return next;
}

// SQL 이 바뀐 뒤 한 번에 다시 만든다. 운영 접속은 없다(Git 객체와 메모리 안 PGlite 만 쓴다). 순서가 중요하다:
//   1. 기준 스냅숏(BASE_COMMIT 원문)  2. catalog 고정 파일(PGlite 로 실제 SQL 을 올려 읽는다)
//   3. 빌드 계약의 검토 hash(SQL·catalog)·스냅숏 hash·개수  4. 고정 목록(manifest, 3 에서 바뀐 빌드 계약 hash 포함)
//   5. loadPlan 으로 다시 읽어 확인한다.
export async function regenerate(repoRoot) {
  const snapshot = buildPredecessorSnapshot(repoRoot);
  const snapshotText = `${JSON.stringify(snapshot, null, 2)}\n`;
  writeFileSync(resolve(repoRoot, PREDECESSOR_SNAPSHOT), snapshotText, { encoding: 'utf8' });
  const { buildFixture, serializeFixture } = await import('./amora-tasks-release-fixture.mjs');
  const fixtureText = serializeFixture(await buildFixture(repoRoot));
  writeFileSync(resolve(repoRoot, FIXTURE), fixtureText, { encoding: 'utf8' });
  const sqlBytes = readFileSync(resolve(repoRoot, MIGRATION));
  const contractPath = resolve(repoRoot, BUILD_CONTRACT);
  writeFileSync(contractPath, repinBuildContractSource(readFileSync(contractPath, 'utf8'), {
    AMORA_TASKS_PREDECESSOR_SNAPSHOT_SHA256: `'${digest(Buffer.from(snapshotText))}'`,
    REVIEWED_SQL_SHA256: `'${digest(sqlBytes)}'`, REVIEWED_CATALOG_SHA256: `'${digest(Buffer.from(fixtureText))}'`,
    PREDECESSOR_FILES: String(snapshot.files.length), PREDECESSOR_MIGRATIONS: String(snapshot.migrationCount),
  }), { encoding: 'utf8' });
  writeFileSync(resolve(repoRoot, MANIFEST), `${JSON.stringify(prepareManifest(repoRoot), null, 2)}\n`, { encoding: 'utf8' });
  const plan = loadPlan(repoRoot);
  return { plan, snapshot, snapshotSha256: digest(Buffer.from(snapshotText)),
    statements: topLevelStatements(unwrapMigration(sqlBytes.toString('utf8'))).length };
}

async function main() {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 1 || !['--write', '--write-snapshot', '--check', '--regenerate'].includes(args[0])) {
      fail('ATK_LOCAL_PREPARE_ARGUMENT_INVALID');
    }
    const repoRoot = process.cwd();
    if (args[0] === '--regenerate') {
      const result = await regenerate(repoRoot);
      process.stdout.write(`ATK_REGENERATED: migration=${MIGRATION}; sql_sha256=${result.plan.sqlSha256}; fixture_sha256=${result.plan.fixtureSha256}; snapshot_sha256=${result.snapshotSha256}; predecessor_files=${result.snapshot.files.length}; predecessor_migrations=${result.snapshot.migrationCount}; top_level_statements=${result.statements}; remote_writes=false\n`);
    } else if (args[0] === '--write-snapshot') {
      const snapshot = buildPredecessorSnapshot(repoRoot);
      const text = `${JSON.stringify(snapshot, null, 2)}\n`;
      writeFileSync(resolve(repoRoot, PREDECESSOR_SNAPSHOT), text, { encoding: 'utf8' });
      process.stdout.write(`ATK_PREDECESSOR_SNAPSHOT_WRITTEN: files=${snapshot.files.length}; migrations=${snapshot.migrationCount}; sha256=${digest(Buffer.from(text))}\n`);
    } else {
      if (args[0] === '--write') {
        writeFileSync(resolve(repoRoot, MANIFEST), `${JSON.stringify(prepareManifest(repoRoot), null, 2)}\n`, { encoding: 'utf8' });
      }
      const plan = loadPlan(repoRoot);
      process.stdout.write(`ATK_LOCAL_MANIFEST_VERIFIED: sql_sha256=${plan.sqlSha256}; fixture_sha256=${plan.fixtureSha256}; migration=${MIGRATION}; remote_writes=false; deployment_authorized=false\n`);
    }
  } catch (error) {
    process.stderr.write(`ATK_LOCAL_PREPARE_BLOCKED: ${/^ATK_[A-Z0-9_:a-z]+$/u.test(error?.code ?? error?.message ?? '') ? (error.code ?? error.message) : `ATK_UNEXPECTED ${String(error?.message ?? error).slice(0, 200)}`}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main();
