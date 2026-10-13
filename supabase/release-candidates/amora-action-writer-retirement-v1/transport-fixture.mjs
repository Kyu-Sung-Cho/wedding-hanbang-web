import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

/** Minimal owned native baseline prerequisite for the fifth's existing plan ROWTYPE. No production clone or approval proof. */
export async function installTransportCompanion(f){
  assert.equal(f.native,true,'Transport behavior evidence requires actual owned native PG');
  if(!(await f.db.query("SELECT to_regclass('public.couple_plan_change_requests') AS present")).rows[0].present){
    const source=readFileSync(new URL('../../migrations/20260731123000_couple_plan_change_write_boundary.sql',import.meta.url),'utf8');
    const unsafe=source.match(/CREATE OR REPLACE FUNCTION public\.couple_plan_change_has_unsafe_display_text\([\s\S]*?\$function\$;/)?.[0];
    const request=source.match(/CREATE TABLE public\.couple_plan_change_requests\s*\([\s\S]*?\n\);/)?.[0];
    assert.ok(unsafe&&request,'Existing actual source prerequisites are mandatory');
    await f.exec(unsafe);await f.exec(request);
  }
  await f.exec(readFileSync(new URL('./transport_conflict_response_v1.sql',import.meta.url),'utf8'));
}
