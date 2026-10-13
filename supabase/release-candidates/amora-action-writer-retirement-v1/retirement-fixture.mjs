import assert from 'node:assert/strict';
import { existsSync,readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createCutoverDatabase } from '../amora-action-writer-cutover-v1/cutover-fixture.mjs';
export { BRIDE,GROOM,OUTSIDER,COUPLE,OTHER_COUPLE,JOURNEY,TOKEN,legacy,nativeProfileRoleAvailable,beginAs } from '../amora-action-writer-cutover-v1/cutover-fixture.mjs';

export const retirementPath=new URL('./retirement_service_writers_v1.sql',import.meta.url);
export const directJourneyGuardPath=new URL('./retirement_direct_journey_guard_v1.sql',import.meta.url);
const cutoverPath=new URL('../amora-action-writer-cutover-v1/cutover_writer_retirement_identity_v1.sql',import.meta.url);
export async function createRetirementDatabase(options={}) {
  assert.equal(createHash('sha256').update(readFileSync(cutoverPath)).digest('hex'),'25b78629def538a85e13848df70f5e9142df8469f5ee75aa1096dfb1183ef2ca');
  const f=await createCutoverDatabase(options);
  try {
    for(const name of ['20260611160000_journey_progress_atomic_merge.sql','20260716100000_journey_progress_atomic_item_patch.sql']) {
      await f.exec(readFileSync(new URL(`../../migrations/${name}`,import.meta.url),'utf8'));
    }
    if(options.retirement!==false&&existsSync(retirementPath)) await f.exec(readFileSync(retirementPath,'utf8'));
    if(options.directGuard!==false&&existsSync(directJourneyGuardPath)) await f.exec(readFileSync(directJourneyGuardPath,'utf8'));
    return f;
  } catch(error) { await f.close(); throw error; }
}
