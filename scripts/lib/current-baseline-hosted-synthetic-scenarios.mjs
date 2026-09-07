import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { digestJson } from './current-baseline-release-contract.mjs';

export function syntheticIds(namespace) {
  const id = name => {
    const hex = createHash('sha256').update(`${namespace}:${name}`).digest('hex');
    return `60907000-${hex.slice(0, 4)}-4${hex.slice(4, 7)}-8${hex.slice(7, 10)}-${hex.slice(10, 22)}`;
  };
  return Object.fromEntries(['owner', 'partner', 'outsider', 'couple', 'otherCouple', 'journey', 'sharedSegment',
    'privateSegment', 'sharedMessage', 'userMessage', 'privateMessage', 'mediationMessage', 'request', 'postHot', 'postNew'].map(name => [name, id(name)]));
}

async function actor(db, id, role = 'authenticated') {
  await db.query('RESET ROLE');
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true),set_config('request.jwt.claims',$3,true)",
    [id, role, JSON.stringify({ sub: id, role })]);
  if (role === 'authenticated') await db.query('SET LOCAL ROLE authenticated');
}
async function rejected(db, code, query, values) {
  await db.query('SAVEPOINT synthetic_expected_rejection');
  let actual;
  try { await db.query(query, values); }
  catch (error) { actual = error.code; }
  finally { await db.query('ROLLBACK TO SAVEPOINT synthetic_expected_rejection'); await db.query('RELEASE SAVEPOINT synthetic_expected_rejection'); }
  assert.equal(actual, code, 'expected SQL boundary must reject with its domain SQLSTATE');
  return { expectedSqlstate: code, observedSqlstate: actual };
}
const record = (name, observed) => ({ name, status: 'passed', observed, rawEvidenceSha256: digestJson(observed) });

async function segment(db, ids, visibility) {
  const owner = visibility === 'shared' ? null : ids.owner;
  const found = (await db.query(`SELECT id FROM public.conversation_segments WHERE couple_id=$1 AND visibility=$2 AND status='active'`, [ids.couple, visibility])).rows;
  assert.ok(found.length <= 1);
  if (found.length) return found[0].id;
  const id = visibility === 'shared' ? ids.sharedSegment : ids.privateSegment;
  await db.query(`INSERT INTO public.conversation_segments(id,couple_id,visibility,owner_user_id,started_by,start_reason)
    VALUES($1,$2,$3,$4,$5,'initial')`, [id, ids.couple, visibility, owner, ids.owner]);
  return id;
}

async function seed(db, ids) {
  await db.query('RESET ROLE');
  const collision = (await db.query(`SELECT
    (SELECT count(*) FROM public.couples WHERE id=ANY($1::uuid[]))+
    (SELECT count(*) FROM public.chat_messages WHERE id=ANY($2::uuid[])) AS count`,
  [[ids.couple, ids.otherCouple], [ids.sharedMessage, ids.userMessage, ids.privateMessage, ids.mediationMessage]])).rows[0];
  assert.equal(Number(collision.count), 0, 'synthetic identifiers must not reuse existing records');
  for (const id of [ids.owner, ids.partner, ids.outsider]) {
    await db.query(`INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
      VALUES($1,$2,'{}','{"name":"SYNTHETIC RELEASE ONLY"}')`, [id, `${id}@synthetic-release.invalid`]);
    // 운영 baseline의 가입 trigger가 만든 자기 fixture만 초기화한다.
    await db.query(`INSERT INTO public.profiles(id) VALUES($1) ON CONFLICT(id) DO NOTHING`, [id]);
  }
  await db.query(`INSERT INTO public.couples(id,bride_id,groom_id) VALUES($1,$2,$3),($4,$5,null)`,
    [ids.couple, ids.owner, ids.partner, ids.otherCouple, ids.outsider]);
  await db.query(`INSERT INTO public.amora_privacy_context_epochs(couple_id,epoch) VALUES($1,1),($2,1) ON CONFLICT(couple_id) DO NOTHING`, [ids.couple, ids.otherCouple]);
  await db.query(`UPDATE public.profiles SET couple_id=CASE WHEN id=$2 THEN $3::uuid ELSE $4::uuid END,
    role=CASE WHEN id=$1 THEN 'groom' ELSE 'bride' END WHERE id=ANY($5::uuid[])`,
  [ids.partner, ids.outsider, ids.otherCouple, ids.couple, [ids.owner, ids.partner, ids.outsider]]);
  const shared = await segment(db, ids, 'shared'); const personal = await segment(db, ids, 'bride_private');
  const messages = [
    [ids.sharedMessage, shared, 'shared', null, 'ai', 'assistant', 'SYNTHETIC SHARED CANONICAL TEXT', {}],
    [ids.userMessage, personal, 'bride_private', ids.owner, 'bride', 'user', 'SYNTHETIC PRIVATE REQUEST', {}],
    [ids.privateMessage, personal, 'bride_private', null, 'ai', 'assistant', 'SYNTHETIC PRIVATE ANSWER', { in_reply_to_user_message_id: ids.userMessage }],
    [ids.mediationMessage, shared, 'shared', null, 'ai', 'assistant', 'SYNTHETIC MEDIATION',
      { mediation: { resolution: 'SYNTHETIC TWO EXPLICIT RESPONSES', origin: 'user_requested', evidenceScope: 'requester_summary_only', schemaVersion: 2 } }],
  ];
  for (const [id, segmentId, visibility, sender, senderType, role, content, metadata] of messages) {
    await db.query(`INSERT INTO public.chat_messages(id,couple_id,segment_id,visibility,sender_id,sender_type,role,content,metadata)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`, [id, ids.couple, segmentId, visibility, sender, senderType, role, content, JSON.stringify(metadata)]);
  }
  await db.query(`INSERT INTO public.wedding_journeys(id,couple_id,total_budget,progress) VALUES($1,$2,50000000,'{}')
    ON CONFLICT(couple_id) DO NOTHING`, [ids.journey, ids.couple]);
}

