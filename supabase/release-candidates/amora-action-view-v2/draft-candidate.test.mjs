import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDraftDatabase,TOKEN,legacy,COUPLE,BRIDE,GROOM,OUTSIDER,OTHER_COUPLE,JOURNEY,candidatePath } from './draft-fixture.mjs';

test('v2 rejects backslash and ASCII-control href input before either storage can change', async () => {
  const f = await createDraftDatabase();
  try {
    await f.seedCanonical();
    await f.seedLegacy([legacy()]);
    const canonical = await f.read('draft_canonical');
    const journey = await f.journey();
    const escaped = '/' + String.fromCharCode(92) + 'evil.invalid';
    assert.equal(new URL(escaped,'https://hanbang.ai').origin,'https://evil.invalid');
    const unsafe = [escaped,'/wedding/' + String.fromCharCode(92) + 'chat',
      ...Array.from({length:31},(_,i) => '/wedding/' + String.fromCharCode(i+1) + 'chat'),
      '/wedding/' + String.fromCharCode(127) + 'chat'];
    for (const href of unsafe) {
      for (const id of ['draft_canonical','draft_legacy']) {
        await assert.rejects(f.patch(id,{href}),error => error.code === '22023');
      }
      assert.deepEqual(await f.read('draft_canonical'),canonical);
      assert.deepEqual(await f.journey(),journey);
    }
    // PostgreSQL text/jsonb cannot represent U+0000; parsing refuses it before the RPC body.
    await assert.rejects(f.patch('draft_canonical',{href:'/wedding/' + String.fromCharCode(0) + 'chat'}),
      error => error.code === '22P05');
    assert.deepEqual(await f.read('draft_canonical'),canonical);
    assert.deepEqual(await f.journey(),journey);
  } finally { await f.close(); }
});

test('canonical stored unsafe href refuses untouched edits while explicit repair or null clear succeeds', async () => {
  const f = await createDraftDatabase();
  try {
    await f.seedCanonical();
    const journey = await f.journey();
    for (const href of ['/' + String.fromCharCode(92) + 'evil.invalid','//outside.invalid','https://outside.invalid',
      '/wedding/' + String.fromCharCode(9) + 'chat','/wedding/' + String.fromCharCode(127) + 'chat']) {
      await f.db.query('UPDATE public.amora_actions SET href=$1 WHERE id=$2',[href,'draft_canonical']);
      const before = await f.read('draft_canonical');
      await assert.rejects(f.patch('draft_canonical',{description:'SYNTHETIC-REJECT'},before.updated_at),
        error => error.code === '55000');
      assert.deepEqual(await f.read('draft_canonical'),before);
      assert.deepEqual(await f.journey(),journey);
      const repaired = await f.patch('draft_canonical',{href:'/wedding/chat'},before.updated_at);
      assert.equal(repaired.href,'/wedding/chat');
      assert.deepEqual(repaired,await f.read('draft_canonical'));
      await f.db.query('UPDATE public.amora_actions SET href=$1 WHERE id=$2',[href,'draft_canonical']);
      const toClear = await f.read('draft_canonical');
      const cleared = await f.patch('draft_canonical',{href:null},toClear.updated_at);
      assert.equal(cleared.href,null);
      assert.deepEqual(cleared,await f.read('draft_canonical'));
      assert.deepEqual(await f.journey(),journey);
    }
  } finally { await f.close(); }
});

test('legacy stored unsafe href refuses untouched edits while explicit repair or null clear preserves other data', async () => {
  const f = await createDraftDatabase();
  try {
    await f.seedCanonical();
    const canonical = await f.read('draft_canonical');
    for (const href of ['/' + String.fromCharCode(92) + 'evil.invalid','//outside.invalid','https://outside.invalid',
      '/wedding/' + String.fromCharCode(9) + 'chat','/wedding/' + String.fromCharCode(127) + 'chat']) {
      const bad = legacy('draft_legacy',{href});
      const untouched = legacy('legacy_untouched');
      await f.seedLegacy([bad,untouched]);
      const before = await f.journey();
      await assert.rejects(f.patch('draft_legacy',{description:'SYNTHETIC-REJECT'}),error => error.code === '55000');
      assert.deepEqual(await f.journey(),before);
      for (const repair of ['/wedding/chat',null]) {
        await f.seedLegacy([bad,untouched]);
        const toRepair = await f.journey();
        const saved = await f.patch('draft_legacy',{href:repair});
        const after = await f.journey();
        assert.equal(saved.href,repair);
        assert.equal(after.progress.__amora_actions[0].href,repair);
        assert.equal(after.state_revision,toRepair.state_revision+1);
        assert.deepEqual(after.progress.__amora_actions[0].unknown,{preserved:true});
        assert.deepEqual(after.progress.__amora_actions[1],untouched);
        assert.deepEqual(after.progress.budget,toRepair.progress.budget);
        assert.deepEqual(after.progress.schedule,toRepair.progress.schedule);
        assert.deepEqual(await f.read('draft_canonical'),canonical);
      }
    }
  } finally { await f.close(); }
});

test('member can patch the canonical action through the new checked public RPC', async () => {
  const f = await createDraftDatabase();
  try {
    await f.seedCanonical();
    const saved = await f.patch('draft_canonical',{description:'SYNTHETIC-EDIT'},TOKEN);
    assert.equal(saved.description,'SYNTHETIC-EDIT');
    assert.equal((await f.read('draft_canonical')).description,'SYNTHETIC-EDIT');
  } finally { await f.close(); }
});

