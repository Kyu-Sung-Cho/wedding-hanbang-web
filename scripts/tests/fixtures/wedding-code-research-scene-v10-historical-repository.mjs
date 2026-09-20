import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pinnedArtifact } from '../../lib/current-baseline-release-contract.mjs';
import { createWeddingCodeSceneVersionHistoricalRepository } from './wedding-code-research-scene-v09-historical-repository.mjs';

// 검토한 235 역사 fixture에 236 원문만 추가한다. 현행 SQL을 임의로 거르지 않는다.
export function createWeddingCodeSceneV10HistoricalRepository(sourceRoot) {
  const fixture=createWeddingCodeSceneVersionHistoricalRepository(sourceRoot);
  try {
    const file='supabase/release-contracts/wedding-code-research-scene-v10-v1.json';
    const contract=JSON.parse(pinnedArtifact(sourceRoot,{file,sha256:'5641d5030d760210d075af9e1c4e80ed462318e9debd2b1bcc47d1195f025cdf'}));
    const pins=[contract.runtime,contract.predecessorMigration,contract.catalogBaseMigration,
      ...contract.migrations.map(pin=>({...pin,file:`supabase/migrations/${pin.file}`}))];
    for(const pin of pins) pinnedArtifact(sourceRoot,pin);
    for(const path of [file,...pins.map(pin=>pin.file)]) {
      mkdirSync(dirname(join(fixture.root,path)),{recursive:true});copyFileSync(join(sourceRoot,path),join(fixture.root,path));
    }
    return fixture;
  } catch(error) { fixture.cleanup();throw error; }
}
