import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient, StorageApiError } from '@supabase/supabase-js';
import { require as tsxRequire } from 'tsx/cjs/api';

// Match the support CLI: its ESM SDK client is passed into a tsx/CJS worker.
const { processAccountDeletionJob } = tsxRequire(
  '../../apps/web/src/lib/accountDeletion/communityStorageSaga.ts', import.meta.url);
const USER = '11111111-1111-4111-8111-111111111111';
const JOB = '22222222-2222-4222-8222-222222222222';
const NAME = '1700000000000_66666666-6666-4666-8666-666666666666.jpg';
const PATH = `${USER}/${NAME}`;
const NOW = Date.parse('2026-09-28T00:00:00Z');

function harness({ headStatus = 400, fallback = 'empty', existsResult } = {}) {
  const sequence = [], requests = [], rpcCalls = [];
  let imageLists = 0, authDeletes = 0;
  const sdk = createClient('https://storage-boundary.invalid', 'synthetic-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input)), method = init?.method ?? 'GET';
      assert.equal(url.origin, 'https://storage-boundary.invalid');
      requests.push({ method, path: url.pathname });
      sequence.push(`${method} ${url.pathname}`);
      if (method === 'HEAD') {
        assert.equal(url.pathname, `/storage/v1/object/community-images/${PATH}`);
        return new Response(null, { status: headStatus });
      }
      if (method === 'DELETE') {
        assert.equal(url.pathname, '/storage/v1/object/community-images');
        assert.deepEqual(JSON.parse(init.body), { prefixes: [PATH] });
        return Response.json([]);
      }
      assert.equal(method, 'POST');
      assert.match(url.pathname, /^\/storage\/v1\/object\/list\/(community-media-staging|community-images|community-videos|profile-avatars|chat-image)$/);
      const body = JSON.parse(init.body);
      assert.equal(body.prefix, url.pathname.endsWith('/chat-image') ? '' : USER);
      if (url.pathname.endsWith('/community-images')) {
        imageLists++;
        if (imageLists === 1) {
          if (fallback === 'present') return Response.json([{ name: NAME }]);
          if (fallback === 'unavailable') return Response.json({ message: 'synthetic unavailable' }, { status: 503 });
          if (fallback === 'malformed') return Response.json({ unexpected: [] });
        }
        if (imageLists === 2 && fallback === 'reappeared') return Response.json([{ name: NAME }]);
      }
      return Response.json([]);
    } },
  });
  const rpc = async (name, args) => {
    sequence.push(name); rpcCalls.push({ name, args });
    if (name === 'claim_account_deletion_job') return { data: [{
      id: JOB, user_id: USER, status: 'deleting', ready_after: new Date(NOW - 1).toISOString(),
      quarantine_count: 0, claim_token: args.p_claim_token,
    }], error: null };
    assert.ok(['prepare_account_deletion_customer_data', 'checkpoint_account_deletion_media',
      'prepare_account_deletion_auth_delete', 'finalize_account_deletion_job',
      'release_account_deletion_job', 'mark_account_deletion_manual_review'].includes(name));
    return { data: true, error: null };
  };
  const query = {
    select() { return this; }, eq() { return this; }, order() { return this; },
    async range(offset) { return { data: offset === 0 ? [{ job_id: JOB, bucket: 'community-images',
      path: PATH, source: 'legacy_prefix', not_before: new Date(NOW - 1).toISOString(), cleaned_at: null }] : [], error: null }; },
  };
  const storage = existsResult ? { from(bucket) {
    const api = sdk.storage.from(bucket);
    return { remove: api.remove.bind(api), list: api.list.bind(api), exists: async () => existsResult };
  } } : sdk.storage;
  const admin = { storage, rpc, from(table) { assert.equal(table, 'account_deletion_media_manifest'); return query; },
    auth: { admin: {
      async getUserById(userId) { assert.equal(userId, USER); sequence.push('auth.getUserById'); return { data: { user: { id: USER } }, error: null }; },
      async deleteUser(userId) { assert.equal(userId, USER); sequence.push('auth.deleteUser'); authDeletes++; return { error: null }; },
    } } };
  return { admin, sdk, sequence, requests, rpcCalls, get imageLists() { return imageLists; }, get authDeletes() { return authDeletes; } };
}