test('checked canonical editing survives a retired old update while old creation stays compatible', async () => {
  const f = await createDraftDatabase();
  const future = '2050-01-01T00:00:00.123456Z';
  try {
    await f.seedCanonical('draft_retirement',future);
    // 외부 운영 함수를 바꾸지 않는다. 이 합성 DB의 구 update만 차단한다.
    const original = (await f.db.query(`SELECT pg_get_functiondef(
      'public.mutate_own_amora_action(uuid,text,text,jsonb)'::regprocedure) AS definition`)).rows[0].definition;
    const guarded = original.replace(/\bBEGIN\r?\n/, `BEGIN
      IF p_operation = 'update' THEN
        RAISE EXCEPTION 'SYNTHETIC_OLD_UPDATE_RETIRED' USING ERRCODE = '55000';
      END IF;
`);
    assert.notEqual(guarded,original,'synthetic old update guard must be installed');
    await f.exec(guarded);
    await assert.rejects(f.oldPatch('draft_retirement',{description:'SYNTHETIC-OLD-REJECTED'}),error => error.code === '55000');
    assert.equal((await f.read('draft_retirement')).description,'SYNTHETIC-ORIGINAL');
    assert.equal((await f.create('draft_create_preserved')).title,'SYNTHETIC-CANONICAL');
    const saved = await f.patch('draft_retirement',{description:'SYNTHETIC-INDEPENDENT-CHECKED'},future);
    assert.equal(saved.description,'SYNTHETIC-INDEPENDENT-CHECKED');
    assert.deepEqual(saved,await f.read('draft_retirement'),'receipt is the actual stored canonical row');
    const precision = (await f.db.query('SELECT extract(epoch FROM ($1::timestamptz-$2::timestamptz))*1000000 AS micros',
      [saved.updated_at,future])).rows[0].micros;
    assert.equal(Number(precision),1,'raw future token advances exactly one microsecond');
    await assert.rejects(f.patch('draft_retirement',{description:'SYNTHETIC-STALE'},future),error => error.code === '40001');
  } finally { await f.close(); }
});

test('canonical receipts preserve unknown metadata and real status timestamps across checked edits', async () => {
  const f = await createDraftDatabase();
  const future = '2050-01-01T00:00:00.123456Z';
  try {
    await f.seedCanonical('draft_status_receipt',future);
    const metadata = { unknown: { nested: ['SYNTHETIC-KEPT',17,null] } };
    await f.db.query('UPDATE public.amora_actions SET metadata=$1::jsonb WHERE id=$2',
      [JSON.stringify(metadata),'draft_status_receipt']);
    const initial = await f.read('draft_status_receipt');
    const journey = await f.journey();
    let previous = initial;
    let completed;
    let dismissed;
    for (const values of [{status:'done'},{description:'SYNTHETIC-DONE-MEMO'},
      {status:'dismissed'},{description:'SYNTHETIC-DISMISSED-MEMO'},
      {status:'open',description:null,due_date:null,category_key:null,href:null}]) {
      const saved = await f.patch('draft_status_receipt',values,previous.updated_at);
      assert.deepEqual(saved,await f.read('draft_status_receipt'));
      assert.deepEqual(saved.metadata,metadata);
      assert.equal(saved.id,initial.id);
      assert.equal(saved.couple_id,initial.couple_id);
      assert.equal(saved.created_by,initial.created_by);
      assert.equal(saved.created_at,initial.created_at);
      assert.equal(saved.source,initial.source);
      assert.equal(Number((await f.db.query('SELECT extract(epoch FROM ($1::timestamptz-$2::timestamptz))*1000000 AS micros',
        [saved.updated_at,previous.updated_at])).rows[0].micros),1);
      if (saved.status === 'done') {
        assert.equal(typeof saved.completed_at,'string');
        assert.equal(saved.dismissed_at,null);
        if (completed) assert.equal(saved.completed_at,completed);
        completed = saved.completed_at;
      } else if (saved.status === 'dismissed') {
        assert.equal(saved.completed_at,null);
        assert.equal(typeof saved.dismissed_at,'string');
        if (dismissed) assert.equal(saved.dismissed_at,dismissed);
        dismissed = saved.dismissed_at;
      } else {
        assert.equal(saved.completed_at,null);
        assert.equal(saved.dismissed_at,null);
        for (const key of ['description','due_date','category_key','href']) assert.equal(saved[key],null);
      }
      previous = saved;
    }
    assert.deepEqual(await f.journey(),journey);
  } finally { await f.close(); }
});

test('canonical update suppression cannot produce a success receipt without a stored change', async () => {
  const f = await createDraftDatabase();
  try {
    await f.seedCanonical();
    const before = await f.read('draft_canonical');
    await f.exec(`CREATE FUNCTION public.draft_suppress_update() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RETURN NULL; END $$;
      CREATE TRIGGER zz_draft_suppress_update BEFORE UPDATE ON public.amora_actions
      FOR EACH ROW EXECUTE FUNCTION public.draft_suppress_update();`);
    await assert.rejects(f.patch('draft_canonical',{description:'SYNTHETIC-NOT-STORED'},TOKEN),error => error.code === '55000');
    assert.deepEqual(await f.read('draft_canonical'),before);
  } finally { await f.close(); }
});

