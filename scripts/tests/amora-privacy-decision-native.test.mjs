import test from 'node:test';
import assert from 'node:assert/strict';
import { createAmoraPrivacyDecisionDatabase, nativeAmoraAvailable, COUPLE_ID, USER_ID,
  PARTNER_ID, OUTSIDER_ID, asRole, epoch, memoryMutation, prepareDecision, claimDecision, applyDecision,
  waitForBlocked, candidateScope, publicCatalog } from './fixtures/amora-privacy-decision-native.mjs';

const native = { skip: !nativeAmoraAvailable, timeout: 60000 };
const reset = (client, expectedEpoch, user = USER_ID) => client.query(
  'SELECT reset_current_couple_membership($1,$2,$3) AS value', [user, COUPLE_ID, expectedEpoch]);
const outcome = promise => promise.then(value => ({ ok: true, value }), error => ({ ok: false, error }));

test('native PG17: the baseline privacy epoch is sealed and clients cannot call internal membership or epoch primitives', native, async () => {
  const db = await createAmoraPrivacyDecisionDatabase();
  try {
    const shape = (await db.client.query("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='public.amora_privacy_context_epochs'::regclass")).rows[0];
    assert.deepEqual(shape, { relrowsecurity: true, relforcerowsecurity: true });
    for (const role of ['anon', 'authenticated', 'service_role']) {
      await asRole(db.client, role);
      await assert.rejects(db.client.query('SELECT epoch FROM amora_privacy_context_epochs'), /permission denied/);
      await assert.rejects(db.client.query('SELECT advance_amora_privacy_context_epoch($1)', [COUPLE_ID]), /permission denied/);
      await assert.rejects(db.client.query('SELECT is_amora_profile_roster_binding($1,$2,$3)', [USER_ID, COUPLE_ID, 'bride']), /permission denied/);
      if (role !== 'service_role') await assert.rejects(db.client.query('SELECT is_current_couple_member($1,$2)', [USER_ID, COUPLE_ID]), /permission denied/);
      if (role !== 'authenticated') await assert.rejects(db.client.query('SELECT get_own_amora_privacy_epoch($1,$2)', [COUPLE_ID, 'shared']), /permission denied/);
    }
    await asRole(db.client, 'authenticated');
    assert.equal(Number((await db.client.query('SELECT get_own_amora_privacy_epoch($1,$2) AS value', [COUPLE_ID, 'shared'])).rows[0].value), 7);
  } finally { await db.close(); }
});

test('native PG17: observed function signatures and preserved relation catalog exactly match the candidate scope', native, async () => {
  const db = await createAmoraPrivacyDecisionDatabase({ applyDecision: false, applyPrivacy: false });
  try {
    const before = await publicCatalog(db.client);
    await db.applySuccessors();
    const after = await publicCatalog(db.client), scope = candidateScope();
    const prior = new Map(before.functions.map(row => [row.signature, row]));
    const current = new Map(after.functions.map(row => [row.signature, row]));
    const added = [...current.keys()].filter(key => !prior.has(key)).sort();
    const removed = [...prior.keys()].filter(key => !current.has(key)).sort();
    const changed = [...prior.keys()].filter(key => current.has(key)
      && JSON.stringify(prior.get(key)) !== JSON.stringify(current.get(key))).sort();
    assert.deepEqual(added, [...scope.addedFunctions].sort());
    assert.deepEqual(changed, [...scope.changedFunctions].sort());
    assert.deepEqual(removed, []);
    assert.deepEqual(after.relations, before.relations);
  } finally { await db.close(); }
});

test('native PG17: explicit memory consent invalidates the old confirmation and preserves preparation answers',
  { skip: !nativeAmoraAvailable, timeout: 60000 }, async () => {
    const db = await createAmoraPrivacyDecisionDatabase();
    try {
      const before = await epoch(db.client);
      await asRole(db.client, 'service_role', USER_ID);
      assert.equal((await memoryMutation(db.client, before, 'toggle', true)).enabled, true);
      await assert.rejects(memoryMutation(db.client, before, 'clear_scope', null), /PRIVACY_CONFIRMATION_CHANGED/);
      await asRole(db.client, 'authenticated', USER_ID);
      const own = (await db.client.query('SELECT get_own_wedding_preparation_style() AS value')).rows[0].value;
      assert.equal(own.ownerUserId, USER_ID);
      assert.equal(own.partnerUserId, PARTNER_ID);
      assert.equal(own.own.answerCode, 'AAAAAAAAAAAAAAAAAAAA');
      assert.equal(own.coupleId, COUPLE_ID);
    } finally { await db.close(); }
  });

