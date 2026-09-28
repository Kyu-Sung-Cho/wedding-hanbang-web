import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync, readFileSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { require as tsxRequire } from 'tsx/cjs/api';
import { openDeletionSupportJournal, openDeletionSupportStore } from '../lib/account-deletion-support-store.mjs';

const { advanceDeletionSupportCase, getDeletionSupportCaseEventCount } = tsxRequire(
  '../../apps/web/src/lib/accountDeletion/supportCase.ts', import.meta.url);
const at = '2026-09-28T00:00:00.000Z';
const jobId = '22222222-2222-4222-8222-222222222222';
function prepared(caseId) {
  return {
    format: 'hanbang-deletion-support-case-v1', caseId, projectRef: 'syntheticprojectref1',
    subject: '11111111-1111-4111-8111-111111111111', proofReference: '33333333-3333-4333-8333-333333333333',
    proofIssuedAt: 1, requestSha256: 'a'.repeat(64), operator: 'synthetic-test', reviewedAt: at,
    scope: 'existing-account-deletion-saga', jobId: null, state: 'prepared',
    events: [{ at, state: 'prepared', jobId: null }], generalCustomerDataRemovalVerified: false,
  };
}
function appendLegacy(value, state, boundJobId = value.jobId) {
  return { ...value, state, jobId: boundJobId, events: [...value.events, { at, state, jobId: boundJobId }] };
}
function clearSyntheticDirectory(directory) {
  for (const name of readdirSync(directory)) {
    assert.match(name, /^(?:\d{5,16}\.dpapi|case\.lock)$/);
    unlinkSync(join(directory, name));
  }
  rmdirSync(directory);
}
function syntheticProtection() {
  const key = randomBytes(32);
  return {
    checkFile() {},
    protect(clear) {
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
      const payload = Buffer.concat([cipher.update(clear), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), payload]);
    },
    unprotect(bytes) {
      const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      cipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]);
    },
  };
}

test('actual Windows DPAPI case journal roundtrips, rejects duplicate process and detects ciphertext damage',
  { skip: process.platform !== 'win32', timeout: 60_000 }, async () => {
    const id = randomUUID(); let store, directory;
    try {
      store = openDeletionSupportStore(id, { initialize: true }); directory = store.directory;
      const first = prepared(id);
      await store.persist(first);
      assert.throws(() => openDeletionSupportStore(id), /EEXIST/);
      assert.equal(readFileSync(join(directory, '00001.dpapi')).includes(Buffer.from(first.subject)), false);
      store.close(); store = openDeletionSupportStore(id);
      assert.deepEqual(store.latest, first);
      const next = appendLegacy(first, 'enqueue-unverified');
      await store.persist(next);
      await assert.rejects(store.persist(next), /STORE_INVALID/);
      store.close(); store = openDeletionSupportStore(id);
      assert.deepEqual(store.latest, next); store.close(); store = null;
      const file = join(directory, '00002.dpapi'); const bytes = readFileSync(file); bytes[bytes.length - 1] ^= 1;
      writeFileSync(file, bytes);
      assert.throws(() => openDeletionSupportStore(id), /PROTECTION_FAILED/);
    } finally {
      store?.close();
      // 이번 실행에서 만든 합성 UUID 폴더만 파일별로 정리한다.
      if (directory?.endsWith(id)) {
        clearSyntheticDirectory(directory);
      }
    }
  });

