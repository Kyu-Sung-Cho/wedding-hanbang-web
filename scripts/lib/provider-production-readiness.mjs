import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { CurrentBaselineBlocked, pinnedArtifact, requireRelease } from './current-baseline-release-contract.mjs';
import { loadProviderParticipationReleasePlan } from './provider-participation-release-contract.mjs';
import { buildProviderObservationSql, validateProviderObservation } from './provider-participation-catalog.mjs';
import { expectedProviderLedger, providerBundleParts } from './provider-participation-release.mjs';

// Inspection only: no mutation, arbitrary destination, caller-supplied SQL or
// receipt-to-authorization conversion exists in this module.
export function buildProviderReadinessSql() {
  const marker = "'targetLedger',";
  const sql = buildProviderObservationSql();
  requireRelease(sql.split(marker).length === 2, 'PROVIDER_READINESS_QUERY_CHANGED');
  return sql.replace(marker, `'allLedger',(SELECT coalesce(jsonb_agg(jsonb_build_object('version',version,'name',name) ORDER BY version),'[]'::jsonb)
    FROM supabase_migrations.schema_migrations),${marker}`);
}

export function assessProviderReadiness(repoRoot, observation, now = new Date()) {
  const plan = loadProviderParticipationReleasePlan(repoRoot);
  const fixtures = JSON.parse(pinnedArtifact(repoRoot, plan.contract.catalogFixture));
  requireRelease(Number.isInteger(observation?.ledgerCount) && observation.ledgerCount >= 0
    && Array.isArray(observation.allLedger) && observation.allLedger.length === observation.ledgerCount
    && observation.allLedger.every(row => /^\d{14}$/.test(row?.version) && (row.name === null || typeof row.name === 'string'))
    && new Set(observation.allLedger.map(row => row.version)).size === observation.ledgerCount,
  'PROVIDER_READINESS_LEDGER_INVALID');
  // Validate transport identity, time and storage authority even when reporting
  // an incomplete target. Target equality is evaluated separately below.
  validateProviderObservation(observation, { expectedTarget: observation.target, expectedLedger: observation.targetLedger,
    expectedSystem: plan.contract.systemIdentifier, expectedCount: observation.ledgerCount, now });
  requireRelease(observation.target && Array.isArray(observation.targetLedger), 'PROVIDER_READINESS_TARGET_INVALID');
  const ledger = expectedProviderLedger(providerBundleParts(repoRoot, plan));
  const before = isDeepStrictEqual(observation.target, fixtures.before) && isDeepStrictEqual(observation.targetLedger, []);
  const after = isDeepStrictEqual(observation.target, fixtures.after) && isDeepStrictEqual(observation.targetLedger, ledger);
  const known = new Map(plan.reviewedMigrations.map(pin => [pin.file.slice(0, 14), pin.file]));
  const remoteVersions = new Set(observation.allLedger.map(row => row.version));
  const providerVersions = new Set(ledger.map(row => row.version));
  requireRelease(isDeepStrictEqual(observation.allLedger.filter(row => providerVersions.has(row.version)).map(row => row.version).sort(),
    observation.targetLedger.map(row => row.version).sort()), 'PROVIDER_READINESS_LEDGER_INVALID');
  const differences = expected => Object.keys(expected).filter(key => !isDeepStrictEqual(observation.target[key], expected[key]));
  return {
    format: 'provider-production-readiness-v1', observedAt: observation.observedAt,
    projectRef: plan.contract.projectRef, systemIdentifier: plan.contract.systemIdentifier, contractSha256: plan.contractSha256,
    querySha256: createHash('sha256').update(buildProviderReadinessSql()).digest('hex'),
    schemaState: after ? 'installed-exact' : before ? 'absent-reviewed-baseline' : 'partial-or-drifted',
    schemaReady: after, currentLedgerCount: observation.ledgerCount, reviewedLocalCount: plan.migrationCount,
    missingLocalVersions: [...known].filter(([version]) => !remoteVersions.has(version)).map(([, file]) => file),
    remoteOnlyVersions: [...remoteVersions].filter(version => !known.has(version)),
    beforeTargetDifferences: differences(fixtures.before), afterTargetDifferences: differences(fixtures.after),
    providerLedgerMatches: isDeepStrictEqual(observation.targetLedger, ledger),
    // Version lists are diagnostics. They neither prove equivalent historical
    // schemas nor authorize filling the ledger or applying old local SQL.
    historicalSchemaEquivalenceVerified: false, readOnly: true, remoteWritesPerformed: false,
    productionApplyImplemented: plan.productionApplyImplemented,
    runtimeEvidenceVerified: plan.runtimeEvidenceVerified, releaseAuthorized: false,
  };
}

export async function inspectProviderProduction({ repoRoot, environment = process.env, fetcher = globalThis.fetch, now = () => new Date() }) {
  const plan = loadProviderParticipationReleasePlan(repoRoot);
  const token = environment.SUPABASE_ACCESS_TOKEN;
  requireRelease(typeof token === 'string' && /^(?:sbp_|sbp_oauth_)[a-f0-9]{40}$/.test(token), 'PROVIDER_READINESS_ACCESS_TOKEN_REQUIRED');
  try {
    const response = await fetcher(`https://api.supabase.com/v1/projects/${plan.contract.projectRef}/database/query`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(45_000),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: buildProviderReadinessSql(), read_only: true }),
    });
    requireRelease(response.ok && response.body, 'PROVIDER_READINESS_REMOTE_QUERY_FAILED');
    const reader = response.body.getReader(); let size = 0; const chunks = [];
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        requireRelease(size <= 2 * 1024 * 1024, 'PROVIDER_READINESS_RESPONSE_TOO_LARGE');
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    const rows = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    requireRelease(Array.isArray(rows) && rows.length === 1 && rows[0]?.observation, 'PROVIDER_READINESS_RESPONSE_INVALID');
    return assessProviderReadiness(repoRoot, rows[0].observation, now());
  } catch (error) {
    if (error instanceof CurrentBaselineBlocked) throw error;
    // Do not print HTTP bodies, credentials, SQL or fetch errors.
    throw new CurrentBaselineBlocked('PROVIDER_READINESS_QUERY_UNAVAILABLE');
  }
}