test('native PG17: a concurrent memory change invalidates reset approval; a fresh reset revokes preparation sharing but preserves partner records',
  native, async () => {
    const db = await createAmoraPrivacyDecisionDatabase();
    try {
      const before = await epoch(db.client), writer = await db.connect('service_role'), resetter = await db.connect('authenticated');
      const pid = (await resetter.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      await writer.query('BEGIN');
      assert.equal((await memoryMutation(writer, before, 'toggle', true)).enabled, true);
      const pending = outcome(reset(resetter, before));
      await waitForBlocked(db.client, pid);
      await writer.query('COMMIT');
      const rejected = await pending;
      assert.equal(rejected.ok, false);
      assert.match(rejected.error.message, /PRIVACY_CONFIRMATION_CHANGED/);
      assert.equal(rejected.error.code, '40001');
      assert.equal((await db.client.query('SELECT couple_id FROM profiles WHERE id=$1', [USER_ID])).rows[0].couple_id, COUPLE_ID);
      await db.client.query(`INSERT INTO chat_summaries(couple_id,visibility,content) VALUES
        ($1,'shared','남은 파트너가 유지할 합성 기억'),($1,'bride_private','떠나는 회원의 합성 비공개 기억')`, [COUPLE_ID]);
      const fresh = await epoch(db.client);
      assert.deepEqual((await reset(resetter, fresh)).rows[0].value, { success: true, previous_couple_id: COUPLE_ID });
      assert.deepEqual((await db.client.query('SELECT visibility FROM chat_summaries ORDER BY visibility')).rows, [{ visibility: 'shared' }]);
      assert.deepEqual((await db.client.query('SELECT owner_user_id FROM wedding_preparation_style_shares')).rows, []);
      await asRole(resetter, 'authenticated', PARTNER_ID);
      const partner = (await resetter.query('SELECT get_own_wedding_preparation_style() AS value')).rows[0].value;
      assert.equal(partner.own.answerCode, 'AAAAAAAAAAAAAAAAAAAA');
      assert.equal(partner.partner, null);
      assert.equal(partner.sharing, null);
    } finally { await db.close(); }
  });

test('native PG17: memory cannot be re-enabled by an in-flight old owner after the concurrent reset commits', native, async () => {
  const db = await createAmoraPrivacyDecisionDatabase();
  try {
    const before = await epoch(db.client), resetter = await db.connect('authenticated'), writer = await db.connect('service_role');
    const pid = (await writer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    await resetter.query('BEGIN');
    assert.equal((await reset(resetter, before)).rows[0].value.success, true);
    const pending = outcome(memoryMutation(writer, before, 'toggle', true));
    await waitForBlocked(db.client, pid);
    await resetter.query('COMMIT');
    const rejected = await pending;
    assert.equal(rejected.ok, false);
    assert.match(rejected.error.message, /PRIVACY_CONFIRMATION_CHANGED/);
    assert.deepEqual((await db.client.query('SELECT enabled FROM amora_memory_settings WHERE couple_id=$1 AND visibility=$2',
      [COUPLE_ID, 'bride_private'])).rows, [{ enabled: false }]);
    assert.deepEqual((await db.client.query('SELECT user_id FROM amora_memory_consents WHERE couple_id=$1 AND visibility=$2',
      [COUPLE_ID, 'bride_private'])).rows, []);
  } finally { await db.close(); }
});

test('native PG17: a failed completion rolls the decision and receipt back together and retry saves exactly once', native, async () => {
  const db = await createAmoraPrivacyDecisionDatabase();
  try {
    const action = await prepareDecision(db.client);
    assert.deepEqual(await claimDecision(db.client, action), { action: 'acquired' });
    await asRole(db.client, 'postgres');
    await db.client.query(`CREATE FUNCTION test_fail_decision_completion() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.status='completed' THEN RAISE EXCEPTION 'TEST_LEDGER_FAILURE'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER z_test_fail_decision_completion BEFORE UPDATE ON amora_tool_executions
      FOR EACH ROW EXECUTE FUNCTION test_fail_decision_completion();`);
    await asRole(db.client, 'service_role');
    await assert.rejects(applyDecision(db.client, action), /TEST_LEDGER_FAILURE/);
    assert.deepEqual((await db.client.query('SELECT id FROM decision_nodes')).rows, []);
    assert.deepEqual((await db.client.query('SELECT status,result FROM amora_tool_executions')).rows, [{ status: 'processing', result: null }]);
    await asRole(db.client, 'postgres');
    await db.client.query('DROP TRIGGER z_test_fail_decision_completion ON amora_tool_executions');
    await asRole(db.client, 'service_role');
    const saved = await applyDecision(db.client, action);
    assert.equal(saved.success, true);
    assert.deepEqual(await applyDecision(db.client, action), saved);
    assert.deepEqual((await db.client.query('SELECT id FROM decision_nodes')).rows, [{ id: action.actionId }]);
  } finally { await db.close(); }
});

test('native PG17: a claimed decision waiting behind reset rejects the changed owner without persisting a success receipt', native, async () => {
  const db = await createAmoraPrivacyDecisionDatabase();
  try {
    const action = await prepareDecision(db.client);
    assert.deepEqual(await claimDecision(db.client, action), { action: 'acquired' });
    const before = await epoch(db.client), resetter = await db.connect('authenticated'), writer = await db.connect('service_role');
    const pid = (await writer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    await resetter.query('BEGIN');
    assert.equal((await reset(resetter, before)).rows[0].value.success, true);
    const pending = outcome(applyDecision(writer, action));
    await waitForBlocked(db.client, pid);
    await resetter.query('COMMIT');
    const rejected = await pending;
    assert.equal(rejected.ok, false);
    assert.match(rejected.error.message, /AMORA_SHARED_ACTION_/);
    assert.notEqual(rejected.error.code, '40P01');
    assert.deepEqual((await db.client.query('SELECT id FROM decision_nodes')).rows, []);
    assert.deepEqual((await db.client.query('SELECT status,result FROM amora_tool_executions')).rows, [{ status: 'processing', result: null }]);
  } finally { await db.close(); }
});

test('native PG17: an approved decision completes while reset owns the actor profile, then reset proceeds without a reverse-lock deadlock', native, async () => {
  const db = await createAmoraPrivacyDecisionDatabase();
  try {
    const action = await prepareDecision(db.client);
    assert.deepEqual(await claimDecision(db.client, action), { action: 'acquired' });
    const before = await epoch(db.client), resetter = await db.connect(), writer = await db.connect('service_role');
    const pid = (await resetter.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    // reset의 실제 선행 잠금을 재현한다. 이후 권한 변경도 같은 연결/transaction을 유지한다.
    await resetter.query('BEGIN');
    await resetter.query('SELECT id FROM profiles WHERE id=$1 FOR UPDATE', [USER_ID]);
    await asRole(resetter, 'authenticated');
    await writer.query('BEGIN');
    const saved = await applyDecision(writer, action);
    assert.equal(saved.toolOutput.decision.id, action.actionId);
    // apply가 늦게 profile FOR UPDATE를 잡으면 위 RPC부터 timeout 난다.
    // 정상 apply는 couple을 가진 채 끝나고 reset만 기다리므로 commit으로 풀린다.
    const pending = outcome(reset(resetter, before));
    await waitForBlocked(db.client, pid);
    await writer.query('COMMIT');
    const completed = await pending;
    assert.equal(completed.ok, true, completed.error?.message);
    assert.equal(completed.value.rows[0].value.success, true);
    await resetter.query('COMMIT');
    await asRole(db.client, 'authenticated', PARTNER_ID);
    assert.deepEqual((await db.client.query('SELECT id FROM decision_nodes')).rows, [{ id: action.actionId }]);
    const style = (await db.client.query('SELECT get_own_wedding_preparation_style() AS value')).rows[0].value;
    assert.equal(style.own.answerCode, 'AAAAAAAAAAAAAAAAAAAA');
    assert.equal(style.sharing, null);
  } finally { await db.close(); }
});

test('native PG17: direct legacy primitives and wrong actors cannot bypass explicit privacy or decision approval', native, async () => {
  const db = await createAmoraPrivacyDecisionDatabase();
  try {
    const before = await epoch(db.client);
    for (const role of ['anon', 'authenticated', 'service_role']) {
      await asRole(db.client, role);
      for (const sql of [
        'SELECT reset_current_couple_membership_pre_confirmation()',
        `SELECT lock_privacy_confirmation_target('${USER_ID}','${COUPLE_ID}',${before},'shared')`,
        `SELECT set_amora_memory_consent('${COUPLE_ID}','shared','${USER_ID}',true)`,
        `SELECT clear_amora_memory_scope('${COUPLE_ID}','shared','${USER_ID}')`,
        'SELECT apply_amora_atomic_tool_execution_pre_decision_record(NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL)',
        'SELECT claim_amora_tool_execution_pre_decision_record(NULL,NULL,NULL,NULL,NULL,NULL,NULL)',
      ]) await assert.rejects(db.client.query(sql), /permission denied/);
      if (role !== 'authenticated') await assert.rejects(reset(db.client, before), /permission denied/);
      if (role !== 'service_role') await assert.rejects(memoryMutation(db.client, before, 'toggle', true), /permission denied/);
    }
    await asRole(db.client, 'authenticated');
    await assert.rejects(db.client.query('SELECT reset_current_couple_membership()'), /PRIVACY_CONFIRMATION_REQUIRED/);
    await assert.rejects(reset(db.client, before, OUTSIDER_ID), /PRIVACY_CONFIRMATION_CHANGED/);
    await asRole(db.client, 'service_role');
    await assert.rejects(memoryMutation(db.client, before, 'clear_scope', null, 'groom_private'), /PRIVACY_CONFIRMATION_CHANGED/);
    const action = await prepareDecision(db.client);
    await assert.rejects(db.client.query('SELECT claim_amora_tool_execution($1,$2,$3,$4,$5,1,NULL::uuid,1)',
      [COUPLE_ID, action.requestKey, action.operationKey, 'add_decision_record', action.inputDigest]), /AMORA_DECISION_APPROVAL_REQUIRED/);
    assert.deepEqual((await db.client.query('SELECT id FROM decision_nodes')).rows, []);
  } finally { await db.close(); }
});

test('native PG17: approved decision returns its canonical receipt once and is readable by the actual partner',
  { skip: !nativeAmoraAvailable, timeout: 60000 }, async () => {
    const db = await createAmoraPrivacyDecisionDatabase();
    try {
      const action = await prepareDecision(db.client);
      assert.deepEqual(await claimDecision(db.client, action), { action: 'acquired' });
      const saved = await applyDecision(db.client, action);
      assert.equal(saved.success, true);
      assert.equal(saved.toolOutput.verified, true);
      assert.equal(saved.toolOutput.decision.id, action.actionId);
      assert.equal(saved.toolOutput.decision.title, action.input.title);
      assert.equal(saved.displayMessage.includes('FORGED'), false);
      assert.deepEqual(await applyDecision(db.client, action), saved);
      assert.deepEqual(await claimDecision(db.client, action), { action: 'completed', result: saved });
      await asRole(db.client, 'authenticated', PARTNER_ID);
      assert.deepEqual((await db.client.query('SELECT id FROM decision_nodes WHERE couple_id=$1', [COUPLE_ID])).rows,
        [{ id: action.actionId }]);
      await asRole(db.client, 'authenticated', OUTSIDER_ID);
      assert.deepEqual((await db.client.query('SELECT id FROM decision_nodes')).rows, []);
    } finally { await db.close(); }
  });
