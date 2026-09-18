import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pinnedArtifact } from '../../lib/current-baseline-release-contract.mjs';
import { createWeddingCodeResearchHistoricalRepository } from './wedding-code-research-contributions-historical-repository.mjs';

// 234 역사 fixture에 이미 검토된 235 원문만 추가한다. 현행 SQL 목록을 줄이거나 거르지 않는다.
export function createWeddingCodeSceneVersionHistoricalRepository(sourceRoot) {
  const fixture = createWeddingCodeResearchHistoricalRepository(sourceRoot);
  try {
    const file = 'supabase/release-contracts/wedding-code-research-scene-v09-v1.json';
    const contract = JSON.parse(pinnedArtifact(sourceRoot, { file,
      sha256: '46017ac2e9a4e404a6c171c79793dd57547a5649124ed5163dd99b8abe3a04c6' }));
    const pins = [contract.runtime, contract.predecessorMigration,
      ...contract.migrations.map(pin => ({ ...pin, file: `supabase/migrations/${pin.file}` }))];
    for (const pin of pins) pinnedArtifact(sourceRoot, pin);
    for (const path of [file, ...pins.map(pin => pin.file)]) {
      mkdirSync(dirname(join(fixture.root, path)), { recursive: true });
      copyFileSync(join(sourceRoot, path), join(fixture.root, path));
    }
    return fixture;
  } catch (error) { fixture.cleanup(); throw error; }
}
