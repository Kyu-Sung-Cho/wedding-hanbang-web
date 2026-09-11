import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { FullRestoreAdmissionBlocked, validateFullRestoreTargetAdmission } from '../lib/full-restore-target-admission.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const json = value => Buffer.from(JSON.stringify(value));
const clone = value => structuredClone(value);
const NOW = Date.parse('2026-09-11T01:00:00.000Z');
const BOUNDARIES = [
  'auth-refresh', 'auth-sign-in', 'data-api', 'host-gateway', 'outbound-dns',
  'outbound-http', 'outbound-smtp', 'outbound-tcp', 'outbound-udp', 'public-ingress',
  'realtime', 'storage-authenticated', 'storage-public', 'storage-s3', 'storage-signed',
];

// 전부 합성 계약 fixture다. production receipt/격리/복원 성공을 흉내 내는 영수증을 쓰지 않는다.
function fixture() {
  const candidate = { commit: 'a'.repeat(40), tree: 'b'.repeat(40) };
  const source = { projectRef: 'syntheticsourceabcde', systemIdentifier: '1111111111111111111' };
  const target = { environmentId: 'synthetic-target-only', systemIdentifier: '2222222222222222222' };
  const backupSetId = '11111111-2222-3333-4444-555555555555';
  const relationNames = [
    'auth.schema_migrations', 'auth.users', 'cron.job', 'public.profiles',
    'public.synthetic_tasks', 'storage.buckets', 'storage.objects',
    'supabase_migrations.schema_migrations', 'vault.secrets',
  ];
  const sourceDatabase = {
    systemIdentifier: source.systemIdentifier,
    readOnly: true, coverage: { extensions: 'complete', roles: 'complete', managedScopes: 'complete', relations: 'complete' },
    pgMajor: 17,
    extensions: [
      { name: 'pg_cron', schema: 'pg_catalog', version: '1.6.4' },
      { name: 'plpgsql', schema: 'pg_catalog', version: '1.0' },
      { name: 'supabase_vault', schema: 'vault', version: '0.3.1' },
    ],
    roles: ['authenticated', 'postgres', 'supabase_auth_admin', 'supabase_storage_admin'].map(name => ({
      name, attributes: { superuser: name === 'postgres', inherit: true, createRole: name === 'postgres',
        createDb: name === 'postgres', canLogin: name !== 'authenticated', replication: false, bypassRls: name === 'postgres' },
      memberships: [],
    })),
    managedScopes: ['auth', 'cron', 'public', 'realtime', 'storage', 'supabase_migrations', 'vault'],
    relations: relationNames.map(identity => ({ identity })),
  };
  const targetRelations = relationNames.map(identity => ({
    identity, mode: identity === 'auth.schema_migrations' ? 'reviewed-bootstrap' : 'customer-empty',
    presence: identity === 'public.synthetic_tasks' ? 'absent' : 'present',
    rows: identity === 'auth.schema_migrations' ? 4 : 0,
    sha256: identity === 'public.synthetic_tasks' ? null : hash(identity === 'auth.schema_migrations' ? 'synthetic-bootstrap-4-rows' : '[]'),
  }));
  const storageIds = [hash('synthetic-object')];
  const manifest = {
    format: 'full-restore-artifact-manifest-v1', candidate, backupSetId, source,
    artifacts: ['database-custom-archive', 'schema-original', 'storage-index',
      ...relationNames.map(name => `relation:${name}`), ...storageIds.map(id => `storage:${id}`)]
      .sort().map(scope => ({ scope, bytes: 123, sha256: hash('synthetic-' + scope) })),
  };
  const collectorPins = Object.fromEntries(['source', 'target', 'isolation'].map(kind => [kind, hash('synthetic-collector-' + kind)]));
  const raw = {};
  const binding = { candidate, backupSetId, source, target, manifestSha256: hash(json(manifest)) };
  for (const kind of ['source', 'target', 'isolation'])
    raw[kind] = { format: `full-restore-${kind}-receipt-v1`, collectorSha256: collectorPins[kind],
      capturedAt: '2026-09-11T00:59:00.000Z', binding: clone(binding), observation: null };
  raw.source.observation = { database: sourceDatabase, storageObjectIdentities: storageIds };
  raw.target.observation = { phase: 'before-original-restore', database: {
    ...clone(sourceDatabase), systemIdentifier: target.systemIdentifier,
    relations: targetRelations.map(({ mode: _mode, ...row }) => row),
  } };
  raw.isolation.observation = { phase: 'before-original-restore', targetReceiptSha256: hash(json(raw.target)),
    checks: BOUNDARIES.map(boundary => ({ boundary, configuration: 'blocked', probe: 'blocked',
      configurationEvidenceSha256: hash('synthetic-config-' + boundary),
      probeEvidenceSha256: hash('synthetic-probe-' + boundary) })) };
  const expected = { candidate, backupSetId, source, target, manifestSha256: binding.manifestSha256,
    receiptPins: Object.fromEntries(Object.entries(raw).map(([kind, body]) => [kind, hash(json(body))])),
    collectorPins, targetRelations };
  return { expected, receipts: Object.fromEntries(Object.entries(raw).map(([kind, body]) => [kind, json(body)])),
    artifactManifest: json(manifest), now: NOW };
}

