import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

const SOURCE_COMMIT = 'e9f74aa3823cd75ed4180623d6276845180bd8ab';
const SOURCE_TREE = '0627d4a080b66b9b804dc866692f298dbf1f382c';
const MANIFEST_SHA256 = '8e100fcaf4380d98951ab98fe5d11d98d191122ae9e9cb7e29a1702320fe0a24';
const PREFIX = 'amora-budget-history-m4-';
const sha = value => createHash('sha256').update(value).digest('hex');
const within = (root, target) => {
  const delta = relative(root, target);
  assert.ok(delta && !isAbsolute(delta) && delta !== '..' && !delta.startsWith(`..${sep}`), 'legacy fixture target escaped its temporary root');
};

// 구판의 완전한 입력을 고정한다. 현재 migrations를 스캔해 미검토 SQL을 빼는 방식이 아니다.
// 이 manifest는 지정 commit의 전체 supabase tree + 구현 의존성을 원문 blob/SHA로 고정한다.
// 현재 제품 모듈의 구판 행위를 시험할 자료일 뿐 운영 loader/적용 경로로 사용하지 않는다.
// 얕은 checkout 등으로 원문이 없으면 실패한다. fetch/설정 변경/대체 자료 생성은 하지 않는다.
export function createBudgetDecisionHistoricalRepository(sourceRoot) {
  assert.ok(isAbsolute(sourceRoot), 'legacy fixture requires an absolute source repository');
  const manifestBytes = readFileSync(new URL('./budget-decision-historical-repository.manifest.json', import.meta.url));
  assert.equal(sha(manifestBytes), MANIFEST_SHA256, 'legacy fixture manifest changed without an explicit historical pin review');
  const manifest = JSON.parse(manifestBytes);
  assert.equal(manifest.format, 'legacy-release-test-repository-v1');
  assert.equal(manifest.sourceCommit, SOURCE_COMMIT);
  assert.equal(manifest.sourceTree, SOURCE_TREE);
  assert.equal(manifest.files.length, 380);
  let previous = '';
  for (const pin of manifest.files) {
    assert.ok(typeof pin.file === 'string' && pin.file > previous && !isAbsolute(pin.file)
      && !pin.file.includes('\\') && !pin.file.split('/').some(part => !part || part === '.' || part === '..'));
    assert.match(pin.blob, /^[a-f0-9]{40}$/);
    assert.match(pin.sha256, /^[a-f0-9]{64}$/);
    assert.ok(Number.isSafeInteger(pin.bytes) && pin.bytes >= 0 && pin.bytes <= 4 * 1024 * 1024);
    previous = pin.file;
  }
  const expectedBytes = manifest.files.reduce((sum, pin) => sum + pin.bytes, 0);
  const output = execFileSync('git', ['--no-replace-objects', '-C', realpathSync(sourceRoot), '-c', 'protocol.allow=never', 'cat-file', '--batch'], {
    input: manifest.files.map(pin => pin.blob).join('\n') + '\n',
    maxBuffer: expectedBytes + manifest.files.length * 128,
    timeout: 30_000, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0' },
  });
  let cursor = 0;
  const originals = manifest.files.map(pin => {
    const end = output.indexOf(10, cursor);
    assert.ok(end >= cursor, `historical Git blob unavailable: ${pin.file}`);
    assert.equal(output.subarray(cursor, end).toString('ascii'), `${pin.blob} blob ${pin.bytes}`,
      `historical Git blob unavailable or invalid: ${pin.file}; provide the reviewed Git history, never substitute current files`);
    const bytes = output.subarray(end + 1, end + 1 + pin.bytes);
    assert.equal(bytes.length, pin.bytes);
    assert.equal(sha(bytes), pin.sha256, `historical raw bytes changed: ${pin.file}`);
    cursor = end + 1 + pin.bytes;
    assert.equal(output[cursor++], 10);
    return { pin, bytes };
  });
  assert.equal(cursor, output.length, 'unexpected data after the historical Git blobs');

  const temporaryParent = realpathSync(tmpdir());
  const root = mkdtempSync(join(temporaryParent, PREFIX));
  const cleanup = () => {
    if (!existsSync(root)) return;
    assert.equal(dirname(resolve(root)), temporaryParent);
    assert.ok(basename(root).startsWith(PREFIX));
    assert.ok(!lstatSync(root).isSymbolicLink());
    assert.equal(realpathSync(root), root);
    rmSync(root, { recursive: true, force: true });
  };
  try {
    for (const { pin, bytes } of originals) {
      const target = resolve(root, pin.file);
      within(root, target);
      let parent = root;
      for (const part of pin.file.split('/').slice(0, -1)) {
        parent = join(parent, part);
        within(root, parent);
        if (!existsSync(parent)) mkdirSync(parent, { mode: 0o700 });
        assert.ok(lstatSync(parent).isDirectory() && !lstatSync(parent).isSymbolicLink());
      }
      writeFileSync(target, bytes, { flag: 'wx', mode: 0o600 });
    }
    return { root, cleanup, sourceCommit: SOURCE_COMMIT, manifestSha256: MANIFEST_SHA256 };
  } catch (error) {
    cleanup();
    throw error;
  }
}
