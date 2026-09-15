import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pinnedArtifact } from '../../lib/current-baseline-release-contract.mjs';
import { createProfileAvatarHistoricalRepository } from './profile-avatar-historical-repository.mjs';

// 231 역사 fixture에 이미 검토된 232 원문만 추가한다. 현행 SQL 목록을 줄이거나 거르지 않는다.
export function createCustomerDataHistoricalRepository(sourceRoot) {
  const fixture = createProfileAvatarHistoricalRepository(sourceRoot);
  try {
    const file = 'supabase/release-contracts/account-deletion-customer-data-v1.json';
    const contract = JSON.parse(pinnedArtifact(sourceRoot, { file,
      sha256: '129032ad576124bf54b68cb09747dd37999be089daa5c3ea5fa48303d1945187' }));
    const pins = [contract.runtime, contract.catalog, contract.catalogFixture, contract.previousFunction, contract.previousClaimFunction,
      ...contract.migrations.map(pin => ({ ...pin, file: `supabase/migrations/${pin.file}` }))];
    for (const pin of pins) pinnedArtifact(sourceRoot, pin);
    for (const path of [file, ...pins.map(pin => pin.file)]) {
      mkdirSync(dirname(join(fixture.root, path)), { recursive: true });
      copyFileSync(join(sourceRoot, path), join(fixture.root, path));
    }
    return fixture;
  } catch (error) { fixture.cleanup(); throw error; }
}
