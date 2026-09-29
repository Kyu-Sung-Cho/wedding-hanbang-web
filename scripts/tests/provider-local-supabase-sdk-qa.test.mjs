import test from 'node:test';
import assert from 'node:assert/strict';
import { localOnlyFetch, localQaConfiguration, runLocalSdkQa } from '../provider-local-supabase-sdk-qa.mjs';

const args = ['--allow-empty-local-synthetic-writes'];
const environment = () => ({
  PROVIDER_QA_SUPABASE_URL: 'http://127.0.0.1:54321',
  PROVIDER_QA_DATABASE_URL: 'postgresql://postgres:synthetic@127.0.0.1:54322/postgres',
  PROVIDER_QA_ANON_KEY: 'synthetic-anon', PROVIDER_QA_SERVICE_ROLE_KEY: 'synthetic-service',
});

test('local SDK runner requires explicit execution acknowledgement and separate keys', () => {
  assert.throws(() => localQaConfiguration([], environment()), /ACK_REQUIRED/);
  assert.throws(() => localQaConfiguration([...args, '--remote'], environment()), /ACK_REQUIRED/);
  for (const anon of [undefined, '', 'synthetic-service']) {
    assert.throws(() => localQaConfiguration(args, { ...environment(), PROVIDER_QA_ANON_KEY: anon }), /SEPARATE_LOCAL_KEYS_REQUIRED/);
  }
  assert.equal(localQaConfiguration(args, environment()).apiUrl, 'http://127.0.0.1:54321');
});

test('local SDK runner rejects hosted, DNS, credentials, paths and PostgreSQL host overrides', () => {
  for (const url of ['https://example.supabase.co', 'http://localhost:54321', 'http://127.0.0.1.example.invalid:54321',
    'http://user:secret@127.0.0.1:54321', 'http://127.0.0.1:54321/api', 'http://127.0.0.1:54321?remote=yes', 'http://127.0.0.1:54321#remote']) {
    assert.throws(() => localQaConfiguration(args, { ...environment(), PROVIDER_QA_SUPABASE_URL: url }));
  }
  for (const url of ['postgresql://postgres:secret@db.example.supabase.co:5432/postgres',
    'postgresql://postgres@127.0.0.1:54322/postgres?host=db.example.supabase.co',
    'postgresql://postgres@127.0.0.1:54322/customer_database', 'http://127.0.0.1:54322/postgres']) {
    assert.throws(() => localQaConfiguration(args, { ...environment(), PROVIDER_QA_DATABASE_URL: url }), /LOCAL_LITERAL_DATABASE_REQUIRED/);
  }
});

test('SDK transport rejects every different origin and forbids HTTP redirects', async () => {
  const calls = [];
  const transport = localOnlyFetch('http://127.0.0.1:54321', async (input, options) => {
    calls.push({ input, options }); return new Response('{}');
  });
  for (const url of ['https://example.supabase.co/auth/v1/users', 'http://127.0.0.1:9999/rest/v1/providers',
    'http://secret@127.0.0.1:54321/storage/v1/object']) {
    assert.throws(() => transport(url), /SDK_DESTINATION_MISMATCH/);
  }
  assert.equal(calls.length, 0);
  await transport('http://127.0.0.1:54321/auth/v1/health', { redirect: 'follow' });
  assert.equal(calls[0].options.redirect, 'error');
  assert.ok(calls[0].options.signal instanceof AbortSignal);
});

test('programmatic entry also refuses remote configuration before loading any SDK or connection', async () => {
  const config = localQaConfiguration(args, environment());
  await assert.rejects(runLocalSdkQa({ ...config, apiUrl: 'https://example.supabase.co' }), /LOCAL_LITERAL_API_REQUIRED/);
});