for (const headStatus of [400, 404]) {
  test(`support CLI ESM SDK -> tsx/CJS worker confirms HEAD ${headStatus} absence before checkpoints and Auth`, async () => {
    const h = harness({ headStatus });
    const observed = await h.sdk.storage.from('community-images').exists(PATH);
    assert.equal(observed.data, false);
    assert.ok(observed.error instanceof StorageApiError);
    h.sequence.length = 0; h.requests.length = 0;
    assert.deepEqual(await processAccountDeletionJob(h.admin, JOB, NOW), { status: 'completed' },
      JSON.stringify({ sequence: h.sequence, lastRpc: h.rpcCalls.at(-1) }));
    const list = 'POST /storage/v1/object/list/community-images';
    const checkpoint = h.sequence.indexOf('checkpoint_account_deletion_media');
    assert.ok(h.sequence.indexOf(list) < checkpoint);
    assert.ok(h.sequence.lastIndexOf(list) > checkpoint);
    assert.ok(h.sequence.indexOf('prepare_account_deletion_auth_delete') > h.sequence.lastIndexOf(list));
    assert.equal(h.imageLists, 2); assert.equal(h.authDeletes, 1);
    assert.deepEqual(h.rpcCalls.find(call => call.name === 'checkpoint_account_deletion_media')?.args,
      { p_job_id: JOB, p_claim_token: h.rpcCalls[0].args.p_claim_token, p_bucket: 'community-images', p_path: PATH });
  });
}

for (const fallback of ['present', 'unavailable', 'malformed']) {
  test(`mixed SDK worker cannot checkpoint or delete Auth when the exact list is ${fallback}`, async () => {
    const h = harness({ fallback });
    assert.deepEqual(await processAccountDeletionJob(h.admin, JOB, NOW), { status: 'retry' });
    assert.equal(h.imageLists, 1); assert.equal(h.authDeletes, 0);
    assert.ok(!h.rpcCalls.some(call => ['checkpoint_account_deletion_media', 'prepare_account_deletion_auth_delete'].includes(call.name)));
  });
}

test('real SDK HEAD presence or access/server failures never reach listing, checkpoint or Auth', async () => {
  for (const headStatus of [200, 401, 403, 500]) {
    const h = harness({ headStatus });
    assert.deepEqual(await processAccountDeletionJob(h.admin, JOB, NOW), { status: 'retry' });
    assert.equal(h.requests.filter(request => request.method === 'HEAD').length, 1);
    assert.equal(h.imageLists, 0); assert.equal(h.authDeletes, 0);
    assert.ok(!h.rpcCalls.some(call => ['checkpoint_account_deletion_media', 'prepare_account_deletion_auth_delete'].includes(call.name)));
  }
});

test('mixed SDK worker keeps a reappeared object behind the final-scan pending boundary', async () => {
  const h = harness({ fallback: 'reappeared' });
  assert.deepEqual(await processAccountDeletionJob(h.admin, JOB, NOW), { status: 'pending' });
  assert.equal(h.imageLists, 3); assert.equal(h.authDeletes, 0);
  assert.equal(h.requests.filter(request => request.method === 'DELETE').length, 2);
  assert.ok(!h.rpcCalls.some(call => call.name === 'prepare_account_deletion_auth_delete'));
});

test('cross-module classification still rejects unknown, unmarked, malformed and unauthorized errors before listing', async () => {
  const unexpectedErrors = [
    { __isStorageError: true, name: 'StorageUnknownError', status: 400, statusCode: '400' },
    { name: 'StorageApiError', status: 400, statusCode: '400' },
    { __isStorageError: false, name: 'StorageApiError', status: 400, statusCode: '400' },
    { __isStorageError: true, name: 'StorageApiError', status: '400', statusCode: '400' },
    { __isStorageError: true, name: 'StorageApiError', status: 400 },
    new StorageApiError('synthetic unauthorized', 403, '403'),
    new StorageApiError('synthetic server error', 500, '500'),
  ];
  const results = unexpectedErrors.map(error => ({ data: false, error }));
  for (const data of [null, true, 'false']) results.push({ data, error: new StorageApiError('synthetic missing', 400, '400') });
  for (const existsResult of results) {
    const h = harness({ existsResult });
    assert.deepEqual(await processAccountDeletionJob(h.admin, JOB, NOW), { status: 'retry' });
    assert.equal(h.imageLists, 0); assert.equal(h.authDeletes, 0);
    assert.ok(!h.rpcCalls.some(call => ['checkpoint_account_deletion_media', 'prepare_account_deletion_auth_delete'].includes(call.name)));
  }
});