test('canonical trigger drift cannot commit text different from the approved patch', async () => {
  const f = await createDraftDatabase();
  try {
    await f.seedCanonical();
    const before = await f.read('draft_canonical');
    await f.exec(`CREATE FUNCTION public.draft_unapproved_text() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN NEW.description := 'SYNTHETIC-UNAPPROVED'; RETURN NEW; END $$;
      CREATE TRIGGER zz_draft_unapproved_text BEFORE UPDATE ON public.amora_actions
      FOR EACH ROW EXECUTE FUNCTION public.draft_unapproved_text();`);
    await assert.rejects(f.patch('draft_canonical',{description:'SYNTHETIC-APPROVED'},TOKEN),error => error.code === '55000');
    assert.deepEqual(await f.read('draft_canonical'),before);
  } finally { await f.close(); }
});

test('canonical trigger drift cannot move ownership or replace immutable provenance and metadata', async () => {
  const f = await createDraftDatabase();
  try {
    await f.seedCanonical();
    const before = await f.read('draft_canonical');
    for (const assignment of ["NEW.source := 'budget'",`NEW.metadata := '{"opaque":"SYNTHETIC-UNAPPROVED"}'::jsonb`,
      `NEW.couple_id := '${OTHER_COUPLE}'::uuid`,`NEW.created_by := '${OUTSIDER}'::uuid`,
      "NEW.id := 'draft_scope_moved'","NEW.created_at := '2050-01-01T00:00:00Z'::timestamptz"]) {
      await f.exec(`CREATE OR REPLACE FUNCTION public.draft_provenance_drift() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN ${assignment}; RETURN NEW; END $$;`);
      await f.exec('DROP TRIGGER IF EXISTS zz_draft_provenance_drift ON public.amora_actions');
      await f.exec(`CREATE TRIGGER zz_draft_provenance_drift BEFORE UPDATE ON public.amora_actions
        FOR EACH ROW EXECUTE FUNCTION public.draft_provenance_drift();`);
      await assert.rejects(f.patch('draft_canonical',{description:'SYNTHETIC-APPROVED'},TOKEN),error => error.code === '55000');
      assert.deepEqual(await f.read('draft_canonical'),before);
      assert.equal(await f.read('draft_canonical',OUTSIDER),null);
      assert.equal(await f.read('draft_scope_moved'),null);
    }
  } finally { await f.close(); }
});

test('canonical trigger drift cannot suppress an approved status transition', async () => {
  const f = await createDraftDatabase();
  try {
    await f.seedCanonical();
    const before = await f.read('draft_canonical');
    await f.exec(`CREATE FUNCTION public.draft_status_drift() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN NEW.status := 'open'; NEW.completed_at := NULL; NEW.dismissed_at := NULL; RETURN NEW; END $$;
      CREATE TRIGGER zz_draft_status_drift BEFORE UPDATE ON public.amora_actions
      FOR EACH ROW EXECUTE FUNCTION public.draft_status_drift();`);
    await assert.rejects(f.patch('draft_canonical',{status:'done'},TOKEN),error => error.code === '55000');
    assert.deepEqual(await f.read('draft_canonical'),before);
  } finally { await f.close(); }
});

test('canonical status timestamp drift cannot remove or invent the canonical trigger timestamps', async () => {
  const f = await createDraftDatabase();
  try {
    await f.seedCanonical();
    const before = await f.read('draft_canonical');
    for (const [status,assignment] of [['done','NEW.completed_at := NULL'],
      ['done',"NEW.completed_at := '2050-01-01T00:00:00Z'::timestamptz"],
      ['done',"NEW.dismissed_at := '2050-01-01T00:00:00Z'::timestamptz"],
      ['dismissed','NEW.dismissed_at := NULL'],
      ['dismissed',"NEW.completed_at := '2050-01-01T00:00:00Z'::timestamptz"],
      ['open',"NEW.completed_at := '2050-01-01T00:00:00Z'::timestamptz"]]) {
      await f.exec(`CREATE OR REPLACE FUNCTION public.draft_timestamp_drift() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN ${assignment}; RETURN NEW; END $$;`);
      await f.exec('DROP TRIGGER IF EXISTS zz_draft_timestamp_drift ON public.amora_actions');
      await f.exec(`CREATE TRIGGER zz_draft_timestamp_drift BEFORE UPDATE ON public.amora_actions
        FOR EACH ROW EXECUTE FUNCTION public.draft_timestamp_drift();`);
      await assert.rejects(f.patch('draft_canonical',{status},TOKEN),error => error.code === '55000');
      assert.deepEqual(await f.read('draft_canonical'),before);
    }
  } finally { await f.close(); }
});

