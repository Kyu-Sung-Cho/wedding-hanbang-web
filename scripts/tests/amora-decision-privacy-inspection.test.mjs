import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { loadAmoraDecisionPrivacyCandidate } from '../lib/amora-decision-privacy-candidate.mjs';
import { buildAmoraDecisionPrivacyInspectionSql, validateAmoraDecisionPrivacyInspection, classifyAmoraDecisionPrivacyLedger } from '../lib/amora-decision-privacy-inspection.mjs';

const plan = loadAmoraDecisionPrivacyCandidate(resolve(import.meta.dirname, '../..'));
const at = new Date('2026-09-20T17:33:01.000Z');
const sha = 'a'.repeat(64);
function observation() {
  const scope = plan.contract.scope;
  return {
    format: 'amora-decision-privacy-inspection-v1', systemIdentifier: plan.contract.systemIdentifier,
    database: 'postgres', serverVersion: '17.6', currentUser: 'supabase_read_only_user',
    sessionUser: 'supabase_read_only_user', readOnly: true, observedAt: at.toISOString(),
    ledger: [{ version: '20260920120000', name: 'wedding_preparation_style', statementCount: 1,
      statementsSha256: sha, singleStatementSha256: sha }], ledgerSha256: sha,
    functions: [...scope.changedFunctions, ...scope.addedFunctions].sort().map(signature =>
      scope.addedFunctions.includes(signature) ? { signature, present: false } : {
        signature, present: true, definitionSha256: sha, catalogSha256: sha, owner: 'postgres',
        securityDefiner: true, config: ['search_path=public'], arguments: '', result: 'jsonb',
        language: 'plpgsql', volatility: 'v', strict: false, parallel: 'u', leakproof: false,
        acl: [{ grantee: 'postgres', grantor: 'postgres', privilege: 'EXECUTE', grantable: false }],
        effectiveExecute: { anon: false, authenticated: false, service_role: false },
      }), overloads: [], preservedCatalogSha256: sha,
  };
}
const validate = value => validateAmoraDecisionPrivacyInspection(value, { plan,
  startedAt: new Date(at.getTime() - 100), finishedAt: new Date(at.getTime() + 100) });

test('read-only inspection accepts the actual read-only role without treating reviewed SQL count as live ledger count or granting authority', () => {
  const result = validate(observation());
  assert.equal(result.currentUser, 'supabase_read_only_user');
  assert.equal(result.ledgerCount, 1);
  assert.equal(result.ledgerState, 'candidate-absent');
  assert.equal(result.status, 'observed-unreviewed');
  for (const key of ['productionApplyImplemented', 'runtimeEvidenceVerified', 'releaseAuthorized', 'remoteWritesPerformed'])
    assert.equal(result[key], false);
});

test('inspection rejects a different database identity, elevated role, writable or out-of-window observation', () => {
  for (const patch of [{ systemIdentifier: '1234567890123456789' }, { database: 'other' }, { serverVersion: '18.0' },
    { currentUser: 'postgres' }, { sessionUser: 'postgres' }, { readOnly: false },
    { observedAt: new Date(at.getTime() + 11000).toISOString() }, { observedAt: 'invalid' }])
    assert.throws(() => validate({ ...observation(), ...patch }), undefined, JSON.stringify(patch));
  assert.throws(() => validateAmoraDecisionPrivacyInspection(observation(), { plan, startedAt: at,
    finishedAt: new Date(at.getTime() - 1) }));
  assert.throws(() => validateAmoraDecisionPrivacyInspection(observation(), { plan, startedAt: at,
    finishedAt: new Date(at.getTime() + 120001) }));
});