export async function runSyntheticScenarios(db, ids) {
  await seed(db, ids); const checks = [];
  await actor(db, ids.owner);
  const actionId = `synthetic_${ids.request.replaceAll('-', '')}`;
  const actionSql = 'SELECT public.mutate_own_amora_action($1,$2,$3,$4::jsonb) AS result';
  const created = (await db.query(actionSql, [ids.couple, actionId, 'create', JSON.stringify({ title: 'SYNTHETIC MANUAL ACTION', source: 'manual', status: 'open' })])).rows[0].result;
  assert.equal(created.id, actionId); assert.equal(created.couple_id, ids.couple); assert.equal(created.status, 'open');
  const completed = (await db.query(actionSql, [ids.couple, actionId, 'update', '{"status":"done"}'])).rows[0].result;
  assert.equal(completed.status, 'done'); assert.equal(completed.id, actionId);
  await actor(db, ids.outsider);
  const foreign = await rejected(db, '42501', actionSql, [ids.couple, actionId, 'update', '{"status":"open"}']);
  checks.push(record('actorBindingAndManualReceipt', { actionId, createdStatus: created.status, completedStatus: completed.status, foreign }));

  await actor(db, ids.owner);
  const snapshotSql = 'SELECT public.get_own_amora_chat_view_snapshot($1,$2) AS result';
  const prior = (await db.query(snapshotSql, [ids.couple, 'shared'])).rows[0].result;
  const reset = (await db.query('SELECT public.reset_own_amora_chat_view($1,$2) AS result', [ids.couple, 'shared'])).rows[0].result;
  assert.equal(reset.success, true); assert.equal(reset.scope, 'shared'); assert.ok(reset.privacyEpoch > prior.privacyEpoch);
  assert.ok(Number.isFinite(Date.parse(reset.clearedAt)));
  await actor(db, ids.outsider);
  const deniedReset = await rejected(db, '42501', 'SELECT public.reset_own_amora_chat_view($1,$2)', [ids.couple, 'shared']);
  checks.push(record('chatViewOwnerReset', { privacyEpochBefore: prior.privacyEpoch, privacyEpochAfter: reset.privacyEpoch, scope: reset.scope, deniedReset }));

  await actor(db, ids.owner);
  const noteSql = 'SELECT public.save_own_amora_note($1,$2,$3) AS result';
  const note = (await db.query(noteSql, [ids.couple, ids.sharedMessage, 'SYNTHETIC MEMO'])).rows[0].result;
  assert.equal(note.note.message_id, ids.sharedMessage); assert.equal(note.note.saved_by, ids.owner);
  assert.equal(note.note.content, 'SYNTHETIC SHARED CANONICAL TEXT');
  const privateDenied = await rejected(db, '42501', noteSql, [ids.couple, ids.privateMessage, 'SYNTHETIC MUST NOT SHARE']);
  await actor(db, ids.partner);
  const partnerDelete = (await db.query('DELETE FROM public.amora_saved_notes WHERE id=$1 RETURNING id', [note.note.id])).rows;
  assert.equal(partnerDelete.length, 0);
  await actor(db, ids.owner);
  assert.deepEqual((await db.query('DELETE FROM public.amora_saved_notes WHERE id=$1 RETURNING id', [note.note.id])).rows, [{ id: note.note.id }]);
  checks.push(record('savedNoteCanonicalSourceAndOwnerDelete', { sourceMessage: ids.sharedMessage, exactCanonicalContent: note.note.content, privateDenied, partnerDeleteCount: partnerDelete.length, ownerDeleteCount: 1 }));

  const personalSql = 'SELECT public.save_own_amora_personal_action($1,$2,$3,$4,$5,$6,$7::date) AS result';
  const personalArgs = [ids.owner, ids.couple, ids.privateMessage, ids.request, 'SYNTHETIC PRIVATE TASK', 'SYNTHETIC CONFIRMED DRAFT', null];
  const personal = (await db.query(personalSql, personalArgs)).rows[0].result;
  assert.equal(personal.owner_user_id, ids.owner); assert.equal(personal.source_message_id, ids.privateMessage);
  assert.equal(personal.title, personalArgs[4]); assert.equal(personal.description, personalArgs[5]);
  assert.equal((await db.query(personalSql, personalArgs)).rows[0].result.id, personal.id);
  await actor(db, ids.partner);
  const hidden = (await db.query('SELECT id FROM public.amora_personal_actions WHERE id=$1', [personal.id])).rows;
  const deniedWrite = (await db.query("UPDATE public.amora_personal_actions SET status='done' WHERE id=$1 RETURNING id", [personal.id])).rows;
  const deniedDelete = (await db.query('DELETE FROM public.amora_personal_actions WHERE id=$1 RETURNING id', [personal.id])).rows;
  assert.deepEqual([hidden.length, deniedWrite.length, deniedDelete.length], [0, 0, 0]);
  const impersonation = await rejected(db, '42501', personalSql, personalArgs);
  checks.push(record('personalOwnerPrivacyAndExactReceipt', { owner: personal.owner_user_id, source: personal.source_message_id, title: personal.title,
    replayId: personal.id, partnerReadCount: hidden.length, partnerUpdateCount: deniedWrite.length, partnerDeleteCount: deniedDelete.length, impersonation }));

  await actor(db, ids.owner);
  const binding = (await db.query(`SELECT metadata #>> '{mediation,proposalVersion}' AS version,
    metadata #>> '{mediation,rosterFingerprint}' AS roster FROM public.chat_messages WHERE id=$1`, [ids.mediationMessage])).rows[0];
  assert.match(binding.version, /^[0-9a-f-]{36}$/); assert.match(binding.roster, /^[0-9a-f]{32}$/);
  const respondSql = 'SELECT public.respond_own_amora_mediation($1,$2,$3,$4,$5,$6,$7) AS result';
  const respond = async (who, revision, choice, condition = null) => {
    await actor(db, who);
    return (await db.query(respondSql, [ids.mediationMessage, who, binding.version, binding.roster, revision, choice, condition])).rows[0].result;
  };
  const conditional = await respond(ids.owner, 0, 'conditional', 'SYNTHETIC CONDITION');
  assert.equal(conditional.acceptedCount, 0); assert.equal(conditional.completed, false);
  const difficult = await respond(ids.owner, 1, 'difficult', 'SYNTHETIC ALTERNATIVE');
  assert.equal(difficult.acceptedCount, 0); assert.equal(difficult.completed, false);
  const partnerOk = await respond(ids.partner, 0, 'ok');
  assert.equal(partnerOk.acceptedCount, 1); assert.equal(partnerOk.completed, false);
  await actor(db, ids.owner);
  const stale = await rejected(db, '40001', respondSql, [ids.mediationMessage, ids.owner, binding.version, binding.roster, 0, 'ok', null]);
  const both = await respond(ids.owner, 2, 'ok'); assert.equal(both.acceptedCount, 2); assert.equal(both.completed, true);
  checks.push(record('mediationChoicesAndStaleRevision', { conditionalAccepted: conditional.acceptedCount, difficultAccepted: difficult.acceptedCount,
    oneOkCompleted: partnerOk.completed, bothOkCompleted: both.completed, stale }));

  await actor(db, ids.owner, 'service_role');
  const progress = { venue: { category: 'venue', status: 'in_progress', budget: 10000000, spent: 5000 },
    ring: { category: 'ring', status: 'completed', budget: 5000000, spent: 4000000 },
    custom_ride: { category: 'custom_ride', label: 'SYNTHETIC RIDE', status: 'not_started', budget: 1000000 },
    reserve: { category: 'reserve', status: 'not_started', budget: 30000000 }, __hidden: ['custom_ride'], partner_note: { kept: true } };
  await db.query('UPDATE public.wedding_journeys SET total_budget=50000000,progress=$2::jsonb WHERE couple_id=$1', [ids.couple, JSON.stringify(progress)]);
  const budgets = (await db.query('SELECT public.amora_budget_plan_non_reserve_budgets($1::jsonb) AS result', [JSON.stringify(progress)])).rows[0].result;
  assert.deepEqual(budgets, { venue: 10000000, ring: 5000000, custom_ride: 1000000 });
  const requestKey = createHash('sha256').update(ids.request).digest('hex'); const op = createHash('sha256').update('synthetic-budget-op').digest('hex');
  const input = { total_budget: 50000000, allocations: [{ category: 'venue', budget: 20000000 }] };
  const inputDigest = digestJson(input);
  await db.query(`INSERT INTO public.amora_chat_request_claims(couple_id,request_key,user_id,visibility,status,attempt_count)
    VALUES($1,$2,$3,'shared','processing',1)`, [ids.couple, requestKey, ids.owner]);
  await db.query(`INSERT INTO public.amora_tool_executions(couple_id,request_key,operation_key,tool_name,input_digest,atomic_dispatch,request_attempt_count)
    VALUES($1,$2,$3,'apply_budget_plan',$4,true,1)`, [ids.couple, requestKey, op, inputDigest]);
  const entries = ['venue', 'reserve'].map(key => ({ key, expectedPresent: true, expected: progress[key],
    value: { ...progress[key], budget: key === 'venue' ? 20000000 : 24000000 } }));
  const mutation = { kind: 'journey_budget_plan_cas', expectedBudget: 50000000, valueBudget: 50000000, expectedNonReserveBudgets: budgets, entries };
  const receipt = { toolName: 'apply_budget_plan', success: true, displayMessage: 'SYNTHETIC BUDGET ENGINE RECEIPT',
    toolOutput: { total_budget: 50000000, previous_budget: 50000000, applied_count: 2, remainder_to_reserve: 24000000,
      allocations: [{ category: 'venue', budget: 20000000 }, { category: 'reserve', budget: 24000000 }] } };
  // 이 호출은 새 DB 계산 엔진만 검증한다. 앱의 사용자 승인/HTTP 경로를 우회해 성공했다고 주장하지 않는다.
  const engineSql = 'SELECT public.apply_amora_atomic_tool_execution_pre_shared_revision($1,$2,$3,1,$4,$5::jsonb,$6::jsonb,$7::jsonb) AS result';
  const args = [ids.couple, requestKey, op, inputDigest, JSON.stringify(input), JSON.stringify(mutation), JSON.stringify(receipt)];
  const result = (await db.query(engineSql, args)).rows[0].result; assert.equal(result.success, true);
  const stored = (await db.query('SELECT total_budget,progress FROM public.wedding_journeys WHERE couple_id=$1', [ids.couple])).rows[0];
  assert.equal(Number(stored.total_budget), 50000000); assert.deepEqual(stored.progress.ring, progress.ring); assert.deepEqual(stored.progress.custom_ride, progress.custom_ride);
  assert.deepEqual(stored.progress.partner_note, progress.partner_note); assert.equal(stored.progress.venue.spent, 5000); assert.equal(stored.progress.reserve.budget, 24000000);
  const sum = ['venue', 'ring', 'custom_ride', 'reserve'].reduce((total, key) => total + stored.progress[key].budget, 0); assert.equal(sum, 50000000);
  assert.deepEqual((await db.query(engineSql, args)).rows[0].result, result);
  checks.push(record('budgetEnginePreservesOmittedAllocations', { entrypoint: 'private database engine; approval workflow not covered',
    budgetsBefore: budgets, allocatedTotal: sum, reserve: stored.progress.reserve.budget, venueSpent: stored.progress.venue.spent,
    ring: stored.progress.ring, custom: stored.progress.custom_ride, replayMatches: true }));

  await db.query(`INSERT INTO public.community_posts(id,author_id,category,title,content,ad_disclosure,upvote_count,comment_count,created_at)
    VALUES($1,$3,'free_board','SYNTHETIC HOT','SYNTHETIC', 'general',100,0,'2026-01-01Z'),
      ($2,$3,'free_board','SYNTHETIC NEW','SYNTHETIC','general',0,0,'2026-01-02Z')`, [ids.postHot, ids.postNew, ids.owner]);
  const sorted = (await db.query('SELECT id,hot_rank::text FROM public.community_posts WHERE id=ANY($1::uuid[]) ORDER BY hot_rank DESC,created_at DESC,id DESC LIMIT 1', [[ids.postHot, ids.postNew]])).rows;
  assert.equal(sorted[0]?.id, ids.postHot);
  checks.push(record('communityRankBeforePageLimit', { firstId: sorted[0].id, score: sorted[0].hot_rank }));
  await db.query('RESET ROLE');
  return checks;
}