test('canonical timestamp checks follow the existing trigger without inventing missing historical timestamps', async () => {
  const f = await createDraftDatabase();
  try {
    await f.seedCanonical();
    await f.exec('ALTER TABLE public.amora_actions DISABLE TRIGGER set_amora_actions_status_timestamps');
    await f.exec(`UPDATE public.amora_actions SET status='done',completed_at=NULL,
      dismissed_at='2001-01-01T00:00:00Z'::timestamptz WHERE id='draft_canonical'`);
    await f.exec('ALTER TABLE public.amora_actions ENABLE TRIGGER set_amora_actions_status_timestamps');
    const historical = await f.read('draft_canonical');
    const memo = await f.patch('draft_canonical',{description:'SYNTHETIC-HISTORICAL-MEMO'},historical.updated_at);
    assert.equal(memo.completed_at,null);
    assert.equal(memo.dismissed_at,historical.dismissed_at);
    const reopened = await f.patch('draft_canonical',{status:'open'},memo.updated_at);
    assert.equal(reopened.completed_at,null);
    assert.equal(reopened.dismissed_at,null);
    await f.exec('ALTER TABLE public.amora_actions DISABLE TRIGGER set_amora_actions_status_timestamps');
    await f.exec(`UPDATE public.amora_actions SET completed_at='2001-02-03T00:00:00Z'::timestamptz
      WHERE id='draft_canonical'`);
    await f.exec('ALTER TABLE public.amora_actions ENABLE TRIGGER set_amora_actions_status_timestamps');
    const oldCompletion = await f.read('draft_canonical');
    const done = await f.patch('draft_canonical',{status:'done'},oldCompletion.updated_at);
    assert.equal(done.completed_at,oldCompletion.completed_at,'the original transition coalesces the existing timestamp');
    assert.equal(done.dismissed_at,null);
    assert.deepEqual(done,await f.read('draft_canonical'));
  } finally { await f.close(); }
});

test('an immediate canonical AFTER trigger cannot change the final row behind an approved RETURNING snapshot', async () => {
  const f = await createDraftDatabase();
  try {
    await f.seedCanonical();
    const before = await f.read('draft_canonical');
    await f.exec(`CREATE FUNCTION public.draft_after_canonical_drift() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF pg_trigger_depth()=1 THEN
          UPDATE public.amora_actions SET description='SYNTHETIC-AFTER-UNAPPROVED' WHERE id=NEW.id;
        END IF;
        RETURN NULL;
      END $$;
      CREATE TRIGGER zz_draft_after_canonical_drift AFTER UPDATE ON public.amora_actions
      FOR EACH ROW EXECUTE FUNCTION public.draft_after_canonical_drift();`);
    await assert.rejects(f.patch('draft_canonical',{description:'SYNTHETIC-APPROVED'},TOKEN),error => error.code === '55000');
    assert.deepEqual(await f.read('draft_canonical'),before);
  } finally { await f.close(); }
});

test('member patches a legacy-only card through the same RPC without changing other preparation data', async () => {
  const f = await createDraftDatabase();
  try {
    const untouched = legacy('legacy_untouched');
    await f.seedLegacy([legacy(),untouched]);
    const before = await f.journey();
    const saved = await f.patch('draft_legacy',{description:'SYNTHETIC-EDIT'},TOKEN);
    assert.equal(saved.description,'SYNTHETIC-EDIT');
    // v2는 한 canonical-shaped receipt만 반환하며 legacy 내부 alias는 보내지 않는다.
    assert.equal(typeof saved.updated_at,'string');
    assert.equal(Object.hasOwn(saved,'updatedAt'),false);
    const after = await f.journey();
    assert.equal(after.state_revision,before.state_revision+1);
    assert.deepEqual(after.progress.__amora_actions[1],untouched);
    assert.deepEqual(after.progress.budget,before.progress.budget);
    assert.deepEqual(after.progress.schedule,before.progress.schedule);
    assert.deepEqual(after.progress.__amora_actions[0].unknown,{preserved:true});
  } finally { await f.close(); }
});

test('a second editor cannot reuse the first canonical view after a partner edit', async () => {
  const f = await createDraftDatabase();
  try {
    await f.seedCanonical();
    await f.patch('draft_canonical',{description:'SYNTHETIC-PARTNER'},TOKEN);
    await assert.rejects(f.patch('draft_canonical',{description:'SYNTHETIC-STALE'},TOKEN), error => error.code === '40001');
    assert.equal((await f.read('draft_canonical')).description,'SYNTHETIC-PARTNER');
  } finally { await f.close(); }
});

test('checked canonical and legacy edits advance a future view token instead of moving it backwards', async () => {
  const f = await createDraftDatabase();
  const future = '2050-01-01T00:00:00.123456Z';
  try {
    await f.seedCanonical('future_canonical',future);
    await f.seedLegacy([legacy('future_legacy',{updatedAt:future})]);
    for (const id of ['future_canonical','future_legacy']) {
      const saved = await f.patch(id,{description:'SYNTHETIC-FUTURE-EDIT'},future);
      const order = await f.db.query('SELECT $1::timestamptz > $2::timestamptz AS advanced',[saved.updated_at,future]);
      assert.equal(order.rows[0].advanced,true,id);
      await assert.rejects(f.patch(id,{description:'SYNTHETIC-STALE'},future),error => error.code === '40001');
    }
  } finally { await f.close(); }
});

test('legacy edits retain the safe bigint journey revision above the 32 bit range', async () => {
  const f = await createDraftDatabase();
  try {
    await f.seedLegacy([legacy()]);
    await f.exec('ALTER TABLE public.wedding_journeys DISABLE TRIGGER journey_revision');
    await f.db.query('UPDATE public.wedding_journeys SET state_revision=2147483647');
    await f.exec('ALTER TABLE public.wedding_journeys ENABLE TRIGGER journey_revision');
    await f.patch('draft_legacy',{description:'SYNTHETIC-BIGINT-EDIT'},TOKEN);
    assert.equal((await f.journey()).state_revision,2147483648);
  } finally { await f.close(); }
});

