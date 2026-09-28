import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, fsyncSync, lstatSync, openSync, readFileSync, readdirSync, unlinkSync, writeSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { require as tsxRequire } from 'tsx/cjs/api';

const { getDeletionSupportCaseEventCount, validateDeletionSupportCaseTransition } = tsxRequire(
  '../../apps/web/src/lib/accountDeletion/supportCase.ts', import.meta.url);

const helper = fileURLToPath(new URL('../account-deletion-support-protection.ps1', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function need(ok) { if (!ok) throw new Error('SUPPORT_CASE_STORE_INVALID'); }

export function openDeletionSupportStore(caseId, { initialize = false } = {}) {
  need(process.platform === 'win32' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(caseId));
  const ps = (mode, bytes, fileName) => {
    try {
      const childEnv = { ...process.env };
      // PowerShell 7의 모듈 경로를 5.1에 넘기면 ACL 모듈을 로드할 수 없다.
      for (const key of Object.keys(childEnv)) if (key.toLowerCase() === 'psmodulepath') delete childEnv[key];
      return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', helper,
        '-Mode', mode, '-CaseId', caseId, ...(fileName ? ['-FileName', fileName] : [])], {
        input: bytes?.toString('base64'), encoding: 'utf8', windowsHide: true,
        timeout: 20_000, maxBuffer: 524288, stdio: ['pipe', 'pipe', 'pipe'], env: childEnv,
      });
    } catch { throw new Error('SUPPORT_CASE_PROTECTION_FAILED'); }
  };
  return openDeletionSupportJournal(caseId, ps(initialize ? 'init' : 'check'), {
    initialize,
    checkFile: fileName => ps('check', undefined, fileName),
    protect: bytes => Buffer.from(ps('protect', bytes), 'base64'),
    unprotect: bytes => Buffer.from(ps('unprotect', bytes), 'base64'),
  });
}

/** 저장 계약의 합성 검증용 경계. 실제 운영 진입점은 위 DPAPI 전용 함수다. */
export function openDeletionSupportJournal(caseId, directory, { initialize = false, checkFile, protect, unprotect }) {
  need(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(caseId));
  need(resolve(directory) === directory && lstatSync(directory).isDirectory() && !lstatSync(directory).isSymbolicLink());
  const lock = join(directory, 'case.lock');
  const lockFd = openSync(lock, 'wx', 0o600);
  let previous = null, count = 0, closed = false;
  let lastCase = null;
  const compatible = value => {
    try {
      validateDeletionSupportCaseTransition(lastCase, value);
      return getDeletionSupportCaseEventCount(value) === count + 1;
    } catch { return false; }
  };
  try {
    checkFile('case.lock');
    writeSync(lockFd, `${process.pid}\n`); fsyncSync(lockFd);
    const names = readdirSync(directory).filter(n => n !== 'case.lock');
    need(names.every(n => /^(?:[0-9]{5}|[1-9][0-9]{5,15})\.dpapi$/.test(n)
      && Number.isSafeInteger(Number(n.slice(0, -6)))));
    names.sort((a, b) => Number(a.slice(0, -6)) - Number(b.slice(0, -6)));
    need(names.every((n, i) => n === `${String(i + 1).padStart(5, '0')}.dpapi`));
    let latest = null;
    for (const name of names) {
      checkFile(name);
      const file = join(directory, name);
      need(lstatSync(file).size > 0 && lstatSync(file).size < 393216);
      const cipher = readFileSync(file);
      const clear = unprotect(cipher);
      try {
        need(clear.length > 0 && clear.length < 262144);
        const envelope = JSON.parse(clear.toString('utf8'));
        need(envelope.format === 'support-case-envelope-v1' && envelope.previousSha256 === previous
          && envelope.case?.caseId === caseId && compatible(envelope.case));
        latest = envelope.case;
        lastCase = structuredClone(envelope.case);
      } finally { clear.fill(0); }
      previous = hash(cipher); count++;
    }
    need(initialize ? count === 0 : count > 0);
    return {
      directory, latest,
      async persist(value) {
        need(!closed && Number.isSafeInteger(count + 1) && value.caseId === caseId && compatible(value));
        const clear = Buffer.from(JSON.stringify({ format: 'support-case-envelope-v1', previousSha256: previous, case: value }));
        let cipher;
        try {
          need(clear.length < 262144);
          cipher = protect(clear);
          need(cipher.length > 0 && cipher.length < 393216);
          const roundtrip = unprotect(cipher);
          try { need(roundtrip.equals(clear)); } finally { roundtrip.fill(0); }
        } finally { clear.fill(0); }
        const name = `${String(count + 1).padStart(5, '0')}.dpapi`;
        const target = join(directory, name);
        const fd = openSync(target, 'wx', 0o600);
        try {
          checkFile(name);
          let offset = 0;
          while (offset < cipher.length) {
            const wrote = writeSync(fd, cipher, offset, cipher.length - offset);
            need(wrote > 0); offset += wrote;
          }
          fsyncSync(fd);
        } finally { closeSync(fd); }
        need(readFileSync(target).equals(cipher));
        previous = hash(cipher); count++; lastCase = structuredClone(value);
      },
      close() {
        if (!closed) { closed = true; closeSync(lockFd); unlinkSync(lock); }
      },
    };
  } catch (error) {
    closeSync(lockFd); unlinkSync(lock); throw error;
  }
}