function changeReceipt(input, kind, change, repin = true) {
  const body = JSON.parse(input.receipts[kind]);
  change(body);
  input.receipts[kind] = json(body);
  if (repin) input.expected.receiptPins[kind] = hash(input.receipts[kind]);
}
function changeManifest(input, change) {
  const body = JSON.parse(input.artifactManifest);
  change(body);
  input.artifactManifest = json(body);
  input.expected.manifestSha256 = hash(input.artifactManifest);
  for (const kind of ['source', 'target', 'isolation'])
    changeReceipt(input, kind, receipt => { receipt.binding.manifestSha256 = input.expected.manifestSha256; });
}
function blocked(input, code) {
  assert.throws(() => validateFullRestoreTargetAdmission(input), error =>
    error instanceof FullRestoreAdmissionBlocked && error.code === code && error.message === code);
}

test('synthetic full coverage validates a contract only, preserving reviewed bootstrap and explicit absent customer tables', () => {
  const input = fixture();
  const before = JSON.stringify(input);
  const result = validateFullRestoreTargetAdmission(input);
  assert.equal(result.evidenceContractValidated, true);
  assert.equal(result.observationsAuthenticated, false);
  assert.equal(result.artifactsRehashed, false);
  assert.equal(result.restoreExecuted, false);
  assert.equal(result.releaseAuthorized, false);
  assert.equal(result.relationCount, 9);
  assert.equal(result.artifactCount, 13);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(JSON.stringify(input), before);
});

test('source identity cannot be reused as target even with a different label or server id', async t => {
  for (const field of ['environmentId', 'systemIdentifier']) await t.test(field, () => {
    const input = fixture();
    input.expected.target[field] = field === 'environmentId' ? input.expected.source.projectRef : input.expected.source.systemIdentifier;
    blocked(input, 'SOURCE_TARGET_COLLISION');
  });
});

test('all three original receipt byte buffers and independent pins are mandatory', async t => {
  for (const kind of ['source', 'target', 'isolation']) {
    await t.test(kind + ' byte change', () => {
      const input = fixture();
      changeReceipt(input, kind, body => { body.capturedAt = '2026-09-11T00:58:00.000Z'; }, false);
      blocked(input, 'RECEIPT_HASH_MISMATCH');
    });
    await t.test(kind + ' only summary JSON', () => {
      const input = fixture();
      input.receipts[kind] = JSON.parse(input.receipts[kind]);
      blocked(input, 'RECEIPT_INVALID');
    });
  }
});

test('candidate commit/tree, backup set, source/target and manifest must be bound in every receipt', async t => {
  for (const kind of ['source', 'target', 'isolation']) for (const field of ['candidate', 'backupSetId', 'source', 'target', 'manifestSha256'])
    await t.test(kind + '/' + field, () => {
      const input = fixture();
      changeReceipt(input, kind, body => { body.binding[field] = null; });
      blocked(input, 'RECEIPT_BINDING_MISMATCH');
    });
});

test('wrong collector producer is rejected after otherwise valid raw-byte hash', () => {
  const input = fixture();
  changeReceipt(input, 'isolation', body => { body.collectorSha256 = hash('unreviewed-producer'); });
  blocked(input, 'RECEIPT_PRODUCER_MISMATCH');
});

test('a correct envelope cannot relabel the actual source or target database observation', async t => {
  for (const kind of ['source', 'target']) await t.test(kind, () => {
    const input = fixture();
    changeReceipt(input, kind, body => { body.observation.database.systemIdentifier = '3333333333333333333'; });
    blocked(input, 'OBSERVED_DATABASE_IDENTITY_MISMATCH');
  });
});

test('missing, stale, future and normalized invalid date receipts do not count as fresh observations', async t => {
  for (const value of [null, '2026-09-11T00:44:59.999Z', '2026-09-11T01:00:00.001Z', 'not-a-date'])
    await t.test(String(value), () => {
      const input = fixture();
      changeReceipt(input, 'target', body => { body.capturedAt = value; });
      blocked(input, 'RECEIPT_TIME_INVALID');
    });
  await t.test('February 30 rollover', () => {
    const input = fixture();
    input.now = Date.parse('2026-03-02T01:00:00.000Z');
    changeReceipt(input, 'source', body => { body.capturedAt = '2026-02-30T00:59:00.000Z'; });
    blocked(input, 'RECEIPT_TIME_INVALID');
  });
});