test('inspection distinguishes absent, partial, present-but-unreviewed and conflicting candidate ledger rows without authorizing them', () => {
  const value = observation();
  const candidateRows = plan.contract.migrations.map(pin => ({ version: pin.file.slice(0, 14), name: pin.file.slice(15, -4),
    statementCount: 1, statementsSha256: sha, singleStatementSha256: pin.sha256 }));
  assert.equal(classifyAmoraDecisionPrivacyLedger(value, plan), 'candidate-absent');
  value.ledger.push(candidateRows[0]);
  assert.equal(classifyAmoraDecisionPrivacyLedger(value, plan), 'partial');
  value.ledger.push(candidateRows[1]);
  assert.equal(validate(value).ledgerState, 'candidate-present-unreviewed');
  assert.equal(validate(value).releaseAuthorized, false);
  for (const patch of [{ name: 'different' }, { statementCount: 2 }, { singleStatementSha256: 'f'.repeat(64) }]) {
    const altered = structuredClone(value); Object.assign(altered.ledger.at(-1), patch);
    if (patch.statementCount === 2) altered.ledger.at(-1).singleStatementSha256 = null;
    assert.equal(classifyAmoraDecisionPrivacyLedger(altered, plan), 'conflict');
  }
  for (const ledger of [[value.ledger[0], value.ledger[0]], [...value.ledger].reverse(), [{ ...value.ledger[0], statementsSha256: 'wrong' }]])
    assert.throws(() => validate({ ...value, ledger }));
  const historical = { ...value.ledger[0], name: null, statementCount: null, statementsSha256: null, singleStatementSha256: null };
  assert.equal(validate({ ...observation(), ledger: [historical] }).ledgerState, 'candidate-absent');
});

test('inspection refuses incomplete, duplicated, out-of-scope or malformed function and catalog evidence', () => {
  const changes = [value => value.functions.pop(), value => value.functions.push(value.functions[0]),
    value => value.functions.reverse(), value => { value.functions[0].signature = 'public.unrelated()'; },
    value => { value.functions[0].catalogSha256 = 'invalid'; },
    value => { value.functions[0].effectiveExecute.authenticated = 'true'; },
    value => { value.functions[0].acl[0].grantable = 'false'; },
    value => { value.functions[0].definition = 'DO NOT RETURN DATABASE FUNCTION SOURCE'; },
    value => { value.preservedCatalogSha256 = null; }, value => { value.customerRows = ['private user text']; },
    value => { value.overloads = [{ ...value.functions[0], signature: 'public.unrelated(text)' }]; }];
  for (const change of changes) {
    const value = observation(); change(value); assert.throws(() => validate(value));
  }
  const withOverload = observation();
  withOverload.overloads = [{ ...withOverload.functions[0], signature: 'public.amora_shared_action_policy(text)' }];
  assert.equal(validate(withOverload).overloads.length, 1);
  assert.equal(validate(withOverload).releaseAuthorized, false);
});

test('every inspection API rejects a forged destination, scope, candidate pin or authority in its plan', () => {
  for (const change of [value => { value.contract.projectRef = 'x'.repeat(20); },
    value => { value.contract.scope.changedFunctions[0] = "public.unrelated(text');SELECT 1;--)"; },
    value => { value.contract.migrations[0].sha256 = 'f'.repeat(64); },
    value => { value.contract.productionApplyImplemented = true; }, value => { value.staticVerified = false; },
    value => { value.contractSha256 = 'f'.repeat(64); }]) {
    const altered = structuredClone(plan); change(altered);
    assert.throws(() => buildAmoraDecisionPrivacyInspectionSql(altered), { code: 'AMORA_INSPECTION_PLAN_INVALID' });
    assert.throws(() => classifyAmoraDecisionPrivacyLedger(observation(), altered), { code: 'AMORA_INSPECTION_PLAN_INVALID' });
    assert.throws(() => validateAmoraDecisionPrivacyInspection(observation(), { plan: altered, startedAt: at, finishedAt: at }),
      { code: 'AMORA_INSPECTION_PLAN_INVALID' });
  }
});

test('malformed observation entries fail with a controlled evidence error rather than coercing identifiers or throwing a type error', () => {
  for (const [change, code] of [
    [value => { value.ledger[0].version = 20260920120000; }, 'AMORA_INSPECTION_LEDGER_INVALID'],
    [value => { value.functions[0] = null; }, 'AMORA_INSPECTION_CATALOG_INVALID'],
    [value => { value.overloads = [null]; }, 'AMORA_INSPECTION_OVERLOAD_INVALID'],
    [value => { value.ledger[0].name = 'bad\0name'; }, 'AMORA_INSPECTION_LEDGER_INVALID'],
  ]) {
    const value = observation(); change(value); assert.throws(() => validate(value), { code });
  }
});
