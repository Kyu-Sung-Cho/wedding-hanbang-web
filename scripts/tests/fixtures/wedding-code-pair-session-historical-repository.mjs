import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pinnedArtifact } from '../../lib/current-baseline-release-contract.mjs';
import { createPreparationStyleHistoricalRepository } from './preparation-style-historical-repository.mjs';

// 검토한 237 역사 fixture에 고정된 238 원문만 추가한다. 이후 SQL을 걸러내지 않는다.
export function createWeddingCodePairSessionHistoricalRepository(sourceRoot) {
  const fixture = createPreparationStyleHistoricalRepository(sourceRoot);
  try {
    const file = 'supabase/release-contracts/wedding-code-pair-session-v1.json';
    const contract = JSON.parse(pinnedArtifact(sourceRoot, { file, sha256: 'f479973b0dbc583981159a687c9d207d25bd21273cd01c41e03672299f73c5e7' }));
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
