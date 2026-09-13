import {copyFileSync} from 'node:fs';
import {join} from 'node:path';
import {pinnedArtifact} from '../../lib/current-baseline-release-contract.mjs';
import {createChatFeedbackHistoricalRepository} from './chat-feedback-historical-repository.mjs';
export function createProfileRoleHistoricalRepository(sourceRoot) {
 const fixture=createChatFeedbackHistoricalRepository(sourceRoot);
 try {
  const file='supabase/release-contracts/profile-wedding-roles-v1.json';
  const contract=JSON.parse(pinnedArtifact(sourceRoot,{file,sha256:'5a10fb62c847c64776d3e64214b4038c042427b325649735bc9963077a4b3b71'}));
  const pins=[contract.runtime,contract.catalog,...contract.migrations.map(pin=>({...pin,file:`supabase/migrations/${pin.file}`}))];
  for(const pin of pins)pinnedArtifact(sourceRoot,pin);
  for(const path of [file,...pins.map(pin=>pin.file)])copyFileSync(join(sourceRoot,path),join(fixture.root,path));
  return fixture;
 }catch(error){fixture.cleanup();throw error}
}
