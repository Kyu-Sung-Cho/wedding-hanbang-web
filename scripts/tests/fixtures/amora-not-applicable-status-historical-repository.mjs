import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pinnedArtifact } from '../../lib/current-baseline-release-contract.mjs';
import { createCustomerDataHistoricalRepository } from './account-deletion-customer-data-historical-repository.mjs';

// 232 역사 fixture에 이미 검토된 233 원문만 추가한다. 현행 SQL 목록을 줄이거나 거르지 않는다.
export function createNotApplicableStatusHistoricalRepository(sourceRoot) {
  const fixture = createCustomerDataHistoricalRepository(sourceRoot);
  try {
    const file = 'supabase/release-contracts/amora-not-applicable-status-v1.json';
    const contract = JSON.parse(pinnedArtifact(sourceRoot, { file,
      sha256: '8d77b3bbe24586d0f3b171f828093cd55b0e5ecbd6173bba00ca0baa17fc13ed' }));
    const pins = [contract.runtime, contract.previousFunction, contract.predecessorMigration,
      ...contract.migrations.map(pin => ({ ...pin, file: `supabase/migrations/${pin.file}` }))];
    for (const pin of pins) pinnedArtifact(sourceRoot, pin);
    for (const path of [file, ...pins.map(pin => pin.file)]) {
      mkdirSync(dirname(join(fixture.root, path)), { recursive: true });
      copyFileSync(join(sourceRoot, path), join(fixture.root, path));
    }
    return fixture;
  } catch (error) { fixture.cleanup(); throw error; }
}
