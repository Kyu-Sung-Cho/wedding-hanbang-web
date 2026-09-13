import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, fsyncSync, lstatSync, openSync, readFileSync, readdirSync, unlinkSync, writeSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  const directory = ps(initialize ? 'init' : 'check');
  need(resolve(directory) === directory && lstatSync(directory).isDirectory() && !lstatSync(directory).isSymbolicLink());
  const lock = join(directory, 'case.lock');
  const lockFd = openSync(lock, 'wx', 0o600);
  let previous = null, count = 0, closed = false;
  let lastCase = null;
  const compatible = value => !lastCase || (['caseId', 'projectRef', 'subject', 'proofReference', 'proofIssuedAt',
    'requestSha256', 'operator', 'reviewedAt', 'scope', 'generalCustomerDataRemovalVerified'].every(key => value[key] === lastCase[key])
    && JSON.stringify(value.events.slice(0, -1)) === JSON.stringify(lastCase.events));
  try {
    ps('check', undefined, 'case.lock');
    writeSync(lockFd, `${process.pid}\n`); fsyncSync(lockFd);
    const names = readdirSync(directory).filter(n => n !== 'case.lock').sort();
    need(names.every((n, i) => n === `${String(i + 1).padStart(5, '0')}.dpapi`) && names.length <= 100);
    let latest = null;
    for (const name of names) {
      ps('check', undefined, name);
      const file = join(directory, name);
      need(lstatSync(file).size > 0 && lstatSync(file).size < 393216);
      const cipher = readFileSync(file);
      const clear = Buffer.from(ps('unprotect', cipher), 'base64');
      try {
        const envelope = JSON.parse(clear.toString('utf8'));
        need(envelope.format === 'support-case-envelope-v1' && envelope.previousSha256 === previous
          && envelope.case?.caseId === caseId && envelope.case.events?.length === count + 1 && compatible(envelope.case));
        latest = envelope.case;
        lastCase = structuredClone(envelope.case);
      } finally { clear.fill(0); }
      previous = hash(cipher); count++;
    }
    need(initialize ? count === 0 : count > 0);
    return {
      directory, latest,
      async persist(value) {
        need(!closed && value.caseId === caseId && value.events?.length === count + 1 && count < 100 && compatible(value));
        const clear = Buffer.from(JSON.stringify({ format: 'support-case-envelope-v1', previousSha256: previous, case: value }));
        let cipher;
        try {
          need(clear.length < 262144);
          cipher = Buffer.from(ps('protect', clear), 'base64');
          const roundtrip = Buffer.from(ps('unprotect', cipher), 'base64');
          try { need(roundtrip.equals(clear)); } finally { roundtrip.fill(0); }
        } finally { clear.fill(0); }
        const name = `${String(count + 1).padStart(5, '0')}.dpapi`;
        const target = join(directory, name);
        const fd = openSync(target, 'wx', 0o600);
        try {
          ps('check', undefined, name);
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
