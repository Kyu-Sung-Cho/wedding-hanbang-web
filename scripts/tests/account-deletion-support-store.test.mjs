import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { readFileSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { openDeletionSupportStore } from '../lib/account-deletion-support-store.mjs';

test('actual Windows DPAPI case journal roundtrips, rejects duplicate process and detects ciphertext damage',
  { skip: process.platform !== 'win32', timeout: 60_000 }, async () => {
    const id = randomUUID(); let store, directory;
    try {
      store = openDeletionSupportStore(id, { initialize: true }); directory = store.directory;
      const first = { caseId: id, subject: 'synthetic-support-fixture', events: [{ state: 'prepared' }] };
      await store.persist(first);
      assert.throws(() => openDeletionSupportStore(id), /EEXIST/);
      assert.equal(readFileSync(join(directory, '00001.dpapi')).includes(Buffer.from(first.subject)), false);
      store.close(); store = openDeletionSupportStore(id);
      assert.deepEqual(store.latest, first);
      const next = { ...first, events: [...first.events, { state: 'enqueue-unverified' }] };
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
        for (const name of readdirSync(directory)) {
          assert.match(name, /^(?:\d{5}\.dpapi|case\.lock)$/); unlinkSync(join(directory, name));
        }
        rmdirSync(directory);
      }
    }
  });