test('legacy completion, dismissal and reopening return mutually exclusive real status timestamps', async () => {
  const f = await createDraftDatabase();
  try {
    await f.seedLegacy([legacy()]);
    let saved = await f.patch('draft_legacy',{status:'done'},TOKEN);
    assert.equal(typeof saved.completed_at,'string');
    assert.equal(saved.dismissed_at,null);
    const completed = saved.completed_at;
    saved = await f.patch('draft_legacy',{description:'SYNTHETIC-DONE-MEMO'},saved.updated_at);
    assert.equal(saved.completed_at,completed);
    saved = await f.patch('draft_legacy',{status:'dismissed'},saved.updated_at);
    assert.equal(saved.completed_at,null);
    assert.equal(typeof saved.dismissed_at,'string');
    const dismissed = saved.dismissed_at;
    saved = await f.patch('draft_legacy',{description:'SYNTHETIC-DISMISSED-MEMO'},saved.updated_at);
    assert.equal(saved.dismissed_at,dismissed);
    saved = await f.patch('draft_legacy',{status:'open'},saved.updated_at);
    assert.equal(saved.completed_at,null);
    assert.equal(saved.dismissed_at,null);
  } finally { await f.close(); }
});

test('legacy numeric IDs and blank or overlong stored titles are unavailable without any mutation', async () => {
  const f = await createDraftDatabase();
  try {
    for (const bad of [legacy(1234),legacy('1234',{title:'  '}),legacy('1234',{title:'x'.repeat(121)})]) {
      await f.seedLegacy([bad]);
      const before = await f.journey();
      await assert.rejects(f.patch('1234',{description:'SYNTHETIC-REJECT'},TOKEN),error => error.code === '55000');
      assert.deepEqual(await f.journey(),before);
    }
  } finally { await f.close(); }
});

test('new legacy and canonical titles share trimmed validated output', async () => {
  const f = await createDraftDatabase();
  try {
    await f.seedCanonical();
    await f.seedLegacy([legacy()]);
    for (const id of ['draft_canonical','draft_legacy']) {
      assert.equal((await f.patch(id,{title:'  SYNTHETIC-TRIMMED  '},TOKEN)).title,'SYNTHETIC-TRIMMED');
    }
  } finally { await f.close(); }
});

test('legacy success is refused and rolled back if a DB trigger changes the stored result', async () => {
  const f = await createDraftDatabase();
  try {
    await f.seedLegacy([legacy()]);
    const before = await f.journey();
    await f.exec(`CREATE FUNCTION public.draft_change_result() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN NEW.progress=jsonb_set(NEW.progress,'{__amora_actions,0,description}','"SYNTHETIC-TRIGGER"'::jsonb); RETURN NEW; END $$;
      CREATE TRIGGER zz_draft_change_result BEFORE UPDATE ON public.wedding_journeys
      FOR EACH ROW EXECUTE FUNCTION public.draft_change_result();`);
    await assert.rejects(f.patch('draft_legacy',{description:'SYNTHETIC-EDIT'},TOKEN),error => error.code === '55000');
    assert.deepEqual(await f.journey(),before);
  } finally { await f.close(); }
});

test('an immediate legacy AFTER trigger cannot hide a second progress write behind RETURNING', async () => {
  const f = await createDraftDatabase();
  try {
    await f.seedLegacy([legacy(),legacy('legacy_untouched')]);
    const before = await f.journey();
    await f.exec(`CREATE FUNCTION public.draft_after_legacy_drift() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF pg_trigger_depth()=1 THEN
          UPDATE public.wedding_journeys SET progress=jsonb_set(NEW.progress,
            '{__amora_actions,0,description}','"SYNTHETIC-AFTER-UNAPPROVED"'::jsonb) WHERE id=NEW.id;
        END IF;
        RETURN NULL;
      END $$;
      CREATE TRIGGER zz_draft_after_legacy_drift AFTER UPDATE ON public.wedding_journeys
      FOR EACH ROW EXECUTE FUNCTION public.draft_after_legacy_drift();`);
    await assert.rejects(f.patch('draft_legacy',{description:'SYNTHETIC-APPROVED'},TOKEN),error => error.code === '55000');
    assert.deepEqual(await f.journey(),before);
  } finally { await f.close(); }
});

test('legacy output authority comes from the checked scope rather than untrusted saved aliases', async () => {
  const f = await createDraftDatabase();
  try {
    await f.seedLegacy([legacy('draft_legacy',{couple_id:OTHER_COUPLE,created_by:OUTSIDER})]);
    const saved = await f.patch('draft_legacy',{description:'SYNTHETIC-EDIT'},TOKEN);
    assert.equal(saved.id,'draft_legacy');
    assert.equal(saved.couple_id,COUPLE);
    assert.equal(Object.hasOwn(saved,'created_by'),false);
    assert.equal(Object.hasOwn(saved,'unknown'),false);
    const stored = (await f.journey()).progress.__amora_actions[0];
    assert.deepEqual(stored.unknown,{preserved:true});
    assert.equal(stored.couple_id,OTHER_COUPLE);
    assert.equal(stored.created_by,OUTSIDER);
  } finally { await f.close(); }
});

test('legacy duplicates including an invalid second copy are rejected without choosing the first item', async () => {
  const f = await createDraftDatabase();
  try {
    for (const second of [legacy(),legacy('draft_legacy',{title:null}),{id:'draft_legacy',unexpected:true}]) {
      await f.seedLegacy([legacy(),second]);
      const before = await f.journey();
      await assert.rejects(f.patch('draft_legacy',{description:'SYNTHETIC-REJECT'}),error => error.code === '55000');
      assert.deepEqual(await f.journey(),before);
    }
  } finally { await f.close(); }
});