test('the actual capture manifest requires custom archive, schema with embedded globals, managed relations and storage originals', async t => {
  for (const scope of ['database-custom-archive', 'schema-original', 'storage-index', 'relation:auth.users', 'storage:' + hash('synthetic-object')])
    await t.test(scope, () => {
      const input = fixture();
      changeManifest(input, body => { body.artifacts = body.artifacts.filter(row => row.scope !== scope); });
      blocked(input, 'MANIFEST_SCOPE_INCOMPLETE');
    });
});

test('self-declared complete receipts cannot jointly omit a required managed relation from source, target and manifest', async t => {
  for (const identity of ['auth.users', 'cron.job', 'public.profiles', 'storage.buckets', 'storage.objects',
    'supabase_migrations.schema_migrations', 'vault.secrets']) await t.test(identity, () => {
    const input = fixture();
    changeReceipt(input, 'source', body => {
      body.observation.database.relations = body.observation.database.relations.filter(row => row.identity !== identity);
    });
    changeReceipt(input, 'target', body => {
      body.observation.database.relations = body.observation.database.relations.filter(row => row.identity !== identity);
    });
    input.expected.targetRelations = input.expected.targetRelations.filter(row => row.identity !== identity);
    changeManifest(input, body => { body.artifacts = body.artifacts.filter(row => row.scope !== 'relation:' + identity); });
    blocked(input, 'SOURCE_MANAGED_RELATION_MISSING');
  });
});

test('realtime cannot be jointly omitted from otherwise matching complete managed scope inventories', () => {
  const input = fixture();
  for (const kind of ['source', 'target']) changeReceipt(input, kind, body => {
    body.observation.database.managedScopes = body.observation.database.managedScopes.filter(name => name !== 'realtime');
  });
  blocked(input, 'MANAGED_SCOPE_INCOMPLETE');
});

test('manifest wrong candidate and duplicate or malformed pins are rejected', async t => {
  await t.test('candidate', () => {
    const input = fixture();
    changeManifest(input, body => { body.candidate.commit = 'c'.repeat(40); });
    blocked(input, 'MANIFEST_BINDING_MISMATCH');
  });
  await t.test('duplicate', () => {
    const input = fixture();
    changeManifest(input, body => { body.artifacts.splice(1, 0, body.artifacts[0]); });
    blocked(input, 'MANIFEST_SCOPE_INVALID');
  });
  await t.test('coerced hash array', () => {
    const input = fixture();
    changeManifest(input, body => { body.artifacts[0].sha256 = [body.artifacts[0].sha256]; });
    blocked(input, 'MANIFEST_INVALID');
  });
});

test('stock native PG missing managed extensions and wrong extension versions are incompatible', async t => {
  for (const kind of ['missing-cron', 'missing-vault', 'wrong-version', 'wrong-schema', 'wrong-major'])
    await t.test(kind, () => {
      const input = fixture();
      changeReceipt(input, 'target', body => {
        const db = body.observation.database;
        if (kind === 'missing-cron') db.extensions = db.extensions.filter(row => row.name !== 'pg_cron');
        if (kind === 'missing-vault') db.extensions = db.extensions.filter(row => row.name !== 'supabase_vault');
        if (kind === 'wrong-version') db.extensions[0].version = '1.6.3';
        if (kind === 'wrong-schema') db.extensions[0].schema = 'public';
        if (kind === 'wrong-major') db.pgMajor = 16;
      });
      blocked(input, kind === 'wrong-major' ? 'DATABASE_COMPATIBILITY_UNVERIFIED' : 'DATABASE_COMPATIBILITY_MISMATCH');
    });
});

test('scope or role capability/member drift cannot be declared compatible', async t => {
  for (const kind of ['scope', 'role', 'attribute', 'membership', 'password'])
    await t.test(kind, () => {
      const input = fixture();
      changeReceipt(input, 'target', body => {
        const db = body.observation.database;
        if (kind === 'scope') db.managedScopes = db.managedScopes.filter(name => name !== 'auth');
        if (kind === 'role') db.roles.pop();
        if (kind === 'attribute') db.roles[0].attributes.bypassRls = true;
        if (kind === 'membership') db.roles[0].memberships = [{ role: 'postgres', admin: true, inherit: true, set: true }];
        if (kind === 'password') db.roles[0].password = 'synthetic-forbidden-field';
      });
      blocked(input, kind === 'scope' ? 'MANAGED_SCOPE_INCOMPLETE' : kind === 'password' ? 'ROLES_INVALID' : 'DATABASE_COMPATIBILITY_MISMATCH');
    });
});

