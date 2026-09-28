import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pinnedArtifact } from '../../lib/current-baseline-release-contract.mjs';
import { createWeddingCodePairSessionHistoricalRepository } from './wedding-code-pair-session-historical-repository.mjs';

// 검토한 238 역사 원문에 고정된 239 계약만 추가한다. 이후 SQL을 걸러내지 않는다.
export function createWeddingCodePairSessionConflictHistoricalRepository(sourceRoot) {
  const fixture = createWeddingCodePairSessionHistoricalRepository(sourceRoot);
  try {
    const file = 'supabase/release-contracts/wedding-code-pair-session-conflict-v1.json';
    const contract = JSON.parse(pinnedArtifact(sourceRoot, { file, sha256: 'ba4a96b3dfc300fd9b4a7c5d12489af0ecb1d4d37f936b83286e7741633f5031' }));
    const pins = [contract.runtime, contract.catalog, contract.catalogFixture, contract.predecessorMigration,
      ...contract.migrations.map(pin => ({ ...pin, file: `supabase/migrations/${pin.file}` }))];
    for (const pin of pins) pinnedArtifact(sourceRoot, pin);
    for (const path of [file, ...pins.map(pin => pin.file)]) {
      mkdirSync(dirname(join(fixture.root, path)), { recursive: true });
      copyFileSync(join(sourceRoot, path), join(fixture.root, path));
    }
    return fixture;
  } catch (error) { fixture.cleanup(); throw error; }
}