test('missing, nonstring and malformed stored legacy timestamps are never replaced with invented versions', async () => {
  const f = await createDraftDatabase();
  try {
    for (const updatedAt of [undefined,null,123,'infinity','invalid','2026-02-30T12:00:00Z','2026-01-01T00:00:00+99:99']) {
      await f.seedLegacy([legacy('draft_legacy',{updatedAt})]);
      const before = await f.journey();
      await assert.rejects(f.patch('draft_legacy',{description:'SYNTHETIC-REJECT'}),error => error.code === '55000');
      assert.deepEqual(await f.journey(),before);
    }
  } finally { await f.close(); }
});

test('missing or malformed approval tokens are invalid for both storage types and cannot write', async () => {
  const f = await createDraftDatabase();
  try {
    await f.seedCanonical();
    await f.seedLegacy([legacy()]);
    for (const token of [null,'','infinity','2026-02-30T12:00:00Z','2026-01-01T00:00:00.1234567Z','2026-01-01T00:00:00+99:99']) {
      for (const id of ['draft_canonical','draft_legacy']) {
        await assert.rejects(f.patch(id,{description:'SYNTHETIC-REJECT'},token),error => error.code === '22023');
      }
    }
    assert.equal((await f.read('draft_canonical')).description,'SYNTHETIC-ORIGINAL');
    assert.equal((await f.journey()).progress.__amora_actions[0].description,'SYNTHETIC-ORIGINAL');
  } finally { await f.close(); }
});

test('microsecond stale approvals are rejected while an equivalent timezone token is accepted', async () => {
  const f = await createDraftDatabase();
  try {
    await f.seedCanonical();
    await f.seedLegacy([legacy()]);
    for (const id of ['draft_canonical','draft_legacy']) {
      await assert.rejects(f.patch(id,{description:'SYNTHETIC-STALE'},'2026-01-01T00:00:00.123455Z'),error => error.code === '40001');
      const saved = await f.patch(id,{description:'SYNTHETIC-TZ-EDIT'},'2026-01-01T09:00:00.123456+09:00');
      assert.equal(saved.description,'SYNTHETIC-TZ-EDIT');
      await assert.rejects(f.patch(id,{description:'SYNTHETIC-STALE'},TOKEN),error => error.code === '40001');
    }
  } finally { await f.close(); }
});

test('the RPC respects current member scope and never mutates another couple', async () => {
  const f = await createDraftDatabase();
  try {
    await f.seedCanonical();
    for (const options of [{actor:OUTSIDER},{couple:OTHER_COUPLE},{actor:null}]) {
      await assert.rejects(f.patch('draft_canonical',{description:'SYNTHETIC-REJECT'},TOKEN,options),error => error.code === '42501');
    }
    await f.db.query('UPDATE public.profiles SET couple_id=null WHERE id=$1',[BRIDE]);
    await assert.rejects(f.patch('draft_canonical',{description:'SYNTHETIC-UNLINKED'}),error => error.code === '42501');
    assert.equal((await f.read('draft_canonical',GROOM)).description,'SYNTHETIC-ORIGINAL');
  } finally { await f.close(); }
});

test('anon, service role and direct authenticated table writes cannot bypass the checked public interface', async () => {
  const f = await createDraftDatabase();
  try {
    await f.seedCanonical();
    for (const role of ['anon','service_role']) {
      await assert.rejects(f.patch('draft_canonical',{description:'SYNTHETIC-REJECT'},TOKEN,{role}),error => error.code === '42501');
    }
    await assert.rejects(f.asRole('authenticated',BRIDE,
      "UPDATE public.amora_actions SET description='SYNTHETIC-DIRECT' WHERE id='draft_canonical'"),error => error.code === '42501');
    for (const sql of ['SELECT public.advance_amora_action_view_token_v2()',
      `SELECT public.lock_own_amora_action_couple('${COUPLE}')`,
      `SELECT public.validate_manual_amora_action_values('{"status":"done"}'::jsonb,false)`]) {
      await assert.rejects(f.asRole('authenticated',BRIDE,sql),error => error.code === '42501');
    }
    assert.equal((await f.read('draft_canonical')).description,'SYNTHETIC-ORIGINAL');
  } finally { await f.close(); }
});

test('old canonical and legacy public writers remain callable but unversioned overwrite remains an explicit limit', async () => {
  const f = await createDraftDatabase();
  const future = '2050-01-01T00:00:00.123456Z';
  try {
    await f.seedCanonical('draft_canonical',future);
    const checked = await f.patch('draft_canonical',{description:'SYNTHETIC-CHECKED'},future);
    const old = await f.oldPatch('draft_canonical',{description:'SYNTHETIC-OLD-OVERWRITE'},{actor:GROOM});
    assert.equal(old.description,'SYNTHETIC-OLD-OVERWRITE');
    assert.equal((await f.read('draft_canonical')).description,'SYNTHETIC-OLD-OVERWRITE');
    assert.equal((await f.db.query('SELECT $1::timestamptz > $2::timestamptz AS advanced',[old.updated_at,checked.updated_at])).rows[0].advanced,true);
    await f.seedLegacy([legacy()]);
    const journey = await f.journey();
    const oldLegacy = await f.asRole('authenticated',GROOM,
      'SELECT public.update_own_legacy_amora_action($1,$2,$3,$4,$5::jsonb) AS value',
      [COUPLE,JOURNEY,'draft_legacy',journey.state_revision,JSON.stringify({description:'SYNTHETIC-OLD-LEGACY'})]);
    assert.equal(oldLegacy.rows[0].value.progress.__amora_actions[0].description,'SYNTHETIC-OLD-LEGACY');
    const created = await f.create('draft_old_create');
    assert.equal(created.title,'SYNTHETIC-CANONICAL');
  } finally { await f.close(); }
});

