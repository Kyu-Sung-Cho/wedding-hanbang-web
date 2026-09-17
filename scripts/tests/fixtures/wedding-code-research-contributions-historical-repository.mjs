import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pinnedArtifact } from '../../lib/current-baseline-release-contract.mjs';
import { createNotApplicableStatusHistoricalRepository } from './amora-not-applicable-status-historical-repository.mjs';

// 233 역사 fixture에 이미 검토된 234 원문만 추가한다. 현행 SQL 목록을 줄이거나 거르지 않는다.
export function createWeddingCodeResearchHistoricalRepository(sourceRoot) {
  const fixture = createNotApplicableStatusHistoricalRepository(sourceRoot);
  try {
    const file = 'supabase/release-contracts/wedding-code-research-contributions-v1.json';
    const contract = JSON.parse(pinnedArtifact(sourceRoot, { file,
      sha256: '7230b2d9b698c1b9cff230dcf4fe88213273f3802fdf88698937cde16b8110ac' }));
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
