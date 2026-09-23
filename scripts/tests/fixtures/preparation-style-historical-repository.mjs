import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pinnedArtifact } from '../../lib/current-baseline-release-contract.mjs';
import { createWeddingCodeSceneV10HistoricalRepository } from './wedding-code-research-scene-v10-historical-repository.mjs';

// 검토한 236 역사 fixture에 237 원문만 추가한다. 현행 SQL을 임의로 거르지 않는다.
export function createPreparationStyleHistoricalRepository(sourceRoot) {
  const fixture=createWeddingCodeSceneV10HistoricalRepository(sourceRoot);
  try {
    const file='supabase/release-contracts/preparation-style-v1.json';
    const contract=JSON.parse(pinnedArtifact(sourceRoot,{file,sha256:'dd80bc6417c8344b1ef5d0b1bb3b60b0edd91bab5f5d7d44bbb231e57b88b48c'}));
    const pins=[contract.runtime,contract.catalog,contract.catalogFixture,contract.predecessorMigration,contract.dependencyMigration,
      ...contract.migrations.map(pin=>({...pin,file:`supabase/migrations/${pin.file}`}))];
    for(const pin of pins) pinnedArtifact(sourceRoot,pin);
    for(const path of [file,...pins.map(pin=>pin.file)]) {
      mkdirSync(dirname(join(fixture.root,path)),{recursive:true});copyFileSync(join(sourceRoot,path),join(fixture.root,path));
    }
    return fixture;
  } catch(error) { fixture.cleanup();throw error; }
}