test('canonical shadows take precedence over a malformed legacy copy without writing that copy', async () => {
  const f = await createDraftDatabase();
  try {
    await f.seedCanonical();
    await f.seedLegacy([legacy('draft_canonical',{updatedAt:null})]);
    const before = await f.journey();
    assert.equal((await f.patch('draft_canonical',{description:'SYNTHETIC-CANONICAL-EDIT'})).description,'SYNTHETIC-CANONICAL-EDIT');
    assert.deepEqual(await f.journey(),before);
  } finally { await f.close(); }
});

test('a legacy ID equal to another couples canonical ID updates only the owned legacy item', async () => {
  const f = await createDraftDatabase();
  try {
    await f.db.query(`INSERT INTO public.amora_actions(id,couple_id,title,description,created_by,updated_at)
      VALUES('same_id',$1,'SYNTHETIC-OTHER','SYNTHETIC-OTHER-UNCHANGED',$2,$3::timestamptz)`,[OTHER_COUPLE,OUTSIDER,TOKEN]);
    await f.seedLegacy([legacy('same_id')]);
    const saved = await f.patch('same_id',{description:'SYNTHETIC-OWN-LEGACY'});
    assert.equal(saved.couple_id,COUPLE);
    assert.equal((await f.read('same_id',OUTSIDER)).description,'SYNTHETIC-OTHER-UNCHANGED');
  } finally { await f.close(); }
});

test('missing cards return null and invalid manual fields do not mutate either storage', async () => {
  const f = await createDraftDatabase();
  try {
    assert.equal(await f.patch('missing_card',{description:'SYNTHETIC-MISSING'}),null);
    await f.seedCanonical();
    await f.seedLegacy([legacy()]);
    for (const values of [{},{created_by:OUTSIDER},{source:'manual'},{updatedAt:TOKEN},{status:'bad'},{title:' '},{href:'//outside.invalid'},{description:'x'.repeat(501)}]) {
      for (const id of ['draft_canonical','draft_legacy']) {
        await assert.rejects(f.patch(id,values),error => error.code === '22023');
      }
    }
    assert.equal((await f.read('draft_canonical')).description,'SYNTHETIC-ORIGINAL');
    assert.equal((await f.journey()).progress.__amora_actions[0].description,'SYNTHETIC-ORIGINAL');
  } finally { await f.close(); }
});

test('a disabled token or revision trigger fails closed with rollback rather than a false success', async () => {
  const f = await createDraftDatabase();
  try {
    await f.seedCanonical();
    await f.seedLegacy([legacy()]);
    const before = await f.journey();
    await f.exec('ALTER TABLE public.amora_actions DISABLE TRIGGER set_amora_actions_updated_at');
    await assert.rejects(f.patch('draft_canonical',{description:'SYNTHETIC-REJECT'}),error => error.code === '55000');
    assert.equal((await f.read('draft_canonical')).description,'SYNTHETIC-ORIGINAL');
    await f.exec('ALTER TABLE public.wedding_journeys DISABLE TRIGGER journey_revision');
    await assert.rejects(f.patch('draft_legacy',{description:'SYNTHETIC-REJECT'}),error => error.code === '55000');
    assert.deepEqual(await f.journey(),before);
  } finally { await f.close(); }
});

test('canonical edits do not require an unrelated legacy journey to exist', async () => {
  const f=await createDraftDatabase();
  try {
    await f.seedCanonical();
    await f.db.query('DELETE FROM public.wedding_journeys WHERE id=$1',[JOURNEY]);
    assert.equal((await f.patch('draft_canonical',{description:'SYNTHETIC-NO-JOURNEY'})).description,'SYNTHETIC-NO-JOURNEY');
    assert.equal(await f.patch('missing_legacy',{description:'SYNTHETIC-MISSING'}),null);
  } finally { await f.close(); }
});

test('two canonical writes in one transaction receive strictly increasing microsecond versions', async () => {
  const f=await createDraftDatabase();
  const future='2050-01-01T00:00:00.123456Z';
  try {
    await f.seedCanonical('same_tx',future);
    const result=await f.asRole('authenticated',BRIDE,`WITH first AS MATERIALIZED (
      SELECT public.patch_own_amora_action_view_v2($1,'same_tx',$2,'{"description":"SYNTHETIC-FIRST"}'::jsonb) AS value
    ), second AS MATERIALIZED (
      SELECT public.patch_own_amora_action_view_v2($1,'same_tx',first.value->>'updated_at','{"description":"SYNTHETIC-SECOND"}'::jsonb) AS value FROM first
    ) SELECT ((second.value->>'updated_at')::timestamptz > (first.value->>'updated_at')::timestamptz) AS advanced,
      extract(epoch FROM ((second.value->>'updated_at')::timestamptz-$2::timestamptz))*1000000 AS micros FROM first,second`,[COUPLE,future]);
    assert.equal(result.rows[0].advanced,true);
    assert.equal(Number(result.rows[0].micros),2);
    assert.equal((await f.read('same_tx')).description,'SYNTHETIC-SECOND');
  } finally { await f.close(); }
});

