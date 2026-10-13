import assert from 'node:assert/strict';
import { existsSync,readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createDraftDatabase,candidatePath } from '../amora-action-view-v2/draft-fixture.mjs';
export { BRIDE,GROOM,OUTSIDER,COUPLE,OTHER_COUPLE,JOURNEY,TOKEN,legacy,nativeProfileRoleAvailable } from '../amora-action-view-v2/draft-fixture.mjs';

export const cutoverPath = new URL('./cutover_writer_retirement_identity_v1.sql',import.meta.url);
export async function createCutoverDatabase(options={}) {
  assert.equal(createHash('sha256').update(readFileSync(candidatePath)).digest('hex'),'e31372d192a0215d4ddf280a99abb628e7a8f732ebc02cb0b7e55fed1373730d');
  const f=await createDraftDatabase(options);
  try {
    if(options.cutover!==false && existsSync(cutoverPath)) await f.exec(readFileSync(cutoverPath,'utf8'));
    return f;
  } catch(error) { await f.close(); throw error; }
}

export async function beginAs(client,role,actor) {
  assert.ok(['authenticated','service_role','anon'].includes(role));
  await client.query('BEGIN');
  await client.query(`SET LOCAL ROLE ${role}`);
  await client.query("SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true)",[actor??'',role]);
}
