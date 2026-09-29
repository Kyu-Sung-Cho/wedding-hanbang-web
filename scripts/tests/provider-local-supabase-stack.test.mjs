import test from 'node:test';
import assert from 'node:assert/strict';
import { localDockerEnvironment, runDisposableProviderStack, stackConfiguration } from '../provider-local-supabase-stack.mjs';

test('disposable stack cannot reuse a linked project or enable its historical migrations', () => {
  const ports = [54331, 54332, 54333, 54334, 54335];
  const config = stackConfiguration(`provider-qa-${'a'.repeat(32)}`, ports);
  assert.match(config, /\[db.migrations\]\nenabled = false/);
  assert.match(config, /\[db.seed\]\nenabled = false/);
  assert.doesNotMatch(config, /slrtobkksjmxgzatjyqb|env\(|https:/);
  assert.throws(() => stackConfiguration('wedding', ports));
  assert.throws(() => stackConfiguration(`provider-qa-${'a'.repeat(32)}`, [1, 2, 3, 4, 5]));
  assert.throws(() => stackConfiguration(`provider-qa-${'a'.repeat(32)}`, [54331, 54331, 54333, 54334, 54335]));
});

test('local Docker environment removes inherited database credentials and remote context', () => {
  const env = localDockerEnvironment({ PATH: '/bin', SUPABASE_ACCESS_TOKEN: 'secret', SUPABASE_WORKDIR: '/linked',
    PGHOST: 'production', PGPASSWORD: 'secret', DOCKER_CONTEXT: 'remote', PROVIDER_QA_DATABASE_URL: 'secret' }, 'linux');
  assert.equal(env.DOCKER_HOST, 'unix:///var/run/docker.sock');
  assert.equal(env.DOCKER_CONTEXT, '');
  for (const key of ['SUPABASE_ACCESS_TOKEN', 'SUPABASE_WORKDIR', 'PGHOST', 'PGPASSWORD', 'PROVIDER_QA_DATABASE_URL']) assert.equal(env[key], undefined);
  assert.throws(() => localDockerEnvironment({ DOCKER_HOST: 'tcp://remote:2375' }, 'linux'), /LOCAL_DOCKER_ENGINE_REQUIRED/);
});

test('stack runner refuses unacknowledged or extra arguments before touching Docker', async () => {
  for (const args of [[], ['--apply'], ['--allow-disposable-local-stack', '--project=wedding']]) {
    await assert.rejects(runDisposableProviderStack(args, {}), /DISPOSABLE_LOCAL_STACK_ACK_REQUIRED/);
  }
});