test('a malformed legacy actions container is unavailable while unrelated primitive entries are preserved', async () => {
  const f=await createDraftDatabase();
  try {
    for(const actions of [null,{},'invalid',123]) {
      await f.db.query("UPDATE public.wedding_journeys SET progress=jsonb_set(progress,'{__amora_actions}',$1::jsonb)",[JSON.stringify(actions)]);
      const before=await f.journey();
      await assert.rejects(f.patch('draft_legacy',{description:'SYNTHETIC-REJECT'}),error=>error.code==='55000');
      assert.deepEqual(await f.journey(),before);
    }
    await f.seedLegacy([null,'synthetic-unknown',123,legacy()]);
    const saved=await f.patch('draft_legacy',{description:'SYNTHETIC-PRESERVE'});
    assert.equal(saved.description,'SYNTHETIC-PRESERVE');
    assert.deepEqual((await f.journey()).progress.__amora_actions.slice(0,3),[null,'synthetic-unknown',123]);
  } finally { await f.close(); }
});

test('candidate installation preserves old public writer/helper bodies, ACLs and table permission boundaries', async () => {
  const f=await createDraftDatabase({candidate:false});
  const functions=`SELECT proname,pg_get_function_identity_arguments(oid) AS args,
    md5(pg_get_functiondef(oid)) AS body,proacl::text AS acl FROM pg_proc
    WHERE pronamespace='public'::regnamespace AND proname IN (
      'mutate_own_amora_action','update_own_legacy_amora_action','lock_own_amora_action_couple',
      'validate_manual_amora_action_values','update_updated_at_column','set_amora_action_status_timestamps') ORDER BY proname,args`;
  const relations=`SELECT relname,relrowsecurity,relacl::text AS acl FROM pg_class
    WHERE oid IN ('public.amora_actions'::regclass,'public.wedding_journeys'::regclass) ORDER BY relname`;
  try {
    const beforeFunctions=(await f.db.query(functions)).rows;
    const beforeRelations=(await f.db.query(relations)).rows;
    assert.equal(beforeFunctions.length,6);
    await f.exec(readFileSync(candidatePath,'utf8'));
    assert.deepEqual((await f.db.query(functions)).rows,beforeFunctions);
    assert.deepEqual((await f.db.query(relations)).rows,beforeRelations);
    const functionsV2=(await f.db.query(`SELECT proname,pg_get_function_identity_arguments(oid) AS args
      FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='patch_own_amora_action_view_v2'`)).rows;
    assert.deepEqual(functionsV2,[{proname:'patch_own_amora_action_view_v2',args:'p_couple_id uuid, p_action_id text, p_expected_updated_at text, p_values jsonb'}]);
  } finally { await f.close(); }
});

test('malformed known legacy fields and missing required enums cannot be committed as a typed success receipt', async () => {
  const f=await createDraftDatabase();
  try {
    const malformed=[{description:{synthetic:true}},{status:'bad'},{priority:'urgent'},{source:17},
      {dueDate:['synthetic']},{categoryKey:{}},{href:'//outside.invalid'},
      {status:undefined},{priority:undefined},{source:undefined}];
    for(const fields of malformed) {
      await f.seedLegacy([legacy('draft_legacy',fields)]);
      const before=await f.journey();
      await assert.rejects(f.patch('draft_legacy',{title:'SYNTHETIC-EDIT'}),error=>error.code==='55000');
      assert.deepEqual(await f.journey(),before);
    }
    await f.seedLegacy([legacy('draft_legacy',{description:{synthetic:true}})]);
    assert.equal((await f.patch('draft_legacy',{description:'SYNTHETIC-EXPLICIT-REPAIR'})).description,'SYNTHETIC-EXPLICIT-REPAIR');
    await f.seedLegacy([legacy('draft_legacy',{description:undefined,dueDate:undefined,categoryKey:null,href:null})]);
    const saved=await f.patch('draft_legacy',{title:'SYNTHETIC-OPTIONAL'});
    assert.equal(saved.description,null);
    assert.equal(saved.due_date,null);
    assert.equal(saved.category_key,null);
    assert.equal(saved.href,null);
  } finally { await f.close(); }
});

test('malformed optional legacy timestamps and an unrepresentable next view token fail closed', async () => {
  const f=await createDraftDatabase();
  try {
    for(const fields of [{createdAt:{}},{createdAt:'invalid'},{completedAt:123,status:'done'},
      {dismissedAt:['invalid'],status:'dismissed'}]) {
      await f.seedLegacy([legacy('draft_legacy',fields)]);
      const before=await f.journey();
      await assert.rejects(f.patch('draft_legacy',{title:'SYNTHETIC-REJECT'}),error=>error.code==='55000');
      assert.deepEqual(await f.journey(),before);
    }
    const exhausted='9999-12-31T23:59:59.999999Z';
    await f.seedCanonical('exhausted_token',exhausted);
    await assert.rejects(f.patch('exhausted_token',{title:'SYNTHETIC-REJECT'},exhausted),error=>error.code==='55000');
    assert.equal((await f.read('exhausted_token')).title,'SYNTHETIC-CANONICAL');
  } finally { await f.close(); }
});
