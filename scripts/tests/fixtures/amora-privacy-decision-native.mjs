import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createProfileRoleNativeDatabase, nativeProfileRoleAvailable } from './profile-role-native-database.mjs';

const require = createRequire(import.meta.url), { Client } = require('pg');
const root = resolve(import.meta.dirname, '../../..');
export { nativeProfileRoleAvailable as nativeAmoraAvailable };
export const COUPLE_ID = '10000000-0000-4000-8000-000000000001';
export const OTHER_COUPLE_ID = '10000000-0000-4000-8000-000000000002';
export const USER_ID = '20000000-0000-4000-8000-000000000001';
export const PARTNER_ID = '20000000-0000-4000-8000-000000000002';
export const OUTSIDER_ID = '20000000-0000-4000-8000-000000000003';
export const DECISION_MIGRATION = '20260921100000_amora_approved_decision_records.sql';
export const PRIVACY_MIGRATION = '20260921101000_privacy_confirmation_targets.sql';
const read = file => readFileSync(join(root, file), 'utf8');
const migration = file => read('supabase/migrations/' + file);

function definitions(sql, name) {
  const all = [...sql.matchAll(/CREATE (?:OR REPLACE )?FUNCTION public\.\w+\([\s\S]*?\$function\$;/gu)]
    .map(([value]) => value).filter(value => new RegExp(`^CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\(`).test(value));
  assert.ok(all.length, 'Missing real migration function: ' + name);
  return all;
}

// 함수 본문만 복사하면 PostgreSQL 기본 PUBLIC EXECUTE가 남는다. 실제 원문의 ACL도 함께 적용한다.
async function applyFunctionAcls(client, sql, names) {
  const statements = [...sql.matchAll(/^(?:ALTER FUNCTION|REVOKE ALL ON FUNCTION|GRANT EXECUTE ON FUNCTION)\s+public\.(\w+)\([\s\S]*?;/gm)]
    .filter(([, name]) => names.includes(name));
  for (const name of names) assert.ok(statements.filter(([, candidate]) => candidate === name).length >= 2,
    'Expected actual owner and revoke statements: ' + name);
  for (const [statement] of statements) await client.query(statement);
}

// 기존 PGlite 테스트의 합성 스키마/행만 재사용한다. TypeScript 실행이나 보안 함수 성공 mock은 없다.
function syntheticBase() {
  const source = read('apps/web/src/lib/ai/__tests__/fixtures/amoraBudgetDecisionDatabase.ts');
  const start = source.indexOf('await db.exec(`') + 'await db.exec(`'.length;
  const end = source.indexOf('`);', start);
  assert.ok(start > 20 && end > start);
  const values = { COUPLE_ID, OTHER_COUPLE_ID, USER_ID, PARTNER_ID, OUTSIDER_ID };
  const sql = source.slice(start, end).replace(/\$\{([A-Z_]+)\}/g, (_, name) => {
    assert.ok(Object.hasOwn(values, name)); return values[name];
  });
  assert.equal(sql.includes('${'), false);
  return sql;
}

export async function asRole(client, role, user = USER_ID) {
  assert.ok(['postgres', 'anon', 'authenticated', 'service_role'].includes(role));
  await client.query('RESET ROLE');
  if (role !== 'postgres') await client.query('SET ROLE ' + role);
  await client.query("SELECT set_config('request.jwt.claim.role',$1,false),set_config('request.jwt.claim.sub',$2,false)", [role, user]);
}
export async function epoch(client) {
  await asRole(client, 'postgres');
  return Number((await client.query('SELECT epoch FROM amora_privacy_context_epochs WHERE couple_id=$1', [COUPLE_ID])).rows[0].epoch);
}
export async function memoryMutation(client, expectedEpoch, action, consent, visibility = 'bride_private', user = USER_ID) {
  return (await client.query('SELECT mutate_amora_memory_with_confirmation($1,$2,$3,$4,$5,$6) AS value',
    [user, COUPLE_ID, expectedEpoch, visibility, action, consent])).rows[0].value;
}

export function candidateScope() {
  return JSON.parse(read('supabase/release-contracts/amora-decision-privacy-candidate-v1.json')).scope;
}
export async function publicCatalog(client) {
  const functions = (await client.query(`SELECT n.nspname||'.'||p.proname||'('||replace(oidvectortypes(p.proargtypes),' ','')||')' AS signature,
    pg_get_functiondef(p.oid) AS definition,pg_get_userbyid(p.proowner) AS owner,p.prosecdef AS definer,
    p.proconfig AS config,p.proacl::text AS acl,obj_description(p.oid,'pg_proc') AS comment
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prokind='f' ORDER BY 1`)).rows;
  const relations = (await client.query(`SELECT n.nspname||'.'||c.relname AS name,c.relkind,c.relrowsecurity,c.relforcerowsecurity,
    pg_get_userbyid(c.relowner) AS owner,c.relacl::text AS acl,
    (SELECT jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,a.attgenerated,
      pg_get_expr(d.adbin,d.adrelid),a.attacl::text) ORDER BY a.attnum)
      FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) AS columns,
    (SELECT jsonb_agg(jsonb_build_array(conname,contype,convalidated,pg_get_constraintdef(oid,true)) ORDER BY conname)
      FROM pg_constraint WHERE conrelid=c.oid) AS constraints,
    (SELECT jsonb_agg(jsonb_build_array(pg_get_indexdef(indexrelid),indisvalid,indisready) ORDER BY pg_get_indexdef(indexrelid))
      FROM pg_index WHERE indrelid=c.oid) AS indexes,
    (SELECT jsonb_agg(jsonb_build_array(tgname,tgenabled,pg_get_triggerdef(oid,true)) ORDER BY tgname)
      FROM pg_trigger WHERE tgrelid=c.oid AND NOT tgisinternal) AS triggers,
    (SELECT jsonb_agg(jsonb_build_array(polname,polcmd,polpermissive,polroles::text,pg_get_expr(polqual,polrelid),pg_get_expr(polwithcheck,polrelid)) ORDER BY polname)
      FROM pg_policy WHERE polrelid=c.oid) AS policies
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('public','auth') AND c.relkind IN ('r','p','v','m','S') ORDER BY 1`)).rows;
  return { functions, relations };
}

export async function createAmoraPrivacyDecisionDatabase({ applyPrivacy = true, applyDecision = true } = {}) {
  const owned = await createProfileRoleNativeDatabase(), peers = [];
  const db = owned.client;
  try {
    await db.query(syntheticBase());
    await db.query(`ALTER TABLE profiles ADD COLUMN onboarding_completed boolean DEFAULT true,
      ADD COLUMN onboarding_step integer DEFAULT 9, ADD COLUMN shared_chat_cleared_at timestamptz,
      ADD COLUMN private_chat_cleared_at timestamptz, ADD COLUMN updated_at timestamptz DEFAULT now();
      ALTER TABLE couples ADD COLUMN updated_at timestamptz DEFAULT now();
      CREATE TABLE account_deletion_jobs(user_id uuid,status text NOT NULL);
      CREATE TABLE chat_summaries(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),couple_id uuid REFERENCES couples(id),
        user_id uuid,summary_type text DEFAULT 'info',title text DEFAULT '',content text DEFAULT '',summary text,
        message_count integer DEFAULT 0,from_message_id text,to_message_id text,visibility text NOT NULL,
        importance integer DEFAULT 1,created_at timestamptz DEFAULT now());
      CREATE TABLE amora_couple_profiles(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),couple_id uuid REFERENCES couples(id),visibility text);
      CREATE FUNCTION update_updated_at_column() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at=now(); RETURN NEW; END $$;`);
    for (const file of [
      '20260704120000_create_amora_turn_reserve_rpc.sql', '20260716097000_amora_atomic_cost_budget.sql',
      '20260716110000_amora_crash_recovery_atomicity.sql', '20260716112000_amora_atomic_mutation_coverage.sql',
      '20260730102000_amora_shared_action_approval_and_notifications.sql',
      '20260802100000_amora_shared_schedule_decision_receipts.sql', '20260802170000_amora_shared_action_roster_binding.sql',
    ]) await db.query(migration(file));
    const notification = migration('20260823120000_couple_approval_becomes_notification.sql');
    for (const name of ['amora_shared_action_policy', 'amora_shared_action_context_pre_roster_binding'])
      for (const sql of definitions(notification, name)) await db.query(sql);
    for (const file of [
      '20260824150000_amora_custom_category_label_match.sql', '20260827090000_move_card_can_name_what_it_moves.sql',
      '20260906130734_amora_budget_plan_preserves_existing_allocations.sql', '20260907085111_amora_budget_plan_named_allocations.sql',
      '20260910160514_amora_shared_budget_decision_receipts.sql', '20260915101500_amora_atomic_not_applicable_status.sql',
    ]) await db.query(migration(file));
    for (const sql of definitions(notification, 'claim_amora_tool_execution')) await db.query(sql);
    for (const sql of definitions(migration('20260802140000_amora_manual_schedule_fairness.sql'), 'enforce_amora_shared_action_execution')) await db.query(sql);
    await db.query(migration('20260716090000_amora_memory_engine_v2.sql'));
    for (const sql of definitions(migration('20260902120000_leaving_does_not_erase_the_partner_memory.sql'), 'reset_amora_memory_after_membership_change'))
      await db.query(sql);
    await db.query(migration('20260714164500_expand_atomic_couple_reset.sql'));
    const membership = migration('20260716114000_current_couple_membership_privacy_fence.sql');
    for (const name of ['is_current_couple_member', 'is_couple_member', 'can_access_couple_visibility', 'enforce_current_couple_membership_integrity'])
      for (const sql of definitions(membership, name)) await db.query(sql);
    await applyFunctionAcls(db, membership, ['is_current_couple_member', 'is_couple_member',
      'can_access_couple_visibility', 'enforce_current_couple_membership_integrity']);
    await db.query(`CREATE CONSTRAINT TRIGGER trg_current_couple_profile_integrity
      AFTER INSERT OR UPDATE OR DELETE ON profiles DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION enforce_current_couple_membership_integrity();
      CREATE CONSTRAINT TRIGGER trg_current_couple_row_integrity
      AFTER INSERT OR UPDATE OR DELETE ON couples DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION enforce_current_couple_membership_integrity();`);
    await db.query(`CREATE TABLE amora_privacy_context_epochs(couple_id uuid PRIMARY KEY REFERENCES couples(id) ON DELETE CASCADE,
      epoch bigint NOT NULL CHECK(epoch>=1),updated_at timestamptz DEFAULT now());
      INSERT INTO amora_privacy_context_epochs(couple_id,epoch) SELECT id,7 FROM couples;`);
    const privacyEpoch = migration('20260802230000_amora_atomic_privacy_epoch.sql');
    const epochFunctions = ['advance_amora_privacy_context_epoch','is_amora_profile_roster_binding',
      'capture_amora_couple_privacy_epoch','capture_amora_profile_privacy_epoch','capture_amora_couple_scoped_privacy_epoch',
      'get_own_amora_privacy_epoch'];
    for (const name of epochFunctions)
      for (const sql of definitions(privacyEpoch, name)) await db.query(sql);
    await applyFunctionAcls(db, privacyEpoch, epochFunctions);
    const epochAccessStart = privacyEpoch.indexOf('ALTER TABLE public.amora_privacy_context_epochs OWNER TO postgres;');
    const epochAccessEnd = privacyEpoch.indexOf('INSERT INTO public.amora_privacy_context_epochs(couple_id, epoch)', epochAccessStart);
    assert.ok(epochAccessStart >= 0 && epochAccessEnd > epochAccessStart);
    await db.query(privacyEpoch.slice(epochAccessStart, epochAccessEnd));
    await db.query(`CREATE TRIGGER trg_amora_privacy_epoch_couples AFTER INSERT OR UPDATE OR DELETE ON couples FOR EACH ROW EXECUTE FUNCTION capture_amora_couple_privacy_epoch();
      CREATE TRIGGER trg_amora_privacy_epoch_profiles AFTER INSERT OR UPDATE OR DELETE ON profiles FOR EACH ROW EXECUTE FUNCTION capture_amora_profile_privacy_epoch();
      CREATE TRIGGER trg_amora_privacy_epoch_memory_settings AFTER INSERT OR UPDATE OR DELETE ON amora_memory_settings FOR EACH ROW EXECUTE FUNCTION capture_amora_couple_scoped_privacy_epoch();
      CREATE TRIGGER trg_amora_privacy_epoch_memory_consents AFTER INSERT OR UPDATE OR DELETE ON amora_memory_consents FOR EACH ROW EXECUTE FUNCTION capture_amora_couple_scoped_privacy_epoch();`);
    await db.query(migration('20260905223222_amora_atomic_chat_view_reset.sql'));
    await db.query(migration('20260920120000_wedding_preparation_style.sql'));
    if (applyDecision) await db.query(migration(DECISION_MIGRATION));
    if (applyPrivacy) await db.query(migration(PRIVACY_MIGRATION));
    // 실제 인증 RPC로 저장·상호 공유한다. 후속 reset에서 최신 main의 철회 trigger를 검증한다.
    for (const user of [USER_ID, PARTNER_ID]) {
      await asRole(db, 'authenticated', user);
      const saved = (await db.query("SELECT set_own_wedding_preparation_style(NULL,'v1.2-code','AAAAAAAAAAAAAAAAAAAA','2026-09-20') AS value")).rows[0].value;
      await db.query("SELECT share_own_wedding_preparation_style($1,$2,$3,'2026-09-20')",
        [saved.stateRevision, COUPLE_ID, user === USER_ID ? PARTNER_ID : USER_ID]);
    }
    await asRole(db, 'postgres');
    return { client: db,
      async applySuccessors() {
        await asRole(db, 'postgres');
        await db.query(migration(DECISION_MIGRATION));
        await db.query(migration(PRIVACY_MIGRATION));
      },
      async connect(role = 'postgres', user = USER_ID) {
        const peer = new Client({ ...owned.connection, connectionTimeoutMillis: 1000, query_timeout: 20000 });
        await peer.connect(); peers.push(peer); await asRole(peer, role, user); return peer;
      },
      async close() {
        for (const peer of peers) { await peer.query('ROLLBACK').catch(() => {}); await peer.end(); }
        await db.query('ROLLBACK').catch(() => {}); await owned.close();
      },
    };
  } catch (error) { await owned.close(); throw error; }
}

// 고정 대기만 믿지 않고 실제 다른 backend의 잠금 대기를 관측한다.
export async function waitForBlocked(observer, pid) {
  const end = Date.now() + 3000;
  while (Date.now() < end) {
    const row = (await observer.query('SELECT wait_event_type,pg_blocking_pids(pid) AS blockers FROM pg_stat_activity WHERE pid=$1', [pid])).rows[0];
    if (row?.wait_event_type === 'Lock' && row.blockers.length) return row;
    await delay(10);
  }
  assert.fail('Expected a witnessed PostgreSQL lock wait');
}

export async function prepareDecision(client) {
  await asRole(client, 'service_role');
  const input = { category_key: 'meeting', memo: '승인된 메모', status: 'considering', title: '승인한 결정 기록' };
  const canonical = JSON.stringify(input), digest = value => createHash('sha256').update(value).digest('hex');
  const action = { actionId: randomUUID(), proposalId: randomUUID(), confirmationId: randomUUID(),
    requestKey: `chat:${USER_ID}:${randomUUID()}`, input, inputDigest: digest(canonical), operationKey: digest('add_decision_record\n' + canonical) };
  const revision = Number((await client.query('SELECT state_revision FROM wedding_journeys WHERE couple_id=$1', [COUPLE_ID])).rows[0].state_revision);
  const now = Date.now();
  await client.query(`INSERT INTO chat_messages(id,couple_id,sender_type,role,content,visibility,metadata,created_at)
    VALUES($1,$2,'ai','assistant','공유 승인 요청','shared',$3::jsonb,clock_timestamp())`,
    [action.proposalId, COUPLE_ID, JSON.stringify({ pending_amora_action: { version: 2, actionId: action.actionId,
      tool: 'add_decision_record', input, inputDigest: action.inputDigest, operationKey: action.operationKey,
      confirmation: '결정 기록에 저장할까요?', issuedAt: now, expiresAt: now + 600000 }, pending_amora_action_journey_revision: revision })]);
  assert.equal((await client.query('SELECT claim_amora_shared_action_application($1,$2,$3,$4) AS value',
    [action.actionId, COUPLE_ID, action.proposalId, USER_ID])).rows[0].value.applicationGranted, true);
  await client.query(`INSERT INTO chat_messages(id,couple_id,sender_id,sender_type,role,content,visibility,metadata,created_at)
    VALUES($1,$2,$3,'bride','user','확인','shared',$4::jsonb,clock_timestamp())`,
    [action.confirmationId, COUPLE_ID, USER_ID, JSON.stringify({ confirmed_amora_action_id: action.actionId })]);
  await client.query(`INSERT INTO amora_chat_request_claims(couple_id,request_key,user_id,visibility,status,user_message_id)
    VALUES($1,$2,$3,'shared','processing',$4)`, [COUPLE_ID, action.requestKey, USER_ID, action.confirmationId]);
  return action;
}
export async function claimDecision(client, action) {
  return (await client.query('SELECT claim_amora_tool_execution($1,$2,$3,$4,$5,1,$6,NULL::integer) AS value',
    [COUPLE_ID, action.requestKey, action.operationKey, 'add_decision_record', action.inputDigest, action.actionId])).rows[0].value;
}
export async function applyDecision(client, action) {
  return (await client.query('SELECT apply_amora_atomic_tool_execution($1,$2,$3,1,$4,$5::jsonb,$6::jsonb,$7::jsonb) AS value',
    [COUPLE_ID, action.requestKey, action.operationKey, action.inputDigest, JSON.stringify(action.input), JSON.stringify({ kind: 'decision_record_insert',
      record: { title: action.input.title, decision_type: action.input.status, reasoning: action.input.memo, category: action.input.category_key } }),
    JSON.stringify({ toolName: 'add_decision_record', success: true, toolOutput: { verified: true, decision: { id: OUTSIDER_ID } }, displayMessage: 'FORGED' })])).rows[0].value;
}