test('100-record legacy journal resumes, retains original encrypted history and reopens after 600 process attempts', async () => {
  const id = randomUUID(), directory = mkdtempSync(join(tmpdir(), 'hanbang-deletion-journal-'));
  const codec = syntheticProtection(); let store;
  try {
    store = openDeletionSupportJournal(id, directory, { ...codec, initialize: true });
    let value = prepared(id);
    await store.persist(value);
    value = appendLegacy(value, 'enqueue-unverified'); await store.persist(value);
    value = appendLegacy(value, 'queued', jobId); await store.persist(value);
    while (value.events.length < 100) {
      value = appendLegacy(value, value.events.length === 99 ? 'process-unverified' : 'pending');
      await store.persist(value);
    }
    const original = new Map(readdirSync(directory).filter(name => name.endsWith('.dpapi')).map(name =>
      [name, createHash('sha256').update(readFileSync(join(directory, name))).digest('hex')]));
    store.close(); store = openDeletionSupportJournal(id, directory, codec);
    assert.deepEqual(store.latest, value);
    let processCalls = 0;
    const deps = {
      persist: next => store.persist(next), now: () => Date.parse(at),
      enqueue: async () => { throw new Error('unexpected enqueue'); },
      findActiveJobs: async () => { throw new Error('unexpected lookup'); },
      readJob: async () => ({ id: jobId, userId: value.subject, status: 'deleting', claimToken: null,
        storageVerifiedAt: null, authDeletedAt: null, completedAt: null }),
      process: async () => { processCalls++; return { status: 'pending' }; },
      verifyAccountAbsence: async () => { throw new Error('unexpected account deletion'); },
    };
    value = await advanceDeletionSupportCase(store.latest, 'inspect', deps);
    assert.equal(getDeletionSupportCaseEventCount(value), 101);
    for (let i = 0; i < 600; i++) value = await advanceDeletionSupportCase(value, 'process', deps);
    assert.equal(processCalls, 600);
    assert.equal(getDeletionSupportCaseEventCount(value), 1301);
    assert.equal(value.events.length, 100);
    assert.equal(value.state, 'pending');
    for (const [name, digest] of original) assert.equal(
      createHash('sha256').update(readFileSync(join(directory, name))).digest('hex'), digest);
    const files = readdirSync(directory).filter(name => name.endsWith('.dpapi'));
    assert.equal(files.length, 1301);
    for (const name of files) {
      const clear = codec.unprotect(readFileSync(join(directory, name)));
      try { assert.ok(clear.length < 20_000); } finally { clear.fill(0); }
    }
    store.close(); store = openDeletionSupportJournal(id, directory, codec);
    assert.deepEqual(store.latest, value);
    await assert.rejects(store.persist(value), /STORE_INVALID/);
    store.close(); store = null;
    // 과거 암호문이 온전해도 중간 기록을 잃거나 바꾸면 재개를 거절한다.
    const path = join(directory, '00100.dpapi'), originalBytes = readFileSync(path);
    unlinkSync(path);
    assert.throws(() => openDeletionSupportJournal(id, directory, codec), /STORE_INVALID/);
    writeFileSync(path, originalBytes);
    const damaged = Buffer.from(originalBytes); damaged[damaged.length - 1] ^= 1;
    writeFileSync(path, damaged);
    assert.throws(() => openDeletionSupportJournal(id, directory, codec));
  } finally { store?.close(); clearSyntheticDirectory(directory); }
});

test('a forged archived prefix or changed subject cannot be persisted after rotation', async () => {
  const id = randomUUID(), directory = mkdtempSync(join(tmpdir(), 'hanbang-deletion-journal-'));
  const codec = syntheticProtection(); let store;
  try {
    store = openDeletionSupportJournal(id, directory, { ...codec, initialize: true });
    let value = prepared(id); await store.persist(value);
    value = appendLegacy(value, 'enqueue-unverified'); await store.persist(value);
    value = appendLegacy(value, 'queued', jobId); await store.persist(value);
    while (value.events.length < 100) { value = appendLegacy(value, 'pending'); await store.persist(value); }
    let next;
    await advanceDeletionSupportCase(value, 'inspect', {
      persist: async candidate => { next = candidate; }, now: () => Date.parse(at),
      readJob: async () => ({ id: jobId, userId: value.subject, status: 'deleting', claimToken: null,
        storageVerifiedAt: null, authDeletedAt: null, completedAt: null }),
    });
    await assert.rejects(store.persist({ ...next, history: { ...next.history, archivedSha256: 'f'.repeat(64) } }), /STORE_INVALID/);
    await assert.rejects(store.persist({ ...next, subject: '44444444-4444-4444-8444-444444444444' }), /STORE_INVALID/);
    assert.equal(readdirSync(directory).filter(name => name.endsWith('.dpapi')).length, 100);
    await store.persist(next);
    store.close(); store = openDeletionSupportJournal(id, directory, codec);
    assert.deepEqual(store.latest, next);
  } finally { store?.close(); clearSyntheticDirectory(directory); }
});
