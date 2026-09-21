import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pinnedArtifact } from '../../lib/current-baseline-release-contract.mjs';
import { createWeddingCodeSceneV10HistoricalRepository } from './wedding-code-research-scene-v10-historical-repository.mjs';

// 검토된 236개 이력 위에 승인된 237번째 원문만 더한다. 현 checkout의 새 SQL을 허용하지 않는다.
export function createPreparationStyleHistoricalRepository(sourceRoot) {
  const fixture = createWeddingCodeSceneV10HistoricalRepository(sourceRoot);
  try {
    const file = 'supabase/release-contracts/preparation-style-v1.json';
    const contract = JSON.parse(pinnedArtifact(sourceRoot, { file,
      sha256: 'dd80bc6417c8344b1ef5d0b1bb3b60b0edd91bab5f5d7d44bbb231e57b88b48c' }));
    const pins = [contract.runtime, contract.catalog, contract.catalogFixture, contract.dependencyMigration,
      ...contract.migrations.map(pin => ({ ...pin, file: `supabase/migrations/${pin.file}` }))];
    for (const pin of pins) pinnedArtifact(sourceRoot, pin);
    for (const path of [file, ...pins.map(pin => pin.file)]) {
      mkdirSync(dirname(join(fixture.root, path)), { recursive: true });
      copyFileSync(join(sourceRoot, path), join(fixture.root, path));
    }
    return fixture;
  } catch (error) { fixture.cleanup(); throw error; }
}