test('complete coverage must be present for source and target; unknown is not complete', async t => {
  for (const kind of ['source', 'target']) for (const domain of ['extensions', 'roles', 'managedScopes', 'relations'])
    await t.test(kind + '/' + domain, () => {
      const input = fixture();
      changeReceipt(input, kind, body => { body.observation.database.coverage[domain] = 'unknown'; });
      blocked(input, 'INVENTORY_COVERAGE_INCOMPLETE');
    });
});

test('target customer rows, bootstrap count/hash and actual extra relation must match reviewed expected inventory', async t => {
  for (const kind of ['customer-data', 'bootstrap-count', 'bootstrap-hash', 'extra'])
    await t.test(kind, () => {
      const input = fixture();
      changeReceipt(input, 'target', body => {
        const rows = body.observation.database.relations;
        if (kind === 'customer-data') { rows.find(row => row.identity === 'auth.users').rows = 1; }
        if (kind === 'bootstrap-count') rows[0].rows = 5;
        if (kind === 'bootstrap-hash') rows[0].sha256 = hash('different-four-bootstrap-rows');
        if (kind === 'extra') { rows.push({ identity: 'vault.unknown', presence: 'present', rows: 1, sha256: hash('row') }); }
      });
      blocked(input, 'TARGET_STATE_MISMATCH');
    });
});

test('removing the same source customer relation from both target receipt and reviewed target list remains incomplete', () => {
  const input = fixture();
  input.expected.targetRelations = input.expected.targetRelations.filter(row => row.identity !== 'public.synthetic_tasks');
  changeReceipt(input, 'target', body => { body.observation.database.relations = body.observation.database.relations.filter(row => row.identity !== 'public.synthetic_tasks'); });
  blocked(input, 'TARGET_RELATION_COVERAGE_INCOMPLETE');
});

test('expected customer-empty policy cannot itself authorize nonempty data', () => {
  const input = fixture();
  input.expected.targetRelations.find(row => row.identity === 'auth.users').rows = 1;
  blocked(input, 'TARGET_EMPTY_POLICY_INVALID');
});

test('absent state cannot hide a nonzero row, content hash or unknown presence', async t => {
  for (const kind of ['rows', 'hash', 'unknown'])
    await t.test(kind, () => {
      const input = fixture();
      changeReceipt(input, 'target', body => {
        const row = body.observation.database.relations.find(row => row.identity === 'public.synthetic_tasks');
        if (kind === 'rows') row.rows = 1;
        if (kind === 'hash') row.sha256 = hash('hidden-row');
        if (kind === 'unknown') row.presence = 'unknown';
      });
      blocked(input, 'RELATION_STATE_INVALID');
    });
});

test('isolation must reference the exact target empty-state receipt', () => {
  const input = fixture();
  changeReceipt(input, 'isolation', body => { body.observation.targetReceiptSha256 = hash('different-target'); });
  blocked(input, 'ISOLATION_TARGET_MISMATCH');
});

test('each concrete ingress/egress boundary needs configuration and denial probe', async t => {
  for (const boundary of BOUNDARIES)
    await t.test(boundary, () => {
      const input = fixture();
      changeReceipt(input, 'isolation', body => { body.observation.checks.find(row => row.boundary === boundary).probe = 'unknown'; });
      blocked(input, 'ISOLATION_UNVERIFIED');
    });
});

test('boolean-only, false, missing proof hashes and partially covered isolation are refused', async t => {
  for (const kind of ['boolean', 'false', 'hash', 'partial'])
    await t.test(kind, () => {
      const input = fixture();
      changeReceipt(input, 'isolation', body => {
        if (kind === 'boolean') body.observation.checks[0].configuration = true;
        if (kind === 'false') body.observation.checks[0].probe = false;
        if (kind === 'hash') body.observation.checks[0].probeEvidenceSha256 = null;
        if (kind === 'partial') body.observation.checks.pop();
      });
      blocked(input, kind === 'partial' ? 'ISOLATION_COVERAGE_INCOMPLETE' : 'ISOLATION_UNVERIFIED');
    });
});

test('after-restore receipts and unknown observation keys cannot become before-restore admission', async t => {
  for (const kind of ['phase', 'unknown-key'])
    await t.test(kind, () => {
      const input = fixture();
      changeReceipt(input, 'target', body => {
        if (kind === 'phase') body.observation.phase = 'after-original-restore';
        else body.observation.allowPartial = true;
      });
      blocked(input, kind === 'phase' ? 'TARGET_PHASE_INVALID' : 'TARGET_OBSERVATION_INVALID');
    });
});

test('errors expose a fixed code rather than malformed source data', () => {
  const input = fixture();
  input.receipts.source = Buffer.from('synthetic-sensitive-payload-invalid-json');
  input.expected.receiptPins.source = hash(input.receipts.source);
  blocked(input, 'RECEIPT_INVALID');
});
